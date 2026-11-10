from typing import Optional, Tuple, Union
import hashlib
import json
import os
import re
from pathlib import Path

import httpx

from app.catalog import search_and_compare

ROOT = Path(__file__).parent.parent
CATALOG_PATH = ROOT / "data" / "desk_catalog.json"
_WEB: dict[str, dict] = {}


def load_catalog() -> list[dict]:
    with open(CATALOG_PATH) as handle:
        return json.load(handle)


def _product(product_id: str) -> Optional[dict]:
    for product in load_catalog():
        if product["id"] == product_id:
            return product
    return None


def _offer(product: dict, store: Optional[str]) -> dict:
    offers = product["offers"]
    if store:
        for offer in offers:
            if offer["store"].lower() == store.lower():
                return offer
    return sorted(offers, key=lambda row: (row["price"], row["days"]))[0]


def cents(value: float) -> int:
    return int(round(float(value) * 100))


def money(cents_value: int) -> str:
    return f"{cents_value / 100:.2f}"


def price_cart(lines: list, budget: float) -> Union[Tuple[list, int], str]:
    if not lines:
        return "The cart is empty"
    if len(lines) > 12:
        return "That cart is too long"
    priced: list[dict] = []
    total = 0
    for line in lines:
        product = _product(str(line.get("productId") or ""))
        if not product:
            return "That item is not in the aisle"
        qty = int(line.get("qty") or 0)
        if qty < 1 or qty > 5:
            return "Quantity has to be from 1 to 5"
        offer = _offer(product, line.get("store"))
        unit = cents(offer["price"])
        total += unit * qty
        priced.append(
            {
                "productId": product["id"],
                "name": product["name"],
                "qty": qty,
                "store": offer["store"],
                "price": unit / 100,
                "ships": offer["ships"],
            }
        )
    if total > cents(budget) + 0:
        return "That total is over the ceiling"
    return priced, total


def remember_web(hits: list[dict]) -> list[dict]:
    stored: list[dict] = []
    for hit in hits:
        price = hit.get("best_price")
        if price is None:
            continue
        name = str(hit.get("name") or "Offer")[:120]
        store = str(hit.get("best_store") or "Store")[:60]
        key = hashlib.sha1(f"{name}|{store}|{price}".encode()).hexdigest()[:12]
        row = {
            "id": f"web-{key}",
            "name": name,
            "price": float(price),
            "store": store,
            "image": hit.get("image") or "",
            "blurb": str(hit.get("description") or "Live offer from Channel3.")[:180],
        }
        _WEB[row["id"]] = row
        stored.append(row)
    return stored


def web_hit(web_id: str) -> Optional[dict]:
    return _WEB.get(web_id)


async def channel3_search(query: str, max_price: float) -> dict:
    if not os.getenv("CHANNEL3_API_KEY"):
        return {"ok": False, "error": "CHANNEL3_API_KEY is not set on the server", "results": []}
    try:
        found = await search_and_compare(query, max_price)
    except httpx.HTTPError:
        return {"ok": False, "error": "Channel3 did not answer", "results": []}
    if found.get("error"):
        return {"ok": False, "error": str(found["error"]), "results": []}
    results = remember_web(found.get("results") or [])
    if not results:
        return {"ok": False, "error": "Channel3 had nothing under that ceiling", "results": []}
    return {"ok": True, "results": results}


def _clean_because(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if not cleaned or "$" in cleaned or "€" in cleaned or "£" in cleaned:
        return "It is the store that fits the ceiling and the day you named."
    return cleaned[:180]


async def advise(product_id: str, brief: str, ask: str) -> dict:
    key = os.getenv("XAI_API_KEY")
    product = _product(product_id)
    if not key:
        return {"ok": False, "error": "XAI_API_KEY is not set on the server"}
    if not product:
        return {"ok": False, "error": "Unknown item"}
    allowed = [
        {"store": offer["store"], "days": offer["days"], "ships": offer["ships"], "price": offer["price"]}
        for offer in product["offers"]
    ]
    prompt = {
        "ask": ask[:400],
        "desk_note": brief[:800],
        "stores": [{"store": row["store"], "days": row["days"]} for row in allowed],
        "reply_with": {"store": "one store name from stores", "because": "one sentence, no prices"},
    }
    messages = [
        {
            "role": "system",
            "content": (
                "You choose one allowed store for Cartling. "
                "Reply with JSON only. Do not invent a store. Do not include a price."
            ),
        },
        {"role": "user", "content": json.dumps(prompt)},
    ]
    choice = None
    async with httpx.AsyncClient(timeout=30) as client:
        for model in ("grok-4", "grok-3", "grok-2-latest"):
            response = await client.post(
                "https://api.x.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"model": model, "temperature": 0, "max_tokens": 120, "messages": messages},
            )
            if response.status_code >= 400:
                continue
            content = response.json().get("choices", [{}])[0].get("message", {}).get("content", "")
            match = re.search(r"\{.*\}", content, re.S)
            if not match:
                continue
            try:
                choice = json.loads(match.group(0))
            except json.JSONDecodeError:
                continue
            break
    if not isinstance(choice, dict):
        return {"ok": False, "error": "Grok did not answer"}
    wanted = str(choice.get("store") or "")
    offer = next((row for row in allowed if row["store"].lower() == wanted.lower()), None)
    if not offer:
        offer = sorted(allowed, key=lambda row: (row["price"], row["days"]))[0]
    because = _clean_because(str(choice.get("because") or ""))
    text = f"Grok chose {offer['store']} at ${offer['price']:.2f}, {offer['ships']}. {because}"
    return {"ok": True, "text": text, "store": offer["store"]}
