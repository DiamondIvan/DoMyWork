import os
import asyncio
import json
from typing import Any, Optional

# Python 3.14 patch
asyncio.set_event_loop(asyncio.new_event_loop())

from pyrogram import Client, idle
from pyrogram.handlers import MessageHandler

from env_config import get_env, get_env_int

# =====================================================================
# Telegram credentials
# =====================================================================
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
GLOBAL_TARGET_IDS = [
    -5131370378,  # Group
    1088037939,      # DM
]

# =====================================================================
# Gemini AI (lazy init)
# =====================================================================
_GEMINI_MODEL: Any = None


def _get_gemini():
    global _GEMINI_MODEL
    if _GEMINI_MODEL is not None:
        return _GEMINI_MODEL
    try:
        import google.generativeai as genai  # type: ignore
    except ImportError:
        print("⚠️ google-generativeai not installed. Run: pip install google-generativeai")
        return None
    key = get_env("GEMINI_API_KEY")
    if not key:
        print("⚠️ GEMINI_API_KEY not set in .env — AI pipeline disabled.")
        return None
    genai.configure(api_key=key)
    _GEMINI_MODEL = genai.GenerativeModel("gemini-2.0-flash")
    return _GEMINI_MODEL


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

    ref, _ = db.collection("automationRequests").add(doc)
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
# AI Pipeline — Gemini reads full chat history and detects actions
# =====================================================================
_AI_PROMPT = """\
You are an AI assistant monitoring a Telegram conversation called "{chat_title}".

Read the entire conversation below and decide if there is an actionable task to automate.

Actionable tasks:
- Sending an email (e.g. "email John at john@example.com", "send a summary to someone")
- Creating a calendar event (e.g. "meeting tomorrow 3pm", "schedule a call on Friday", "remind me at 5pm")

If you detect an actionable task, respond with ONLY a valid JSON object in one of these exact formats:

Send email:
{{"type": "send_email", "payload": {{"to": "email@example.com", "subject": "...", "bodyText": "..."}}}}

Create calendar event:
{{"type": "create_calendar_event", "payload": {{"summary": "...", "description": "...", "start": "2026-04-24T15:00:00+08:00", "end": "2026-04-24T16:00:00+08:00", "attendees": []}}}}

If there is NO new actionable task, respond with ONLY: null

Rules:
- Reply with ONLY valid JSON or the word null — no markdown, no explanation.
- Use timezone offset +08:00 for all datetimes.
- Focus on the most recent unactioned task. Do NOT repeat actions for messages already discussed.
- If required details (email address, time) are genuinely unknown, return null.

Conversation:
{history}
"""


async def run_ai_pipeline(chat_id: int, chat_title: str) -> Optional[dict]:
    model = _get_gemini()
    if model is None:
        return None

    messages = await get_all_messages(chat_id)
    if not messages:
        return None

    history = "\n".join(
        f"[{m.get('direction', '?').upper()}] {m.get('sender', 'Unknown')}: "
        f"{m.get('text') or '(media)'}"
        for m in messages
    )

    prompt = _AI_PROMPT.format(chat_title=chat_title, history=history)

    try:
        response = await asyncio.to_thread(model.generate_content, prompt)
        raw = response.text.strip()
        print(f"🤖 Gemini: {raw}")

        if not raw or raw.lower() == "null":
            return None

        # Strip markdown code fences if the model adds them
        if raw.startswith("```"):
            lines = raw.splitlines()
            raw = "\n".join(lines[1:-1]).strip()

        return json.loads(raw)

    except json.JSONDecodeError:
        print(f"⚠️ Gemini returned invalid JSON: {raw}")
        return None
    except Exception as e:
        print(f"⚠️ Gemini error: {e}")
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

    if message.document:
        has_media = True
        media_type = "document"
        media_file_name = message.document.file_name
        print(f"📥 Downloading document from {sender}...")
        os.makedirs("temp_downloads", exist_ok=True)
        downloaded_file_path = await message.download(file_name="temp_downloads/")

    elif message.photo:
        has_media = True
        media_type = "photo"
        print(f"📥 Downloading photo from {sender}...")
        os.makedirs("temp_downloads", exist_ok=True)
        downloaded_file_path = await message.download(file_name="temp_downloads/")

    # --- Console log ---
    direction_emoji = "➡️ [OUTGOING]" if message.outgoing else "⬅️ [INCOMING]"
    media_tag = f"📎 [{(media_type or '').upper()}: {media_file_name or ''}] " if has_media else ""
    display = f"{media_tag}{content}" if content else f"{media_tag}(No text/caption)"
    print(f"\n{direction_emoji} [{chat_title}] {sender}: {display}")

    # 1. Save message to Firestore immediately
    await save_message(
        chat_id=chat_id,
        chat_title=chat_title,
        sender=sender,
        sender_id=sender_id,
        direction=direction,
        text=content,
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
            else:
                print("⚠️ Failed to enqueue (Firebase not configured?)")

    # 3. Handle downloaded file
    if downloaded_file_path:
        print(f"✅ File saved at: {downloaded_file_path}")
        # os.remove(downloaded_file_path)  # Uncomment to auto-delete after processing


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