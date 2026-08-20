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
  UserRecord
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
  RelationshipFilter
} from "@shared/constants";

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
