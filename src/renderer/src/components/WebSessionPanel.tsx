import type { WebSessionSnapshot } from "@shared/types";
import { useAppStore } from "../stores/appStore";

const sessionDot: Record<WebSessionSnapshot["status"], string> = {
  disconnected: "var(--danger)",
  login_required: "var(--warning)",
  connected: "var(--success)",
  expired: "var(--warning)",
  security_check: "var(--danger)"
};

export function WebSessionPanel({ session }: { session: WebSessionSnapshot }) {
  const refresh = useAppStore((state) => state.refresh);
  const pushToast = useAppStore((state) => state.pushToast);

  return (
    <div>
      <h3>Instagram Web Oturumu</h3>
      <p>
        <span className="status-dot" style={{ background: sessionDot[session.status] }} />
        {session.message}
        {session.instagramUsername ? ` · @${session.instagramUsername}` : ""}
      </p>
      <div className="toolbar">
        <button
          className="btn primary"
          onClick={async () => {
            await window.api.loginWebAutomation();
            await refresh();
            pushToast("info", "Instagram penceresinde hesabınıza manuel giriş yapın.");
          }}
        >
          Instagram'a Giriş Yap
        </button>
        <button
          className="btn"
          onClick={async () => {
            const next = await window.api.checkWebAutomationSession();
            await refresh();
            pushToast("info", next.message);
          }}
        >
          Oturumu Kontrol Et
        </button>
        <button
          className="btn danger"
          onClick={async () => {
            await window.api.logoutWebAutomation();
            await refresh();
          }}
        >
          Web Oturumunu Kapat
        </button>
      </div>
    </div>
  );
}
