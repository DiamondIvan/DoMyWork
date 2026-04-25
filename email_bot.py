import os
import time
import email
import imaplib
import json
import requests
import datetime
from email.header import decode_header
from typing import Optional, Any
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# =====================================================================
# Configuration
# =====================================================================
GMAIL_USER = os.getenv("GMAIL_USER", "").strip()
GMAIL_PASS = os.getenv("GMAIL_APP_PASSWORD", "").strip().replace(" ", "").replace('"', '').replace("'", "")
ILMU_API_KEY = os.getenv("ILMU_API_KEY", "").strip()
ILMU_API_KEY = "sk-b0ad8da654af17eb6c8cb5b1006be30c8ecb8c9e108dd875"
ILMU_BASE_URL = "https://api.ilmu.ai/v1/chat/completions"

if not GMAIL_USER or not GMAIL_PASS:
    raise ValueError("Missing GMAIL_USER or GMAIL_APP_PASSWORD in .env file")
if not ILMU_API_KEY:
    raise ValueError("Missing ILMU_API_KEY in .env file")

# =====================================================================
# Firestore (Replicated exactly from scheduler_bot.py)
# =====================================================================
_FIRESTORE_CLIENT: Any = None
_FIRESTORE_MODULE: Any = None

def _get_firestore():
    global _FIRESTORE_CLIENT, _FIRESTORE_MODULE
    if _FIRESTORE_CLIENT is not None and _FIRESTORE_MODULE is not None:
        return _FIRESTORE_CLIENT, _FIRESTORE_MODULE
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        print("⚠️ firebase-admin not installed. Run: pip install firebase-admin")
        return None, None

    if not firebase_admin._apps:
        sa_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if sa_path and os.path.exists(sa_path):
            try:
                firebase_admin.initialize_app(credentials.Certificate(sa_path))
            except Exception as e:
                print(f"⚠️ Firebase init failed: {e}")
                return None, None
        else:
            print("⚠️ Firebase key file not found. Check GOOGLE_APPLICATION_CREDENTIALS in .env")
            return None, None

    _FIRESTORE_CLIENT = firestore.client()
    _FIRESTORE_MODULE = firestore
    return _FIRESTORE_CLIENT, _FIRESTORE_MODULE

def save_email_message(sender: str, subject: str, body: str, email_id: str):
    """Saves the raw email using a clean, Gmail-specific schema."""
    db, firestore = _get_firestore()
    if db is None: return

    doc = {
        "platform": "gmail",
        "sender": sender,
        "subject": subject,
        "bodyText": body,          # Separated from the subject for cleaner data
        "emailId": str(email_id),  # Native naming
        "timestamp": firestore.SERVER_TIMESTAMP,
        "processed": False,
    }
    
    # Saving to a dedicated 'emails' collection instead of the 'chats' collection
    db.collection("emails").document(str(email_id)).set(doc)
    print("💾 [DATABASE] Email saved to Firestore 'emails' collection.")

def enqueue_automation_request(user_id: str, req_type: str, payload: dict, source: dict) -> Optional[str]:
    """Pushes the AI's JSON task to the automation queue."""
    db, firestore = _get_firestore()
    if db is None or firestore is None: return None

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

# =====================================================================
# Ilmu AI Pipeline
# =====================================================================
def call_ilmu_ai(system_prompt: str, user_content: str, retries: int = 5) -> Optional[str]:
    headers = {"Authorization": f"Bearer {ILMU_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": "ilmu-glm-5.1",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content}
        ],
        "temperature": 0.1
    }
    
    for attempt in range(retries):
        try:
            # THIS IS THE LINE TO CHECK! Make sure it says (10, 60)
            response = requests.post(ILMU_BASE_URL, headers=headers, json=payload, timeout=(10, 60))
            
            if response.status_code == 200:
                return response.json()['choices'][0]['message']['content'].strip()
            
            elif response.status_code in [500, 502, 503, 504]:
                wait_time = 4 * (attempt + 1)
                print(f"⚠️ [ILMU SERVER BUSY] Error {response.status_code}. Retrying in {wait_time}s...")
                time.sleep(wait_time)
            
            else:
                print(f"❌ [API FATAL ERROR]: {response.status_code} - {response.text}")
                return None 
                
        except (requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError):
            wait_time = 4 * (attempt + 1)
            print(f"⏳ [TIMEOUT] Long email processing (Attempt {attempt + 1}/{retries}). Retrying in {wait_time}s...")
            time.sleep(wait_time)
            
        except Exception as e:
            print(f"❌ [UNEXPECTED ERROR]: {e}")
            return None 
            
    print("🚨 [CRITICAL] Ilmu AI failed to respond after all retries. Task aborted.")
    return None

def analyze_email_with_ai(sender: str, subject: str, body: str, email_id: str):
    print("🧠 [AI CONTEXT] Analyzing email content for actionable tasks...")
    
    # Get the exact current time in Malaysia
    current_time = datetime.datetime.now().strftime("%A, %B %d, %Y at %I:%M %p")
    
    system_prompt = (
        "You are an executive assistant managing an inbox. "
        f"CRITICAL CONTEXT: Today's exact date and time is {current_time}. "
        "Use this current date to calculate vague deadlines like 'tomorrow', 'next Monday', or 'tonight'. "
        "Extract MANDATORY tasks: project meetings, deadlines, or requested actions. "
        "You MUST respond ONLY with a valid JSON object or the word 'null'."
    )
    
    user_content = f"""
    Email Details:
    From: {sender}
    Subject: {subject}
    Body: {body[:1500]} 

    Output format:
    - Calendar: {{"type": "create_calendar_event", "payload": {{"summary": "...", "description": "...", "start": "2026-04-26T15:00:00+08:00"}}}}
    - Task: {{"type": "add_to_do", "payload": {{"task": "...", "deadline": "..."}}}}
    
    If no clear action, return: null
    """

    raw = call_ilmu_ai(system_prompt, user_content)
    
    if not raw or raw.lower() == "null":
        print("💤 [AI RESULT] No mandatory tasks detected (Ignored/Promo).")
        return None
    
    try:
        if "```" in raw:
            raw = raw.split("```")[1].replace("json", "").strip()
        action = json.loads(raw)
        print(f"🎯 [AI RESULT] Task Found: {action.get('type')}")
        
        # --- NEW: ENQUEUE TO FIRESTORE ---
        req_type = action.get("type")
        payload = action.get("payload", {})
        
        if req_type and payload:
            source = {
                "email": {
                    "sender": sender,
                    "subject": subject,
                    "emailId": str(email_id)
                }
            }
            request_id = enqueue_automation_request(
                user_id="email:main_user", 
                req_type=req_type, 
                payload=payload, 
                source=source
            )
            if request_id:
                print(f"🔥 [SUCCESS] Enqueued automationRequests/{request_id} ({req_type})")
            else:
                print("⚠️ [WARNING] Failed to enqueue to Firebase.")

    except Exception as e:
        print(f"⚠️ [AI ERROR]: Invalid JSON returned: {e}")

# =====================================================================
# Email Extraction Helpers
# =====================================================================
def clean_header(header_text):
    if not header_text: return "Unknown"
    decoded_fragments = decode_header(header_text)
    header_string = ""
    for content, encoding in decoded_fragments:
        if isinstance(content, bytes):
            header_string += content.decode(encoding or "utf-8", errors="ignore")
        else:
            header_string += content
    return header_string

def get_email_body(msg):
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition"))
            if content_type == "text/plain" and "attachment" not in content_disposition:
                return part.get_payload(decode=True).decode("utf-8", errors="ignore")
    else:
        return msg.get_payload(decode=True).decode("utf-8", errors="ignore")
    return ""

# =====================================================================
# Main Loop (Listening for New Emails Only)
# =====================================================================
def monitor_inbox():
    print("\n" + "="*50)
    print("📧 [STATUS]: DoMyWork Email Bot is starting...")
    print("="*50 + "\n")
    
    try:
        imap = imaplib.IMAP4_SSL("imap.gmail.com")
        imap.login(GMAIL_USER, GMAIL_PASS)
        print("✅ [CONNECTED]: Successfully logged into Gmail.")
    except Exception as e:
        print(f"❌ [LOGIN FAILED]: {e}")
        return

    print("🎧 [LISTENING]: Waiting for new emails to arrive...\n")

    while True:
        try:
            imap.select("INBOX")
            status, messages = imap.search(None, "UNSEEN")
            
            if not messages[0]:
                time.sleep(5) 
                continue
                
            email_ids = messages[0].split()
                
            for e_id in email_ids:
                # Convert bytes to string for Firebase compatibility
                safe_email_id = e_id.decode('utf-8')
                
                _, msg_data = imap.fetch(e_id, "(RFC822)")
                for response_part in msg_data:
                    if isinstance(response_part, tuple):
                        msg = email.message_from_bytes(response_part[1])
                        
                        subject = clean_header(msg.get("Subject"))
                        sender = clean_header(msg.get("From"))
                        body = get_email_body(msg)
                        
                        print("-" * 50)
                        print(f"🔔 [NEW EMAIL DETECTED] From: {sender} | Subject: {subject}")
                        
                        # 1. Save the raw email to Firestore history
                        save_email_message(sender, subject, body, safe_email_id)
                        
                        # 2. Process with AI and Enqueue task
                        analyze_email_with_ai(sender, subject, body, safe_email_id)
                        
                        # 3. Mark as read to avoid loops
                        imap.store(e_id, '+FLAGS', '\\Seen')
            
            print("\n🎧 [LISTENING]: Done processing. Waiting for the next email...")
            
        except Exception as e:
            print(f"⚠️ [SYSTEM WARNING]: Connection hiccup, retrying... ({e})")
            time.sleep(5)

if __name__ == "__main__":
    monitor_inbox()