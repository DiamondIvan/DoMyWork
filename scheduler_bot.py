import asyncio
import os
import hashlib # NEW: Used for creating image fingerprints
import google.generativeai as genai
import PIL.Image
import fitz  # PyMuPDF for PDFs
import docx  # python-docx for Word files
from datetime import datetime

# Python 3.14 patch
asyncio.set_event_loop(asyncio.new_event_loop())

from pyrogram import Client, idle
from pyrogram.handlers import MessageHandler

# 🚨 PUT YOUR NEW TELEGRAM KEYS HERE 🚨
api_id = "telegram_api_id"       
api_hash = "telegram_api_hash"

# ========================================================
# 🧠 GEMINI AI SETUP
# ========================================================
GEMINI_API_KEY = "AIzaSyC1nOD6WMf3TFW7nS_zg3REnk8chFcaqpo" # ⚠️ REPLACE THIS WITH A BRAND NEW KEY
genai.configure(api_key=GEMINI_API_KEY)

gemini_model = genai.GenerativeModel('gemini-2.5-flash')

app = Client("my_account", api_id=api_id, api_hash=api_hash)

GLOBAL_TARGET_IDS = [
    -5126239079,     # test group
    -5121186491,
    -5100901072
]

# ========================================================
# 🛡️ DEDUPLICATION MEMORY
# Stores the fingerprints of images we've already seen.
# ========================================================
PROCESSED_IMAGE_HASHES = set()

def calculate_file_hash(filepath):
    """Reads a file and generates a unique MD5 fingerprint."""
    hasher = hashlib.md5()
    with open(filepath, 'rb') as f:
        buf = f.read()
        hasher.update(buf)
    return hasher.hexdigest()

# --- HELPER 1: Extract Text from Documents ---
def extract_document_text(file_path):
    text = ""
    try:
        if file_path.endswith('.pdf'):
            doc = fitz.open(file_path)
            for page in doc:
                text += page.get_text() + "\n"
        elif file_path.endswith(('.docx', '.doc')):
            doc = docx.Document(file_path)
            for para in doc.paragraphs:
                text += para.text + "\n"
        else:
            text = "[Unsupported document format for text extraction]"
    except Exception as e:
        print(f"❌ Error reading document: {e}")
    return text.strip()

# --- HELPER 2: Send Data to Gemini AI ---
def analyze_with_gemini(text_content="", image_path=None):
    now = datetime.now()
    current_date_str = now.strftime("%A, %B %d, %Y") 
    current_time_str = now.strftime("%I:%M %p")      

    # 🛑 THE NEW ANTI-SPAM PROMPT
    system_prompt = f"""
    You are a strict scheduling assistant. 
    Your goal is to extract personal, mandatory tasks/meetings and IGNORE promotional spam.
    
    CRITICAL CONTEXT: Today is {current_date_str} at {current_time_str}. 
    
    DEFINITIONS:
    - MANDATORY: Project meetings, committee syncs, assignment deadlines, classes. (Actionable)
    - PROMO_SPAM: Public cultural festivals, club recruitment blasts, general campus advertisements, optional webinars. (Not Actionable)
    
    Output ONLY raw JSON exactly like this:
    {{
      "is_actionable": true or false,
      "category": "MANDATORY" or "PROMO_SPAM" or "NONE",
      "title": "Short task name or Deadline",
      "date": "Exact calculated calendar date (YYYY-MM-DD), or TBD",
      "time": "Exact time, or TBD",
      "reason": "Explain in 1 sentence why you classified it this way"
    }}
    
    Do not use markdown formatting, just return the raw JSON text.
    """
    
    try:
        if image_path:
            with PIL.Image.open(image_path) as img:
                response = gemini_model.generate_content([system_prompt, img])
        else:
            full_prompt = f"{system_prompt}\n\nDATA TO ANALYZE:\n{text_content}"
            response = gemini_model.generate_content(full_prompt)
            
        return response.text.strip()
        
    except Exception as e:
        return f"❌ Gemini AI Error: {e}"

# --- THE MESSAGE PROCESSOR ---
async def process_message(client, message):
    chat_id = message.chat.id
    if chat_id not in GLOBAL_TARGET_IDS:
        return

    chat_title = message.chat.title or "Private DM"
    sender = message.from_user.first_name if message.from_user else "Unknown/Channel"
    
    content = message.text or message.caption or ""
    downloaded_file_path = None
    media_tag = ""
    is_image = False
    
    # ==========================================
    # 📥 SMART MEDIA ROUTER
    # ==========================================
    if message.photo:
        media_tag = "🖼️ [PHOTO] "
        downloaded_file_path = await message.download(file_name="Images/")
        is_image = True
        
    elif message.document:
        file_name = message.document.file_name.lower() if message.document.file_name else "unknown_file"
        media_tag = f"📎 [DOCUMENT: {message.document.file_name}] "
        
        if file_name.endswith(('.jpg', '.jpeg', '.png', '.webp')):
            downloaded_file_path = await message.download(file_name="Images/")
            is_image = True
        else:
            downloaded_file_path = await message.download(file_name="Docs_File/")

    direction = "➡️ [OUTGOING]" if message.outgoing else "⬅️ [INCOMING]"
    print(f"\n{direction} [{chat_title}] {sender}: {media_tag}{content}")
    
    # ==========================================
    # 🛡️ DEDUPLICATION CHECK (HASHING)
    # ==========================================
    if downloaded_file_path and is_image:
        file_fingerprint = calculate_file_hash(downloaded_file_path)
        
        if file_fingerprint in PROCESSED_IMAGE_HASHES:
            print("🚫 DUPLICATE IMAGE DETECTED! Skipping AI to save memory and quota.")
            if os.path.exists(downloaded_file_path):
                os.remove(downloaded_file_path)
            return # Stops the function right here!
            
        else:
            # It's a new image! Add fingerprint to memory and continue
            PROCESSED_IMAGE_HASHES.add(file_fingerprint)

    # ==========================================
    # 🧠 PROCESS FILE & SEND TO GEMINI
    # ==========================================
    ai_result = None

    if downloaded_file_path:
        print("🧠 Analyzing new file with Gemini...")
        
        if is_image:
            ai_result = analyze_with_gemini(image_path=downloaded_file_path)
        else:
            extracted_text = extract_document_text(downloaded_file_path)
            full_text = f"Caption: {content}\nDocument Content: {extracted_text}"
            ai_result = analyze_with_gemini(text_content=full_text)
            
        if os.path.exists(downloaded_file_path):
            os.remove(downloaded_file_path)
            print("🗑️ Temp file deleted.")

    elif content:
         print("🧠 Analyzing text with Gemini...")
         ai_result = analyze_with_gemini(text_content=content)

    if ai_result:
        print("\n✨ GEMINI AI OUTPUT ✨")
        print(ai_result)
        print("===================\n")

async def main():
    if not GLOBAL_TARGET_IDS:
        print("⚠️ Your GLOBAL_TARGET_IDS list is empty.")
        return

    app.add_handler(MessageHandler(process_message))
    print(f"\n🤖 AI Agent is actively listening... (Press Ctrl+C to stop)")
    await app.start()
    await idle() 
    await app.stop()

if __name__ == "__main__":
    app.run(main())