import asyncio
# Python 3.14 patch
asyncio.set_event_loop(asyncio.new_event_loop())

from pyrogram import Client
from pyrogram.enums import ChatType

from env_config import get_env, get_env_int

# Telegram API credentials (loaded from .env)
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

async def main():
    print("\nLoading your chats (this might take a few seconds)...")
    print("="*60)
    
    async with app:
        async for dialog in app.get_dialogs():
            # Filter for Groups, Supergroups, and Private DMs
            if dialog.chat.type in [ChatType.GROUP, ChatType.SUPERGROUP, ChatType.PRIVATE]:
                
                # Handle naming logic
                name = dialog.chat.title or dialog.chat.first_name
                if dialog.chat.last_name:
                     name += f" {dialog.chat.last_name}"
                
                # Tag it visually
                tag = "[DM]" if dialog.chat.type == ChatType.PRIVATE else "[GROUP]"
                
                # Print the Name and the ID
                print(f"{tag} {name}: {dialog.chat.id}")
                
    print("="*60)

if __name__ == "__main__":
    try:
        app.run(main())
    except KeyboardInterrupt:
        print("\nCancelled login. Re-run and enter your phone number (with +countrycode) or bot token when prompted.")
