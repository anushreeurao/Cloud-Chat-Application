import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

async function clearLegacyCaches() {
  if (typeof window === "undefined") {
    return;
  }

  const key = "cloudchat_cache_reset_v2";
  if (localStorage.getItem(key) === "done") {
    return;
  }

  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }

    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }
  } catch (error) {
    console.warn("Cache cleanup warning:", error);
  } finally {
    localStorage.setItem(key, "done");
  }
}

clearLegacyCaches();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
