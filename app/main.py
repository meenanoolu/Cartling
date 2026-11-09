from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from app.agent import run_agent

app = FastAPI(title="Cartling")
app.mount("/static", StaticFiles(directory="app/static"), name="static")

class ChatRequest(BaseModel):
    message: str
    history: list = []

@app.get("/")
async def root():
    return FileResponse("app/static/index.html")

@app.post("/chat")
async def chat(req: ChatRequest):
    reply = await run_agent(req.message, req.history)
    return {"reply": reply}