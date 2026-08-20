import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import { runMigrations } from "./migrate";
import { createLogger } from "../services/logging/logger";
import { nowIso, todayStartIso, rangeStartIso } from "@shared/utils";
import type {
  AccountRecord,
  AppSettings,
  AutomationJob,
  AutomationLog,
  ListMember,
  ListRecord,
  QueueItem,
  UserRecord,
  WebAutomationHistory,
  WebAutomationJob,
  WebCollectedMember,
  WebSessionSnapshot
} from "@shared/types";
import type {
  ActionType,
  ConnectionStatus,
  HistoryDateRange,
  HistoryFilter,
  InstagramErrorCode,
  InstagramProvider,
  JobStatus,
  ListType,
  RelationshipFilter,
  WebErrorCode,
  WebJobStatus,
  WebListType,
  WebSessionStatus
} from "@shared/constants";
import { WEB_JOB_STATUSES } from "@shared/constants";

const log = createLogger("[Database]");

const DEFAULT_SETTINGS: AppSettings = {
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

function boolFromInt(value: SqlValue): boolean {
  return Number(value) === 1;
}

export class DatabaseService {
  private db: Database | null = null;
  private readonly filePath: string;
  private wasmFile: string | undefined;

  constructor(filePath: string, wasmFile?: string) {
    this.filePath = filePath;
    this.wasmFile = wasmFile;
  }

  async initialize(): Promise<void> {
    const SQL = await initSqlJs({
      locateFile: (file) => {
        if (this.wasmFile) {
          return this.wasmFile;
        }
        return path.join(process.cwd(), "node_modules", "sql.js", "dist", file);
      }
    });

    if (fs.existsSync(this.filePath)) {
      const fileBuffer = fs.readFileSync(this.filePath);
      this.db = new SQL.Database(fileBuffer);
      log.info(`Opened database at ${this.filePath}`);
    } else {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      this.db = new SQL.Database();
      log.info(`Created new database at ${this.filePath}`);
    }

    this.db.run("PRAGMA foreign_keys = ON");
    runMigrations(this.getDb());
    this.ensureDefaultSettings();
    this.ensureDefaultLists();
    this.removeDemoAccounts();
    this.ensureWebSession();
    this.persist();
  }

  persist(): void {
    const data = this.getDb().export();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, Buffer.from(data));
  }

  close(): void {
    if (this.db) {
      this.persist();
      this.db.close();
      this.db = null;
    }
  }

  getSettings(): AppSettings {
    const rows = this.all<{ key: string; value: string }>("SELECT key, value FROM settings");
    const map = new Map(rows.map((row) => [row.key, row.value]));
    return {
      theme: map.get("theme") === "light" ? "light" : map.get("theme") === "system" ? "system" : "dark",
      notifications: map.get("notifications") !== "false",
      language: map.get("language") === "en" ? "en" : "tr",
      dailyFollowLimit: Number(map.get("dailyFollowLimit") ?? DEFAULT_SETTINGS.dailyFollowLimit),
      dailyUnfollowLimit: Number(map.get("dailyUnfollowLimit") ?? DEFAULT_SETTINGS.dailyUnfollowLimit),
      actionDelaySeconds: Number(map.get("actionDelaySeconds") ?? DEFAULT_SETTINGS.actionDelaySeconds),
      workStart: map.get("workStart") ?? DEFAULT_SETTINGS.workStart,
      workEnd: map.get("workEnd") ?? DEFAULT_SETTINGS.workEnd,
      onboardingCompleted: map.get("onboardingCompleted") === "true"
    };
  }

  saveSettings(partial: Partial<AppSettings>): AppSettings {
    const next = { ...this.getSettings(), ...partial };
    const entries: Array<[string, string]> = [
      ["theme", next.theme],
      ["notifications", String(next.notifications)],
      ["language", next.language],
      ["dailyFollowLimit", String(next.dailyFollowLimit)],
      ["dailyUnfollowLimit", String(next.dailyUnfollowLimit)],
      ["actionDelaySeconds", String(next.actionDelaySeconds)],
      ["workStart", next.workStart],
      ["workEnd", next.workEnd],
      ["onboardingCompleted", String(next.onboardingCompleted)]
    ];
    for (const [key, value] of entries) {
      this.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
        key,
        value
      ]);
    }
    this.persist();
    return next;
  }

  upsertAccount(input: {
    provider: InstagramProvider;
    instagramUserId: string | null;
    username: string | null;
    displayName: string | null;
    profilePicture: string | null;
    connectionStatus: ConnectionStatus;
  }): AccountRecord {
    const existing = this.getPrimaryAccount();
    const timestamp = nowIso();
    if (existing) {
      this.run(
        `UPDATE accounts SET provider = ?, instagramUserId = ?, username = ?, displayName = ?, profilePicture = ?, connectionStatus = ?, updatedAt = ? WHERE id = ?`,
        [
          input.provider,
          input.instagramUserId,
          input.username,
          input.displayName,
          input.profilePicture,
          input.connectionStatus,
          timestamp,
          existing.id
        ]
      );
    } else {
      this.run(
        `INSERT INTO accounts (provider, instagramUserId, username, displayName, profilePicture, connectionStatus, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.provider,
          input.instagramUserId,
          input.username,
          input.displayName,
          input.profilePicture,
          input.connectionStatus,
          timestamp,
          timestamp
        ]
      );
    }
    this.persist();
    const account = this.getPrimaryAccount();
    if (!account) {
      throw new Error("Account upsert failed");
    }
    return account;
  }

  disconnectAccount(): AccountRecord | null {
    const existing = this.getPrimaryAccount();
    if (!existing) {
      return null;
    }
    this.run(
      `UPDATE accounts SET connectionStatus = 'disconnected', instagramUserId = NULL, username = NULL, displayName = NULL, profilePicture = NULL, updatedAt = ? WHERE id = ?`,
      [nowIso(), existing.id]
    );
    this.persist();
    return this.getPrimaryAccount();
  }

  getPrimaryAccount(): AccountRecord | null {
    const row = this.get<Record<string, SqlValue>>("SELECT * FROM accounts ORDER BY id DESC LIMIT 1");
    return row ? this.mapAccount(row) : null;
  }

  upsertUser(input: {
    username: string;
    displayName?: string | null;
    profilePicture?: string | null;
    isFollower?: boolean;
    isFollowing?: boolean;
    followedAt?: string | null;
  }): UserRecord {
    const timestamp = nowIso();
    const existing = this.get<Record<string, SqlValue>>("SELECT * FROM users WHERE username = ?", [input.username]);
    if (existing) {
      this.run(
        `UPDATE users SET displayName = COALESCE(?, displayName), profilePicture = COALESCE(?, profilePicture),
         isFollower = COALESCE(?, isFollower), isFollowing = COALESCE(?, isFollowing), followedAt = COALESCE(?, followedAt),
         updatedAt = ? WHERE username = ?`,
        [
          input.displayName ?? null,
          input.profilePicture ?? null,
          input.isFollower === undefined ? null : Number(input.isFollower),
          input.isFollowing === undefined ? null : Number(input.isFollowing),
          input.followedAt ?? null,
          timestamp,
          input.username
        ]
      );
    } else {
      this.run(
        `INSERT INTO users (username, displayName, profilePicture, isFollower, isFollowing, followedAt, lastActionAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          input.username,
          input.displayName ?? null,
          input.profilePicture ?? null,
          Number(input.isFollower ?? false),
          Number(input.isFollowing ?? false),
          input.followedAt ?? null,
          timestamp,
          timestamp
        ]
      );
    }
    this.persist();
    const user = this.get<Record<string, SqlValue>>("SELECT * FROM users WHERE username = ?", [input.username]);
    if (!user) {
      throw new Error("User upsert failed");
    }
    return this.mapUser(user);
  }

  touchUserAction(username: string): void {
    this.run("UPDATE users SET lastActionAt = ?, updatedAt = ? WHERE username = ?", [nowIso(), nowIso(), username]);
    this.persist();
  }

  getUsers(filter: RelationshipFilter, search: string, page: number, pageSize: number): { items: UserRecord[]; total: number } {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (filter === "not_following") {
      where.push("isFollower = 0 AND isFollowing = 1");
    } else if (filter === "following") {
      where.push("isFollower = 1");
    } else if (filter === "mutual") {
      where.push("isFollower = 1 AND isFollowing = 1");
    }
    if (search.trim()) {
      where.push("username LIKE ?");
      params.push(`%${search.trim()}%`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const totalRow = this.get<{ count: number }>(`SELECT COUNT(*) as count FROM users ${clause}`, params);
    const offset = (page - 1) * pageSize;
    const rows = this.all<Record<string, SqlValue>>(
      `SELECT * FROM users ${clause} ORDER BY username ASC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    return {
      items: rows.map((row) => this.mapUser(row)),
      total: totalRow?.count ?? 0
    };
  }

  getNotFollowingBack(): UserRecord[] {
    return this.all<Record<string, SqlValue>>(
      "SELECT * FROM users WHERE isFollowing = 1 AND isFollower = 0 ORDER BY username"
    ).map((row) => this.mapUser(row));
  }

  getFilePath(): string {
    return this.filePath;
  }

  getFlag(key: string): boolean {
    const row = this.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
    return row?.value === "true";
  }

  setFlag(key: string, value: boolean): void {
    this.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
      key,
      String(value)
    ]);
    this.persist();
  }

  getWhitelistedUsernames(): string[] {
    return this.all<{ username: string }>(
      `SELECT lm.username FROM list_members lm INNER JOIN lists l ON l.id = lm.listId WHERE l.type = 'whitelist'`
    ).map((row) => row.username);
  }

  getBlacklistedUsernames(): string[] {
    return this.all<{ username: string }>(
      `SELECT lm.username FROM list_members lm INNER JOIN lists l ON l.id = lm.listId WHERE l.type = 'blacklist'`
    ).map((row) => row.username);
  }

  clearPendingJobs(): void {
    this.run("DELETE FROM automation_jobs WHERE status IN ('pending', 'processing')");
    this.run("DELETE FROM follow_queue WHERE status IN ('pending', 'processing')");
    this.run("DELETE FROM unfollow_queue WHERE status IN ('pending', 'processing')");
    this.persist();
  }

  resetUserData(): void {
    this.run("DELETE FROM follow_queue");
    this.run("DELETE FROM unfollow_queue");
    this.run("DELETE FROM automation_jobs");
    this.run("DELETE FROM automation_logs");
    this.run("DELETE FROM list_members");
    this.run("DELETE FROM users");
    this.run("DELETE FROM accounts");
    this.setFlag("queueInterrupted", false);
    this.setFlag("webQueueInterrupted", false);
    this.run("DELETE FROM web_automation_jobs");
    this.run("DELETE FROM web_automation_history");
    this.run("DELETE FROM web_collected_members");
    this.run("DELETE FROM web_collected_runs");
    this.run(
      "UPDATE web_automation_sessions SET status = 'disconnected', instagramUsername = NULL, lastCheckedAt = NULL, lastError = NULL, updatedAt = ? WHERE id = 1",
      [nowIso()]
    );
    this.persist();
  }

  replaceFromFile(sourcePath: string): void {
    this.persist();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    fs.copyFileSync(sourcePath, this.filePath);
  }

  addFollowQueueItems(usernames: string[]): QueueItem[] {
    const timestamp = nowIso();
    for (const username of usernames) {
      const existing = this.get<{ id: number }>(
        "SELECT id FROM follow_queue WHERE username = ? AND status IN ('pending', 'processing')",
        [username]
      );
      if (existing) {
        continue;
      }
      this.upsertUser({ username });
      this.run(
        "INSERT INTO follow_queue (username, status, createdAt, startedAt, completedAt, error, lastActionAt) VALUES (?, 'pending', ?, NULL, NULL, NULL, NULL)",
        [username, timestamp]
      );
    }
    this.persist();
    return this.getFollowQueue();
  }

  getFollowQueue(): QueueItem[] {
    return this.all<Record<string, SqlValue>>("SELECT * FROM follow_queue ORDER BY id DESC").map((row) =>
      this.mapQueue(row)
    );
  }

  getUnfollowCandidates(filter: "not_following_back" | "selected" | "blacklisted"): UserRecord[] {
    if (filter === "blacklisted") {
      const names = this.getBlacklistedUsernames();
      if (names.length === 0) {
        return [];
      }
      const placeholders = names.map(() => "?").join(",");
      return this.all<Record<string, SqlValue>>(
        `SELECT * FROM users WHERE username IN (${placeholders}) ORDER BY username`,
        names
      ).map((row) => this.mapUser(row));
    }
    if (filter === "not_following_back") {
      return this.getNotFollowingBack();
    }
    return this.all<Record<string, SqlValue>>("SELECT * FROM users ORDER BY username").map((row) => this.mapUser(row));
  }

  addUnfollowQueueItems(usernames: string[]): void {
    const timestamp = nowIso();
    for (const username of usernames) {
      this.run(
        "INSERT INTO unfollow_queue (username, status, createdAt, startedAt, completedAt, error, lastActionAt) VALUES (?, 'pending', ?, NULL, NULL, NULL, NULL)",
        [username, timestamp]
      );
    }
    this.persist();
  }

  createJob(username: string, action: ActionType): AutomationJob {
    const timestamp = nowIso();
    this.run(
      "INSERT INTO automation_jobs (username, action, status, createdAt, startedAt, completedAt, error) VALUES (?, ?, 'pending', ?, NULL, NULL, NULL)",
      [username, action, timestamp]
    );
    this.persist();
    const job = this.get<Record<string, SqlValue>>(
      "SELECT * FROM automation_jobs WHERE username = ? AND action = ? ORDER BY id DESC LIMIT 1",
      [username, action]
    );
    if (!job) {
      throw new Error("Job create failed");
    }
    return this.mapJob(job);
  }

  createJobs(usernames: string[], action: ActionType): AutomationJob[] {
    return usernames.map((username) => this.createJob(username, action));
  }

  getJobs(): AutomationJob[] {
    return this.all<Record<string, SqlValue>>("SELECT * FROM automation_jobs ORDER BY id ASC").map((row) =>
      this.mapJob(row)
    );
  }

  getPendingJobs(action?: ActionType): AutomationJob[] {
    if (action) {
      return this.all<Record<string, SqlValue>>(
        "SELECT * FROM automation_jobs WHERE status = 'pending' AND action = ? ORDER BY id ASC",
        [action]
      ).map((row) => this.mapJob(row));
    }
    return this.all<Record<string, SqlValue>>(
      "SELECT * FROM automation_jobs WHERE status = 'pending' ORDER BY id ASC"
    ).map((row) => this.mapJob(row));
  }

  getJob(id: number): AutomationJob | null {
    const row = this.get<Record<string, SqlValue>>("SELECT * FROM automation_jobs WHERE id = ?", [id]);
    return row ? this.mapJob(row) : null;
  }

  updateJob(
    id: number,
    patch: Partial<Pick<AutomationJob, "status" | "startedAt" | "completedAt" | "error" | "duration">>
  ): AutomationJob {
    const current = this.getJob(id);
    if (!current) {
      throw new Error(`Job ${id} not found`);
    }
    const next = { ...current, ...patch };
    this.run(
      "UPDATE automation_jobs SET status = ?, startedAt = ?, completedAt = ?, error = ?, duration = ? WHERE id = ?",
      [next.status, next.startedAt, next.completedAt, next.error, next.duration, id]
    );
    this.syncQueueTables(next);
    this.persist();
    const updated = this.getJob(id);
    if (!updated) {
      throw new Error("Job update failed");
    }
    return updated;
  }

  pauseProcessingJobs(): void {
    this.run(
      "UPDATE automation_jobs SET status = 'pending', startedAt = NULL WHERE status = 'processing'"
    );
    this.run("UPDATE follow_queue SET status = 'pending' WHERE status = 'processing'");
    this.run("UPDATE unfollow_queue SET status = 'pending' WHERE status = 'processing'");
    this.persist();
  }

  cancelPendingJobs(action?: ActionType): void {
    if (action) {
      this.run("UPDATE automation_jobs SET status = 'cancelled', completedAt = ? WHERE status = 'pending' AND action = ?", [
        nowIso(),
        action
      ]);
    } else {
      this.run("UPDATE automation_jobs SET status = 'cancelled', completedAt = ? WHERE status = 'pending'", [nowIso()]);
    }
    this.persist();
  }

  countTodayActions(action: ActionType, status: JobStatus = "success"): number {
    const row = this.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM automation_jobs WHERE action = ? AND status = ? AND completedAt >= ?",
      [action, status, todayStartIso()]
    );
    return row?.count ?? 0;
  }

  countJobs(status?: JobStatus): number {
    if (status) {
      const row = this.get<{ count: number }>("SELECT COUNT(*) as count FROM automation_jobs WHERE status = ?", [status]);
      return row?.count ?? 0;
    }
    const row = this.get<{ count: number }>("SELECT COUNT(*) as count FROM automation_jobs");
    return row?.count ?? 0;
  }

  insertLog(input: {
    jobId: number | null;
    username: string;
    action: ActionType;
    status: string;
    error?: string | null;
    errorCode?: InstagramErrorCode | null;
    duration?: number | null;
  }): AutomationLog {
    const timestamp = nowIso();
    this.run(
      "INSERT INTO automation_logs (jobId, username, action, status, error, errorCode, duration, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        input.jobId,
        input.username,
        input.action,
        input.status,
        input.error ?? null,
        input.errorCode ?? null,
        input.duration ?? null,
        timestamp
      ]
    );
    this.persist();
    const row = this.get<Record<string, SqlValue>>("SELECT * FROM automation_logs ORDER BY id DESC LIMIT 1");
    if (!row) {
      throw new Error("Log insert failed");
    }
    return this.mapLog(row);
  }

  getLogs(filter: HistoryFilter = "all", search = "", dateRange: HistoryDateRange = "all"): AutomationLog[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (filter === "follow") {
      where.push("action = 'FOLLOW'");
    } else if (filter === "unfollow") {
      where.push("action = 'UNFOLLOW'");
    } else if (filter === "success") {
      where.push("status IN ('success', 'SUCCESS')");
    } else if (filter === "failed") {
      where.push("status IN ('failed', 'FAILED')");
    } else if (filter === "unsupported") {
      where.push("status IN ('unsupported', 'UNSUPPORTED')");
    } else if (filter === "cancelled") {
      where.push("status IN ('cancelled', 'CANCELLED')");
    }
    if (search.trim()) {
      where.push("username LIKE ?");
      params.push(`%${search.trim()}%`);
    }
    const start = rangeStartIso(dateRange);
    if (start) {
      where.push("createdAt >= ?");
      params.push(start);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.all<Record<string, SqlValue>>(
      `SELECT * FROM automation_logs ${clause} ORDER BY id DESC LIMIT 200`,
      params
    ).map((row) => this.mapLog(row));
  }

  getRecentLogs(limit = 8): AutomationLog[] {
    return this.all<Record<string, SqlValue>>("SELECT * FROM automation_logs ORDER BY id DESC LIMIT ?", [limit]).map(
      (row) => this.mapLog(row)
    );
  }

  createList(name: string, type: ListType): ListRecord {
    const timestamp = nowIso();
    this.run("INSERT INTO lists (name, type, createdAt) VALUES (?, ?, ?)", [name, type, timestamp]);
    this.persist();
    const row = this.get<Record<string, SqlValue>>("SELECT * FROM lists ORDER BY id DESC LIMIT 1");
    if (!row) {
      throw new Error("List create failed");
    }
    return this.mapList(row);
  }

  getLists(): ListRecord[] {
    return this.all<Record<string, SqlValue>>("SELECT * FROM lists ORDER BY id ASC").map((row) => this.mapList(row));
  }

  getListMembers(listId: number): ListMember[] {
    return this.all<Record<string, SqlValue>>("SELECT * FROM list_members WHERE listId = ? ORDER BY username", [
      listId
    ]).map((row) => this.mapListMember(row));
  }

  addListMember(listId: number, username: string): ListMember[] {
    this.upsertUser({ username });
    const existing = this.get<{ id: number }>(
      "SELECT id FROM list_members WHERE listId = ? AND username = ?",
      [listId, username]
    );
    if (!existing) {
      this.run("INSERT INTO list_members (listId, username, createdAt) VALUES (?, ?, ?)", [listId, username, nowIso()]);
      this.persist();
    }
    return this.getListMembers(listId);
  }

  removeListMember(listId: number, memberId: number): ListMember[] {
    this.run("DELETE FROM list_members WHERE id = ? AND listId = ?", [memberId, listId]);
    this.persist();
    return this.getListMembers(listId);
  }

  getWebSession(): {
    status: WebSessionStatus;
    instagramUsername: string | null;
    lastCheckedAt: string | null;
    lastError: string | null;
  } {
    this.ensureWebSession();
    const row = this.get<Record<string, SqlValue>>("SELECT * FROM web_automation_sessions WHERE id = 1");
    return {
      status: this.mapWebSessionStatus(row?.status),
      instagramUsername: row?.instagramUsername ? String(row.instagramUsername) : null,
      lastCheckedAt: row?.lastCheckedAt ? String(row.lastCheckedAt) : null,
      lastError: row?.lastError ? String(row.lastError) : null
    };
  }

  getWebSessionSnapshot(): WebSessionSnapshot {
    const stored = this.getWebSession();
    const messages: Record<WebSessionStatus, string> = {
      disconnected: "Bağlı değil",
      login_required: "Giriş bekleniyor",
      connected: "Bağlı",
      expired: "Oturum süresi doldu",
      security_check: "Güvenlik doğrulaması gerekiyor"
    };
    return {
      status: stored.status,
      connected: stored.status === "connected",
      instagramUsername: stored.instagramUsername,
      lastCheckedAt: stored.lastCheckedAt,
      lastError: stored.lastError,
      message: messages[stored.status]
    };
  }

  setWebSession(patch: {
    status: WebSessionStatus;
    instagramUsername?: string | null;
    lastCheckedAt?: string | null;
    lastError?: string | null;
  }): void {
    this.ensureWebSession();
    const current = this.getWebSession();
    this.run(
      "UPDATE web_automation_sessions SET status = ?, instagramUsername = ?, lastCheckedAt = ?, lastError = ?, updatedAt = ? WHERE id = 1",
      [
        patch.status,
        patch.instagramUsername === undefined ? current.instagramUsername : patch.instagramUsername,
        patch.lastCheckedAt === undefined ? current.lastCheckedAt : patch.lastCheckedAt,
        patch.lastError === undefined ? current.lastError : patch.lastError,
        nowIso()
      ]
    );
    this.persist();
  }

  createWebJobs(usernames: string[], action: ActionType): WebAutomationJob[] {
    const timestamp = nowIso();
    for (const raw of usernames) {
      const username = raw.replace(/^@/, "").trim().toLowerCase();
      if (!username) {
        continue;
      }
      const existing = this.get<{ id: number }>(
        "SELECT id FROM web_automation_jobs WHERE username = ? AND action = ? AND status IN ('pending', 'processing', 'paused')",
        [username, action]
      );
      if (existing) {
        continue;
      }
      this.run(
        "INSERT INTO web_automation_jobs (username, action, provider, status, createdAt) VALUES (?, ?, 'web', 'pending', ?)",
        [username, action, timestamp]
      );
    }
    this.persist();
    return this.getWebJobs(action);
  }

  getWebJobs(action?: ActionType): WebAutomationJob[] {
    if (action) {
      return this.all<Record<string, SqlValue>>(
        "SELECT * FROM web_automation_jobs WHERE action = ? ORDER BY id ASC",
        [action]
      ).map((row) => this.mapWebJob(row));
    }
    return this.all<Record<string, SqlValue>>("SELECT * FROM web_automation_jobs ORDER BY id ASC").map((row) =>
      this.mapWebJob(row)
    );
  }

  getWebPendingJobs(action?: ActionType): WebAutomationJob[] {
    if (action) {
      return this.all<Record<string, SqlValue>>(
        "SELECT * FROM web_automation_jobs WHERE status = 'pending' AND action = ? ORDER BY id ASC",
        [action]
      ).map((row) => this.mapWebJob(row));
    }
    return this.all<Record<string, SqlValue>>(
      "SELECT * FROM web_automation_jobs WHERE status = 'pending' ORDER BY id ASC"
    ).map((row) => this.mapWebJob(row));
  }

  getWebJob(id: number): WebAutomationJob | null {
    const row = this.get<Record<string, SqlValue>>("SELECT * FROM web_automation_jobs WHERE id = ?", [id]);
    return row ? this.mapWebJob(row) : null;
  }

  updateWebJob(
    id: number,
    patch: Partial<Pick<WebAutomationJob, "status" | "startedAt" | "completedAt" | "error" | "errorCode" | "profileUrl">>
  ): WebAutomationJob {
    const current = this.getWebJob(id);
    if (!current) {
      throw new Error(`Web job ${id} not found`);
    }
    const next = { ...current, ...patch };
    this.run(
      "UPDATE web_automation_jobs SET status = ?, startedAt = ?, completedAt = ?, error = ?, errorCode = ?, profileUrl = ? WHERE id = ?",
      [next.status, next.startedAt, next.completedAt, next.error, next.errorCode, next.profileUrl, id]
    );
    this.persist();
    const updated = this.getWebJob(id);
    if (!updated) {
      throw new Error("Web job update failed");
    }
    return updated;
  }

  pauseWebProcessingJobs(): void {
    this.run("UPDATE web_automation_jobs SET status = 'paused' WHERE status = 'processing'");
    this.persist();
  }

  cancelWebPendingJobs(action?: ActionType): void {
    if (action) {
      this.run(
        "UPDATE web_automation_jobs SET status = 'cancelled', completedAt = ? WHERE status IN ('pending', 'paused') AND action = ?",
        [nowIso(), action]
      );
    } else {
      this.run(
        "UPDATE web_automation_jobs SET status = 'cancelled', completedAt = ? WHERE status IN ('pending', 'paused')",
        [nowIso()]
      );
    }
    this.persist();
  }

  resetUnfinishedWebJobs(action: ActionType): void {
    this.run(
      "UPDATE web_automation_jobs SET status = 'pending', startedAt = NULL, completedAt = NULL, error = NULL WHERE action = ? AND status IN ('paused', 'failed', 'processing', 'login_required', 'security_check_required', 'cancelled')",
      [action]
    );
    this.persist();
  }

  hasUnfinishedWebJobs(): boolean {
    const row = this.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM web_automation_jobs WHERE status IN ('pending', 'processing', 'paused')"
    );
    return (row?.count ?? 0) > 0;
  }

  countWebJobsByStatus(action?: ActionType): Record<WebJobStatus, number> {
    const counts = Object.fromEntries(WEB_JOB_STATUSES.map((status) => [status, 0])) as Record<WebJobStatus, number>;
    const rows = action
      ? this.all<{ status: string; count: number }>(
          "SELECT status, COUNT(*) as count FROM web_automation_jobs WHERE action = ? GROUP BY status",
          [action]
        )
      : this.all<{ status: string; count: number }>(
          "SELECT status, COUNT(*) as count FROM web_automation_jobs GROUP BY status"
        );
    for (const row of rows) {
      if (row.status in counts) {
        counts[row.status as WebJobStatus] = row.count;
      }
    }
    return counts;
  }

  insertWebHistory(input: {
    jobId: number | null;
    username: string;
    action: ActionType;
    status: WebJobStatus;
    error?: string | null;
    errorCode?: WebErrorCode | null;
    profileUrl?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
  }): WebAutomationHistory {
    const timestamp = nowIso();
    this.run(
      "INSERT INTO web_automation_history (jobId, username, action, provider, status, error, errorCode, profileUrl, startedAt, completedAt, createdAt) VALUES (?, ?, ?, 'web', ?, ?, ?, ?, ?, ?, ?)",
      [
        input.jobId,
        input.username,
        input.action,
        input.status,
        input.error ?? null,
        input.errorCode ?? null,
        input.profileUrl ?? null,
        input.startedAt ?? null,
        input.completedAt ?? null,
        timestamp
      ]
    );
    this.persist();
    const row = this.get<Record<string, SqlValue>>("SELECT * FROM web_automation_history ORDER BY id DESC LIMIT 1");
    if (!row) {
      throw new Error("Web history insert failed");
    }
    return this.mapWebHistory(row);
  }

  getWebHistory(search = "", dateRange: HistoryDateRange = "all"): WebAutomationHistory[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (search.trim()) {
      where.push("username LIKE ?");
      params.push(`%${search.trim().replace(/^@/, "")}%`);
    }
    const rangeStart = rangeStartIso(dateRange);
    if (rangeStart) {
      where.push("createdAt >= ?");
      params.push(rangeStart);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.all<Record<string, SqlValue>>(
      `SELECT * FROM web_automation_history ${clause} ORDER BY id DESC`,
      params
    ).map((row) => this.mapWebHistory(row));
  }

  getUnfollowQueueItems(): QueueItem[] {
    return this.all<Record<string, SqlValue>>("SELECT * FROM unfollow_queue ORDER BY id DESC").map((row) =>
      this.mapQueue(row)
    );
  }

  touchQueueFromWebJob(job: WebAutomationJob): void {
    const table = job.action === "FOLLOW" ? "follow_queue" : "unfollow_queue";
    this.run(
      `UPDATE ${table} SET status = ?, startedAt = ?, completedAt = ?, error = ?, lastActionAt = ? WHERE username = ?`,
      [job.status, job.startedAt, job.completedAt, job.error, nowIso(), job.username]
    );
    this.persist();
  }

  replaceWebCollectedList(sourceUsername: string, listType: WebListType, usernames: string[]): void {
    const source = sourceUsername.replace(/^@/, "").toLowerCase();
    const collectedAt = nowIso();
    this.run("DELETE FROM web_collected_members WHERE sourceUsername = ? AND listType = ?", [source, listType]);
    const seen = new Set<string>();
    for (const raw of usernames) {
      const username = raw.replace(/^@/, "").trim().toLowerCase();
      if (!username || seen.has(username)) {
        continue;
      }
      seen.add(username);
      this.run(
        "INSERT INTO web_collected_members (sourceUsername, listType, username, collectedAt) VALUES (?, ?, ?, ?)",
        [source, listType, username, collectedAt]
      );
    }
    this.run(
      "INSERT INTO web_collected_runs (sourceUsername, listType, memberCount, collectedAt) VALUES (?, ?, ?, ?) ON CONFLICT(sourceUsername, listType) DO UPDATE SET memberCount = excluded.memberCount, collectedAt = excluded.collectedAt",
      [source, listType, seen.size, collectedAt]
    );
    this.persist();
  }

  getWebCollectedList(sourceUsername: string, listType: WebListType): WebCollectedMember[] {
    const source = sourceUsername.replace(/^@/, "").toLowerCase();
    return this.all<Record<string, SqlValue>>(
      "SELECT * FROM web_collected_members WHERE sourceUsername = ? AND listType = ? ORDER BY username ASC",
      [source, listType]
    ).map((row) => this.mapWebCollected(row));
  }

  getWebNonFollowers(sourceUsername: string): WebCollectedMember[] {
    const source = sourceUsername.replace(/^@/, "").toLowerCase();
    return this.all<Record<string, SqlValue>>(
      `SELECT f.* FROM web_collected_members f
       WHERE f.sourceUsername = ? AND f.listType = 'FOLLOWING'
         AND NOT EXISTS (
           SELECT 1 FROM web_collected_members r
           WHERE r.sourceUsername = f.sourceUsername AND r.listType = 'FOLLOWERS' AND r.username = f.username
         )
       ORDER BY f.username ASC`,
      [source]
    ).map((row) => this.mapWebCollected(row));
  }

  hasBothWebLists(sourceUsername: string): boolean {
    const source = sourceUsername.replace(/^@/, "").toLowerCase();
    const row = this.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM web_collected_runs WHERE sourceUsername = ? AND listType IN ('FOLLOWERS', 'FOLLOWING')",
      [source]
    );
    return (row?.count ?? 0) >= 2;
  }

  private mapWebCollected(row: Record<string, SqlValue>): WebCollectedMember {
    return {
      id: Number(row.id),
      sourceUsername: String(row.sourceUsername),
      listType: row.listType === "FOLLOWERS" ? "FOLLOWERS" : "FOLLOWING",
      username: String(row.username),
      collectedAt: String(row.collectedAt)
    };
  }

  private ensureWebSession(): void {
    const existing = this.get<{ id: number }>("SELECT id FROM web_automation_sessions WHERE id = 1");
    if (existing) {
      return;
    }
    this.run(
      "INSERT INTO web_automation_sessions (id, status, instagramUsername, lastCheckedAt, lastError, updatedAt) VALUES (1, 'disconnected', NULL, NULL, NULL, ?)",
      [nowIso()]
    );
  }

  private mapWebSessionStatus(value: SqlValue | undefined): WebSessionStatus {
    const status = String(value ?? "disconnected");
    if (
      status === "login_required" ||
      status === "connected" ||
      status === "expired" ||
      status === "security_check"
    ) {
      return status;
    }
    return "disconnected";
  }

  private mapWebJob(row: Record<string, SqlValue>): WebAutomationJob {
    return {
      id: Number(row.id),
      username: String(row.username),
      action: row.action === "UNFOLLOW" ? "UNFOLLOW" : "FOLLOW",
      provider: "web",
      status: String(row.status) as WebJobStatus,
      profileUrl: row.profileUrl ? String(row.profileUrl) : null,
      error: row.error ? String(row.error) : null,
      errorCode: row.errorCode ? (String(row.errorCode) as WebErrorCode) : null,
      createdAt: String(row.createdAt),
      startedAt: row.startedAt ? String(row.startedAt) : null,
      completedAt: row.completedAt ? String(row.completedAt) : null
    };
  }

  private mapWebHistory(row: Record<string, SqlValue>): WebAutomationHistory {
    return {
      id: Number(row.id),
      jobId: row.jobId === null || row.jobId === undefined ? null : Number(row.jobId),
      username: String(row.username),
      action: row.action === "UNFOLLOW" ? "UNFOLLOW" : "FOLLOW",
      provider: "web",
      status: String(row.status) as WebJobStatus,
      error: row.error ? String(row.error) : null,
      errorCode: row.errorCode ? (String(row.errorCode) as WebErrorCode) : null,
      profileUrl: row.profileUrl ? String(row.profileUrl) : null,
      startedAt: row.startedAt ? String(row.startedAt) : null,
      completedAt: row.completedAt ? String(row.completedAt) : null,
      createdAt: String(row.createdAt)
    };
  }

  private ensureDefaultSettings(): void {
    const existing = this.all<{ key: string }>("SELECT key FROM settings");
    if (existing.length > 0) {
      return;
    }
    this.saveSettings(DEFAULT_SETTINGS);
  }

  private ensureDefaultLists(): void {
    const existing = this.getLists();
    if (existing.length > 0) {
      return;
    }
    this.createList("Takip Listesi", "follow");
    this.createList("Takipten Çıkarma Listesi", "unfollow");
    this.createList("Beyaz Liste", "whitelist");
    this.createList("Kara Liste", "blacklist");
  }

  private removeDemoAccounts(): void {
    this.run(
      `DELETE FROM accounts WHERE username IN ('demo_account', '@demo_account') OR instagramUserId = 'mock-user-1' OR provider = 'mock'`
    );
    this.run(
      `DELETE FROM users WHERE username IN ('demo_account', 'ayse_design', 'mehmet.dev', 'selin.foto', 'ornek', 'studio.nord', 'brand_hub', 'ornek2', 'travel.notes', 'cafe.istanbul')`
    );
  }

  private syncQueueTables(job: AutomationJob): void {
    const table = job.action === "FOLLOW" ? "follow_queue" : "unfollow_queue";
    this.run(
      `UPDATE ${table} SET status = ?, startedAt = ?, completedAt = ?, error = ?, lastActionAt = ? WHERE username = ? AND status IN ('pending', 'processing')`,
      [job.status, job.startedAt, job.completedAt, job.error, nowIso(), job.username]
    );
  }

  private getDb(): Database {
    if (!this.db) {
      throw new Error("Database is not initialized");
    }
    return this.db;
  }

  private run(sql: string, params: SqlValue[] = []): void {
    this.getDb().run(sql, params);
  }

  private get<T>(sql: string, params: SqlValue[] = []): T | null {
    const stmt = this.getDb().prepare(sql);
    stmt.bind(params);
    const row = stmt.step() ? (stmt.getAsObject() as T) : null;
    stmt.free();
    return row;
  }

  private all<T>(sql: string, params: SqlValue[] = []): T[] {
    const stmt = this.getDb().prepare(sql);
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return rows;
  }

  private mapAccount(row: Record<string, SqlValue>): AccountRecord {
    return {
      id: Number(row.id),
      provider: row.provider === "official" ? "official" : "mock",
      instagramUserId: row.instagramUserId ? String(row.instagramUserId) : null,
      username: row.username ? String(row.username) : null,
      displayName: row.displayName ? String(row.displayName) : null,
      profilePicture: row.profilePicture ? String(row.profilePicture) : null,
      connectionStatus: String(row.connectionStatus) as ConnectionStatus,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt)
    };
  }

  private mapUser(row: Record<string, SqlValue>): UserRecord {
    return {
      id: Number(row.id),
      username: String(row.username),
      displayName: row.displayName ? String(row.displayName) : null,
      profilePicture: row.profilePicture ? String(row.profilePicture) : null,
      isFollower: boolFromInt(row.isFollower),
      isFollowing: boolFromInt(row.isFollowing),
      followedAt: row.followedAt ? String(row.followedAt) : null,
      lastActionAt: row.lastActionAt ? String(row.lastActionAt) : null,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt)
    };
  }

  private mapQueue(row: Record<string, SqlValue>): QueueItem {
    return {
      id: Number(row.id),
      username: String(row.username),
      status: String(row.status) as JobStatus,
      createdAt: String(row.createdAt),
      startedAt: row.startedAt ? String(row.startedAt) : null,
      completedAt: row.completedAt ? String(row.completedAt) : null,
      error: row.error ? String(row.error) : null,
      lastActionAt: row.lastActionAt ? String(row.lastActionAt) : null
    };
  }

  private mapJob(row: Record<string, SqlValue>): AutomationJob {
    return {
      id: Number(row.id),
      username: String(row.username),
      action: row.action === "UNFOLLOW" ? "UNFOLLOW" : "FOLLOW",
      status: String(row.status) as JobStatus,
      createdAt: String(row.createdAt),
      startedAt: row.startedAt ? String(row.startedAt) : null,
      completedAt: row.completedAt ? String(row.completedAt) : null,
      error: row.error ? String(row.error) : null,
      duration: row.duration === null || row.duration === undefined ? null : Number(row.duration)
    };
  }

  private mapLog(row: Record<string, SqlValue>): AutomationLog {
    return {
      id: Number(row.id),
      jobId: row.jobId === null || row.jobId === undefined ? null : Number(row.jobId),
      username: String(row.username),
      action: row.action === "UNFOLLOW" ? "UNFOLLOW" : "FOLLOW",
      status: String(row.status) as AutomationLog["status"],
      error: row.error ? String(row.error) : null,
      errorCode: row.errorCode ? (String(row.errorCode) as InstagramErrorCode) : null,
      duration: row.duration === null || row.duration === undefined ? null : Number(row.duration),
      createdAt: String(row.createdAt)
    };
  }

  private mapList(row: Record<string, SqlValue>): ListRecord {
    return {
      id: Number(row.id),
      name: String(row.name),
      type: String(row.type) as ListType,
      createdAt: String(row.createdAt)
    };
  }

  private mapListMember(row: Record<string, SqlValue>): ListMember {
    return {
      id: Number(row.id),
      listId: Number(row.listId),
      username: String(row.username),
      createdAt: String(row.createdAt)
    };
  }
}
