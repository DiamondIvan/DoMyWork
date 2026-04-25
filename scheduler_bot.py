import io
import os
import sys

# Force UTF-8 for all I/O on Windows (avoids cp1252 charmap errors with emojis).
# Must be set before any other imports.
os.environ.setdefault("PYTHONUTF8", "1")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import asyncio
import json
import hashlib
import contextlib
from typing import Any, Optional
from datetime import datetime
import requests
import base64
from requests.exceptions import ReadTimeout, ConnectionError as RequestsConnectionError


# Python 3.14 fix: create event loop before Pyrogram import,
# because pyrogram/sync.py calls asyncio.get_event_loop() at import time.
_loop = asyncio.new_event_loop()
asyncio.set_event_loop(_loop)

import base64
try:
    from openai import OpenAI
except Exception:
    OpenAI = None
from pyrogram import Client, idle
from pyrogram.handlers import MessageHandler

from env_config import get_env, get_env_int

# =====================================================================
# Telegram credentials & session helpers
# =====================================================================
api_id = get_env_int("TELEGRAM_API_ID", fallback_names=["api_id"])
api_hash = get_env("TELEGRAM_API_HASH", fallback_names=["api_hash"])
session_name = get_env("PYROGRAM_SESSION_NAME", default="my_account")
_SESSION_FILE = os.path.join(os.path.dirname(__file__), "pyrogram_session.txt")

def _read_session() -> Optional[str]:
    """Read session string from file or .env, whichever is available."""
    # Priority 1: pyrogram_session.txt (auto-written by the API on app sign-in)
    try:
        with open(_SESSION_FILE, "r", encoding="utf-8") as f:
            val = f.read().strip()
            if val:
                return val
    except FileNotFoundError:
        pass
    # Priority 2: PYROGRAM_SESSION_STRING in .env
    return get_env("PYROGRAM_SESSION_STRING") or None

# Global client — set in main() once the session is available
app: Optional[Client] = None


# =====================================================================
# Target chats
# =====================================================================
GLOBAL_TARGET_IDS = []
SELECTED_CHATS_FILE = os.path.join(os.path.dirname(__file__), "selected_chats.json")

def get_monitored_chat_ids() -> list:
    """Re-reads selected_chats.json every call so app changes take effect immediately."""
    # 1. Try the JSON file (written by the mobile app)
    try:
        with open(SELECTED_CHATS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list) and data:
                return [int(x) for x in data]
    except (FileNotFoundError, json.JSONDecodeError, ValueError):
        pass
    # 2. Fall back to in-memory list (set at startup from .env)
    return list(GLOBAL_TARGET_IDS)

# =====================================================================
# Deduplication — skip images already processed this session
# =====================================================================
PROCESSED_IMAGE_HASHES: set = set()


def calculate_file_hash(filepath: str) -> str:
    """Returns an MD5 fingerprint of a file to detect duplicates."""
    hasher = hashlib.md5()
    with open(filepath, "rb") as f:
        hasher.update(f.read())
    return hasher.hexdigest()


# =====================================================================
# Media helpers
# =====================================================================
def extract_document_text(file_path: str) -> str:
    """Extract plain text from PDF or Word documents."""
    text = ""
    try:
        if file_path.lower().endswith(".pdf"):
            import fitz  # type: ignore  (PyMuPDF)
            doc = fitz.open(file_path)
            for page in doc:
                text += page.get_text() + "\n"
        elif file_path.lower().endswith((".docx", ".doc")):
            import docx  # type: ignore  (python-docx)
            doc = docx.Document(file_path)
            for para in doc.paragraphs:
                text += para.text + "\n"
        else:
            text = "[Unsupported document format]"
    except Exception as e:
        print(f"❌ Error reading document: {e}")
    return text.strip()


# =====================================================================
# Owner user ID — must match the userId used when connecting Google OAuth
# =====================================================================
OWNER_USER_ID = (
    get_env("EXPO_PUBLIC_DEFAULT_USER_ID")
    or get_env("DEFAULT_USER_ID")
    or "telegram:unknown"
)

# =====================================================================
# Ilmu AI (Lazy Init Replacement for Gemini)
# =====================================================================
ILMU_API_KEY = get_env("ILMU_API_KEY") or get_env("API_KEY") or get_env("OPENAI_API_KEY")
ILMU_BASE_URL = get_env("ILMU_BASE_URL", default="https://api.ilmu.ai/v1/chat/completions")
ILMU_MODEL = get_env("ILMU_MODEL", default="ilmu-glm-5.1")
ILMU_TIMEOUT_SECONDS = get_env_int("ILMU_TIMEOUT_SECONDS", fallback_names=["ILMU_TIMEOUT"], default=120)
ILMU_MAX_RETRIES = get_env_int("ILMU_MAX_RETRIES", default=2)
AI_DETECTION_RETRY_INTERVAL_SECONDS = get_env_int("AI_DETECTION_RETRY_INTERVAL_SECONDS", default=45)

def call_ilmu_ai(system_prompt: str, user_content: str) -> tuple[Optional[str], bool]:
    """Call Ilmu AI and return (content, retryable_failure)."""
    if not ILMU_API_KEY:
        print("❌ Missing ILMU_API_KEY in .env")
        return None, False

    headers = {
        "Authorization": f"Bearer {ILMU_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": ILMU_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ],
        "stream": False,
        "temperature": 0.1  # Low temperature for strict JSON output
    }
    attempts = max(1, ILMU_MAX_RETRIES + 1)
    for attempt in range(1, attempts + 1):
        try:
            response = requests.post(
                ILMU_BASE_URL,
                headers=headers,
                json=payload,
                timeout=max(30, ILMU_TIMEOUT_SECONDS),
            )
            if response.status_code == 200:
                return response.json()["choices"][0]["message"]["content"].strip(), False

            # Avoid dumping huge Cloudflare/HTML bodies into logs.
            body = (response.text or "").strip()
            short_body = body[:240] + ("..." if len(body) > 240 else "")
            if response.status_code >= 500:
                print(
                    f"⚠️ Ilmu API upstream error {response.status_code}. "
                    "Service is temporarily unavailable; task detection skipped for this message."
                )
                return None, True
            else:
                print(f"⚠️ Ilmu API Error {response.status_code}: {short_body}")
                return None, False
        except (ReadTimeout, RequestsConnectionError) as e:
            if attempt >= attempts:
                print(f"❌ Ilmu Request Failed after {attempt} attempt(s): {e}")
                return None, True
            backoff_seconds = attempt * 2
            print(
                f"⚠️ Ilmu transient network issue on attempt {attempt}/{attempts}; retrying in {backoff_seconds}s... ({e})"
            )
            import time
            time.sleep(backoff_seconds)
        except Exception as e:
            print(f"❌ Ilmu Request Failed: {e}")
            return None, True
    return None, True

# =====================================================================
# Gemini to describe iamge
# =====================================================================
def describe_image_with_gemini(image_path: str) -> str:
    """Uses Gemini 2.5 Flash to actually see and describe the image."""
    api_key = get_env("GEMINI_API_KEY")
    if not api_key:
        return "(Image received - API Key missing)"

    try:
        # 1. Determine basic mime type for Gemini
        mime_type = "image/png" if image_path.lower().endswith(".png") else "image/jpeg"
        
        # 2. Encode image to Base64
        with open(image_path, "rb") as image_file:
            base64_image = base64.b64encode(image_file.read()).decode('utf-8')

        # 3. Setup Gemini API URL and Payload
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
        
        payload = {
            "contents": [{
                "parts": [
                    {"text": "What is in this image? Focus on dates, times, and tasks for a calendar. Keep it concise."},
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": base64_image
                        }
                    }
                ]
            }]
        }
        
        # 4. Make the request
        response = requests.post(url, headers={"Content-Type": "application/json"}, json=payload, timeout=30)
        
        if response.status_code == 200:
            # Parse the text out of Gemini's specific JSON structure
            return response.json()['candidates'][0]['content']['parts'][0]['text'].strip()
        else:
            print(f"⚠️ [GEMINI API ERROR]: {response.status_code} - {response.text}")
            return "(Image received - Gemini API error)"

    except Exception as e:
        print(f"❌ [GEMINI VISION ERROR]: {e}")
        return "(Image received - failed to describe)"
# =====================================================================
# Configuration: Enable/disable interactive AI responses
# =====================================================================
# Auto-reply to chat messages is opt-in; task detection still runs regardless.
ENABLE_AI_RESPONSES = get_env("ENABLE_TELEGRAM_AI_RESPONSES", default="false").lower() in ["true", "1", "yes"]
ENABLE_AI_TASK_DETECTION = get_env("ENABLE_TELEGRAM_AI_TASK_DETECTION", default="false").lower() in ["true", "1", "yes"]
ENABLE_AI_DETECTION_RETRY_QUEUE = get_env("ENABLE_AI_DETECTION_RETRY_QUEUE", default="true").lower() in ["true", "1", "yes"]

# =====================================================================
# Firestore (lazy init)
# =====================================================================
_FIRESTORE_CLIENT: Any = None
_FIRESTORE_MODULE: Any = None

def _get_firestore():
    global _FIRESTORE_CLIENT, _FIRESTORE_MODULE
    if _FIRESTORE_CLIENT is not None and _FIRESTORE_MODULE is not None:
        return _FIRESTORE_CLIENT, _FIRESTORE_MODULE
    try:
        import firebase_admin  # type: ignore
        from firebase_admin import credentials, firestore  # type: ignore
    except Exception:
        print("⚠️ firebase-admin not installed or import failed.")
        return None, None

    if not firebase_admin._apps:
        # env_config loads .env into its own cache but does NOT set os.environ,
        # so use get_env() here and inject into os.environ for the Google SDK.
        sa_path = (
            get_env("GOOGLE_APPLICATION_CREDENTIALS")
            or get_env("FIREBASE_SERVICE_ACCOUNT_KEY_PATH")
        )
        if sa_path:
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = sa_path
        try:
            if sa_path and os.path.exists(sa_path):
                firebase_admin.initialize_app(credentials.Certificate(sa_path))
            else:
                print("⚠️ Firebase key file not found. Check GOOGLE_APPLICATION_CREDENTIALS in .env")
                return None, None
        except Exception as e:
            print(f"⚠️ Firebase init failed: {e}")
            return None, None

    _FIRESTORE_CLIENT = firestore.client()
    _FIRESTORE_MODULE = firestore
    return _FIRESTORE_CLIENT, _FIRESTORE_MODULE


# =====================================================================
# Save a single message to Firestore
# chats/{chatId}/messages/{telegramMessageId}
# =====================================================================
def _save_message_sync(
    *,
    chat_id: int,
    chat_title: str,
    sender: str,
    sender_id: int,
    direction: str,
    text: str,
    has_media: bool,
    media_type: Optional[str],
    media_file_name: Optional[str],
    telegram_message_id: int,
) -> None:
    db, firestore = _get_firestore()
    if db is None:
        return

    doc = {
        "chatId": chat_id,
        "chatTitle": chat_title,
        "sender": sender,
        "senderId": sender_id,
        "direction": direction,
        "text": text or "",
        "hasMedia": has_media,
        "mediaType": media_type,
        "mediaFileName": media_file_name,
        "timestamp": firestore.SERVER_TIMESTAMP,
        "telegramMessageId": telegram_message_id,
        "processed": False,
    }

    (
        db.collection("chats")
        .document(str(chat_id))
        .collection("messages")
        .document(str(telegram_message_id))
        .set(doc)
    )


async def save_message(**kwargs) -> None:
    await asyncio.to_thread(_save_message_sync, **kwargs)


# =====================================================================
# Fetch ALL messages for a chat from Firestore (ordered by timestamp)
# =====================================================================
def _get_all_messages_sync(chat_id: int, limit: int = 20) -> list:
    db, firestore_mod = _get_firestore()
    if db is None:
        return []
    # Fetch only the latest messages to save AI tokens and prevent context overflow
    docs = (
        db.collection("chats")
        .document(str(chat_id))
        .collection("messages")
        .order_by("timestamp", direction=firestore_mod.Query.DESCENDING)
        .limit(limit)
        .stream()
    )
    # Reverse the list so the AI reads it in chronological order (oldest to newest)
    return [d.to_dict() for d in docs][::-1]


async def get_all_messages(chat_id: int) -> list:
    return await asyncio.to_thread(_get_all_messages_sync, chat_id)


# =====================================================================
# Enqueue an automation request in Firestore
# =====================================================================
def _enqueue_automation_request_sync(
    *, user_id: str, req_type: str, payload: dict, source: dict
) -> Optional[str]:
    db, firestore = _get_firestore()
    if db is None or firestore is None:
        return None

    doc = {
        "userId": user_id,
        "type": req_type,
        "payload": payload,
        "status": "queued",
        "createdAt": firestore.SERVER_TIMESTAMP,
        "source": source,
    }

    _, ref = db.collection("automationRequests").add(doc)
    return ref.id


async def enqueue_automation_request(
    *, user_id: str, req_type: str, payload: dict, source: dict
) -> Optional[str]:
    return await asyncio.to_thread(
        _enqueue_automation_request_sync,
        user_id=user_id,
        req_type=req_type,
        payload=payload,
        source=source,
    )


# =====================================================================
# Save a detected task as PENDING CONFIRMATION in Firestore
# pendingTasks/{taskId}  — user must confirm before it goes to automationRequests
# =====================================================================
def _save_pending_task_sync(
    *,
    req_type: str,
    payload: dict,
    chat_id: int,
    chat_title: str,
    sender: str,
    message_id: int,
) -> Optional[str]:
    db, firestore = _get_firestore()
    if db is None or firestore is None:
        return None

    # Build a human-readable title for the activity card
    if req_type == "create_calendar_event":
        title = payload.get("summary") or "Meeting / Calendar Event"
    elif req_type == "send_email":
        title = f"Email: {payload.get('subject') or 'No subject'}"
    else:
        title = req_type.replace("_", " ").title()

    doc = {
        "type": req_type,
        "payload": payload,
        "status": "pending_confirmation",
        "title": title,
        "source": "telegram",
        "chatId": chat_id,
        "chatTitle": chat_title,
        "sender": sender,
        "messageId": message_id,
        "createdAt": firestore.SERVER_TIMESTAMP,
    }

    _, ref = db.collection("pendingTasks").add(doc)
    return ref.id


async def save_pending_task(
    *, req_type: str, payload: dict, chat_id: int,
    chat_title: str, sender: str, message_id: int,
) -> Optional[str]:
    return await asyncio.to_thread(
        _save_pending_task_sync,
        req_type=req_type,
        payload=payload,
        chat_id=chat_id,
        chat_title=chat_title,
        sender=sender,
        message_id=message_id,
    )


def _queue_detection_retry_sync(
    *, chat_id: int, chat_title: str, sender: str, message_id: int, reason: str
) -> Optional[str]:
    db, firestore = _get_firestore()
    if db is None or firestore is None:
        return None

    doc_id = f"{chat_id}_{message_id}"
    ref = db.collection("aiDetectionRetries").document(doc_id)
    snap = ref.get()
    if snap.exists:
        data = snap.to_dict() or {}
        if data.get("status") in {"queued", "processing", "done", "no_action"}:
            return doc_id

    ref.set(
        {
            "chatId": chat_id,
            "chatTitle": chat_title,
            "sender": sender,
            "triggerMessageId": message_id,
            "status": "queued",
            "attempts": 0,
            "lastError": reason,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )
    return doc_id


async def queue_detection_retry(
    *, chat_id: int, chat_title: str, sender: str, message_id: int, reason: str
) -> Optional[str]:
    return await asyncio.to_thread(
        _queue_detection_retry_sync,
        chat_id=chat_id,
        chat_title=chat_title,
        sender=sender,
        message_id=message_id,
        reason=reason,
    )


def _confirm_pending_task_sync(task_id: str) -> bool:
    """Move a pending task to automationRequests (status=queued) and delete from pendingTasks.

    Uses OWNER_USER_ID (from EXPO_PUBLIC_DEFAULT_USER_ID in .env) so the Cloud Function
    can find the correct Google refresh token in Firestore.
    """
    db, firestore = _get_firestore()
    if db is None or firestore is None:
        return False

    task_ref = db.collection("pendingTasks").document(task_id)
    task = task_ref.get()
    if not task.exists:
        return False

    data = task.to_dict()
    automation_doc = {
        "userId": OWNER_USER_ID,  # Must match the userId from the Google OAuth connect step
        "type": data["type"],
        "payload": data["payload"],
        "status": "queued",
        "createdAt": firestore.SERVER_TIMESTAMP,
        "source": {
            "telegram": {
                "chatId": data.get("chatId"),
                "chatTitle": data.get("chatTitle"),
                "sender": data.get("sender"),
                "messageId": data.get("messageId"),
            }
        },
    }
    db.collection("automationRequests").add(automation_doc)
    task_ref.delete()
    return True


# =====================================================================
# AI Pipeline — Ilmu reads chat history and detects actions
# =====================================================================
async def run_ai_pipeline(chat_id: int, chat_title: str) -> tuple[Optional[dict], bool]:
    # Fetch history from Firestore
    messages = await get_all_messages(chat_id)
    if not messages:
        return None, False
    print(f"🧠 [AI CONTEXT] Analyzing last {len(messages)} messages for actionable tasks...")

    # Format history for the AI context
    history = "\n".join(
        f"[{m.get('direction', '?').upper()}] {m.get('sender', 'Unknown')}: "
        f"{m.get('text') or '(media)'}"
        for m in messages
    )
    current_time_str = datetime.now().strftime("%A, %B %d, %Y %H:%M:%S")
    system_prompt = (
        f"You are a strict scheduling assistant for the Telegram chat '{chat_title}'. "
        f"The current date and time is {current_time_str}. Use this to resolve relative dates (e.g., 'tomorrow', 'next Friday') and ensure the correct year is used. "
        "Extract MANDATORY tasks (meetings, deadlines, emails) ONLY IF they are newly introduced or confirmed in the LATEST message. "
        "Ignore spam/ads and ignore tasks that were already finalized in older messages. "
        "You MUST respond ONLY with a valid JSON object or the word 'null'."
    )

    user_content = f"""
    Based on the following recent history, detect if a new mandatory task is needed from the final message:
    {history}

    Output format:
    - Email: {{"type": "send_email", "payload": {{"to": "...", "subject": "...", "bodyText": "..."}}}}
    - Calendar: {{"type": "create_calendar_event", "payload": {{"summary": "...", "description": "...", "start": "2026-04-24T15:00:00+08:00", "end": "2026-04-24T16:00:00+08:00"}}}}
   
    If no action, return: null
    """

    # Run the request in a thread to keep the bot responsive
    raw, retryable_failure = await asyncio.to_thread(call_ilmu_ai, system_prompt, user_content)
    if retryable_failure:
        return None, True

    if not raw or raw.lower() == "null":
        print("💤 [AI RESULT] No mandatory tasks detected.")
        return None, False
    else:
        print(f"🎯 [AI RESULT] Task Found: {raw}")

    try:
        # Strip potential markdown fences Ilmu might add
        if "```" in raw:
            raw = raw.split("```")[1].replace("json", "").strip()
        return json.loads(raw), False
    except Exception as e:
        print(f"⚠️ AI JSON Error: {e} | Raw Output: {raw}")
        return None, False

# =====================================================================
# Generate AI response for interactive chat
# =====================================================================
async def generate_ai_response(message_text: str, chat_title: str) -> Optional[str]:
    """Generate a conversational AI response for a message."""
    current_time_str = datetime.now().strftime("%A, %B %d, %Y %H:%M:%S")
    system_prompt = (
        f"You are Crow AI, a helpful scheduling assistant in the Telegram chat '{chat_title}'. "
        f"The current date and time is {current_time_str}. "
        "Help users manage their tasks, calendar events, and reminders. "
        "Be concise, friendly, and helpful. Keep responses under 200 characters when possible. "
        "If the user asks you to create a task or event, acknowledge it and tell them you'll help."
    )

    raw, _ = await asyncio.to_thread(call_ilmu_ai, system_prompt, message_text)
    return raw if raw else None


async def process_detection_retry_queue() -> None:
    """Background worker that retries Ilmu task detection failures."""
    while True:
        await asyncio.sleep(max(15, AI_DETECTION_RETRY_INTERVAL_SECONDS))
        if not ENABLE_AI_TASK_DETECTION or not ENABLE_AI_DETECTION_RETRY_QUEUE:
            continue

        db, firestore = _get_firestore()
        if db is None or firestore is None:
            continue

        try:
            docs = list(
                db.collection("aiDetectionRetries")
                .where("status", "==", "queued")
                .limit(10)
                .stream()
            )
        except Exception as e:
            print(f"⚠️ Retry queue read failed: {e}")
            continue

        for doc in docs:
            data = doc.to_dict() or {}
            chat_id = int(data.get("chatId") or 0)
            chat_title = data.get("chatTitle") or "Unknown"
            sender = data.get("sender") or "Unknown"
            message_id = int(data.get("triggerMessageId") or 0)
            attempts = int(data.get("attempts") or 0)

            if not chat_id or not message_id:
                doc.reference.set(
                    {
                        "status": "error",
                        "lastError": "Invalid retry payload",
                        "updatedAt": firestore.SERVER_TIMESTAMP,
                    },
                    merge=True,
                )
                continue

            doc.reference.set(
                {
                    "status": "processing",
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                },
                merge=True,
            )

            action, needs_retry = await run_ai_pipeline(chat_id, chat_title)
            if needs_retry:
                doc.reference.set(
                    {
                        "status": "queued",
                        "attempts": attempts + 1,
                        "lastError": "Ilmu upstream timeout/unavailable",
                        "updatedAt": firestore.SERVER_TIMESTAMP,
                    },
                    merge=True,
                )
                continue

            if action is None:
                doc.reference.set(
                    {
                        "status": "no_action",
                        "attempts": attempts + 1,
                        "updatedAt": firestore.SERVER_TIMESTAMP,
                    },
                    merge=True,
                )
                continue

            req_type = action.get("type")
            payload = action.get("payload", {})
            if not req_type or not payload:
                doc.reference.set(
                    {
                        "status": "error",
                        "attempts": attempts + 1,
                        "lastError": "AI output missing type/payload",
                        "updatedAt": firestore.SERVER_TIMESTAMP,
                    },
                    merge=True,
                )
                continue

            task_id = await save_pending_task(
                req_type=req_type,
                payload=payload,
                chat_id=chat_id,
                chat_title=chat_title,
                sender=sender,
                message_id=message_id,
            )
            if task_id:
                doc.reference.set(
                    {
                        "status": "done",
                        "attempts": attempts + 1,
                        "pendingTaskId": task_id,
                        "updatedAt": firestore.SERVER_TIMESTAMP,
                    },
                    merge=True,
                )
                print(
                    f"📋 [RETRY->PENDING] Task '{req_type}' recovered from retry queue "
                    f"(retryDoc={doc.id}, pendingTask={task_id})"
                )
            else:
                doc.reference.set(
                    {
                        "status": "queued",
                        "attempts": attempts + 1,
                        "lastError": "Failed to save pending task",
                        "updatedAt": firestore.SERVER_TIMESTAMP,
                    },
                    merge=True,
                )

   
# =====================================================================
# Core message handler
# =====================================================================
async def process_message(client, message):
    chat_id = message.chat.id

    # Re-read selected chats on every message so app changes are live
    monitored = get_monitored_chat_ids()
    if not monitored:
        # No chats selected yet — ignore everything silently
        return
    if chat_id not in monitored:
        return

    chat_title = message.chat.title or "Private DM"
    sender = message.from_user.first_name if message.from_user else "Unknown/Channel"
    sender_id = message.from_user.id if message.from_user else 0
    direction = "outgoing" if message.outgoing else "incoming"
    content = message.text or message.caption or ""

    # --- Download media if present ---
    downloaded_file_path = None
    media_type: Optional[str] = None
    media_file_name: Optional[str] = None
    has_media = False
    is_image = False

    if message.photo:
        has_media = True
        media_type = "photo"
        is_image = True
        print(f"📥 Downloading photo from {sender}...")
        os.makedirs("temp_downloads/images", exist_ok=True)
        downloaded_file_path = await message.download(file_name="temp_downloads/images/")

    elif message.document:
        has_media = True
        media_file_name = message.document.file_name or "unknown_file"
        fname_lower = media_file_name.lower()

        if fname_lower.endswith((".jpg", ".jpeg", ".png", ".webp")):
            media_type = "photo"
            is_image = True
            print(f"📥 Downloading image document from {sender}...")
            os.makedirs("temp_downloads/images", exist_ok=True)
            downloaded_file_path = await message.download(file_name="temp_downloads/images/")
        else:
            media_type = "document"
            print(f"📥 Downloading document from {sender}...")
            os.makedirs("temp_downloads/docs", exist_ok=True)
            downloaded_file_path = await message.download(file_name="temp_downloads/docs/")

    # --- Console log ---
    direction_emoji = "➡️ [OUTGOING]" if message.outgoing else "⬅️ [INCOMING]"
    media_tag = f"📎 [{(media_type or '').upper()}: {media_file_name or ''}] " if has_media else ""
    display = f"{media_tag}{content}" if content else f"{media_tag}(No text/caption)"
    print(f"\n{direction_emoji} [{chat_title}] {sender}: {display}")

    # --- Deduplication check for images ---
    if downloaded_file_path and is_image:
        fingerprint = calculate_file_hash(downloaded_file_path)
        if fingerprint in PROCESSED_IMAGE_HASHES:
            print("🚫 Duplicate image — skipping AI to save quota.")
            os.remove(downloaded_file_path)
            return
        PROCESSED_IMAGE_HASHES.add(fingerprint)

    # --- Enrich text with AI description for media ---
    # For images: ask Gemini to describe the image (so it gets stored + used in history)
    # For documents: extract raw text
    enriched_text = content
    if downloaded_file_path:
        if is_image:
            print("🧠 Describing image with Gemini...")
            description = await asyncio.to_thread(describe_image_with_gemini, downloaded_file_path)
            enriched_text = f"{content}\n[Image description: {description}]".strip()
            print(f"🖼️ Image described: {description}")
        else:
            print("📄 Extracting document text...")
            doc_text = await asyncio.to_thread(extract_document_text, downloaded_file_path)
            enriched_text = f"{content}\n[Document content: {doc_text[:1000]}]".strip()

        # Clean up temp file after extraction
        try:
            os.remove(downloaded_file_path)
            print("🗑️ Temp file deleted.")
        except Exception:
            pass

    # 1. Save message to Firestore immediately (with enriched text for media)
    await save_message(
        chat_id=chat_id,
        chat_title=chat_title,
        sender=sender,
        sender_id=sender_id,
        direction=direction,
        text=enriched_text,
        has_media=has_media,
        media_type=media_type,
        media_file_name=media_file_name,
        telegram_message_id=message.id,
    )
    print("💾 Message saved to Firestore.")
    
    # 2. Generate AI response if not an outgoing message and AI responses are enabled
    if not message.outgoing and ENABLE_AI_RESPONSES and enriched_text:
        try:
            ai_response = await generate_ai_response(enriched_text, chat_title)
            if ai_response:
                print(f"🤖 [AI RESPONSE] {ai_response}")
                try:
                    await message.reply(ai_response)
                    print("✅ AI response sent!")
                except Exception as e:
                    print(f"⚠️ Failed to send AI response: {e}")
        except Exception as e:
            print(f"⚠️ Error generating AI response: {e}")
    
    # 3. Run AI on full chat history for task detection (optional)
    if not ENABLE_AI_TASK_DETECTION:
        print("ℹ️ AI task detection disabled; skipping Ilmu call.")
        return

    action, needs_retry = await run_ai_pipeline(chat_id, chat_title)
    if needs_retry:
        retry_id = await queue_detection_retry(
            chat_id=chat_id,
            chat_title=chat_title,
            sender=sender,
            message_id=message.id,
            reason="Ilmu unavailable while processing message",
        )
        if retry_id:
            print(
                f"🕒 [RETRY-QUEUED] Ilmu unavailable; queued detection retry "
                f"(retryDoc={retry_id}, messageId={message.id})"
            )
        else:
            print("⚠️ Failed to queue detection retry (Firebase not configured?)")
        return

    if action is not None:
        req_type = action.get("type")
        payload = action.get("payload", {})
        if req_type and payload:
            task_id = await save_pending_task(
                req_type=req_type,
                payload=payload,
                chat_id=chat_id,
                chat_title=chat_title,
                sender=sender,
                message_id=message.id,
            )
            if task_id:
                print(f"📋 [PENDING] Task '{req_type}' saved for user confirmation (ID: {task_id})")
                print(f"   Open the app → Crow AI tab to review and confirm it.")
            else:
                print("⚠️ Failed to save pending task (Firebase not configured?)")
# =====================================================================
# Entry point
# =====================================================================
async def main():
    global app, GLOBAL_TARGET_IDS

    # ── Wait for session ──────────────────────────────────────────────
    session = _read_session()
    if not session:
        print("[BOT] No Telegram session found.")
        print("[BOT] Open the app → Settings → Telegram Connect to log in.")
        print("[BOT] Waiting for pyrogram_session.txt to be created...")
        while not (session := _read_session()):
            await asyncio.sleep(3)
        print("[BOT] Session detected! Connecting to Telegram...")
    else:
        print("[BOT] Session loaded. Connecting to Telegram...")

    # ── Create and start client ───────────────────────────────────────
    if not api_id or not api_hash:
        print("[BOT] ERROR: TELEGRAM_API_ID or TELEGRAM_API_HASH missing in .env")
        return

    app = Client(
        session_name,
        session_string=session,
        api_id=api_id,
        api_hash=api_hash,
    )
    await app.start()
    print("[BOT] Connected to Telegram!")

    # ── Load .env chat IDs as in-memory fallback ──────────────────────
    env_ids = get_env("TARGET_CHAT_IDS")
    if env_ids:
        try:
            GLOBAL_TARGET_IDS = [int(x.strip()) for x in env_ids.split(",") if x.strip()]
            print(f"[BOT] Loaded {len(GLOBAL_TARGET_IDS)} chat(s) from TARGET_CHAT_IDS in .env")
        except ValueError:
            print("[BOT] WARN: Invalid TARGET_CHAT_IDS in .env — expected comma-separated integers.")

    # ── Wait for chat selection if none yet ───────────────────────────
    if not get_monitored_chat_ids():
        print("[BOT] No chats selected yet. Fetching your recent dialogs...")
        from pyrogram.enums import ChatType
        print("=" * 60)
        async for dialog in app.get_dialogs():
            if dialog.chat.type in [ChatType.GROUP, ChatType.SUPERGROUP, ChatType.PRIVATE]:
                name = dialog.chat.title or getattr(dialog.chat, "first_name", "") or "Unknown"
                if getattr(dialog.chat, "last_name", None):
                    name += f" {dialog.chat.last_name}"
                tag = "[DM]" if dialog.chat.type == ChatType.PRIVATE else "[GROUP]"
                print(f"  {tag} {name:40s} id={dialog.chat.id}")
        print("=" * 60)
        print("[BOT] Open the app → Settings → Monitored Chats and select chats.")
        print("[BOT] Polling every 5 s until a selection is saved...")
        while not get_monitored_chat_ids():
            await asyncio.sleep(5)
        ids = get_monitored_chat_ids()
        print(f"[BOT] Selection saved! Monitoring {len(ids)} chat(s): {ids}")

    # ── Register handler and start listening ──────────────────────────
    app.add_handler(MessageHandler(process_message))
    retry_worker = asyncio.create_task(process_detection_retry_queue())
    ids = get_monitored_chat_ids()
    print(f"[BOT] Listening to {len(ids)} chat(s). Chat selection updates live. (Ctrl+C to stop)")
    try:
        await idle()
    finally:
        retry_worker.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await retry_worker
        await app.stop()

if __name__ == "__main__":
    _loop.run_until_complete(main())