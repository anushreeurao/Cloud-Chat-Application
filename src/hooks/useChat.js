import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { db, storage } from "../firebase";

const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1920;
const TARGET_IMAGE_BYTES = 1.2 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 12000;
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const SUPABASE_BUCKET = import.meta.env.VITE_SUPABASE_BUCKET || "chat-files";
const STORAGE_PROVIDER = (import.meta.env.VITE_STORAGE_PROVIDER || "supabase").toLowerCase();

function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_BUCKET);
}

function encodePathSegments(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function toMillisSafe(value) {
  if (!value) {
    return 0;
  }

  if (typeof value?.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : 0;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  return 0;
}

function messageOrderValue(message) {
  return toMillisSafe(message?.createdAt) || Number(message?.createdAtClient || 0);
}

function getClearCutoffMillis(room, userId) {
  if (!room || !userId) {
    return 0;
  }

  return Math.max(
    toMillisSafe(room?.clearedThrough?.[userId]),
    toMillisSafe(room?.clearedAt?.[userId]),
    toMillisSafe(room?.clearedAtClient?.[userId])
  );
}

function notifyBrowser(title, body) {
  if (typeof Notification === "undefined") {
    return;
  }

  if (Notification.permission === "granted") {
    new Notification(title, {
      body,
      icon: "/logo192.png"
    });
    return;
  }

  if (Notification.permission === "default") {
    Notification.requestPermission()
      .then((permission) => {
        if (permission !== "granted") {
          return;
        }
        new Notification(title, {
          body,
          icon: "/logo192.png"
        });
      })
      .catch(() => {});
  }
}

function toSafeFilename(originalName) {
  const normalized = originalName.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
  return normalized || `file-${Date.now()}`;
}

function isImageFile(file) {
  return Boolean(file?.type?.startsWith("image/"));
}

async function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image."));
    };
    image.src = url;
  });
}

async function compressChatImage(file) {
  const image = await fileToImage(file);
  const ratio = Math.min(
    1,
    MAX_IMAGE_DIMENSION / image.width,
    MAX_IMAGE_DIMENSION / image.height
  );
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return file;
  }

  context.drawImage(image, 0, 0, width, height);

  let quality = 0.86;
  let blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) {
    return file;
  }

  while (blob.size > TARGET_IMAGE_BYTES && quality > 0.45) {
    quality -= 0.1;
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) {
      return file;
    }
  }

  return new File(
    [blob],
    `${file.name.replace(/\.[^/.]+$/, "") || "image"}-compressed.jpg`,
    { type: "image/jpeg" }
  );
}

async function uploadWithTimeout(storageRef, uploadFile, timeoutMs = UPLOAD_TIMEOUT_MS) {
  const uploadTask = uploadBytesResumable(storageRef, uploadFile, {
    contentType: uploadFile.type || "application/octet-stream"
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        uploadTask.cancel();
      } catch {
        // no-op
      }
      reject(new Error("Upload timed out. Check Storage access/network and try again."));
    }, timeoutMs);

    uploadTask.on(
      "state_changed",
      () => {},
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        const code = error?.code || "";
        const serverText = `${error?.serverResponse || ""} ${error?.message || ""}`.toLowerCase();

        if (
          code.includes("storage/object-not-found") ||
          serverText.includes("has not been set up") ||
          serverText.includes("bucket") && serverText.includes("not found")
        ) {
          reject(
            new Error(
              "Firebase Storage is not set up for this project yet. Open Firebase Console -> Storage -> Get Started, then deploy storage rules."
            )
          );
          return;
        }

        reject(error);
      },
      () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        resolve(uploadTask.snapshot);
      }
    );
  });
}

async function uploadViaFirebaseStorage(roomId, messageId, uploadFile) {
  const safeFilename = toSafeFilename(uploadFile.name);
  const path = `rooms/${roomId}/${messageId}/${safeFilename}`;
  const storageRef = ref(storage, path);
  const uploadResult = await uploadWithTimeout(storageRef, uploadFile);
  const finalDownloadUrl = await getDownloadURL(uploadResult.ref);

  return {
    url: finalDownloadUrl,
    name: uploadFile.name,
    contentType: uploadFile.type || "application/octet-stream",
    size: uploadFile.size,
    path
  };
}

async function uploadViaSupabaseStorage(roomId, messageId, uploadFile) {
  if (!hasSupabaseConfig()) {
    throw new Error(
      "Supabase storage config missing. Add VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and VITE_SUPABASE_BUCKET in .env."
    );
  }

  const safeFilename = toSafeFilename(uploadFile.name);
  const objectPath = `rooms/${roomId}/${messageId}/${Date.now()}-${safeFilename}`;
  const encodedPath = encodePathSegments(objectPath);
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${encodedPath}`;
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(SUPABASE_BUCKET)}/${encodedPath}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "x-upsert": "true",
        "Content-Type": uploadFile.type || "application/octet-stream"
      },
      body: uploadFile,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Upload timed out. Check Storage access/network and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const lower = details.toLowerCase();

    if (lower.includes("row-level security") || lower.includes("policy")) {
      throw new Error(
        "Supabase upload blocked by storage policy. Create insert/select policies for your bucket or make it public for development."
      );
    }

    throw new Error(`Supabase upload failed (${response.status}): ${details || response.statusText}`);
  }

  return {
    url: publicUrl,
    name: uploadFile.name,
    contentType: uploadFile.type || "application/octet-stream",
    size: uploadFile.size,
    path: `${SUPABASE_BUCKET}/${objectPath}`
  };
}

async function uploadChatAttachment(roomId, messageId, uploadFile) {
  const useSupabase = STORAGE_PROVIDER === "supabase" || hasSupabaseConfig();

  if (useSupabase) {
    return uploadViaSupabaseStorage(roomId, messageId, uploadFile);
  }

  return uploadViaFirebaseStorage(roomId, messageId, uploadFile);
}

export function useChat(user) {
  const [rooms, setRooms] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [chatError, setChatError] = useState("");
  const [unreadByRoom, setUnreadByRoom] = useState({});
  const [totalUnread, setTotalUnread] = useState(0);
  const activeRoomIdRef = useRef(null);
  const roomNotificationMetaRef = useRef(new Map());
  const roomNotificationsInitializedRef = useRef(false);

  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) || null,
    [rooms, activeRoomId]
  );

  const setActiveRoom = useCallback((roomOrId) => {
    const nextId = typeof roomOrId === "string" ? roomOrId : roomOrId?.id;
    setActiveRoomId(nextId || null);
  }, []);

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  useEffect(() => {
    setChatError("");
    setActiveRoomId(null);
    setUnreadByRoom({});
    setTotalUnread(0);
    roomNotificationMetaRef.current = new Map();
    roomNotificationsInitializedRef.current = false;
  }, [user?.uid]);

  useEffect(() => {
    if (!user) {
      setRooms([]);
      setMessages([]);
      setActiveRoomId(null);
      return;
    }

    const roomsQuery = query(
      collection(db, "rooms"),
      where("members", "array-contains", user.uid)
    );

    const unsubscribe = onSnapshot(
      roomsQuery,
      (snapshot) => {
        setChatError("");
        const nextRooms = snapshot.docs
          .map((item) => {
            const data = item.data({ serverTimestamps: "estimate" });
            return {
              id: item.id,
              ...data,
              members: Array.isArray(data.members) ? data.members : []
            };
          })
          .sort((a, b) => {
            const aTime = toMillisSafe(a.lastMessageAt);
            const bTime = toMillisSafe(b.lastMessageAt);
            return bTime - aTime;
          });

        const nextMeta = new Map();
        nextRooms.forEach((room) => {
          nextMeta.set(room.id, {
            lastMessageAt: toMillisSafe(room.lastMessageAt)
          });
        });

        if (!roomNotificationsInitializedRef.current) {
          roomNotificationMetaRef.current = nextMeta;
          roomNotificationsInitializedRef.current = true;
        } else {
          nextRooms.forEach((room) => {
            const previousMeta = roomNotificationMetaRef.current.get(room.id);
            const previousLastMessageAt = previousMeta?.lastMessageAt || 0;
            const currentLastMessageAt = toMillisSafe(room.lastMessageAt);
            const hasNewMessage = currentLastMessageAt > 0 && currentLastMessageAt > previousLastMessageAt;
            const isOwnMessage = room?.lastMessageSenderId === user.uid;
            const isSameRoomOpenAndVisible =
              activeRoomIdRef.current === room.id &&
              typeof document !== "undefined" &&
              !document.hidden;

            if (!hasNewMessage || isOwnMessage || isSameRoomOpenAndVisible) {
              return;
            }

            notifyBrowser(
              room?.name || "New message",
              room?.lastMessage || "You have a new message."
            );
          });

          roomNotificationMetaRef.current = nextMeta;
        }

        setRooms(nextRooms);
        setActiveRoomId((previousId) => {
          if (!nextRooms.length) {
            return null;
          }

          if (previousId && nextRooms.some((room) => room.id === previousId)) {
            return previousId;
          }

          return null;
        });
      },
      (error) => {
        console.error("Rooms listener failed", error);
        setRooms([]);
        setActiveRoomId(null);
        setChatError(`Could not load chats: ${error?.code || error?.message || "unknown error"}`);
      }
    );

    return unsubscribe;
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || rooms.length === 0) {
      setUnreadByRoom({});
      setTotalUnread(0);
      return undefined;
    }

    const unsubs = [];
    const counts = {};

    const syncUnreadState = () => {
      const normalized = {};
      rooms.forEach((room) => {
        normalized[room.id] = counts[room.id] || 0;
      });
      const nextTotal = Object.values(normalized).reduce((sum, value) => sum + value, 0);

      setUnreadByRoom((previous) => {
        const previousKeys = Object.keys(previous);
        const nextKeys = Object.keys(normalized);
        if (previousKeys.length === nextKeys.length) {
          let changed = false;
          for (const key of nextKeys) {
            if ((previous[key] || 0) !== (normalized[key] || 0)) {
              changed = true;
              break;
            }
          }
          if (!changed) {
            return previous;
          }
        }
        return normalized;
      });

      setTotalUnread((previous) => (previous === nextTotal ? previous : nextTotal));
    };

    rooms.forEach((room) => {
      const roomMessagesRef = collection(db, `rooms/${room.id}/messages`);

      const unsub = onSnapshot(
        roomMessagesRef,
        (snapshot) => {
          const clearedAtMillis = getClearCutoffMillis(room, user.uid);
          let unreadCount = 0;

          snapshot.forEach((messageDoc) => {
            const message = messageDoc.data({ serverTimestamps: "estimate" });
            if (message.senderId === user.uid) {
              return;
            }

            const createdAtMillis = messageOrderValue(message);
            if (createdAtMillis && createdAtMillis < clearedAtMillis) {
              return;
            }

            if (!Array.isArray(message.readBy) || !message.readBy.includes(user.uid)) {
              unreadCount += 1;
            }
          });

          counts[room.id] = unreadCount;
          syncUnreadState();
        },
        (error) => {
          console.error(`Unread listener failed for room ${room.id}`, error);
          counts[room.id] = 0;
          syncUnreadState();
        }
      );

      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [rooms, user?.uid]);

  useEffect(() => {
    if (!activeRoom || !user) {
      setMessages([]);
      return;
    }

    const messagesQuery = query(
      collection(db, `rooms/${activeRoom.id}/messages`),
      orderBy("createdAt", "asc")
    );

    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        setChatError("");
        const allMessages = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data({ serverTimestamps: "estimate" })
        }));
        const userClearedAtMillis = getClearCutoffMillis(activeRoom, user.uid);

        const visibleMessages = allMessages.filter((message) => {
          const createdAtMillis = messageOrderValue(message);
          if (!createdAtMillis) {
            return true;
          }
          return createdAtMillis >= userClearedAtMillis;
        })
          .sort((a, b) => {
            const diff = messageOrderValue(a) - messageOrderValue(b);
            if (diff !== 0) {
              return diff;
            }
            return String(a.id || "").localeCompare(String(b.id || ""));
          });

        setMessages(visibleMessages);

        const unread = visibleMessages.filter((message) => {
          if (message.senderId === user.uid) {
            return false;
          }
          return !Array.isArray(message.readBy) || !message.readBy.includes(user.uid);
        });

        if (unread.length > 0) {
          const batch = writeBatch(db);
          unread.forEach((message) => {
            batch.update(doc(db, `rooms/${activeRoom.id}/messages/${message.id}`), {
              readBy: arrayUnion(user.uid)
            });
          });
          batch.commit().catch((error) => {
            console.error("Failed to update read receipts", error);
          });
        }
      },
      (error) => {
        console.error("Messages listener failed", error);
        setMessages([]);
        setChatError(`Could not load messages: ${error?.code || error?.message || "unknown error"}`);
      }
    );

    return unsubscribe;
  }, [activeRoom, user]);

  const createRoom = useCallback(async (name, memberIds = []) => {
    if (!user?.uid) {
      throw new Error("You must be logged in to create a room.");
    }

    const members = [...new Set([user.uid, ...memberIds])];
    const trimmedName = (name || "").trim();
    const finalName = trimmedName || "New Room";
    let roomType = "group";
    if (members.length === 1) {
      roomType = "self";
    } else if (members.length === 2) {
      roomType = "private";
    }

    const newRoomData = {
      name: finalName,
      type: roomType,
      members,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      lastMessage: "",
      lastMessageSenderId: "",
      lastMessageAt: serverTimestamp()
    };

    const roomRef = await addDoc(collection(db, "rooms"), newRoomData);

    const optimisticRoom = {
      id: roomRef.id,
      name: finalName,
      type: roomType,
      members,
      createdBy: user.uid,
      lastMessage: "",
      lastMessageSenderId: "",
      // Keep this client value until Firestore serverTimestamp arrives in snapshot.
      lastMessageAt: { toMillis: () => Date.now() }
    };

    setRooms((previous) => {
      if (previous.some((room) => room.id === optimisticRoom.id)) {
        return previous;
      }
      return [optimisticRoom, ...previous];
    });

    return optimisticRoom;
  }, [user]);

  const sendMessage = useCallback(async (roomId, text, file = null) => {
    if (!roomId || !user?.uid) {
      throw new Error("No active room selected.");
    }

    const trimmedText = (text || "").trim();

    if (!trimmedText && !file) {
      return;
    }

    const messageRef = doc(collection(db, `rooms/${roomId}/messages`));
    let attachments = [];
    let attachmentUploadFailed = false;

    if (file) {
      try {
        let uploadFile = file;
        if (isImageFile(file)) {
          uploadFile = await compressChatImage(file);
        }

        if (uploadFile.size > MAX_CHAT_FILE_BYTES) {
          throw new Error("File is larger than 20MB limit.");
        }

        const attachment = await uploadChatAttachment(roomId, messageRef.id, uploadFile);

        attachments = [
          {
            url: attachment.url,
            name: attachment.name,
            originalName: file.name,
            contentType: attachment.contentType,
            size: attachment.size,
            path: attachment.path
          }
        ];
      } catch (uploadError) {
        if (!trimmedText) {
          throw uploadError;
        }
        attachmentUploadFailed = true;
        console.error("Attachment upload failed; sending text only.", uploadError);
      }
    }

    await setDoc(messageRef, {
      text: trimmedText,
      senderId: user.uid,
      senderName: user.displayName || user.email,
      createdAt: serverTimestamp(),
      createdAtClient: Date.now(),
      readBy: [user.uid],
      attachments
    });

    const roomMessagePreview =
      trimmedText ||
      (attachments[0]?.contentType?.startsWith("image/") ? "Sent an image" : "Sent a file");

    updateDoc(doc(db, "rooms", roomId), {
      lastMessage: roomMessagePreview,
      lastMessageSenderId: user.uid,
      lastMessageAt: serverTimestamp()
    }).catch((error) => {
      console.error("Failed to update room preview", error);
    });
    return { attachmentUploadFailed };
  }, [user]);

  const deleteRoom = useCallback(async (roomId) => {
    try {
      await deleteDoc(doc(db, "rooms", roomId));

      if (activeRoom && activeRoom.id === roomId) {
        setActiveRoomId(null);
      }
    } catch (error) {
      console.error("Error deleting room directly", error);

      try {
        await updateDoc(doc(db, "rooms", roomId), {
          members: arrayRemove(user.uid)
        });

        if (activeRoom && activeRoom.id === roomId) {
          setActiveRoomId(null);
        }
      } catch (fallbackError) {
        console.error("Error leaving room", fallbackError);
        alert(`Could not delete or leave the chat: ${fallbackError.message}`);
      }
    }
  }, [user, activeRoom]);

  const clearMessages = useCallback(async (roomId) => {
    if (!roomId || !user?.uid) {
      return false;
    }

    try {
      const roomRef = doc(db, "rooms", roomId);
      const roomSnap = await getDoc(roomRef);
      const roomData = roomSnap.exists() ? roomSnap.data() : {};
      const nextUpdate = {
        [`clearedAt.${user.uid}`]: serverTimestamp(),
        [`clearedAtClient.${user.uid}`]: Date.now()
      };
      const lastMessageAt = roomData?.lastMessageAt;
      if (lastMessageAt) {
        nextUpdate[`clearedThrough.${user.uid}`] = lastMessageAt;
      }

      await updateDoc(roomRef, nextUpdate);
      return true;
    } catch (error) {
      console.error("Error clearing messages", error);
      alert(`Failed to clear chat: ${error?.code || error?.message || "unknown error"}`);
      return false;
    }
  }, [user]);

  const setTyping = useCallback(async (roomId, isTyping) => {
    if (!roomId || !user?.uid) {
      return;
    }

    try {
      await updateDoc(doc(db, "rooms", roomId), {
        [`typing.${user.uid}`]: isTyping ? Date.now() : deleteField()
      });
    } catch (error) {
      console.error("Typing indicator update failed", error);
    }
  }, [user]);

  return {
    rooms,
    messages,
    activeRoom,
    chatError,
    unreadByRoom,
    totalUnread,
    setActiveRoom,
    createRoom,
    sendMessage,
    deleteRoom,
    clearMessages,
    setTyping
  };
}
