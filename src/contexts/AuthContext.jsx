import React, { createContext, useContext, useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "../firebase";
import {
  listenForForegroundMessages,
  registerMessagingServiceWorker,
  requestNotificationPermissionAndToken
} from "../fcm";

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const setPresence = async (uid, status) => {
    if (!uid) {
      return;
    }

    try {
      await updateDoc(doc(db, "users", uid), {
        status,
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Presence update failed", error);
    }
  };

  useEffect(() => {
    registerMessagingServiceWorker();

    const unsubscribeOnMessage = listenForForegroundMessages((payload) => {
      const title = payload?.notification?.title || payload?.data?.title || "New message";
      const body = payload?.notification?.body || payload?.data?.body || "You have a new message.";

      if (Notification.permission === "granted") {
        new Notification(title, {
          body,
          icon: payload?.notification?.icon || "/logo192.png"
        });
      }
    });

    return () => {
      unsubscribeOnMessage();
    };
  }, []);

  useEffect(() => {
    getRedirectResult(auth).catch((error) => {
      console.error("Google redirect sign-in failed", error);
    });
  }, []);

  useEffect(() => {
    const loadingFallback = setTimeout(() => {
      setLoading((previous) => (previous ? false : previous));
    }, 8000);

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setLoading(true);

      try {
        if (currentUser) {
          // Never block app entry on profile sync/network issues.
          setUser(currentUser);

          const userRef = doc(db, "users", currentUser.uid);
          let snapshot = null;
          try {
            snapshot = await getDoc(userRef);
          } catch (readError) {
            console.error("User profile read failed", readError);
          }

          const baseUserData = {
            uid: currentUser.uid,
            email: currentUser.email,
            displayName:
              currentUser.displayName ||
              (currentUser.email ? currentUser.email.split("@")[0] : "User"),
            photoURL: currentUser.photoURL || "",
            status: "online",
            lastSeen: serverTimestamp(),
            updatedAt: serverTimestamp()
          };

          try {
            if (!snapshot || !snapshot.exists()) {
              await setDoc(userRef, {
                ...baseUserData,
                friends: [],
                fcmTokens: [],
                createdAt: serverTimestamp()
              });
            } else {
              await setDoc(userRef, baseUserData, { merge: true });
            }
          } catch (writeError) {
            console.error("User profile write failed", writeError);
          }

          requestNotificationPermissionAndToken(currentUser.uid).catch((error) => {
            console.error("Unable to store FCM token", error);
          });
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error("Auth sync error", error);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      clearTimeout(loadingFallback);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user?.uid || typeof window === "undefined") {
      return undefined;
    }

    const markOnline = () => setPresence(user.uid, "online");
    const markOffline = () => setPresence(user.uid, "offline");

    const onVisibilityChange = () => {
      if (document.hidden) {
        markOffline();
      } else {
        markOnline();
      }
    };

    window.addEventListener("focus", markOnline);
    window.addEventListener("beforeunload", markOffline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    markOnline();

    return () => {
      window.removeEventListener("focus", markOnline);
      window.removeEventListener("beforeunload", markOffline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      markOffline();
    };
  }, [user?.uid]);

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      return { mode: "popup" };
    } catch (error) {
      const code = error?.code || "";

      // Fallback to redirect when popup is blocked or unsupported on this browser/session.
      if (
        code === "auth/popup-blocked" ||
        code === "auth/operation-not-supported-in-this-environment" ||
        code === "auth/web-storage-unsupported" ||
        code === "auth/unauthorized-domain"
      ) {
        await signInWithRedirect(auth, googleProvider);
        return { mode: "redirect" };
      }

      throw error;
    }
  };
  const signup = (email, password) => createUserWithEmailAndPassword(auth, email, password);
  const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
  const resetPassword = (email) => sendPasswordResetEmail(auth, email);

  const saveProfile = async ({ displayName, photoURL }) => {
    if (!auth.currentUser) {
      throw new Error("No authenticated user");
    }

    await updateProfile(auth.currentUser, {
      displayName,
      photoURL
    });

    await setDoc(
      doc(db, "users", auth.currentUser.uid),
      {
        displayName: displayName || auth.currentUser.email?.split("@")[0] || "User",
        photoURL: photoURL || "",
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    setUser({ ...auth.currentUser });
  };

  const logout = async () => {
    if (auth.currentUser?.uid) {
      await setPresence(auth.currentUser.uid, "offline");
    }

    return signOut(auth);
  };

  const value = {
    user,
    loading,
    loginWithGoogle,
    login,
    signup,
    resetPassword,
    saveProfile,
    logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
