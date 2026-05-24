import React from "react";
import Sidebar from "./Sidebar";
import ChatWindow from "./ChatWindow";
import { useAuth } from "../contexts/AuthContext";
import { useChat } from "../hooks/useChat";
import { useFriends } from "../hooks/useFriends";
import { MessageSquare, Search, UserPlus, X } from "lucide-react";

const MOBILE_QUERY = "(max-width: 900px)";
const MOBILE_CHAT_HISTORY_STATE_KEY = "__cloudchatMobileChat";

export default function ChatContainer() {
  const { user } = useAuth();
  const chatData = useChat(user);
  const friendData = useFriends(user);
  const [activeView, setActiveView] = React.useState("messages");
  const [isMobile, setIsMobile] = React.useState(() => window.matchMedia(MOBILE_QUERY).matches);
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(() => !window.matchMedia(MOBILE_QUERY).matches);
  const [showFirstTimeGuide, setShowFirstTimeGuide] = React.useState(false);
  const hasMobileChatHistoryRef = React.useRef(false);
  const isMobileChatOpen = isMobile && activeView === "messages" && Boolean(chatData.activeRoom) && !isSidebarOpen;

  React.useEffect(() => {
    setActiveView("messages");
  }, [user?.uid]);

  React.useEffect(() => {
    if (!user?.uid) {
      setShowFirstTimeGuide(false);
      return;
    }

    const guideSeenKey = `cloudchat_first_time_guide_seen_${user.uid}`;
    const hasSeenGuide = window.localStorage.getItem(guideSeenKey) === "1";
    setShowFirstTimeGuide(!hasSeenGuide);
  }, [user?.uid]);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_QUERY);
    const handleChange = (event) => {
      const mobile = event.matches;
      setIsMobile(mobile);
      setIsSidebarOpen(!mobile);
    };

    handleChange(mediaQuery);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  React.useEffect(() => {
    if (!isMobile) {
      return;
    }

    // On mobile, tabs are the primary navigation.
    // Keep list pages open by default; open conversation only when user selects a room.
    if (activeView !== "messages" || !chatData.activeRoom) {
      setIsSidebarOpen(true);
    }
  }, [isMobile, activeView, chatData.activeRoom]);

  React.useEffect(() => {
    if (!isMobile) {
      document.documentElement.style.removeProperty("--app-mobile-vh");
      return undefined;
    }

    const setMobileViewportHeight = () => {
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const vh = viewportHeight * 0.01;
      document.documentElement.style.setProperty("--app-mobile-vh", `${vh}px`);
    };

    setMobileViewportHeight();
    window.addEventListener("resize", setMobileViewportHeight);
    window.addEventListener("orientationchange", setMobileViewportHeight);
    window.visualViewport?.addEventListener("resize", setMobileViewportHeight);
    window.visualViewport?.addEventListener("scroll", setMobileViewportHeight);

    return () => {
      window.removeEventListener("resize", setMobileViewportHeight);
      window.removeEventListener("orientationchange", setMobileViewportHeight);
      window.visualViewport?.removeEventListener("resize", setMobileViewportHeight);
      window.visualViewport?.removeEventListener("scroll", setMobileViewportHeight);
      document.documentElement.style.removeProperty("--app-mobile-vh");
    };
  }, [isMobile]);

  React.useEffect(() => {
    if (!isMobile) {
      hasMobileChatHistoryRef.current = false;
      return;
    }

    if (!isMobileChatOpen) {
      hasMobileChatHistoryRef.current = false;
      return;
    }

    if (hasMobileChatHistoryRef.current) {
      return;
    }

    const currentState =
      window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};

    window.history.pushState(
      {
        ...currentState,
        [MOBILE_CHAT_HISTORY_STATE_KEY]: true
      },
      ""
    );
    hasMobileChatHistoryRef.current = true;
  }, [isMobile, isMobileChatOpen]);

  React.useEffect(() => {
    if (!isMobile) {
      return undefined;
    }

    const handlePopState = (event) => {
      if (!isMobileChatOpen) {
        return;
      }

      const poppedState =
        event?.state && typeof event.state === "object"
          ? event.state
          : {};

      // If we popped our synthetic chat state, go back to the in-app list instead of leaving the app.
      if (!poppedState[MOBILE_CHAT_HISTORY_STATE_KEY]) {
        hasMobileChatHistoryRef.current = false;
        setIsSidebarOpen(true);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isMobile, isMobileChatOpen]);

  const handleBackToHub = React.useCallback(() => {
    if (isMobileChatOpen && hasMobileChatHistoryRef.current) {
      window.history.back();
      return;
    }

    setIsSidebarOpen(true);
  }, [isMobileChatOpen]);

  const dismissFirstTimeGuide = React.useCallback(() => {
    if (user?.uid) {
      window.localStorage.setItem(`cloudchat_first_time_guide_seen_${user.uid}`, "1");
    }
    setShowFirstTimeGuide(false);
  }, [user?.uid]);

  const openFindPeopleFromGuide = React.useCallback(() => {
    setActiveView("friend-requests");
    setIsSidebarOpen(true);
    dismissFirstTimeGuide();
  }, [dismissFirstTimeGuide]);

  const firstTimeGuide = showFirstTimeGuide ? (
    <div className="call-overlay first-time-guide-overlay">
      <div className="call-modal first-time-guide-modal">
        <button
          type="button"
          className="modal-close-btn first-time-guide-close"
          onClick={dismissFirstTimeGuide}
          aria-label="Close guide"
        >
          <X size={18} />
        </button>
        <h2 className="call-title">Welcome to CloudChat</h2>
        <p className="call-subtitle">Make friends and chat on both laptop and mobile in 2 quick steps.</p>

        <div className="first-time-guide-steps">
          <div className="first-time-guide-step">
            <div className="first-time-guide-icon">
              <Search size={16} />
            </div>
            <div>
              <h3>1. Find People</h3>
              <p>Open Friend Requests and search by name or email.</p>
            </div>
          </div>
          <div className="first-time-guide-step">
            <div className="first-time-guide-icon">
              <MessageSquare size={16} />
            </div>
            <div>
              <h3>2. Add Friend And Chat</h3>
              <p>Send request, accept, then start chatting instantly.</p>
            </div>
          </div>
        </div>

        <div className="call-actions-row">
          <button type="button" className="call-end-btn" onClick={dismissFirstTimeGuide}>
            Skip
          </button>
          <button type="button" className="call-accept-btn" onClick={openFindPeopleFromGuide}>
            <UserPlus size={16} />
            Find Friends
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (isMobile) {
    return (
      <>
        <div className={`app-container mobile-app-shell min-h-dvh w-full ${isMobileChatOpen ? "mobile-chat-open" : ""}`.trim()}>
          <ChatWindow
            chatData={chatData}
            isMobile={true}
            isSidebarOpen={isSidebarOpen}
            onOpenSidebar={() => setIsSidebarOpen(true)}
            onBackToHub={handleBackToHub}
          />

          <button
            type="button"
            className={`mobile-sidebar-backdrop ${isSidebarOpen ? "show" : ""}`}
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Close sidebar"
          />

          <Sidebar
            chatData={chatData}
            friendData={friendData}
            activeView={activeView}
            setActiveView={setActiveView}
            isMobile={true}
            isSidebarOpen={isSidebarOpen}
            className={isSidebarOpen ? "mobile-open" : ""}
            onMobileNavigate={() => setIsSidebarOpen(false)}
          />
        </div>
        {firstTimeGuide}
      </>
    );
  }

  return (
    <>
      <div className="app-container min-h-dvh md:min-h-screen">
        <Sidebar
          chatData={chatData}
          friendData={friendData}
          activeView={activeView}
          setActiveView={setActiveView}
        />
        {activeView === "messages" ? (
          <ChatWindow chatData={chatData} />
        ) : (
          <div className="chat-window-empty chat-view-hint">
            <div className="welcome-content animate-fade-in">
              <h2>
                {activeView === "friend-requests"
                  ? "Friend Requests"
                  : activeView === "find-friends"
                    ? "Find Friends"
                    : activeView === "my-friends"
                      ? "My Friends"
                      : "About"}
              </h2>
              <p>Use the left panel and open Messages whenever you want to chat.</p>
            </div>
          </div>
        )}
      </div>
      {firstTimeGuide}
    </>
  );
}
