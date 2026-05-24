import { useEffect, useState, useCallback, useRef } from "react";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "firebase/firestore";
import { db } from "../firebase";

function sortByCreatedAtDesc(items) {
  return [...items].sort((a, b) => {
    const aMillis = a.createdAt?.toMillis?.() || 0;
    const bMillis = b.createdAt?.toMillis?.() || 0;
    return bMillis - aMillis;
  });
}

async function showBrowserNotification(title, body) {
  if (typeof Notification === "undefined") {
    return false;
  }

  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      return false;
    }
  }

  if (Notification.permission !== "granted") {
    return false;
  }

  new Notification(title, {
    body,
    icon: "/logo192.png"
  });
  return true;
}

export function useFriends(user) {
  const [searchResults, setSearchResults] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [friends, setFriends] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [sentRequests, setSentRequests] = useState([]);
  const seenAcceptedRequestIdsRef = useRef(new Set());
  const acceptedRequestsInitializedRef = useRef(false);
  const seenIncomingRequestIdsRef = useRef(new Set());
  const incomingRequestsInitializedRef = useRef(false);

  useEffect(() => {
    if (!user) {
      setSearchResults([]);
      setFriendRequests([]);
      setSentRequests([]);
      setFriends([]);
      return;
    }

    const q = query(
      collection(db, "friendRequests"),
      where("toUserId", "==", user.uid),
      where("status", "==", "pending")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const requests = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        setFriendRequests(sortByCreatedAtDesc(requests));
      },
      (error) => {
        console.error("Incoming friend requests listener failed", error);
        setFriendRequests([]);
      }
    );

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!user) {
      return undefined;
    }

    const ownFriendIds = new Set(friends.map((friend) => friend.id));

    const outgoingAcceptedQuery = query(
      collection(db, "friendRequests"),
      where("fromUserId", "==", user.uid),
      where("status", "==", "accepted")
    );

    const incomingAcceptedQuery = query(
      collection(db, "friendRequests"),
      where("toUserId", "==", user.uid),
      where("status", "==", "accepted")
    );

    const syncAccepted = async (snapshot, counterpartField) => {
      const missingIds = snapshot.docs
        .map((item) => item.data()?.[counterpartField])
        .filter((id) => typeof id === "string" && id && !ownFriendIds.has(id));

      if (missingIds.length === 0) {
        return;
      }

      for (const counterpartId of missingIds) {
        await updateDoc(doc(db, "users", user.uid), {
          friends: arrayUnion(counterpartId)
        });
      }
    };

    const unsubscribeOutgoing = onSnapshot(
      outgoingAcceptedQuery,
      (snapshot) => {
        syncAccepted(snapshot, "toUserId").catch((error) => {
          console.error("Failed syncing outgoing accepted requests", error);
        });
      },
      (error) => {
        console.error("Outgoing accepted requests listener failed", error);
      }
    );

    const unsubscribeIncoming = onSnapshot(
      incomingAcceptedQuery,
      (snapshot) => {
        syncAccepted(snapshot, "fromUserId").catch((error) => {
          console.error("Failed syncing incoming accepted requests", error);
        });
      },
      (error) => {
        console.error("Incoming accepted requests listener failed", error);
      }
    );

    return () => {
      unsubscribeOutgoing();
      unsubscribeIncoming();
    };
  }, [user, friends]);

  useEffect(() => {
    if (!user) {
      seenIncomingRequestIdsRef.current = new Set();
      incomingRequestsInitializedRef.current = false;
      return;
    }

    const incomingIds = friendRequests.map((request) => request.id);

    if (!incomingRequestsInitializedRef.current) {
      seenIncomingRequestIdsRef.current = new Set(incomingIds);
      incomingRequestsInitializedRef.current = true;
      return;
    }

    friendRequests.forEach((request) => {
      if (seenIncomingRequestIdsRef.current.has(request.id)) {
        return;
      }

      seenIncomingRequestIdsRef.current.add(request.id);

      showBrowserNotification(
        "New friend request",
        `${request?.fromUserName || request?.fromUserEmail || "Someone"} sent you a friend request.`
      ).catch(() => {});
    });
  }, [user, friendRequests]);

  useEffect(() => {
    if (!user) {
      seenAcceptedRequestIdsRef.current = new Set();
      acceptedRequestsInitializedRef.current = false;
      return undefined;
    }

    const outgoingAcceptedQuery = query(
      collection(db, "friendRequests"),
      where("fromUserId", "==", user.uid),
      where("status", "==", "accepted")
    );

    const unsubscribe = onSnapshot(
      outgoingAcceptedQuery,
      (snapshot) => {
        if (!acceptedRequestsInitializedRef.current) {
          snapshot.docs.forEach((item) => {
            seenAcceptedRequestIdsRef.current.add(item.id);
          });
          acceptedRequestsInitializedRef.current = true;
          return;
        }

        snapshot.docs.forEach((item) => {
          if (seenAcceptedRequestIdsRef.current.has(item.id)) {
            return;
          }

          seenAcceptedRequestIdsRef.current.add(item.id);

          const data = item.data();
          showBrowserNotification(
            "Friend request accepted",
            `${data?.toUserEmail || "A user"} accepted your request.`
          ).catch(() => {});
        });
      },
      (error) => {
        console.error("Accepted request notification listener failed", error);
      }
    );

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!user) {
      setSentRequests([]);
      return;
    }

    const q = query(
      collection(db, "friendRequests"),
      where("fromUserId", "==", user.uid),
      where("status", "==", "pending")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const requests = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        setSentRequests(sortByCreatedAtDesc(requests));
      },
      (error) => {
        console.error("Sent friend requests listener failed", error);
        setSentRequests([]);
      }
    );

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!user) {
      setFriends([]);
      return;
    }

    const userRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(
      userRef,
      async (userSnap) => {
        if (!userSnap.exists()) {
          setFriends([]);
          return;
        }

        const friendIds = userSnap.data().friends || [];
        if (friendIds.length === 0) {
          setFriends([]);
          return;
        }

        try {
          const friendPromises = friendIds.map((id) => getDoc(doc(db, "users", id)));
          const friendSnaps = await Promise.all(friendPromises);

          const nextFriends = friendSnaps
            .filter((snapshot) => snapshot.exists())
            .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
            .sort((a, b) => {
              const aName = (a.displayName || a.email || "").toLowerCase();
              const bName = (b.displayName || b.email || "").toLowerCase();
              return aName.localeCompare(bName);
            });

          setFriends(nextFriends);
        } catch (error) {
          console.error("Failed to load friend profiles", error);
          setFriends([]);
        }
      },
      (error) => {
        console.error("User profile listener failed", error);
        setFriends([]);
      }
    );

    return unsubscribe;
  }, [user]);

  const searchUsers = useCallback(async (searchTerm) => {
    if (!searchTerm.trim() || !user) {
      setSearchResults([]);
      return;
    }
    setLoadingSearch(true);
    try {
      const q = query(collection(db, "users"));
      const snapshot = await getDocs(q);
      const searchLower = searchTerm.toLowerCase();
      const results = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((result) => {
          if (result.id === user.uid) return false;
          const email = (result.email || "").toLowerCase();
          const displayName = (result.displayName || "").toLowerCase();
          return email.includes(searchLower) || displayName.includes(searchLower);
        });
      setSearchResults(results);
    } catch (error) {
      console.error("Error searching users:", error);
    } finally {
      setLoadingSearch(false);
    }
  }, [user]);

  const sendFriendRequest = useCallback(async (targetUser) => {
    if (!user || !targetUser?.id || targetUser.id === user.uid) {
      return { status: "invalid" };
    }

    try {
      if (friends.some((friend) => friend.id === targetUser.id)) {
        return { status: "already_friends" };
      }

      const incomingPendingQuery = query(
        collection(db, "friendRequests"),
        where("fromUserId", "==", targetUser.id),
        where("toUserId", "==", user.uid),
        where("status", "==", "pending")
      );
      const incomingPending = await getDocs(incomingPendingQuery);

      if (!incomingPending.empty) {
        const existing = incomingPending.docs[0];
        await updateDoc(doc(db, "friendRequests", existing.id), {
          status: "accepted",
          respondedAt: serverTimestamp(),
          acceptedBy: user.uid
        });
        await updateDoc(doc(db, "users", user.uid), {
          friends: arrayUnion(targetUser.id)
        });

        return { status: "accepted_existing" };
      }

      const reqQuery = query(
        collection(db, "friendRequests"),
        where("fromUserId", "==", user.uid),
        where("toUserId", "==", targetUser.id),
        where("status", "==", "pending")
      );
      const existing = await getDocs(reqQuery);
      if (!existing.empty) {
        return { status: "already_sent" };
      }

      await addDoc(collection(db, "friendRequests"), {
        fromUserId: user.uid,
        fromUserEmail: user.email,
        fromUserName: user.displayName || user.email.split("@")[0],
        toUserId: targetUser.id,
        toUserEmail: targetUser.email,
        status: "pending",
        createdAt: serverTimestamp()
      });

      showBrowserNotification(
        "Friend request sent",
        `Request sent to ${targetUser.displayName || targetUser.email || "user"}.`
      ).catch(() => {});

      return { status: "sent" };
    } catch (error) {
      console.error("Error sending friend request", error);
      return { status: "error", error };
    }
  }, [user, friends]);

  const acceptRequest = useCallback(async (request) => {
    if (!user || !request?.id) {
      return;
    }

    try {
      await updateDoc(doc(db, "friendRequests", request.id), {
        status: "accepted",
        respondedAt: serverTimestamp(),
        acceptedBy: user.uid
      });
      await updateDoc(doc(db, "users", user.uid), {
        friends: arrayUnion(request.fromUserId)
      });

      showBrowserNotification(
        "Friend added",
        `You are now friends with ${request.fromUserName || request.fromUserEmail || "this user"}.`
      ).catch(() => {});
    } catch (error) {
      console.error("Error accepting request", error);
      alert(`Could not accept request: ${error?.code || error?.message || "unknown error"}`);
    }
  }, [user]);

  const rejectRequest = useCallback(async (requestId) => {
    try {
      await updateDoc(doc(db, "friendRequests", requestId), {
        status: "rejected",
        respondedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error rejecting request", error);
    }
  }, []);

  const unfriend = useCallback(async (friendId) => {
    if (!user?.uid || !friendId) {
      return false;
    }
    try {
      await updateDoc(doc(db, "users", user.uid), {
        friends: arrayRemove(friendId)
      });
      await updateDoc(doc(db, "users", friendId), {
        friends: arrayRemove(user.uid)
      });
      return true;
    } catch (error) {
      console.error("Error unfriending user", error);
      alert(`Could not unfriend: ${error?.code || error?.message || "unknown error"}`);
      return false;
    }
  }, [user]);

  return {
    searchResults,
    searchUsers,
    loadingSearch,
    sendFriendRequest,
    friendRequests,
    acceptRequest,
    rejectRequest,
    unfriend,
    friends,
    sentRequests
  };
}
