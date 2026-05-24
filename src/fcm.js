import { getToken, onMessage } from "firebase/messaging";
import { arrayRemove, arrayUnion, doc, updateDoc } from "firebase/firestore";
import { db, messagingPromise } from "./firebase";

const VAPID_KEY = import.meta.env.VITE_VAPID_KEY || import.meta.env.VITE_FIREBASE_VAPID_KEY || (typeof process !== "undefined" && process.env ? process.env.REACT_APP_FIREBASE_VAPID_KEY : "");

export async function registerMessagingServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCBUNH17bEyq_Beqw7w6HAJLJRb5IB_gAM",
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "cloud-chat-app-7ad88.firebaseapp.com",
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "cloud-chat-app-7ad88",
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "cloud-chat-app-7ad88.firebasestorage.app",
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "265976516811",
      appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:265976516811:web:f28da952ef7bbaedd00b4e"
    }).toString();

    return await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${params}`);
  } catch (error) {
    console.error("Service worker registration failed", error);
    return null;
  }
}

export async function requestNotificationPermissionAndToken(userId) {
  if (!userId || typeof window === "undefined" || typeof Notification === "undefined") {
    return null;
  }

  const messaging = await messagingPromise;
  if (!messaging || !VAPID_KEY) {
    return null;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return null;
  }

  const registration =
    (await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js")) ||
    (await registerMessagingServiceWorker());

  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration || undefined
  });

  if (token) {
    await updateDoc(doc(db, "users", userId), {
      fcmTokens: arrayUnion(token)
    });
  }

  return token;
}

export async function removeFcmToken(userId, token) {
  if (!userId || !token) {
    return;
  }

  await updateDoc(doc(db, "users", userId), {
    fcmTokens: arrayRemove(token)
  });
}

export function listenForForegroundMessages(callback) {
  let unsubscribe = () => {};

  messagingPromise
    .then((messaging) => {
      if (!messaging) {
        return;
      }

      unsubscribe = onMessage(messaging, (payload) => {
        if (typeof callback === "function") {
          callback(payload);
        }
      });
    })
    .catch((error) => {
      console.error("Foreground messaging unavailable", error);
    });

  return () => {
    unsubscribe();
  };
}
