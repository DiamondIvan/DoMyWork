import os
import asyncio
import json
from typing import Any, Optional, Tuple
# Python 3.14 patch
asyncio.set_event_loop(asyncio.new_event_loop())

from pyrogram import Client, idle
from pyrogram.handlers import MessageHandler

from env_config import get_env, get_env_int

# Telegram API credentials (loaded from .env)
# Supports either standard names (TELEGRAM_API_ID / TELEGRAM_API_HASH)
# or your existing .env keys (api_id / api_hash).
api_id = get_env_int("TELEGRAM_API_ID", fallback_names=["api_id"])
api_hash = get_env("TELEGRAM_API_HASH", fallback_names=["api_hash"])

session_name = get_env("PYROGRAM_SESSION_NAME", default="my_account")
session_string = get_env("PYROGRAM_SESSION_STRING")

if session_string:
    app = Client(session_name, session_string=session_string)
else:
    if api_id is None or not api_hash:
        raise RuntimeError(
            "Missing Telegram credentials. Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env "
            "(or api_id/api_hash)."
        )
    app = Client(session_name, api_id=api_id, api_hash=api_hash)

# =====================================================================
# 🎯 HARDCODED TARGET GROUPS
# Put the chat IDs you grabbed from get_id.py here.
# =====================================================================
GLOBAL_TARGET_IDS = [
    -100123456789,  # Example Group ID
    1234567890      # Example DM ID
]

# =====================================================================
# Firebase (Firestore) integration
#
# This bot can enqueue "automationRequests" documents in Firestore.
# A Firebase Cloud Function then picks them up and does Gmail/Calendar work.
#
# Requirements:
# - pip install firebase-admin
# - set GOOGLE_APPLICATION_CREDENTIALS to a Firebase Admin SDK service account JSON path
#   (or run in an environment with Application Default Credentials).
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
        print(
            "⚠️ Firebase is not configured. Install with: pip install firebase-admin\n"
            "   Then set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path."
        )
        return None, None

    if not firebase_admin._apps:
        service_account_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or os.getenv(
            "FIREBASE_SERVICE_ACCOUNT_KEY_PATH"
        )
        try:
            if service_account_path and os.path.exists(service_account_path):
                firebase_admin.initialize_app(
                    credentials.Certificate(service_account_path)
                )
            else:
                firebase_admin.initialize_app()
        except Exception as e:
            print(f"⚠️ Failed to initialize Firebase Admin SDK: {e}")
            return None, None

    _FIRESTORE_CLIENT = firestore.client()
    _FIRESTORE_MODULE = firestore
    return _FIRESTORE_CLIENT, _FIRESTORE_MODULE


def _parse_automation_command(content: str) -> Optional[Tuple[str, dict]]:
    """Parse a manual trigger format so you can test the pipeline quickly.

    Format:
      /automation {"type":"send_email","payload":{...}}
      /automation {"type":"create_calendar_event","payload":{...}}
    """

    content = (content or "").strip()
    if not content.lower().startswith("/automation"):
        return None

    parts = content.split(" ", 1)
    if len(parts) < 2:
        return None

    try:
        data = json.loads(parts[1])
    except Exception:
        return None

    req_type = data.get("type")
    payload = data.get("payload")
    if not isinstance(req_type, str) or not isinstance(payload, dict):
        return None

    return req_type, payload


def _enqueue_automation_request_sync(*, user_id: str, req_type: str, payload: dict, source: dict) -> Optional[str]:
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


async def enqueue_automation_request(*, user_id: str, req_type: str, payload: dict, source: dict) -> Optional[str]:
    return await asyncio.to_thread(
        _enqueue_automation_request_sync,
        user_id=user_id,
        req_type=req_type,
        payload=payload,
        source=source,
    )

# --- THE MESSAGE PROCESSOR ---
async def process_message(client, message):
    chat_id = message.chat.id
    
    # MANUAL FILTER: Drop anything not in our list
    if chat_id not in GLOBAL_TARGET_IDS:
        return

    chat_title = message.chat.title or "Private DM"
    sender = message.from_user.first_name if message.from_user else "Unknown/Channel"
    
    # 1. Grab text or caption if it exists
    content = message.text or message.caption or ""
    
    # 2. Check for attached files/images and DOWNLOAD them
    downloaded_file_path = None
    media_tag = ""
    
    if message.document:
        media_tag = f"📎 [DOCUMENT: {message.document.file_name}] "
        print(f"📥 Downloading document from {sender}...")
        # Downloads to a specific folder to keep your directory clean
        downloaded_file_path = await message.download(file_name="temp_downloads/")
        
    elif message.photo:
        media_tag = "🖼️ [IMAGE] "
        print(f"📥 Downloading image from {sender}...")
        downloaded_file_path = await message.download(file_name="temp_downloads/")

    # Combine text and media tags for the console
    final_output = f"{media_tag}{content}" if content else f"{media_tag}(No text/caption attached)"
    
    direction = "➡️ [OUTGOING]" if message.outgoing else "⬅️ [INCOMING]"
    print(f"\n{direction} [{chat_title}] {sender}: {final_output}")

    # 3. OPTIONAL: Enqueue a Firestore automation request
    #
    # In the real flow, your AI should convert the message into an action like:
    #   { type: "send_email", payload: { ... } }
    # or
    #   { type: "create_calendar_event", payload: { ... } }
    #
    # For now, you can test end-to-end by sending a message like:
    #   /automation {"type":"send_email","payload":{"to":"x@y.com","subject":"Hi","bodyText":"Hello"}}
    #
    action = _parse_automation_command(content)
    if action is not None:
        req_type, payload = action
        telegram_user_id = message.from_user.id if message.from_user else "unknown"
        user_id = f"telegram:{telegram_user_id}"

        source = {
            "telegram": {
                "chatId": chat_id,
                "messageId": message.id,
                "sender": sender,
                "direction": "outgoing" if message.outgoing else "incoming",
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
            print("⚠️ Failed to enqueue automation request (Firebase not configured?)")
    
    # 4. IF WE DOWNLOADED A FILE, PROCESS IT
    if downloaded_file_path:
        print(f"✅ File saved successfully at: {downloaded_file_path}")
        
        # ==========================================
        # AI PIPELINE GOES HERE
        # e.g., Pass downloaded_file_path to Gemini API
        # ==========================================
        
        # ALWAYS delete the file after the AI reads it so your hard drive doesn't fill up
        # os.remove(downloaded_file_path)

async def main():
    if not GLOBAL_TARGET_IDS:
        print("⚠️ Your GLOBAL_TARGET_IDS list is empty. Add IDs from get_id.py first!")
        return

    # Catches all text and media messages
    app.add_handler(MessageHandler(process_message))

    print(f"\n🤖 AI Agent is actively listening to {len(GLOBAL_TARGET_IDS)} target(s)... (Press Ctrl+C to stop)")
    
    await app.start()
    await idle() 
    await app.stop()

if __name__ == "__main__":
    app.run(main())