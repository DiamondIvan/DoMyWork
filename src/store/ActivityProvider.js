import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useReducer } from "react";

const STORAGE_KEY = "crow.activityStore.v1";

/**
 * @typedef {'telegram'|'email'|'spectrum'|'manual'} ActivitySource
 * @typedef {'pending'|'todo'|'completed'} ActivityStatus
 * @typedef {'activity'|'due'} ActivityKind
 * @typedef {'none'|'1h'|'1day'|'1week'} ReminderPreset
 */

/**
 * @typedef {Object} ActivityItem
 * @property {string} id
 * @property {string} title
 * @property {ActivitySource} source
 * @property {string} dateISO  // YYYY-MM-DD
 * @property {string} timeLabel
 * @property {ActivityStatus} status
 * @property {ActivityKind} kind
 * @property {ReminderPreset} reminder
 * @property {string=} notificationId
 * @property {string} createdAtISO
 * @property {string=} completedAtISO
 */

/**
 * @typedef {Object} ActivityStoreState
 * @property {ActivityItem[]} items
 * @property {{notificationsEnabled: boolean}} settings
 * @property {boolean} hydrated
 */

const ActivityStoreContext = createContext(
  /** @type {null | {
   *  state: ActivityStoreState,
   *  actions: {
   *    addItem: (input: Omit<ActivityItem,'id'|'createdAtISO'> & { id?: string, createdAtISO?: string }) => ActivityItem,
   *    updateItem: (id: string, patch: Partial<ActivityItem>) => void,
   *    deleteItem: (id: string) => void,
   *    confirmPending: (id: string) => void,
   *    markCompleted: (id: string) => void,
   *    setNotificationsEnabled: (enabled: boolean) => void,
   *  }
   * }} */ (null),
);

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function todayISO(d = new Date()) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${da}`;
}

function makeId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/** @type {ActivityStoreState} */
const initialState = {
  items: [],
  settings: { notificationsEnabled: false },
  hydrated: false,
};

function normalizeLoadedState(maybe) {
  if (!maybe || typeof maybe !== "object") return initialState;
  const items = Array.isArray(maybe.items) ? maybe.items : [];
  const settings = maybe.settings && typeof maybe.settings === "object" ? maybe.settings : {};
  return {
    items,
    settings: {
      notificationsEnabled: Boolean(settings.notificationsEnabled),
    },
    hydrated: true,
  };
}

function reducer(state, action) {
  switch (action.type) {
    case "HYDRATE": {
      return normalizeLoadedState(action.payload);
    }
    case "ADD_ITEM": {
      return { ...state, items: [action.item, ...state.items] };
    }
    case "UPDATE_ITEM": {
      return {
        ...state,
        items: state.items.map((it) => (it.id === action.id ? { ...it, ...action.patch } : it)),
      };
    }
    case "DELETE_ITEM": {
      return { ...state, items: state.items.filter((it) => it.id !== action.id) };
    }
    case "SET_NOTIFICATIONS_ENABLED": {
      return {
        ...state,
        settings: { ...state.settings, notificationsEnabled: Boolean(action.enabled) },
      };
    }
    default:
      return state;
  }
}

export function ActivityProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (cancelled) return;
      const parsed = raw ? safeParse(raw) : null;
      dispatch({ type: "HYDRATE", payload: parsed });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ items: state.items, settings: state.settings }),
    ).catch(() => {
      // ignore persistence failure (e.g. storage full)
    });
  }, [state.items, state.settings, state.hydrated]);

  const actions = useMemo(() => {
    return {
      addItem: (input) => {
        const now = new Date().toISOString();
        /** @type {ActivityItem} */
        const item = {
          id: input.id ?? makeId(),
          title: input.title?.trim?.() ?? String(input.title ?? "").trim(),
          source: input.source ?? "manual",
          dateISO: input.dateISO ?? todayISO(),
          timeLabel: input.timeLabel ?? "",
          status: input.status ?? "todo",
          kind: input.kind ?? "activity",
          reminder: input.reminder ?? "none",
          notificationId: input.notificationId,
          createdAtISO: input.createdAtISO ?? now,
          completedAtISO: input.completedAtISO,
        };
        dispatch({ type: "ADD_ITEM", item });
        return item;
      },
      updateItem: (id, patch) => dispatch({ type: "UPDATE_ITEM", id, patch }),
      deleteItem: (id) => dispatch({ type: "DELETE_ITEM", id }),
      confirmPending: (id) =>
        dispatch({ type: "UPDATE_ITEM", id, patch: { status: "todo" } }),
      markCompleted: (id) =>
        dispatch({
          type: "UPDATE_ITEM",
          id,
          patch: { status: "completed", completedAtISO: new Date().toISOString() },
        }),
      setNotificationsEnabled: (enabled) =>
        dispatch({ type: "SET_NOTIFICATIONS_ENABLED", enabled }),
    };
  }, []);

  const value = useMemo(() => ({ state, actions }), [state, actions]);

  return <ActivityStoreContext.Provider value={value}>{children}</ActivityStoreContext.Provider>;
}

export function useActivityStore() {
  const ctx = useContext(ActivityStoreContext);
  if (!ctx) {
    throw new Error("useActivityStore must be used within ActivityProvider");
  }
  return ctx;
}

