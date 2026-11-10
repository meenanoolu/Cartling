from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from app.agent import run_agent
from app.paypal_client import PayPalClient
import os

app = FastAPI(title="Cartling — Agentic Shopping Concierge")
app.mount("/static", StaticFiles(directory="app/static"), name="static")

paypal = PayPalClient()

class ChatRequest(BaseModel):
    message: str
    history: list = []

@app.get("/")
async def root():
    return FileResponse("app/static/index.html")

@app.get("/api/config")
async def config():
    return {"paypal_client_id": os.getenv("PAYPAL_CLIENT_ID")}

@app.post("/chat")
async def chat(req: ChatRequest):
    reply = await run_agent(req.message, req.history)
    return {"reply": reply}

@app.post("/api/orders/{order_id}/capture")
async def capture(order_id: str):
    result = await paypal.capture_order(order_id)
    return result