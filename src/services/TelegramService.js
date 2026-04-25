import AsyncStorage from "@react-native-async-storage/async-storage";

const TELEGRAM_SESSION_KEY = "crow.telegram.sessionString";

const FUNCTIONS_BASE_URL = (
  process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL ?? ""
).replace(/\/$/, "");

// Parse backend URL - check if it's a direct Python backend or Firebase function
const TELEGRAM_API_URL =
  process.env.EXPO_PUBLIC_TELEGRAM_API_URL ||
  (FUNCTIONS_BASE_URL
    ? `${FUNCTIONS_BASE_URL}/telegram`
    : "http://localhost:5000/telegram");

export class TelegramService {
  /**
   * Get the saved Telegram session string from AsyncStorage.
   * @returns {Promise<string|null>}
   */
  static async getSessionString() {
    return AsyncStorage.getItem(TELEGRAM_SESSION_KEY);
  }

  /**
   * Clear the saved Telegram session (use on logout / disconnect).
   */
  static async clearSession() {
    return AsyncStorage.removeItem(TELEGRAM_SESSION_KEY);
  }


  /**
   * Send a message to a Telegram chat
   * @param {string} sessionString - User's Telegram session string
   * @param {number} chatId - ID of the chat to send to
   * @param {string} message - Message text to send
   * @returns {Promise<Object>} Message response with id, text, and date
   */
  static async sendMessage(sessionString, chatId, message) {
    if (!sessionString) {
      throw new Error("Missing session string");
    }
    if (!chatId) {
      throw new Error("Missing chat ID");
    }
    if (!message || !message.trim()) {
      throw new Error("Message cannot be empty");
    }

    try {
      const response = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionString,
          chatId,
          message: message.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail || `Failed to send message (${response.status})`,
        );
      }

      return data;
    } catch (error) {
      console.error("[TelegramService] Error sending message:", error);
      throw error;
    }
  }

  /**
   * Get list of recent chats
   * @param {string} sessionString - User's Telegram session string
   * @returns {Promise<Array>} Array of chat objects with id, title, type, etc.
   */
  static async getChats(sessionString) {
    if (!sessionString) {
      throw new Error("Missing session string");
    }

    try {
      const response = await fetch(`${TELEGRAM_API_URL}/getChats`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionString }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail || `Failed to get chats (${response.status})`,
        );
      }

      return data.chats || [];
    } catch (error) {
      console.error("[TelegramService] Error getting chats:", error);
      throw error;
    }
  }

  /**
   * Get message history from a chat
   * @param {string} sessionString - User's Telegram session string
   * @param {number} chatId - ID of the chat
   * @param {number} limit - Number of messages to retrieve (default: 50)
   * @returns {Promise<Array>} Array of message objects
   */
  static async getMessageHistory(sessionString, chatId, limit = 50) {
    if (!sessionString) {
      throw new Error("Missing session string");
    }
    if (!chatId) {
      throw new Error("Missing chat ID");
    }

    try {
      const response = await fetch(`${TELEGRAM_API_URL}/getMessageHistory`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionString,
          chatId,
          limit: Math.max(1, Math.min(limit, 100)), // Clamp between 1 and 100
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail || `Failed to get message history (${response.status})`,
        );
      }

      return data.messages || [];
    } catch (error) {
      console.error("[TelegramService] Error getting message history:", error);
      throw error;
    }
  }

  /**
   * Process a message with AI and get response
   * @param {string} message - User message to process
   * @returns {Promise<string>} AI response text
   */
  static async processMessageWithAI(message) {
    if (!message || !message.trim()) {
      throw new Error("Message cannot be empty");
    }

    try {
      const chatApiUrl =
        process.env.EXPO_PUBLIC_CHAT_API_URL ||
        `${TELEGRAM_API_URL.replace(/\/telegram$/, "")}/api/chat` ||
        "http://localhost:5000/api/chat";

      const response = await fetch(chatApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: message.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail || `AI processing failed (${response.status})`,
        );
      }

      return data.response || "";
    } catch (error) {
      console.error(
        "[TelegramService] Error processing message with AI:",
        error,
      );
      throw error;
    }
  }

  /**
   * Check if session string is valid
   * @param {string} sessionString - Telegram session string to validate
   * @returns {boolean} Whether the session string appears valid
   */
  static isSessionValid(sessionString) {
    return sessionString && sessionString.trim().length > 0;
  }

  /**
   * Format a chat for display
   * @param {Object} chat - Chat object from getChats
   * @returns {string} Formatted chat display name
   */
  static formatChatName(chat) {
    if (chat.type === "private") {
      return chat.title || "Private Chat";
    } else if (chat.isGroup) {
      return `👥 ${chat.title}`;
    } else if (chat.isChannel) {
      return `📢 ${chat.title}`;
    }
    return chat.title || "Chat";
  }

  /**
   * Format a message for display
   * @param {Object} message - Message object
   * @returns {string} Formatted message display text
   */
  static formatMessage(message) {
    const time = new Date(message.date).toLocaleTimeString();
    const sender = message.isOutgoing ? "You" : message.fromUserName;
    return `${sender} (${time}): ${message.text}`;
  }
}

export default TelegramService;
