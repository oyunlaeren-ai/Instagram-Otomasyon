import { BrowserWindow, session } from "electron";
import type { WebSessionStatus } from "@shared/constants";
import { createLogger } from "../logging/logger";
import type { InstagramWebDriver, WebActionOutcome } from "./instagramWebDriver";
import { WEB_ERROR_MESSAGES } from "./instagramWebDriver";

const log = createLogger("[WebAutomation]");
const PARTITION = "persist:instagram-web";
const LOGIN_URL = "https://www.instagram.com/accounts/login/";

interface PageInspection {
  kind:
    | "ok"
    | "login_required"
    | "not_found"
    | "captcha"
    | "security_challenge"
    | "temporary_error"
    | "unknown";
  following?: boolean;
  canFollow?: boolean;
  headerUsername?: string;
  href?: string;
}

export class ElectronInstagramWebDriver implements InstagramWebDriver {
  private window: BrowserWindow | null = null;

  private partitionSession() {
    return session.fromPartition(PARTITION);
  }

  async getSessionStatus(): Promise<WebSessionStatus> {
    return this.inspectSession();
  }

  async openLoginWindow(): Promise<WebSessionStatus> {
    const window = this.ensureWindow();
    await this.load(window, LOGIN_URL);
    const status = await this.inspectSession();
    if (status === "connected") {
      return status;
    }
    return "login_required";
  }

  async checkSession(): Promise<WebSessionStatus> {
    const window = this.ensureWindow();
    await this.load(window, "https://www.instagram.com/");
    return this.inspectSession();
  }

  async logout(): Promise<WebSessionStatus> {
    await this.partitionSession().clearStorageData();
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = null;
    log.info("Web session storage cleared");
    return "disconnected";
  }

  async follow(username: string): Promise<WebActionOutcome> {
    return this.runProfileAction(username, "follow");
  }

  async unfollow(username: string): Promise<WebActionOutcome> {
    return this.runProfileAction(username, "unfollow");
  }

  private async runProfileAction(username: string, action: "follow" | "unfollow"): Promise<WebActionOutcome> {
    const key = username.replace(/^@/, "").toLowerCase();
    const profileUrl = `https://www.instagram.com/${encodeURIComponent(key)}/`;
    const sessionStatus = await this.inspectSession();
    if (sessionStatus === "disconnected" || sessionStatus === "login_required") {
      return { ok: false, code: "login_required", message: WEB_ERROR_MESSAGES.login_required };
    }
    if (sessionStatus === "expired") {
      return { ok: false, code: "session_expired", message: WEB_ERROR_MESSAGES.session_expired };
    }
    if (sessionStatus === "security_check") {
      return {
        ok: false,
        code: "security_check_required",
        message: WEB_ERROR_MESSAGES.security_check_required
      };
    }

    const window = this.ensureWindow();
    try {
      await this.load(window, profileUrl);
    } catch {
      return { ok: false, code: "profile_unavailable", message: WEB_ERROR_MESSAGES.profile_unavailable, profileUrl };
    }

    const inspection = await this.inspectPage(window);
    const blocked = this.mapInspectionError(inspection, profileUrl);
    if (blocked) {
      return blocked;
    }

    const header = (inspection.headerUsername ?? "").replace(/^@/, "").toLowerCase();
    if (header && header !== key) {
      return { ok: false, code: "user_not_found", message: WEB_ERROR_MESSAGES.user_not_found, profileUrl };
    }

    if (action === "follow") {
      if (inspection.following) {
        return { ok: true, status: "already_following", profileUrl };
      }
      const clicked = await this.clickLabeledControl(window, ["follow", "takip et"]);
      if (!clicked) {
        return { ok: false, code: "failed", message: WEB_ERROR_MESSAGES.failed, profileUrl };
      }
      await delay(1500);
      const after = await this.inspectPage(window);
      const afterBlocked = this.mapInspectionError(after, profileUrl);
      if (afterBlocked) {
        return afterBlocked;
      }
      if (after.following) {
        return { ok: true, status: "success", profileUrl };
      }
      return { ok: false, code: "failed", message: WEB_ERROR_MESSAGES.failed, profileUrl };
    }

    if (!inspection.following) {
      return { ok: true, status: "already_unfollowed", profileUrl };
    }
    const opened = await this.clickLabeledControl(window, [
      "following",
      "requested",
      "takip ediliyor",
      "takiptesin",
      "istek gönderildi"
    ]);
    if (opened) {
      await delay(400);
      await this.clickLabeledControl(window, ["unfollow", "takibi bırak", "takipten çık"]);
    }
    await delay(1500);
    const after = await this.inspectPage(window);
    const afterBlocked = this.mapInspectionError(after, profileUrl);
    if (afterBlocked) {
      return afterBlocked;
    }
    if (!after.following) {
      return { ok: true, status: "success", profileUrl };
    }
    return { ok: false, code: "failed", message: WEB_ERROR_MESSAGES.failed, profileUrl };
  }

  private mapInspectionError(inspection: PageInspection, profileUrl: string): WebActionOutcome | null {
    if (inspection.kind === "login_required") {
      return { ok: false, code: "login_required", message: WEB_ERROR_MESSAGES.login_required, profileUrl };
    }
    if (inspection.kind === "captcha") {
      return { ok: false, code: "captcha_required", message: WEB_ERROR_MESSAGES.captcha_required, profileUrl };
    }
    if (inspection.kind === "security_challenge") {
      return {
        ok: false,
        code: "security_check_required",
        message: WEB_ERROR_MESSAGES.security_check_required,
        profileUrl
      };
    }
    if (inspection.kind === "not_found") {
      return { ok: false, code: "user_not_found", message: WEB_ERROR_MESSAGES.user_not_found, profileUrl };
    }
    if (inspection.kind === "temporary_error") {
      return { ok: false, code: "temporary_error", message: WEB_ERROR_MESSAGES.temporary_error, profileUrl };
    }
    return null;
  }

  private async inspectSession(): Promise<WebSessionStatus> {
    try {
      const cookies = await this.partitionSession().cookies.get({ domain: ".instagram.com" });
      const hasSession = cookies.some((cookie) => cookie.name === "sessionid" && Boolean(cookie.value));
      if (!hasSession) {
        return "disconnected";
      }
      if (this.window && !this.window.isDestroyed()) {
        const inspection = await this.inspectPage(this.window);
        if (inspection.kind === "captcha" || inspection.kind === "security_challenge") {
          return "security_check";
        }
        if (inspection.kind === "login_required") {
          return "expired";
        }
      }
      return "connected";
    } catch {
      return "disconnected";
    }
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }
    this.window = new BrowserWindow({
      width: 1100,
      height: 820,
      title: "Instagram Web Otomasyonu",
      autoHideMenuBar: true,
      webPreferences: {
        partition: PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    this.window.on("closed", () => {
      this.window = null;
    });
    return this.window;
  }

  private load(window: BrowserWindow, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 30000);
      window.webContents.once("did-finish-load", () => {
        clearTimeout(timeout);
        resolve();
      });
      window.webContents.once("did-fail-load", (_event, _code, description) => {
        clearTimeout(timeout);
        reject(new Error(description));
      });
      void window.loadURL(url);
    });
  }

  private async inspectPage(window: BrowserWindow): Promise<PageInspection> {
    try {
      const result = (await window.webContents.executeJavaScript(`
        (() => {
          const href = location.href || "";
          const text = (document.body && document.body.innerText ? document.body.innerText : "").slice(0, 5000);
          const lower = text.toLowerCase();
          if (document.querySelector('[id*="recaptcha"], iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"]')) {
            return { kind: "captcha", href };
          }
          if (/checkpoint|challenge|suspicious login|confirm you.re human|iki adımlı|two-factor|2fa/.test(lower)
            || href.includes("/challenge/") || href.includes("/accounts/login/two_factor")) {
            return { kind: "security_challenge", href };
          }
          if (href.includes("/accounts/login")) {
            return { kind: "login_required", href };
          }
          if (/sorry, this page isn.t available|this page isn't available|sayfa bulunamadı|kullanıcı bulunamadı/.test(lower)) {
            return { kind: "not_found", href };
          }
          if (/try again later|please wait a few minutes|bir sorun oluştu/.test(lower)) {
            return { kind: "temporary_error", href };
          }
          const labels = [...document.querySelectorAll("button, div[role='button']")].map((el) =>
            (el.innerText || "").trim().toLowerCase()
          );
          const following = labels.some((label) =>
            /^(following|requested|takip ediliyor|takiptesin|istek gönderildi)$/.test(label)
          );
          const canFollow = labels.some((label) => /^(follow|takip et)$/.test(label));
          const header = document.querySelector("header h2, header h1, header span");
          return {
            kind: "ok",
            following,
            canFollow,
            headerUsername: header ? header.textContent : "",
            href
          };
        })()
      `)) as PageInspection;
      return result;
    } catch {
      return { kind: "unknown" };
    }
  }

  private async clickLabeledControl(window: BrowserWindow, labels: string[]): Promise<boolean> {
    const needle = labels.map((label) => label.toLowerCase());
    try {
      const clicked = (await window.webContents.executeJavaScript(`
        (() => {
          const wanted = ${JSON.stringify(needle)};
          const nodes = [...document.querySelectorAll("button, div[role='button']")];
          const match = nodes.find((el) => wanted.includes((el.innerText || "").trim().toLowerCase()));
          if (!match) return false;
          match.click();
          return true;
        })()
      `)) as boolean;
      return Boolean(clicked);
    } catch {
      return false;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
