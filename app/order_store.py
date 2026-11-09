import json
from pathlib import Path

STORE_PATH = Path(__file__).parent.parent / "data" / "orders.json"

def _load():
    if not STORE_PATH.exists():
        return {}
    with open(STORE_PATH) as f:
        return json.load(f)

def _save(data):
    STORE_PATH.parent.mkdir(exist_ok=True)
    with open(STORE_PATH, "w") as f:
        json.dump(data, f, indent=2)

def save_order(order: dict):
    data = _load()
    order_id = order.get("id")
    if order_id:
        data[order_id] = order
        _save(data)
    return order

def get_order(order_id: str):
    data = _load()
    return data.get(order_id, {"error": "Order not found"})

def update_tracking(order_id: str, status: str, message: str):
    data = _load()
    if order_id not in data:
        data[order_id] = {}
    data[order_id]["tracking_status"] = status
    data[order_id]["tracking_message"] = message
    _save(data)
    return data[order_id]