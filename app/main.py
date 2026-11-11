import os
from typing import Optional, Tuple

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.agent import run_agent
from app.desk_data import advise, channel3_search, cents, money, price_cart, shop_with_grok, web_hit
from app.order_store import get_order, save_order
from app.paypal_client import PayPalClient

app = FastAPI(title="Cartling - Agentic Shopping Concierge")
app.mount("/static", StaticFiles(directory="app/static"), name="static")

paypal = PayPalClient()


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "error": detail})


class ChatRequest(BaseModel):
    message: str
    history: list = []


class LineIn(BaseModel):
    productId: str
    qty: int = 1
    store: Optional[str] = None


class CheckoutIn(BaseModel):
    lines: list[LineIn] = Field(default_factory=list)
    budget: float = 100
    webId: Optional[str] = None
    address: Optional[dict] = None


def shipping_from(raw: Optional[dict]) -> Optional[dict]:
    if not isinstance(raw, dict):
        return None
    name = str(raw.get("name") or "").strip()
    line1 = str(raw.get("line1") or "").strip()
    city = str(raw.get("city") or "").strip()
    region = str(raw.get("region") or "").strip()
    postal = str(raw.get("postal") or "").strip()
    country = str(raw.get("country") or "").strip().upper()
    if not name or not line1 or not city or not region or len(postal) < 3 or len(country) != 2:
        return None
    return {
        "name": {"full_name": name[:300]},
        "address": {
            "address_line_1": line1[:300],
            "admin_area_2": city[:120],
            "admin_area_1": region[:300],
            "postal_code": postal[:60],
            "country_code": country,
        },
    }


class AdviseIn(BaseModel):
    productId: str
    brief: str = ""
    ask: str = ""


class SearchIn(BaseModel):
    query: str
    maxPrice: float = 100


class AgentIn(BaseModel):
    message: str
    budget: float = 100
    intent: str = "shop"


def paypal_message(exc: httpx.HTTPStatusError) -> str:
    try:
        body = exc.response.json()
    except Exception:
        return "PayPal refused that"
    if isinstance(body, dict):
        if body.get("message"):
            return str(body["message"])[:180]
        details = body.get("details") or []
        if details and isinstance(details, list):
            return str(details[0].get("description") or details[0].get("issue") or "PayPal refused that")[:180]
    return "PayPal refused that"


def origin(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "localhost"
    return f"{proto}://{host}"


def approve_url(order: dict) -> Optional[str]:
    for link in order.get("links") or []:
        if link.get("rel") in ("approve", "payer-action"):
            return link.get("href")
    return None


def capture_bits(order: dict) -> Tuple[Optional[str], Optional[str]]:
    units = order.get("purchase_units") or [{}]
    captures = (units[0].get("payments") or {}).get("captures") or []
    if not captures:
        return None, None
    amount = (captures[0].get("amount") or {}).get("value")
    return captures[0].get("id"), amount


@app.get("/")
async def root():
    return FileResponse("app/static/index.html")


@app.get("/api/health")
async def health():
    return {
        "paypal": paypal.ready(),
        "grok": bool(os.getenv("XAI_API_KEY")),
        "channel3": bool(os.getenv("CHANNEL3_API_KEY")),
    }


@app.get("/api/config")
async def config():
    return {"paypal_client_id": os.getenv("PAYPAL_CLIENT_ID")}


@app.post("/chat")
async def chat(req: ChatRequest):
    reply = await run_agent(req.message, req.history)
    return {"reply": reply}


@app.post("/api/advise")
async def advise_route(body: AdviseIn):
    result = await advise(body.productId, body.brief, body.ask)
    if not result.get("ok"):
        raise HTTPException(status_code=503, detail=result.get("error") or "Grok did not answer")
    return result


@app.post("/api/search")
async def search_route(body: SearchIn):
    query = body.query.strip()
    if len(query) < 3:
        raise HTTPException(status_code=400, detail="Say what you want")
    ceiling = min(2000, max(1, float(body.maxPrice)))
    return await channel3_search(query, ceiling)


@app.post("/api/agent")
async def agent_route(body: AgentIn):
    intent = body.intent if body.intent in ("shop", "pay") else "shop"
    return await shop_with_grok(body.message, body.budget, intent)


@app.post("/api/checkout")
async def checkout(body: CheckoutIn, request: Request):
    if not paypal.ready():
        raise HTTPException(status_code=503, detail="PayPal sandbox keys are not set on the server")
    source = "cart"
    if body.webId:
        hit = web_hit(body.webId)
        if not hit:
            raise HTTPException(status_code=400, detail="That Channel3 offer expired. Search again.")
        if cents(hit["price"]) > cents(body.budget):
            raise HTTPException(status_code=400, detail="That offer is over the ceiling")
        unit = cents(hit["price"])
        priced = [
            {
                "productId": hit["id"],
                "name": hit["name"],
                "qty": 1,
                "store": hit["store"],
                "price": unit / 100,
                "ships": "Channel3",
            }
        ]
        total = unit
        source = "web"
    else:
        quoted = price_cart([line.model_dump() for line in body.lines], body.budget)
        if isinstance(quoted, str):
            raise HTTPException(status_code=400, detail=quoted)
        priced, total = quoted
    items = [
        {
            "name": line["name"][:127],
            "quantity": str(line["qty"]),
            "unit_amount": {"currency_code": "USD", "value": f"{line['price']:.2f}"},
            "description": f"{line['store']} - {line['ships']}"[:127],
            "category": "PHYSICAL_GOODS",
        }
        for line in priced
    ]
    shipping = shipping_from(body.address)
    if not shipping:
        raise HTTPException(status_code=400, detail="Add a ship-to address before PayPal can open")
    base = origin(request)
    description = "Cartling - " + ", ".join(line["name"] for line in priced)
    try:
        created = await paypal.create_checkout(money(total), description, items, f"{base}/?paypal=return", f"{base}/?paypal=cancel", shipping)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=paypal_message(exc)) from exc
    order_id = created.get("id")
    link = approve_url(created)
    if not order_id or not link:
        raise HTTPException(status_code=502, detail="PayPal did not return a checkout link")
    save_order(
        {
            "id": order_id,
            "status": "created",
            "source": source,
            "lines": priced,
            "total": total / 100,
        }
    )
    return {"ok": True, "orderId": order_id, "approveUrl": link}


def _saved_capture(saved: dict) -> dict:
    return {
        "ok": True,
        "orderId": saved.get("id"),
        "captureId": saved.get("capture_id"),
        "total": saved.get("total"),
        "clearCart": saved.get("source") != "web",
        "lines": saved.get("lines") or [],
    }


def paypal_label(order: dict) -> str:
    units = order.get("purchase_units") or [{}]
    payments = (units[0].get("payments") or {})
    captures = payments.get("captures") or []
    refunds = payments.get("refunds") or []
    if refunds or any(row.get("status") == "REFUNDED" for row in captures):
        return "REFUNDED"
    if any(row.get("status") == "PARTIALLY_REFUNDED" for row in captures):
        return "PARTIALLY_REFUNDED"
    if captures and captures[0].get("status"):
        return str(captures[0]["status"])
    return str(order.get("status") or "UNKNOWN")


@app.get("/api/orders/{order_id}")
async def order_status(order_id: str):
    if not paypal.ready():
        raise HTTPException(status_code=503, detail="PayPal sandbox keys are not set on the server")
    try:
        remote = await paypal.get_order(order_id)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=paypal_message(exc)) from exc
    return {"ok": True, "orderId": order_id, "status": paypal_label(remote)}


@app.post("/api/orders/{order_id}/capture")
async def capture(order_id: str):
    if not paypal.ready():
        raise HTTPException(status_code=503, detail="PayPal sandbox keys are not set on the server")
    saved = get_order(order_id)
    if saved.get("capture_id"):
        return _saved_capture(saved)
    try:
        captured = await paypal.capture_order(order_id)
    except httpx.HTTPStatusError as exc:
        try:
            remote = await paypal.get_order(order_id)
        except httpx.HTTPError:
            remote = {}
        if remote.get("status") == "COMPLETED" and saved.get("id"):
            capture_id, _amount = capture_bits(remote)
            saved["status"] = "paid"
            saved["capture_id"] = capture_id
            save_order(saved)
            return _saved_capture(saved)
        raise HTTPException(status_code=502, detail=paypal_message(exc)) from exc
    capture_id, _amount = capture_bits(captured)
    if saved.get("id"):
        saved["status"] = "paid"
        saved["capture_id"] = capture_id
        save_order(saved)
        return _saved_capture(saved)
    units = captured.get("purchase_units") or [{}]
    amount = (units[0].get("amount") or {}).get("value")
    return {
        "ok": True,
        "orderId": order_id,
        "captureId": capture_id,
        "total": float(amount or 0),
        "clearCart": True,
        "lines": [],
    }


@app.post("/api/orders/{order_id}/refund")
async def refund(order_id: str):
    if not paypal.ready():
        raise HTTPException(status_code=503, detail="PayPal sandbox keys are not set on the server")
    saved = get_order(order_id)
    capture_id = saved.get("capture_id")
    if not capture_id:
        try:
            remote = await paypal.get_order(order_id)
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=502, detail=paypal_message(exc)) from exc
        capture_id, _amount = capture_bits(remote)
    if not capture_id:
        raise HTTPException(status_code=400, detail="That PayPal order is not captured yet")
    try:
        result = await paypal.refund_capture(capture_id)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=paypal_message(exc)) from exc
    if saved.get("id"):
        saved["status"] = "refunded"
        saved["refund_id"] = result.get("id")
        save_order(saved)
    return {"ok": True, "refundId": result.get("id")}
