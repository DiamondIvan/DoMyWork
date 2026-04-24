import { useEffect, useMemo, useState } from "react";
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

const MenuScreen = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilters, setSelectedFilters] = useState([]);
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
  const [manualTitle, setManualTitle] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [manualTime, setManualTime] = useState("");
  const [manualActivities, setManualActivities] = useState([]);
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

  const addManualActivity = () => {
    const title = manualTitle.trim();
    const date = manualDate.trim();
    const time = manualTime.trim();

    if (!title || !date || !time) {
      Alert.alert("Missing details", "Please fill title, date, and time.");
      return;
    }

    setManualActivities((prev) => [
      {
        id: Date.now().toString(),
        title,
        date,
        time,
      },
      ...prev,
    ]);

    setManualTitle("");
    setManualDate("");
    setManualTime("");
  };

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

  const weeklyStats = [3, 5, 2, 6, 4, 7, 5];

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
        <View style={styles.card}>
          <Text style={styles.cardTime}>06/05/2026 8:00-10:00am</Text>
          <Text style={styles.cardTask}>DS Midterm</Text>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.btnConfirm}>
              <Text style={styles.btnConfirmText}>✓ Confirm</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnCancel}>
              <Text style={styles.btnCancelText}>✕ Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Add Activity Manually</Text>
        <View style={styles.manualCard}>
          <TextInput
            style={styles.manualInput}
            placeholder="Activity title"
            placeholderTextColor="#9aa0a6"
            value={manualTitle}
            onChangeText={setManualTitle}
          />
          <View style={styles.manualRow}>
            <TextInput
              style={[styles.manualInput, styles.manualInputHalf]}
              placeholder="Date (dd/mm/yyyy)"
              placeholderTextColor="#9aa0a6"
              value={manualDate}
              onChangeText={setManualDate}
            />
            <TextInput
              style={[styles.manualInput, styles.manualInputHalf]}
              placeholder="Time (9:00-10:00am)"
              placeholderTextColor="#9aa0a6"
              value={manualTime}
              onChangeText={setManualTime}
            />
          </View>
          <TouchableOpacity
            style={styles.addActivityBtn}
            onPress={addManualActivity}
          >
            <Text style={styles.addActivityText}>Add Activity</Text>
          </TouchableOpacity>
          {manualActivities.map((item) => (
            <View key={item.id} style={styles.activityItem}>
              <Text style={styles.activityTitle}>{item.title}</Text>
              <Text style={styles.activityMeta}>
                {item.date} | {item.time}
              </Text>
            </View>
          ))}
        </View>

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
    paddingBottom: 130,
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
  manualCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dfe3e8",
    padding: 12,
    marginBottom: 18,
  },
  manualInput: {
    borderWidth: 1,
    borderColor: "#dfe3e8",
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.darkGray,
    marginBottom: 10,
    fontSize: 13,
  },
  manualRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  manualInputHalf: {
    flex: 1,
  },
  addActivityBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 10,
  },
  addActivityText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
  },
  activityItem: {
    borderTopWidth: 1,
    borderTopColor: "#edf1f5",
    paddingTop: 8,
    marginTop: 8,
  },
  activityTitle: {
    color: COLORS.darkGray,
    fontWeight: "600",
    fontSize: 13,
  },
  activityMeta: {
    color: COLORS.textGray,
    fontSize: 11,
    marginTop: 2,
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
  graphBar: {
    width: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
});

export default MenuScreen;
