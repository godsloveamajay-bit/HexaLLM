from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta, timezone
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.user import User
from ..models.chat import RequestLog, ChatSession, AgentRun
from ..models.model import AIModel

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/overview")
def get_overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    thirty_days_ago = now - timedelta(days=30)

    total_requests = db.query(func.count(RequestLog.id)).filter(RequestLog.user_id == current_user.id).scalar()
    requests_30d = db.query(func.count(RequestLog.id)).filter(
        RequestLog.user_id == current_user.id,
        RequestLog.created_at >= thirty_days_ago,
    ).scalar()

    total_tokens = db.query(
        func.sum(RequestLog.prompt_tokens + RequestLog.completion_tokens)
    ).filter(RequestLog.user_id == current_user.id).scalar() or 0

    total_models = db.query(func.count(AIModel.id)).filter(AIModel.owner_id == current_user.id).scalar()
    total_chats = db.query(func.count(ChatSession.id)).filter(ChatSession.user_id == current_user.id).scalar()
    total_agent_runs = db.query(func.count(AgentRun.id)).filter(AgentRun.user_id == current_user.id).scalar()

    avg_latency = db.query(func.avg(RequestLog.latency_ms)).filter(
        RequestLog.user_id == current_user.id,
        RequestLog.latency_ms.isnot(None),
    ).scalar() or 0

    return {
        "total_requests": total_requests,
        "requests_30d": requests_30d,
        "total_tokens": total_tokens,
        "total_models": total_models,
        "total_chats": total_chats,
        "total_agent_runs": total_agent_runs,
        "avg_latency_ms": round(avg_latency),
    }


@router.get("/requests/daily")
def requests_daily(
    days: int = 30,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    logs = db.query(RequestLog).filter(
        RequestLog.user_id == current_user.id,
        RequestLog.created_at >= since,
    ).all()

    daily: dict = {}
    for log in logs:
        day = log.created_at.strftime("%Y-%m-%d")
        daily.setdefault(day, {"requests": 0, "tokens": 0, "errors": 0})
        daily[day]["requests"] += 1
        daily[day]["tokens"] += (log.prompt_tokens or 0) + (log.completion_tokens or 0)
        if log.status_code >= 400:
            daily[day]["errors"] += 1

    return [{"date": k, **v} for k, v in sorted(daily.items())]


@router.get("/models/usage")
def model_usage(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(
        RequestLog.model_name,
        func.count(RequestLog.id).label("requests"),
        func.sum(RequestLog.prompt_tokens + RequestLog.completion_tokens).label("tokens"),
        func.avg(RequestLog.latency_ms).label("avg_latency"),
    ).filter(
        RequestLog.user_id == current_user.id,
        RequestLog.model_name.isnot(None),
    ).group_by(RequestLog.model_name).order_by(desc("requests")).all()

    return [
        {
            "model": r.model_name,
            "requests": r.requests,
            "tokens": r.tokens or 0,
            "avg_latency_ms": round(r.avg_latency or 0),
        }
        for r in rows
    ]


@router.get("/logs")
def get_logs(
    limit: int = 100,
    offset: int = 0,
    model: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(RequestLog).filter(RequestLog.user_id == current_user.id)
    if model:
        q = q.filter(RequestLog.model_name == model)
    total = q.count()
    logs = q.order_by(desc(RequestLog.created_at)).offset(offset).limit(limit).all()

    return {
        "total": total,
        "logs": [
            {
                "id": log_entry.id,
                "endpoint": log_entry.endpoint,
                "method": log_entry.method,
                "status_code": log_entry.status_code,
                "model": log_entry.model_name,
                "prompt_tokens": log_entry.prompt_tokens,
                "completion_tokens": log_entry.completion_tokens,
                "latency_ms": log_entry.latency_ms,
                "created_at": log_entry.created_at.isoformat(),
            }
            for log_entry in logs
        ],
    }
