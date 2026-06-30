import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const BASE = "/qe";

const originalFetch = window.fetch.bind(window);
(window as any).__devxOriginalFetch = originalFetch;

window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === "string" && input.startsWith("/") && !input.startsWith(BASE)) {
    // Same backend as main DevX app: APIs live at /api/* on the origin root, not under /qe.
    // Prefixing would call /qe/api/... and return 404 for routes registered as /api/...
    if (input === "/api" || input.startsWith("/api/")) {
      return originalFetch(input, init);
    }
    input = BASE + input;
  }
  return originalFetch(input, init);
};

window.addEventListener("error", (e) => {
  const root = document.getElementById("root");
  if (root && !root.hasChildNodes()) {
    root.innerHTML = `<div style="padding:2rem;font-family:monospace"><h2 style="color:red">QE App Error</h2><pre style="white-space:pre-wrap;background:#fef2f2;padding:1rem;border-radius:8px;border:1px solid #fecaca">${e.message}\n${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack || ""}</pre><button onclick="location.reload()" style="margin-top:1rem;padding:8px 16px;background:#4f46e5;color:white;border:none;border-radius:6px;cursor:pointer">Reload</button></div>`;
  }
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("[QE] Unhandled rejection:", e.reason);
});

try {
  createRoot(document.getElementById("root")!).render(<App />);
} catch (e: any) {
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = `<div style="padding:2rem;font-family:monospace"><h2 style="color:red">QE App Failed to Mount</h2><pre style="white-space:pre-wrap;background:#fef2f2;padding:1rem;border-radius:8px;border:1px solid #fecaca">${e?.message}\n${e?.stack}</pre><button onclick="location.reload()" style="margin-top:1rem;padding:8px 16px;background:#4f46e5;color:white;border:none;border-radius:6px;cursor:pointer">Reload</button></div>`;
  }
}
