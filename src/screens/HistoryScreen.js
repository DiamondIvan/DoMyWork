import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { COLORS } from "../constants/theme";

const HistoryScreen = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const historyItems = [
    {
      id: 1,
      date: "Mar 29, 2025",
      time: "8:00AM - 10:00AM",
      title: "CM Lecture",
      status: "completed",
    },
    {
      id: 2,
      date: "Mar 29, 2025",
      time: "2:00PM - 4:00PM",
      title: "Viva 1",
      status: "completed",
    },
    {
      id: 3,
      date: "Mar 29, 2025",
      time: "9:00AM - 12:00AM",
      title: "DS Tutorial",
      status: "completed",
    },
    {
      id: 4,
      date: "Mar 29, 2025",
      time: "11:24PM",
      title: "DS Tutorial submitted",
      status: "submitted",
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

        {historyItems.map((item) => (
          <View key={item.id} style={styles.historyCard}>
            <View style={styles.dateTag}>
              <Text style={styles.dateTagText}>{item.date}</Text>
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.cardTime}>{item.time}</Text>
              <Text style={styles.cardTitle}>{item.title}</Text>
            </View>
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
    paddingBottom: 130,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 20,
    color: COLORS.darkGray,
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
});

export default HistoryScreen;
