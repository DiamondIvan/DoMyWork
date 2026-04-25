# Telegram & AI Integration - Quick Start Guide

## 5-Minute Setup

### Step 1: Get Telegram API Credentials

1. Go to https://my.telegram.org
2. Sign in with your Telegram account
3. Click "API development tools"
4. Create a new application
5. Copy your `api_id` and `api_hash`

### Step 2: Configure Environment

Create/update `.env` file:

```env
TELEGRAM_API_ID=123456789
TELEGRAM_API_HASH=your_api_hash_here
ILMU_API_KEY=your_ilmu_key_here
ENABLE_TELEGRAM_AI_RESPONSES=true
TARGET_CHAT_IDS=123456789  # Your personal chat ID
```

### Step 3: Authenticate via App

1. Open Settings in DoMyWork app
2. Find Telegram section
3. Enter your phone: `+60123456789` (with country code)
4. Tap "Send Code"
5. Enter code from Telegram app
6. Tap "Sign In"
7. Copy the session string displayed
8. Add to `.env`: `PYROGRAM_SESSION_STRING=<copied_string>`

### Step 4: Start Services

Terminal 1:

```bash
python -m uvicorn telegram_api:app --host 0.0.0.0 --port 5000 --reload
```

Terminal 2:

```bash
python scheduler_bot.py
```

### Step 5: Test It!

Send a message in a monitored Telegram chat. The bot will:

- ✅ Reply with AI response
- ✅ Detect tasks
- ✅ Queue automations

## Common Commands

### Send Message from Frontend

```javascript
import TelegramService from "../services/TelegramService";

await TelegramService.sendMessage(
  sessionString,
  chatId,
  "Hello from DoMyWork!",
);
```

### Get User's Chats

```javascript
const chats = await TelegramService.getChats(sessionString);
console.log(chats);
```

### Process with AI

```javascript
const reply = await TelegramService.processMessageWithAI(
  "What meetings do I have tomorrow?",
);
console.log(reply);
```

## File Changes Summary

### Modified Files:

- `telegram_api.py` - Added 4 new endpoints
- `scheduler_bot.py` - Added AI response generation

### New Files:

- `src/services/TelegramService.js` - Frontend client library
- `TELEGRAM_AI_INTEGRATION.md` - Full documentation

## Troubleshooting

### Bot not replying?

```env
# Make sure this is enabled
ENABLE_TELEGRAM_AI_RESPONSES=true

# And your API key is valid
ILMU_API_KEY=valid_key_here
```

### Session expired?

```bash
# Restart the bot
python scheduler_bot.py
```

### Can't find your chat ID?

Run the bot once and it will list your chats:

```bash
python scheduler_bot.py
# It will print all your chats with IDs
```

## What Happens When?

| Event                                | Action                               |
| ------------------------------------ | ------------------------------------ |
| User sends message to monitored chat | Bot saves to Firestore               |
| Message received                     | AI generates conversational response |
| New task detected                    | Task enqueued to Firestore           |
| Automation processed                 | Calendar created or email sent       |

## Need Help?

See full documentation: [TELEGRAM_AI_INTEGRATION.md](TELEGRAM_AI_INTEGRATION.md)

Key sections:

- Backend Setup → Environment Variables
- Frontend Integration → Using TelegramService
- Troubleshooting → Common Issues
