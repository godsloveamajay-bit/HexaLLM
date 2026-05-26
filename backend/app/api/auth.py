import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.database import get_db
from ..core.security import (
    hash_password, verify_password, create_access_token,
    generate_api_key, get_current_user,
)
from ..models.user import User, APIKey, PasswordResetToken
from ..schemas.auth import UserRegister, UserLogin, UserOut, UserUpdate, PasswordChange, TokenResponse, APIKeyCreate, APIKeyOut
from ..services.email_service import send_password_reset

router = APIRouter(prefix="/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)

_RESET_TOKEN_EXPIRE_HOURS = 1


@router.post("/register", response_model=TokenResponse, status_code=201)
@limiter.limit("10/minute")
def register(request: Request, data: UserRegister, db: Session = Depends(get_db)):
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

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenResponse)
@limiter.limit("20/minute")
def login(request: Request, data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


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
    for field, value in data.model_dump(exclude_none=True).items():
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

    user = db.query(User).filter(User.email == email, User.is_active == True).first()
    if not user:
        return {"detail": "If that email is registered you'll receive a reset link shortly."}

    # Invalidate old tokens for this user
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used == False,
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
        PasswordResetToken.used == False,
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


@router.get("/api-keys", response_model=list[APIKeyOut])
def list_api_keys(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    keys = db.query(APIKey).filter(APIKey.user_id == current_user.id).all()
    return keys


@router.post("/api-keys", response_model=APIKeyOut, status_code=201)
def create_api_key(data: APIKeyCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    key = APIKey(
        user_id=current_user.id,
        name=data.name,
        key=generate_api_key(),
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return key


@router.delete("/api-keys/{key_id}", status_code=204)
def delete_api_key(key_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    key = db.query(APIKey).filter(APIKey.id == key_id, APIKey.user_id == current_user.id).first()
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")
    db.delete(key)
    db.commit()
