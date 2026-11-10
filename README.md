# Cartling

A shopping desk for buying a few things from more than one store without losing the total across tabs. You set a ceiling and, if you care, a day you need it. Cartling keeps the cheap store and the fast store apart, refuses anything over the ceiling, and charges that exact total through PayPal sandbox.

Live site: https://cartling.onrender.com

## What it does

- One thread instead of a pile of product tabs, with older chats kept above the box.
- A ceiling the cart cannot pass. Raising it is a separate step.
- Each line can switch store. The price and the ship window on that line are the ones that get charged.
- A day request asks for a ship-to address first. The day count is the store's handoff time, not a carrier promise.
- Grok may pick a store that is already on the card. It does not set the price.
- If the aisle has no match, Channel3 searches and PayPal charges the returned price.
- Pay, capture, refund, and order status all go through PayPal. A refund drops the item from what you own.

## PayPal

Orders v2 on `https://api-m.sandbox.paypal.com`. The calls live in [app/paypal_client.py](app/paypal_client.py) and [app/main.py](app/main.py).

- `POST /api/checkout` prices the cart on the server and creates an order for that item total, with the ship-to address (`SET_PROVIDED_ADDRESS`).
- The buyer approves it with a PayPal sandbox personal account, not a real login.
- `POST /api/orders/{id}/capture` captures the order.
- `POST /api/orders/{id}/refund` refunds the capture.
- `GET /api/orders/{id}` reads the live status, such as `COMPLETED` or `REFUNDED`.

The browser never sends a price.

## Grok

[app/desk_data.py](app/desk_data.py) calls the xAI API with the allowed stores and no others. The reply has to name one of those stores. The price on screen stays the catalog price. If Grok does not answer, the desk still picks the cheaper or faster store from the same rules.

## Channel3

[app/catalog.py](app/catalog.py) calls `POST https://api.trychannel3.com/v1/search` only when the local aisle has nothing that matches. The price on the card is the price that gets charged.

## Try it

1. Set a ceiling.
2. Ask for noise-cancelling earbuds under 80, or a cable in 3 days. A day ask opens the address form first.
3. The steps under the reply show the catalog check, the store that was kept, and any ceiling refusal.
4. Add it. The cart will not go over the ceiling.
5. Pay with a PayPal sandbox buyer. The receipt id is the PayPal order id.
6. Ask where the order is.
7. Refund. The money goes back through PayPal.
8. Ask for a mechanical keyboard under 120 to see a Channel3 search.

## Keys

On Render, set these. Locally, copy `.env.example` to `.env`.

- `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from a PayPal sandbox app
- `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`
- `XAI_API_KEY` from https://console.x.ai
- `CHANNEL3_API_KEY` from https://trychannel3.com

Aisle prices come from `data/desk_catalog.json`.

## Run

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000
