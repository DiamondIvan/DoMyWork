import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { COLORS } from "../constants/theme";

function toISO(d) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${da}`;
}

function startOfWeek(date) {
  // Monday-start week
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function WeekCalendar({ selectedDateISO, onSelectDateISO }) {
  const days = useMemo(() => {
    const base = startOfWeek(new Date());
    return Array.from({ length: 7 }).map((_, idx) => {
      const d = addDays(base, idx);
      return { dow: DOW[idx], day: d.getDate(), dateISO: toISO(d) };
    });
  }, []);

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {days.map((d) => {
          const active = d.dateISO === selectedDateISO;
          return (
            <TouchableOpacity
              key={d.dateISO}
              onPress={() => onSelectDateISO(d.dateISO)}
              style={[styles.dayPill, active && styles.dayPillActive]}
            >
              <Text style={[styles.dowText, active && styles.dowTextActive]}>{d.dow}</Text>
              <Text style={[styles.dayText, active && styles.dayTextActive]}>{d.day}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 16,
  },
  dayPill: {
    width: 54,
    height: 62,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.secondary,
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  dayPillActive: {
    backgroundColor: COLORS.primary,
  },
  dowText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.primary,
  },
  dowTextActive: {
    color: "#fff",
  },
  dayText: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.darkGray,
  },
  dayTextActive: {
    color: "#fff",
  },
});

