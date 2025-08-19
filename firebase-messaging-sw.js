importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCrgNrA4n62hg1U3ujZMRCOYcbLcwT77ZA",
  authDomain: "tmstipping.firebaseapp.com",
  projectId: "tmstipping",
  storageBucket: "tmstipping.appspot.com",
  messagingSenderId: "401677933527",
  appId: "1:401677933527:web:2312ad4ef69aef6551c992",
  measurementId: "G-GXLRCHV687"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  const notificationTitle = payload.notification.title || 'Notification';
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/logo.jfif'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});