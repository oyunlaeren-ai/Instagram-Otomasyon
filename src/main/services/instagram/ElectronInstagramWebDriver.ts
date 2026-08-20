import { BrowserWindow, session } from "electron";
import type { WebListType, WebSessionStatus } from "@shared/constants";
import { createLogger } from "../logging/logger";
import type {
  InstagramWebDriver,
  WebActionOutcome,
  WebListCollectOptions,
  WebListCollectResult
} from "./instagramWebDriver";
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

  async collectRelationshipList(
    username: string,
    listType: WebListType,
    options: WebListCollectOptions
  ): Promise<WebListCollectResult> {
    const key = username.replace(/^@/, "").toLowerCase();
    const profileUrl = `https://www.instagram.com/${encodeURIComponent(key)}/`;
    const maxUsers = options.maxUsers ?? 5000;
    const idleRounds = options.idleRounds ?? 4;
    const scrollDelayMs = options.scrollDelayMs ?? 900;
    const timeoutMs = options.timeoutMs ?? 180_000;
    const started = Date.now();

    options.onProgress({ phase: "preparing", collected: 0, message: "Hazırlanıyor..." });
    const sessionStatus = await this.inspectSession();
    if (sessionStatus === "disconnected" || sessionStatus === "login_required") {
      return { ok: false, usernames: [], code: "login_required", message: WEB_ERROR_MESSAGES.login_required };
    }
    if (sessionStatus === "expired") {
      return { ok: false, usernames: [], code: "session_expired", message: WEB_ERROR_MESSAGES.session_expired };
    }
    if (sessionStatus === "security_check") {
      return {
        ok: false,
        usernames: [],
        code: "security_check_required",
        message: WEB_ERROR_MESSAGES.security_check_required
      };
    }

    const window = this.ensureWindow();
    options.onProgress({ phase: "opening_profile", collected: 0, message: "Profil açılıyor..." });
    try {
      await this.load(window, profileUrl);
    } catch {
      return { ok: false, usernames: [], code: "profile_unavailable", message: WEB_ERROR_MESSAGES.profile_unavailable };
    }
    const inspection = await this.inspectPage(window);
    const blocked = this.mapInspectionError(inspection, profileUrl);
    if (blocked && !blocked.ok) {
      return { ok: false, usernames: [], code: blocked.code, message: blocked.message };
    }
    const header = (inspection.headerUsername ?? "").replace(/^@/, "").toLowerCase();
    if (header && header !== key) {
      return { ok: false, usernames: [], code: "user_not_found", message: WEB_ERROR_MESSAGES.user_not_found };
    }

    options.onProgress({ phase: "opening_list", collected: 0, message: "Liste açılıyor..." });
    const opened = await this.openRelationshipList(window, key, listType);
    if (!opened) {
      return { ok: false, usernames: [], code: "list_unavailable", message: WEB_ERROR_MESSAGES.list_unavailable };
    }

    const unique = new Set<string>();
    let idle = 0;
    while (Date.now() - started < timeoutMs && unique.size < maxUsers) {
      if (options.shouldStop()) {
        return { ok: false, usernames: [...unique], code: "stopped", message: WEB_ERROR_MESSAGES.stopped };
      }
      const page = await this.inspectPage(window);
      const pageBlocked = this.mapInspectionError(page, profileUrl);
      if (pageBlocked && !pageBlocked.ok) {
        return { ok: false, usernames: [...unique], code: pageBlocked.code, message: pageBlocked.message };
      }
      const names = await this.readDialogUsernames(window);
      const before = unique.size;
      for (const name of names) {
        unique.add(name);
      }
      options.onProgress({
        phase: "loading_users",
        collected: unique.size,
        message: `${unique.size} kullanıcı bulundu.`
      });
      if (unique.size === before) {
        idle += 1;
        if (idle >= idleRounds) {
          break;
        }
      } else {
        idle = 0;
      }
      await this.scrollListDialog(window);
      if (scrollDelayMs > 0) {
        await delay(scrollDelayMs);
      }
    }

    options.onProgress({
      phase: "completed",
      collected: unique.size,
      message: "Tamamlandı."
    });
    return { ok: true, usernames: [...unique] };
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

  private async openRelationshipList(
    window: BrowserWindow,
    username: string,
    listType: WebListType
  ): Promise<boolean> {
    const part = listType === "FOLLOWING" ? "/following/" : "/followers/";
    await this.clickHrefContaining(window, part);
    await delay(800);
    if (await this.dialogIsOpen(window)) {
      return true;
    }
    try {
      await this.load(window, `https://www.instagram.com/${encodeURIComponent(username)}${part}`);
    } catch {
      return false;
    }
    await delay(800);
    return this.dialogIsOpen(window);
  }

  private async clickHrefContaining(window: BrowserWindow, part: string): Promise<boolean> {
    try {
      return Boolean(
        await window.webContents.executeJavaScript(`
          (() => {
            const part = ${JSON.stringify(part)};
            const links = [...document.querySelectorAll("a[href]")];
            const match = links.find((a) => {
              const href = a.getAttribute("href") || "";
              return href.includes(part) && !href.includes("/accounts/");
            });
            if (!match) return false;
            match.click();
            return true;
          })()
        `)
      );
    } catch {
      return false;
    }
  }

  private async dialogIsOpen(window: BrowserWindow): Promise<boolean> {
    try {
      return Boolean(
        await window.webContents.executeJavaScript(`Boolean(document.querySelector('div[role="dialog"]'))`)
      );
    } catch {
      return false;
    }
  }

  private async readDialogUsernames(window: BrowserWindow): Promise<string[]> {
    try {
      const names = (await window.webContents.executeJavaScript(`
        (() => {
          const dialog = document.querySelector('div[role="dialog"]');
          if (!dialog) return [];
          const skip = new Set(["accounts","p","reel","reels","stories","explore","direct","legal","about"]);
          const found = [];
          for (const link of dialog.querySelectorAll("a[href]")) {
            const href = link.getAttribute("href") || "";
            const match = href.match(/^\\/([A-Za-z0-9._]{1,30})\\/?$/);
            if (!match) continue;
            const username = match[1].toLowerCase();
            if (skip.has(username)) continue;
            found.push(username);
          }
          return found;
        })()
      `)) as string[];
      return Array.isArray(names) ? names : [];
    } catch {
      return [];
    }
  }

  private async scrollListDialog(window: BrowserWindow): Promise<void> {
    try {
      await window.webContents.executeJavaScript(`
        (() => {
          const dialog = document.querySelector('div[role="dialog"]');
          if (!dialog) return false;
          const nodes = [dialog, ...dialog.querySelectorAll("div")];
          const scroller = nodes.find((el) => el.scrollHeight > el.clientHeight + 20);
          if (!scroller) return false;
          scroller.scrollTop = scroller.scrollHeight;
          return true;
        })()
      `);
    } catch {
      return;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
