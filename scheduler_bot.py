import asyncio
# Python 3.14 patch
asyncio.set_event_loop(asyncio.new_event_loop())
import os

from pyrogram import Client, idle
from pyrogram.handlers import MessageHandler

# 🚨 PUT YOUR NEW, RESET KEYS HERE 🚨
api_id = "API_ID"       # Paste your api_id here
api_hash = "API_HASH"   # Paste your api_hash here

app = Client("my_account", api_id=api_id, api_hash=api_hash)

# =====================================================================
# 🎯 HARDCODED TARGET GROUPS
# Put the chat IDs of the groups you want to monitor here.
# (e.g., your MulPub team, WIX1002 study group, or project stakeholders)
# =====================================================================
GLOBAL_TARGET_IDS = [
    -5126239079     # test
]

# --- THE MESSAGE PROCESSOR ---
async def process_message(client, message):
    chat_id = message.chat.id
    if chat_id not in GLOBAL_TARGET_IDS:
        return

    chat_title = message.chat.title or "Private DM"
    sender = message.from_user.first_name if message.from_user else "Unknown/Channel"
    
    # 1. Grab text or caption if it exists
    content = message.text or message.caption or ""
    
    # 2. Check for attached files/images and DOWNLOAD them
    downloaded_file_path = r'C:\Users\User\Documents\UM\Schedule_APP\DoMyWork\My_downloads'
    media_tag = ""
    
    if message.document:
        media_tag = f"📎 [DOCUMENT: {message.document.file_name}] "
        print(f"📥 Downloading document from {sender}...")
        downloaded_file_path = await message.download(file_name="Docs_File/")
        
    elif message.photo:
        media_tag = "🖼️ [IMAGE] "
        print(f"📥 Downloading image from {sender}...")
        downloaded_file_path = await message.download(file_name="Images/")

    # Combine text and media tags for the console
    final_output = f"{media_tag}{content}" if content else f"{media_tag}(No text/caption attached)"
    
    direction = "➡️ [OUTGOING]" if message.outgoing else "⬅️ [INCOMING]"
    print(f"\n{direction} [{chat_title}] {sender}: {final_output}")
    
    # 3. IF WE DOWNLOADED A FILE, PROCESS IT
    if downloaded_file_path:
        print(f"✅ File saved successfully at: {downloaded_file_path}")
        
        # ==========================================
        # NOW PYTHON MUST READ THE FILE
        # ==========================================
        # Example: if downloaded_file_path.endswith('.pdf'):
        #     extracted_text = extract_pdf_text(downloaded_file_path)
        #     content += f" [Extracted PDF Text: {extracted_text}]"
        
        # Finally, delete the file so your hard drive doesn't fill up!
        # os.remove(downloaded_file_path)
    
    # ==========================================
    # AI PIPELINE INTEGRATION POINT
    # Note: To extract text from inside an image or PDF document, 
    # you will need to pass the file to an OCR tool or Gemini 1.5 Flash 
    # by downloading it first: await message.download()
    # ==========================================

async def main():
    if not GLOBAL_TARGET_IDS:
        print("⚠️ Your GLOBAL_TARGET_IDS list is empty. Add some IDs first!")
        return

    # Notice: No filters.text here anymore. It catches EVERYTHING.
    app.add_handler(MessageHandler(process_message))

    print(f"\n🤖 AI Agent is actively listening to {len(GLOBAL_TARGET_IDS)} target(s)... (Press Ctrl+C to stop)")
    
    await app.start()
    await idle() 
    await app.stop()

if __name__ == "__main__":
    app.run(main())