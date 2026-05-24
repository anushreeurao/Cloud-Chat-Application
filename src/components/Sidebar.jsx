import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Eye,
  Mail,
  MessageSquare,
  Plus,
  Save,
  Search,
  Shield,
  Trash2,
  User,
  UserCheck,
  UserPlus,
  Users,
  X
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { db } from "../firebase";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";

function getUserLabel(profile) {
  if (!profile) {
    return "User";
  }

  return profile.displayName || profile.email?.split("@")[0] || "User";
}

function formatPresence(profile) {
  if (profile?.showOnline === false) {
    return "Invisible";
  }

  if (profile?.status === "online") {
    return "Online";
  }

  if (profile?.lastSeen?.toDate) {
    return `Last seen ${profile.lastSeen.toDate().toLocaleString()}`;
  }

  return "Offline";
}

function formatRoomTime(lastMessageAt) {
  if (!lastMessageAt) {
    return "";
  }

  let value = null;

  if (typeof lastMessageAt?.toDate === "function") {
    value = lastMessageAt.toDate();
  } else if (typeof lastMessageAt?.toMillis === "function") {
    value = new Date(lastMessageAt.toMillis());
  } else if (lastMessageAt instanceof Date) {
    value = lastMessageAt;
  } else if (typeof lastMessageAt === "number" || typeof lastMessageAt === "string") {
    const parsed = new Date(lastMessageAt);
    value = Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (!value) {
    return "";
  }

  return value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
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

function getVisibleRoomSummary(room, userId) {
  const rawMessage = (room?.lastMessage || "").trim();
  const lastMessageAt = room?.lastMessageAt || null;
  const clearedAtMillis = Math.max(
    toMillisSafe(room?.clearedThrough?.[userId]),
    toMillisSafe(room?.clearedAt?.[userId]),
    toMillisSafe(room?.clearedAtClient?.[userId])
  );
  const lastMessageMillis = toMillisSafe(lastMessageAt);

  if (clearedAtMillis && (!lastMessageMillis || lastMessageMillis <= clearedAtMillis)) {
    return { message: "", lastMessageAt: null };
  }

  return { message: rawMessage, lastMessageAt };
}

function isDirectRoom(room = {}) {
  return Array.isArray(room.members) && room.members.length === 2;
}

function getTypingUserIds(room, currentUserId, now = Date.now()) {
  if (!room?.typing || typeof room.typing !== "object") {
    return [];
  }

  return Object.entries(room.typing)
    .filter(([uid, timestamp]) => uid !== currentUserId && now - Number(timestamp) < 6000)
    .map(([uid]) => uid);
}

function loadStoredArray(key) {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStoredArray(key, value) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // no-op
  }
}

export default function Sidebar({
  chatData,
  friendData,
  activeView = "messages",
  setActiveView = () => {},
  isMobile = false,
  isSidebarOpen = true,
  className = "",
  onMobileNavigate = () => {}
}) {
  const RECENT_FRIEND_SEARCH_KEY = "cloudchat_recent_friend_searches_v1";
  const FAVORITE_FRIEND_IDS_KEY = "cloudchat_favorite_friend_ids_v1";
  const { user, saveProfile, logout } = useAuth();
  const {
    rooms = [],
    activeRoom = null,
    chatError = "",
    unreadByRoom = {},
    setActiveRoom = () => {},
    createRoom = async () => null,
    deleteRoom = async () => {}
  } = chatData || {};
  const {
    searchResults = [],
    searchUsers = () => {},
    loadingSearch = false,
    sendFriendRequest = async () => ({ status: "invalid" }),
    friendRequests = [],
    acceptRequest = async () => {},
    rejectRequest = async () => {},
    friends = [],
    sentRequests = []
  } = friendData || {};

  const [showNewRoom, setShowNewRoom] = useState(false);
  const [groupModalStep, setGroupModalStep] = useState(1);
  const [newRoomName, setNewRoomName] = useState("");
  const [selectedFriendIds, setSelectedFriendIds] = useState([]);
  const [groupMemberSearchTerm, setGroupMemberSearchTerm] = useState("");
  const [friendSearchTerm, setFriendSearchTerm] = useState("");
  const [chatSearchTerm, setChatSearchTerm] = useState("");
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [currentProfile, setCurrentProfile] = useState(user);
  const [recentFriendSearches, setRecentFriendSearches] = useState(() => loadStoredArray(RECENT_FRIEND_SEARCH_KEY));
  const [favoriteFriendIds, setFavoriteFriendIds] = useState(() => loadStoredArray(FAVORITE_FRIEND_IDS_KEY));
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [roomToDelete, setRoomToDelete] = useState(null);
  const [isDeletingRoom, setIsDeletingRoom] = useState(false);
  const [selectedAvatarEmoji, setSelectedAvatarEmoji] = useState("🌹");

  const renderAvatarContent = (profile, fallbackIcon = <User size={20} />) => {
    if (profile?.photoURL) {
      return <img src={profile.photoURL} alt="" className="friend-avatar-image" />;
    }

    if (profile?.avatarEmoji) {
      return <span className="emoji-avatar">{profile.avatarEmoji}</span>;
    }

    const initial = getUserLabel(profile).charAt(0).toUpperCase();
    if (initial) {
      return <span className="initial-avatar">{initial}</span>;
    }

    return fallbackIcon;
  };

  const closeMobileDrawer = () => {
    if (isMobile) {
      onMobileNavigate();
    }
  };

  const handleViewChange = (nextView) => {
    if (nextView === "about" && activeView === "about") {
      setActiveView("messages");
      if (isMobile && activeRoom) {
        closeMobileDrawer();
      }
      return;
    }

    if (nextView === "messages") {
      setActiveView("messages");
      if (isMobile && activeRoom) {
        closeMobileDrawer();
      }
      return;
    }

    setActiveView(nextView);
    if (!isMobile) {
      closeMobileDrawer();
    }
  };

  const friendProfileById = useMemo(
    () =>
      friends.reduce((accumulator, friend) => {
        accumulator[friend.id] = friend;
        return accumulator;
      }, {}),
    [friends]
  );

  const getDirectRoomFriendProfile = (room) => {
    if (!isDirectRoom(room) || !user?.uid) {
      return null;
    }

    const otherUserId = room.members.find((memberId) => memberId !== user.uid);
    if (!otherUserId) {
      return null;
    }

    return friendProfileById[otherUserId] || null;
  };

  const getRoomDisplayName = (room) => {
    const directFriend = getDirectRoomFriendProfile(room);
    if (directFriend) {
      return getUserLabel(directFriend);
    }

    const fallbackName = (room?.name || "").trim();
    if (fallbackName) {
      return fallbackName;
    }

    return isDirectRoom(room) ? "Direct Chat" : "New Room";
  };

  useEffect(() => {
    if (!user) {
      return;
    }

    if (!showProfileModal) {
      return;
    }
    setProfileName(user.displayName || user.email?.split("@")[0] || "User");
  }, [showProfileModal, user?.displayName, user?.email, user]);

  useEffect(() => {
    if (!user?.uid) {
      setCurrentProfile(user);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      doc(db, "users", user.uid),
      (snapshot) => {
        if (!snapshot.exists()) {
          setCurrentProfile(user);
          return;
        }

        setCurrentProfile({
          ...user,
          ...snapshot.data()
        });
      },
      (error) => {
        console.error("Current profile listener failed", error);
        setCurrentProfile(user);
      }
    );

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (currentProfile?.avatarEmoji) {
      setSelectedAvatarEmoji(currentProfile.avatarEmoji);
      return;
    }

    setSelectedAvatarEmoji("🌹");
  }, [currentProfile?.avatarEmoji]);

  useEffect(() => {
    if (activeView !== "find-friends" && activeView !== "friend-requests") {
      return undefined;
    }

    const delaySearch = setTimeout(() => {
      rememberFriendSearch(friendSearchTerm);
      searchUsers(friendSearchTerm);
    }, 350);

    return () => clearTimeout(delaySearch);
  }, [activeView, friendSearchTerm, searchUsers]);

  useEffect(() => {
    saveStoredArray(RECENT_FRIEND_SEARCH_KEY, recentFriendSearches);
  }, [RECENT_FRIEND_SEARCH_KEY, recentFriendSearches]);

  useEffect(() => {
    saveStoredArray(FAVORITE_FRIEND_IDS_KEY, favoriteFriendIds);
  }, [FAVORITE_FRIEND_IDS_KEY, favoriteFriendIds]);

  useEffect(() => {
    if (!friends.length) {
      return;
    }

    const friendIdSet = new Set(friends.map((friend) => friend.id));
    setFavoriteFriendIds((previous) => previous.filter((id) => friendIdSet.has(id)));
  }, [friends]);

  const filteredRooms = useMemo(() => {
    const search = chatSearchTerm.trim().toLowerCase();
    if (!search) {
      return rooms;
    }

    return rooms.filter((room) => {
      const roomName = getRoomDisplayName(room).toLowerCase();
      const roomSummary = getVisibleRoomSummary(room, user?.uid);
      const lastMessage = roomSummary.message.toLowerCase();
      return roomName.includes(search) || lastMessage.includes(search);
    });
  }, [chatSearchTerm, rooms, user?.uid, friends]);

  const pinnedDirectRooms = useMemo(() => filteredRooms.filter((room) => isDirectRoom(room)), [filteredRooms]);
  const pinnedGroupRooms = useMemo(() => filteredRooms.filter((room) => !isDirectRoom(room)), [filteredRooms]);
  const orderedRooms = useMemo(() => [...pinnedDirectRooms, ...pinnedGroupRooms], [pinnedDirectRooms, pinnedGroupRooms]);
  const friendNameById = useMemo(
    () =>
      friends.reduce((accumulator, friend) => {
        accumulator[friend.id] = getUserLabel(friend);
        return accumulator;
      }, {}),
    [friends]
  );

  const roomTypingLabels = useMemo(() => {
    const now = Date.now();
    return rooms.reduce((accumulator, room) => {
      const typingIds = getTypingUserIds(room, user?.uid, now);
      if (!typingIds.length) {
        return accumulator;
      }

      const leadName = friendNameById[typingIds[0]] || getRoomDisplayName(room) || "Someone";
      accumulator[room.id] = typingIds.length > 1 ? `${leadName} +${typingIds.length - 1} typing...` : `${leadName} typing...`;
      return accumulator;
    }, {});
  }, [rooms, user?.uid, friendNameById]);

  const totalUnreadCount = useMemo(
    () => Object.values(unreadByRoom || {}).reduce((sum, value) => sum + Number(value || 0), 0),
    [unreadByRoom]
  );

  const onlineFriends = useMemo(
    () => friends.filter((friend) => friend.status === "online"),
    [friends]
  );

  const favoriteFriends = useMemo(
    () => friends.filter((friend) => favoriteFriendIds.includes(friend.id)),
    [friends, favoriteFriendIds]
  );

  const offlineFriends = useMemo(
    () => friends.filter((friend) => friend.status !== "online"),
    [friends]
  );

  const recentlyAddedFriends = useMemo(() => {
    return [...friends]
      .sort((a, b) => toMillisSafe(b?.updatedAt || b?.lastSeen) - toMillisSafe(a?.updatedAt || a?.lastSeen))
      .slice(0, 4);
  }, [friends]);

  const resetCreateRoomForm = () => {
    setShowNewRoom(false);
    setGroupModalStep(1);
    setNewRoomName("");
    setSelectedFriendIds([]);
    setGroupMemberSearchTerm("");
  };

  const openCreateRoomModal = () => {
    setShowNewRoom(true);
    setGroupModalStep(1);
    setGroupMemberSearchTerm("");
  };

  useEffect(() => {
    if (!showNewRoom) {
      return undefined;
    }

    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        resetCreateRoomForm();
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [showNewRoom]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const shouldLockScroll = showNewRoom || showProfileModal || Boolean(roomToDelete);
    if (!shouldLockScroll) {
      return undefined;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [showNewRoom, showProfileModal, roomToDelete]);

  useEffect(() => {
    if (!showHeaderMenu) {
      return undefined;
    }

    const closeMenu = () => setShowHeaderMenu(false);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [showHeaderMenu]);

  function rememberFriendSearch(value) {
    const term = (value || "").trim().toLowerCase();
    if (!term) {
      return;
    }

    setRecentFriendSearches((previous) => {
      const next = [term, ...previous.filter((item) => item !== term)];
      return next.slice(0, 6);
    });
  }

  const toggleFavoriteFriend = (friendId) => {
    setFavoriteFriendIds((previous) =>
      previous.includes(friendId)
        ? previous.filter((id) => id !== friendId)
        : [...previous, friendId]
    );
  };

  const handleCreateRoom = async (event) => {
    event.preventDefault();

    const roomName = newRoomName.trim();
    if (!roomName) {
      return;
    }

    if (selectedFriendIds.length === 0) {
      alert("Select at least one member to create a group chat.");
      return;
    }

    try {
      const createdRoom = await createRoom(roomName, selectedFriendIds);
      setActiveRoom(createdRoom);
      resetCreateRoomForm();
      setActiveView("messages");
      closeMobileDrawer();
    } catch (error) {
      console.error("Create room failed", error);
      alert(`Could not create room: ${error?.code || error?.message || "unknown error"}`);
    }
  };

  const toggleFriendForRoom = (friendId) => {
    setSelectedFriendIds((previous) =>
      previous.includes(friendId)
        ? previous.filter((id) => id !== friendId)
        : [...previous, friendId]
    );
  };

  const handleGroupNameStepSubmit = (event) => {
    event.preventDefault();
    if (!newRoomName.trim()) {
      return;
    }
    setGroupModalStep(2);
  };

  const startChatWithFriend = async (friend) => {
    if (!user?.uid) {
      return;
    }

    try {
      const existingRoom = rooms.find(
        (room) =>
          Array.isArray(room.members) &&
          room.members.length === 2 &&
          room.members.includes(friend.id) &&
          room.members.includes(user.uid)
      );

      if (existingRoom) {
        setActiveRoom(existingRoom);
        setActiveView("messages");
        closeMobileDrawer();
        return;
      }

      const createdRoom = await createRoom("Direct Chat", [friend.id]);
      setActiveRoom(createdRoom);
      setActiveView("messages");
      closeMobileDrawer();
    } catch (error) {
      console.error("Error starting chat", error);
      alert(`Could not start chat: ${error?.code || error?.message || "unknown error"}`);
    }
  };

  const handleSendFriendRequest = async (targetUser) => {
    const result = await sendFriendRequest(targetUser);

    if (!result || result.status === "sent" || result.status === "accepted_existing") {
      return;
    }

    if (result.status === "already_friends") {
      alert("You are already friends.");
      return;
    }

    if (result.status === "already_sent") {
      alert("Friend request already sent.");
      return;
    }

    if (result.status === "error") {
      alert(`Failed to send friend request: ${result.error?.message || "Unknown error"}.`);
    }
  };

  const hasPendingSentRequest = (targetUserId) =>
    sentRequests.some((request) => request.toUserId === targetUserId && request.status === "pending");

  const getIncomingRequestFromUser = (targetUserId) =>
    friendRequests.find((request) => request.fromUserId === targetUserId && request.status === "pending");

  const toggleVisibility = async () => {
    if (!user?.uid) {
      return;
    }

    const nextShowOnline = currentProfile?.showOnline === false;
    try {
      await updateDoc(doc(db, "users", user.uid), {
        showOnline: nextShowOnline,
        status: nextShowOnline ? "online" : "offline",
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Visibility update failed", error);
      alert("Could not update your online visibility.");
    }
  };

  const handleProfileSave = async (event) => {
    event.preventDefault();
    if (!user?.uid || profileSaving) {
      return;
    }

    setProfileSaving(true);

    try {
      await saveProfile({
        displayName: profileName.trim() || user.email?.split("@")[0] || "User",
        photoURL: currentProfile?.photoURL || user.photoURL || ""
      });
      await updateDoc(doc(db, "users", user.uid), {
        avatarEmoji: selectedAvatarEmoji,
        updatedAt: serverTimestamp()
      });

      setShowProfileModal(false);
    } catch (error) {
      console.error("Profile save failed", error);
      alert(`Could not update profile: ${error?.message || "Unknown error"}`);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleLogout = async () => {
    if (!window.confirm("Do you want to logout?")) {
      return;
    }

    try {
      setShowHeaderMenu(false);
      await logout();
    } catch (error) {
      console.error("Logout failed", error);
      alert("Could not logout right now. Please try again.");
    }
  };

  const handleDeleteRoomRequest = (room, event) => {
    event.stopPropagation();
    setRoomToDelete({
      id: room.id,
      name: getRoomDisplayName(room)
    });
  };

  const cancelDeleteRoom = () => {
    if (isDeletingRoom) {
      return;
    }
    setRoomToDelete(null);
  };

  const confirmDeleteRoom = async () => {
    if (!roomToDelete?.id || isDeletingRoom) {
      return;
    }

    setIsDeletingRoom(true);
    try {
      await deleteRoom(roomToDelete.id);
      setRoomToDelete(null);
    } catch (error) {
      console.error("Delete room failed", error);
      alert(`Could not delete chat: ${error?.message || "Unknown error"}`);
    } finally {
      setIsDeletingRoom(false);
    }
  };

  const renderRoomItem = (room, roomIcon = <MessageSquare size={20} />) => {
    const roomUnread = unreadByRoom?.[room.id] || 0;
    const roomSummary = getVisibleRoomSummary(room, user?.uid);
    const typingLabel = roomTypingLabels[room.id] || "";
    const roomDisplayName = getRoomDisplayName(room);
    const roomAvatar = isDirectRoom(room)
      ? renderAvatarContent(getDirectRoomFriendProfile(room), roomIcon)
      : roomIcon;

    return (
      <div
        key={room.id}
        className={`room-item room-card-lift ${activeRoom?.id === room.id ? "active" : ""}`}
        onClick={() => {
          setActiveRoom(room);
          setActiveView("messages");
          closeMobileDrawer();
        }}
      >
        <div className="room-avatar">
          {roomAvatar}
        </div>
        <div className="room-details">
          <div className="room-name-row">
            <span className="room-name">{roomDisplayName}</span>
            <div className="room-meta-col">
              <span className="room-time">
                {formatRoomTime(roomSummary.lastMessageAt)}
              </span>
              {roomUnread > 0 && (
                <span className="notification-dot room-unread-badge">
                  {roomUnread > 99 ? "99+" : roomUnread}
                </span>
              )}
            </div>
          </div>
          <p className={`room-last-msg ${roomUnread > 0 ? "unread" : ""} ${typingLabel ? "typing-state" : ""}`}>
            {typingLabel || roomSummary.message || "No messages yet"}
          </p>
        </div>
        <button
          type="button"
          className="room-delete-btn"
          onClick={(event) => handleDeleteRoomRequest(room, event)}
          title={`Delete ${roomDisplayName}`}
          aria-label={`Delete ${roomDisplayName}`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    );
  };

  const renderFriendRow = (friend, keyPrefix = "friend") => (
    <div
      key={`${keyPrefix}-${friend.id}`}
      className="room-item room-card-lift"
      onClick={() => startChatWithFriend(friend)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          startChatWithFriend(friend);
        }
      }}
    >
      <div className="room-avatar">
        {renderAvatarContent(friend)}
      </div>
      <div className="room-details">
        <span className="room-name">{getUserLabel(friend)}</span>
        <p className="room-last-msg">{formatPresence(friend)}</p>
      </div>
      <div className="friend-row-actions">
        <button
          type="button"
          className={`favorite-btn ${favoriteFriendIds.includes(friend.id) ? "active" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            toggleFavoriteFriend(friend.id);
          }}
          title={favoriteFriendIds.includes(friend.id) ? "Remove from favorites" : "Add to favorites"}
        >
          ★
        </button>
        <button
          type="button"
          className="friend-action-btn"
          onClick={(event) => {
            event.stopPropagation();
            startChatWithFriend(friend);
          }}
          title="Message friend"
        >
          <MessageSquare size={14} />
        </button>
      </div>
    </div>
  );

  const filteredGroupFriends = useMemo(() => {
    const search = groupMemberSearchTerm.trim().toLowerCase();
    if (!search) {
      return friends;
    }

    return friends.filter((friend) => {
      const name = getUserLabel(friend).toLowerCase();
      const email = (friend.email || "").toLowerCase();
      return name.includes(search) || email.includes(search);
    });
  }, [friends, groupMemberSearchTerm]);

  const avatarOptions = ["🌹", "🐝", "👤", "⚡", "🎨", "🚀", "🎭", "☀️", "🔥", "💎", "🌈", "🎯"];

  return (
    <div className={`sidebar glass-morphism w-full md:w-[360px] ${className}`.trim()}>
      <div className="sidebar-header sidebar-header-brand">
        <div className="brand-wrap">
          <div className="brand-logo">
            {renderAvatarContent(currentProfile, <User size={16} />)}
          </div>
          <div className="brand-copy">
            <span className="brand-title">{getUserLabel(currentProfile)}</span>
            <span className="brand-subtitle">CloudChat</span>
          </div>
        </div>
        <div className="header-actions" style={{ display: "flex", gap: "0.25rem", position: "relative" }}>
          <button
            onClick={(event) => {
              event.stopPropagation();
              setShowHeaderMenu((previous) => !previous);
            }}
            className="icon-btn"
            title="Account"
          >
            <User size={18} />
          </button>
          {isMobile && (
            <button onClick={onMobileNavigate} className="icon-btn" title="Close menu">
              <X size={18} />
            </button>
          )}

          {showHeaderMenu && (
            <div className="dropdown-menu sidebar-account-menu" onClick={(event) => event.stopPropagation()}>
              <button
                className="dropdown-item"
                onClick={() => {
                  setShowHeaderMenu(false);
                  setShowProfileModal(true);
                }}
              >
                Settings
              </button>
              <button className="dropdown-item delete-text" onClick={handleLogout}>
                Logout
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="sidebar-tabs chat-tabs">
        <button className={`tab-btn ${activeView === "messages" ? "active" : ""}`} onClick={() => handleViewChange("messages")}>
          <span>Messages</span>
          {totalUnreadCount > 0 && <span className="tab-badge">{totalUnreadCount > 99 ? "99+" : totalUnreadCount}</span>}
        </button>
        <button className={`tab-btn ${activeView === "friend-requests" ? "active" : ""}`} onClick={() => handleViewChange("friend-requests")}>
          <span>Friend Requests</span>
          {friendRequests.length > 0 && <span className="tab-badge">{friendRequests.length > 99 ? "99+" : friendRequests.length}</span>}
        </button>
        <button className={`tab-btn ${activeView === "my-friends" ? "active" : ""}`} onClick={() => handleViewChange("my-friends")}>
          My Friends
        </button>
      </div>

      <div className="rooms-list">
        {activeView === "messages" && (
          <>
            <div className="sidebar-search">
              <div className="search-input-wrapper">
                <Search size={18} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search chats..."
                  value={chatSearchTerm}
                  onChange={(event) => setChatSearchTerm(event.target.value)}
                />
              </div>
            </div>

            <div className="section-header">
              <span>ACTIVE NOW</span>
              <button
                onClick={openCreateRoomModal}
                className="icon-btn-small chats-add-btn"
                aria-label="Create group chat"
              >
                <Plus size={16} />
              </button>
            </div>

            {orderedRooms.length === 0 ? (
              <div className="empty-text">
                <p>
                  {chatError
                    ? chatError
                    : chatSearchTerm.trim()
                      ? "No chats match your search."
                      : "No chats yet. Create one."}
                </p>
                {!chatSearchTerm.trim() && !chatError && (
                  <button
                    type="button"
                    className="primary-btn-small"
                    style={{ marginTop: "0.65rem" }}
                    onClick={openCreateRoomModal}
                  >
                    Create First Chat
                  </button>
                )}
              </div>
            ) : (
              <>
                {orderedRooms.map((room) =>
                  renderRoomItem(room, isDirectRoom(room) ? <MessageSquare size={20} /> : <Users size={18} />)
                )}
              </>
            )}

            {isMobile && activeView === "messages" && (
              <button
                type="button"
                className="mobile-new-chat-fab"
                style={showNewRoom || orderedRooms.length === 0 || !isSidebarOpen ? { display: "none" } : undefined}
                onClick={openCreateRoomModal}
                aria-label="Create new chat"
              >
                <Plus size={20} />
              </button>
            )}
          </>
        )}

        {activeView === "find-friends" && (
          <>
            <div className="sidebar-search">
              <div className="search-input-wrapper">
                <Search size={18} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search by username or email..."
                  value={friendSearchTerm}
                  onChange={(event) => setFriendSearchTerm(event.target.value)}
                />
              </div>
            </div>

            <div className="section-header">
              <span>FIND FRIENDS</span>
            </div>

            {!friendSearchTerm.trim() ? (
              <div className="discover-panel">
                <p className="empty-text" style={{ paddingBottom: "0.3rem" }}>
                  Type a username or email to find friends.
                </p>

                {recentFriendSearches.length > 0 && (
                  <div className="discover-block">
                    <h5>Recent Searches</h5>
                    <div className="discover-chip-row">
                      {recentFriendSearches.map((term) => (
                        <button
                          key={term}
                          type="button"
                          className="discover-chip"
                          onClick={() => setFriendSearchTerm(term)}
                        >
                          {term}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="discover-block">
                  <h5>Suggested Friends</h5>
                  {onlineFriends.slice(0, 4).length > 0 ? (
                    onlineFriends.slice(0, 4).map((friend) => (
                      <button
                        key={friend.id}
                        type="button"
                        className="discover-row"
                        onClick={() => setFriendSearchTerm(friend.email || getUserLabel(friend))}
                      >
                        <span>{getUserLabel(friend)}</span>
                        <small>{friend.email || "Tap to search"}</small>
                      </button>
                    ))
                  ) : (
                    <p className="status-subtle">No friend suggestions yet.</p>
                  )}
                </div>

                <div className="discover-block">
                  <h5>Trending Groups</h5>
                  <div className="discover-chip-row">
                    {pinnedGroupRooms.slice(0, 4).map((room) => (
                      <button
                        key={room.id}
                        type="button"
                        className="discover-chip"
                        onClick={() => {
                          setActiveRoom(room);
                          setActiveView("messages");
                          closeMobileDrawer();
                        }}
                      >
                        {getRoomDisplayName(room)}
                      </button>
                    ))}
                    {pinnedGroupRooms.length === 0 && <p className="status-subtle">No group chats yet.</p>}
                  </div>
                </div>
              </div>
            ) : loadingSearch ? (
              <p className="empty-text">Searching...</p>
            ) : searchResults.length === 0 ? (
              <p className="empty-text">No users found.</p>
            ) : (
              searchResults.map((result) => (
                <div key={result.id} className="room-item">
                  <div className="room-avatar">
                    {renderAvatarContent(result)}
                  </div>
                  <div className="room-details">
                    <span className="room-name">{getUserLabel(result)}</span>
                    <p className="room-last-msg">{result.email}</p>
                  </div>

                  {friends.some((friend) => friend.id === result.id) ? (
                    <button
                      onClick={() => startChatWithFriend(result)}
                      title="Message friend"
                      className="friend-action-btn"
                    >
                      <MessageSquare size={14} />
                    </button>
                  ) : hasPendingSentRequest(result.id) ? (
                    <span className="status-subtle">Pending</span>
                  ) : (
                    <button
                      onClick={() => handleSendFriendRequest(result)}
                      title="Send Request"
                      className="friend-action-btn"
                    >
                      <UserPlus size={14} />
                    </button>
                  )}
                </div>
              ))
            )}
          </>
        )}

        {activeView === "friend-requests" && (
          <>
            <div className="sidebar-search">
              <div className="search-input-wrapper">
                <Search size={18} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search people by name or email..."
                  value={friendSearchTerm}
                  onChange={(event) => setFriendSearchTerm(event.target.value)}
                />
              </div>
            </div>

            {friendSearchTerm.trim() && (
              <>
                <div className="section-header">
                  <span>FIND PEOPLE</span>
                </div>

                {loadingSearch ? (
                  <p className="empty-text">Searching...</p>
                ) : searchResults.length === 0 ? (
                  <p className="empty-text">No users found.</p>
                ) : (
                  searchResults.map((result) => {
                    const incomingRequest = getIncomingRequestFromUser(result.id);

                    return (
                      <div key={`search-${result.id}`} className="room-item">
                        <div className="room-avatar">
                          {renderAvatarContent(result)}
                        </div>
                        <div className="room-details">
                          <span className="room-name">{getUserLabel(result)}</span>
                          <p className="room-last-msg">{result.email}</p>
                        </div>

                        {friends.some((friend) => friend.id === result.id) ? (
                          <button
                            onClick={() => startChatWithFriend(result)}
                            title="Message friend"
                            className="friend-action-btn"
                          >
                            <MessageSquare size={14} />
                          </button>
                        ) : incomingRequest ? (
                          <div className="request-actions">
                            <button onClick={() => acceptRequest(incomingRequest)} className="friend-accept-btn" title="Accept request">
                              <Check size={14} />
                            </button>
                            <button onClick={() => rejectRequest(incomingRequest.id)} className="friend-reject-btn" title="Reject request">
                              <X size={14} />
                            </button>
                          </div>
                        ) : hasPendingSentRequest(result.id) ? (
                          <span className="status-subtle">Pending</span>
                        ) : (
                          <button
                            onClick={() => handleSendFriendRequest(result)}
                            title="Add friend"
                            className="friend-action-btn"
                          >
                            <UserPlus size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </>
            )}

            <div className="section-header">
              <span>INCOMING REQUESTS</span>
            </div>

            {friendRequests.length === 0 ? (
              <p className="empty-text">No pending friend requests.</p>
            ) : (
              friendRequests.map((request) => (
                <div key={request.id} className="room-item">
                  <div className="room-avatar">
                    {renderAvatarContent({
                      displayName: request.fromUserName,
                      email: request.fromUserEmail
                    })}
                  </div>
                  <div className="room-details">
                    <span className="room-name">{request.fromUserName}</span>
                    <p className="room-last-msg">{request.fromUserEmail}</p>
                  </div>
                  <div className="request-actions">
                    <button onClick={() => acceptRequest(request)} className="friend-accept-btn">
                      <Check size={14} />
                    </button>
                    <button onClick={() => rejectRequest(request.id)} className="friend-reject-btn">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}

            <div className="section-header" style={{ marginTop: "0.6rem" }}>
              <span>SENT (PENDING)</span>
            </div>

            {sentRequests.length === 0 ? (
              <p className="empty-text">No sent pending requests.</p>
            ) : (
              sentRequests.map((request) => (
                <div key={request.id} className="room-item">
                  <div className="room-avatar">
                    {renderAvatarContent({
                      displayName: request.toUserEmail?.split("@")[0] || "User",
                      email: request.toUserEmail
                    }, <UserPlus size={18} />)}
                  </div>
                  <div className="room-details">
                    <span className="room-name">{request.toUserEmail?.split("@")[0] || "User"}</span>
                    <p className="room-last-msg">{request.toUserEmail}</p>
                  </div>
                  <span className="status-subtle">Pending</span>
                </div>
              ))
            )}
          </>
        )}

        {activeView === "my-friends" && (
          <>
            <div className="section-header">
              <span>MY FRIENDS</span>
            </div>

            {friends.length === 0 ? (
              <p className="empty-text">You have no friends yet.</p>
            ) : (
              <div className="friends-sections-wrap">
                {favoriteFriends.length > 0 && (
                  <>
                    <div className="section-header">
                      <span>FAVORITES</span>
                    </div>
                    {favoriteFriends.map((friend) => renderFriendRow(friend, "fav"))}
                  </>
                )}

                <div className="section-header">
                  <span>ONLINE</span>
                </div>
                {onlineFriends.length > 0 ? onlineFriends.map((friend) => renderFriendRow(friend, "online")) : <p className="empty-text">No friends online.</p>}

                <div className="section-header">
                  <span>OFFLINE</span>
                </div>
                {offlineFriends.length > 0 ? offlineFriends.map((friend) => renderFriendRow(friend, "offline")) : <p className="empty-text">No offline friends.</p>}

                <div className="section-header">
                  <span>RECENTLY ADDED</span>
                </div>
                {recentlyAddedFriends.length > 0 ? recentlyAddedFriends.map((friend) => renderFriendRow(friend, "recent")) : <p className="empty-text">No recent additions.</p>}
              </div>
            )}
          </>
        )}

        {activeView === "about" && (
          <div className="about-card">
            <h4>CloudChat</h4>
            <p>Real-time chat with friends, file sharing, calls, notifications, and privacy controls.</p>
            <p>
              Status: <strong>{formatPresence(currentProfile)}</strong>
            </p>
            <div className="about-actions">
              <button className="primary-btn-small" onClick={toggleVisibility}>
                {currentProfile?.showOnline === false ? "Set Online" : "Set Invisible"}
              </button>
            </div>
          </div>
        )}
      </div>

      {showProfileModal && createPortal(
        <div className="call-overlay">
          <form className="call-modal profile-modal" onSubmit={handleProfileSave}>
            <div className="profile-modal-hero">
              <div>
                <h2 className="call-title">Settings</h2>
                <p className="call-subtitle">Manage your profile and preferences</p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowProfileModal(false)}
                aria-label="Close settings"
              >
                <X size={18} />
              </button>
            </div>

            <div className="settings-section-title">
              <User size={16} />
              <span>Edit Profile</span>
            </div>

            <label className="profile-label">Username</label>
            <input
              className="input-field"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              disabled={profileSaving}
            />

            <label className="profile-label">
              <Mail size={14} />
              <span>Email</span>
            </label>
            <input className="input-field" value={user?.email || ""} disabled />

            <div className="profile-toggle-row">
              <div className="profile-toggle-text">
                <p className="profile-toggle-title">
                  <Eye size={16} />
                  <span>Online Status</span>
                </p>
                <p className="profile-toggle-subtitle">
                  {currentProfile?.showOnline === false ? "Invisible to others" : "Visible to everyone"}
                </p>
              </div>
              <button
                type="button"
                className={`profile-switch ${currentProfile?.showOnline === false ? "" : "active"}`}
                onClick={toggleVisibility}
                disabled={profileSaving}
                aria-label="Toggle online status"
                aria-pressed={currentProfile?.showOnline === false ? "false" : "true"}
              >
                <span />
              </button>
            </div>

            <div className="avatar-picker-wrap">
              <p className="avatar-picker-title">Choose Avatar</p>
              <div className="avatar-picker-grid">
                {avatarOptions.map((avatar) => (
                  <button
                    key={avatar}
                    type="button"
                    className={`avatar-picker-btn ${selectedAvatarEmoji === avatar ? "active" : ""}`}
                    onClick={() => setSelectedAvatarEmoji(avatar)}
                  >
                    {avatar}
                  </button>
                ))}
              </div>
            </div>

            <div className="call-actions-row profile-actions-col">
              <button type="submit" className="call-accept-btn profile-save-btn" disabled={profileSaving}>
                <Save size={16} />
                {profileSaving ? "Saving..." : "Save Changes"}
              </button>
              <button
                type="button"
                className="call-end-btn profile-delete-btn"
                onClick={() => {
                  alert("Account deletion is not enabled in this build.");
                }}
              >
                <Trash2 size={16} />
                Delete Account
              </button>
            </div>

            <div className="profile-privacy-note">
              <Shield size={15} />
              <p>Your privacy is important to us. Your data is encrypted and secure.</p>
            </div>
          </form>
        </div>,
        document.body
      )}

      {roomToDelete && createPortal(
        <div className="call-overlay">
          <div className="call-modal delete-chat-modal">
            <h2 className="call-title">Delete Chat</h2>
            <p className="call-subtitle">
              Delete <strong>{roomToDelete.name}</strong> from your sidebar?
            </p>
            <p className="delete-chat-note">This removes or leaves the chat for your account.</p>
            <div className="call-actions-row">
              <button type="button" className="call-end-btn" onClick={cancelDeleteRoom} disabled={isDeletingRoom}>
                Cancel
              </button>
              <button type="button" className="call-accept-btn delete-chat-confirm-btn" onClick={confirmDeleteRoom} disabled={isDeletingRoom}>
                <Trash2 size={15} />
                {isDeletingRoom ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showNewRoom && createPortal(
        <div className="call-overlay">
          <div className="call-modal profile-modal create-group-modal">
            <div className="modal-head-row">
              <div>
                <h2 className="call-title">Create Group Chat</h2>
                <p className="call-subtitle">
                  {groupModalStep === 1
                    ? "Step 1: Name your group"
                    : `Step 2: Add members (${selectedFriendIds.length} selected)`}
                </p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={resetCreateRoomForm}
                aria-label="Close create group modal"
              >
                <X size={18} />
              </button>
            </div>

            {groupModalStep === 1 ? (
              <form onSubmit={handleGroupNameStepSubmit} className="group-step-layout">
                <label className="profile-label">Group Name</label>
                <input
                  autoFocus
                  className="input-field"
                  placeholder="Enter group name..."
                  value={newRoomName}
                  onChange={(event) => setNewRoomName(event.target.value)}
                />
                <p className="group-input-help">Choose a name that describes your group chat</p>

                {newRoomName.trim() && (
                  <div className="group-preview-card">
                    <p className="group-preview-kicker">Preview</p>
                    <div className="group-preview-row">
                      <span className="group-preview-avatar">
                        <Users size={16} />
                      </span>
                      <div>
                        <p className="group-preview-name">{newRoomName.trim()}</p>
                        <p className="group-preview-sub">Group Chat</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="call-actions-row modal-actions-row">
                  <button type="submit" className="call-accept-btn" disabled={!newRoomName.trim()}>
                    Next
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleCreateRoom} className="group-step-layout">
                <div className="group-member-search-wrap">
                  <Search size={17} className="search-icon" />
                  <input
                    type="text"
                    value={groupMemberSearchTerm}
                    onChange={(event) => setGroupMemberSearchTerm(event.target.value)}
                    className="input-field group-member-search"
                    placeholder="Search users..."
                  />
                </div>

                <div className="friend-picker-list group-picker-list">
                  {friends.length === 0 ? (
                    <p className="empty-text" style={{ padding: "0.35rem 0.2rem", textAlign: "left" }}>
                      Add friends first, then create a group.
                    </p>
                  ) : filteredGroupFriends.length === 0 ? (
                    <p className="empty-text" style={{ padding: "0.35rem 0.2rem", textAlign: "left" }}>
                      No matching friends found.
                    </p>
                  ) : (
                    filteredGroupFriends.map((friend) => {
                      const isSelected = selectedFriendIds.includes(friend.id);
                      return (
                        <button
                          type="button"
                          key={friend.id}
                          className={`group-member-card ${isSelected ? "selected" : ""}`}
                          onClick={() => toggleFriendForRoom(friend.id)}
                        >
                          <span className="group-member-avatar">
                            {friend.photoURL ? <img src={friend.photoURL} alt="" className="friend-avatar-image" /> : getUserLabel(friend).charAt(0).toUpperCase()}
                          </span>
                          <div className="group-member-text">
                            <p>{getUserLabel(friend)}</p>
                            <small>{friend.status === "online" ? "Online" : "Offline"}</small>
                          </div>
                          {isSelected && (
                            <span className="group-member-check">
                              <Check size={14} />
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="call-actions-row modal-actions-row group-modal-sticky-actions">
                  <button type="button" className="call-end-btn" onClick={() => setGroupModalStep(1)}>
                    Back
                  </button>
                  <button
                    type="submit"
                    className="call-accept-btn"
                    disabled={!newRoomName.trim() || selectedFriendIds.length === 0}
                  >
                    Create Group ({selectedFriendIds.length})
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
