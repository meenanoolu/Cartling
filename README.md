# Cartling

Someone buying a few things from more than one store, with a hard ceiling and a day they need it, currently loses the total across tabs. Cartling keeps that in one desk. The server prices every line. PayPal is refused when the cart is over the ceiling.

Live site: https://cartling.onrender.com

Code: this repository. PayPal calls are in [app/paypal_client.py](app/paypal_client.py) and [app/main.py](app/main.py).

## What it will not do

Grok cannot invent a price or a delivery date. It may only pick a store that is already on the card. The day count is that store's ship window, not a carrier promise. Channel3 is asked only when the aisle has no match, and PayPal charges the price Channel3 returned.

## PayPal

PayPal Orders v2 sandbox, through `https://api-m.sandbox.paypal.com`.

- `POST /api/checkout` prices the cart on the server, then creates an order with that exact item total and the ship-to address (`SET_PROVIDED_ADDRESS`).
- The buyer approves it as a sandbox personal account, not a real PayPal login.
- `POST /api/orders/{id}/capture` captures the order.
- `POST /api/orders/{id}/refund` refunds the capture. The desk then forgets the item.
- `GET /api/orders/{id}` reads the live PayPal status (`COMPLETED`, `REFUNDED`, or whatever PayPal returns).

The browser never sends a price.

## Grok

Grok is called through the xAI API from [app/desk_data.py](app/desk_data.py). The prompt lists the allowed stores and no others. The reply must name one of those stores. The sentence on screen keeps the catalog price. If Grok does not answer, the desk still shows the cheaper or faster store from the rules.

## Channel3

[app/catalog.py](app/catalog.py) calls `POST https://api.trychannel3.com/v1/search` when nothing in the local aisle matches. The offer price on the card is the price PayPal charges.

## What to try

1. Set a ceiling.
2. Ask for noise-cancelling earbuds under 80, or a cable in 3 days. A day ask opens the address form first.
3. Read the steps under the reply. They name the catalog check, the store Grok kept, and any ceiling refusal.
4. Add it. The cart will not go over the ceiling.
5. Pay with a PayPal sandbox buyer. The receipt id is the PayPal order id.
6. Ask where the order is. The status comes back from PayPal.
7. Refund. PayPal sends the money back.
8. Ask for a mechanical keyboard under 120. Channel3 returns live offers.

## Keys

On Render, set these. Locally, copy `.env.example` to `.env`.

- `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from a PayPal sandbox app
- `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`
- `XAI_API_KEY` from https://console.x.ai
- `CHANNEL3_API_KEY` from https://trychannel3.com

Prices for the aisle come from `data/desk_catalog.json`.

## Run

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000

The live site is the Render service for this repo.

## Where this fits

This is aimed at the top places, Best Use of PayPal + AI, Best Use of Agentic Commerce, and Best Use of Channel3. It does not use a data grid or an API portal.

## Devpost text

Cartling is for someone buying a few things from more than one store, with a hard ceiling and a day they need it. The total usually slips away across tabs.

The desk keeps the cheap store and the fast store apart. The Python server prices every line from the catalog, or from Channel3 when the aisle has no match. Grok, through the xAI API, may only pick a store that is already allowed. It cannot invent a price or a delivery date. A day count is the store's ship window.

PayPal Orders v2 sandbox creates the order at that exact total, with the ship-to address. The buyer approves it with a sandbox account. Cartling captures the order, can refund the capture, and reads the live status back from PayPal. If the cart is over the ceiling, PayPal is not opened.

Try it at https://cartling.onrender.com. Source: https://github.com/meenanoolu/Cartling
