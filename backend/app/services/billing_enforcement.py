from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from fastapi import HTTPException
from ..models.user import User
from ..models.billing import Plan, Subscription
from ..models.chat import ChatMessage, ChatSession, AgentRun
from ..models.knowledge import KnowledgeBase
from ..models.ip_whitelist import IpWhitelist
from ..api.billing import _seed_plans


def _get_user_plan(db: Session, user: User) -> Plan | None:
    sub = db.query(Subscription).filter(
        Subscription.user_id == user.id,
        Subscription.status.in_(["active"]),
    ).first()
    if sub and sub.plan:
        return sub.plan
    # Plans are seeded on-demand by the billing endpoint; seed here too so the
    # free-plan fallback never comes back empty (which 500'd every chat send).
    _seed_plans(db)
    return db.query(Plan).filter(Plan.slug == "free").first()


def get_user_limits(db: Session, user: User) -> dict:
    plan = _get_user_plan(db, user)
    # No plan found at all → treat as unlimited rather than crashing.
    return plan.limits if plan and plan.limits else {}


def get_today_chat_count(db: Session, user_id: int) -> int:
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return db.query(ChatMessage).join(ChatSession).filter(
        ChatSession.user_id == user_id,
        ChatMessage.role == "user",
        ChatMessage.created_at >= today,
    ).count()


def get_today_agent_count(db: Session, user_id: int) -> int:
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return db.query(AgentRun).filter(
        AgentRun.user_id == user_id,
        AgentRun.created_at >= today,
    ).count()


def get_kb_count(db: Session, user_id: int) -> int:
    return db.query(KnowledgeBase).filter(
        KnowledgeBase.user_id == user_id,
    ).count()


def _ip_is_whitelisted(db: Session, client_ip: str | None) -> bool:
    if not client_ip:
        return False
    return db.query(IpWhitelist).filter(IpWhitelist.ip_address == client_ip).first() is not None


def _skip_limit(db: Session, user: User, client_ip: str | None = None) -> bool:
    if getattr(user, "is_admin", False):
        return True
    if client_ip and _ip_is_whitelisted(db, client_ip):
        return True
    return False


def check_chat_limit(db: Session, user: User, client_ip: str | None = None) -> None:
    if _skip_limit(db, user, client_ip):
        return
    limits = get_user_limits(db, user)
    daily = limits.get("chat_daily", -1)
    if daily <= 0:
        return
    count = get_today_chat_count(db, user.id)
    if count >= daily:
        raise HTTPException(
            status_code=429,
            detail=f"You've reached your daily chat limit ({daily} messages). Upgrade your plan to send more messages.",
        )


def check_agent_limit(db: Session, user: User, client_ip: str | None = None) -> None:
    if _skip_limit(db, user, client_ip):
        return
    limits = get_user_limits(db, user)
    daily = limits.get("agent_daily", -1)
    if daily <= 0:
        return
    count = get_today_agent_count(db, user.id)
    if count >= daily:
        raise HTTPException(
            status_code=429,
            detail=f"You've reached your daily agent run limit ({daily} runs). Upgrade your plan to run more agents.",
        )


def check_kb_limit(db: Session, user: User, client_ip: str | None = None) -> None:
    if _skip_limit(db, user, client_ip):
        return
    limits = get_user_limits(db, user)
    max_kb = limits.get("kb_max", -1)
    if max_kb <= 0:
        return
    count = get_kb_count(db, user.id)
    if count >= max_kb:
        raise HTTPException(
            status_code=429,
            detail=f"You've reached your knowledge base limit ({max_kb}). Upgrade your plan to create more knowledge bases.",
        )


def check_image_gen(db: Session, user: User, client_ip: str | None = None) -> None:
    if _skip_limit(db, user, client_ip):
        return
    limits = get_user_limits(db, user)
    if not limits.get("image_gen", True):
        raise HTTPException(
            status_code=403,
            detail="Image generation is not available on your current plan. Upgrade to access this feature.",
        )
