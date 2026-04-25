import { useEffect, useMemo, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useActivityStore } from "../store/ActivityProvider";
import { COLORS } from "../constants/theme";
import { cancelScheduledNotification } from "../services/notifications";

const HistoryScreen = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const { state, actions } = useActivityStore();
  const [selectedFilters, setSelectedFilters] = useState([]);

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
      id: "spectrum",
      label: "Spectrum",
      image: require("../../assets/spectrum.png"),
      color: "#4285F4",
    },
    {
      id: "manual",
      label: "Manual",
      image: require("../../assets/homepage.png"),
      color: COLORS.primary,
    },
  ];

  const toggleFilter = (id) => {
    setSelectedFilters((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const historyItems = useMemo(() => {
    const completed = state.items.filter((it) => it.status === "completed");
    const filtered =
      selectedFilters.length === 0
        ? completed
        : completed.filter((it) => selectedFilters.includes(it.source));
    return filtered
      .slice()
      .sort((a, b) => (b.completedAtISO || "").localeCompare(a.completedAtISO || ""));
  }, [state.items, selectedFilters]);

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
        <Text style={styles.sectionTitle}>Task History</Text>

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

        {historyItems.length === 0 && (
          <Text style={styles.emptyText}>No history matches your filter.</Text>
        )}

        {historyItems.map((item) => (
          <View key={item.id} style={styles.historyCard}>
            <View style={styles.dateTag}>
              <Text style={styles.dateTagText}>{item.dateISO}</Text>
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.cardTime}>{item.timeLabel || ""}</Text>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardMeta}>
                {item.source.toUpperCase()} • {item.kind.toUpperCase()}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={async () => {
                if (item.notificationId) {
                  await cancelScheduledNotification(item.notificationId);
                }
                actions.deleteItem(item.id);
              }}
            >
              <Text style={styles.deleteText}>Delete</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

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
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 20,
    color: COLORS.darkGray,
  },
  filterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
    gap: 8,
  },
  filterBtn: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#e0e0e0",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  filterIcon: { width: 18, height: 18, marginBottom: 5, resizeMode: "contain" },
  filterLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.textGray,
    textAlign: "center",
  },
  emptyText: {
    fontSize: 12,
    color: COLORS.textGray,
    marginBottom: 10,
    fontStyle: "italic",
  },
  historyCard: {
    flexDirection: "row",
    marginBottom: 15,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  dateTag: {
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 15,
    minWidth: 100,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.secondary,
  },
  dateTagText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.primary,
  },
  cardContent: {
    flex: 1,
    justifyContent: "center",
  },
  cardTime: {
    fontSize: 12,
    color: COLORS.textGray,
    marginBottom: 4,
    fontWeight: "500",
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.darkGray,
  },
  cardMeta: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.textGray,
  },
  deleteBtn: {
    alignSelf: "center",
    borderWidth: 1.5,
    borderColor: "#ef4444",
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  deleteText: {
    color: "#ef4444",
    fontWeight: "900",
    fontSize: 11,
  },
});

export default HistoryScreen;
