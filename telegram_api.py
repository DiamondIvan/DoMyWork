import io
import json
import os
import sys

# Force UTF-8 output so Windows terminals don't crash on non-ASCII characters
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "buffer"):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from pyrogram import Client
import requests

from env_config import get_env_int, get_env

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for active authentication flows
auth_clients = {}

# File that persists which chat IDs the bot should monitor
SELECTED_CHATS_FILE = os.path.join(os.path.dirname(__file__), "selected_chats.json")

def _load_selected_chats() -> list:
    """Load the persisted chat selection from disk."""
    try:
        with open(SELECTED_CHATS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []

def _save_selected_chats(chat_ids: list) -> None:
    """Persist the chat selection to disk."""
    with open(SELECTED_CHATS_FILE, "w", encoding="utf-8") as f:
        json.dump(chat_ids, f)

from typing import Optional
from pyrogram.errors import SessionPasswordNeeded

class SendCodeReq(BaseModel):
    userId: str
    phoneNumber: str

class SignInReq(BaseModel):
    userId: str
    phoneNumber: str
    phoneCodeHash: str
    phoneCode: str
    password: Optional[str] = None

api_id = get_env_int("TELEGRAM_API_ID")
api_hash = get_env("TELEGRAM_API_HASH")

# =====================================================================
# Chat AI endpoint (used by ChatScreen)
# =====================================================================
ILMU_API_KEY = get_env("ILMU_API_KEY")
ILMU_BASE_URL = get_env("ILMU_BASE_URL", default="https://api.ilmu.ai/v1/chat/completions")
ILMU_MODEL = get_env("ILMU_MODEL", default="ilmu-glm-5.1")

class ChatMessageReq(BaseModel):
    message: str

@app.post("/api/chat")
async def chat_endpoint(req: ChatMessageReq):
    """Simple chat endpoint that forwards user messages to Ilmu AI."""
    if not ILMU_API_KEY:
        raise HTTPException(status_code=500, detail="Missing ILMU_API_KEY in .env")

    headers = {
        "Authorization": f"Bearer {ILMU_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": ILMU_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are Crow AI, a helpful scheduling assistant. "
                    "You help users manage their tasks, calendar events, and reminders. "
                    "Be concise and friendly."
                ),
            },
            {"role": "user", "content": req.message},
        ],
        "stream": False,
        "temperature": 0.7,
    }
    try:
        response = requests.post(ILMU_BASE_URL, headers=headers, json=payload, timeout=30)
        if response.status_code == 200:
            ai_reply = response.json()["choices"][0]["message"]["content"].strip()
            return {"response": ai_reply}
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Ilmu API error: {response.text}",
        )
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="AI request timed out")
    except requests.exceptions.ConnectionError:
        raise HTTPException(status_code=502, detail="Could not reach Ilmu AI")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/telegram/sendCode")
async def send_code(req: SendCodeReq):
    if not api_id or not api_hash:
        raise HTTPException(status_code=500, detail="Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in .env")

    # Use an in-memory session for the handshake
    client = Client(f"auth_{req.userId}", api_id=api_id, api_hash=api_hash, in_memory=True)
    await client.connect()
    try:
        sent_code = await client.send_code(req.phoneNumber)
        auth_clients[req.userId] = client
        return {"phoneCodeHash": sent_code.phone_code_hash}
    except Exception as e:
        await client.disconnect()
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/telegram/signIn")
async def sign_in(req: SignInReq):
    client = auth_clients.get(req.userId)
    if not client:
        raise HTTPException(status_code=400, detail="Session expired. Please request the code again.")

    try:
        if req.password:
            await client.check_password(req.password)
        else:
            try:
                await client.sign_in(req.phoneNumber, req.phoneCodeHash, req.phoneCode)
            except SessionPasswordNeeded:
                return {"status": "password_needed", "detail": "Two-step verification enabled. Please provide your password."}

        # Export the string session so scheduler_bot.py can use it without logging in again
        session_string = await client.export_session_string()

        # Automatically write to pyrogram_session.txt so the bot picks it up without .env editing
        session_file = os.path.join(os.path.dirname(__file__), "pyrogram_session.txt")
        with open(session_file, "w", encoding="utf-8") as f:
            f.write(session_string)
        print(f"\n[OK] Session saved to pyrogram_session.txt — bot will use it automatically.")

        await client.disconnect()
        del auth_clients[req.userId]

        return {"status": "success", "sessionString": session_string}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# =====================================================================
# Chat selection endpoints
# =====================================================================

class FetchChatsReq(BaseModel):
    sessionString: str

class SetSelectedChatsReq(BaseModel):
    chatIds: list[int]

@app.post("/telegram/fetchChats")
async def fetch_chats_for_selection(req: FetchChatsReq):
    """Fetch the user's recent chats so they can pick which ones to monitor."""
    if not req.sessionString:
        raise HTTPException(status_code=400, detail="Missing sessionString")
    try:
        client = Client("picker_client", session_string=req.sessionString, in_memory=True,
                        api_id=api_id, api_hash=api_hash)
        await client.connect()
        chats = []
        async for dialog in client.get_dialogs(limit=50):
            chat = dialog.chat
            name = (
                getattr(chat, "title", None)
                or f"{getattr(chat, 'first_name', '')} {getattr(chat, 'last_name', '')}".strip()
                or "Unknown"
            )
            chats.append({
                "id": chat.id,
                "name": name,
                "type": str(chat.type),
                "lastMessage": dialog.top_message.text[:80] if dialog.top_message and dialog.top_message.text else None,
            })
        await client.disconnect()
        return {"chats": chats}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch chats: {str(e)}")

@app.get("/telegram/selectedChats")
def get_selected_chats():
    """Return the currently saved list of monitored chat IDs."""
    return {"chatIds": _load_selected_chats()}

@app.post("/telegram/selectedChats")
def set_selected_chats(req: SetSelectedChatsReq):
    """Persist the user's chosen chat IDs and return them."""
    _save_selected_chats(req.chatIds)
    return {"chatIds": req.chatIds, "saved": True}

# =====================================================================
# Telegram Message Operations
# =====================================================================
class SendMessageReq(BaseModel):
    sessionString: str
    chatId: int
    message: str

class GetChatsReq(BaseModel):
    sessionString: str

class GetMessageHistoryReq(BaseModel):
    sessionString: str
    chatId: int
    limit: int = 50

@app.post("/telegram/sendMessage")
async def send_message(req: SendMessageReq):
    """Send a message to a Telegram chat using a session string."""
    if not req.sessionString:
        raise HTTPException(status_code=400, detail="Missing sessionString")
    
    try:
        client = Client("temp_client", session_string=req.sessionString, in_memory=True)
        await client.connect()
        
        result = await client.send_message(req.chatId, req.message)
        
        await client.disconnect()
        
        return {
            "status": "success",
            "messageId": result.id,
            "text": result.text,
            "date": result.date.isoformat() if result.date else None
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to send message: {str(e)}")

@app.post("/telegram/getChats")
async def get_chats(req: GetChatsReq):
    """Get list of recent chats for the user."""
    if not req.sessionString:
        raise HTTPException(status_code=400, detail="Missing sessionString")
    
    try:
        client = Client("temp_client", session_string=req.sessionString, in_memory=True)
        await client.connect()
        
        chats = []
        async for dialog in client.get_dialogs(limit=20):
            chat = dialog.chat
            chats.append({
                "id": chat.id,
                "title": getattr(chat, 'title', None) or getattr(chat, 'first_name', 'Unknown'),
                "type": chat.type,
                "isGroup": chat.is_group,
                "isChannel": chat.is_channel,
                "lastMessage": dialog.top_message.text if dialog.top_message else None,
                "lastMessageDate": dialog.top_message.date.isoformat() if dialog.top_message and dialog.top_message.date else None,
                "unreadCount": dialog.unread_count
            })
        
        await client.disconnect()
        
        return {"chats": chats}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to get chats: {str(e)}")

@app.post("/telegram/getMessageHistory")
async def get_message_history(req: GetMessageHistoryReq):
    """Get message history from a Telegram chat."""
    if not req.sessionString:
        raise HTTPException(status_code=400, detail="Missing sessionString")
    
    try:
        client = Client("temp_client", session_string=req.sessionString, in_memory=True)
        await client.connect()
        
        messages = []
        async for message in client.get_chat_history(req.chatId, limit=req.limit):
            if message.text:
                messages.append({
                    "id": message.id,
                    "text": message.text,
                    "fromUser": message.from_user.id if message.from_user else None,
                    "fromUserName": message.from_user.first_name if message.from_user else "Unknown",
                    "date": message.date.isoformat() if message.date else None,
                    "isOutgoing": message.outgoing
                })
        
        await client.disconnect()
        
        return {"messages": messages[::-1]}  # Reverse to show oldest first
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to get message history: {str(e)}")

@app.post("/telegram/processMessage")
async def process_message(req: ChatMessageReq):
    """Process a message with AI and return response (for bot integration)."""
    if not ILMU_API_KEY:
        raise HTTPException(status_code=500, detail="Missing ILMU_API_KEY in .env")
    
    try:
        headers = {
            "Authorization": f"Bearer {ILMU_API_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": ILMU_MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are Crow AI, a helpful scheduling assistant for Telegram. "
                        "You help users manage their tasks, calendar events, and reminders. "
                        "Keep responses concise and friendly. "
                        "If the user asks to create a calendar event or send an email, acknowledge and tell them you'll help."
                    ),
                },
                {"role": "user", "content": req.message},
            ],
            "stream": False,
            "temperature": 0.7,
        }
        
        response = requests.post(ILMU_BASE_URL, headers=headers, json=payload, timeout=30)
        if response.status_code == 200:
            ai_reply = response.json()["choices"][0]["message"]["content"].strip()
            return {"response": ai_reply}
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Ilmu API error: {response.text}",
        )
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="AI request timed out")
    except requests.exceptions.ConnectionError:
        raise HTTPException(status_code=502, detail="Could not reach Ilmu AI")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
