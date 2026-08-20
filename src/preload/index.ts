import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type IpcApi } from "@shared/ipc";
import type { AutomationRuntimeStatus, WebAutomationRuntimeStatus } from "@shared/types";

const api: IpcApi = {
  getDashboardStats: () => ipcRenderer.invoke(IPC_CHANNELS.dashboard.stats),
  getRecentLogs: () => ipcRenderer.invoke(IPC_CHANNELS.dashboard.recent),
  getConnectionStatus: () => ipcRenderer.invoke(IPC_CHANNELS.accounts.status),
  connectAccount: () => ipcRenderer.invoke(IPC_CHANNELS.accounts.connect),
  disconnectAccount: () => ipcRenderer.invoke(IPC_CHANNELS.accounts.disconnect),
  refreshAccount: () => ipcRenderer.invoke(IPC_CHANNELS.accounts.refresh),
  getFollowQueue: () => ipcRenderer.invoke(IPC_CHANNELS.follow.list),
  addFollowUsernames: (usernames) => ipcRenderer.invoke(IPC_CHANNELS.follow.add, usernames),
  importFollowCsv: (csvText) => ipcRenderer.invoke(IPC_CHANNELS.follow.importCsv, csvText),
  enqueueFollowSelected: (ids) => ipcRenderer.invoke(IPC_CHANNELS.follow.enqueueSelected, ids),
  startFollowAutomation: () => ipcRenderer.invoke(IPC_CHANNELS.follow.start),
  stopFollowAutomation: () => ipcRenderer.invoke(IPC_CHANNELS.follow.stop),
  getUnfollowQueue: (filter) => ipcRenderer.invoke(IPC_CHANNELS.unfollow.list, filter),
  enqueueUnfollowSelected: (usernames) => ipcRenderer.invoke(IPC_CHANNELS.unfollow.enqueueSelected, usernames),
  startUnfollowAutomation: () => ipcRenderer.invoke(IPC_CHANNELS.unfollow.start),
  stopUnfollowAutomation: () => ipcRenderer.invoke(IPC_CHANNELS.unfollow.stop),
  getRelationships: (filter, search, page, pageSize) =>
    ipcRenderer.invoke(IPC_CHANNELS.relationships.list, filter, search, page, pageSize),
  getAutomationStatus: () => ipcRenderer.invoke(IPC_CHANNELS.automation.status),
  getAutomationSettings: () => ipcRenderer.invoke(IPC_CHANNELS.automation.settings),
  saveAutomationSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.automation.saveSettings, settings),
  startAutomation: (action) => ipcRenderer.invoke(IPC_CHANNELS.automation.start, action),
  stopAutomation: () => ipcRenderer.invoke(IPC_CHANNELS.automation.stop),
  pauseAutomation: () => ipcRenderer.invoke(IPC_CHANNELS.automation.pause),
  resumeAutomation: () => ipcRenderer.invoke(IPC_CHANNELS.automation.resume),
  clearQueue: () => ipcRenderer.invoke(IPC_CHANNELS.automation.clear),
  cancelInterrupted: () => ipcRenderer.invoke(IPC_CHANNELS.automation.cancelInterrupted),
  getHistory: (filter, search, dateRange) => ipcRenderer.invoke(IPC_CHANNELS.history.list, filter, search, dateRange),
  getLists: () => ipcRenderer.invoke(IPC_CHANNELS.lists.all),
  createList: (name, type) => ipcRenderer.invoke(IPC_CHANNELS.lists.create, name, type),
  getListMembers: (listId) => ipcRenderer.invoke(IPC_CHANNELS.lists.members, listId),
  addListMember: (listId, username) => ipcRenderer.invoke(IPC_CHANNELS.lists.addMember, listId, username),
  removeListMember: (listId, memberId) => ipcRenderer.invoke(IPC_CHANNELS.lists.removeMember, listId, memberId),
  exportListCsv: (listId) => ipcRenderer.invoke(IPC_CHANNELS.lists.exportCsv, listId),
  importListCsv: (listId, csvText) => ipcRenderer.invoke(IPC_CHANNELS.lists.importCsv, listId, csvText),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.settings.get),
  saveSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.settings.save, settings),
  backupDatabase: () => ipcRenderer.invoke(IPC_CHANNELS.data.backup),
  restoreDatabase: () => ipcRenderer.invoke(IPC_CHANNELS.data.restore),
  resetData: () => ipcRenderer.invoke(IPC_CHANNELS.data.reset),
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.app.version),
  getCapabilities: () => ipcRenderer.invoke(IPC_CHANNELS.app.capabilities),
  getMedia: () => ipcRenderer.invoke(IPC_CHANNELS.media.list),
  getWebAutomationStatus: () => ipcRenderer.invoke(IPC_CHANNELS.webAutomation.status),
  loginWebAutomation: () => ipcRenderer.invoke(IPC_CHANNELS.webAutomation.login),
  logoutWebAutomation: () => ipcRenderer.invoke(IPC_CHANNELS.webAutomation.logout),
  checkWebAutomationSession: () => ipcRenderer.invoke(IPC_CHANNELS.webAutomation.checkSession),
  startWebFollow: (usernames) => ipcRenderer.invoke(IPC_CHANNELS.webAutomation.startFollow, usernames),
  startWebUnfollow: (usernames) => ipcRenderer.invoke(IPC_CHANNELS.webAutomation.startUnfollow, usernames),
  pauseWebAutomation: () => ipcRenderer.invoke(IPC_CHANNELS.webAutomation.pause),
  resumeWebAutomation: () => ipcRenderer.invoke(IPC_CHANNELS.webAutomation.resume),
  restartWebAutomation: () => ipcRenderer.invoke(IPC_CHANNELS.webAutomation.restart),
  stopWebAutomation: () => ipcRenderer.invoke(IPC_CHANNELS.webAutomation.stop),
  getWebAutomationQueue: (action) => ipcRenderer.invoke(IPC_CHANNELS.webAutomation.getQueue, action),
  getWebAutomationHistory: (search, dateRange) =>
    ipcRenderer.invoke(IPC_CHANNELS.webAutomation.getHistory, search, dateRange),
  onAutomationStatus: (callback) => {
    const listener = (_event: unknown, status: AutomationRuntimeStatus) => callback(status);
    ipcRenderer.on(IPC_CHANNELS.events.automation, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.events.automation, listener);
  },
  onWebAutomationStatus: (callback) => {
    const listener = (_event: unknown, status: WebAutomationRuntimeStatus) => callback(status);
    ipcRenderer.on(IPC_CHANNELS.events.webAutomation, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.events.webAutomation, listener);
  },
  onToast: (callback) => {
    const listener = (_event: unknown, payload: { type: "info" | "success" | "error"; message: string }) =>
      callback(payload);
    ipcRenderer.on(IPC_CHANNELS.events.toast, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.events.toast, listener);
  }
};

try {
  contextBridge.exposeInMainWorld("api", api);
} catch (error) {
  console.error("[Preload] contextBridge failed", error);
}
