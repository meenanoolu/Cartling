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
        name = str(hit.get("name") or "Offer")[:120]
        image = hit.get("image") or ""
        blurb = str(hit.get("description") or "Live offer from Channel3.")[:800]
        features = [str(item)[:180] for item in hit.get("features") or [] if str(item).strip()][:6]
        raw_offers = hit.get("offers") if isinstance(hit.get("offers"), list) else []
        if not raw_offers and hit.get("best_price") is not None:
            raw_offers = [{"store": hit.get("best_store") or "Store", "price": hit.get("best_price")}]
        saved = []
        for raw in raw_offers:
            if not isinstance(raw, dict):
                continue
            try:
                price = float(raw.get("price"))
            except (TypeError, ValueError):
                continue
            if price <= 0:
                continue
            store = str(raw.get("store") or "Store")[:60]
            key = hashlib.sha1(f"{name}|{store}|{price}".encode()).hexdigest()[:12]
            row = {
                "id": f"web-{key}",
                "name": name,
                "price": price,
                "store": store,
                "image": image,
                "blurb": blurb,
            }
            _WEB[row["id"]] = row
            saved.append({"id": row["id"], "store": store, "price": price})
        if not saved:
            continue
        by_store: dict[str, dict] = {}
        for offer in saved:
            kept = by_store.get(offer["store"])
            if kept is None or offer["price"] < kept["price"]:
                by_store[offer["store"]] = offer
        saved = sorted(by_store.values(), key=lambda item: item["price"])
        first = saved[0]
        stored.append(
            {
                "id": first["id"],
                "name": name,
                "price": first["price"],
                "store": first["store"],
                "image": image,
                "blurb": blurb,
                "features": features,
                "offers": saved,
            }
        )
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


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "check_catalog",
            "description": "Look up the local aisle. Returns product ids, stores, server prices, and ship windows. Never invent a price.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_channel3",
            "description": "Search Channel3 only when check_catalog returned no products. Returns every merchant under the ceiling. Use the web_id values exactly.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_paypal_order",
            "description": "Propose a PayPal order. This does not charge and does not open PayPal. Pass product_id and store from check_catalog, or web_id from ask_channel3. Never pass a price.",
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {"type": "string"},
                    "store": {"type": "string"},
                    "web_id": {"type": "string"},
                },
            },
        },
    },
]


def _day_limit(text: str) -> Optional[int]:
    lowered = text.lower()
    counted = re.search(r"\b(?:in|within)\s+(\d+)\s+days?\b", lowered)
    if counted:
        return int(counted.group(1))
    if re.search(r"\b(tomorrow|overnight)\b", lowered):
        return 1
    if re.search(r"\b(asap|rush)\b", lowered):
        return 2
    return None


def _named_ceiling(text: str, budget: float) -> float:
    match = re.search(r"\b(?:under|below|less than|max(?:imum)?)\s+\$?(\d+(?:\.\d{1,2})?)", text.lower())
    ceiling = float(budget)
    if match:
        ceiling = min(ceiling, float(match.group(1)))
    return min(2000, max(1, ceiling))


def _check_catalog(query: str, ceiling: float, day_limit: Optional[int]) -> dict:
    words = [word for word in re.findall(r"[a-z0-9]+", query.lower()) if len(word) > 2]
    stop = {"under", "below", "days", "with", "from", "that", "this", "need", "want", "please", "open", "paypal"}
    words = [word for word in words if word not in stop]
    found = []
    for product in load_catalog():
        blob = f"{product['id']} {product['name']}".lower()
        if words and not any(word in blob for word in words):
            continue
        offers = []
        for offer in product["offers"]:
            if float(offer["price"]) > ceiling + 0.001:
                continue
            if day_limit is not None and int(offer["days"]) > day_limit:
                continue
            offers.append(
                {
                    "store": offer["store"],
                    "price": offer["price"],
                    "ships": offer["ships"],
                    "days": offer["days"],
                }
            )
        if not offers:
            continue
        found.append({"product_id": product["id"], "name": product["name"], "offers": offers})
    return {"products": found[:6]}


def _stage_order(args: dict, ceiling: float, day_limit: Optional[int]) -> dict:
    web_id = str(args.get("web_id") or "").strip()
    if web_id:
        hit = web_hit(web_id)
        if not hit:
            return {"error": "That Channel3 offer is not available. Call ask_channel3 again."}
        if cents(hit["price"]) > cents(ceiling):
            return {"error": "That offer is over the ceiling. PayPal was not proposed."}
        return {
            "waiting_for_yes": True,
            "confirm": {
                "webId": hit["id"],
                "name": hit["name"],
                "store": hit["store"],
                "price": hit["price"],
            },
        }
    product = _product(str(args.get("product_id") or ""))
    if not product:
        return {"error": "That product_id is not in the aisle."}
    store = str(args.get("store") or "")
    offer = next((row for row in product["offers"] if row["store"].lower() == store.lower()), None)
    if not offer:
        return {"error": "That store is not allowed for this product."}
    if day_limit is not None and int(offer["days"]) > day_limit:
        return {"error": "That store misses the day window."}
    if cents(offer["price"]) > cents(ceiling):
        return {"error": "That offer is over the ceiling. PayPal was not proposed."}
    return {
        "waiting_for_yes": True,
        "confirm": {
            "productId": product["id"],
            "store": offer["store"],
            "name": product["name"],
            "price": offer["price"],
        },
    }


def _known_prices(products: list, hits: list) -> set:
    known = set()
    for product in products:
        for offer in product.get("offers") or []:
            known.add(f"{float(offer['price']):.2f}")
    for hit in hits:
        for offer in hit.get("offers") or []:
            known.add(f"{float(offer['price']):.2f}")
        if hit.get("price") is not None:
            known.add(f"{float(hit['price']):.2f}")
    return known


def _safe_text(text: str, known: set) -> str:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if not cleaned:
        return ""
    for found in re.findall(r"\$(\d+(?:\.\d{1,2})?)", cleaned):
        if f"{float(found):.2f}" not in known:
            return ""
    return cleaned[:500]


async def _grok_completion(messages: list, tool_choice) -> Optional[dict]:
    key = os.getenv("XAI_API_KEY")
    if not key:
        return None
    async with httpx.AsyncClient(timeout=45) as client:
        for model in ("grok-4", "grok-3"):
            response = await client.post(
                "https://api.x.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "temperature": 0,
                    "max_tokens": 400,
                    "messages": messages,
                    "tools": TOOLS,
                    "tool_choice": tool_choice,
                },
            )
            if response.status_code >= 400:
                continue
            try:
                return response.json()
            except ValueError:
                continue
    return None


async def shop_with_grok(message: str, budget: float, intent: str = "shop") -> dict:
    text = message.strip()
    if len(text) < 2:
        return {"ok": False, "error": "Say what you want"}
    ceiling = _named_ceiling(text, budget)
    day_limit = _day_limit(text)
    aisle_has_match = False
    steps: list[str] = []
    products: list[dict] = []
    hits: list[dict] = []
    confirm = None
    spoken = ""
    system = (
        "You are Cartling. Use only the tools. "
        "Call check_catalog first. Call ask_channel3 only if the catalog is empty. "
        "When one offer fits, call create_paypal_order in the same turn. "
        "create_paypal_order does not open PayPal and does not charge. "
        "Never invent a price, a store, a product id, a web id, or a delivery date. "
        "Do not put a dollar amount in your sentence."
    )
    if intent == "pay":
        system += " The shopper already said yes. Call create_paypal_order now with the ids in the message. Do not pass a price."
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": text[:500]},
    ]
    tool_choice = {"type": "function", "function": {"name": "create_paypal_order"}} if intent == "pay" else "auto"
    for _round in range(4):
        data = await _grok_completion(messages, tool_choice)
        if not data:
            return {"ok": False, "error": "Grok did not answer"}
        choice = (data.get("choices") or [{}])[0]
        assistant = choice.get("message") or {}
        calls = assistant.get("tool_calls") or []
        if not calls:
            spoken = _safe_text(str(assistant.get("content") or ""), _known_prices(products, hits))
            break
        messages.append(
            {
                "role": "assistant",
                "content": assistant.get("content") or "",
                "tool_calls": calls,
            }
        )
        for call in calls:
            function = call.get("function") or {}
            name = str(function.get("name") or "")
            try:
                args = json.loads(function.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            if not isinstance(args, dict):
                args = {}
            if name == "check_catalog":
                steps.append("check_catalog")
                result = _check_catalog(str(args.get("query") or text), ceiling, day_limit)
                products = result["products"]
                aisle_has_match = bool(products)
            elif name == "ask_channel3":
                steps.append("ask_channel3")
                if aisle_has_match:
                    result = {"ok": False, "error": "The aisle already has a match. Use check_catalog."}
                else:
                    found = await channel3_search(str(args.get("query") or text), ceiling)
                    hits = found.get("results") or []
                    flat = []
                    for hit in hits:
                        for offer in hit.get("offers") or []:
                            flat.append(
                                {
                                    "web_id": offer["id"],
                                    "name": hit["name"],
                                    "store": offer["store"],
                                    "price": offer["price"],
                                }
                            )
                    result = {"ok": found.get("ok", False), "offers": flat[:12], "error": found.get("error")}
            elif name == "create_paypal_order":
                steps.append("create_paypal_order")
                result = _stage_order(args, ceiling, day_limit)
                if result.get("confirm"):
                    confirm = result["confirm"]
            else:
                result = {"error": "That tool is not available."}
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id") or name,
                    "content": json.dumps(result),
                }
            )
        tool_choice = "auto"
        if confirm:
            break
    if len(products) > 1:
        confirm = None
        spoken = "These fit the day and the ceiling. Add them. PayPal stays closed until you pay the cart."
    elif confirm:
        spoken = (
            f"Grok called create_paypal_order for {confirm['name']} from {confirm['store']}. "
            f"PayPal is not open until you say yes. The server price is ${float(confirm['price']):.2f}."
        )
    elif not spoken and products:
        first = products[0]
        offer = first["offers"][0]
        spoken = f"{first['name']} is ${float(offer['price']):.2f} at {offer['store']}, {offer['ships']}."
    elif hits:
        spoken = "Channel3 returned these. Open Description on a card, then pick a merchant."
    elif not spoken:
        return {"ok": False, "error": "Grok did not use a tool"}
    product_ids = [product["product_id"] for product in products]
    recommend = products[0]["product_id"] if products else None
    store = None
    if confirm and confirm.get("store") and confirm.get("productId"):
        store = confirm["store"]
        recommend = confirm["productId"]
    elif products:
        store = products[0]["offers"][0]["store"]
    return {
        "ok": True,
        "text": spoken,
        "steps": steps,
        "productIds": product_ids,
        "recommendId": recommend,
        "store": store,
        "hits": hits,
        "confirm": confirm,
    }
