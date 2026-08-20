import type {
  AppSettings,
  AutomationLog,
  AutomationRuntimeStatus,
  ConnectionSnapshot,
  DashboardStats,
  HistoryDateRange,
  HistoryFilter,
  InstagramCapabilities,
  InstagramMediaItem,
  ListMember,
  ListRecord,
  PaginatedResult,
  QueueItem,
  RelationshipFilter,
  UnfollowFilter,
  UserRecord
} from "./types";
import type { ActionType, ListType } from "./constants";

export const IPC_CHANNELS = {
  dashboard: { stats: "dashboard:stats", recent: "dashboard:recent" },
  accounts: {
    status: "accounts:status",
    connect: "accounts:connect",
    disconnect: "accounts:disconnect",
    refresh: "accounts:refresh"
  },
  follow: {
    list: "follow:list",
    add: "follow:add",
    importCsv: "follow:importCsv",
    enqueueSelected: "follow:enqueueSelected",
    start: "follow:start",
    stop: "follow:stop"
  },
  unfollow: {
    list: "unfollow:list",
    enqueueSelected: "unfollow:enqueueSelected",
    start: "unfollow:start",
    stop: "unfollow:stop"
  },
  relationships: { list: "relationships:list" },
  automation: {
    status: "automation:status",
    settings: "automation:settings",
    saveSettings: "automation:saveSettings",
    start: "automation:start",
    stop: "automation:stop",
    pause: "automation:pause",
    resume: "automation:resume",
    clear: "automation:clear",
    cancelInterrupted: "automation:cancelInterrupted"
  },
  history: { list: "history:list" },
  lists: {
    all: "lists:all",
    create: "lists:create",
    addMember: "lists:addMember",
    removeMember: "lists:removeMember",
    members: "lists:members",
    exportCsv: "lists:exportCsv",
    importCsv: "lists:importCsv"
  },
  settings: { get: "settings:get", save: "settings:save" },
  data: { backup: "data:backup", restore: "data:restore", reset: "data:reset" },
  app: { version: "app:version", capabilities: "app:capabilities" },
  media: { list: "media:list" },
  events: { automation: "event:automation", toast: "event:toast" }
} as const;

export const IPC_CHANNEL_LIST = Object.values(IPC_CHANNELS).flatMap((group) => Object.values(group));

export interface IpcApi {
  getDashboardStats: () => Promise<DashboardStats>;
  getRecentLogs: () => Promise<AutomationLog[]>;
  getConnectionStatus: () => Promise<ConnectionSnapshot>;
  connectAccount: () => Promise<ConnectionSnapshot>;
  disconnectAccount: () => Promise<ConnectionSnapshot>;
  refreshAccount: () => Promise<ConnectionSnapshot>;
  getFollowQueue: () => Promise<QueueItem[]>;
  addFollowUsernames: (usernames: string[]) => Promise<QueueItem[]>;
  importFollowCsv: (csvText: string) => Promise<QueueItem[]>;
  enqueueFollowSelected: (ids: number[]) => Promise<void>;
  startFollowAutomation: () => Promise<AutomationRuntimeStatus>;
  stopFollowAutomation: () => Promise<AutomationRuntimeStatus>;
  getUnfollowQueue: (filter: UnfollowFilter) => Promise<UserRecord[]>;
  enqueueUnfollowSelected: (usernames: string[]) => Promise<void>;
  startUnfollowAutomation: () => Promise<AutomationRuntimeStatus>;
  stopUnfollowAutomation: () => Promise<AutomationRuntimeStatus>;
  getRelationships: (
    filter: RelationshipFilter,
    search: string,
    page: number,
    pageSize: number
  ) => Promise<PaginatedResult<UserRecord>>;
  getAutomationStatus: () => Promise<AutomationRuntimeStatus>;
  getAutomationSettings: () => Promise<AppSettings>;
  saveAutomationSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  startAutomation: (action?: ActionType) => Promise<AutomationRuntimeStatus>;
  stopAutomation: () => Promise<AutomationRuntimeStatus>;
  pauseAutomation: () => Promise<AutomationRuntimeStatus>;
  resumeAutomation: () => Promise<AutomationRuntimeStatus>;
  clearQueue: () => Promise<AutomationRuntimeStatus>;
  cancelInterrupted: () => Promise<void>;
  getHistory: (
    filter: HistoryFilter,
    search: string,
    dateRange: HistoryDateRange
  ) => Promise<AutomationLog[]>;
  getLists: () => Promise<ListRecord[]>;
  createList: (name: string, type: ListType) => Promise<ListRecord>;
  getListMembers: (listId: number) => Promise<ListMember[]>;
  addListMember: (listId: number, username: string) => Promise<ListMember[]>;
  removeListMember: (listId: number, memberId: number) => Promise<ListMember[]>;
  exportListCsv: (listId: number) => Promise<string>;
  importListCsv: (listId: number, csvText: string) => Promise<ListMember[]>;
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  backupDatabase: () => Promise<string | null>;
  restoreDatabase: () => Promise<boolean>;
  resetData: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  getCapabilities: () => Promise<InstagramCapabilities>;
  getMedia: () => Promise<InstagramMediaItem[]>;
  onAutomationStatus: (callback: (status: AutomationRuntimeStatus) => void) => () => void;
  onToast: (callback: (payload: { type: "info" | "success" | "error"; message: string }) => void) => () => void;
}
