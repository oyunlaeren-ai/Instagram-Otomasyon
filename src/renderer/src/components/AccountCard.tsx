import { useState } from "react";
import { useAppStore } from "../stores/appStore";

export function AccountCard() {
  const connection = useAppStore((state) => state.connection);
  const refresh = useAppStore((state) => state.refresh);
  const pushToast = useAppStore((state) => state.pushToast);
  const [connecting, setConnecting] = useState(false);
  const username = connection.connected
    ? (connection.profile?.username ?? connection.account?.username)
    : null;
  const picture = connection.connected
    ? (connection.profile?.profilePicture ?? connection.account?.profilePicture)
    : null;

  async function connect() {
    if (connecting) {
      return;
    }
    setConnecting(true);
    try {
      await window.api.connectAccount();
      await refresh();
      pushToast("success", "Instagram hesabı bağlandı.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Bağlantı başarısız.");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    try {
      await window.api.disconnectAccount();
      await refresh();
      pushToast("info", "Instagram bağlantısı kesildi.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Bağlantı kesilemedi.");
    }
  }

  async function refreshAccount() {
    try {
      await window.api.refreshAccount();
      await refresh();
      pushToast("success", "Hesap bilgileri yenilendi.");
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Yenileme başarısız.");
    }
  }

  return (
    <article className="card">
      <div className="card-body account-card">
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {picture ? <img className="avatar" src={picture} alt="" /> : <div className="avatar" />}
          <div>
            <div className="stat-label">Instagram</div>
            <strong>{username ? `@${username}` : "Hesap bağlı değil"}</strong>
            <div className="hint">
              <span className={`dot ${connection.connected ? "on" : "off"}`} />{" "}
              {connection.connected ? "Instagram hesabı bağlı" : "Bağlı değil"}
            </div>
          </div>
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          {connection.connected ? (
            <>
              <button className="btn" onClick={() => void refreshAccount()}>
                Yenile
              </button>
              <button className="btn danger" onClick={() => void disconnect()}>
                Bağlantıyı Kes
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={() => void connect()} disabled={connecting}>
              {connecting ? "Instagram'a bağlanılıyor..." : "Instagram Hesabı Bağla"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
