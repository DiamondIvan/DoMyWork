import io
import json
import os
import sys
from urllib.parse import quote
from datetime import datetime

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

# ── User identity ─────────────────────────────────────────────────────────────
# This is YOUR personal Telegram user ID (e.g. "telegram:1161905452").
# The Google refresh token is stored under users/{OWNER_USER_ID}/integrations/google
# in Firestore. It must match the userId you entered in the Explore tab.
OWNER_USER_ID = (
    get_env("EXPO_PUBLIC_DEFAULT_USER_ID")
    or get_env("DEFAULT_USER_ID")
    or "telegram:unknown"
)
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

    current_time_str = datetime.now().strftime("%A, %B %d, %Y %H:%M:%S")
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
                    f"The current date and time is {current_time_str}. "
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
        response = requests.post(ILMU_BASE_URL, headers=headers, json=payload, timeout=60)
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
# Google OAuth — exchange authorization code for refresh token
# Replaces the Firebase Cloud Function so the app can use one backend.
# =====================================================================

class ExchangeGoogleCodeReq(BaseModel):
    userId: str
    code: str
    redirectUri: Optional[str] = None

@app.post("/exchangeGoogleCode")
def exchange_google_code(req: ExchangeGoogleCodeReq):
    """Exchange a Google OAuth authorization code for a refresh token,
    then store it in Firestore at users/{userId}/integrations/google."""
    client_id = get_env("GOOGLE_OAUTH_CLIENT_ID")
    client_secret = get_env("GOOGLE_OAUTH_CLIENT_SECRET")
    configured_redirect_uri = get_env("GOOGLE_OAUTH_REDIRECT_URI")

    if not client_id or not client_secret:
        raise HTTPException(status_code=500, detail="Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET in .env")

    # Validate redirect URI matches what the OAuth app expects
    redirect_uri_to_use = req.redirectUri or configured_redirect_uri
    if configured_redirect_uri and req.redirectUri and req.redirectUri != configured_redirect_uri:
        raise HTTPException(
            status_code=400,
            detail=f"redirectUri mismatch. App sent '{req.redirectUri}', backend expects '{configured_redirect_uri}'."
        )

    # Exchange auth code for tokens
    token_resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": req.code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri_to_use,
            "grant_type": "authorization_code",
        },
        timeout=30,
    )

    print(f"[OAUTH] Token exchange status={token_resp.status_code} userId={req.userId}")

    if token_resp.status_code != 200:
        raise HTTPException(
            status_code=400,
            detail=f"Google token exchange failed ({token_resp.status_code}): {token_resp.text}",
        )

    tokens = token_resp.json()
    refresh_token = tokens.get("refresh_token")

    if not refresh_token:
        # This happens when the user already granted access before and Google doesn't
        # re-issue a refresh token. Revoking access at myaccount.google.com/permissions
        # and reconnecting will fix it.
        print(f"[OAUTH] ⚠️  No refresh_token returned for userId={req.userId}. User may need to revoke and re-grant access.")
        return {
            "ok": True,
            "hasRefreshToken": False,
            "message": (
                "No refresh_token returned. Revoke app access at "
                "https://myaccount.google.com/permissions then reconnect."
            ),
        }

    # Persist the refresh token in Firestore
    db, fs_mod = _get_firestore_client()
    if db is None:
        raise HTTPException(status_code=503, detail="Firebase not configured — check GOOGLE_APPLICATION_CREDENTIALS in .env")

    db.collection("users").document(req.userId).collection("integrations").document("google").set(
        {
            "refreshToken": refresh_token,
            "updatedAt": fs_mod.SERVER_TIMESTAMP,
        },
        merge=True,
    )
    print(f"[OAUTH] ✅ Refresh token stored for userId={req.userId}")
    return {"ok": True, "hasRefreshToken": True}


# =====================================================================
# Pending Tasks — AI-detected tasks waiting for user confirmation
# =====================================================================

def _get_firestore_client():
    """Lazy-load firebase_admin and return (db, firestore_module)."""
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore as fs
    except ImportError:
        return None, None

    if not firebase_admin._apps:
        sa_path = get_env("GOOGLE_APPLICATION_CREDENTIALS") or get_env("FIREBASE_SERVICE_ACCOUNT_KEY_PATH")
        if sa_path:
            import os as _os
            _os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = sa_path
        try:
            if sa_path and __import__("os").path.exists(sa_path):
                firebase_admin.initialize_app(credentials.Certificate(sa_path))
            else:
                return None, None
        except Exception:
            return None, None

    return fs.client(), fs

def _get_google_refresh_token(db, user_id: str) -> Optional[str]:
    token_doc = db.collection("users").document(user_id).collection("integrations").document("google").get()
    if not token_doc.exists:
        return None
    data = token_doc.to_dict() or {}
    token = data.get("refreshToken")
    return token if isinstance(token, str) and token.strip() else None

def _create_google_calendar_event_immediately(db, user_id: str, payload: dict) -> dict:
    client_id = get_env("GOOGLE_OAUTH_CLIENT_ID")
    client_secret = get_env("GOOGLE_OAUTH_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise RuntimeError("Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET in .env")

    print(f"[CAL] Creating event for userId='{user_id}' payload={payload}")

    refresh_token = _get_google_refresh_token(db, user_id)
    if not refresh_token:
        raise RuntimeError(
            f"Missing Google refresh token for userId '{user_id}'. Reconnect Google in Settings."
        )
    print(f"[CAL] Refresh token found (length={len(refresh_token)})")

    token_resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=30,
    )
    print(f"[CAL] Token refresh status={token_resp.status_code}")
    if token_resp.status_code != 200:
        raise RuntimeError(f"Google token refresh failed ({token_resp.status_code}): {token_resp.text}")

    access_token = token_resp.json().get("access_token")
    if not access_token:
        raise RuntimeError("Google token refresh succeeded but access_token was missing")
    print("[CAL] Access token obtained successfully")

    calendar_id = payload.get("calendarId") or "primary"

    # Build start/end — always include timeZone so Google doesn't reject ambiguous datetimes.
    # If the AI included an offset (e.g. +08:00) the dateTime is already unambiguous;
    # the timeZone field is still accepted and harmless.
    DEFAULT_TIMEZONE = "Asia/Kuala_Lumpur"
    start_dt = payload.get("start")
    end_dt = payload.get("end")

    if not start_dt or not end_dt:
        raise RuntimeError(
            f"Payload is missing start or end datetime. Got start={start_dt!r}, end={end_dt!r}. "
            "The AI may not have extracted the event time correctly."
        )

    event_body: dict = {
        "summary": payload.get("summary") or "Untitled Event",
        "start": {"dateTime": start_dt, "timeZone": DEFAULT_TIMEZONE},
        "end": {"dateTime": end_dt, "timeZone": DEFAULT_TIMEZONE},
    }

    # Only include optional fields when they are non-null — Google rejects explicit null values.
    description = payload.get("description")
    if description:
        event_body["description"] = description

    attendees = payload.get("attendees")
    if isinstance(attendees, list) and attendees:
        event_body["attendees"] = [{"email": str(email)} for email in attendees if email]

    print(f"[CAL] Sending event body to Google: {event_body}")

    create_resp = requests.post(
        f"https://www.googleapis.com/calendar/v3/calendars/{quote(str(calendar_id), safe='')}/events",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json=event_body,
        timeout=30,
    )
    print(f"[CAL] Google Calendar API response status={create_resp.status_code}")
    print(f"[CAL] Google Calendar API response body={create_resp.text[:500]}")

    if create_resp.status_code not in (200, 201):
        raise RuntimeError(
            f"Google Calendar create event failed ({create_resp.status_code}): {create_resp.text}"
        )

    event = create_resp.json()
    event_id = event.get("id")
    html_link = event.get("htmlLink")
    print(f"[CAL] ✅ Event created! id={event_id} link={html_link}")
    return {
        "id": event_id,
        "htmlLink": html_link,
    }

@app.get("/pendingTasks")
def get_pending_tasks():
    """Return all pending AI-detected tasks waiting for user confirmation."""
    db, fs_mod = _get_firestore_client()
    if db is None:
        return {"tasks": []}
    try:
        docs = (
            db.collection("pendingTasks")
            .where("status", "==", "pending_confirmation")
            .stream()
        )
        tasks = []
        for doc in docs:
            d = doc.to_dict()
            tasks.append({
                "id": doc.id,
                "type": d.get("type"),
                "title": d.get("title", "Untitled Task"),
                "payload": d.get("payload", {}),
                "source": d.get("source", "telegram"),
                "chatTitle": d.get("chatTitle", ""),
                "sender": d.get("sender", ""),
                "createdAt": d.get("createdAt").isoformat() if hasattr(d.get("createdAt"), "isoformat") else None,
            })
        return {"tasks": tasks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/pendingTasks/{task_id}/confirm")
def confirm_pending_task(task_id: str):
    """Confirm a pending task — moves it to automationRequests for Google Calendar processing.

    The userId stored in automationRequests MUST match the userId used when connecting
    Google OAuth (Explore tab). It is read from EXPO_PUBLIC_DEFAULT_USER_ID in .env.
    """
    db, fs_mod = _get_firestore_client()
    if db is None:
        raise HTTPException(status_code=503, detail="Firebase not configured")
    try:
        task_ref = db.collection("pendingTasks").document(task_id)
        task = task_ref.get()
        if not task.exists:
            raise HTTPException(status_code=404, detail="Task not found")

        data = task.to_dict()

        # Use the owner's real user ID (where the Google refresh token is stored),
        # NOT the chat ID of the monitored group chat.
        user_id = OWNER_USER_ID

        automation_doc = {
            "userId": user_id,
            "type": data["type"],
            "payload": data["payload"],
            "status": "queued",
            "createdAt": fs_mod.SERVER_TIMESTAMP,
            "updatedAt": fs_mod.SERVER_TIMESTAMP,
            "source": {
                "telegram": {
                    "chatId": data.get("chatId"),
                    "chatTitle": data.get("chatTitle"),
                    "sender": data.get("sender"),
                    "messageId": data.get("messageId"),
                }
            },
        }
        # Calendar confirmations are executed immediately here so users get reliable behavior
        # even when Firestore-trigger workers are unavailable.
        if data.get("type") == "create_calendar_event":
            try:
                result = _create_google_calendar_event_immediately(db, user_id, data.get("payload", {}))
            except Exception as e:
                raise HTTPException(status_code=400, detail=str(e))

            automation_doc["status"] = "done"
            automation_doc["result"] = result
            _, ref = db.collection("automationRequests").add(automation_doc)
            task_ref.delete()
            print(
                f"✅ [CONFIRM] Calendar event created immediately. automationRequest={ref.id}, "
                f"userId={user_id}, eventId={result.get('id')}"
            )
            return {
                "confirmed": True,
                "automationRequestId": ref.id,
                "calendarEventId": result.get("id"),
                "calendarEventLink": result.get("htmlLink"),
            }

        _, ref = db.collection("automationRequests").add(automation_doc)
        task_ref.delete()
        print(f"✅ [CONFIRM] Task '{data.get('type')}' confirmed. automationRequest={ref.id}, userId={user_id}")
        return {"confirmed": True, "automationRequestId": ref.id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/pendingTasks/{task_id}")
def dismiss_pending_task(task_id: str):
    """Dismiss (delete) a pending task without acting on it."""
    db, _ = _get_firestore_client()
    if db is None:
        raise HTTPException(status_code=503, detail="Firebase not configured")
    try:
        db.collection("pendingTasks").document(task_id).delete()
        return {"dismissed": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
    
    current_time_str = datetime.now().strftime("%A, %B %d, %Y %H:%M:%S")
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
                        f"The current date and time is {current_time_str}. "
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
        
        response = requests.post(ILMU_BASE_URL, headers=headers, json=payload, timeout=60)
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
