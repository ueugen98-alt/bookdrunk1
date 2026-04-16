import { initializeApp } from "firebase/app";
import { initializeAuth, browserLocalPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyAMtpSMGFCvfkcxqj6Vt13qJs-FOTmTL24",
  authDomain: "drunkbook.firebaseapp.com",
  projectId: "drunkbook",
  storageBucket: "drunkbook.firebasestorage.app",
  messagingSenderId: "789487888011",
  appId: "1:789487888011:web:24f6fc1ffb97d7e1a7168e"
};

const app = initializeApp(firebaseConfig);

export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence
});

export const db = getFirestore(app);

export let messaging = null;
try {
  messaging = getMessaging(app);
} catch(e) {
  console.log('Messaging not supported');
}

export const VAPID_KEY = "BNSGQ7mOsyrQMV06bWITjSj1mOhIMXGTiplhZdB51Dz5Ihjhe8GfrPdGoOwbfDMKbW83MkAVUVfzWxznmFC4Lx0";

export async function requestNotificationPermission() {
  if (!messaging) return null;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    return token;
  } catch(e) {
    console.log('Notification permission error:', e);
    return null;
  }
}

export { onMessage };
