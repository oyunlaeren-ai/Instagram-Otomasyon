import { useAppStore } from "../stores/appStore";

export function TopBar() {
  const connection = useAppStore((state) => state.connection);
  const automation = useAppStore((state) => state.automation);
  const username = connection.profile?.username ?? connection.account?.username;

  return (
    <header className="topbar">
      <div>
        <strong>Instagram Automation Manager</strong>
      </div>
      <div className="top-meta">
        <div className="chip">
          <span className={`dot ${connection.connected ? "on" : "off"}`} />
          Instagram Hesabı: {connection.connected && username ? `@${username}` : "Bağlı değil"}
        </div>
        <div className="chip">
          <span className={`dot ${automation.running ? "on" : "off"}`} />
          Otomasyon: {automation.running ? "Çalışıyor" : automation.paused ? "Duraklatıldı" : "Durduruldu"}
        </div>
      </div>
    </header>
  );
}
