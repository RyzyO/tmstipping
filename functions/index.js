const admin = require("firebase-admin");
const { DateTime } = require("luxon");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");

admin.initializeApp();

const db = admin.firestore();
const rtdb = admin.database();
const messaging = admin.messaging();

const REGION = "us-central1";
const TZ = "Australia/Sydney";
const MAX_MULTICAST_TOKENS = 500;

async function isAdminUser(uid) {
  if (!uid) return false;
  const adminSnap = await rtdb.ref(`users/${uid}/admin`).once("value");
  return adminSnap.exists() && adminSnap.val() === true;
}

function normalizeTokens(raw) {
  if (!raw) return [];
  if (typeof raw === "string") {
    return raw.trim() ? [raw.trim()] : [];
  }
  if (Array.isArray(raw)) {
    return raw
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean);
  }
  return [];
}

async function getUserTokenBundleByUid(userId) {
  if (!userId) return null;
  const userSnap = await db.collection("users").doc(userId).get();
  if (!userSnap.exists) return null;

  const data = userSnap.data() || {};
  const tokens = new Set([
    ...normalizeTokens(data.fcmToken),
    ...normalizeTokens(data.fcmTokens)
  ]);

  return {
    userId,
    email: data.email || null,
    displayName: [data.firstName, data.lastName].filter(Boolean).join(" ").trim() || data.displayName || data.teamName || null,
    tokens: Array.from(tokens)
  };
}

async function getTargetUsers(payload) {
  const audienceType = payload?.audienceType || "all";

  if (audienceType === "user") {
    if (payload?.userId) {
      const one = await getUserTokenBundleByUid(payload.userId);
      return one ? [one] : [];
    }

    if (payload?.userEmail) {
      const q = await db.collection("users").where("email", "==", payload.userEmail).limit(1).get();
      if (q.empty) return [];
      const one = await getUserTokenBundleByUid(q.docs[0].id);
      return one ? [one] : [];
    }

    return [];
  }

  if (audienceType === "competition" && payload?.compId) {
    const joinings = await db
      .collection("userCompJoinings")
      .where("compId", "==", payload.compId)
      .where("paymentStatus", "==", "completed")
      .get();

    const userIds = Array.from(new Set(joinings.docs.map((docSnap) => docSnap.data()?.userId).filter(Boolean)));
    const bundles = await Promise.all(userIds.map((uid) => getUserTokenBundleByUid(uid)));
    return bundles.filter(Boolean);
  }

  const usersSnap = await db.collection("users").get();
  const bundles = usersSnap.docs.map((docSnap) => {
    const data = docSnap.data() || {};
    const tokens = new Set([
      ...normalizeTokens(data.fcmToken),
      ...normalizeTokens(data.fcmTokens)
    ]);
    return {
      userId: docSnap.id,
      email: data.email || null,
      displayName: [data.firstName, data.lastName].filter(Boolean).join(" ").trim() || data.displayName || data.teamName || null,
      tokens: Array.from(tokens)
    };
  });

  return bundles;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function sendToTokenSet(tokens, title, body, data = {}) {
  const validTokens = Array.from(new Set((tokens || []).filter(Boolean)));
  if (!validTokens.length) {
    return { successCount: 0, failureCount: 0 };
  }

  let successCount = 0;
  let failureCount = 0;

  const chunks = chunkArray(validTokens, MAX_MULTICAST_TOKENS);
  for (const tokenChunk of chunks) {
    const response = await messaging.sendEachForMulticast({
      tokens: tokenChunk,
      notification: {
        title,
        body
      },
      data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)]))
    });

    successCount += response.successCount;
    failureCount += response.failureCount;
  }

  return { successCount, failureCount };
}

async function sendSelfTestNotification(request) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }

  const title = String(request.data?.title || "Cloud test notification").trim();
  const body = String(request.data?.body || "This was sent from Cloud Functions.").trim();

  const bundle = await getUserTokenBundleByUid(uid);
  const tokens = bundle?.tokens || [];
  const result = await sendToTokenSet(tokens, title, body, {
    category: "test",
    userId: uid
  });

  await db.collection("notifications").add({
    title,
    body,
    category: "test",
    audienceType: "user",
    userId: uid,
    userEmail: bundle?.email || request.auth?.token?.email || null,
    userDisplayName: bundle?.displayName || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdByUid: uid,
    createdByEmail: request.auth?.token?.email || null,
    successCount: result.successCount,
    failureCount: result.failureCount,
    targetUsers: 1,
    targetTokens: tokens.length
  });

  return {
    success: true,
    successCount: result.successCount,
    failureCount: result.failureCount,
    targetUsers: 1,
    targetTokens: tokens.length
  };
}

exports.sendAdminNotification = onCall({ region: REGION }, async (request, response) => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.status(204).send('');
    return;
  }

  // Set CORS headers for all responses
  response.set('Access-Control-Allow-Origin', '*');
  response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }

  const adminAllowed = await isAdminUser(uid);
  if (!adminAllowed) {
    throw new HttpsError("permission-denied", "Only admins can send notifications.");
  }

  const title = String(request.data?.title || "").trim();
  const body = String(request.data?.body || "").trim();
  const audienceType = request.data?.audienceType || "all";
  const compId = request.data?.compId || null;
  const userId = request.data?.userId || null;
  const userEmail = request.data?.userEmail || null;
  const userDisplayName = request.data?.userDisplayName || null;

  if (!title || !body) {
    throw new HttpsError("invalid-argument", "Title and body are required.");
  }

  const targets = await getTargetUsers({ audienceType, compId, userId, userEmail });
  const tokens = targets.flatMap((target) => target.tokens || []);
  const result = await sendToTokenSet(tokens, title, body, {
    category: "admin",
    audienceType,
    compId: compId || "",
    userId: userId || ""
  });

  await db.collection("notifications").add({
    title,
    body,
    category: "admin",
    audienceType,
    compId,
    userId,
    userEmail,
    userDisplayName,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdByUid: uid,
    createdByEmail: request.auth?.token?.email || null,
    successCount: result.successCount,
    failureCount: result.failureCount,
    targetUsers: targets.length,
    targetTokens: tokens.length
  });

  return {
    success: true,
    successCount: result.successCount,
    failureCount: result.failureCount,
    targetUsers: targets.length,
    targetTokens: tokens.length
  };
});

exports.sendUserTestNotification = onCall({ region: REGION }, async (request) => {
  return sendSelfTestNotification(request);
});

exports.sendNotificationTest = onCall({ region: REGION }, async (request) => {
  return sendSelfTestNotification(request);
});

exports.upsertRaceReminderSubscriptions = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }

  const races = Array.isArray(request.data?.races) ? request.data.races : [];
  const sanitized = races
    .map((race) => ({
      raceId: String(race?.raceId || "").trim(),
      name: String(race?.name || "").trim(),
      date: String(race?.date || "").trim(),
      time: String(race?.time || "").trim().substring(0, 5),
      compId: race?.compId ? String(race.compId).trim() : null
    }))
    .filter((race) => race.raceId && race.date && race.time)
    .slice(0, 250);

  await db.collection("userRaceReminderSubscriptions").doc(uid).set(
    {
      userId: uid,
      races: sanitized,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return { success: true, count: sanitized.length };
});

exports.sendRaceReminderNotifications = onSchedule(
  {
    schedule: "every 1 minutes",
    region: REGION,
    timeZone: TZ,
    retryCount: 2
  },
  async () => {
    const now = DateTime.now().setZone(TZ);
    const startWindow = now.plus({ minutes: 4 });
    const endWindow = now.plus({ minutes: 6 });

    const dateKeys = Array.from(new Set([
      startWindow.toFormat("yyyy-MM-dd"),
      endWindow.toFormat("yyyy-MM-dd")
    ]));

    const racesSnap = await db.collection("races").where("date", "in", dateKeys).get();
    if (racesSnap.empty) {
      return;
    }

    const subSnap = await db.collection("userRaceReminderSubscriptions").get();
    if (subSnap.empty) {
      return;
    }

    const subsByUser = new Map();
    subSnap.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const races = Array.isArray(data.races) ? data.races : [];
      subsByUser.set(docSnap.id, races);
    });

    for (const raceDoc of racesSnap.docs) {
      const race = raceDoc.data() || {};
      const raceId = raceDoc.id;
      const raceDate = String(race.date || "").trim();
      const raceTime = String(race.time || "").trim().substring(0, 5);
      if (!raceDate || !raceTime) {
        continue;
      }

      const jump = DateTime.fromFormat(`${raceDate} ${raceTime}`, "yyyy-MM-dd HH:mm", { zone: TZ });
      if (!jump.isValid) {
        continue;
      }

      if (jump < startWindow || jump > endWindow) {
        continue;
      }

      const reminderKey = `${raceId}_${raceDate}_${raceTime}`;
      const markerRef = db.collection("raceReminderSends").doc(reminderKey);
      const markerSnap = await markerRef.get();
      if (markerSnap.exists) {
        continue;
      }

      const eligibleUserIds = [];
      subsByUser.forEach((subRaces, userId) => {
        const matched = subRaces.some((entry) => {
          return (
            String(entry?.raceId || "") === raceId &&
            String(entry?.date || "") === raceDate &&
            String(entry?.time || "").substring(0, 5) === raceTime
          );
        });
        if (matched) {
          eligibleUserIds.push(userId);
        }
      });

      if (!eligibleUserIds.length) {
        await markerRef.set({
          raceId,
          raceDate,
          raceTime,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          successCount: 0,
          failureCount: 0,
          targetUsers: 0,
          targetTokens: 0
        });
        continue;
      }

      const tokenBundles = await Promise.all(eligibleUserIds.map((uid) => getUserTokenBundleByUid(uid)));
      const tokens = tokenBundles.filter(Boolean).flatMap((bundle) => bundle.tokens || []);

      const title = "Race starts in 5 minutes";
      const body = `${race.name || "Upcoming race"} jumps at ${raceTime} (Sydney)`;
      const result = await sendToTokenSet(tokens, title, body, {
        category: "race-reminder",
        raceId,
        raceDate,
        raceTime,
        compId: race.compId || ""
      });

      await db.collection("notifications").add({
        title,
        body,
        category: "race-reminder",
        audienceType: "race-subscription",
        raceId,
        compId: race.compId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdByUid: "system",
        createdByEmail: null,
        successCount: result.successCount,
        failureCount: result.failureCount,
        targetUsers: eligibleUserIds.length,
        targetTokens: tokens.length
      });

      await markerRef.set({
        raceId,
        raceDate,
        raceTime,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        successCount: result.successCount,
        failureCount: result.failureCount,
        targetUsers: eligibleUserIds.length,
        targetTokens: tokens.length
      });

      logger.info("Race reminder sent", {
        raceId,
        raceDate,
        raceTime,
        targetUsers: eligibleUserIds.length,
        targetTokens: tokens.length,
        successCount: result.successCount,
        failureCount: result.failureCount
      });
    }
  }
);
