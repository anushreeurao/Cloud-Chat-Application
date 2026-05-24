import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getMessaging, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || (typeof process !== "undefined" && process.env ? process.env.REACT_APP_FIREBASE_API_KEY : "") || "AIzaSyCBUNH17bEyq_Beqw7w6HAJLJRb5IB_gAM",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || (typeof process !== "undefined" && process.env ? process.env.REACT_APP_FIREBASE_AUTH_DOMAIN : "") || "cloud-chat-app-7ad88.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || (typeof process !== "undefined" && process.env ? process.env.REACT_APP_FIREBASE_PROJECT_ID : "") || "cloud-chat-app-7ad88",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    (typeof process !== "undefined" && process.env ? process.env.REACT_APP_FIREBASE_STORAGE_BUCKET : "") ||
    "cloud-chat-app-7ad88.firebasestorage.app",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
    (typeof process !== "undefined" && process.env ? process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID : "") ||
    "265976516811",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    (typeof process !== "undefined" && process.env ? process.env.REACT_APP_FIREBASE_APP_ID : "") ||
    "1:265976516811:web:f28da952ef7bbaedd00b4e"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account"
});
export const db = getFirestore(app);
export const storage = getStorage(app);
storage.maxUploadRetryTime = 25000;
storage.maxOperationRetryTime = 15000;

export const messagingPromise =
  typeof window === "undefined"
    ? Promise.resolve(null)
    : isSupported()
        .then((supported) => (supported ? getMessaging(app) : null))
        .catch(() => null);
