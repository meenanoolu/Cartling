import os

import httpx
from dotenv import load_dotenv

load_dotenv()


class PayPalClient:
    def __init__(self):
        self.base = os.getenv("PAYPAL_BASE_URL")
        self.client_id = os.getenv("PAYPAL_CLIENT_ID")
        self.secret = os.getenv("PAYPAL_CLIENT_SECRET")
        self.token = None

    def ready(self) -> bool:
        return bool(self.base and self.client_id and self.secret)

    async def get_token(self):
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base}/v1/oauth2/token",
                auth=(self.client_id, self.secret),
                data={"grant_type": "client_credentials"},
            )
            response.raise_for_status()
            self.token = response.json()["access_token"]
            return self.token

    async def create_order(self, amount: str, description: str):
        if not self.token:
            await self.get_token()
        payload = {
            "intent": "CAPTURE",
            "purchase_units": [
                {
                    "amount": {"currency_code": "USD", "value": amount},
                    "description": description,
                }
            ],
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base}/v2/checkout/orders",
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    async def create_checkout(self, amount: str, description: str, items: list, return_url: str, cancel_url: str, shipping=None):
        await self.get_token()
        purchase = {
            "description": description[:120],
            "amount": {
                "currency_code": "USD",
                "value": amount,
                "breakdown": {"item_total": {"currency_code": "USD", "value": amount}},
            },
            "items": items,
        }
        preference = "NO_SHIPPING"
        if shipping:
            purchase["shipping"] = shipping
            preference = "SET_PROVIDED_ADDRESS"
        payload = {
            "intent": "CAPTURE",
            "purchase_units": [purchase],
            "application_context": {
                "brand_name": "Cartling",
                "shipping_preference": preference,
                "user_action": "PAY_NOW",
                "return_url": return_url,
                "cancel_url": cancel_url,
            },
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base}/v2/checkout/orders",
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    async def get_order(self, order_id: str):
        if not self.token:
            await self.get_token()
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{self.base}/v2/checkout/orders/{order_id}",
                headers={"Authorization": f"Bearer {self.token}"},
            )
            response.raise_for_status()
            return response.json()

    async def refund_capture(self, capture_id: str, amount: str = None):
        if not self.token:
            await self.get_token()
        payload = {}
        if amount:
            payload = {"amount": {"value": amount, "currency_code": "USD"}}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base}/v2/payments/captures/{capture_id}/refund",
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    async def capture_order(self, order_id: str):
        await self.get_token()
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base}/v2/checkout/orders/{order_id}/capture",
                headers={
                    "Authorization": f"Bearer {self.token}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation",
                },
            )
            response.raise_for_status()
            return response.json()

    async def verify_webhook(self, headers: dict, event: dict) -> bool:
        webhook_id = os.getenv("PAYPAL_WEBHOOK_ID")
        if not webhook_id:
            return True
        await self.get_token()
        payload = {
            "auth_algo": headers.get("paypal-auth-algo"),
            "cert_url": headers.get("paypal-cert-url"),
            "transmission_id": headers.get("paypal-transmission-id"),
            "transmission_sig": headers.get("paypal-transmission-sig"),
            "transmission_time": headers.get("paypal-transmission-time"),
            "webhook_id": webhook_id,
            "webhook_event": event,
        }
        if not payload["transmission_id"] or not payload["transmission_sig"]:
            return False
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base}/v1/notifications/verify-webhook-signature",
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                json=payload,
            )
            if response.status_code >= 400:
                return False
            return (response.json() or {}).get("verification_status") == "SUCCESS"
