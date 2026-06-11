from pydantic import BaseModel
from typing import Optional, List, Dict
from datetime import datetime


class PlanOut(BaseModel):
    id: int
    name: str
    slug: str
    description: Optional[str]
    price_monthly: float
    price_yearly: float
    currency: str
    features: List
    limits: Dict
    is_active: bool
    sort_order: int

    class Config:
        from_attributes = True


class SubscriptionOut(BaseModel):
    id: int
    plan_id: int
    plan: Optional[PlanOut]
    status: str
    interval: str
    current_period_start: Optional[datetime]
    current_period_end: Optional[datetime]
    cancel_at_period_end: bool
    created_at: datetime

    class Config:
        from_attributes = True


class SubscribeRequest(BaseModel):
    plan_slug: str
    interval: str = "month"


class SubscribeResponse(BaseModel):
    approval_url: str
    subscription_id: int


class PaymentOut(BaseModel):
    id: int
    amount: float
    currency: str
    status: str
    paid_at: datetime

    class Config:
        from_attributes = True


class BillingState(BaseModel):
    plan: Optional[PlanOut]
    subscription: Optional[SubscriptionOut]
    payments: List[PaymentOut] = []
