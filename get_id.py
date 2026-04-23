import asyncio
asyncio.set_event_loop(asyncio.new_event_loop())
from pyrogram import Client

api_id = "API_ID"       # Paste your api_id here
api_hash = "API_HASH"   # Paste your api_hash here

# Initialize the client
app = Client("my_account", api_id=api_id, api_hash=api_hash)

async def main():
    async with app:
        # Loop through all your dialogs (chats) and print their IDs
        async for dialog in app.get_dialogs():
            print(f"{dialog.chat.title or dialog.chat.first_name}: {dialog.chat.id}")

app.run(main())