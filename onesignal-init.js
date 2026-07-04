// Shared OneSignal bootstrap — included on every logged-in page.
// Exposes window.TMS_OneSignal for pages to log the Supabase user in/out
// and to request push permission, without each page re-initialising the SDK.
window.OneSignalDeferred = window.OneSignalDeferred || [];

const oneSignalReady = new Promise((resolve) => {
  window.OneSignalDeferred.push(async function (OneSignal) {
    await OneSignal.init({
      appId: "6521b586-f3af-4422-b488-449a78cb8a44",
      safari_web_id: "web.onesignal.auto.13a94bce-1224-4d5f-912e-16820eddb8b3",
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
  async requestPermission() {
    const OneSignal = await oneSignalReady;
    await OneSignal.Notifications.requestPermission();
    return OneSignal.Notifications.permission;
  },
  async isOptedIn() {
    const OneSignal = await oneSignalReady;
    return OneSignal.User.PushSubscription.optedIn;
  },
};
