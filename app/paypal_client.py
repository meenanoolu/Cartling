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

    async def get_token(self):
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{self.base}/v1/oauth2/token",
                auth=(self.client_id, self.secret),
                data={"grant_type": "client_credentials"},
            )
            r.raise_for_status()
            self.token = r.json()["access_token"]
            return self.token

    async def create_order(self, amount: str, description: str):
        if not self.token:
            await self.get_token()
        payload = {
            "intent": "CAPTURE",
            "purchase_units": [{
                "amount": {"currency_code": "USD", "value": amount},
                "description": description
            }]
        }
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{self.base}/v2/checkout/orders",
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                json=payload,
            )
            r.raise_for_status()
            return r.json()

    async def get_order(self, order_id: str):
        if not self.token:
            await self.get_token()
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{self.base}/v2/checkout/orders/{order_id}",
                headers={"Authorization": f"Bearer {self.token}"},
            )
            r.raise_for_status()
            return r.json()

    async def refund_capture(self, capture_id: str, amount: str = None):
        if not self.token:
            await self.get_token()
        payload = {}
        if amount:
            payload = {"amount": {"value": amount, "currency_code": "USD"}}
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{self.base}/v2/payments/captures/{capture_id}/refund",
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                json=payload,
            )
            r.raise_for_status()
            return r.json()