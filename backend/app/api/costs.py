"""Cost Dashboard API - Track spend per model/user/chat."""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, func, Index
from sqlalchemy.orm import Session

from ..core.database import Base, get_db
from ..core.security import get_current_user
from ..models.user import User

router = APIRouter(prefix="/costs", tags=["costs"])


class CostRecord(Base):
    __tablename__ = "cost_records"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    model_name = Column(String(100), nullable=False, index=True)
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    estimated_cost_usd = Column(Float, default=0.0)
    request_type = Column(String(50), nullable=True)  # chat, image, transcribe, etc.
    endpoint = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index('ix_cost_user_model_date', 'user_id', 'model_name', 'created_at'),
        Index('ix_cost_user_date', 'user_id', 'created_at'),
    )


class CostRecordCreate(BaseModel):
    model_name: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    estimated_cost_usd: float
    request_type: Optional[str] = None
    endpoint: Optional[str] = None


class CostSummary(BaseModel):
    total_cost_usd: float
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    request_count: int


class ModelCostBreakdown(BaseModel):
    model_name: str
    cost_usd: float
    tokens: int
    request_count: int
    avg_cost_per_request: float


class DailyCost(BaseModel):
    date: str
    cost_usd: float
    tokens: int
    request_count: int


class CostDashboardResponse(BaseModel):
    summary: CostSummary
    by_model: List[ModelCostBreakdown]
    daily: List[DailyCost]
    top_models: List[ModelCostBreakdown]


class CostTrendsResponse(BaseModel):
    daily: List[DailyCost]
    by_model: List[ModelCostBreakdown]


def estimate_cost(model_name: str, prompt_tokens: int, completion_tokens: int) -> float:
    """Estimate cost in USD based on model pricing."""
    # Pricing per 1K tokens (approximate, update as needed)
    pricing = {
        # OpenAI models
        "gpt-4": {"prompt": 0.03, "completion": 0.06},
        "gpt-4-turbo": {"prompt": 0.01, "completion": 0.03},
        "gpt-4o": {"prompt": 0.005, "completion": 0.015},
        "gpt-4o-mini": {"prompt": 0.00015, "completion": 0.0006},
        "gpt-3.5-turbo": {"prompt": 0.0005, "completion": 0.0015},
        # Anthropic
        "claude-3-opus": {"prompt": 0.015, "completion": 0.075},
        "claude-3-sonnet": {"prompt": 0.003, "completion": 0.015},
        "claude-3-haiku": {"prompt": 0.00025, "completion": 0.00125},
        # Google
        "gemini-pro": {"prompt": 0.0005, "completion": 0.0015},
        "gemini-flash": {"prompt": 0.000075, "completion": 0.0003},
        # Local models (zero cost)
        "hex-auto": {"prompt": 0.0, "completion": 0.0},
        "hex-4.2-turbo": {"prompt": 0.0, "completion": 0.0},
        "hex-5.1-prime": {"prompt": 0.0, "completion": 0.0},
        "hex-4.2-code": {"prompt": 0.0, "completion": 0.0},
        "hex-4.3-write": {"prompt": 0.0, "completion": 0.0},
        "qwen2.5:7b": {"prompt": 0.0, "completion": 0.0},
        "llama3.1:8b": {"prompt": 0.0, "completion": 0.0},
        "qwen3:14b": {"prompt": 0.0, "completion": 0.0},
    }
    
    # Try exact match first
    if model_name in pricing:
        p = pricing[model_name]
        return (prompt_tokens / 1000 * p["prompt"]) + (completion_tokens / 1000 * p["completion"])
    
    # Try prefix match
    for key, p in pricing.items():
        if model_name.startswith(key):
            return (prompt_tokens / 1000 * p["prompt"]) + (completion_tokens / 1000 * p["completion"])
    
    # Default: assume local model (free)
    return 0.0


def record_cost(
    db: Session,
    user_id: int,
    model_name: str,
    prompt_tokens: int,
    completion_tokens: int,
    request_type: str = "chat",
    endpoint: str = "",
) -> None:
    """Record a cost entry."""
    total_tokens = prompt_tokens + completion_tokens
    cost = estimate_cost(None, prompt_tokens, completion_tokens)
    
    record = CostRecord(
        user_id=user_id,
        model_name=model_name,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        estimated_cost_usd=cost,
        request_type=request_type,
        endpoint=endpoint,
    )
    db.add(record)
    db.commit()


# Patch the chat endpoint to record costs
# (This would be done in the actual chat endpoint - showing pattern here)


router = APIRouter(prefix="/costs", tags=["costs"])


class CostDashboardRequest(BaseModel):
    days: int = Field(30, ge=1, le=365)
    user_id: Optional[int] = None


class CostRecordResponse(BaseModel):
    id: int
    user_id: int
    model_name: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    estimated_cost_usd: float
    request_type: Optional[str]
    endpoint: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/dashboard", response_model=CostDashboardResponse)
async def get_cost_dashboard(
    days: int = Query(30, ge=1, le=365),
    user_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get cost dashboard for a user or all users (admin)."""
    since = datetime.utcnow() - timedelta(days=days)

    query = db.query(CostRecord).filter(CostRecord.created_at >= since)

    # Non-admins only ever see their own spend, and can't ask for someone
    # else's by passing user_id.
    if current_user.is_admin:
        if user_id is not None:
            query = query.filter(CostRecord.user_id == user_id)
    else:
        query = query.filter(CostRecord.user_id == current_user.id)

    records = query.all()
    
    if not records:
        return CostDashboardResponse(
            summary=CostSummary(
                total_cost_usd=0.0,
                total_tokens=0,
                prompt_tokens=0,
                completion_tokens=0,
                request_count=0,
            ),
            by_model=[],
            daily=[],
            top_models=[],
        )
    
    # Calculate summary
    total_cost = sum(r.estimated_cost_usd for r in records)
    total_tokens = sum(r.total_tokens for r in records)
    prompt_tokens = sum(r.prompt_tokens for r in records)
    completion_tokens = sum(r.completion_tokens for r in records)
    request_count = len(records)
    
    # By model
    by_model_dict = defaultdict(lambda: {"cost": 0.0, "tokens": 0, "count": 0})
    for r in records:
        by_model_dict[r.model_name]["cost"] += r.estimated_cost_usd
        by_model_dict[r.model_name]["tokens"] += r.total_tokens
        by_model_dict[r.model_name]["count"] += 1
    
    by_model = [
        ModelCostBreakdown(
            model_name=model,
            cost_usd=round(data["cost"], 4),
            tokens=data["tokens"],
            request_count=data["count"],
            avg_cost_per_request=round(data["cost"] / data["count"], 6) if data["count"] > 0 else 0,
        )
        for model, data in sorted(by_model_dict.items(), key=lambda x: x[1]["cost"], reverse=True)
    ]
    
    # Daily breakdown
    daily_dict = defaultdict(lambda: {"cost": 0.0, "tokens": 0, "count": 0})
    for r in records:
        day = r.created_at.date().isoformat()
        daily_dict[day]["cost"] += r.estimated_cost_usd
        daily_dict[day]["tokens"] += r.total_tokens
        daily_dict[day]["count"] += 1
    
    daily = [
        DailyCost(
            date=day,
            cost_usd=round(data["cost"], 4),
            tokens=data["tokens"],
            request_count=data["count"],
        )
        for day, data in sorted(daily_dict.items())
    ]
    
    # Top models (by cost)
    top_models = sorted(by_model, key=lambda x: x.cost_usd, reverse=True)[:10]
    
    return CostDashboardResponse(
        summary=CostSummary(
            total_cost_usd=round(total_cost, 4),
            total_tokens=total_tokens,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            request_count=request_count,
        ),
        by_model=by_model,
        daily=daily,
        top_models=top_models,
    )


@router.get("/records", response_model=List[CostRecordResponse])
async def get_cost_records(
    days: int = Query(30, ge=1, le=365),
    user_id: Optional[int] = None,
    model_name: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get raw cost records (own records; admins may pass user_id)."""
    since = datetime.utcnow() - timedelta(days=days)

    query = db.query(CostRecord).filter(CostRecord.created_at >= since)

    if current_user.is_admin:
        if user_id is not None:
            query = query.filter(CostRecord.user_id == user_id)
    else:
        query = query.filter(CostRecord.user_id == current_user.id)

    if model_name:
        query = query.filter(CostRecord.model_name == model_name)

    records = query.order_by(CostRecord.created_at.desc()).limit(limit).all()
    return records


@router.post("/record")
async def record_cost_endpoint(
    record: CostRecordCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Record a cost entry. Always attributed to the caller."""
    payload = record.model_dump()
    # The owner is never taken from the request body.
    payload.pop("user_id", None)
    record_obj = CostRecord(user_id=current_user.id, **payload)
    db.add(record_obj)
    db.commit()
    db.refresh(record_obj)
    return {"id": record_obj.id}
