# PayPal Setup Guide for HexaLLM AI

## 1. Create a PayPal Business Account

Go to https://www.paypal.com/business and sign up if you don't have one.

## 2. Create a REST API App (for sandbox testing)

1. Go to https://developer.paypal.com/dashboard
2. Click **Log in to Dashboard** and sign in with your PayPal business account
3. In the left nav, go to **Apps & Credentials**
4. Under **REST API apps**, click **Create App**
5. Name it `HexaLLM AI` and click **Create App**
6. You'll see **Client ID** and **Secret** — copy both

## 3. Set environment variables

On your server, edit the `.env` file:

```bash
# /home/ubuntu/hexallm/.env
# ... existing vars ...

PAYPAL_CLIENT_ID=your_client_id_here
PAYPAL_CLIENT_SECRET=your_secret_here
PAYPAL_WEBHOOK_ID=           # leave blank for now, we'll set it later
PAYPAL_SANDBOX=true          # keep true until you're ready for live payments
```

Restart the backend:

```bash
docker restart backend
```

## 4. Create PayPal products and billing plans

Run this one-time setup script to register the Pro plan in PayPal:

```bash
docker exec -it backend python -c "
import asyncio
from app.services.paypal_service import paypal
from app.core.database import SessionLocal
from app.models.billing import Plan

async def setup():
    db = SessionLocal()
    plan = db.query(Plan).filter(Plan.slug == 'pro').first()
    if not plan:
        print('Pro plan not found — run the app first so plans are seeded')
        return
    
    # Create the product in PayPal
    product_id = await paypal.create_product('HexaLLM AI Pro', 'Unlimited access to HexaLLM AI')
    if not product_id:
        print('Product already exists — fetching existing plan')
        plans = await paypal.list_plans('')
        print('Existing plans:', plans)
        return
    
    print(f'Product created: {product_id}')
    
    # Create monthly billing plan
    monthly_plan_id = await paypal.create_plan(
        product_id=product_id,
        name='HexaLLM AI Pro Monthly',
        description='Monthly subscription to HexaLLM AI Pro',
        price=12.00,
        interval='MONTH',
    )
    print(f'Monthly plan: {monthly_plan_id}')
    
    # Create yearly billing plan
    yearly_plan_id = await paypal.create_plan(
        product_id=product_id,
        name='HexaLLM AI Pro Yearly',
        description='Yearly subscription to HexaLLM AI Pro',
        price=120.00,
        interval='YEAR',
    )
    print(f'Yearly plan: {yearly_plan_id}')
    
    if monthly_plan_id:
        plan.paypal_plan_id = monthly_plan_id
        db.commit()
        print('Saved plan IDs to database')
    
    db.close()

asyncio.run(setup())
"
```

This only needs to be done once. It creates the PayPal billing plan and saves its ID.

## 5. Set up the webhook

1. Go to https://developer.paypal.com/dashboard/applications
2. Select your app
3. Click **Add Webhook**
4. **Webhook URL**: `https://ai.hexallm.co.uk/api/v1/billing/webhooks/paypal`
5. **Event types**: Select:
   - `BILLING.SUBSCRIPTION.ACTIVATED`
   - `BILLING.SUBSCRIPTION.CANCELLED`
   - `BILLING.SUBSCRIPTION.SUSPENDED`
   - `BILLING.SUBSCRIPTION.EXPIRED`
   - `PAYMENT.SALE.COMPLETED`
6. Click **Save**
7. Copy the **Webhook ID** and add it to your `.env` file:

```bash
PAYPAL_WEBHOOK_ID=your_webhook_id_here
```

8. Restart backend again:

```bash
docker restart backend
```

## 6. Test the flow

1. Visit https://ai.hexallm.co.uk/pricing
2. Click **Subscribe with PayPal** on the Pro plan
3. You'll be redirected to PayPal Sandbox
4. Log in with a **sandbox test buyer account** (create one at https://developer.paypal.com/dashboard/accounts)
5. Approve the subscription
6. You'll be redirected back to your site

## 7. Go Live

When you're ready to accept real payments:

1. Create a **Live** REST API app in the PayPal Developer Dashboard
2. Update your `.env`:
   ```
   PAYPAL_CLIENT_ID=live_client_id
   PAYPAL_CLIENT_SECRET=live_secret
   PAYPAL_WEBHOOK_ID=live_webhook_id
   PAYPAL_SANDBOX=false
   ```
3. Create a new product and billing plan (repeat step 4) — PayPal requires separate plans for sandbox vs live
4. Set up a webhook for the live app (repeat step 5)
5. Restart the backend
