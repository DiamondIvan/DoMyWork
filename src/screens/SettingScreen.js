import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { defaultUserId } from "../constants/backend";
import { COLORS } from "../constants/theme";
import { ensureNotificationPermission } from "../services/notifications";
import { useActivityStore } from "../store/ActivityProvider";

WebBrowser.maybeCompleteAuthSession();

const googleDiscovery = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
};

export default function SettingScreen() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [userId, setUserId] = useState(defaultUserId);
  const [statusText, setStatusText] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [notificationStatusText, setNotificationStatusText] = useState("");
  const { state, actions } = useActivityStore();

  // ── Telegram Auth States ──
  const [telegramPhone, setTelegramPhone] = useState("");
  const [telegramCode, setTelegramCode] = useState("");
  const [telegramPassword, setTelegramPassword] = useState("");
  const [isPasswordNeeded, setIsPasswordNeeded] = useState(false);
  const [telegramPhoneCodeHash, setTelegramPhoneCodeHash] = useState(null);
  const [telegramStatus, setTelegramStatus] = useState("");
  const [isTelegramLoading, setIsTelegramLoading] = useState(false);
  const [savedSessionString, setSavedSessionString] = useState(null);

  // ── Chat Picker States ──
  const [chatList, setChatList] = useState([]);
  const [selectedChatIds, setSelectedChatIds] = useState(new Set());
  const [isFetchingChats, setIsFetchingChats] = useState(false);
  const [chatSaveStatus, setChatSaveStatus] = useState("");

  // Load saved session + previously selected chat IDs on mount
  useEffect(() => {
    AsyncStorage.getItem("crow.telegram.sessionString").then((val) => {
      if (val) setSavedSessionString(val);
    });
    // Load previously saved selection from the backend
    fetch(`${"http://10.167.66.131:8000"}/telegram/selectedChats`)
      .then((r) => r.json())
      .then((json) => {
        if (Array.isArray(json.chatIds)) {
          setSelectedChatIds(new Set(json.chatIds));
        }
      })
      .catch(() => {});
  }, []);

  const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ?? "";
  const functionsBaseUrl = "http://10.167.66.131:8000";
  const redirectUri = useMemo(() => {
    const rawUri =
      process.env.EXPO_PUBLIC_GOOGLE_OAUTH_REDIRECT_URI ??
      AuthSession.makeRedirectUri({
        // @ts-expect-error - `useProxy` exists in Expo AuthSession runtime, but may be missing from types
        useProxy: true,
      });
    const cleanUri = rawUri.replace(/\/$/, "");
    console.log("[SettingScreen] Using Redirect URI:", cleanUri);
    return cleanUri;
  }, []);

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: googleClientId,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: false,
      scopes: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/calendar.events",
      ],
      extraParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
    googleDiscovery,
  );
  const connectionItems = [
    {
      name: "Telegram",
      icon: require("../../assets/telegram.png"),
      loginUrl: "https://web.telegram.org",
    },
    {
      name: "Gmail",
      icon: require("../../assets/email.png"),
      loginUrl: "https://accounts.google.com",
    },
    {
      name: "Spectrum",
      icon: require("../../assets/spectrum.png"),
      loginUrl: "https://spectrum.um.edu.my",
    },
    {
      name: "Google Calendar",
      icon: require("../../assets/googlecalendar.png"),
      loginUrl: "https://calendar.google.com",
    },
  ];

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

  const openConnectionLogin = async (url) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert(
          "Cannot open",
          "This login page is not available on device.",
        );
        return;
      }
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert("Open failed", "Could not open login page.");
    }
  };

  // ── Telegram Auth Handlers ──
  const sendTelegramCode = async () => {
    setTelegramStatus("");
    if (!telegramPhone.trim()) {
      setTelegramStatus("Please enter your phone number with country code (e.g. +60123456789).");
      return;
    }
    if (!functionsBaseUrl) {
      setTelegramStatus("Missing EXPO_PUBLIC_FUNCTIONS_BASE_URL");
      return;
    }

    setIsTelegramLoading(true);
    try {
      const res = await fetch(`${functionsBaseUrl}/telegram/sendCode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: (userId || defaultUserId || "default").trim(),
          phoneNumber: telegramPhone.trim(),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setTelegramStatus(json?.detail ?? `Failed to send code (${res.status}).`);
        return;
      }
      setTelegramPhoneCodeHash(json.phoneCodeHash);
      setTelegramStatus("✅ Code sent! Check your Telegram app and enter the code below.");
    } catch (error) {
      setTelegramStatus(error?.message ?? "Failed to reach backend.");
    } finally {
      setIsTelegramLoading(false);
    }
  };

  // ── Chat Picker Handlers ──
  const fetchChatsForPicker = async () => {
    if (!savedSessionString) return;
    setIsFetchingChats(true);
    setChatSaveStatus("");
    try {
      const res = await fetch(`${functionsBaseUrl}/telegram/fetchChats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionString: savedSessionString }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setChatSaveStatus(json?.detail ?? "Failed to load chats.");
        return;
      }
      setChatList(json.chats ?? []);
    } catch (e) {
      setChatSaveStatus(e?.message ?? "Network error.");
    } finally {
      setIsFetchingChats(false);
    }
  };

  const toggleChatSelection = async (chatId) => {
    const next = new Set(selectedChatIds);
    if (next.has(chatId)) {
      next.delete(chatId);
    } else {
      next.add(chatId);
    }
    setSelectedChatIds(next);
    // Persist immediately
    try {
      await fetch(`${functionsBaseUrl}/telegram/selectedChats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatIds: Array.from(next) }),
      });
      setChatSaveStatus(`${next.size} chat(s) selected — bot will listen to these.`);
    } catch {
      setChatSaveStatus("Could not save selection.");
    }
  };

  const signInTelegram = async () => {
    setTelegramStatus("");
    if (!isPasswordNeeded && !telegramCode.trim()) {
      setTelegramStatus("Please enter the verification code.");
      return;
    }
    if (isPasswordNeeded && !telegramPassword.trim()) {
      setTelegramStatus("Please enter your 2FA password.");
      return;
    }
    if (!telegramPhoneCodeHash) {
      setTelegramStatus("Please request a code first.");
      return;
    }

    setIsTelegramLoading(true);
    try {
      const res = await fetch(`${functionsBaseUrl}/telegram/signIn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: (userId || defaultUserId || "default").trim(),
          phoneNumber: telegramPhone.trim(),
          phoneCodeHash: telegramPhoneCodeHash,
          phoneCode: telegramCode.trim(),
          password: isPasswordNeeded ? telegramPassword : null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setTelegramStatus(json?.detail ?? `Sign-in failed (${res.status}).`);
        return;
      }

      if (json.status === "password_needed") {
        setIsPasswordNeeded(true);
        setTelegramStatus(json.detail || "Two-step verification enabled. Please enter your password.");
        return;
      }

      // Save session string to AsyncStorage so the whole app can use it
      if (json.sessionString) {
        await AsyncStorage.setItem("crow.telegram.sessionString", json.sessionString);
        setSavedSessionString(json.sessionString);
      }

      setTelegramStatus(
        "Telegram connected! Session saved — the app can now access your Telegram."
      );
      setTelegramPhoneCodeHash(null);
      setIsPasswordNeeded(false);
      setTelegramCode("");
      setTelegramPassword("");
    } catch (error) {
      setTelegramStatus(error?.message ?? "Failed to reach backend.");
    } finally {
      setIsTelegramLoading(false);
    }
  };

  const connectGoogle = async () => {
    setStatusText("");
    if (!googleClientId) {
      setStatusText("Missing EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID");
      return;
    }
    if (!functionsBaseUrl) {
      setStatusText("Missing EXPO_PUBLIC_FUNCTIONS_BASE_URL");
      return;
    }
    if (!userId.trim()) {
      setStatusText("Please enter userId first.");
      return;
    }
    if (!request?.url) {
      setStatusText("Auth request not ready yet. Please try again.");
      return;
    }

    setIsConnecting(true);
    try {
      const returnUrl = AuthSession.getDefaultReturnUrl();
      const startUrl = `${redirectUri}/start?authUrl=${encodeURIComponent(
        request.url,
      )}&returnUrl=${encodeURIComponent(returnUrl)}`;

      const authResult = await promptAsync({ url: startUrl });

      if (authResult.type !== "success") {
        setStatusText(`Login cancelled (${authResult.type}).`);
        return;
      }

      const code = authResult.params?.code;
      if (!code) {
        setStatusText("Google did not return an authorization code.");
        return;
      }

      const res = await fetch(`${functionsBaseUrl}/exchangeGoogleCode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId.trim(), code, redirectUri }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setStatusText(json?.error ?? `Exchange failed (${res.status}).`);
        return;
      }

      setStatusText(
        json?.hasRefreshToken
          ? "Connected! Refresh token stored in Firestore."
          : "Connected, but no refresh token returned yet.",
      );
    } catch (error) {
      setStatusText(error?.message ?? "Unexpected error during connect.");
    } finally {
      setIsConnecting(false);
    }
  };

  const setNotificationsEnabled = async (nextEnabled) => {
    setNotificationStatusText("");
    if (!nextEnabled) {
      actions.setNotificationsEnabled(false);
      setNotificationStatusText("Notifications disabled.");
      return;
    }

    try {
      const res = await ensureNotificationPermission();
      if (!res.granted) {
        actions.setNotificationsEnabled(false);
        setNotificationStatusText(
          "Permission not granted. Enable in device settings.",
        );
        return;
      }
      actions.setNotificationsEnabled(true);
      setNotificationStatusText("Notifications enabled.");
    } catch (e) {
      actions.setNotificationsEnabled(false);
      setNotificationStatusText(
        e?.message ?? "Failed to enable notifications.",
      );
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

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.pageTitle}>Setting</Text>

        <Text style={styles.sectionTitle}>Account & Profile</Text>
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.label}>User ID</Text>
            <Text style={styles.value}>12121234</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.label}>Subscription Tier</Text>
            <Text style={styles.value}>Free</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Manage Connections</Text>
        <View style={styles.card}>
          {connectionItems.map((item) => (
            <View key={item.name} style={styles.row}>
              <View style={styles.connectionItem}>
                <Image source={item.icon} style={styles.connectionIcon} />
                <Text style={styles.connectionName}>{item.name}</Text>
              </View>
              <TouchableOpacity
                style={styles.connectBtn}
                onPress={() => openConnectionLogin(item.loginUrl)}
              >
                <Text style={styles.connectBtnText}>Login</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.directPageBtn}
          onPress={() => openConnectionLogin("https://accounts.google.com")}
        >
          <Text style={styles.directPageText}>Go To Account Login Page</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Backend Google Connect</Text>
        <View style={styles.cardPlain}>
          <TextInput
            style={styles.userIdInput}
            value={userId}
            onChangeText={setUserId}
            placeholder="Enter userId (e.g. telegram_123456)"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
          />
          <Pressable
            disabled={!request || isConnecting}
            onPress={connectGoogle}
            style={({ pressed }) => [
              styles.connectGoogleBtn,
              { opacity: !request || isConnecting ? 0.6 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.connectGoogleText}>
              {isConnecting ? "Connecting..." : "Connect Google For Backend"}
            </Text>
          </Pressable>
          {!!statusText && <Text style={styles.statusText}>{statusText}</Text>}
          {!!response && response.type !== "dismiss" && (
            <Text style={styles.statusSubText}>
              Last auth result: {response.type}
            </Text>
          )}
        </View>

        <Text style={styles.sectionTitle}>Telegram Connect</Text>
        <View style={styles.cardPlain}>
          <TextInput
            style={styles.userIdInput}
            value={telegramPhone}
            onChangeText={setTelegramPhone}
            placeholder="Phone number with country code (e.g. +60123456789)"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            keyboardType="phone-pad"
          />
          <Pressable
            disabled={isTelegramLoading}
            onPress={sendTelegramCode}
            style={({ pressed }) => [
              styles.connectGoogleBtn,
              { opacity: isTelegramLoading ? 0.6 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.connectGoogleText}>
              {isTelegramLoading && !telegramPhoneCodeHash
                ? "Sending code..."
                : "Send Verification Code"}
            </Text>
          </Pressable>

          {telegramPhoneCodeHash && (
            <>
              <TextInput
                style={[styles.userIdInput, { marginTop: 10 }]}
                value={telegramCode}
                onChangeText={setTelegramCode}
                placeholder="Enter the code from Telegram"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                keyboardType="number-pad"
                editable={!isPasswordNeeded}
              />

              {isPasswordNeeded && (
                <>
                  <View style={styles.twofaBanner}>
                    <Text style={styles.twofaIcon}>🔐</Text>
                    <Text style={styles.twofaText}>
                      Two-step verification is enabled. Enter your Telegram password below.
                    </Text>
                  </View>
                  <TextInput
                    style={[styles.userIdInput, { marginTop: 6 }]}
                    value={telegramPassword}
                    onChangeText={setTelegramPassword}
                    placeholder="Enter your 2FA password"
                    placeholderTextColor="#94a3b8"
                    secureTextEntry
                    autoCapitalize="none"
                    autoFocus
                  />
                </>
              )}
              <Pressable
                disabled={isTelegramLoading}
                onPress={signInTelegram}
                style={({ pressed }) => [
                  styles.connectGoogleBtn,
                  { opacity: isTelegramLoading ? 0.6 : pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={styles.connectGoogleText}>
                  {isTelegramLoading ? "Signing in..." : "Verify & Connect Telegram"}
                </Text>
              </Pressable>
            </>
          )}

          {!!telegramStatus && <Text style={styles.statusText}>{telegramStatus}</Text>}

          {savedSessionString && (
            <View style={styles.connectedBadge}>
              <Text style={styles.connectedBadgeText}>Connected to Telegram</Text>
            </View>
          )}
        </View>

        {/* ── Chat Picker ── */}
        {savedSessionString && (
          <>
            <Text style={styles.sectionTitle}>Monitored Chats</Text>
            <View style={styles.cardPlain}>
              <Text style={styles.chatPickerHint}>
                Choose which chats the AI bot listens to. Only messages from selected chats use AI tokens.
              </Text>
              <Pressable
                onPress={fetchChatsForPicker}
                disabled={isFetchingChats}
                style={({ pressed }) => [
                  styles.connectGoogleBtn,
                  { opacity: isFetchingChats ? 0.6 : pressed ? 0.85 : 1, marginTop: 10 },
                ]}
              >
                <Text style={styles.connectGoogleText}>
                  {isFetchingChats ? "Loading chats..." : chatList.length > 0 ? "Refresh Chat List" : "Load My Chats"}
                </Text>
              </Pressable>

              {chatList.length > 0 && (
                <View style={{ marginTop: 12 }}>
                  {chatList.map((chat) => {
                    const isSelected = selectedChatIds.has(chat.id);
                    return (
                      <TouchableOpacity
                        key={chat.id}
                        style={[styles.chatRow, isSelected && styles.chatRowSelected]}
                        onPress={() => toggleChatSelection(chat.id)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.chatCheckbox}>
                          {isSelected && <View style={styles.chatCheckboxInner} />}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.chatName, isSelected && styles.chatNameSelected]}>
                            {chat.name}
                          </Text>
                          {chat.lastMessage ? (
                            <Text style={styles.chatLastMsg} numberOfLines={1}>
                              {chat.lastMessage}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={styles.chatTypeTag}>
                          {chat.type?.includes("group") || chat.type?.includes("super") ? "GROUP" : "DM"}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {!!chatSaveStatus && (
                <Text style={styles.statusText}>{chatSaveStatus}</Text>
              )}
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>AI Agent Personalization</Text>
        <View style={styles.card}>
          <View style={styles.personalizationRow}>
            <Text style={styles.label}>Auto-Confirm</Text>
            <View style={styles.toggle}>
              <View style={styles.toggleActive} />
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.card}>
          <View style={styles.personalizationRow}>
            <Text style={styles.label}>Enable reminders</Text>
            <Switch
              value={!!state.settings.notificationsEnabled}
              onValueChange={setNotificationsEnabled}
              trackColor={{ false: "#cbd5e1", true: COLORS.primary }}
              thumbColor="#fff"
            />
          </View>
          {!!notificationStatusText && (
            <Text style={styles.statusSubText}>{notificationStatusText}</Text>
          )}
        </View>

        <Text style={styles.sectionTitle}>General & Support</Text>
        <View style={styles.card}>
          {["Help Center", "Report"].map((item) => (
            <TouchableOpacity key={item} style={styles.row}>
              <Text style={styles.supportText}>{item}</Text>
              <Text style={styles.arrow}>›</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.row}
            onPress={() => setAboutOpen(true)}
          >
            <Text style={styles.supportText}>About Crow AI</Text>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.poweredBy}>Powered by Last Minute AI</Text>

        <TouchableOpacity style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={aboutOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAboutOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>About Crow AI</Text>
            <Text style={styles.modalBody}>
              Crow AI helps you turn messages into activities, manage your to-do
              and due items, and keep a clean history of what you’ve finished.
            </Text>
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setAboutOpen(false)}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
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
    color: "#fff",
  },
  dateBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  dateText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "500",
  },
  timeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  content: {
    padding: 20,
    paddingBottom: 190,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 20,
    color: COLORS.darkGray,
  },
  sectionTitle: {
    fontWeight: "700",
    marginTop: 20,
    marginBottom: 12,
    fontSize: 13,
    color: COLORS.darkGray,
    textTransform: "uppercase",
  },
  card: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 0,
    marginBottom: 15,
    overflow: "hidden",
  },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.darkGray,
  },
  value: {
    fontSize: 13,
    color: COLORS.textGray,
  },
  connectionItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  connectionIcon: {
    width: 18,
    height: 18,
    resizeMode: "contain",
    marginRight: 10,
  },
  connectionName: {
    fontSize: 13,
    color: COLORS.darkGray,
    fontWeight: "500",
  },
  linkedText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: "600",
  },
  connectBtn: {
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: "#f0fbfb",
  },
  connectBtnText: {
    color: COLORS.primary,
    fontWeight: "700",
    fontSize: 11,
  },
  directPageBtn: {
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: "#f0fbfb",
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 6,
  },
  directPageText: {
    color: COLORS.primary,
    fontWeight: "700",
    fontSize: 12,
  },
  cardPlain: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    backgroundColor: "#fff",
  },
  userIdInput: {
    borderWidth: 1,
    borderColor: "#d9e1ea",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.darkGray,
    marginBottom: 10,
  },
  connectGoogleBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  connectGoogleText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  statusText: {
    marginTop: 8,
    color: COLORS.darkGray,
    fontSize: 12,
    fontWeight: "600",
  },
  twofaBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fcd34d",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
    marginBottom: 2,
    gap: 6,
  },
  twofaIcon: {
    fontSize: 14,
    lineHeight: 18,
  },
  twofaText: {
    flex: 1,
    fontSize: 12,
    color: "#92400e",
    fontWeight: "500",
    lineHeight: 17,
  },
  statusSubText: {
    marginTop: 6,
    color: COLORS.textGray,
    fontSize: 11,
  },
  connectedBadge: {
    marginTop: 10,
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#6ee7b7",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
  },
  connectedBadgeText: {
    color: "#065f46",
    fontWeight: "700",
    fontSize: 12,
  },
  chatPickerHint: {
    fontSize: 12,
    color: COLORS.textGray,
    lineHeight: 17,
  },
  chatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 6,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  chatRowSelected: {
    backgroundColor: "#eff6ff",
    borderColor: COLORS.primary,
  },
  chatCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#cbd5e1",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  chatCheckboxInner: {
    width: 11,
    height: 11,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
  chatName: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.darkGray,
  },
  chatNameSelected: {
    color: COLORS.primary,
  },
  chatLastMsg: {
    fontSize: 11,
    color: COLORS.textGray,
    marginTop: 2,
  },
  chatTypeTag: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.textGray,
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 18,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: COLORS.darkGray,
  },
  modalBody: {
    marginTop: 10,
    fontSize: 13,
    color: COLORS.textGray,
    fontWeight: "600",
    lineHeight: 18,
  },
  modalCloseBtn: {
    marginTop: 14,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  modalCloseText: {
    color: "#fff",
    fontWeight: "900",
  },
  personalizationRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 15,
  },
  toggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  toggleActive: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
    alignSelf: "flex-end",
  },
  supportText: {
    fontSize: 13,
    color: COLORS.darkGray,
    fontWeight: "500",
  },
  arrow: {
    fontSize: 16,
    color: COLORS.textGray,
  },
  poweredBy: {
    textAlign: "center",
    fontSize: 11,
    color: COLORS.textGray,
    marginVertical: 20,
  },
  logoutBtn: {
    marginTop: 10,
    marginBottom: 30,
    borderWidth: 2,
    borderColor: "#ff4444",
    padding: 12,
    borderRadius: 25,
    alignItems: "center",
  },
  logoutText: {
    color: "#ff4444",
    fontSize: 14,
    fontWeight: "700",
  },
});
