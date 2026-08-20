import type { ActionType, WebErrorCode, WebJobStatus } from "@shared/constants";
import type { WebAutomationJob, WebAutomationRuntimeStatus } from "@shared/types";
import { createLogger } from "../logging/logger";
import type { DatabaseService } from "../../database/DatabaseService";
import type { WebInstagramAutomationService } from "../instagram/WebInstagramAutomationService";
import { WEB_ERROR_MESSAGES } from "../instagram/instagramWebDriver";

const log = createLogger("[WebAutomation]");
const SECURITY_STOP_CODES: WebErrorCode[] = [
  "captcha_required",
  "security_check_required",
  "login_required",
  "session_expired"
];

export class WebAutomationEngine {
  private running = false;
  private paused = false;
  private stopRequested = false;
  private loopPromise: Promise<void> | null = null;
  private currentUsername: string | null = null;
  private lastError: string | null = null;
  private action: ActionType | null = null;
  private listeners = new Set<(status: WebAutomationRuntimeStatus) => void>();

  constructor(
    private readonly database: DatabaseService,
    private readonly web: WebInstagramAutomationService,
    private readonly getDelayMs: () => number = () => 0,
    private readonly notify: (message: string) => void = () => undefined
  ) {
    this.database.pauseWebProcessingJobs();
    if (this.database.hasUnfinishedWebJobs()) {
      this.database.setFlag("webQueueInterrupted", true);
    }
  }

  onStatus(listener: (status: WebAutomationRuntimeStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): WebAutomationRuntimeStatus {
    const counts = this.database.countWebJobsByStatus(this.action ?? undefined);
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return {
      running: this.running,
      paused: this.paused,
      session: this.database.getWebSessionSnapshot(),
      action: this.action,
      processed:
        counts.success +
        counts.already_following +
        counts.already_unfollowed +
        counts.failed +
        counts.user_not_found,
      total,
      success: counts.success,
      alreadyFollowing: counts.already_following,
      alreadyUnfollowed: counts.already_unfollowed,
      failed: counts.failed + counts.user_not_found,
      pending: counts.pending,
      currentUsername: this.currentUsername,
      lastError: this.lastError,
      interrupted: this.database.getFlag("webQueueInterrupted")
    };
  }

  async startFollow(usernames: string[]): Promise<WebAutomationRuntimeStatus> {
    return this.start(usernames, "FOLLOW");
  }

  async startUnfollow(usernames: string[]): Promise<WebAutomationRuntimeStatus> {
    return this.start(usernames, "UNFOLLOW");
  }

  async pause(): Promise<WebAutomationRuntimeStatus> {
    this.paused = true;
    this.lastError = null;
    this.notify("Web otomasyonu duraklatıldı.");
    this.emit();
    return this.getStatus();
  }

  async resume(): Promise<WebAutomationRuntimeStatus> {
    if (this.running && this.paused) {
      this.paused = false;
      this.database.setFlag("webQueueInterrupted", false);
      this.notify("Web otomasyonuna devam ediliyor.");
      this.emit();
      return this.getStatus();
    }
    const unfinished = this.database
      .getWebJobs(this.action ?? undefined)
      .filter((job) => job.status === "pending" || job.status === "paused");
    for (const job of unfinished.filter((item) => item.status === "paused")) {
      this.database.updateWebJob(job.id, { status: "pending", error: null });
    }
    const usernames = unfinished.map((job) => job.username);
    if (usernames.length === 0) {
      this.lastError = "Devam edilecek web otomasyon işi yok.";
      this.notify(this.lastError);
      this.emit();
      return this.getStatus();
    }
    return this.start(usernames, this.action ?? unfinished[0]?.action ?? "FOLLOW", false);
  }

  async restart(): Promise<WebAutomationRuntimeStatus> {
    const action = this.action ?? "FOLLOW";
    this.database.resetUnfinishedWebJobs(action);
    const usernames = this.database.getWebPendingJobs(action).map((job) => job.username);
    return this.start(usernames, action, false);
  }

  async stop(): Promise<WebAutomationRuntimeStatus> {
    this.stopRequested = true;
    this.paused = false;
    this.running = false;
    this.database.pauseWebProcessingJobs();
    this.database.cancelWebPendingJobs(this.action ?? undefined);
    this.lastError = WEB_ERROR_MESSAGES.stopped;
    this.database.setFlag("webQueueInterrupted", this.database.hasUnfinishedWebJobs());
    this.notify("Web otomasyonu durduruldu.");
    if (this.loopPromise) {
      await this.loopPromise;
    }
    this.emit();
    return this.getStatus();
  }

  private async start(
    usernames: string[],
    action: ActionType,
    createJobs = true
  ): Promise<WebAutomationRuntimeStatus> {
    if (this.running && !this.paused) {
      return this.getStatus();
    }
    this.action = action;
    if (createJobs && usernames.length > 0) {
      this.database.createWebJobs(usernames, action);
    }
    if (this.database.getWebPendingJobs(action).length === 0) {
      this.lastError = "Kuyrukta kullanıcı yok.";
      this.notify(this.lastError);
      this.emit();
      return this.getStatus();
    }
    const snapshot = await this.web.refreshStatus();
    if (!snapshot.connected) {
      await this.web.login();
      this.lastError = WEB_ERROR_MESSAGES.login_required;
      this.database.setFlag("webQueueInterrupted", true);
      this.notify("Instagram giriş gerekiyor. Lütfen Instagram penceresinde manuel giriş yapın.");
      this.emit();
      return this.getStatus();
    }

    this.stopRequested = false;
    this.paused = false;
    this.running = true;
    this.lastError = null;
    this.database.setFlag("webQueueInterrupted", false);
    this.notify(action === "FOLLOW" ? "Web takip otomasyonu başlatıldı." : "Web takipten çıkarma otomasyonu başlatıldı.");
    this.emit();
    this.loopPromise = this.loop(action);
    void this.loopPromise.finally(() => {
      this.loopPromise = null;
    });
    return this.getStatus();
  }

  private async loop(action: ActionType): Promise<void> {
    const driver = this.web.getDriver();
    try {
      while (this.running && !this.stopRequested) {
        if (this.paused) {
          await delay(100);
          continue;
        }
        const next = this.database.getWebPendingJobs(action)[0];
        if (!next) {
          break;
        }
        this.currentUsername = next.username;
        this.emit();
        const startedAt = new Date().toISOString();
        this.database.updateWebJob(next.id, { status: "processing", startedAt, error: null });
        log.info(`${action} @${next.username} started`);

        const outcome = action === "FOLLOW" ? await driver.follow(next.username) : await driver.unfollow(next.username);

        if (outcome.ok) {
          const status: WebJobStatus = outcome.status === "success" ? "success" : outcome.status;
          this.finishJob(next, status, null, null, startedAt, outcome.profileUrl);
        } else {
          const status = this.statusFromError(outcome.code);
          this.finishJob(next, status, outcome.message, outcome.code, startedAt, outcome.profileUrl);
          if (SECURITY_STOP_CODES.includes(outcome.code)) {
            this.lastError =
              outcome.code === "captcha_required" || outcome.code === "security_check_required"
                ? "Instagram güvenlik doğrulaması gerekiyor. Lütfen işlemi Instagram penceresinde manuel olarak tamamlayın."
                : outcome.message;
            this.running = false;
            this.database.setFlag("webQueueInterrupted", true);
            this.notify(this.lastError);
            break;
          }
        }

        const delayMs = this.getDelayMs();
        if (delayMs > 0 && this.database.getWebPendingJobs(action).length > 0) {
          await delay(delayMs);
        }
      }
    } finally {
      this.running = false;
      this.currentUsername = null;
      this.emit();
    }
  }

  private statusFromError(code: WebErrorCode): WebJobStatus {
    if (code === "user_not_found") {
      return "user_not_found";
    }
    if (code === "login_required" || code === "session_expired") {
      return "login_required";
    }
    if (code === "captcha_required" || code === "security_check_required") {
      return "security_check_required";
    }
    if (code === "stopped") {
      return "cancelled";
    }
    return "failed";
  }

  private finishJob(
    job: WebAutomationJob,
    status: WebJobStatus,
    error: string | null,
    errorCode: WebErrorCode | null,
    startedAt: string,
    profileUrl?: string
  ): void {
    const completedAt = new Date().toISOString();
    const updated = this.database.updateWebJob(job.id, {
      status,
      error,
      errorCode,
      completedAt,
      profileUrl: profileUrl ?? null
    });
    this.database.insertWebHistory({
      jobId: updated.id,
      username: updated.username,
      action: updated.action,
      status,
      error,
      errorCode,
      profileUrl: updated.profileUrl,
      startedAt,
      completedAt
    });
    this.database.touchQueueFromWebJob(updated);
    log.info(`${job.action} @${job.username} ${status}${error ? ` ${error}` : ""}`);
  }

  private emit(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
