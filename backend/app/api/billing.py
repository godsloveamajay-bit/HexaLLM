from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import List
from ..core.database import get_db
from ..core.security import get_current_user
from ..models.user import User
from ..models.billing import Plan, Subscription, Payment
from ..schemas.billing import PlanOut, SubscriptionOut, SubscribeRequest, SubscribeResponse, BillingState, PaymentOut
from ..services.paypal_service import paypal
from ..core.config import settings

router = APIRouter(prefix="/billing", tags=["billing"])


def _seed_plans(db: Session):
    """Insert or update default plans (idempotent — keyed by slug)."""
    plans = [
        Plan(
            name="Free",
            slug="free",
            description="Get started with HexaLLM AI for free",
            price_monthly=0,
            price_yearly=0,
            features=[
                "100 chat messages / day",
                "5 agent runs / day",
                "3 knowledge bases",
                "Basic image generation",
                "Community personas",
            ],
            limits={"chat_daily": 100, "agent_daily": 5, "kb_max": 3, "image_gen": True},
            sort_order=0,
        ),
        Plan(
            name="Hyper",
            slug="hyper",
            description="Unlock unlimited access and priority features",
            price_monthly=12,
            price_yearly=120,
            features=[
                "Unlimited chat messages",
                "Unlimited agent runs",
                "Unlimited knowledge bases",
                "Priority image generation",
                "Advanced analytics",
                "API access with rate boost",
                "Custom personas & workflows",
                "Raw Ollama model access",
                "Advanced generation params",
                "Priority support",
            ],
            limits={"chat_daily": -1, "agent_daily": -1, "kb_max": -1, "image_gen": True, "priority": True, "raw_models": True},
            sort_order=1,
        ),
        Plan(
            name="Supreme",
            slug="supreme",
            description="The ultimate HexaLLM AI experience for power users",
            price_monthly=24,
            price_yearly=240,
            features=[
                "Everything in Hyper",
                "Custom fine-tuned models",
                "Highest API rate limits",
                "Raw Ollama model access",
                "Advanced generation params",
                "Priority 24/7 support",
            ],
            limits={"chat_daily": -1, "agent_daily": -1, "kb_max": -1, "image_gen": True, "priority": True, "api_rate_boost": 10, "raw_models": True},
            sort_order=2,
        ),
    ]
    for p in plans:
        existing = db.query(Plan).filter(Plan.slug == p.slug).first()
        if existing:
            for col in ("name", "description", "price_monthly", "price_yearly", "features", "limits", "sort_order"):
                setattr(existing, col, getattr(p, col))
        else:
            db.add(p)
    db.commit()


@router.get("/plans", response_model=List[PlanOut])
def list_plans(db: Session = Depends(get_db)):
    _seed_plans(db)
    return db.query(Plan).filter(Plan.is_active).order_by(Plan.sort_order).all()


@router.get("/my", response_model=BillingState)
def my_billing(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sub = db.query(Subscription).filter(Subscription.user_id == current_user.id).first()
    payments = db.query(Payment).filter(Payment.user_id == current_user.id).order_by(Payment.paid_at.desc()).limit(10).all()
    plan = None
    sub_out = None
    if sub:
        plan = db.query(Plan).filter(Plan.id == sub.plan_id).first()
        sub_out = SubscriptionOut.model_validate(sub)
        sub_out.plan = PlanOut.model_validate(plan) if plan else None
    return BillingState(
        plan=PlanOut.model_validate(plan) if plan else None,
        subscription=sub_out,
        payments=[PaymentOut.model_validate(p) for p in payments],
    )


@router.post("/subscribe", response_model=SubscribeResponse)
async def subscribe(data: SubscribeRequest, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    if not paypal.enabled:
        raise HTTPException(status_code=400, detail="PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.")

    plan = db.query(Plan).filter(Plan.slug == data.plan_slug, Plan.is_active).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    if plan.price_monthly == 0 and plan.price_yearly == 0:
        raise HTTPException(status_code=400, detail="Cannot subscribe to a free plan")

    paypal_id = plan.paypal_plan_id_yearly if data.interval == "year" else plan.paypal_plan_id
    if not paypal_id:
        raise HTTPException(status_code=400, detail="Plan is not configured for this billing interval yet")

    return_url = f"{settings.APP_URL}/billing?success=true"
    cancel_url = f"{settings.APP_URL}/billing?cancelled=true"

    result = await paypal.create_subscription(
        plan_id=paypal_id,
        return_url=return_url,
        cancel_url=cancel_url,
        user_id=str(current_user.id),
        email=current_user.email,
    )
    if not result or not result.get("approval_url"):
        raise HTTPException(status_code=500, detail="Failed to create PayPal subscription")

    # Cancel any existing pending/active subscriptions first so a user never
    # accumulates multiple rows (User.subscription is a 1:1 uselist=False
    # relationship — duplicate rows make /auth/me crash with MultipleResultsFound).
    db.query(Subscription).filter(
        Subscription.user_id == current_user.id,
        Subscription.status.in_(["pending", "active"]),
    ).update({"status": "cancelled", "cancel_at_period_end": True})
    db.commit()

    sub = Subscription(
        user_id=current_user.id,
        plan_id=plan.id,
        paypal_subscription_id=result["subscription_id"],
        status="pending",
        interval=data.interval,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    return SubscribeResponse(approval_url=result["approval_url"], subscription_id=sub.id)


@router.post("/cancel")
async def cancel_subscription(db: Session = Depends(get_db),
                              current_user: User = Depends(get_current_user)):
    sub = db.query(Subscription).filter(
        Subscription.user_id == current_user.id,
        Subscription.status.in_(["active", "pending"]),
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="No active subscription found")

    if sub.paypal_subscription_id:
        ok = await paypal.cancel_subscription(sub.paypal_subscription_id)
        if not ok:
            raise HTTPException(status_code=500, detail="Failed to cancel PayPal subscription")

    sub.status = "cancelled"
    sub.cancel_at_period_end = True
    db.commit()
    return {"status": "cancelled"}


@router.post("/webhooks/paypal")
async def paypal_webhook(request: Request, db: Session = Depends(get_db)):
    body = await request.body()
    headers = dict(request.headers)
    event_type = headers.get("paypal-transmission-id", "")

    verified = paypal.verify_webhook(body, headers)
    if not verified:
        raise HTTPException(status_code=401, detail="Webhook verification failed")

    try:
        import json
        event = json.loads(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    resource = event.get("resource", {})
    event_type = event.get("event_type", "")

    billing_sub_id = resource.get("id", "")
    if not billing_sub_id:
        billing_sub_id = resource.get("billing_agreement_id", "")

    if event_type == "BILLING.SUBSCRIPTION.ACTIVATED":
        sub = db.query(Subscription).filter(Subscription.paypal_subscription_id == billing_sub_id).first()
        if sub:
            sub.status = "active"
            from datetime import datetime, timezone
            sub.current_period_start = datetime.now(timezone.utc)
            db.commit()

    elif event_type == "BILLING.SUBSCRIPTION.CANCELLED":
        sub = db.query(Subscription).filter(Subscription.paypal_subscription_id == billing_sub_id).first()
        if sub:
            sub.status = "cancelled"
            sub.cancel_at_period_end = True
            db.commit()

    elif event_type == "BILLING.SUBSCRIPTION.SUSPENDED":
        sub = db.query(Subscription).filter(Subscription.paypal_subscription_id == billing_sub_id).first()
        if sub:
            sub.status = "suspended"
            db.commit()

    elif event_type == "BILLING.SUBSCRIPTION.EXPIRED":
        sub = db.query(Subscription).filter(Subscription.paypal_subscription_id == billing_sub_id).first()
        if sub:
            sub.status = "expired"
            db.commit()

    elif event_type == "PAYMENT.SALE.COMPLETED":
        billing_agreement = resource.get("billing_agreement_id", "")
        sub = db.query(Subscription).filter(Subscription.paypal_subscription_id == billing_agreement).first()
        if sub:
            amt = float(resource.get("amount", {}).get("total", 0))
            payment = Payment(
                user_id=sub.user_id,
                subscription_id=sub.id,
                paypal_payment_id=resource.get("id", ""),
                amount=amt,
                currency=resource.get("amount", {}).get("currency", "USD"),
                status="completed",
            )
            db.add(payment)
            db.commit()

    return {"status": "ok"}
