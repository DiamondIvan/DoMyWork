import { useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { COLORS } from "../constants/theme";

const ToDoScreen = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [tasks, setTasks] = useState([
    {
      id: 1,
      time: "9:00AM - 10:00AM",
      title: "Assignment Meeting",
      completed: false,
    },
    {
      id: 2,
      time: "5:00PM - 9:00PM",
      title: "Part-Time Job",
      completed: false,
    },
  ]);
  const [isDueCompleted, setIsDueCompleted] = useState(false);

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

  const toggleTaskComplete = (taskId) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, completed: !task.completed } : task,
      ),
    );
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
        <Text style={styles.sectionTitle}>To-Do List</Text>

        <View style={styles.dateFilter}>
          <Text style={styles.filterText}>{formatDate(currentTime)}</Text>
        </View>

        {tasks.map((task) => (
          <View key={task.id} style={styles.taskCard}>
            <Text style={styles.taskTime}>{task.time}</Text>
            <View style={styles.taskTitleBox}>
              <Text
                style={[
                  styles.taskTitle,
                  task.completed && styles.taskTitleDone,
                ]}
              >
                {task.title}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.finishBtn, task.completed && styles.finishBtnDone]}
              onPress={() => toggleTaskComplete(task.id)}
            >
              <Text
                style={[
                  styles.finishBtnText,
                  task.completed && styles.finishBtnTextDone,
                ]}
              >
                {task.completed ? "Completed" : "Finish Progress"}
              </Text>
            </TouchableOpacity>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Due Date</Text>
        <View style={styles.dueCard}>
          <Text style={styles.dueDate}>Apr 30, 2025 11:59PM</Text>
          <Text style={styles.dueTitle}>DS Assignment</Text>
          <TouchableOpacity
            style={[styles.finishBtn, isDueCompleted && styles.finishBtnDone]}
            onPress={() => setIsDueCompleted((prev) => !prev)}
          >
            <Text
              style={[
                styles.finishBtnText,
                isDueCompleted && styles.finishBtnTextDone,
              ]}
            >
              {isDueCompleted ? "Completed" : "Finish Progress"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  content: {
    padding: 20,
    paddingBottom: 130,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginVertical: 15,
    color: COLORS.darkGray,
  },
  dateFilter: {
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: "flex-start",
    marginBottom: 20,
  },
  filterText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: "600",
  },
  taskCard: {
    marginBottom: 20,
  },
  taskTime: {
    color: COLORS.primary,
    fontWeight: "600",
    marginBottom: 8,
    fontSize: 13,
  },
  taskTitleBox: {
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 10,
    padding: 12,
    backgroundColor: COLORS.secondary,
    marginBottom: 10,
  },
  taskTitle: {
    fontSize: 15,
    color: COLORS.darkGray,
    fontWeight: "500",
  },
  taskTitleDone: {
    textDecorationLine: "line-through",
    color: COLORS.textGray,
  },
  finishBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#eee",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 15,
  },
  finishBtnDone: {
    backgroundColor: "#d9f6de",
  },
  finishBtnText: {
    fontSize: 11,
    color: COLORS.textGray,
    fontWeight: "600",
  },
  finishBtnTextDone: {
    color: "#0e7d2f",
  },
  dueCard: {
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 10,
    padding: 15,
    backgroundColor: COLORS.secondary,
  },
  dueDate: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: "600",
    marginBottom: 5,
  },
  dueTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.darkGray,
    marginBottom: 10,
  },
});

export default ToDoScreen;
