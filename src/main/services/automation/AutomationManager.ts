import type { ActionType } from "@shared/constants";
import type { AppSettings, AutomationRuntimeStatus } from "@shared/types";
import { isWithinWorkingHours } from "@shared/utils";
import { createLogger } from "../logging/logger";
import type { DatabaseService } from "../../database/DatabaseService";
import type { JobQueue } from "./JobQueue";
import type { ActionWorker } from "./ActionWorker";
import type { RateLimiter } from "./RateLimiter";
import type { InstagramService } from "../instagram/InstagramService";

const log = createLogger("[Automation]");
const UNSUPPORTED_MESSAGE = "Bu işlem mevcut Instagram API izinleriyle desteklenmiyor.";

export class AutomationManager {
  private running = false;
  private paused = false;
  private outsideSchedule = false;
  private loopPromise: Promise<void> | null = null;
  private currentUsername: string | null = null;
  private lastAction: ActionType | null = null;
  private lastError: string | null = null;
  private preferredAction: ActionType | undefined;
  private listeners = new Set<(status: AutomationRuntimeStatus) => void>();

  constructor(
    private readonly database: DatabaseService,
    private readonly queue: JobQueue,
    private readonly worker: ActionWorker,
    private readonly rateLimiter: RateLimiter,
    private readonly getService: () => InstagramService,
    private readonly notify: (message: string) => void = () => undefined
  ) {}

  onStatus(listener: (status: AutomationRuntimeStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): AutomationRuntimeStatus {
    const counts = this.queue.counts();
    const total =
      counts.pending +
      counts.processing +
      counts.success +
      counts.failed +
      counts.cancelled +
      counts.unsupported;
    return {
      running: this.running,
      paused: this.paused,
      outsideSchedule: this.outsideSchedule,
      processed: counts.success + counts.failed + counts.unsupported,
      total,
      success: counts.success,
      failed: counts.failed,
      unsupported: counts.unsupported,
      pending: counts.pending,
      currentUsername: this.currentUsername,
      lastAction: this.lastAction,
      lastError: this.lastError,
      interrupted: this.database.getFlag("queueInterrupted")
    };
  }

  async start(action?: ActionType): Promise<AutomationRuntimeStatus> {
    const validation = await this.validateStart(action);
    if (!validation.ok) {
      this.lastError = validation.message;
      this.notify(validation.message);
      this.emit();
      return this.getStatus();
    }
    this.preferredAction = action;
    this.paused = false;
    this.outsideSchedule = false;
    this.lastError = null;
    this.queue.restoreInterrupted();
    this.database.setFlag("queueInterrupted", false);
    const settings = this.database.getSettings();
    this.rateLimiter.setDelayMs(Math.max(0, settings.actionDelaySeconds) * 1000);
    if (this.running) {
      this.emit();
      return this.getStatus();
    }
    this.running = true;
    log.info("Automation started");
    this.notify("Otomasyon başladı.");
    this.loopPromise = this.loop();
    this.emit();
    return this.getStatus();
  }

  async stop(): Promise<AutomationRuntimeStatus> {
    this.running = false;
    this.paused = false;
    this.outsideSchedule = false;
    this.currentUsername = null;
    this.database.setFlag("queueInterrupted", this.queue.hasPending());
    log.info("Automation stopped");
    this.emit();
    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }
    return this.getStatus();
  }

  async pause(): Promise<AutomationRuntimeStatus> {
    this.paused = true;
    this.running = false;
    this.queue.restoreInterrupted();
    this.database.setFlag("queueInterrupted", this.queue.hasPending());
    log.info("Automation paused");
    this.emit();
    return this.getStatus();
  }

  async resume(): Promise<AutomationRuntimeStatus> {
    this.paused = false;
    return this.start(this.preferredAction);
  }

  async clearQueue(): Promise<AutomationRuntimeStatus> {
    await this.stop();
    this.queue.clear();
    this.database.setFlag("queueInterrupted", false);
    this.emit();
    return this.getStatus();
  }

  async cancelInterrupted(): Promise<void> {
    this.queue.cancelPending();
    this.database.setFlag("queueInterrupted", false);
    this.emit();
  }

  private async validateStart(action?: ActionType): Promise<{ ok: true } | { ok: false; message: string }> {
    const service = this.getService();
    const account = this.database.getPrimaryAccount();
    if (service.provider !== "mock" && (!account || account.connectionStatus !== "connected")) {
      return { ok: false, message: "Önce bir Instagram hesabı bağlamanız gerekiyor." };
    }
    const status = await service.getConnectionStatus();
    if (status === "disconnected") {
      return { ok: false, message: "Önce bir Instagram hesabı bağlamanız gerekiyor." };
    }
    if (status === "expired") {
      return { ok: false, message: "Instagram oturumunun süresi doldu." };
    }
    const capabilities = service.getCapabilities();
    if (action === "FOLLOW" && !capabilities.canFollow) {
      return { ok: false, message: UNSUPPORTED_MESSAGE };
    }
    if (action === "UNFOLLOW" && !capabilities.canUnfollow) {
      return { ok: false, message: UNSUPPORTED_MESSAGE };
    }
    if (!action && !capabilities.canFollow && !capabilities.canUnfollow) {
      return { ok: false, message: UNSUPPORTED_MESSAGE };
    }
    return { ok: true };
  }

  private async loop(): Promise<void> {
    while (this.running && !this.paused) {
      const settings = this.database.getSettings();
      if (!isWithinWorkingHours(new Date(), settings.workStart, settings.workEnd)) {
        this.outsideSchedule = true;
        this.lastError = "Çalışma saatleri dışında otomasyon bekliyor.";
        this.emit();
        await this.delay(1000);
        if (!this.running) {
          break;
        }
        continue;
      }
      this.outsideSchedule = false;

      const pending = this.queue.getPending(this.preferredAction);
      if (pending.length === 0) {
        this.running = false;
        this.currentUsername = null;
        this.notify("Otomasyon tamamlandı.");
        log.info("Queue empty, automation idle");
        this.emit();
        break;
      }

      const job = pending[0];
      if (this.exceedsDailyLimit(job.action, settings)) {
        this.lastError = "Günlük işlem limitine ulaşıldı.";
        this.running = false;
        this.paused = true;
        this.notify("Günlük limite ulaşıldı.");
        this.database.setFlag("queueInterrupted", true);
        this.emit();
        break;
      }

      this.currentUsername = job.username;
      this.lastAction = job.action;
      this.emit();
      const result = await this.worker.run(job);
      if (!this.running) {
        break;
      }
      if (result.disconnect) {
        this.lastError = "Instagram bağlantısı kesildi.";
        this.notify("Instagram bağlantısı kesildi.");
        await this.pause();
        break;
      }
      if (result.paused) {
        this.lastError = "Instagram API işlem limiti nedeniyle otomasyon duraklatıldı.";
        this.notify("Rate limit nedeniyle otomasyon duraklatıldı.");
        await this.pause();
        break;
      }
      if (result.job.status === "unsupported") {
        this.notify("API işlemi desteklemiyor.");
      }
      if (result.job.status === "failed") {
        this.lastError = result.job.error;
      }
      this.emit();
    }
  }

  private exceedsDailyLimit(action: ActionType, settings: AppSettings): boolean {
    const used = this.database.countTodayActions(action, "success");
    return action === "FOLLOW" ? used >= settings.dailyFollowLimit : used >= settings.dailyUnfollowLimit;
  }

  private emit(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      listener(status);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
