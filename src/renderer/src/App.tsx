import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./layout/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { FollowPage } from "./pages/FollowPage";
import { UnfollowPage } from "./pages/UnfollowPage";
import { NonFollowersPage } from "./pages/NonFollowersPage";
import { ListsPage } from "./pages/ListsPage";
import { AutomationPage } from "./pages/AutomationPage";
import { HistoryPage } from "./pages/HistoryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ToastStack } from "./components/ToastStack";
import { Modal } from "./components/Ui";
import { useAppStore } from "./stores/appStore";

export default function App() {
  const bootstrap = useAppStore((state) => state.bootstrap);
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  const automation = useAppStore((state) => state.automation);
  const webAutomation = useAppStore((state) => state.webAutomation);
  const refresh = useAppStore((state) => state.refresh);
  const [step, setStep] = useState(0);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const resolved =
      settings.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : settings.theme;
    document.documentElement.dataset.theme = resolved;
  }, [settings.theme]);

  return (
    <>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/follow" element={<FollowPage />} />
          <Route path="/unfollow" element={<UnfollowPage />} />
          <Route path="/non-followers" element={<NonFollowersPage />} />
          <Route path="/lists" element={<ListsPage />} />
          <Route path="/automation" element={<AutomationPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <ToastStack />
      {!settings.onboardingCompleted ? (
        <Modal title="Kurulum" onClose={() => undefined}>
          {step === 0 ? <p>Instagram Automation Manager’a hoş geldiniz.</p> : null}
          {step === 1 ? <p>Ayarlar’dan Instagram hesabınızı resmi OAuth ile bağlayabilirsiniz.</p> : null}
          {step === 2 ? <p>Günlük limitleri ve çalışma saatlerini Otomasyon sayfasından ayarlayın.</p> : null}
          {step === 3 ? <p>Hazırsınız. Ayarlar’dan Instagram hesabınızı bağlayabilirsiniz.</p> : null}
          <div className="toolbar">
            <button
              className="btn"
              onClick={async () => {
                const saved = await window.api.saveSettings({ ...settings, onboardingCompleted: true });
                setSettings(saved);
              }}
            >
              Atla
            </button>
            {step < 3 ? (
              <button className="btn primary" onClick={() => setStep((value) => value + 1)}>
                İleri
              </button>
            ) : (
              <button
                className="btn primary"
                onClick={async () => {
                  const saved = await window.api.saveSettings({ ...settings, onboardingCompleted: true });
                  setSettings(saved);
                }}
              >
                Başla
              </button>
            )}
          </div>
        </Modal>
      ) : null}
      {settings.onboardingCompleted && webAutomation.interrupted && !webAutomation.running ? (
        <Modal title="Önceki otomasyon yarım kaldı." onClose={() => undefined}>
          <p>Uygulama kapanmadan önce tamamlanmamış web otomasyon işleri vardı. Otomasyon kendiliğinden başlamaz.</p>
          <div className="toolbar">
            <button
              className="btn success"
              onClick={async () => {
                await window.api.resumeWebAutomation();
                await refresh();
              }}
            >
              Devam Et
            </button>
            <button
              className="btn"
              onClick={async () => {
                await window.api.restartWebAutomation();
                await refresh();
              }}
            >
              Baştan Başlat
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                await window.api.stopWebAutomation();
                await refresh();
              }}
            >
              Durdur
            </button>
          </div>
        </Modal>
      ) : null}
      {settings.onboardingCompleted && automation.interrupted && !automation.running ? (
        <Modal title="Devam eden bir otomasyon bulundu." onClose={() => undefined}>
          <p>Uygulama kapanmadan önce tamamlanmamış işler vardı. Otomasyon kendiliğinden başlamaz.</p>
          <div className="toolbar">
            <button
              className="btn success"
              onClick={async () => {
                await window.api.resumeAutomation();
                await refresh();
              }}
            >
              Devam Et
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                await window.api.cancelInterrupted();
                await refresh();
              }}
            >
              İptal Et
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
