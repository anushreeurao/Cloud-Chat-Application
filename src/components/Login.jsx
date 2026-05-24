import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LogIn, Mail, Lock, Globe, MessageSquare } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const { login, signup, loginWithGoogle, resetPassword } = useAuth();
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await signup(email, password);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleGoogleLogin = async () => {
    if (googleLoading) return;

    setError('');
    setInfo('');
    setGoogleLoading(true);
    try {
      const result = await loginWithGoogle();
      if (result?.mode === "redirect") {
        setInfo("Redirecting to Google sign-in...");
      }
    } catch (err) {
      const code = err?.code || '';

      // User closed the popup or triggered another popup request; keep UX quiet.
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setGoogleLoading(false);
        return;
      }

      if (code === 'auth/unauthorized-domain') {
        setError('Google sign-in blocked: add this domain in Firebase Auth -> Authorized domains (for local use add localhost).');
      } else {
        setError(err?.message || 'Google sign-in failed. Please try again.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError('');
    setInfo('');

    const emailToReset = email.trim();
    if (!emailToReset) {
      setError('Enter your email first to reset password.');
      return;
    }

    try {
      await resetPassword(emailToReset);
      setInfo('Password reset link sent. Check your inbox.');
    } catch (err) {
      setError(err?.message || 'Failed to send password reset email.');
    }
  };

  return (
    <div className="loading-screen">
      <div className="auth-card glass-morphism animate-fade-in cloud-auth-card">
        <div className="auth-brand-icon">
          <MessageSquare size={24} />
        </div>
        <h1 style={{ marginBottom: '0.5rem', fontSize: '3rem' }}>CloudChat</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
          {isLogin ? 'Welcome back! Please login.' : 'Create your account to start chatting.'}
        </p>

        {error && <div style={{ color: 'var(--danger)', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>}
        {info && <div style={{ color: 'var(--success)', marginBottom: '1rem', fontSize: '0.9rem' }}>{info}</div>}

        <form onSubmit={handleSubmit}>
          <label className="auth-label">
            <Mail size={15} />
            <span>Email</span>
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type="email"
              className="input-field"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <label className="auth-label">
            <Lock size={15} />
            <span>Password</span>
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type="password"
              className="input-field"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {isLogin && (
            <div className="auth-inline-row">
              <label className="remember-toggle">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                <span>Remember me</span>
              </label>
              <button type="button" className="auth-link-btn" onClick={handleForgotPassword}>
                Forgot Password?
              </button>
            </div>
          )}
          <button type="submit" className="btn btn-primary">
            {isLogin ? <LogIn size={20} /> : null}
            {isLogin ? 'Login' : 'Sign Up'}
          </button>
        </form>

        <div style={{ margin: '1.5rem 0', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--glass-border)' }}></div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Or</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--glass-border)' }}></div>
        </div>

        <button onClick={handleGoogleLogin} className="btn btn-google" disabled={googleLoading}>
          <Globe size={20} />
          {googleLoading ? 'Opening Google...' : 'Continue with Google'}
        </button>

        <p style={{ marginTop: '2rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <span 
            style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 'bold' }}
            onClick={() => setIsLogin(!isLogin)}
          >
            {isLogin ? 'Sign Up' : 'Login'}
          </span>
        </p>
      </div>
    </div>
  );
}
