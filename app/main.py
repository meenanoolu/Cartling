from fastapi import FastAPI, UploadFile, File
from pydantic import BaseModel

app = FastAPI(title="Cartling")

class ChatRequest(BaseModel):
    message: str
    history: list = []

@app.post("/chat")
async def chat(req: ChatRequest):
    # Call your Grok agent with tools
    # Return the agent’s reply
    return {"reply": "Agent response here"}

@app.post("/chat/image")
async def chat_image(file: UploadFile = File(...), message: str = ""):
    # Send image to Grok vision, get description, then run normal chat flow
    return {"reply": "Processed image + agent response"}