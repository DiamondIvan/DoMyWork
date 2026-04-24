import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import {
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { defaultUserId } from "../constants/backend";
import { COLORS } from "../constants/theme";

WebBrowser.maybeCompleteAuthSession();

const googleDiscovery = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
};

export default function SettingScreen() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [userId, setUserId] = useState(defaultUserId);
  const [statusText, setStatusText] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const googleClientId = process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ?? "";
  const functionsBaseUrl = (
    process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL ?? ""
  ).replace(/\/$/, "");
  const redirectUri =
    process.env.EXPO_PUBLIC_GOOGLE_OAUTH_REDIRECT_URI ??
    AuthSession.makeRedirectUri({
      // @ts-expect-error runtime-supported in Expo AuthSession
      useProxy: true,
    });

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: googleClientId,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
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

    setIsConnecting(true);
    try {
      const authResult = await promptAsync({
        // @ts-expect-error runtime-supported in Expo AuthSession
        useProxy: true,
      });

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

        <Text style={styles.sectionTitle}>AI Agent Personalization</Text>
        <View style={styles.card}>
          <View style={styles.personalizationRow}>
            <Text style={styles.label}>Auto-Confirm</Text>
            <View style={styles.toggle}>
              <View style={styles.toggleActive} />
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>General & Support</Text>
        <View style={styles.card}>
          {["Help Center", "Report", "About Crow AI"].map((item) => (
            <TouchableOpacity key={item} style={styles.row}>
              <Text style={styles.supportText}>{item}</Text>
              <Text style={styles.arrow}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.poweredBy}>Powered by Last Minute AI</Text>

        <TouchableOpacity style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
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
    paddingBottom: 130,
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
  statusSubText: {
    marginTop: 6,
    color: COLORS.textGray,
    fontSize: 11,
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
