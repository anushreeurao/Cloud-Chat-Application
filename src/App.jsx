import React from "react";
import Login from "./components/Login";
import ChatContainer from "./components/ChatContainer";
import WelcomeLanding from "./components/WelcomeLanding";
import { AuthProvider, useAuth } from "./contexts/AuthContext";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || "Unknown render error."
    };
  }

  componentDidCatch(error) {
    console.error("App render failed", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="loading-screen" style={{ textAlign: "center", flexDirection: "column", gap: "0.85rem" }}>
          <h2>Something went wrong</h2>
          <p style={{ color: "var(--text-muted)" }}>
            The chat UI crashed. Please refresh and try again.
          </p>
          {this.state.errorMessage && (
            <p style={{ color: "var(--danger)", maxWidth: "680px", wordBreak: "break-word", fontSize: "0.9rem" }}>
              {this.state.errorMessage}
            </p>
          )}
          <button className="btn btn-primary" style={{ width: "auto", padding: "0.7rem 1rem" }} onClick={() => window.location.reload()}>
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function AppContent() {
  const { user, loading } = useAuth();
  const [showOnboarding, setShowOnboarding] = React.useState(true);

  React.useEffect(() => {
    if (!user) {
      setShowOnboarding(true);
    }
  }, [user]);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading CloudChat...</p>
      </div>
    );
  }

  if (user) {
    return <ChatContainer />;
  }

  if (showOnboarding) {
    return <WelcomeLanding onTryApplication={() => setShowOnboarding(false)} />;
  }

  return <Login />;
}

function App() {
  return (
    <AuthProvider>
      <AppErrorBoundary>
        <AppContent />
      </AppErrorBoundary>
    </AuthProvider>
  );
}

export default App;
