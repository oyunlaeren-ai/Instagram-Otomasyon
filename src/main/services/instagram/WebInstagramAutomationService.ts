import type { WebSessionSnapshot } from "@shared/types";
import type { WebSessionStatus } from "@shared/constants";
import { createLogger } from "../logging/logger";
import type { DatabaseService } from "../../database/DatabaseService";
import type { InstagramWebDriver } from "./instagramWebDriver";

const log = createLogger("[WebAutomation]");

const SESSION_MESSAGES: Record<WebSessionStatus, string> = {
  disconnected: "Bağlı değil",
  login_required: "Giriş bekleniyor",
  connected: "Bağlı",
  expired: "Oturum süresi doldu",
  security_check: "Güvenlik doğrulaması gerekiyor"
};

export class WebInstagramAutomationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly driver: InstagramWebDriver
  ) {}

  async getSnapshot(): Promise<WebSessionSnapshot> {
    const stored = this.database.getWebSession();
    return this.toSnapshot(stored.status, stored.instagramUsername, stored.lastCheckedAt, stored.lastError);
  }

  async refreshStatus(): Promise<WebSessionSnapshot> {
    const status = await this.driver.getSessionStatus();
    return this.persist(status);
  }

  async login(): Promise<WebSessionSnapshot> {
    log.info("Opening Instagram web login window");
    const status = await this.driver.openLoginWindow();
    return this.persist(status, status === "login_required" ? "Instagram giriş gerekiyor" : null);
  }

  async checkSession(): Promise<WebSessionSnapshot> {
    log.info("Checking Instagram web session");
    const status = await this.driver.checkSession();
    return this.persist(status);
  }

  async logout(): Promise<WebSessionSnapshot> {
    log.info("Closing Instagram web session");
    const status = await this.driver.logout();
    return this.persist(status);
  }

  getDriver(): InstagramWebDriver {
    return this.driver;
  }

  private persist(status: WebSessionStatus, error: string | null = null): WebSessionSnapshot {
    const checkedAt = new Date().toISOString();
    this.database.setWebSession({
      status,
      lastCheckedAt: checkedAt,
      lastError: error
    });
    const stored = this.database.getWebSession();
    return this.toSnapshot(stored.status, stored.instagramUsername, stored.lastCheckedAt, stored.lastError);
  }

  private toSnapshot(
    status: WebSessionStatus,
    username: string | null,
    lastCheckedAt: string | null,
    lastError: string | null
  ): WebSessionSnapshot {
    return {
      status,
      connected: status === "connected",
      instagramUsername: username,
      lastCheckedAt,
      lastError,
      message: SESSION_MESSAGES[status]
    };
  }
}
