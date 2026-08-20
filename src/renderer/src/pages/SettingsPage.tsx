import { useState } from "react";
import { useAppStore } from "../stores/appStore";
import { AccountCard } from "../components/AccountCard";
import { Modal } from "../components/Ui";

export function SettingsPage() {
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  const pushToast = useAppStore((state) => state.pushToast);
  const refresh = useAppStore((state) => state.refresh);
  const version = useAppStore((state) => state.version);
  const [resetStep, setResetStep] = useState(0);

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h2>Ayarlar</h2>
          <p>Hesap, otomasyon, bildirim, görünüm ve veri yönetimi.</p>
        </div>
      </div>

      <h3>Hesap</h3>
      <AccountCard />

      <div className="grid two-col" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="card-body grid">
            <h3>Görünüm</h3>
            <div className="field">
              <label>Tema</label>
              <select
                className="select"
                value={settings.theme}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    theme: event.target.value === "light" ? "light" : event.target.value === "system" ? "system" : "dark"
                  })
                }
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </div>
            <div className="field">
              <label>Dil</label>
              <select
                className="select"
                value={settings.language}
                onChange={(event) => setSettings({ ...settings, language: event.target.value === "en" ? "en" : "tr" })}
              >
                <option value="tr">Türkçe</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
        </article>
        <article className="card">
          <div className="card-body grid">
            <h3>Bildirimler</h3>
            <div className="field">
              <label>Masaüstü ve toast bildirimleri</label>
              <select
                className="select"
                value={settings.notifications ? "on" : "off"}
                onChange={(event) => setSettings({ ...settings, notifications: event.target.value === "on" })}
              >
                <option value="on">Açık</option>
                <option value="off">Kapalı</option>
              </select>
            </div>
          </div>
        </article>
        <article className="card">
          <div className="card-body grid form-grid">
            <h3 style={{ gridColumn: "1 / -1" }}>Otomasyon</h3>
            <div className="field">
              <label>Günlük takip limiti</label>
              <input
                className="input"
                type="number"
                value={settings.dailyFollowLimit}
                onChange={(event) => setSettings({ ...settings, dailyFollowLimit: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label>Günlük takipten çıkarma limiti</label>
              <input
                className="input"
                type="number"
                value={settings.dailyUnfollowLimit}
                onChange={(event) => setSettings({ ...settings, dailyUnfollowLimit: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label>İşlem arası bekleme</label>
              <input
                className="input"
                type="number"
                value={settings.actionDelaySeconds}
                onChange={(event) => setSettings({ ...settings, actionDelaySeconds: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label>Çalışma saatleri</label>
              <div className="toolbar" style={{ margin: 0 }}>
                <input
                  className="input"
                  type="time"
                  value={settings.workStart}
                  onChange={(event) => setSettings({ ...settings, workStart: event.target.value })}
                />
                <input
                  className="input"
                  type="time"
                  value={settings.workEnd}
                  onChange={(event) => setSettings({ ...settings, workEnd: event.target.value })}
                />
              </div>
            </div>
          </div>
        </article>
        <article className="card">
          <div className="card-body grid">
            <h3>Veri</h3>
            <div className="toolbar">
              <button
                className="btn"
                onClick={async () => {
                  const file = await window.api.backupDatabase();
                  if (file) {
                    pushToast("success", "Yedek alındı.");
                  }
                }}
              >
                Veritabanını Yedekle
              </button>
              <button
                className="btn"
                onClick={async () => {
                  if (!window.confirm("Yedek geri yüklensin mi? Mevcut yerel veri değişecek.")) {
                    return;
                  }
                  const restored = await window.api.restoreDatabase();
                  if (restored) {
                    await refresh();
                    pushToast("success", "Yedek geri yüklendi.");
                  }
                }}
              >
                Yedeği Geri Yükle
              </button>
              <button className="btn danger" onClick={() => setResetStep(1)}>
                Uygulama Verilerini Sıfırla
              </button>
            </div>
          </div>
        </article>
        <article className="card">
          <div className="card-body">
            <h3>Güvenlik</h3>
            <p className="hint">
              Token’lar işletim sistemi şifrelemesi ile saklanır. Instagram şifresi istenmez. Renderer Node.js
              erişimine sahip değildir.
            </p>
          </div>
        </article>
        <article className="card">
          <div className="card-body">
            <h3>Hakkında</h3>
            <p>Instagram Automation Manager</p>
            <p>Versiyon: v{version}</p>
          </div>
        </article>
      </div>
      <div className="toolbar">
        <button
          className="btn primary"
          onClick={async () => {
            const saved = await window.api.saveSettings(settings);
            setSettings(saved);
            pushToast("success", "Ayarlar kaydedildi.");
          }}
        >
          Kaydet
        </button>
      </div>
      {resetStep > 0 ? (
        <Modal title="Verileri sıfırla" onClose={() => setResetStep(0)}>
          {resetStep === 1 ? (
            <p>Bu işlem tüm yerel kullanıcı listelerini, queue’ları ve geçmişi silecektir.</p>
          ) : (
            <p>Onayı tekrarlayın. Bu işlem geri alınamaz.</p>
          )}
          <div className="toolbar">
            <button className="btn" onClick={() => setResetStep(0)}>
              Vazgeç
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                if (resetStep === 1) {
                  setResetStep(2);
                  return;
                }
                await window.api.resetData();
                await refresh();
                setResetStep(0);
                pushToast("info", "Uygulama verileri sıfırlandı.");
              }}
            >
              {resetStep === 1 ? "Devam" : "Silmeyi onayla"}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
