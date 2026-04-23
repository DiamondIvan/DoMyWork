import os
import asyncio
# Python 3.14 patch
asyncio.set_event_loop(asyncio.new_event_loop())

from pyrogram import Client, idle
from pyrogram.handlers import MessageHandler

# 🚨 PUT YOUR NEW, RESET KEYS HERE 🚨
api_id = "YOUR_API_ID"       
api_hash = "YOUR_API_HASH"   

# If you generated a session string for cloud hosting, you can swap this initialization:
# app = Client("my_account", session_string="YOUR_SESSION_STRING")
app = Client("my_account", api_id=api_id, api_hash=api_hash)

# =====================================================================
# 🎯 HARDCODED TARGET GROUPS
# Put the chat IDs you grabbed from get_id.py here.
# =====================================================================
GLOBAL_TARGET_IDS = [
    -100123456789,  # Example Group ID
    1234567890      # Example DM ID
]

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
    
    # 3. IF WE DOWNLOADED A FILE, PROCESS IT
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