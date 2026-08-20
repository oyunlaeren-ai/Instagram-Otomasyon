import { create } from "zustand";
import type {
  AppSettings,
  AutomationRuntimeStatus,
  ConnectionSnapshot,
  DashboardStats,
  WebAutomationRuntimeStatus
} from "@shared/types";

const defaultSettings: AppSettings = {
  theme: "dark",
  notifications: true,
  language: "tr",
  dailyFollowLimit: 20,
  dailyUnfollowLimit: 20,
  actionDelaySeconds: 60,
  workStart: "09:00",
  workEnd: "23:00",
  onboardingCompleted: false
};

const defaultStatus: AutomationRuntimeStatus = {
  running: false,
  paused: false,
  outsideSchedule: false,
  processed: 0,
  total: 0,
  success: 0,
  failed: 0,
  unsupported: 0,
  pending: 0,
  currentUsername: null,
  lastAction: null,
  lastError: null,
  interrupted: false
};

const defaultWebStatus: WebAutomationRuntimeStatus = {
  running: false,
  paused: false,
  session: {
    status: "disconnected",
    connected: false,
    instagramUsername: null,
    lastCheckedAt: null,
    lastError: null,
    message: "Bağlı değil"
  },
  action: null,
  processed: 0,
  total: 0,
  success: 0,
  alreadyFollowing: 0,
  alreadyUnfollowed: 0,
  failed: 0,
  pending: 0,
  currentUsername: null,
  lastError: null,
  interrupted: false
};

const defaultConnection: ConnectionSnapshot = {
  connected: false,
  provider: "official",
  account: null,
  profile: null,
  followSupported: false,
  unfollowSupported: false,
  followersListSupported: false,
  followingListSupported: false,
  capabilities: {
    canGetProfile: true,
    canGetFollowers: false,
    canGetFollowing: false,
    canFollow: false,
    canUnfollow: false
  },
  message: null
};

interface ToastItem {
  id: number;
  type: "info" | "success" | "error";
  message: string;
}

interface AppState {
  settings: AppSettings;
  connection: ConnectionSnapshot;
  automation: AutomationRuntimeStatus;
  webAutomation: WebAutomationRuntimeStatus;
  stats: DashboardStats | null;
  version: string;
  loading: boolean;
  error: string | null;
  toasts: ToastItem[];
  bootstrap: () => Promise<void>;
  refresh: () => Promise<void>;
  setSettings: (settings: AppSettings) => void;
  pushToast: (type: ToastItem["type"], message: string) => void;
  dismissToast: (id: number) => void;
}

let toastId = 1;

export const useAppStore = create<AppState>((set, get) => ({
  settings: defaultSettings,
  connection: defaultConnection,
  automation: defaultStatus,
  webAutomation: defaultWebStatus,
  stats: null,
  version: "1.0.0",
  loading: true,
  error: null,
  toasts: [],
  bootstrap: async () => {
    if (!window.api) {
      console.error("[Renderer] window.api missing — preload failed");
      set({
        loading: false,
        error: "Önyükleme köprüsü yüklenemedi. Uygulama sınırlı görünümde açıldı."
      });
      return;
    }
    window.api.onAutomationStatus((automation) => set({ automation }));
    window.api.onWebAutomationStatus((webAutomation) => set({ webAutomation }));
    window.api.onToast((payload) => get().pushToast(payload.type, payload.message));
    await get().refresh();
  },
  refresh: async () => {
    if (!window.api) {
      set({
        loading: false,
        error: "Önyükleme köprüsü yüklenemedi. Uygulama sınırlı görünümde açıldı."
      });
      return;
    }
    try {
      const [settings, connection, automation, webAutomation, stats, version] = await Promise.all([
        window.api.getSettings(),
        window.api.getConnectionStatus(),
        window.api.getAutomationStatus(),
        window.api.getWebAutomationStatus(),
        window.api.getDashboardStats(),
        window.api.getAppVersion()
      ]);
      set({ settings, connection, automation, webAutomation, stats, version, loading: false, error: null });
    } catch {
      set({
        loading: false,
        error: "İşlem sırasında beklenmeyen bir hata oluştu. Lütfen tekrar deneyin."
      });
    }
  },
  setSettings: (settings) => set({ settings }),
  pushToast: (type, message) => {
    if (!get().settings.notifications && type === "info") {
      return;
    }
    const id = toastId++;
    set((state) => ({ toasts: [...state.toasts, { id, type, message }] }));
    window.setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }))
}));
