import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Menu,
  MoreVertical,
  Paperclip,
  Send,
  Smile
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import Message from "./Message";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import { db } from "../firebase";
import { doc, getDoc } from "firebase/firestore";

export default function ChatWindow({
  chatData,
  theme,
  isMobile = false,
  isSidebarOpen = false,
  onOpenSidebar = () => {},
  onBackToHub = () => {}
}) {
  const { user } = useAuth();
  const {
    activeRoom = null,
    messages = [],
    chatError = "",
    sendMessage = async () => {},
    clearMessages = async () => {},
    setTyping = async () => {}
  } = chatData || {};
  const [inputText, setInputText] = useState("");
  const [file, setFile] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [memberProfiles, setMemberProfiles] = useState([]);
  const typingTimeoutRef = useRef(null);
  const lastTypingSignalRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const previousLastMessageIdRef = useRef(null);
  const scrollRef = useRef();
  const fileInputRef = useRef();
  const dropdownRef = useRef(null);

  const typingUsers = useMemo(() => {
    if (!activeRoom?.typing || typeof activeRoom.typing !== "object" || !user?.uid) {
      return [];
    }

    const now = Date.now();
    return Object.entries(activeRoom.typing)
      .filter(([uid, timestamp]) => uid !== user.uid && now - Number(timestamp) < 5000)
      .map(([uid]) => uid);
  }, [activeRoom?.typing, user?.uid]);

  const isDirectChat = useMemo(
    () => Array.isArray(activeRoom?.members) && activeRoom.members.length === 2,
    [activeRoom?.members]
  );

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }

    const listNode = scrollRef.current;
    const lastMessage = messages[messages.length - 1] || null;
    const nextLastMessageId = lastMessage?.id || null;
    const hasNewLastMessage = nextLastMessageId !== previousLastMessageIdRef.current;
    const shouldStickToBottom =
      isNearBottomRef.current ||
      (hasNewLastMessage && lastMessage?.senderId === user?.uid);

    if (shouldStickToBottom) {
      listNode.scrollTop = listNode.scrollHeight;
    }

    previousLastMessageIdRef.current = nextLastMessageId;
  }, [messages, user?.uid]);

  useEffect(() => {
    setShowDropdown(false);
    isNearBottomRef.current = true;
    previousLastMessageIdRef.current = null;
  }, [activeRoom?.id]);

  useEffect(() => {
    if (!isMobile || !isSidebarOpen) {
      return;
    }
    setShowDropdown(false);
    setShowEmojiPicker(false);
  }, [isMobile, isSidebarOpen]);

  useEffect(() => {
    if (!showDropdown) {
      return undefined;
    }

    const closeOnOutsideClick = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("touchstart", closeOnOutsideClick);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("touchstart", closeOnOutsideClick);
    };
  }, [showDropdown]);

  useEffect(() => {
    if (!showEmojiPicker) {
      return;
    }
    setShowDropdown(false);
  }, [showEmojiPicker]);

  useEffect(() => {
    return () => {
      if (activeRoom?.id && user?.uid) {
        setTyping(activeRoom.id, false);
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      lastTypingSignalRef.current = 0;
    };
  }, [activeRoom?.id, setTyping, user?.uid]);

  useEffect(() => {
    let cancelled = false;

    async function loadGroupDetails() {
      if (!activeRoom?.id || !Array.isArray(activeRoom?.members) || activeRoom.members.length < 2) {
        setMemberProfiles([]);
        return;
      }

      try {
        const profilePromises = activeRoom.members.map(async (uid) => {
          const snap = await getDoc(doc(db, "users", uid));
          if (!snap.exists()) {
            return { id: uid, displayName: "Unknown user", email: "" };
          }
          const data = snap.data();
          return {
            id: uid,
            displayName: data.displayName || data.email?.split("@")[0] || "User",
            email: data.email || "",
            avatarEmoji: data.avatarEmoji || "",
            status: data.status || "offline",
            showOnline: data.showOnline !== false
          };
        });

        const profiles = await Promise.all(profilePromises);
        if (cancelled) {
          return;
        }

        setMemberProfiles(profiles);
      } catch (error) {
        console.error("Failed to load group details", error);
        if (!cancelled) {
          setMemberProfiles([]);
        }
      }
    }

    loadGroupDetails();
    return () => {
      cancelled = true;
    };
  }, [activeRoom?.id, activeRoom?.members, activeRoom?.createdBy]);

  const scheduleTypingReset = () => {
    if (!activeRoom?.id) {
      return;
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setTyping(activeRoom.id, false);
    }, 1500);
  };

  const handleSend = async (event) => {
    event.preventDefault();

    if ((!inputText.trim() && !file) || isSending || !activeRoom?.id) {
      return;
    }

    const text = inputText;
    const selectedFile = file;

    setIsSending(true);
    setShowEmojiPicker(false);
    setInputText("");
    setFile(null);

    try {
      const result = await sendMessage(activeRoom.id, text, selectedFile);
      await setTyping(activeRoom.id, false);
      if (result?.attachmentUploadFailed) {
        alert("Message sent, but file upload failed. Please retry with a smaller file or check Storage access.");
      }
    } catch (error) {
      console.error("Error sending message", error);
      setInputText(text);
      setFile(selectedFile);
      alert(`Failed to send message or file: ${error?.code || error?.message || "unknown error"}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleFileChange = (event) => {
    if (event.target.files[0]) {
      setFile(event.target.files[0]);
    }
  };

  const handleEmojiClick = (emoji) => {
    setInputText((previous) => `${previous}${emoji}`);
  };

  const handleClearChat = async () => {
    if (!activeRoom?.id) {
      return;
    }

    const confirmed = window.confirm("Are you sure you want to clear this chat for yourself?");
    if (!confirmed) {
      setShowDropdown(false);
      return;
    }

    await clearMessages(activeRoom.id);
    setShowDropdown(false);
  };

  const handleInputChange = (event) => {
    const nextValue = event.target.value;
    setInputText(nextValue);

    if (!activeRoom?.id) {
      return;
    }

    if (nextValue.trim()) {
      const now = Date.now();
      if (now - lastTypingSignalRef.current > 900) {
        setTyping(activeRoom.id, true);
        lastTypingSignalRef.current = now;
      }
      scheduleTypingReset();
    } else {
      setTyping(activeRoom.id, false);
      lastTypingSignalRef.current = 0;
    }
  };

  const closeTransientPanels = () => {
    setShowDropdown(false);
    setShowEmojiPicker(false);
  };

  const handleMessagesScroll = () => {
    if (!scrollRef.current) {
      return;
    }

    const listNode = scrollRef.current;
    const distanceFromBottom = listNode.scrollHeight - (listNode.scrollTop + listNode.clientHeight);
    isNearBottomRef.current = distanceFromBottom < 72;
  };

  const groupMembersLabel = useMemo(() => {
    if (!Array.isArray(activeRoom?.members) || activeRoom.members.length <= 2) {
      return "";
    }

    const displayNames = memberProfiles.map((member) => member.displayName).filter(Boolean);
    return `${activeRoom.members.length} members - ${displayNames.join(", ")}`;
  }, [activeRoom?.members, memberProfiles]);

  const directChatPeer = useMemo(() => {
    if (!isDirectChat || !user?.uid) {
      return null;
    }

    return memberProfiles.find((member) => member.id !== user.uid) || null;
  }, [isDirectChat, memberProfiles, user?.uid]);

  const directRoomName = useMemo(() => {
    if (!isDirectChat) {
      const groupName = (activeRoom?.name || "").trim();
      return groupName || "Chat";
    }

    const peerName = (directChatPeer?.displayName || "").trim();
    if (peerName) {
      return peerName;
    }

    const roomName = (activeRoom?.name || "").trim();
    if (roomName) {
      return roomName;
    }

    return "Direct Chat";
  }, [isDirectChat, directChatPeer?.displayName, activeRoom?.name]);

  const directRoomPresence = useMemo(() => {
    if (!isDirectChat) {
      return "";
    }

    if (!directChatPeer) {
      return "Direct chat";
    }

    if (directChatPeer.showOnline === false) {
      return "Offline";
    }

    return directChatPeer.status === "online" ? "Online" : "Offline";
  }, [isDirectChat, directChatPeer]);

  if (!activeRoom) {
    return (
      <div className="chat-window-empty">
        {isMobile && (
          <button type="button" className="mobile-menu-trigger floating md:hidden" onClick={onOpenSidebar}>
            <Menu size={20} />
          </button>
        )}
        <div className="welcome-content animate-fade-in">
          <div className="welcome-icon">
            <Send size={40} />
          </div>
          <h2>Welcome to CloudChat</h2>
          <p>Select a room to start messaging or create a new one.</p>
          {chatError ? <p style={{ marginTop: "0.65rem", color: "var(--danger)" }}>{chatError}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-window animate-fade-in">
      <div className="chat-header">
        <div className="room-info">
          <div className="room-info-top">
            {isMobile && (
              <button type="button" className="mobile-menu-trigger md:hidden" onClick={onOpenSidebar}>
                <Menu size={20} />
              </button>
            )}
            <span className="chat-room-avatar">
              {isDirectChat ? (directChatPeer?.avatarEmoji || directRoomName.charAt(0).toUpperCase()) : "👥"}
            </span>
            <h3>{directRoomName}</h3>
          </div>
          <p>
            {typingUsers.length > 0
              ? "Typing..."
              : isDirectChat
                ? directRoomPresence
                : `${activeRoom?.members?.length || 0} members`}
          </p>
          {Array.isArray(activeRoom?.members) && activeRoom.members.length > 2 && (
            <div className="group-meta-line">
              <span className="group-members-inline">{groupMembersLabel || "Loading members..."}</span>
            </div>
          )}
        </div>
        <div className="chat-actions">
          <div className="menu-wrap" ref={dropdownRef}>
            <button className="icon-btn" onClick={() => setShowDropdown(!showDropdown)}>
              <MoreVertical size={20} />
            </button>
            {showDropdown && (
              <div className="dropdown-menu">
                <button onClick={handleClearChat} className="dropdown-item delete-text">
                  Clear Chat
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="messages-container" ref={scrollRef} onClick={closeTransientPanels} onScroll={handleMessagesScroll}>
        {messages.length === 0 ? (
          <div className="messages-empty-state">No messages yet. Start the conversation.</div>
        ) : (
          messages.map((message) => (
            <Message
              key={message.id}
              message={message}
              isOwn={message.senderId === user?.uid}
              senderNameOverride={isDirectChat ? directRoomName : ""}
            />
          ))
        )}
      </div>

      <div className="chat-input-area">
        {file && (
          <div className="file-preview animate-fade-in">
            <span>{file.name}</span>
            <button onClick={() => setFile(null)} className="close-btn" disabled={isSending}>
              X
            </button>
          </div>
        )}

        {isSending && (
          <div className="file-preview animate-fade-in" style={{ background: "rgba(37, 99, 235, 0.08)", borderColor: "var(--primary)" }}>
            <div
              className="spinner"
              style={{ width: "16px", height: "16px", borderWidth: "2px", marginRight: "8px", display: "inline-block", verticalAlign: "middle" }}
            />
            <span>Sending your message...</span>
          </div>
        )}

        <form onSubmit={handleSend} className="input-form">
          <button
            type="button"
            className="icon-btn"
            disabled={isSending}
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.value = "";
                fileInputRef.current.click();
              }
            }}
          >
            <Paperclip size={20} />
          </button>

          <input
            type="file"
            hidden
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
            disabled={isSending}
          />

          <input
            type="text"
            placeholder={isSending ? "Sending..." : "Type a message..."}
            value={inputText}
            onChange={handleInputChange}
            onFocus={() => setShowEmojiPicker(false)}
            disabled={isSending}
          />

          <div className="emoji-picker-wrap">
            <button
              type="button"
              className="icon-btn"
              disabled={isSending}
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            >
              <Smile size={20} />
            </button>

            {showEmojiPicker && (
              <div className="emoji-mart-container">
                <Picker
                  data={data}
                  onEmojiSelect={(emoji) => handleEmojiClick(emoji.native)}
                  theme={theme || "light"}
                  set="native"
                />
              </div>
            )}
          </div>

          <button type="submit" className="send-btn" disabled={(!inputText.trim() && !file) || isSending}>
            <Send size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}
