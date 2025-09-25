// main.js
import { initAuth } from "./auth.js";
import { initNotifications } from "./notifications.js";

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initNotifications();
});
