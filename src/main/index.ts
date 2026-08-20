import { app, BrowserWindow, Notification, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { DatabaseService } from "./database/DatabaseService";
import { registerIpc } from "./ipc/registerIpc";
import { JobQueue } from "./services/automation/JobQueue";
import { ActionLogger } from "./services/automation/ActionLogger";
import { RateLimiter } from "./services/automation/RateLimiter";
import { ActionWorker } from "./services/automation/ActionWorker";
import { AutomationManager } from "./services/automation/AutomationManager";
import { WebAutomationEngine } from "./services/automation/WebAutomationEngine";
import { InstagramServiceFactory } from "./services/instagram/InstagramServiceFactory";
import { InstagramAuthService } from "./services/instagram/InstagramAuthService";
import { closeOAuthCallbackListener } from "./services/instagram/OAuthCallbackServer";
import { ElectronInstagramWebDriver } from "./services/instagram/ElectronInstagramWebDriver";
import { WebInstagramAutomationService } from "./services/instagram/WebInstagramAutomationService";
import { EncryptedFileTokenStore } from "./services/security/TokenStore";
import { RotatingFileLogger } from "./services/logging/FileLogger";
import { IPC_CHANNELS } from "@shared/ipc";
import type { InstagramService } from "./services/instagram/InstagramService";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolvePreload(): string {
  const mjs = path.join(__dirname, "../preload/index.mjs");
  const js = path.join(__dirname, "../preload/index.js");
  return fs.existsSync(mjs) ? mjs : js;
}

function wasmPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "sql-wasm.wasm");
  }
  return path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
}

function loadEnv(userData: string): void {
  loadDotenv({ path: path.join(process.cwd(), ".env") });
  loadDotenv({ path: path.join(userData, ".env"), override: true });
}

function createTokenStore(userData: string) {
  const tokenPath = path.join(userData, "secure", "instagram-tokens.bin");
  return new EncryptedFileTokenStore(
    tokenPath,
    (plain) => {
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.encryptString(plain).toString("base64");
      }
      return Buffer.from(plain, "utf8").toString("base64");
    },
    (cipher) => {
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(cipher, "base64"));
      }
      return Buffer.from(cipher, "base64").toString("utf8");
    },
    fs,
    path
  );
}

function createWindow(): BrowserWindow {
  const preloadPath = resolvePreload();
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  console.log("[Electron] preload", preloadPath);
  console.log("[Electron] renderer URL", rendererUrl ?? "(production loadFile)");

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#0b1220",
    show: true,
    autoHideMenuBar: true,
    icon: path.join(process.cwd(), "assets", "icon.png"),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[Renderer console:${level}] ${message} (${sourceId}:${line})`);
  });
  window.webContents.on("did-fail-load", (_event, code, desc, url) => {
    console.error("[Electron] did-fail-load", code, desc, url);
  });
  window.webContents.on("preload-error", (_event, preload, error) => {
    console.error("[Electron] preload-error", preload, error);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[Electron] render-process-gone", details.reason);
    window.reload();
  });

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return window;
}

app.whenReady().then(async () => {
  const userData = app.getPath("userData");
  loadEnv(userData);
  const fileLogger = new RotatingFileLogger(path.join(userData, "logs"));
  process.on("uncaughtException", (error) => {
    fileLogger.write("error", error.message);
  });
  process.on("unhandledRejection", (reason) => {
    fileLogger.write("error", reason instanceof Error ? reason.message : String(reason));
  });

  const database = new DatabaseService(path.join(userData, "instagram-automation.sqlite"), wasmPath());
  await database.initialize();

  const tokenStore = createTokenStore(userData);
  const factory = new InstagramServiceFactory(tokenStore);
  const service: InstagramService = factory.create();
  const getService = () => service;

  const queue = new JobQueue(database);
  queue.restoreInterrupted();
  const logger = new ActionLogger(database);
  const rateLimiter = new RateLimiter(database.getSettings().actionDelaySeconds * 1000);
  const worker = new ActionWorker(queue, logger, rateLimiter, getService);

  const notify = (message: string) => {
    mainWindow?.webContents.send(IPC_CHANNELS.events.toast, { type: "info", message });
    if (database.getSettings().notifications && Notification.isSupported()) {
      new Notification({ title: "Instagram Automation Manager", body: message }).show();
    }
    fileLogger.write("app", message);
  };

  const automation = new AutomationManager(database, queue, worker, rateLimiter, getService, notify);
  const auth = new InstagramAuthService(database, tokenStore, getService);
  const webDriver = new ElectronInstagramWebDriver();
  const webAutomation = new WebInstagramAutomationService(database, webDriver);
  const webEngine = new WebAutomationEngine(
    database,
    webAutomation,
    () => Math.max(5, database.getSettings().actionDelaySeconds) * 1000,
    notify
  );

  let mainWindow: BrowserWindow | null = createWindow();

  registerIpc({
    database,
    automation,
    queue,
    auth,
    getService,
    getWindow: () => mainWindow,
    reinitializeDatabase: async () => {
      await database.initialize();
    },
    webAutomation,
    webEngine
  });

  automation.onStatus((status) => {
    mainWindow?.webContents.send(IPC_CHANNELS.events.automation, status);
  });
  webEngine.onStatus((status) => {
    mainWindow?.webContents.send(IPC_CHANNELS.events.webAutomation, status);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });

  const shutdownListener = () => {
    void closeOAuthCallbackListener();
  };
  app.on("before-quit", () => {
    shutdownListener();
    void automation.stop();
    void webEngine.stop();
    database.close();
  });
  app.on("will-quit", shutdownListener);
  process.once("SIGINT", shutdownListener);
  process.once("SIGTERM", shutdownListener);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
