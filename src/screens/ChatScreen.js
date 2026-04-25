import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { defaultUserId, enqueueAutomationRequest } from "../constants/backend";
import { COLORS } from "../constants/theme";

const ChatScreen = () => {
  const [messages, setMessages] = useState([
    { id: 1, type: "bot", text: "Hi, how can I help you?" },
  ]);
  const [userMessage, setUserMessage] = useState("");
  const [selectedImage, setSelectedImage] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [calendarStatus, setCalendarStatus] = useState("");
  const backendUrl =
    process.env.EXPO_PUBLIC_CHAT_API_URL || "http://localhost:5000/api/chat";

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDate = (date) => {
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  };

  const formatTime = (date) => {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled) {
        setSelectedImage(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert("Error", "Failed to pick image");
    }
  };

  const sendMessage = async () => {
    if ((!userMessage.trim() && !selectedImage) || isSending) return;

    try {
      if (!backendUrl) {
        throw new Error("Missing chat backend URL (EXPO_PUBLIC_CHAT_API_URL).");
      }
      setIsSending(true);
      const formData = new FormData();
      formData.append("message", userMessage);

      if (selectedImage) {
        formData.append("image", {
          uri: selectedImage,
          type: "image/jpeg",
          name: "chat-image.jpg",
        });
      }

      const response = await fetch(backendUrl, {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || "Backend request failed");
      }

      // Add user message to chat
      setMessages([
        ...messages,
        {
          id: messages.length + 1,
          type: "user",
          text: userMessage,
          image: selectedImage,
        },
        {
          id: messages.length + 2,
          type: "bot",
          text: data.response || "Processing...",
        },
      ]);

      setUserMessage("");
      setSelectedImage(null);
    } catch (error) {
      Alert.alert(
        "Send failed",
        error?.message ??
          "Could not reach the backend. Check EXPO_PUBLIC_CHAT_API_URL and that the server is running.",
      );
    } finally {
      setIsSending(false);
    }
  };

  const queueCalendarEvent = async () => {
    try {
      setCalendarStatus("Queueing calendar event...");
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + 1);
      startDate.setHours(10, 0, 0, 0);
      const endDate = new Date(startDate);
      endDate.setHours(12, 0, 0, 0);

      const result = await enqueueAutomationRequest({
        userId: defaultUserId,
        type: "create_calendar_event",
        payload: {
          calendarId: "primary",
          summary: "WIX1002 FOP Midterm Exam",
          description: "Auto-created from Crow AI chat",
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
      });
      setCalendarStatus(`Calendar task queued: ${result.requestId}`);
    } catch (error) {
      setCalendarStatus(error?.message ?? "Failed to queue calendar event.");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Crow AI</Text>
        <View style={styles.dateBadge}>
          <Text style={styles.dateText}>{formatDate(currentTime)}</Text>
          <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
        </View>
      </View>

      <Text style={styles.pageTitle}>Chatbot</Text>

      <ScrollView
        style={styles.chatArea}
        contentContainerStyle={styles.chatContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.botBubble}>
          <Text style={styles.botText}>Hi, how can I help you?</Text>
        </View>

        <View style={styles.examCard}>
          <View style={styles.examHeader}>
            <Text style={styles.examTitle}>WIX1002 FOP Midterm Exam</Text>
            <Text style={styles.examDate}>09/12/2025 10:00am-6:00pm</Text>
            <Text style={styles.examLocation}>WIX1002 FOP Midterm Exam</Text>
          </View>
          <View style={styles.examContent}>
            <Text style={styles.examLabel}>Add this in my calendar</Text>
          </View>
          <TouchableOpacity style={styles.addBtn} onPress={queueCalendarEvent}>
            <Text style={styles.addBtnText}>Add to Google Calendar</Text>
          </TouchableOpacity>
          <Text style={styles.successMsg}>
            {calendarStatus || "Tap to queue Google Calendar automation"}
          </Text>
        </View>

        {messages.map((msg) => (
          <View key={msg.id}>
            {msg.type === "user" && (
              <View style={styles.userBubble}>
                {msg.image && (
                  <Image source={{ uri: msg.image }} style={styles.userImage} />
                )}
                <Text style={styles.userText}>{msg.text}</Text>
              </View>
            )}
            {msg.type === "bot" && msg.id > 1 && (
              <View style={styles.botBubble}>
                <Text style={styles.botText}>{msg.text}</Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      <View style={styles.inputSection}>
        <Text style={styles.askCrowBottomLabel}>Ask Crow</Text>
        {selectedImage && (
          <View style={styles.imagePreview}>
            <Image
              source={{ uri: selectedImage }}
              style={styles.previewImage}
            />
            <TouchableOpacity
              style={styles.removeImageBtn}
              onPress={() => setSelectedImage(null)}
            >
              <Text style={styles.removeImageText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.uploadBtn} onPress={pickImage}>
            <Image
              source={require("../../assets/uploadimage.png")}
              style={styles.uploadIcon}
            />
          </TouchableOpacity>
          <TextInput
            style={styles.messageInput}
            placeholder="Type your message..."
            placeholderTextColor="#999"
            value={userMessage}
            onChangeText={setUserMessage}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, isSending && styles.sendBtnDisabled]}
            onPress={sendMessage}
          >
            <Image
              source={require("../../assets/chatbot.png")}
              style={styles.sendIconImage}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  header: {
    backgroundColor: COLORS.primary,
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: COLORS.white,
  },
  dateBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  dateText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: "500",
  },
  timeText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: COLORS.darkGray,
    padding: 20,
    paddingBottom: 15,
  },
  chatArea: {
    flex: 1,
    padding: 20,
  },
  chatContent: {
    paddingBottom: 190,
  },
  botBubble: {
    backgroundColor: COLORS.secondary,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignSelf: "flex-start",
    maxWidth: "80%",
    marginBottom: 20,
  },
  botText: {
    color: COLORS.darkGray,
    fontSize: 13,
  },
  userBubble: {
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignSelf: "flex-end",
    maxWidth: "80%",
    marginBottom: 20,
  },
  userText: {
    color: "#fff",
    fontSize: 13,
  },
  userImage: {
    width: "100%",
    height: 120,
    borderRadius: 8,
    marginBottom: 8,
    resizeMode: "cover",
  },
  examCard: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
  },
  examHeader: {
    marginBottom: 12,
  },
  examTitle: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 5,
  },
  examDate: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
    marginBottom: 3,
  },
  examLocation: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
  },
  examContent: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.2)",
    paddingTop: 10,
    marginBottom: 10,
  },
  examLabel: {
    color: COLORS.white,
    fontSize: 12,
  },
  addBtn: {
    borderWidth: 1.5,
    borderColor: COLORS.white,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  addBtnText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "600",
  },
  successMsg: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 11,
    textAlign: "center",
  },
  inputSection: {
    paddingHorizontal: 20,
    paddingBottom: 110,
    borderTopWidth: 1,
    borderTopColor: "#e9edf2",
    backgroundColor: "#fff",
  },
  askCrowBottomLabel: {
    color: COLORS.darkGray,
    fontWeight: "700",
    fontSize: 13,
    marginBottom: 6,
  },
  imagePreview: {
    position: "relative",
    marginBottom: 10,
  },
  previewImage: {
    width: "100%",
    height: 150,
    borderRadius: 12,
    resizeMode: "cover",
  },
  removeImageBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.6)",
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  removeImageText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingTop: 2,
  },
  uploadBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.secondary,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  uploadIcon: {
    width: 24,
    height: 24,
    resizeMode: "contain",
  },
  messageInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
    fontSize: 14,
    backgroundColor: "#f9f9f9",
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  sendBtnDisabled: {
    opacity: 0.6,
  },
  sendIconImage: {
    width: 24,
    height: 24,
    resizeMode: "contain",
  },
});

export default ChatScreen;
