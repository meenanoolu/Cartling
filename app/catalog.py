import os
import httpx
from dotenv import load_dotenv

load_dotenv()

CHANNEL3_KEY = os.getenv("CHANNEL3_API_KEY")
CHANNEL3_URL = "https://api.trychannel3.com/v1/search"

async def search_and_compare(query: str, max_price: float) -> dict:
    if not CHANNEL3_KEY:
        return {"error": "CHANNEL3_API_KEY not set", "results": []}

    payload = {
        "query": query,
        "filters": {
            "price": {"max_price": max_price}
        },
        "limit": 8
    }

    async with httpx.AsyncClient() as client:
        r = await client.post(
            CHANNEL3_URL,
            headers={
                "x-api-key": CHANNEL3_KEY,
                "Content-Type": "application/json"
            },
            json=payload,
            timeout=30.0
        )
        r.raise_for_status()
        data = r.json()

    results = []
    for p in data.get("products", []):
        offers = p.get("offers", [])
        if not offers:
            continue
        best = min(offers, key=lambda o: o.get("price", 999999))
        results.append({
            "id": p.get("id") or p.get("title", "")[:40],
            "name": p.get("title", "Unknown"),
            "description": p.get("description", "")[:200],
            "best_price": best.get("price"),
            "best_store": best.get("merchant") or best.get("retailer") or "Unknown",
            "all_stores": [
                {"store": o.get("merchant") or o.get("retailer"), "price": o.get("price")}
                for o in offers[:5]
            ],
            "image": p.get("image") or (p.get("images") or [None])[0],
            "buy_url": best.get("url")
        })

    return {"results": results, "query": query, "max_price": max_price}


def build_cart(item_ids: list, budget: float) -> dict:
    # Kept for compatibility; Channel3 flow mainly uses search results
    return {"items": [], "total": 0, "budget": budget, "within_budget": True, "note": "Use search results directly"}