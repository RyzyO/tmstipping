import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { getToken, onMessage } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging.js";

const VAPID_KEY = "BO4uGOEfVg5qRKLRTapkgdZJj22xf3_CBV1TlZg_jjCkvDg0qEVB46mgewqtK9MrUy1atMjlJS4DefmX7fI-IYg";
const RACE_REMINDER_PREFIX = "tmstipping:raceReminder";

let foregroundMessageBound = false;
const pendingRaceTimers = new Map();

function getSydneyMillis(date, time) {
  if (!date || !time) return NaN;

  if (window?.luxon?.DateTime) {
    const dt = window.luxon.DateTime.fromFormat(
      `${date} ${time.substring(0, 5)}`,
      "yyyy-MM-dd HH:mm",
      { zone: "Australia/Sydney" }
    );
    return dt.isValid ? dt.toMillis() : NaN;
  }

  const fallback = new Date(`${date}T${time}`);
  return Number.isFinite(fallback.getTime()) ? fallback.getTime() : NaN;
}

function rememberReminderSent(reminderId) {
  try {
    localStorage.setItem(`${RACE_REMINDER_PREFIX}:${reminderId}`, "1");
  } catch {
    // no-op
  }
}

function hasReminderBeenSent(reminderId) {
  try {
    return localStorage.getItem(`${RACE_REMINDER_PREFIX}:${reminderId}`) === "1";
  } catch {
    return false;
  }
}

function showBrowserNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  new Notification(title || "Notification", {
    body: body || "",
    icon: "/logo.jfif"
  });
}

async function registerPushToken(db, user, messaging) {
  if (!user || !messaging) return;
  if (!("serviceWorker" in navigator)) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (!token) return;

    const userRef = doc(db, "users", user.uid);
    const currentUserSnap = await getDoc(userRef);
    const currentToken = currentUserSnap.exists() ? currentUserSnap.data()?.fcmToken : null;

    if (currentToken !== token) {
      await setDoc(
        userRef,
        {
          fcmToken: token,
          fcmTokenUpdatedAt: serverTimestamp()
        },
        { merge: true }
      );
    }
  } catch (error) {
    console.warn("Unable to register push token:", error);
  }
}

export async function initUserNotificationCenter({ db, messaging, user, getRelevantCompIds }) {
  if (!db || !user) {
    return () => {};
  }

  if (!("Notification" in window)) {
    return () => {};
  }

  if (!foregroundMessageBound && messaging) {
    foregroundMessageBound = true;
    onMessage(messaging, (payload) => {
      const title = payload?.notification?.title || payload?.data?.title || "Notification";
      const body = payload?.notification?.body || payload?.data?.body || "";
      showBrowserNotification(title, body);
    });
  }

  await registerPushToken(db, user, messaging);

  const initTime = Date.now();
  const lastSeenMap = new Set();

  const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(80));
  const unsubscribe = onSnapshot(q, async (snap) => {
    let compIds = [];
    try {
      compIds = (await (getRelevantCompIds?.() || Promise.resolve([]))).filter(Boolean);
    } catch {
      compIds = [];
    }

    snap.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const id = docSnap.id;

      const userIdMatch = !!data.userId && data.userId === user.uid;
      const userEmailMatch =
        !!data.userEmail &&
        !!user.email &&
        String(data.userEmail).toLowerCase() === String(user.email).toLowerCase();

      const audienceType = data.audienceType || "all";
      const isRelevant =
        audienceType === "all" ||
        (audienceType === "user" && (userIdMatch || userEmailMatch)) ||
        (audienceType === "competition" && data.compId && compIds.includes(data.compId));

      if (!isRelevant) return;

      if (!lastSeenMap.has(id)) {
        lastSeenMap.add(id);
        const createdAtMs = data.createdAt?.toMillis ? data.createdAt.toMillis() : initTime;

        // Prevent a flood from older docs when the listener starts.
        if (createdAtMs >= initTime - 2000) {
          showBrowserNotification(data.title || "Notification", data.body || "");
        }
      }
    });
  });

  return unsubscribe;
}

export async function requestNotificationPermission({ db, user, messaging }) {
  if (!("Notification" in window)) return { ok: false, reason: "unsupported" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: permission };
  }

  await registerPushToken(db, user, messaging);
  return { ok: true };
}

export function scheduleRaceReminderNotifications(races, options = {}) {
  const list = Array.isArray(races) ? races : [];
  const now = Date.now();
  const compId = options.compId || "any";

  for (const race of list) {
    if (!race?.id || !race?.date || !race?.time) continue;

    const jumpAt = getSydneyMillis(race.date, race.time);
    if (!Number.isFinite(jumpAt)) continue;

    const reminderAt = jumpAt - 5 * 60 * 1000;
    const reminderId = `${compId}:${race.id}:${race.date}:${race.time}`;
    const timerKey = `${RACE_REMINDER_PREFIX}:${reminderId}`;

    if (hasReminderBeenSent(reminderId)) continue;

    const fireReminder = () => {
      if (hasReminderBeenSent(reminderId)) return;

      const title = `Race starts in 5 minutes`;
      const raceName = race.name || "Upcoming race";
      showBrowserNotification(title, `${raceName} jumps at ${race.time.substring(0, 5)} (Sydney)`);
      rememberReminderSent(reminderId);
      pendingRaceTimers.delete(timerKey);
    };

    if (now >= reminderAt && now < jumpAt) {
      fireReminder();
      continue;
    }

    if (reminderAt <= now) {
      continue;
    }

    const delay = reminderAt - now;
    const maxDelay = 24 * 60 * 60 * 1000;

    if (delay > maxDelay) {
      continue;
    }

    if (pendingRaceTimers.has(timerKey)) {
      continue;
    }

    const timeoutId = setTimeout(fireReminder, delay);
    pendingRaceTimers.set(timerKey, timeoutId);
  }
}
