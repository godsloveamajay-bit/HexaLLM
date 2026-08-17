import secrets
import re
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.database import get_db
from ..core.security import (
    hash_password, verify_password, create_access_token,
    generate_api_key, get_current_user, get_optional_user, SESSION_COOKIE, SESSION_COOKIE_DOMAIN,
)
from ..models.user import User, APIKey, PasswordResetToken
from ..schemas.auth import UserRegister, UserLogin, UserOut, UserUpdate, PasswordChange, TokenResponse, APIKeyCreate, APIKeyOut
from ..services.email_service import send_password_reset

# ── OAuth provider registry ───────────────────────────────────────────────────

_OAUTH = {
    "google": {
        "auth_url":     "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url":    "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://www.googleapis.com/oauth2/v3/userinfo",
        "scope":        "openid email profile",
    },
    "microsoft": {
        "auth_url":     "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token_url":    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "userinfo_url": "https://graph.microsoft.com/v1.0/me",
        "scope":        "openid email profile User.Read",
    },
    "yahoo": {
        "auth_url":     "https://api.login.yahoo.com/oauth2/request_auth",
        "token_url":    "https://api.login.yahoo.com/oauth2/get_token",
        "userinfo_url": "https://api.login.yahoo.com/openid/v1/userinfo",
        "scope":        "openid email profile",
    },
    "apple": {
        "auth_url":     "https://appleid.apple.com/auth/authorize",
        "token_url":    "https://appleid.apple.com/auth/token",
        "scope":        "name email",
        "form_post":    True,   # Apple uses POST for the callback
    },
    "samsung": {
        "auth_url":     "https://account.samsung.com/auth/authorize",
        "token_url":    "https://account.samsung.com/auth/token",
        "userinfo_url": "https://account.samsung.com/auth/userinfo",
        "scope":        "openid email profile",
    },
}


def _client_id(provider: str) -> str:
    return getattr(settings, f"{provider.upper()}_CLIENT_ID", "")


def _client_secret(provider: str) -> str:
    if provider == "apple":
        return _apple_client_secret()
    return getattr(settings, f"{provider.upper()}_CLIENT_SECRET", "")


def _apple_client_secret() -> str:
    """Generate the short-lived JWT that Apple requires as client_secret."""
    if not all([settings.APPLE_TEAM_ID, settings.APPLE_KEY_ID,
                settings.APPLE_CLIENT_ID, settings.APPLE_PRIVATE_KEY]):
        return ""
    from jose import jwt as jose_jwt
    now = int(datetime.now(timezone.utc).timestamp())
    private_key = settings.APPLE_PRIVATE_KEY.replace("\\n", "\n")
    return jose_jwt.encode(
        {"iss": settings.APPLE_TEAM_ID, "iat": now, "exp": now + 15552000,
         "aud": "https://appleid.apple.com", "sub": settings.APPLE_CLIENT_ID},
        private_key,
        algorithm="ES256",
        headers={"kid": settings.APPLE_KEY_ID},
    )


def _redirect_uri(provider: str) -> str:
    return f"{settings.APP_URL}/api/v1/auth/oauth/{provider}/callback"


def _unique_username(db: Session, base: str) -> str:
    """Return a unique username derived from base (email prefix)."""
    slug = re.sub(r"[^a-z0-9_]", "", base.lower())[:20] or "user"
    candidate = slug
    n = 1
    while db.query(User).filter(User.username == candidate).first():
        candidate = f"{slug[:17]}{n}"
        n += 1
    return candidate


def _find_or_create_oauth_user(db: Session, provider: str, info: dict) -> User:
    """Find existing user by oauth identity, link by email, or create new."""
    sub = str(info.get("sub") or info.get("id") or "")
    email = (info.get("email") or "").lower().strip()
    name = info.get("name") or info.get("displayName") or ""
    avatar = info.get("picture") or info.get("photo") or None

    # 1. Known OAuth identity
    if sub:
        user = db.query(User).filter(
            User.oauth_provider == provider, User.oauth_id == sub
        ).first()
        if user:
            return user

    # 2. Existing account with same email → link it
    if email:
        user = db.query(User).filter(User.email == email).first()
        if user:
            user.oauth_provider = provider
            user.oauth_id = sub
            if avatar and not user.avatar_url:
                user.avatar_url = avatar
            db.commit()
            return user

    # 3. Create new account
    is_admin = db.query(User).count() == 0
    username = _unique_username(db, email.split("@")[0] if email else "user")
    user = User(
        email=email,
        username=username,
        hashed_password=None,
        full_name=name or None,
        avatar_url=avatar,
        oauth_provider=provider,
        oauth_id=sub,
        is_admin=is_admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _exchange_code(provider: str, code: str) -> Optional[dict]:
    cfg = _OAUTH[provider]
    data = {
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  _redirect_uri(provider),
        "client_id":     _client_id(provider),
        "client_secret": _client_secret(provider),
    }
    try:
        r = httpx.post(cfg["token_url"], data=data, timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


def _get_userinfo(provider: str, access_token: str, id_token: str = "") -> Optional[dict]:
    cfg = _OAUTH[provider]
    if provider == "apple":
        # Decode ID token — no separate userinfo endpoint
        from jose import jwt as jose_jwt
        try:
            return jose_jwt.decode(id_token, "", options={"verify_signature": False})
        except Exception:
            return None

    userinfo_url = cfg.get("userinfo_url", "")
    if not userinfo_url:
        return None
    try:
        r = httpx.get(userinfo_url, headers={"Authorization": f"Bearer {access_token}"}, timeout=10)
        r.raise_for_status()
        data = r.json()
        # Microsoft uses 'mail' or 'userPrincipalName' for email
        if provider == "microsoft":
            data.setdefault("email", data.get("mail") or data.get("userPrincipalName", ""))
            data.setdefault("sub", data.get("id", ""))
        return data
    except Exception:
        return None


def _oauth_error_redirect(msg: str) -> RedirectResponse:
    return RedirectResponse(
        url=f"{settings.APP_URL}/login?oauth_error={urllib.parse.quote(msg)}",
        status_code=302,
    )

router = APIRouter(prefix="/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)

_RESET_TOKEN_EXPIRE_HOURS = 1


def _set_session_cookie(response: Response, token: str) -> None:
    """Shared cross-subdomain session cookie (one account for every hexallm.co.uk site)."""
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=True,
        samesite="lax",
        domain=SESSION_COOKIE_DOMAIN,
        path="/",
    )


@router.post("/register", response_model=TokenResponse, status_code=201)
@limiter.limit("10/minute")
def register(request: Request, data: UserRegister, response: Response, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")

    # First user becomes admin
    is_admin = db.query(User).count() == 0

    user = User(
        email=data.email,
        username=data.username,
        hashed_password=hash_password(data.password),
        full_name=data.full_name,
        is_admin=is_admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": str(user.id), "tv": user.token_version or 0})
    _set_session_cookie(response, token)
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


def _verify_credentials(db: Session, email: str, password: str) -> User:
    user = db.query(User).filter(User.email == email).first()
    if not user or not user.hashed_password or not verify_password(password, user.hashed_password):
        if user and user.oauth_provider and not user.hashed_password:
            raise HTTPException(status_code=401, detail=f"This account uses {user.oauth_provider.title()} sign-in. Use the social login button.")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    return user


@router.post("/login", response_model=TokenResponse)
@limiter.limit("20/minute")
def login(request: Request, data: UserLogin, response: Response, db: Session = Depends(get_db)):
    user = _verify_credentials(db, data.email, data.password)

    token = create_access_token({"sub": str(user.id), "tv": user.token_version or 0})
    _set_session_cookie(response, token)
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.post("/dev-login", response_model=TokenResponse)
@limiter.limit("20/minute")
def dev_login(request: Request, data: UserLogin, response: Response, db: Session = Depends(get_db)):
    """Same credentials as the main site, but the dev site only admits admins."""
    user = _verify_credentials(db, data.email, data.password)
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="The dev site is restricted to admin accounts")

    token = create_access_token({"sub": str(user.id), "tv": user.token_version or 0})
    _set_session_cookie(response, token)
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.post("/logout", status_code=204)
def logout(response: Response, current_user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    if current_user:
        # Revoke every token ever issued to this account (all sites, all devices)
        current_user.token_version = (current_user.token_version or 0) + 1
        db.commit()
    response.delete_cookie(key=SESSION_COOKIE, domain=SESSION_COOKIE_DOMAIN, path="/")


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/me/password", status_code=204)
def change_password(data: PasswordChange, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    current_user.hashed_password = hash_password(data.new_password)
    db.commit()


@router.patch("/me", response_model=UserOut)
def update_me(data: UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # exclude_unset → only touch fields the client actually sent; this lets a
    # client clear a field by sending null (proper PATCH semantics).
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/forgot-password", status_code=202)
@limiter.limit("5/minute")
def forgot_password(request: Request, data: dict, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Always returns 202 so we don't leak which emails are registered."""
    email = (data.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=422, detail="Email required")

    user = db.query(User).filter(User.email == email, User.is_active).first()
    if not user:
        return {"detail": "If that email is registered you'll receive a reset link shortly."}

    # Invalidate old tokens for this user
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used == False,  # noqa: E712
    ).update({"used": True})

    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=_RESET_TOKEN_EXPIRE_HOURS)
    db.add(PasswordResetToken(user_id=user.id, token=token, expires_at=expires))
    db.commit()

    reset_url = f"{settings.APP_URL}/reset-password?token={token}"
    background_tasks.add_task(send_password_reset, user.email, reset_url, user.username)
    return {"detail": "If that email is registered you'll receive a reset link shortly."}


@router.post("/reset-password", status_code=204)
def reset_password(data: dict, db: Session = Depends(get_db)):
    token_str = (data.get("token") or "").strip()
    new_password = data.get("new_password") or ""

    if not token_str or not new_password:
        raise HTTPException(status_code=422, detail="token and new_password are required")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    record = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == token_str,
        PasswordResetToken.used == False,  # noqa: E712
    ).first()

    if not record:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")
    if record.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Reset link has expired")

    user = db.query(User).filter(User.id == record.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")

    user.hashed_password = hash_password(new_password)
    record.used = True
    db.commit()


def _key_out(key: APIKey) -> APIKeyOut:
    out = APIKeyOut.model_validate(key)
    out.persona_name = key.persona.name if key.persona_id and key.persona else None
    return out


@router.get("/api-keys", response_model=list[APIKeyOut])
def list_api_keys(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    keys = db.query(APIKey).filter(APIKey.user_id == current_user.id).order_by(APIKey.created_at.desc()).all()
    return [_key_out(k) for k in keys]


@router.post("/api-keys", response_model=APIKeyOut, status_code=201)
def create_api_key(data: APIKeyCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from ..models.persona import SavedPersona

    persona_id = None
    model_name = data.model
    # Non-admins bind keys to HexaLLM variants, not raw Ollama models.
    if model_name and not current_user.is_admin:
        from ..services import model_router
        if not model_router.is_variant(model_name):
            raise HTTPException(status_code=400, detail="Choose a HexaLLM model to bind this key to.")
    if data.persona_id is not None:
        persona = db.query(SavedPersona).filter(
            SavedPersona.id == data.persona_id, SavedPersona.user_id == current_user.id
        ).first()
        if not persona:
            raise HTTPException(status_code=404, detail="Persona not found")
        persona_id = persona.id
        model_name = persona.base_model  # snapshot the served model

    key = APIKey(
        user_id=current_user.id,
        name=data.name,
        key=generate_api_key(),
        persona_id=persona_id,
        model_name=model_name,
        temperature=data.temperature,
        top_p=data.top_p,
        max_tokens=data.max_tokens,
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return _key_out(key)


@router.delete("/api-keys/{key_id}", status_code=204)
def delete_api_key(key_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    key = db.query(APIKey).filter(APIKey.id == key_id, APIKey.user_id == current_user.id).first()
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")
    db.delete(key)
    db.commit()


# ── OAuth ─────────────────────────────────────────────────────────────────────

@router.get("/oauth/{provider}")
def oauth_initiate(provider: str, state: str = ""):
    if provider not in _OAUTH:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")
    if not _client_id(provider):
        raise HTTPException(status_code=503, detail=f"{provider.title()} login is not configured")

    cfg = _OAUTH[provider]
    params: dict = {
        "client_id":     _client_id(provider),
        "redirect_uri":  _redirect_uri(provider),
        "response_type": "code",
        "scope":         cfg["scope"],
        "state":         state,
    }
    if cfg.get("form_post"):
        params["response_mode"] = "form_post"

    return RedirectResponse(
        url=cfg["auth_url"] + "?" + urllib.parse.urlencode(params),
        status_code=302,
    )


def _handle_oauth_callback(provider: str, code: str, state: str, db: Session, user_json: str = ""):
    tokens = _exchange_code(provider, code)
    if not tokens:
        return _oauth_error_redirect("token_exchange_failed")

    access_token = tokens.get("access_token", "")
    id_token = tokens.get("id_token", "")
    info = _get_userinfo(provider, access_token, id_token)

    # Apple sends user name JSON only on first auth
    if provider == "apple" and user_json:
        try:
            import json as _json
            u = _json.loads(user_json)
            name_obj = u.get("name", {})
            info = info or {}
            info.setdefault("name", f"{name_obj.get('firstName', '')} {name_obj.get('lastName', '')}".strip())
            info.setdefault("email", u.get("email", ""))
        except Exception:
            pass

    if not info or not info.get("email"):
        return _oauth_error_redirect("no_email")

    user = _find_or_create_oauth_user(db, provider, info)
    jwt = create_access_token({"sub": str(user.id), "tv": user.token_version or 0})
    qs = f"token={urllib.parse.quote(jwt)}"

    # CLI flow: state = "cli_{port}_{nonce}" → redirect to local server
    if state.startswith("cli_"):
        parts = state.split("_", 2)
        if len(parts) >= 2 and parts[1].isdigit():
            port = int(parts[1])
            if 1024 <= port <= 65535:
                return RedirectResponse(url=f"http://localhost:{port}/callback?{qs}", status_code=302)

    if state:
        qs += f"&state={urllib.parse.quote(state)}"
    resp = RedirectResponse(url=f"{settings.APP_URL}/oauth/callback?{qs}", status_code=302)
    _set_session_cookie(resp, jwt)
    return resp


@router.get("/oauth/{provider}/callback")
def oauth_callback_get(
    provider: str,
    code: str = "",
    state: str = "",
    error: str = "",
    db: Session = Depends(get_db),
):
    if error:
        return _oauth_error_redirect(error)
    if not code:
        return _oauth_error_redirect("no_code")
    return _handle_oauth_callback(provider, code, state, db)


@router.post("/oauth/{provider}/callback")
async def oauth_callback_post(provider: str, request: Request, db: Session = Depends(get_db)):
    """Apple uses response_mode=form_post so the callback arrives as a POST."""
    form = await request.form()
    error = form.get("error", "")
    code = form.get("code", "")
    state = form.get("state", "")
    user_json = form.get("user", "")
    if error:
        return _oauth_error_redirect(str(error))
    if not code:
        return _oauth_error_redirect("no_code")
    return _handle_oauth_callback(provider, str(code), str(state), db, str(user_json))
