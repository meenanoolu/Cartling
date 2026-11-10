# Cartling - Agentic Shopping Concierge

**An AI-powered shopping agent that discovers, compares and checks out with PayPal.**

Cartling is a conversational agentic commerce experience built for the PayPal AI Hackathon 2026. Users describe what they want (and optionally a budget). The agent (powered by Grok) searches real products via Channel3, ranks options, builds a cart, creates a PayPal sandbox order and handles post-purchase actions (status, refunds, tracking) - all in natural language.

## Why This Wins

- **Best Use of Agentic Commerce**: Full agent loop - search → reason → checkout → aftercare.
- **Best Use of PayPal + AI**: Deep integration of PayPal Orders API + Smart Buttons with an LLM agent.
- **Best Use of Channel3**: Real-time multi-store product search and price comparison.
- Complete product experience (not just a chat POC): product cards, cart, PayPal checkout, order history.
- Clear impact: reduces decision fatigue and checkout friction for shoppers.

## Architecture

```
User Chat UI
    ↓
FastAPI + Grok Agent (tool calling)
    ↓
Channel3 Search  ←→  PayPal Orders API (sandbox)
    ↓
Local order store + product cards rendered in UI
```

## Features

- Natural language product search & multi-store comparison (Channel3)
- Budget-aware recommendations with reasoning
- Conversational cart building
- PayPal sandbox order creation + Smart Button checkout
- Order status, refunds and tracking updates
- Chat history persistence
- Polished, responsive UI with product cards

## Setup (5 minutes)

1. **PayPal Sandbox**
   - Create a developer account at https://developer.paypal.com
   - Create a sandbox app → copy Client ID & Secret
   - Create a sandbox buyer account for testing

2. **Keys**
   ```bash
   cp .env.example .env
   # Fill in:
   # PAYPAL_CLIENT_ID=
   # PAYPAL_CLIENT_SECRET=
   # PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
   # XAI_API_KEY=          # from https://console.x.ai
   # CHANNEL3_API_KEY=     # from https://trychannel3.com
   ```

3. **Run**
   ```bash
   pip install -r requirements.txt
   uvicorn app.main:app --reload
   ```
   Open http://localhost:8000

4. **Test flow**
   - "I need noise-cancelling earbuds under $80"
   - Agent shows options
   - "Yes, buy the [product name]"
   - PayPal button appears → approve with sandbox buyer
   - Ask "What's the status of order XYZ?" or "Refund it"

## Demo Video Tips (under 3 min)

1. Problem: Shopping is overwhelming (0:00–0:20)
2. Chat: "Find wireless earbuds under $75" → product cards appear (0:20–1:00)
3. "Buy the top one" → PayPal button → complete sandbox payment (1:00–1:45)
4. Post-purchase: status + refund demo (1:45–2:20)
5. Impact + close (2:20–2:45)

## Tech Stack

- **AI**: Grok-3 (xAI) via OpenAI-compatible API + tool calling
- **Search**: Channel3 API
- **Payments**: PayPal Orders v2 + JS SDK Smart Buttons (sandbox)
- **Backend**: FastAPI + httpx
- **Frontend**: Vanilla HTML/CSS/JS (no build step)

## License

MIT

---

Built for PayPal AI Hackathon 2026. Show the judges a complete, delightful agentic commerce experience.
