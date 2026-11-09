import json
from pathlib import Path

CATALOG_PATH = Path(__file__).parent.parent / "data" / "products.json"

def load_catalog():
    with open(CATALOG_PATH) as f:
        return json.load(f)

def search_and_compare(query: str, max_price: float) -> dict:
    products = load_catalog()
    results = []
    query_words = query.lower().replace("-", " ").split()
    
    for p in products:
        name_desc = (p["name"] + " " + p["description"]).lower().replace("-", " ")
        # Match if any important word from the query appears
        if any(word in name_desc for word in query_words if len(word) > 3):
            cheapest = min(p["stores"], key=lambda s: s["price"])
            if cheapest["price"] <= max_price:
                results.append({
                    "id": p["id"],
                    "name": p["name"],
                    "description": p["description"],
                    "best_price": cheapest["price"],
                    "best_store": cheapest["store"],
                    "all_stores": p["stores"]
                })
    return {"results": results, "query": query, "max_price": max_price}

def build_cart(item_ids: list, budget: float) -> dict:
    products = load_catalog()
    cart = []
    total = 0.0
    for pid in item_ids:
        product = next((p for p in products if p["id"] == pid), None)
        if product:
            cheapest = min(product["stores"], key=lambda s: s["price"])
            cart.append({
                "id": product["id"],
                "name": product["name"],
                "price": cheapest["price"],
                "store": cheapest["store"]
            })
            total += cheapest["price"]
    return {
        "items": cart,
        "total": round(total, 2),
        "budget": budget,
        "within_budget": total <= budget
    }