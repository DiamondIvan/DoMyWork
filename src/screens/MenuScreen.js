import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Image,
    Linking,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { defaultUserId, enqueueAutomationRequest } from "../constants/backend";
import { COLORS } from "../constants/theme";
import { useActivityStore } from "../store/ActivityProvider";

const BASE_URL = "http://10.167.66.131:8000";

const MenuScreen = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilters, setSelectedFilters] = useState([]);
  const { state, actions } = useActivityStore();

  // ── Live pending tasks from Firestore (via API polling) ──
  const [firestorePending, setFirestorePending] = useState([]);
  const [confirmingId, setConfirmingId] = useState(null);
  const pollRef = useRef(null);

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/pendingTasks`);
      if (!res.ok) return;
      const json = await res.json();
      setFirestorePending(json.tasks ?? []);
    } catch {
      /* silent — network may not be ready yet */
    }
  }, []);

  useEffect(() => {
    fetchPending();
    pollRef.current = setInterval(fetchPending, 10_000);
    return () => clearInterval(pollRef.current);
  }, [fetchPending]);

  const handleConfirm = async (task) => {
    setConfirmingId(task.id);
    try {
      const res = await fetch(`${BASE_URL}/pendingTasks/${task.id}/confirm`, {
        method: "POST",
      });
      const json = await res.json().catch(() => null);
      console.log("[Confirm] response:", res.status, JSON.stringify(json));

      if (res.ok) {
        setFirestorePending((prev) => prev.filter((t) => t.id !== task.id));

        const eventId = json?.calendarEventId;
        const eventLink = json?.calendarEventLink;  // direct link to the created event
        // Fallback: open calendar home if no direct link
        const openUrl = eventLink || "https://calendar.google.com/calendar/u/0/r";

        Alert.alert(
          eventId ? "✅ Event Created" : "Task Confirmed",
          eventId
            ? `Event "${task.title}" was added to Google Calendar.\n\nTap "Open Event" to view it. Make sure you're signed in to the same Google account used in Settings.`
            : `"${task.title}" has been queued — it will be processed shortly by the backend.`,
          [
            {
              text: eventId ? "Open Event" : "Open Calendar",
              onPress: async () => {
                const canOpen = await Linking.canOpenURL(openUrl);
                if (canOpen) {
                  await Linking.openURL(openUrl);
                } else {
                  await Linking.openURL("https://calendar.google.com/calendar/u/0/r");
                }
              },
            },
            { text: "OK", style: "cancel" },
          ],
        );
      } else {
        // Surface the actual error from the backend
        const detail = json?.detail ?? `Server error ${res.status}`;
        Alert.alert("❌ Confirm Failed", detail);
      }
    } catch (e) {
      Alert.alert("Error", e?.message ?? "Network error — is the backend running?");
    } finally {
      setConfirmingId(null);
    }
  };

  const handleDismiss = async (task) => {
    try {
      await fetch(`${BASE_URL}/pendingTasks/${task.id}`, { method: "DELETE" });
      setFirestorePending((prev) => prev.filter((t) => t.id !== task.id));
    } catch {
      /* ignore */
    }
  };
  const [messages] = useState([
    {
      id: 1,
      source: "telegram",
      title: "Assignment due next Friday",
      time: "14:02",
    },
    { id: 2, source: "email", title: "Exam venue: Hall B", time: "13:45" },
    {
      id: 3,
      source: "web",
      title: "New course material uploaded",
      time: "12:30",
    },
    {
      id: 4,
      source: "telegram",
      title: "Group discussion link",
      time: "11:15",
    },
  ]);
  const [backendStatus, setBackendStatus] = useState("");

  const filterOptions = [
    {
      id: "telegram",
      label: "Telegram",
      image: require("../../assets/telegram.png"),
      color: "#0088cc",
    },
    {
      id: "email",
      label: "Email",
      image: require("../../assets/email.png"),
      color: "#EA4335",
    },
    {
      id: "web",
      label: "Spectrum",
      image: require("../../assets/spectrum.png"),
      color: "#4285F4",
    },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date) => {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  };

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

  const toggleFilter = (filterId) => {
    setSelectedFilters((prev) =>
      prev.includes(filterId)
        ? prev.filter((id) => id !== filterId)
        : [...prev, filterId],
    );
  };

  // Merge Firestore pending tasks + local ActivityStore pending items
  const pendingItems = useMemo(() => {
    const local = state.items
      .filter((it) => it.status === "pending")
      .map((it) => ({ ...it, _source: "local" }));
    const remote = firestorePending.map((t) => ({
      id: t.id,
      title: t.title,
      dateISO: t.createdAt ? t.createdAt.slice(0, 10) : "",
      timeLabel: "",
      chatTitle: t.chatTitle,
      taskType: t.type,
      payload: t.payload,
      _source: "firestore",
      _raw: t,
    }));
    return [...remote, ...local].sort((a, b) =>
      (b.createdAt || b.dateISO || "").localeCompare(
        a.createdAt || a.dateISO || "",
      ),
    );
  }, [state.items, firestorePending]);

  const openGoogleCalendar = async () => {
    const url = "https://calendar.google.com";
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert(
        "Cannot open",
        "Unable to open Google Calendar on this device.",
      );
      return;
    }
    await Linking.openURL(url);
  };

  const weeklyStats = useMemo(() => {
    const now = new Date();
    const days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() - (6 - i));
      const yr = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const da = String(d.getDate()).padStart(2, "0");
      return `${yr}-${mo}-${da}`;
    });

    const completed = state.items.filter((it) => it.status === "completed");
    const counts = days.map(
      (iso) => completed.filter((it) => it.dateISO === iso).length,
    );
    return counts;
  }, [state.items]);

  const sourceCounts = useMemo(() => {
    const completed = state.items.filter((it) => it.status === "completed");
    const base = { telegram: 0, email: 0, spectrum: 0 };
    for (const it of completed) {
      if (it.source === "telegram") base.telegram += 1;
      if (it.source === "email") base.email += 1;
      if (it.source === "spectrum") base.spectrum += 1;
    }
    return base;
  }, [state.items]);

  const queueSendEmailMission = async () => {
    try {
      setBackendStatus("Queueing email mission...");
      const result = await enqueueAutomationRequest({
        userId: defaultUserId,
        type: "send_email",
        payload: {
          to: "hr@techcorp.com",
          subject: "KitaHack 2026 Sponsorship Proposal",
          bodyText:
            "Hi TechCorp HR, we would like to propose sponsorship collaboration for KitaHack 2026.",
        },
      });
      setBackendStatus(`Email mission queued: ${result.requestId}`);
    } catch (error) {
      setBackendStatus(error?.message ?? "Failed to queue email mission.");
    }
  };

  const filteredMessages = useMemo(() => {
    const bySource =
      selectedFilters.length === 0
        ? messages
        : messages.filter((msg) => selectedFilters.includes(msg.source));

    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return bySource;

    return bySource.filter((msg) => {
      const sourceLabel =
        filterOptions.find((item) => item.id === msg.source)?.label ?? "";
      return (
        msg.title.toLowerCase().includes(keyword) ||
        sourceLabel.toLowerCase().includes(keyword)
      );
    });
  }, [messages, selectedFilters, searchQuery, filterOptions]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Crow AI</Text>
          <Text style={styles.subtitle}>Your AI Assistant</Text>
        </View>
        <View style={styles.dateBadge}>
          <Text style={styles.dateText}>{formatDate(currentTime)}</Text>
          <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <TextInput
          style={styles.searchBar}
          placeholder="Search messages..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />

        <Text style={styles.filterTitle}>Filter Messages</Text>
        <View style={styles.filterRow}>
          {filterOptions.map((filter) => (
            <TouchableOpacity
              key={filter.id}
              style={[
                styles.filterBtn,
                selectedFilters.includes(filter.id) && {
                  backgroundColor: filter.color,
                  borderColor: filter.color,
                },
              ]}
              onPress={() => toggleFilter(filter.id)}
            >
              <Image source={filter.image} style={styles.filterIcon} />
              <Text
                style={[
                  styles.filterLabel,
                  selectedFilters.includes(filter.id) && { color: "#fff" },
                ]}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Intercepted Signals</Text>
        <View style={styles.signalsList}>
          {filteredMessages.length === 0 && (
            <Text style={styles.emptyText}>
              No messages match your search/filter.
            </Text>
          )}
          {filteredMessages.map((msg) => {
            const source = filterOptions.find((f) => f.id === msg.source);
            return (
              <View key={msg.id} style={styles.signalCard}>
                <View
                  style={[
                    styles.sourceBadge,
                    { backgroundColor: source.color + "20" },
                  ]}
                >
                  <Image source={source.image} style={styles.sourceIcon} />
                </View>
                <View style={styles.signalContent}>
                  <Text style={styles.signalSource}>{source.label}</Text>
                  <Text style={styles.signalMessage}>{msg.title}</Text>
                </View>
                <Text style={styles.signalTime}>{msg.time}</Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Pending Confirmation</Text>
        {pendingItems.length === 0 && (
          <Text style={styles.emptyText}>
            No pending items — AI is watching your selected chats.
          </Text>
        )}
        {pendingItems.map((it) => (
          <View key={it.id} style={styles.card}>
            {it.chatTitle ? (
              <Text style={styles.cardSource}>From: {it.chatTitle}</Text>
            ) : null}
            <Text style={styles.cardTime}>
              {it.dateISO} {it.timeLabel || ""}
            </Text>
            <Text style={styles.cardTask}>{it.title}</Text>
            {it.taskType === "create_calendar_event" && it.payload && (
              <View style={styles.payloadBox}>
                {it.payload.start ? (
                  <Text style={styles.payloadText}>
                    🗓 {it.payload.start?.replace("T", "  ")}
                  </Text>
                ) : null}
                {it.payload.description ? (
                  <Text style={styles.payloadText} numberOfLines={2}>
                    📝 {it.payload.description}
                  </Text>
                ) : null}
              </View>
            )}
            {it.taskType === "send_email" && it.payload && (
              <View style={styles.payloadBox}>
                <Text style={styles.payloadText}>✉️ To: {it.payload.to}</Text>
                {it.payload.bodyText ? (
                  <Text style={styles.payloadText} numberOfLines={2}>
                    {it.payload.bodyText}
                  </Text>
                ) : null}
              </View>
            )}
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[
                  styles.btnConfirm,
                  confirmingId === it.id && { opacity: 0.6 },
                ]}
                disabled={confirmingId === it.id}
                onPress={() =>
                  it._source === "firestore"
                    ? handleConfirm(it._raw)
                    : actions.confirmPending(it.id)
                }
              >
                <Text style={styles.btnConfirmText}>
                  {confirmingId === it.id ? "Confirming..." : "✓ Confirm"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnCancel}
                onPress={() =>
                  it._source === "firestore"
                    ? handleDismiss(it._raw)
                    : actions.deleteItem(it.id)
                }
              >
                <Text style={styles.btnCancelText}>✕ Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Active Missions</Text>
        <View style={styles.missionCard}>
          <Text style={styles.missionTitle}>Sponsorship Proposal</Text>
          <Text style={styles.missionDetail}>Recipient: TechCorp HR</Text>
          <Text style={styles.missionDetail}>
            Content: Automated outreach for KitaHack 2026...
          </Text>
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={queueSendEmailMission}
            >
              <Text style={styles.btnSecondaryText}>📤 Review & Send</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnSecondary}>
              <Text style={styles.btnSecondaryText}>✏️ Edit</Text>
            </TouchableOpacity>
          </View>
          {!!backendStatus && (
            <Text style={styles.backendStatusText}>{backendStatus}</Text>
          )}
        </View>

        <View style={styles.bottomCards}>
          <TouchableOpacity
            style={styles.miniCard}
            onPress={openGoogleCalendar}
          >
            <Image
              source={require("../../assets/googlecalendar.png")}
              style={styles.miniCardIcon}
            />
            <Text style={styles.miniCardTitle}>Google Calendar</Text>
            <Text style={styles.miniCardSubtext}>
              Open your upcoming events
            </Text>
          </TouchableOpacity>
          <View style={styles.miniCard}>
            <Text style={styles.miniCardTitle}>Statistic</Text>
            <View style={styles.statRow}>
              <Text style={styles.statText}>
                Telegram: {sourceCounts.telegram}
              </Text>
              <Text style={styles.statText}>Email: {sourceCounts.email}</Text>
              <Text style={styles.statText}>
                Spectrum: {sourceCounts.spectrum}
              </Text>
            </View>
            <View style={styles.graphRow}>
              {weeklyStats.map((point, index) => (
                <View
                  key={`bar-${index}`}
                  style={[styles.graphBar, { height: 10 + point * 6 }]}
                />
              ))}
            </View>
            <Text style={styles.miniCardSubtext}>Weekly activities done</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f9fa" },
  header: {
    backgroundColor: COLORS.primary,
    padding: 20,
    paddingTop: 50,
    paddingBottom: 25,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  title: { color: "#fff", fontSize: 26, fontWeight: "800" },
  subtitle: { color: "rgba(255,255,255,0.8)", fontSize: 12, marginTop: 3 },
  dateBadge: {
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: "flex-end",
  },
  dateText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  timeText: { color: "#fff", fontSize: 13, fontWeight: "700", marginTop: 2 },
  content: { padding: 20, flex: 1 },
  contentContainer: {
    paddingBottom: 190,
  },
  searchBar: {
    backgroundColor: "#fff",
    padding: 13,
    borderRadius: 12,
    marginBottom: 20,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  filterTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.darkGray,
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  filterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 25,
  },
  filterBtn: {
    flex: 1,
    marginHorizontal: 4,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#e0e0e0",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  filterIcon: { width: 20, height: 20, marginBottom: 5, resizeMode: "contain" },
  filterLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.textGray,
    textAlign: "center",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    marginVertical: 15,
    color: COLORS.darkGray,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  signalsList: { marginBottom: 20 },
  signalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  sourceBadge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  sourceIcon: { width: 22, height: 22, resizeMode: "contain" },
  signalContent: { flex: 1 },
  signalSource: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.primary,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  signalMessage: { fontSize: 13, fontWeight: "600", color: COLORS.darkGray },
  signalTime: { fontSize: 11, color: COLORS.textGray, fontWeight: "500" },
  emptyText: {
    fontSize: 12,
    color: COLORS.textGray,
    marginBottom: 10,
    fontStyle: "italic",
  },
  card: {
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  cardTime: {
    fontSize: 12,
    color: COLORS.textGray,
    fontWeight: "600",
    marginBottom: 5,
  },
  cardTask: {
    fontSize: 16,
    fontWeight: "700",
    marginVertical: 8,
    color: COLORS.darkGray,
  },
  cardSource: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.primary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  payloadBox: {
    backgroundColor: "#f1f5f9",
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
    gap: 4,
  },
  payloadText: {
    fontSize: 12,
    color: COLORS.darkGray,
    fontWeight: "500",
  },
  btnRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  btnConfirm: {
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    flex: 0.48,
    alignItems: "center",
  },
  btnConfirmText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  btnCancel: {
    backgroundColor: "#f0f0f0",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    flex: 0.48,
    alignItems: "center",
  },
  btnCancelText: { color: COLORS.textGray, fontSize: 12, fontWeight: "700" },
  missionCard: {
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
    backgroundColor: COLORS.secondary,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  missionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.darkGray,
    marginBottom: 5,
  },
  missionDetail: {
    fontSize: 12,
    color: COLORS.textGray,
    marginBottom: 3,
    fontWeight: "500",
  },
  btnSecondary: {
    borderWidth: 2,
    borderColor: COLORS.primary,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 20,
    flex: 0.48,
    alignItems: "center",
    marginTop: 10,
    backgroundColor: "#fff",
  },
  btnSecondaryText: { color: COLORS.primary, fontSize: 11, fontWeight: "700" },
  backendStatusText: {
    marginTop: 8,
    fontSize: 11,
    color: COLORS.darkGray,
    fontWeight: "600",
  },
  bottomCards: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 30,
    gap: 10,
  },
  miniCard: {
    flex: 0.48,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: 12,
    padding: 15,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  miniCardIcon: {
    width: 28,
    height: 28,
    resizeMode: "contain",
    marginBottom: 8,
  },
  miniCardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.darkGray,
    textAlign: "center",
    marginBottom: 8,
  },
  miniCardSubtext: {
    fontSize: 11,
    color: COLORS.textGray,
    textAlign: "center",
    marginTop: 6,
  },
  graphRow: {
    height: 58,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: 4,
  },
  statRow: {
    width: "100%",
    marginBottom: 10,
    gap: 4,
  },
  statText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textGray,
    textAlign: "center",
  },
  graphBar: {
    width: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
});

export default MenuScreen;
