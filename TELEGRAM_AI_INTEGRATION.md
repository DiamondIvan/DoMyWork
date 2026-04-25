# Telegram & AI Backend Integration Guide

## Overview

This guide documents the complete wiring of Telegram bot functionality and AI integration with your DoMyWork backend.

## Architecture

### Components

1. **FastAPI Backend** (`telegram_api.py`) - REST endpoints for Telegram operations
2. **Pyrogram Bot** (`scheduler_bot.py`) - Telegram bot client for message handling
3. **Firebase Functions** - Automation request processing (calendar, email)
4. **Ilmu AI** - Language model for conversational responses and task detection
5. **React Native Frontend** - Chat interface and Telegram settings

## Backend Setup

### 1. Environment Variables

Add to your `.env` file:

```env
# Telegram API Credentials
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash

# Ilmu AI Configuration
ILMU_API_KEY=your_ilmu_api_key
ILMU_BASE_URL=https://api.ilmu.ai/v1/chat/completions
ILMU_MODEL=ilmu-glm-5.1

# Bot Configuration
TARGET_CHAT_IDS=123456789,987654321  # Comma-separated chat IDs to monitor
PYROGRAM_SESSION_NAME=my_account
PYROGRAM_SESSION_STRING=your_session_string  # Generated after first login

# Enable AI responses in Telegram
ENABLE_TELEGRAM_AI_RESPONSES=true

# Firebase Configuration
GOOGLE_APPLICATION_CREDENTIALS=path/to/firebase-adminsdk.json
```

### 2. Backend Endpoints

#### Authentication Endpoints

**POST `/telegram/sendCode`**

- Initiates Telegram login by sending verification code
- Request: `{ userId: string, phoneNumber: string }`
- Response: `{ phoneCodeHash: string }`

**POST `/telegram/signIn`**

- Completes Telegram login with verification code
- Request: `{ userId, phoneNumber, phoneCodeHash, phoneCode }`
- Response: `{ status: "success", sessionString: string }`

#### Message Endpoints

**POST `/telegram/sendMessage`**

- Sends a message to a Telegram chat
- Request:
  ```json
  {
    "sessionString": "string",
    "chatId": 123456,
    "message": "Your message here"
  }
  ```
- Response: `{ status: "success", messageId, text, date }`

**POST `/telegram/getChats`**

- Retrieves list of user's recent chats
- Request: `{ sessionString: string }`
- Response:
  ```json
  {
    "chats": [
      {
        "id": 123456,
        "title": "Chat Name",
        "type": "private|group|channel",
        "isGroup": boolean,
        "isChannel": boolean,
        "lastMessage": "string",
        "lastMessageDate": "ISO string",
        "unreadCount": number
      }
    ]
  }
  ```

**POST `/telegram/getMessageHistory`**

- Retrieves message history from a chat
- Request: `{ sessionString, chatId, limit: 50 }`
- Response:
  ```json
  {
    "messages": [
      {
        "id": 12345,
        "text": "message content",
        "fromUser": 987654,
        "fromUserName": "User Name",
        "date": "ISO string",
        "isOutgoing": boolean
      }
    ]
  }
  ```

**POST `/telegram/processMessage`**

- Processes a message with AI and returns response
- Request: `{ message: string }`
- Response: `{ response: string }`

#### AI Endpoints

**POST `/api/chat`**

- Chat with AI (used by ChatScreen)
- Request: `{ message: string }`
- Response: `{ response: string }`

## Frontend Integration

### Using TelegramService

The `TelegramService` class (in `src/services/TelegramService.js`) provides a clean interface for all Telegram operations:

```javascript
import TelegramService from "../services/TelegramService";

// Send a message
try {
  const result = await TelegramService.sendMessage(
    sessionString,
    chatId,
    "Hello from the app!",
  );
  console.log("Message sent:", result);
} catch (error) {
  console.error("Failed to send:", error);
}

// Get list of chats
try {
  const chats = await TelegramService.getChats(sessionString);
  chats.forEach((chat) => {
    console.log(`- ${TelegramService.formatChatName(chat)}`);
  });
} catch (error) {
  console.error("Failed to get chats:", error);
}

// Get message history
try {
  const messages = await TelegramService.getMessageHistory(
    sessionString,
    chatId,
    50,
  );
  messages.forEach((msg) => {
    console.log(TelegramService.formatMessage(msg));
  });
} catch (error) {
  console.error("Failed to get history:", error);
}

// Process with AI
try {
  const aiResponse = await TelegramService.processMessageWithAI(
    "What should I do today?",
  );
  console.log("AI says:", aiResponse);
} catch (error) {
  console.error("AI processing failed:", error);
}
```

### SettingScreen Integration

The `SettingScreen` component already has Telegram authentication setup:

1. **Send Code**: User enters phone number → `sendTelegramCode()` is called → Backend sends verification code
2. **Sign In**: User enters code → `signInTelegram()` is called → Session string is returned
3. **Store Session**: Frontend displays session string for user to save in `.env`

### Extending ChatScreen for Telegram

To add Telegram chat support to ChatScreen:

```javascript
import TelegramService from "../services/TelegramService";

// Add state for Telegram integration
const [telegramSessionString, setTelegramSessionString] = useState(null);
const [telegramChats, setTelegramChats] = useState([]);
const [selectedTelegramChat, setSelectedTelegramChat] = useState(null);

// Load user's Telegram chats if authenticated
useEffect(() => {
  if (telegramSessionString) {
    loadTelegramChats();
  }
}, [telegramSessionString]);

const loadTelegramChats = async () => {
  try {
    const chats = await TelegramService.getChats(telegramSessionString);
    setTelegramChats(chats);
  } catch (error) {
    console.error("Failed to load chats:", error);
  }
};

// Send message via Telegram
const sendTelegramMessage = async () => {
  if (!selectedTelegramChat) return;

  try {
    await TelegramService.sendMessage(
      telegramSessionString,
      selectedTelegramChat.id,
      userMessage,
    );
    setUserMessage("");
    // Reload chat history
    loadTelegramMessages();
  } catch (error) {
    Alert.alert("Send failed", error.message);
  }
};
```

## Bot Message Processing

### How the Scheduler Bot Works

1. **Message Received**: Pyrogram client receives a Telegram message
2. **Save to Firestore**: Message is stored for context
3. **AI Response** (if enabled): Generates conversational response using Ilmu AI
4. **Task Detection**: Analyzes message history to detect actionable tasks
5. **Automation Request**: If task detected, enqueues to Firestore `automationRequests` collection
6. **Firebase Function**: `onAutomationRequestCreated` processes the request (sends email, creates calendar event)

### Configuration

Enable/disable AI responses with environment variable:

```env
ENABLE_TELEGRAM_AI_RESPONSES=true  # or false to disable
```

Monitor specific chats:

```env
TARGET_CHAT_IDS=123456789,987654321
```

### Message Flow

```
Telegram User -> Pyrogram Bot -> Save to Firestore
                              -> Generate AI Response -> Reply to User
                              -> Detect Task -> Enqueue Automation
                                           -> Firebase Function -> Execute Task
```

## Running the Backend

### Start FastAPI Server

```bash
# In your workspace directory
python -m uvicorn telegram_api:app --host 0.0.0.0 --port 5000 --reload
```

### Start Telegram Bot

```bash
# In your workspace directory
python scheduler_bot.py
```

First run will ask for chat IDs to monitor. Enter comma-separated IDs or add `TARGET_CHAT_IDS` to `.env`.

## Environment Variables Reference

| Variable                         | Description                                     | Example                                   |
| -------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| `TELEGRAM_API_ID`                | Telegram API ID from my.telegram.org            | `1234567`                                 |
| `TELEGRAM_API_HASH`              | Telegram API Hash from my.telegram.org          | `abcdef123456`                            |
| `ILMU_API_KEY`                   | Ilmu AI API key                                 | `ilmu_xxx`                                |
| `ILMU_BASE_URL`                  | Ilmu AI endpoint                                | `https://api.ilmu.ai/v1/chat/completions` |
| `ILMU_MODEL`                     | Ilmu AI model name                              | `ilmu-glm-5.1`                            |
| `PYROGRAM_SESSION_STRING`        | User's Telegram session (generated after login) | `long_base64_string`                      |
| `TARGET_CHAT_IDS`                | Comma-separated chat IDs to monitor             | `123456789,987654321`                     |
| `ENABLE_TELEGRAM_AI_RESPONSES`   | Enable bot replies                              | `true`                                    |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Firebase service account JSON           | `secret/adminsdk.json`                    |

## Testing

### Test Authentication Flow

1. Go to SettingScreen in app
2. Enter phone number with country code (e.g., +60123456789)
3. Tap "Send Code"
4. Enter verification code from Telegram app
5. Tap "Sign In"
6. Copy displayed session string to `.env` as `PYROGRAM_SESSION_STRING`

### Test Message Sending

```javascript
// In React Native console
import TelegramService from "./src/services/TelegramService";

TelegramService.sendMessage(
  "YOUR_SESSION_STRING",
  123456789, // Chat ID
  "Test message",
)
  .then((result) => console.log("Sent:", result))
  .catch((err) => console.error("Error:", err));
```

### Test AI Processing

```bash
curl -X POST http://localhost:5000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"What should I do today?"}'
```

### Test Bot Message Processing

Send a message to a monitored Telegram chat. The bot should:

1. Reply with an AI response
2. Detect tasks and queue automation requests
3. Log activity to console

## Troubleshooting

### Bot not responding

- Check `ENABLE_TELEGRAM_AI_RESPONSES=true` in `.env`
- Verify `ILMU_API_KEY` is valid
- Check bot is started: `python scheduler_bot.py`
- Verify chat ID is in `TARGET_CHAT_IDS`

### Session expired

- Restart scheduler_bot.py
- May need to re-authenticate via SettingScreen
- Update `PYROGRAM_SESSION_STRING` in `.env`

### Missing Telegram credentials

- Get `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` from https://my.telegram.org
- Must use same phone number when testing authentication

### AI API errors

- Check `ILMU_API_KEY` is valid and has available credits
- Verify `ILMU_BASE_URL` is accessible
- Check internet connection

### Firestore errors

- Ensure `GOOGLE_APPLICATION_CREDENTIALS` points to valid Firebase service account JSON
- Check Firebase project has Firestore database enabled
- Verify collections exist: `chats`, `automationRequests`, `users`

## File Structure

```
DoMyWork/
├── telegram_api.py           # FastAPI backend with Telegram endpoints
├── scheduler_bot.py           # Pyrogram bot for message handling
├── env_config.py              # Environment configuration helper
├── src/
│   ├── services/
│   │   └── TelegramService.js # Frontend Telegram client
│   ├── screens/
│   │   ├── ChatScreen.js      # Main chat interface
│   │   └── SettingScreen.js   # Telegram auth & settings
│   └── constants/
│       └── backend.js         # Backend configuration
└── firebase/
    └── functions/             # Firebase Cloud Functions
```

## Next Steps

1. ✅ Add Telegram message endpoints
2. ✅ Create TelegramService for frontend
3. ✅ Wire scheduler_bot message handlers
4. ⬜ Update ChatScreen to display Telegram chats
5. ⬜ Add Telegram chat selection UI
6. ⬜ Add message history display for Telegram
7. ⬜ Implement real-time message sync
8. ⬜ Add notification for new Telegram messages
