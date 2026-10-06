import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");

createRoot(rootEl).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/service-worker.js")
        .catch((err) => console.error("SW registration failed", err));
    });
  } else {
    // A service worker is scoped to the origin (localhost:5173), not to this
    // app. One left over from an earlier dev session would keep serving the
    // cached site here and to any other app later run on the same port, so
    // dev mode tears down whatever is registered.
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});
    if ("caches" in window) {
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((k) => k.startsWith("asm-catalog-"))
              .map((k) => caches.delete(k)),
          ),
        )
        .catch(() => {});
    }
  }
}
