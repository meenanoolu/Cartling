import asyncio
from app.paypal_client import PayPalClient

async def main():
    client = PayPalClient()
    order = await client.create_order("19.99", "Cartling test order")
    print(order)

asyncio.run(main())