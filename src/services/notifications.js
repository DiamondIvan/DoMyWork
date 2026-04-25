import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureNotificationPermission() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return { granted: true, status: current.status };
  }

  const requested = await Notifications.requestPermissionsAsync();
  const granted =
    requested.granted ||
    requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  return { granted, status: requested.status };
}

function parseFirstTimeTo24h(timeLabel) {
  // Best-effort: parse "9:00AM - 10:00AM" or "9am" etc.
  const s = String(timeLabel || "").trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? "0");
  const ampm = m[3]?.toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, min };
}

function computeBaseDate(activity) {
  const [y, m, d] = String(activity.dateISO || "").split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  const parsed = parseFirstTimeTo24h(activity.timeLabel);
  if (parsed) dt.setHours(parsed.h, parsed.min, 0, 0);
  else dt.setHours(9, 0, 0, 0); // default
  return dt;
}

function applyReminderOffset(baseDate, reminder) {
  const d = new Date(baseDate);
  if (reminder === "1h") d.setHours(d.getHours() - 1);
  if (reminder === "1day") d.setDate(d.getDate() - 1);
  if (reminder === "1week") d.setDate(d.getDate() - 7);
  return d;
}

export async function cancelScheduledNotification(notificationId) {
  if (!notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // ignore
  }
}

export async function scheduleActivityReminder(activity) {
  if (!activity || activity.reminder === "none") return null;
  const base = computeBaseDate(activity);
  if (!base) return null;
  const fireDate = applyReminderOffset(base, activity.reminder);
  if (fireDate.getTime() <= Date.now() + 30 * 1000) {
    return null;
  }

  // Android needs a channel to control importance/sound
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("crow-reminders", {
      name: "Crow reminders",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const title = activity.kind === "due" ? "Due reminder" : "Activity reminder";
  const body = activity.title || "You have a reminder.";
  const id = await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: fireDate,
  });
  return id;
}

