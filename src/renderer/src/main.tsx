import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./styles/global.css";

function showRendererError(error: unknown): void {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  console.error("[Renderer]", message);
  const root = document.getElementById("root");
  if (!root) {
    document.body.textContent = `Renderer hatası: ${message}`;
    return;
  }
  root.innerHTML = `
    <div style="padding:32px;font-family:Segoe UI,sans-serif;color:#e8eefc;background:#070b14;min-height:100vh">
      <h1 style="margin:0 0 8px">Instagram Automation Manager</h1>
      <p style="margin:0 0 16px">Dashboard yüklenemedi. Ayrıntı geliştirici günlüğünde.</p>
      <pre style="white-space:pre-wrap;color:#fb7185">${message.replaceAll("<", "&lt;")}</pre>
    </div>
  `;
}

window.addEventListener("error", (event) => {
  showRendererError(event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  showRendererError(event.reason);
});

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element missing");
}

try {
  createRoot(root).render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>
  );
  console.log("[Renderer] React mounted");
} catch (error) {
  showRendererError(error);
}
