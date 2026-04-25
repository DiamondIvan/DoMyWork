import os
import asyncio
import json
import hashlib
from typing import Any, Optional
import requests
# Python 3.14 patch
asyncio.set_event_loop(asyncio.new_event_loop())
import base64
from openai import OpenAI # Ensure this is at the top
from pyrogram import Client, idle
from pyrogram.handlers import MessageHandler

from env_config import get_env, get_env_int

# =====================================================================
# Telegram credentials# =====================================================================
api_id = get_env_int("TELEGRAM_API_ID", fallback_names=["api_id"])
api_hash = get_env("TELEGRAM_API_HASH", fallback_names=["api_hash"])
session_name = get_env("PYROGRAM_SESSION_NAME", default="my_account")
session_string = get_env("PYROGRAM_SESSION_STRING")

if session_string:
    app = Client(session_name, session_string=session_string)
else:
    if api_id is None or not api_hash:
        raise RuntimeError(
            "Missing Telegram credentials. Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env."
        )
    app = Client(session_name, api_id=api_id, api_hash=api_hash)

# =====================================================================
# Target chats — paste IDs from get_id.py here
# =====================================================================
GLOBAL_TARGET_IDS = [-5100901072, -5121186491, -5126239079]

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
# Ilmu AI (Lazy Init Replacement for Gemini)
# =====================================================================
ILMU_API_KEY = "sk-b0ad8da654af17eb6c8cb5b1006be30c8ecb8c9e108dd875"
ILMU_BASE_URL = "https://api.ilmu.ai/v1/chat/completions"

def call_ilmu_ai(system_prompt: str, user_content: str) -> Optional[str]:
    """Helper to call Ilmu AI via HTTP requests."""
    headers = {
        "Authorization": f"Bearer {ILMU_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "ilmu-glm-5.1",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ],
        "stream": False,
        "temperature": 0.1  # Low temperature for strict JSON output
    }
    try:
        response = requests.post(ILMU_BASE_URL, headers=headers, json=payload, timeout=30)
        if response.status_code == 200:
            return response.json()['choices'][0]['message']['content'].strip()
        print(f"⚠️ Ilmu API Error {response.status_code}: {response.text}")
        return None
    except Exception as e:
        print(f"❌ Ilmu Request Failed: {e}")
        return None

# =====================================================================
# GPT-4o-mini Integration (Replacement for Ilmu/Gemini)
# =====================================================================
OPENAI_API_KEY = get_env("OPENAI_API_KEY")
gpt_client = OpenAI(api_key=OPENAI_API_KEY)

def describe_image_with_gpt(image_path: str) -> str:
    """Uses GPT-4o-mini to actually see and describe the image."""
    try:
        with open(image_path, "rb") as image_file:
            base64_image = base64.b64encode(image_file.read()).decode('utf-8')

        response = gpt_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": "What is in this image? Focus on dates, times, and tasks for a calendar."},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                ],
            }],
            max_tokens=300
        )
        return response.choices[0].message.content
    except Exception as e:
        print(f"❌ [GPT VISION ERROR]: {e}")
        return "(Image received - failed to describe)"
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
def _get_all_messages_sync(chat_id: int) -> list:
    db, _ = _get_firestore()
    if db is None:
        return []
    docs = (
        db.collection("chats")
        .document(str(chat_id))
        .collection("messages")
        .order_by("timestamp")
        .stream()
    )
    return [d.to_dict() for d in docs]


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
# AI Pipeline — Ilmu reads chat history and detects actions
# =====================================================================
async def run_ai_pipeline(chat_id: int, chat_title: str) -> Optional[dict]:
    # Fetch history from Firestore
    messages = await get_all_messages(chat_id)
    if not messages:
        return None
    print(f"🧠 [AI CONTEXT] Analyzing last {len(messages)} messages for actionable tasks...")

    # Format history for the AI context
    history = "\n".join(
        f"[{m.get('direction', '?').upper()}] {m.get('sender', 'Unknown')}: "
        f"{m.get('text') or '(media)'}"
        for m in messages
    )
    system_prompt = (
        f"You are a strict scheduling assistant for the Telegram chat '{chat_title}'. "
        "Extract MANDATORY tasks: project meetings, deadlines, or emails. Ignore spam/ads. "
        "You MUST respond ONLY with a valid JSON object or the word 'null'."
    )

    user_content = f"""
    Based on the following history, detect if a new mandatory task is needed:
    {history}

    Output format:
    - Email: {{"type": "send_email", "payload": {{"to": "...", "subject": "...", "bodyText": "..."}}}}
    - Calendar: {{"type": "create_calendar_event", "payload": {{"summary": "...", "description": "...", "start": "2026-04-24T15:00:00+08:00", "end": "2026-04-24T16:00:00+08:00"}}}}
   
    If no action, return: null
    """

    # Run the request in a thread to keep the bot responsive
    raw = await asyncio.to_thread(call_ilmu_ai, system_prompt, user_content)
    if not raw or raw.lower() == "null":
        print("💤 [AI RESULT] No mandatory tasks detected.")
        return None
    else:
        print(f"🎯 [AI RESULT] Task Found: {raw}")

    try:
        # Strip potential markdown fences Ilmu might add
        if "```" in raw:
            raw = raw.split("```")[1].replace("json", "").strip()
        return json.loads(raw)
    except Exception as e:
        print(f"⚠️ AI JSON Error: {e} | Raw Output: {raw}")
        return None
   
# =====================================================================
# Core message handler
# =====================================================================
async def process_message(client, message):
    chat_id = message.chat.id

    # Only process monitored chats
    if chat_id not in GLOBAL_TARGET_IDS:
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
            description = await asyncio.to_thread(describe_image_with_gpt, downloaded_file_path)
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
    # 2. Run AI on full chat history
    action = await run_ai_pipeline(chat_id, chat_title)

    if action is not None:
        req_type = action.get("type")
        payload = action.get("payload", {})
        if req_type and payload:
            user_id = f"telegram:{sender_id}"
            source = {
                "telegram": {
                    "chatId": chat_id,
                    "messageId": message.id,
                    "sender": sender,
                    "direction": direction,
                }
            }
            request_id = await enqueue_automation_request(
                user_id=user_id,
                req_type=req_type,
                payload=payload,
                source=source,
            )
            if request_id:
                print(f"🔥 Enqueued automationRequests/{request_id} ({req_type})")
                print(f"🚀 [SUCCESS] Task '{req_type}' pushed to Firestore (ID: {request_id})")
            else:
                print("⚠️ Failed to enqueue (Firebase not configured?)")
# =====================================================================
# Entry point
# =====================================================================
async def main():
    if not GLOBAL_TARGET_IDS:
        print("⚠️ GLOBAL_TARGET_IDS is empty. Run get_id.py and add IDs first!")
        return
    app.add_handler(MessageHandler(process_message))
    print(f"\n🤖 DoMyWork is listening to {len(GLOBAL_TARGET_IDS)} chat(s)... (Ctrl+C to stop)")
    await app.start()
    await idle()
    await app.stop()
if __name__ == "__main__":
    app.run(main())