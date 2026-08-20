import { useEffect, useState } from "react";
import type { AppSettings } from "@shared/types";
import { useAppStore } from "../stores/appStore";

export function AutomationPage() {
  const automation = useAppStore((state) => state.automation);
  const refresh = useAppStore((state) => state.refresh);
  const pushToast = useAppStore((state) => state.pushToast);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    void window.api.getAutomationSettings().then(setSettings);
  }, []);

  if (!settings) {
    return <section className="page">Yükleniyor...</section>;
  }

  const percent = automation.total === 0 ? 0 : Math.round((automation.processed / automation.total) * 100);

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h2>Otomasyon</h2>
          <p>Limitler, çalışma saatleri ve canlı kuyruk kontrolü.</p>
        </div>
      </div>
      <div className="grid two-col">
        <article className="card">
          <div className="card-body grid form-grid">
            <div className="field">
              <label>Günlük maksimum takip</label>
              <input
                className="input"
                type="number"
                value={settings.dailyFollowLimit}
                onChange={(event) => setSettings({ ...settings, dailyFollowLimit: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label>Günlük maksimum takipten çıkarma</label>
              <input
                className="input"
                type="number"
                value={settings.dailyUnfollowLimit}
                onChange={(event) => setSettings({ ...settings, dailyUnfollowLimit: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label>İşlemler arası bekleme (saniye)</label>
              <input
                className="input"
                type="number"
                value={settings.actionDelaySeconds}
                onChange={(event) => setSettings({ ...settings, actionDelaySeconds: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label>Çalışma başlangıcı</label>
              <input
                className="input"
                type="time"
                value={settings.workStart}
                onChange={(event) => setSettings({ ...settings, workStart: event.target.value })}
              />
            </div>
            <div className="field">
              <label>Çalışma bitişi</label>
              <input
                className="input"
                type="time"
                value={settings.workEnd}
                onChange={(event) => setSettings({ ...settings, workEnd: event.target.value })}
              />
            </div>
            <div>
              <button
                className="btn primary"
                onClick={async () => {
                  const saved = await window.api.saveAutomationSettings(settings);
                  setSettings(saved);
                  pushToast("success", "Ayarlar kaydedildi.");
                }}
              >
                Ayarları kaydet
              </button>
            </div>
          </div>
        </article>
        <article className="card">
          <div className="card-body">
            <div className="stat-label">Durum</div>
            <h3>{automation.running ? "Çalışıyor" : automation.paused ? "Duraklatıldı" : "Durduruldu"}</h3>
            <p>İşlenen: {automation.processed} / {automation.total}</p>
            <p>Başarılı: {automation.success}</p>
            <p>Başarısız: {automation.failed}</p>
            <p>Desteklenmeyen: {automation.unsupported}</p>
            <p>Bekleyen: {automation.pending}</p>
            <div className="progress">
              <span style={{ width: `${percent}%` }} />
            </div>
            {automation.currentUsername ? (
              <div className="hint">
                Son işlem: @{automation.currentUsername} {automation.lastAction ?? ""} 
              </div>
            ) : null}
            {automation.lastError ? <div className="hint">{automation.lastError}</div> : null}
            <div className="toolbar" style={{ marginTop: 18 }}>
              <button
                className="btn success xl"
                onClick={async () => {
                  const status = await window.api.startAutomation();
                  await refresh();
                  if (status.lastError && !status.running) {
                    pushToast("error", status.lastError);
                  }
                }}
              >
                BAŞLAT
              </button>
              <button
                className="btn danger xl"
                onClick={async () => {
                  await window.api.stopAutomation();
                  await refresh();
                }}
              >
                DURDUR
              </button>
              <button className="btn xl" onClick={async () => { await window.api.resumeAutomation(); await refresh(); }}>
                DEVAM ET
              </button>
              <button className="btn xl" onClick={async () => { await window.api.clearQueue(); await refresh(); }}>
                KUYRUĞU TEMİZLE
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
