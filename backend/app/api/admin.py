from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from datetime import datetime, timezone, timedelta
from typing import Optional
from pydantic import BaseModel, EmailStr
from ..core.database import get_db
from ..core.security import require_admin, hash_password, get_current_user
from ..models.user import User
from ..models.chat import RequestLog
from ..models.ip_whitelist import IpWhitelist

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Schemas ─────────────────────────────────────────────────────────────────

class UserOut(BaseModel):
    id: int
    email: str
    username: str
    full_name: Optional[str] = None
    is_active: bool
    is_admin: bool
    created_at: Optional[datetime] = None
    last_login: Optional[datetime] = None

    model_config = {"from_attributes": True}


class LogEntry(BaseModel):
    id: int
    user_id: Optional[int] = None
    email: Optional[str] = None
    endpoint: str
    method: str
    status_code: int
    model_name: Optional[str] = None
    prompt_tokens: int
    completion_tokens: int
    latency_ms: Optional[int] = None
    ip_address: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class WhitelistEntry(BaseModel):
    id: int
    ip_address: str
    label: Optional[str] = None
    note: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class AdminStats(BaseModel):
    total_users: int
    total_admins: int
    active_today: int
    total_requests: int
    total_whitelisted_ips: int
    requests_last_30d: int
    unique_users_30d: int


class CreateUserRequest(BaseModel):
    username: str
    email: str
    password: str
    full_name: Optional[str] = None
    is_admin: bool = False


class UpdateUserRequest(BaseModel):
    is_admin: Optional[bool] = None
    is_active: Optional[bool] = None
    full_name: Optional[str] = None


class WhitelistCreate(BaseModel):
    ip_address: str
    label: Optional[str] = None
    note: Optional[str] = None


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/stats", response_model=AdminStats)
def admin_stats(db: Session = Depends(get_db), _=Depends(require_admin)):
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    thirty_days_ago = now - timedelta(days=30)

    total_users = db.query(User).count()
    total_admins = db.query(User).filter(User.is_admin.is_(True)).count()
    active_today = db.query(User).filter(User.is_active.is_(True), User.created_at >= today_start).count()
    total_requests = db.query(RequestLog).count()
    total_whitelisted_ips = db.query(IpWhitelist).count()
    requests_last_30d = db.query(RequestLog).filter(RequestLog.created_at >= thirty_days_ago).count()
    unique_users_30d = db.query(RequestLog.user_id).filter(
        RequestLog.created_at >= thirty_days_ago,
        RequestLog.user_id.isnot(None),
    ).distinct().count()

    return AdminStats(
        total_users=total_users,
        total_admins=total_admins,
        active_today=active_today,
        total_requests=total_requests,
        total_whitelisted_ips=total_whitelisted_ips,
        requests_last_30d=requests_last_30d,
        unique_users_30d=unique_users_30d,
    )


@router.get("/users", response_model=list[UserOut])
def list_users(
    search: Optional[str] = Query(None),
    admin_only: bool = Query(False),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    q = db.query(User)
    if admin_only:
        q = q.filter(User.is_admin.is_(True))
    if search:
        like = f"%{search}%"
        q = q.filter(
            User.email.ilike(like) | User.username.ilike(like) | User.full_name.ilike(like)
        )
    users = q.order_by(User.created_at.desc()).limit(100).all()

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    last_login_map = {}
    log_rows = db.query(RequestLog.user_id, RequestLog.created_at).filter(
        RequestLog.user_id.isnot(None),
        RequestLog.created_at >= today_start,
    ).order_by(RequestLog.created_at.desc()).all()
    for uid, ts in log_rows:
        if uid not in last_login_map:
            last_login_map[uid] = ts

    result = []
    for u in users:
        out = UserOut.model_validate(u)
        out.last_login = last_login_map.get(u.id)
        result.append(out)
    return result


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    data: UpdateUserRequest,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if data.is_admin is not None:
        user.is_admin = data.is_admin
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.full_name is not None:
        user.full_name = data.full_name

    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/users", response_model=UserOut, status_code=201)
def create_admin_user(
    data: CreateUserRequest,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    existing = db.query(User).filter(
        (User.email == data.email) | (User.username == data.username)
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email or username already taken")

    user = User(
        email=data.email,
        username=data.username,
        hashed_password=hash_password(data.password),
        full_name=data.full_name,
        is_admin=data.is_admin,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.get("/logs", response_model=list[LogEntry])
def list_logs(
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    user_id: Optional[int] = Query(None),
    status_code: Optional[int] = Query(None),
    endpoint: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    q = db.query(RequestLog).options(joinedload(RequestLog.user))
    if user_id:
        q = q.filter(RequestLog.user_id == user_id)
    if status_code:
        q = q.filter(RequestLog.status_code == status_code)
    if endpoint:
        q = q.filter(RequestLog.endpoint.ilike(f"%{endpoint}%"))
    logs = q.order_by(RequestLog.created_at.desc()).offset(offset).limit(limit).all()

    return [
        LogEntry(
            id=log.id,
            user_id=log.user_id,
            email=log.user.email if log.user else None,
            endpoint=log.endpoint,
            method=log.method,
            status_code=log.status_code,
            model_name=log.model_name,
            prompt_tokens=log.prompt_tokens,
            completion_tokens=log.completion_tokens,
            latency_ms=log.latency_ms,
            ip_address=log.ip_address,
            created_at=log.created_at,
        )
        for log in logs
    ]


@router.get("/ip-whitelist", response_model=list[WhitelistEntry])
def list_whitelist(db: Session = Depends(get_db), _=Depends(require_admin)):
    entries = db.query(IpWhitelist).order_by(IpWhitelist.created_at.desc()).all()
    return [WhitelistEntry.model_validate(e) for e in entries]


@router.post("/ip-whitelist", response_model=WhitelistEntry, status_code=201)
def add_whitelist(
    data: WhitelistCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    existing = db.query(IpWhitelist).filter(IpWhitelist.ip_address == data.ip_address).first()
    if existing:
        raise HTTPException(status_code=409, detail="IP already whitelisted")

    entry = IpWhitelist(
        ip_address=data.ip_address,
        label=data.label,
        note=data.note,
        created_by=current_user.id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return WhitelistEntry.model_validate(entry)


@router.delete("/ip-whitelist/{ip_id}")
def remove_whitelist(
    ip_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    entry = db.query(IpWhitelist).filter(IpWhitelist.id == ip_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="IP not found in whitelist")
    db.delete(entry)
    db.commit()
    return {"status": "removed", "ip": entry.ip_address}
