import base64
import zlib
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List
import httpx
from ..core.config import settings


class PayPalService:
    def __init__(self):
        self.client_id = settings.PAYPAL_CLIENT_ID
        self.client_secret = settings.PAYPAL_CLIENT_SECRET
        self.webhook_id = settings.PAYPAL_WEBHOOK_ID
        base = "https://api-m.sandbox.paypal.com" if settings.PAYPAL_SANDBOX else "https://api-m.paypal.com"
        self.base_url = base
        self._token: Optional[str] = None
        self._token_expires: Optional[datetime] = None
        self._certs: Dict[str, str] = {}  # paypal-cert-url -> PEM cert (cached)

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret)

    async def _get_token(self) -> str:
        if self._token and self._token_expires and datetime.now(timezone.utc) < self._token_expires:
            return self._token
        auth = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode()).decode()
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/v1/oauth2/token",
                headers={"Authorization": f"Basic {auth}"},
                data={"grant_type": "client_credentials"},
            )
            resp.raise_for_status()
            data = resp.json()
            self._token = data["access_token"]
            expires_in = data.get("expires_in", 32400)
            self._token_expires = datetime.now(timezone.utc).replace(second=0) + timedelta(seconds=expires_in - 60)
            return self._token

    async def _headers(self) -> Dict[str, str]:
        token = await self._get_token()
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    async def create_product(self, name: str, description: str) -> Optional[str]:
        """Create a PayPal product. Returns the product ID."""
        headers = await self._headers()
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/v1/catalogs/products",
                headers=headers,
                json={
                    "name": name,
                    "description": description,
                    "type": "SERVICE",
                    "category": "SOFTWARE",
                },
            )
            if resp.status_code == 201:
                return resp.json()["id"]
            if resp.status_code == 409:
                return None
            resp.raise_for_status()
            return None

    async def create_plan(self, product_id: str, name: str, description: str,
                          price: float, currency: str = "USD", interval: str = "MONTH") -> Optional[str]:
        """Create a PayPal billing plan. Returns the plan ID."""
        headers = await self._headers()
        payload = {
            "product_id": product_id,
            "name": name,
            "description": description,
            "billing_cycles": [
                {
                    "frequency": {"interval_unit": interval, "interval_count": 1},
                    "tenure_type": "REGULAR",
                    "sequence": 1,
                    "total_cycles": 0,
                    "pricing_scheme": {
                        "fixed_price": {"value": f"{price:.2f}", "currency_code": currency},
                    },
                }
            ],
            "payment_preferences": {
                "auto_bill_outstanding": True,
                "setup_fee": {"value": "0.00", "currency_code": currency},
                "setup_fee_failure_action": "CONTINUE",
                "payment_failure_threshold": 3,
            },
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/v1/billing/plans",
                headers=headers,
                json=payload,
            )
            if resp.status_code == 201:
                return resp.json()["id"]
            resp.raise_for_status()
            return None

    async def create_subscription(self, plan_id: str, return_url: str, cancel_url: str,
                                  user_id: str, email: str) -> Optional[Dict[str, Any]]:
        """Create a PayPal subscription. Returns approval URL data."""
        headers = await self._headers()
        payload = {
            "plan_id": plan_id,
            "application_context": {
                "brand_name": "HexaLLM AI",
                "locale": "en-US",
                "shipping_preference": "NO_SHIPPING",
                "user_action": "SUBSCRIBE_NOW",
                "payment_method": {"payer_selected": "PAYPAL", "payee_preferred": "IMMEDIATE_PAYMENT_REQUIRED"},
                "return_url": return_url,
                "cancel_url": cancel_url,
            },
            "subscriber": {
                "name": {"given_name": user_id},
                "email_address": email,
            },
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/v1/billing/subscriptions",
                headers=headers,
                json=payload,
            )
            if resp.status_code == 201:
                data = resp.json()
                links = {l["rel"]: l["href"] for l in data.get("links", [])}
                return {
                    "subscription_id": data["id"],
                    "approval_url": links.get("approve"),
                    "status": data["status"],
                }
            resp.raise_for_status()
            return None

    async def get_subscription(self, subscription_id: str) -> Optional[Dict[str, Any]]:
        headers = await self._headers()
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}/v1/billing/subscriptions/{subscription_id}",
                headers=headers,
            )
            if resp.status_code == 200:
                return resp.json()
            return None

    async def cancel_subscription(self, subscription_id: str, reason: str = "Cancelled by user") -> bool:
        headers = await self._headers()
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/v1/billing/subscriptions/{subscription_id}/cancel",
                headers=headers,
                json={"reason": reason},
            )
            return resp.status_code == 204

    async def suspend_subscription(self, subscription_id: str, reason: str = "Suspended") -> bool:
        headers = await self._headers()
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/v1/billing/subscriptions/{subscription_id}/suspend",
                headers=headers,
                json={"reason": reason},
            )
            return resp.status_code == 204

    async def activate_subscription(self, subscription_id: str, reason: str = "Reactivated") -> bool:
        headers = await self._headers()
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.base_url}/v1/billing/subscriptions/{subscription_id}/activate",
                headers=headers,
                json={"reason": reason},
            )
            return resp.status_code == 204

    def verify_webhook(self, body: bytes, headers: Dict[str, str]) -> bool:
        """Verify a PayPal webhook transmission.

        PayPal signs with RSA-SHA256 using the public certificate at
        paypal-cert-url, over the string:
            transmission_id|transmission_time|webhook_id|crc32(body)
        The signature is base64-encoded in the paypal-transmission-sig header.
        The cert is cached per URL for the lifetime of the process.
        """
        transmission_id = headers.get("paypal-transmission-id", "")
        transmission_time = headers.get("paypal-transmission-time", "")
        cert_url = headers.get("paypal-cert-url", "")
        actual_sig = headers.get("paypal-transmission-sig", "")
        webhook_id = self.webhook_id

        if not all([transmission_id, transmission_time, cert_url, actual_sig, webhook_id]):
            return False

        cert_pem = self._certs.get(cert_url)
        if not cert_pem:
            try:
                resp = httpx.get(cert_url, timeout=10)
                resp.raise_for_status()
                cert_pem = resp.text
            except Exception:
                return False
            self._certs[cert_url] = cert_pem

        from cryptography import x509
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding, rsa
        from cryptography.exceptions import InvalidSignature
        try:
            cert = x509.load_pem_x509_certificate(cert_pem.encode())
            public_key = cert.public_key()
            if not isinstance(public_key, rsa.RSAPublicKey):
                return False
            crc = zlib.crc32(body)
            signed_parts = f"{transmission_id}|{transmission_time}|{webhook_id}|{crc}"
            public_key.verify(
                base64.b64decode(actual_sig),
                signed_parts.encode(),
                padding.PKCS1v15(),
                hashes.SHA256(),
            )
            return True
        except (InvalidSignature, Exception):
            return False

    async def list_plans(self, product_id: str) -> List[Dict]:
        headers = await self._headers()
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}/v1/billing/plans?product_id={product_id}&page_size=20&total_required=true",
                headers=headers,
            )
            if resp.status_code == 200:
                return resp.json().get("plans", [])
            return []


paypal = PayPalService()
