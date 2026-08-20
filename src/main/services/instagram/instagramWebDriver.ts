import type { WebErrorCode, WebSessionStatus } from "@shared/constants";

export interface WebActionSuccess {
  ok: true;
  status: "success" | "already_following" | "already_unfollowed";
  profileUrl: string;
}

export interface WebActionFailure {
  ok: false;
  code: WebErrorCode;
  message: string;
  profileUrl?: string;
}

export type WebActionOutcome = WebActionSuccess | WebActionFailure;

export interface InstagramWebDriver {
  getSessionStatus(): Promise<WebSessionStatus>;
  openLoginWindow(): Promise<WebSessionStatus>;
  checkSession(): Promise<WebSessionStatus>;
  logout(): Promise<WebSessionStatus>;
  follow(username: string): Promise<WebActionOutcome>;
  unfollow(username: string): Promise<WebActionOutcome>;
}

export const WEB_ERROR_MESSAGES: Record<WebErrorCode, string> = {
  user_not_found: "Kullanıcı bulunamadı",
  profile_unavailable: "Profil açılamadı",
  login_required: "Instagram giriş gerekiyor",
  session_expired: "Oturum süresi doldu",
  security_check_required: "Güvenlik doğrulaması gerekiyor",
  captcha_required: "CAPTCHA gerekiyor",
  temporary_error: "Instagram geçici hata verdi",
  failed: "İşlem başarısız",
  stopped: "Kullanıcı otomasyonu durdurdu"
};
