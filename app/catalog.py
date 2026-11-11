import os
import httpx
from dotenv import load_dotenv

load_dotenv()

CHANNEL3_KEY = os.getenv("CHANNEL3_API_KEY")
CHANNEL3_URL = "https://api.trychannel3.com/v1/search"


def _amount(value):
    if isinstance(value, dict):
        value = value.get("price", value.get("value", value.get("amount")))
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    return number


def _store(offer: dict) -> str:
    raw = offer.get("merchant") or offer.get("retailer") or offer.get("seller") or offer.get("domain") or "Store"
    text = str(raw).replace("www.", "").strip()
    return text[:60] or "Store"


def _features(product: dict) -> list:
    raw = product.get("features") or product.get("key_features") or product.get("highlights") or []
    if isinstance(raw, str):
        raw = [part.strip() for part in raw.split("\n") if part.strip()]
    if not isinstance(raw, list):
        return []
    found = []
    for item in raw:
        if isinstance(item, dict):
            item = item.get("text") or item.get("name") or item.get("value")
        text = str(item or "").strip()
        if text:
            found.append(text[:180])
    return found[:6]


def _image(product: dict):
    raw = product.get("image")
    images = product.get("images") or []
    if not raw and images:
        raw = images[0]
    if isinstance(raw, dict):
        raw = raw.get("url") or raw.get("src") or raw.get("image")
    return raw if isinstance(raw, str) else ""


async def search_and_compare(query: str, max_price: float) -> dict:
    if not CHANNEL3_KEY:
        return {"error": "CHANNEL3_API_KEY not set", "results": []}

    payload = {
        "query": query,
        "filters": {"price": {"max_price": max_price}},
        "limit": 8,
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                CHANNEL3_URL,
                headers={"x-api-key": CHANNEL3_KEY, "Content-Type": "application/json"},
                json=payload,
                timeout=30.0,
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError:
        return {"error": "Channel3 did not answer", "results": []}
    except ValueError:
        return {"error": "Channel3 sent a response that was not readable", "results": []}

    products = data.get("products", []) if isinstance(data, dict) else []
    results = []
    for product in products:
        if not isinstance(product, dict):
            continue
        priced = []
        for offer in product.get("offers") or []:
            if not isinstance(offer, dict):
                continue
            amount = _amount(offer.get("price"))
            if amount is None or amount > float(max_price) + 0.001:
                continue
            priced.append((amount, offer))
        if not priced:
            continue
        by_store = {}
        for amount, offer in priced:
            store = _store(offer)
            kept = by_store.get(store)
            if kept is None or amount < kept[0]:
                by_store[store] = (amount, offer)
        offers = [
            {"store": store, "price": round(amount, 2)}
            for store, (amount, _offer) in sorted(by_store.items(), key=lambda item: item[1][0])
        ][:4]
        cheapest = offers[0]
        results.append(
            {
                "id": product.get("id") or str(product.get("title") or "")[:40],
                "name": product.get("title") or "Unknown",
                "description": str(product.get("description") or "")[:800],
                "features": _features(product),
                "offers": offers,
                "best_price": cheapest["price"],
                "best_store": cheapest["store"],
                "image": _image(product),
                "buy_url": "",
            }
        )

    return {"results": results, "query": query, "max_price": max_price}


def build_cart(item_ids: list, budget: float) -> dict:
    return {"items": [], "total": 0, "budget": budget, "within_budget": True, "note": "Use search results directly"}
