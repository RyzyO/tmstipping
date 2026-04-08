// user-notification-service.js
// Centralized notification logic for all pages
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging.js";
import { getApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js";

const VAPID_KEY = "BO4uGOEfVg5qRKLRTapkgdZJj22xf3_CBV1TlZg_jjCkvDg0qEVB46mgewqtK9MrUy1atMjlJS4DefmX7fI-IYg";

export function setupNotificationListener(showAlert = true) {
  const messaging = getMessaging(getApp());
  if (window.__notificationListenerBound) return;
  window.__notificationListenerBound = true;
  onMessage(messaging, (payload) => {
    if (showAlert && payload?.notification) {
      alert(`${payload.notification.title}\n${payload.notification.body}`);
    }
    // Optionally, dispatch a custom event for app-specific handling
    window.dispatchEvent(new CustomEvent("fcm-notification", { detail: payload }));
  });
}

export async function getAndSaveFcmToken(db, user) {
  const messaging = getMessaging(getApp());
  if (!user) return null;
  try {
    await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (!token) return null;
    // Save token to Firestore
    await db.collection("users").doc(user.uid).set({
      fcmTokens: window.firebase.firestore.FieldValue.arrayUnion(token),
      notificationSettings: { enabled: true, updatedAt: window.firebase.firestore.FieldValue.serverTimestamp() }
    }, { merge: true });
    return token;
  } catch (e) {
    console.warn("Unable to get/save FCM token", e);
    return null;
  }
}

export function sendAdminNotification(functions, data) {
  const callSendAdminNotification = httpsCallable(functions, "sendAdminNotification");
  return callSendAdminNotification(data);
}
