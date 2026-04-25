import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import WeekCalendar from "../components/WeekCalendar";
import { useActivityStore } from "../store/ActivityProvider";
import { COLORS } from "../constants/theme";
import { cancelScheduledNotification, scheduleActivityReminder } from "../services/notifications";

function todayISO(d = new Date()) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${da}`;
}

function prettyISO(iso) {
  const [y, m, d] = iso.split("-").map((x) => Number(x));
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
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
  return `${months[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`;
}

const ToDoScreen = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const { state, actions } = useActivityStore();
  const [selectedDateISO, setSelectedDateISO] = useState(todayISO());
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newTimeLabel, setNewTimeLabel] = useState("");
  const [newKind, setNewKind] = useState("activity");
  const [newReminder, setNewReminder] = useState("none");

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

  const itemsForDay = useMemo(() => {
    return state.items.filter(
      (it) => it.status === "todo" && it.dateISO === selectedDateISO,
    );
  }, [state.items, selectedDateISO]);

  const activities = useMemo(
    () => itemsForDay.filter((it) => it.kind === "activity"),
    [itemsForDay],
  );
  const dues = useMemo(
    () => itemsForDay.filter((it) => it.kind === "due"),
    [itemsForDay],
  );

  const closeAndResetModal = () => {
    setAddOpen(false);
    setNewTitle("");
    setNewTimeLabel("");
    setNewKind("activity");
    setNewReminder("none");
  };

  const submitNew = () => {
    const title = newTitle.trim();
    if (!title) return;

    const item = actions.addItem({
      title,
      source: "manual",
      dateISO: selectedDateISO,
      timeLabel: newTimeLabel.trim(),
      status: "todo",
      kind: newKind === "due" ? "due" : "activity",
      reminder: newReminder,
    });

    // Best-effort scheduling (only when enabled + reminder chosen)
    if (state.settings.notificationsEnabled && item.reminder !== "none") {
      scheduleActivityReminder(item)
        .then((notificationId) => {
          if (notificationId) actions.updateItem(item.id, { notificationId });
        })
        .catch(() => {});
    }

    closeAndResetModal();
  };

  const finishItem = async (task) => {
    if (task.notificationId) {
      await cancelScheduledNotification(task.notificationId);
    }
    actions.markCompleted(task.id);
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
        <WeekCalendar
          selectedDateISO={selectedDateISO}
          onSelectDateISO={setSelectedDateISO}
        />

        <View style={styles.dateFilter}>
          <Text style={styles.filterText}>{prettyISO(selectedDateISO)}</Text>
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>To-Do List</Text>
          <TouchableOpacity style={styles.addBtnSmall} onPress={() => setAddOpen(true)}>
            <Text style={styles.addBtnSmallText}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {activities.length === 0 && (
          <Text style={styles.emptyText}>No activities for this day.</Text>
        )}
        {activities.map((task) => (
          <View key={task.id} style={styles.taskCard}>
            {!!task.timeLabel && <Text style={styles.taskTime}>{task.timeLabel}</Text>}
            <View style={styles.taskTitleBox}>
              <Text style={styles.taskTitle}>{task.title}</Text>
            </View>
            <TouchableOpacity
              style={styles.finishBtn}
              onPress={() => finishItem(task)}
            >
              <Text style={styles.finishBtnText}>Finish</Text>
            </TouchableOpacity>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Due</Text>
        {dues.length === 0 && <Text style={styles.emptyText}>No due items.</Text>}
        {dues.map((task) => (
          <View key={task.id} style={styles.dueCard}>
            <Text style={styles.dueDate}>{task.timeLabel || prettyISO(task.dateISO)}</Text>
            <Text style={styles.dueTitle}>{task.title}</Text>
            <TouchableOpacity
              style={styles.finishBtn}
              onPress={() => finishItem(task)}
            >
              <Text style={styles.finishBtnText}>Finish</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>

      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={closeAndResetModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add {newKind === "due" ? "Due" : "Activity"}</Text>
            <Text style={styles.modalSub}>{prettyISO(selectedDateISO)}</Text>

            <TextInput
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Title"
              placeholderTextColor="#94a3b8"
              style={styles.modalInput}
            />
            <TextInput
              value={newTimeLabel}
              onChangeText={setNewTimeLabel}
              placeholder={newKind === "due" ? "Due time (optional)" : "Time (optional)"}
              placeholderTextColor="#94a3b8"
              style={styles.modalInput}
            />

            <View style={styles.pillRow}>
              {[
                { id: "activity", label: "Activity" },
                { id: "due", label: "Due" },
              ].map((k) => {
                const active = newKind === k.id;
                return (
                  <TouchableOpacity
                    key={k.id}
                    onPress={() => setNewKind(k.id)}
                    style={[styles.pill, active && styles.pillActive]}
                  >
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>
                      {k.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.pillRow}>
              {[
                { id: "none", label: "No reminder" },
                { id: "1h", label: "1h" },
                { id: "1day", label: "1d" },
                { id: "1week", label: "1w" },
              ].map((r) => {
                const active = newReminder === r.id;
                return (
                  <TouchableOpacity
                    key={r.id}
                    onPress={() => setNewReminder(r.id)}
                    style={[styles.pill, active && styles.pillActive]}
                  >
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancel} onPress={closeAndResetModal}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSave} onPress={submitNew}>
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingBottom: 190,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: COLORS.darkGray,
  },
  addBtnSmall: {
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#f0fbfb",
  },
  addBtnSmallText: {
    color: COLORS.primary,
    fontWeight: "800",
    fontSize: 12,
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
  finishBtn: {
    alignSelf: "flex-start",
    backgroundColor: COLORS.primary,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 15,
  },
  finishBtnText: {
    fontSize: 11,
    color: "#fff",
    fontWeight: "800",
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
  emptyText: {
    fontSize: 12,
    color: COLORS.textGray,
    marginBottom: 12,
    fontStyle: "italic",
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
  modalSub: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.textGray,
    fontWeight: "600",
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#d9e1ea",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.darkGray,
    marginBottom: 10,
    backgroundColor: "#f8fafc",
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  pill: {
    borderWidth: 1.5,
    borderColor: "#d9e1ea",
    backgroundColor: "#fff",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  pillActive: {
    borderColor: COLORS.primary,
    backgroundColor: "#f0fbfb",
  },
  pillText: {
    color: COLORS.textGray,
    fontWeight: "800",
    fontSize: 11,
  },
  pillTextActive: {
    color: COLORS.primary,
  },
  modalBtnRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  modalCancel: {
    flex: 1,
    marginRight: 8,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  modalCancelText: {
    fontWeight: "900",
    color: COLORS.textGray,
  },
  modalSave: {
    flex: 1,
    marginLeft: 8,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: COLORS.primary,
  },
  modalSaveText: {
    fontWeight: "900",
    color: "#fff",
  },
});

export default ToDoScreen;
