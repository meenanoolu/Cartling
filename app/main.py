from fastapi import FastAPI
from pydantic import BaseModel
from app.agent import run_agent

app = FastAPI(title="Cartling")

class ChatRequest(BaseModel):
    message: str
    history: list = []

@app.post("/chat")
async def chat(req: ChatRequest):
    reply = await run_agent(req.message, req.history)
    return {"reply": reply}

@app.get("/")
async def root():
    return {"message": "Cartling is running"}