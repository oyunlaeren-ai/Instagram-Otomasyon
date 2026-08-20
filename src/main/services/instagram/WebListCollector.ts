import type { WebListType } from "@shared/constants";
import type { WebListCollectStatus } from "@shared/types";
import { sanitizeUsername } from "@shared/utils";
import { createLogger } from "../logging/logger";
import type { DatabaseService } from "../../database/DatabaseService";
import type { WebInstagramAutomationService } from "./WebInstagramAutomationService";
import { WEB_ERROR_MESSAGES } from "./instagramWebDriver";

const log = createLogger("[WebAutomation]");

export class WebListCollector {
  private running = false;
  private stopRequested = false;
  private sourceUsername: string | null = null;
  private listType: WebListType | null = null;
  private phase = "idle";
  private collected = 0;
  private message = "Hazır";
  private lastError: string | null = null;
  private listeners = new Set<(status: WebListCollectStatus) => void>();

  constructor(
    private readonly database: DatabaseService,
    private readonly web: WebInstagramAutomationService,
    private readonly isBusy: () => boolean = () => false,
    private readonly getDelayMs: () => number = () => 0
  ) {}

  onStatus(listener: (status: WebListCollectStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): WebListCollectStatus {
    return {
      running: this.running,
      sourceUsername: this.sourceUsername,
      listType: this.listType,
      phase: this.phase,
      collected: this.collected,
      total: this.sourceUsername && this.listType ? this.database.getWebCollectedList(this.sourceUsername, this.listType).length : 0,
      message: this.message,
      lastError: this.lastError
    };
  }

  async collectFollowers(username: string): Promise<WebListCollectStatus> {
    return this.collect(username, "FOLLOWERS");
  }

  async collectFollowing(username: string): Promise<WebListCollectStatus> {
    return this.collect(username, "FOLLOWING");
  }

  stop(): WebListCollectStatus {
    this.stopRequested = true;
    this.lastError = WEB_ERROR_MESSAGES.stopped;
    this.message = WEB_ERROR_MESSAGES.stopped;
    this.emit();
    return this.getStatus();
  }

  getList(sourceUsername: string, listType: WebListType) {
    return this.database.getWebCollectedList(sourceUsername, listType);
  }

  getNonFollowers(sourceUsername: string) {
    return this.database.getWebNonFollowers(sourceUsername);
  }

  private async collect(username: string, listType: WebListType): Promise<WebListCollectStatus> {
    const cleaned = sanitizeUsername(username);
    if (!cleaned) {
      this.lastError = "Geçerli bir kullanıcı adı girin.";
      this.message = this.lastError;
      this.emit();
      return this.getStatus();
    }
    if (this.running) {
      this.lastError = "Liste okuma zaten devam ediyor.";
      this.message = this.lastError;
      this.emit();
      return this.getStatus();
    }
    if (this.isBusy()) {
      this.lastError = "Önce web takip otomasyonunu durdurun.";
      this.message = this.lastError;
      this.emit();
      return this.getStatus();
    }

    this.running = true;
    this.stopRequested = false;
    this.sourceUsername = cleaned;
    this.listType = listType;
    this.collected = 0;
    this.lastError = null;
    this.phase = "preparing";
    this.message = "Hazırlanıyor...";
    this.emit();

    const snapshot = await this.web.refreshStatus();
    if (!snapshot.connected) {
      await this.web.login();
      this.running = false;
      this.phase = "failed";
      this.lastError = WEB_ERROR_MESSAGES.login_required;
      this.message = "Instagram giriş gerekiyor. Lütfen Instagram penceresinde manuel giriş yapın.";
      this.emit();
      return this.getStatus();
    }

    const result = await this.web.getDriver().collectRelationshipList(cleaned, listType, {
      shouldStop: () => this.stopRequested,
      onProgress: (progress) => {
        this.phase = progress.phase;
        this.collected = progress.collected;
        this.message = progress.message;
        this.emit();
      },
      scrollDelayMs: Math.max(this.getDelayMs(), 0)
    });

    if (result.ok) {
      this.database.replaceWebCollectedList(cleaned, listType, result.usernames);
      this.collected = result.usernames.length;
      this.phase = "completed";
      this.message = result.usernames.length
        ? `${result.usernames.length} kullanıcı bulundu. Tamamlandı.`
        : "Tamamlandı.";
      this.lastError = null;
      log.info(`Collected ${listType} for @${cleaned}: ${result.usernames.length}`);
    } else {
      this.phase = result.code === "stopped" ? "stopped" : "failed";
      this.lastError = result.message ?? WEB_ERROR_MESSAGES.failed;
      this.message = this.lastError;
      if (result.usernames.length > 0) {
        this.database.replaceWebCollectedList(cleaned, listType, result.usernames);
        this.collected = result.usernames.length;
      }
      log.info(`List collect stopped @${cleaned} ${result.code ?? "failed"}`);
    }

    this.running = false;
    this.emit();
    return this.getStatus();
  }

  private emit(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}
