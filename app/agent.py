import os
import json
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(
    api_key=os.getenv("XAI_API_KEY"),
    base_url="https://api.x.ai/v1",
)

from app.paypal_client import PayPalClient
from app.catalog import search_and_compare, build_cart
from app.order_store import get_order, save_order, update_tracking

paypal = PayPalClient()

async def tool_search_and_compare(query: str, max_price: float) -> dict:
    return await search_and_compare(query, max_price)

def tool_build_cart(item_ids: list, budget: float) -> dict:
    return build_cart(item_ids, budget)

async def tool_create_paypal_order(cart_summary: str, total: float) -> dict:
    order = await paypal.create_order(str(total), cart_summary)
    save_order(order)
    return order

async def tool_get_order_status(order_id: str) -> dict:
    return await paypal.get_order(order_id)

async def tool_refund_order(order_id: str) -> dict:
    order = await paypal.get_order(order_id)
    captures = order.get("purchase_units", [{}])[0].get("payments", {}).get("captures", [])
    if not captures:
        return {"error": "No capture found. Order may not be approved/captured yet."}
    capture_id = captures[0]["id"]
    return await paypal.refund_capture(capture_id)

def tool_update_tracking(order_id: str, status: str, message: str) -> dict:
    return update_tracking(order_id, status, message)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_and_compare",
            "description": "Search products and compare prices across stores",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "max_price": {"type": "number"},
                },
                "required": ["query", "max_price"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "build_cart",
            "description": "Build a cart from item ids and check against budget",
            "parameters": {
                "type": "object",
                "properties": {
                    "item_ids": {"type": "array", "items": {"type": "string"}},
                    "budget": {"type": "number"},
                },
                "required": ["item_ids", "budget"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_paypal_order",
            "description": "Create a real PayPal sandbox order after user approval",
            "parameters": {
                "type": "object",
                "properties": {
                    "cart_summary": {"type": "string"},
                    "total": {"type": "number"},
                },
                "required": ["cart_summary", "total"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_order_status",
            "description": "Get the current status of a PayPal order",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string"},
                },
                "required": ["order_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "refund_order",
            "description": "Initiate a refund for an order",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string"},
                },
                "required": ["order_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_tracking",
            "description": "Update tracking status or delay message for an order",
            "parameters": {
                "type": "object",
                "properties": {
                    "order_id": {"type": "string"},
                    "status": {"type": "string"},
                    "message": {"type": "string"},
                },
                "required": ["order_id", "status", "message"],
            },
        },
    },
]

TOOL_MAP = {
    "search_and_compare": tool_search_and_compare,
    "build_cart": tool_build_cart,
    "create_paypal_order": tool_create_paypal_order,
    "get_order_status": tool_get_order_status,
    "refund_order": tool_refund_order,
    "update_tracking": tool_update_tracking,
}

SYSTEM_PROMPT = """You are Cartling, a helpful shopping and aftercare agent.

Rules:
- Always call search_and_compare when the user describes a product.
- If the user does not mention a budget, ask for one or use a reasonable default (e.g. 100) and say so.
- Show multiple options when available, with name, best price, store, and description.
- End product replies with: "Reply exactly: yes buy the [exact product name] to create the PayPal order."
- Only call create_paypal_order after an explicit "yes buy the [product]" confirmation.
- For status or refund requests, use the appropriate tools with the order ID.
- If nothing matches, say so and ask for a different query.
"""

async def run_agent(user_message: str, history: list = None) -> str:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    response = client.chat.completions.create(
        model="grok-3",
        messages=messages,
        tools=TOOLS,
        tool_choice="auto",
    )

    message = response.choices[0].message

    if message.tool_calls:
        messages.append(message)
        for tool_call in message.tool_calls:
            fn_name = tool_call.function.name
            args = json.loads(tool_call.function.arguments)
            
            if fn_name not in TOOL_MAP:
                result = {"error": f"Unknown tool {fn_name}"}
            else:
                func = TOOL_MAP[fn_name]
                if fn_name in ("search_and_compare", "create_paypal_order", "get_order_status", "refund_order"):
                    result = await func(**args)
                else:
                    result = func(**args)
            
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(result, default=str),
            })

        final = client.chat.completions.create(
            model="grok-3",
            messages=messages,
        )
        return final.choices[0].message.content

    return message.content