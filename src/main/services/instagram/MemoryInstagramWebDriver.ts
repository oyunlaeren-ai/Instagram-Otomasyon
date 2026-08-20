import type { WebListType, WebSessionStatus } from "@shared/constants";
import type {
  InstagramWebDriver,
  WebActionOutcome,
  WebListCollectOptions,
  WebListCollectResult
} from "./instagramWebDriver";
import { WEB_ERROR_MESSAGES } from "./instagramWebDriver";

export interface MemoryWebProfile {
  exists?: boolean;
  following?: boolean;
  captcha?: boolean;
  challenge?: boolean;
  temporaryError?: boolean;
  listHidden?: boolean;
  followers?: string[];
  followingList?: string[];
}

export class MemoryInstagramWebDriver implements InstagramWebDriver {
  session: WebSessionStatus = "disconnected";
  profiles = new Map<string, MemoryWebProfile>();
  followCalls: string[] = [];
  unfollowCalls: string[] = [];
  lastOpenedUrl: string | null = null;
  actionDelayMs = 0;
  pageSize = 2;
  scrollRounds = 0;

  setProfile(username: string, profile: MemoryWebProfile): void {
    this.profiles.set(username.replace(/^@/, "").toLowerCase(), profile);
  }

  async getSessionStatus(): Promise<WebSessionStatus> {
    return this.session;
  }

  async openLoginWindow(): Promise<WebSessionStatus> {
    this.lastOpenedUrl = "https://www.instagram.com/accounts/login/";
    if (this.session === "connected") {
      return this.session;
    }
    this.session = "login_required";
    return this.session;
  }

  async checkSession(): Promise<WebSessionStatus> {
    return this.session;
  }

  async logout(): Promise<WebSessionStatus> {
    this.session = "disconnected";
    return this.session;
  }

  completeLogin(): void {
    this.session = "connected";
  }

  expireSession(): void {
    this.session = "expired";
  }

  async follow(username: string): Promise<WebActionOutcome> {
    if (this.actionDelayMs > 0) {
      await delay(this.actionDelayMs);
    }
    return this.perform(username, "follow");
  }

  async unfollow(username: string): Promise<WebActionOutcome> {
    if (this.actionDelayMs > 0) {
      await delay(this.actionDelayMs);
    }
    return this.perform(username, "unfollow");
  }

  private perform(username: string, action: "follow" | "unfollow"): WebActionOutcome {
    const key = username.replace(/^@/, "").toLowerCase();
    const profileUrl = `https://www.instagram.com/${key}/`;
    this.lastOpenedUrl = profileUrl;
    if (action === "follow") {
      this.followCalls.push(key);
    } else {
      this.unfollowCalls.push(key);
    }

    if (this.session === "disconnected" || this.session === "login_required") {
      return { ok: false, code: "login_required", message: WEB_ERROR_MESSAGES.login_required };
    }
    if (this.session === "expired") {
      return { ok: false, code: "session_expired", message: WEB_ERROR_MESSAGES.session_expired };
    }
    if (this.session === "security_check") {
      return {
        ok: false,
        code: "security_check_required",
        message: WEB_ERROR_MESSAGES.security_check_required
      };
    }

    const profile = this.profiles.get(key) ?? { exists: true, following: false };
    if (profile.captcha) {
      this.session = "security_check";
      return { ok: false, code: "captcha_required", message: WEB_ERROR_MESSAGES.captcha_required, profileUrl };
    }
    if (profile.challenge) {
      this.session = "security_check";
      return {
        ok: false,
        code: "security_check_required",
        message: WEB_ERROR_MESSAGES.security_check_required,
        profileUrl
      };
    }
    if (profile.temporaryError) {
      return { ok: false, code: "temporary_error", message: WEB_ERROR_MESSAGES.temporary_error, profileUrl };
    }
    if (profile.exists === false) {
      return { ok: false, code: "user_not_found", message: WEB_ERROR_MESSAGES.user_not_found, profileUrl };
    }

    if (action === "follow") {
      if (profile.following) {
        return { ok: true, status: "already_following", profileUrl };
      }
      profile.following = true;
      this.profiles.set(key, profile);
      return { ok: true, status: "success", profileUrl };
    }

    if (!profile.following) {
      return { ok: true, status: "already_unfollowed", profileUrl };
    }
    profile.following = false;
    this.profiles.set(key, profile);
    return { ok: true, status: "success", profileUrl };
  }

  async collectRelationshipList(
    username: string,
    listType: WebListType,
    options: WebListCollectOptions
  ): Promise<WebListCollectResult> {
    const key = username.replace(/^@/, "").toLowerCase();
    this.lastOpenedUrl = `https://www.instagram.com/${key}/`;
    options.onProgress({ phase: "preparing", collected: 0, message: "Hazırlanıyor..." });
    if (this.session === "disconnected" || this.session === "login_required") {
      return { ok: false, usernames: [], code: "login_required", message: WEB_ERROR_MESSAGES.login_required };
    }
    if (this.session === "expired") {
      return { ok: false, usernames: [], code: "session_expired", message: WEB_ERROR_MESSAGES.session_expired };
    }
    if (this.session === "security_check") {
      return {
        ok: false,
        usernames: [],
        code: "security_check_required",
        message: WEB_ERROR_MESSAGES.security_check_required
      };
    }
    options.onProgress({ phase: "opening_profile", collected: 0, message: "Profil açılıyor..." });
    const profile = this.profiles.get(key) ?? { exists: true };
    if (profile.captcha) {
      this.session = "security_check";
      return { ok: false, usernames: [], code: "captcha_required", message: WEB_ERROR_MESSAGES.captcha_required };
    }
    if (profile.challenge) {
      this.session = "security_check";
      return {
        ok: false,
        usernames: [],
        code: "security_check_required",
        message: WEB_ERROR_MESSAGES.security_check_required
      };
    }
    if (profile.exists === false) {
      return { ok: false, usernames: [], code: "user_not_found", message: WEB_ERROR_MESSAGES.user_not_found };
    }
    if (profile.listHidden) {
      return { ok: false, usernames: [], code: "list_unavailable", message: WEB_ERROR_MESSAGES.list_unavailable };
    }
    options.onProgress({ phase: "opening_list", collected: 0, message: "Liste açılıyor..." });
    const raw = listType === "FOLLOWERS" ? profile.followers ?? [] : profile.followingList ?? [];
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const name of raw) {
      const cleaned = name.replace(/^@/, "").toLowerCase();
      if (!cleaned || seen.has(cleaned)) {
        continue;
      }
      seen.add(cleaned);
      unique.push(cleaned);
    }
    const collected: string[] = [];
    const pageSize = options.pageSize ?? this.pageSize;
    this.scrollRounds = 0;
    for (let index = 0; index < unique.length; index += pageSize) {
      if (options.shouldStop()) {
        return { ok: false, usernames: collected, code: "stopped", message: WEB_ERROR_MESSAGES.stopped };
      }
      collected.push(...unique.slice(index, index + pageSize));
      this.scrollRounds += 1;
      options.onProgress({
        phase: "loading_users",
        collected: collected.length,
        message: `${collected.length} kullanıcı bulundu.`
      });
    }
    options.onProgress({
      phase: "completed",
      collected: collected.length,
      message: collected.length ? `${collected.length} kullanıcı bulundu.` : "Tamamlandı."
    });
    return { ok: true, usernames: collected };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
