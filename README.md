# Cartling

Cartling is a shopping desk. You name a thing, a ceiling, and a day. It keeps the cheap store and the fast store apart, refuses anything over the ceiling, and charges that exact total through PayPal sandbox.

The model can pick a store. It cannot set a price. The tools take a product and a store, or a Channel3 id. They have no price field. A dollar amount that is not already on a row is dropped, and PayPal is not opened.

The aisle is a priced catalog. BudgetBuy, GadgetHub, and TechStore are sample stores, and the photos are samples. The server owns those prices. When the item is not in the aisle, Channel3 returns live merchants, and PayPal charges the price on that row.

If you name a brand or a model, even in the same sentence as earbuds, that search goes to Channel3. The sample aisle is only the generic item, such as earbuds and a cable before Friday. A live row does not keep the handoff day, so the Friday choice stays on the aisle.

Live demo: https://cartling.onrender.com

Demo video: https://www.youtube.com/watch?v=4415FV9gPHY

## What to try

1. Set a ceiling.
2. Ask for noise-cancelling earbuds under 80, or a cable in 3 days.
3. Grok picks one store from the card. It cannot type the price.
4. Add it. The cart will not go over the ceiling.
5. Pay with PayPal and approve as a sandbox buyer. The receipt id is the PayPal order id.
6. Refund. PayPal sends the money back and the desk forgets you owned it.
7. Ask for something outside the aisle, such as a mechanical keyboard under 120. Channel3 returns live offers and PayPal charges that price.

## Keys

On Render, set these environment variables. Locally, copy `.env.example` to `.env`.

- `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from a PayPal sandbox app
- `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`
- `XAI_API_KEY` from https://console.x.ai
- `CHANNEL3_API_KEY` from https://trychannel3.com
- `PAYPAL_WEBHOOK_ID` if you want PayPal to sign the webhook. The live URL is `https://cartling.onrender.com/api/paypal/webhook`

The header shows when PayPal, Grok and Channel3 are connected. Prices are computed on the server from `data/desk_catalog.json`. The browser cannot change them. After a payment, the order shows the amount PayPal captured. If that amount is not the desk total, the order says so. The webhook asks PayPal for the order before it changes a status. It does not trust the amount in the webhook body.

## Run

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000

## Stack

- Rules for the ceiling, ship days and sets live in the desk. The model can choose a store and cannot choose a price
- Grok, through the xAI API, chooses the store and writes one sentence
- Channel3 searches when the aisle does not have the thing
- PayPal Orders v2 sandbox creates the order, the buyer approves it, then Cartling captures and can refund
- The live site is the Render service for this repo
