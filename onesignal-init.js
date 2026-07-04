// Shared OneSignal bootstrap — included on every logged-in page.
// Exposes window.TMS_OneSignal for pages to log the Supabase user in/out
// and to request push permission, without each page re-initialising the SDK.
window.OneSignalDeferred = window.OneSignalDeferred || [];

const oneSignalReady = new Promise((resolve) => {
  window.OneSignalDeferred.push(async function (OneSignal) {
    await OneSignal.init({
      appId: "6521b586-f3af-4422-b488-449a78cb8a44",
      safari_web_id: "web.onesignal.auto.13a94bce-1224-4d5f-912e-16820eddb8b3",
      serviceWorkerPath: "/OneSignalSDKWorker.js",
      notifyButton: { enable: true },
    });
    resolve(OneSignal);
  });
});

window.TMS_OneSignal = {
  async login(externalId) {
    if (!externalId) return;
    const OneSignal = await oneSignalReady;
    await OneSignal.login(String(externalId));
  },
  async logout() {
    const OneSignal = await oneSignalReady;
    await OneSignal.logout();
  },
  // Uses the Users-model opt-in call (not just Notifications.requestPermission),
  // since that's what actually (re)creates the push subscription in OneSignal —
  // requestPermission alone can leave a previously-opted-out user unsubscribed.
  async requestPermission() {
    const OneSignal = await oneSignalReady;
    await OneSignal.User.PushSubscription.optIn();
    return OneSignal.User.PushSubscription.optedIn ? "granted" : "default";
  },
  async isOptedIn() {
    const OneSignal = await oneSignalReady;
    return OneSignal.User.PushSubscription.optedIn;
  },
};
