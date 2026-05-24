import React from "react";
import { ArrowRight, MonitorSmartphone, Search, UserCheck, UserPlus } from "lucide-react";

export default function WelcomeLanding({ onTryApplication = () => {} }) {
  return (
    <div className="loading-screen welcome-screen">
      <section className="welcome-card glass-morphism animate-fade-in">
        <p className="welcome-badge">CloudChat</p>
        <h1>Start Chatting In 3 Easy Steps</h1>
        <p className="welcome-tagline">
          Your friend can start quickly on phone and laptop with this simple flow
        </p>

        <div className="welcome-steps">
          <article className="welcome-step">
            <div className="welcome-step-icon">
              <Search size={18} />
            </div>
            <div>
              <h3>1. Find Friends</h3>
              <p>Simply find your friends and add them to start a conversation instantly.</p>
            </div>
          </article>

          <article className="welcome-step">
            <div className="welcome-step-icon">
              <UserPlus size={18} />
            </div>
            <div>
              <h3>2. Send Request</h3>
              <p>Send a friend request and wait for them to accept to start chatting.</p>
            </div>
          </article>

          <article className="welcome-step">
            <div className="welcome-step-icon">
              <UserCheck size={18} />
            </div>
            <div>
              <h3>3. Accept And Chat</h3>
              <p>Once they accept, you can start chatting securely and instantly.</p>
            </div>
          </article>
        </div>

        <div className="welcome-support">
          <MonitorSmartphone size={18} />
          <span>Optimized for both mobile and desktop</span>
        </div>

        <button type="button" className="btn btn-primary welcome-cta" onClick={onTryApplication}>
          Get Started
          <ArrowRight size={18} />
        </button>
      </section>
    </div>
  );
}
