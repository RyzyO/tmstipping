// notifications.js
import { messaging } from "./firebase-config.js";
import { getToken, onMessage } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging.js";

export function initNotifications() {
  const button = document.getElementById('enableNotifications');
  const btnText = document.getElementById('notif-btn-text');
  const btnSpinner = document.getElementById('notif-btn-spinner');

  if (!button) return;

  function updateBtnVisibility() {
    if ('Notification' in window) {
      if (Notification.permission === 'default' || Notification.permission === 'denied') {
        button.style.display = 'inline-flex';
        btnText.textContent = "Enable Notifications";
      } else {
        button.style.display = 'none';
      }
    } else {
      button.style.display = 'none';
    }
  }

  async function enableNotifications() {
    btnText.textContent = "Enabling...";
    btnSpinner.style.display = "inline-block";
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        const token = await getToken(messaging, {
          vapidKey: "BO4uGOEfVg5qRKLRTapkgdZJj22xf3_CBV1TlZg_jjCkvDg0qEVB46mgewqtK9MrUy1atMjlJS4DefmX7fI-IYg"
        });
        console.log("✅ FCM Token:", token);
        btnText.textContent = "Notifications Enabled";
      } else {
        btnText.textContent = "Permission Denied";
      }
    } catch (err) {
      console.error("Notification error:", err);
      btnText.textContent = "Error";
    }
    btnSpinner.style.display = "none";
    setTimeout(updateBtnVisibility, 1500);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/firebase-messaging-sw.js')
      .then(() => {
        console.log("✅ Service Worker registered");
        updateBtnVisibility();
        button.addEventListener('click', enableNotifications);
      })
      .catch(err => console.error("SW registration failed:", err));
  }

  onMessage(messaging, (payload) => {
    console.log("🔔 Foreground message:", payload);
    alert(`${payload.notification.title}\n${payload.notification.body}`);
  });
}
