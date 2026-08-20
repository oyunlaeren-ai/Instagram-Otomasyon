import { BrowserWindow, app, dialog, ipcMain } from "electron";
import fs from "node:fs";
import { IPC_CHANNELS } from "@shared/ipc";
import type { ActionType, HistoryDateRange } from "@shared/constants";
import { parseCsvUsernames, sanitizeUsername, toCsv, toUserMessage } from "@shared/utils";
import { InstagramServiceError } from "@shared/errors";
import type { DatabaseService } from "../database/DatabaseService";
import type { AutomationManager } from "../services/automation/AutomationManager";
import type { JobQueue } from "../services/automation/JobQueue";
import type { InstagramAuthService } from "../services/instagram/InstagramAuthService";
import type { InstagramService } from "../services/instagram/InstagramService";
import type { WebInstagramAutomationService } from "../services/instagram/WebInstagramAutomationService";
import type { WebAutomationEngine } from "../services/automation/WebAutomationEngine";

export interface IpcContext {
  database: DatabaseService;
  automation: AutomationManager;
  queue: JobQueue;
  auth: InstagramAuthService;
  getService: () => InstagramService;
  getWindow: () => BrowserWindow | null;
  reinitializeDatabase: () => Promise<void>;
  webAutomation: WebInstagramAutomationService;
  webEngine: WebAutomationEngine;
}

function wrap<T>(fn: () => Promise<T> | T): Promise<T> {
  return Promise.resolve()
    .then(fn)
    .catch((error: unknown) => {
      if (error instanceof InstagramServiceError) {
        throw new Error(error.message);
      }
      throw new Error(toUserMessage(error));
    });
}

function cleanUsernames(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const username = sanitizeUsername(value);
    if (username) {
      unique.add(username);
    }
  }
  return [...unique];
}

export function registerIpc(context: IpcContext): void {
  const { database, automation, queue, auth, getService, getWindow, reinitializeDatabase, webAutomation, webEngine } =
    context;

  ipcMain.handle(IPC_CHANNELS.dashboard.stats, () =>
    wrap(async () => {
      const service = getService();
      const connection = await auth.getConnectionStatus();
      if (!connection.connected) {
        return {
          followers: null,
          following: null,
          notFollowingBack: null,
          todayFollows: database.countTodayActions("FOLLOW"),
          todayUnfollows: database.countTodayActions("UNFOLLOW"),
          successCount: database.countJobs("success"),
          failedCount: database.countJobs("failed"),
          followersSupported: false,
          followingSupported: false,
          notFollowingSupported: false
        };
      }
      const capabilities = service.getCapabilities();
      return {
        followers: connection.profile?.followersCount ?? null,
        following: connection.profile?.followingCount ?? null,
        notFollowingBack: null,
        todayFollows: database.countTodayActions("FOLLOW"),
        todayUnfollows: database.countTodayActions("UNFOLLOW"),
        successCount: database.countJobs("success"),
        failedCount: database.countJobs("failed"),
        followersSupported: Boolean(connection.profile?.countsSupported && connection.profile.followersCount !== null),
        followingSupported: Boolean(connection.profile?.countsSupported && connection.profile.followingCount !== null),
        notFollowingSupported: capabilities.canGetFollowers && capabilities.canGetFollowing
      };
    })
  );

  ipcMain.handle(IPC_CHANNELS.dashboard.recent, () => wrap(() => database.getRecentLogs()));
  ipcMain.handle(IPC_CHANNELS.accounts.status, () => wrap(() => auth.getConnectionStatus()));
  ipcMain.handle(IPC_CHANNELS.accounts.connect, () => wrap(() => auth.connect()));
  ipcMain.handle(IPC_CHANNELS.accounts.disconnect, () => wrap(() => auth.disconnect()));
  ipcMain.handle(IPC_CHANNELS.accounts.refresh, () => wrap(() => auth.refreshConnection()));

  ipcMain.handle(IPC_CHANNELS.follow.list, () => wrap(() => database.getFollowQueue()));
  ipcMain.handle(IPC_CHANNELS.follow.add, (_event, usernames: unknown) =>
    wrap(() => database.addFollowQueueItems(cleanUsernames(usernames)))
  );
  ipcMain.handle(IPC_CHANNELS.follow.importCsv, (_event, csvText: unknown) =>
    wrap(() => database.addFollowQueueItems(parseCsvUsernames(typeof csvText === "string" ? csvText : "")))
  );
  ipcMain.handle(IPC_CHANNELS.follow.enqueueSelected, (_event, ids: unknown) =>
    wrap(() => {
      const selected = Array.isArray(ids) ? ids.filter((id): id is number => typeof id === "number") : [];
      const items = database.getFollowQueue().filter((item) => selected.includes(item.id));
      queue.enqueueMany(
        items.map((item) => item.username),
        "FOLLOW"
      );
    })
  );
  ipcMain.handle(IPC_CHANNELS.follow.start, () => wrap(() => automation.start("FOLLOW")));
  ipcMain.handle(IPC_CHANNELS.follow.stop, () => wrap(() => automation.stop()));

  ipcMain.handle(IPC_CHANNELS.unfollow.list, (_event, filter: "not_following_back" | "selected" | "blacklisted") =>
    wrap(() => database.getUnfollowCandidates(filter))
  );
  ipcMain.handle(IPC_CHANNELS.unfollow.enqueueSelected, (_event, usernames: unknown) =>
    wrap(() => {
      const whitelist = new Set(database.getWhitelistedUsernames());
      const filtered = cleanUsernames(usernames).filter((username) => !whitelist.has(username));
      database.addUnfollowQueueItems(filtered);
      queue.enqueueMany(filtered, "UNFOLLOW");
    })
  );
  ipcMain.handle(IPC_CHANNELS.unfollow.start, () => wrap(() => automation.start("UNFOLLOW")));
  ipcMain.handle(IPC_CHANNELS.unfollow.stop, () => wrap(() => automation.stop()));

  ipcMain.handle(
    IPC_CHANNELS.relationships.list,
    (_event, filter: "all" | "not_following" | "following" | "mutual", search: unknown, page: unknown, pageSize: unknown) =>
      wrap(() => {
        const safePage = typeof page === "number" && page > 0 ? page : 1;
        const safeSize = typeof pageSize === "number" && pageSize > 0 && pageSize <= 100 ? pageSize : 8;
        const result = database.getUsers(filter, typeof search === "string" ? search : "", safePage, safeSize);
        return { ...result, page: safePage, pageSize: safeSize };
      })
  );

  ipcMain.handle(IPC_CHANNELS.automation.status, () => wrap(() => automation.getStatus()));
  ipcMain.handle(IPC_CHANNELS.automation.settings, () => wrap(() => database.getSettings()));
  ipcMain.handle(IPC_CHANNELS.automation.saveSettings, (_event, settings) =>
    wrap(() => database.saveSettings(settings))
  );
  ipcMain.handle(IPC_CHANNELS.automation.start, (_event, action?: ActionType) => wrap(() => automation.start(action)));
  ipcMain.handle(IPC_CHANNELS.automation.stop, () => wrap(() => automation.stop()));
  ipcMain.handle(IPC_CHANNELS.automation.pause, () => wrap(() => automation.pause()));
  ipcMain.handle(IPC_CHANNELS.automation.resume, () => wrap(() => automation.resume()));
  ipcMain.handle(IPC_CHANNELS.automation.clear, () => wrap(() => automation.clearQueue()));
  ipcMain.handle(IPC_CHANNELS.automation.cancelInterrupted, () => wrap(() => automation.cancelInterrupted()));

  ipcMain.handle(IPC_CHANNELS.history.list, (_event, filter, search: unknown, dateRange) =>
    wrap(() => database.getLogs(filter, typeof search === "string" ? search : "", dateRange ?? "all"))
  );

  ipcMain.handle(IPC_CHANNELS.lists.all, () => wrap(() => database.getLists()));
  ipcMain.handle(IPC_CHANNELS.lists.create, (_event, name: unknown, type) =>
    wrap(() => database.createList(typeof name === "string" ? name.trim() : "Liste", type))
  );
  ipcMain.handle(IPC_CHANNELS.lists.members, (_event, listId: unknown) =>
    wrap(() => database.getListMembers(typeof listId === "number" ? listId : 0))
  );
  ipcMain.handle(IPC_CHANNELS.lists.addMember, (_event, listId: unknown, username: unknown) =>
    wrap(() => {
      const cleaned = sanitizeUsername(typeof username === "string" ? username : "");
      if (!cleaned || typeof listId !== "number") {
        throw new Error("Geçerli bir kullanıcı adı girin.");
      }
      return database.addListMember(listId, cleaned);
    })
  );
  ipcMain.handle(IPC_CHANNELS.lists.removeMember, (_event, listId: unknown, memberId: unknown) =>
    wrap(() => database.removeListMember(typeof listId === "number" ? listId : 0, typeof memberId === "number" ? memberId : 0))
  );
  ipcMain.handle(IPC_CHANNELS.lists.exportCsv, (_event, listId: unknown) =>
    wrap(() => toCsv(database.getListMembers(typeof listId === "number" ? listId : 0).map((member) => member.username)))
  );
  ipcMain.handle(IPC_CHANNELS.lists.importCsv, (_event, listId: unknown, csvText: unknown) =>
    wrap(() => {
      if (typeof listId !== "number") {
        throw new Error("Liste seçilmedi.");
      }
      const names = parseCsvUsernames(typeof csvText === "string" ? csvText : "");
      for (const name of names) {
        database.addListMember(listId, name);
      }
      return database.getListMembers(listId);
    })
  );

  ipcMain.handle(IPC_CHANNELS.settings.get, () => wrap(() => database.getSettings()));
  ipcMain.handle(IPC_CHANNELS.settings.save, (_event, settings) => wrap(() => database.saveSettings(settings)));

  ipcMain.handle(IPC_CHANNELS.data.backup, () =>
    wrap(async () => {
      const window = getWindow();
      const options = {
        title: "Veritabanını yedekle",
        defaultPath: "instagram-automation-backup.sqlite",
        filters: [{ name: "SQLite", extensions: ["sqlite"] }]
      };
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) {
        return null;
      }
      database.persist();
      fs.copyFileSync(database.getFilePath(), result.filePath);
      return result.filePath;
    })
  );

  ipcMain.handle(IPC_CHANNELS.data.restore, () =>
    wrap(async () => {
      const window = getWindow();
      const options = {
        title: "Yedeği geri yükle",
        filters: [{ name: "SQLite", extensions: ["sqlite"] as string[] }],
        properties: ["openFile" as const]
      };
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      const file = result.filePaths[0];
      if (result.canceled || !file) {
        return false;
      }
      const header = fs.readFileSync(file).subarray(0, 16).toString("utf8");
      if (!header.startsWith("SQLite format 3")) {
        throw new Error("Seçilen dosya geçerli bir veritabanı değil.");
      }
      database.replaceFromFile(file);
      await reinitializeDatabase();
      return true;
    })
  );

  ipcMain.handle(IPC_CHANNELS.data.reset, () =>
    wrap(async () => {
      await webEngine.stop();
      await webAutomation.logout();
      database.resetUserData();
    })
  );
  ipcMain.handle(IPC_CHANNELS.app.version, () => wrap(() => app.getVersion()));
  ipcMain.handle(IPC_CHANNELS.app.capabilities, () => wrap(() => getService().getCapabilities()));
  ipcMain.handle(IPC_CHANNELS.media.list, () =>
    wrap(async () => {
      try {
        return await getService().getMedia();
      } catch (error) {
        if (error instanceof InstagramServiceError) {
          return [];
        }
        throw error;
      }
    })
  );

  ipcMain.handle(IPC_CHANNELS.webAutomation.status, () => wrap(() => webEngine.getStatus()));
  ipcMain.handle(IPC_CHANNELS.webAutomation.login, () => wrap(() => webAutomation.login()));
  ipcMain.handle(IPC_CHANNELS.webAutomation.logout, () => wrap(() => webAutomation.logout()));
  ipcMain.handle(IPC_CHANNELS.webAutomation.checkSession, () => wrap(() => webAutomation.checkSession()));
  ipcMain.handle(IPC_CHANNELS.webAutomation.startFollow, (_event, usernames: unknown) =>
    wrap(() => {
      const names = cleanUsernames(usernames);
      const fallback = names.length ? names : database.getFollowQueue().map((item) => item.username);
      return webEngine.startFollow(fallback);
    })
  );
  ipcMain.handle(IPC_CHANNELS.webAutomation.startUnfollow, (_event, usernames: unknown) =>
    wrap(() => {
      const names = cleanUsernames(usernames);
      if (names.length) {
        database.addUnfollowQueueItems(names);
      }
      const fallback = names.length ? names : database.getUnfollowQueueItems().map((item) => item.username);
      return webEngine.startUnfollow(fallback);
    })
  );
  ipcMain.handle(IPC_CHANNELS.webAutomation.pause, () => wrap(() => webEngine.pause()));
  ipcMain.handle(IPC_CHANNELS.webAutomation.resume, () => wrap(() => webEngine.resume()));
  ipcMain.handle(IPC_CHANNELS.webAutomation.restart, () => wrap(() => webEngine.restart()));
  ipcMain.handle(IPC_CHANNELS.webAutomation.stop, () => wrap(() => webEngine.stop()));
  ipcMain.handle(IPC_CHANNELS.webAutomation.getQueue, (_event, action: ActionType) =>
    wrap(() => database.getWebJobs(action === "UNFOLLOW" ? "UNFOLLOW" : "FOLLOW"))
  );
  ipcMain.handle(IPC_CHANNELS.webAutomation.getHistory, (_event, search: unknown, dateRange: HistoryDateRange) =>
    wrap(() => database.getWebHistory(typeof search === "string" ? search : "", dateRange ?? "all"))
  );
}
