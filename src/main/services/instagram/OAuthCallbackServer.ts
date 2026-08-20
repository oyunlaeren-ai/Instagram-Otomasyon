import http from "node:http";
import { AuthRequiredError } from "@shared/errors";
import { createLogger } from "../logging/logger";
import {
  interpretOAuthCallback,
  normalizeCallbackPath
} from "./instagramOAuth";

const log = createLogger("[OAuthCallback]");

const SUCCESS_HTML = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Instagram bağlantısı</title></head><body style="font-family:sans-serif;background:#0b1220;color:#e8eef8;padding:48px;"><h1>Instagram bağlantısı tamamlandı</h1><p>Bu pencereyi kapatıp uygulamaya dönebilirsiniz.</p></body></html>`;
const ERROR_HTML = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Instagram bağlantısı</title></head><body style="font-family:sans-serif;background:#0b1220;color:#e8eef8;padding:48px;"><h1>Bağlantı tamamlanamadı</h1><p>Bu pencereyi kapatıp uygulamadaki mesajı kontrol edin.</p></body></html>`;
const TEST_HTML = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>OAuth listener</title></head><body style="font-family:sans-serif;background:#0b1220;color:#e8eef8;padding:48px;"><h1>OAuth callback dinleyicisi çalışıyor</h1><p>127.0.0.1 dinliyor. Bu test isteği OAuth oturumunu kapatmaz.</p></body></html>`;

export const OAUTH_LISTENER_PROBE_PATH = "/__iam-oauth-listener";
export const OAUTH_LISTENER_APP_ID = "instagram-automation-manager";

export interface LocalCallbackWaitOptions {
  expectedState: string;
  redirectPath: string;
  port: number;
  timeoutMs?: number;
}

export interface OAuthListenerIdentity {
  app: string;
  pid: number;
}

type PendingWait = {
  expectedState: string;
  expectedPath: string;
  resolve: (code: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EADDRINUSE";
}

function portBusyMessage(port: number, ours: boolean): string {
  if (ours) {
    return "Instagram girişi zaten devam ediyor. Tarayıcıdaki pencereyi tamamlayın veya uygulamayı yeniden başlatın.";
  }
  return `Yerel OAuth dinleyicisi 127.0.0.1:${port} üzerinde başlatılamadı; port başka bir uygulama tarafından kullanılıyor. Cloudflare Tunnel aynı porta yönlenmeli. Bu süreç diğer uygulamayı durdurmaz.`;
}

export async function probeOAuthListener(port: number): Promise<OAuthListenerIdentity | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 400);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${OAUTH_LISTENER_PROBE_PATH}`, {
      signal: controller.signal
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as Partial<OAuthListenerIdentity>;
    if (payload.app === OAUTH_LISTENER_APP_ID && typeof payload.pid === "number") {
      return { app: payload.app, pid: payload.pid };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export class OAuthCallbackListener {
  private server: http.Server | null = null;
  private port: number | null = null;
  private pending: PendingWait | null = null;
  private sessionActive = false;
  private closing: Promise<void> | null = null;

  isWaiting(): boolean {
    return this.pending !== null || this.sessionActive;
  }

  isListening(): boolean {
    return this.server?.listening === true;
  }

  async start(port: number): Promise<void> {
    log.info(`server starting 127.0.0.1:${port}`);
    await this.ensureListening(port);
    log.info(`server listening on 127.0.0.1:${port}`);
    log.info("main process still running; waiting for oauth callback");
  }

  async waitForCallback(
    options: LocalCallbackWaitOptions,
    onListening?: () => void | Promise<void>
  ): Promise<string> {
    if (this.pending || this.sessionActive) {
      throw new AuthRequiredError(
        "Instagram girişi zaten devam ediyor. Tarayıcıdaki Instagram penceresini tamamlayın."
      );
    }
    this.sessionActive = true;

    try {
      await this.start(options.port);
    } catch (error) {
      this.sessionActive = false;
      throw error;
    }

    const code = await new Promise<string>((resolve, reject) => {
      this.pending = {
        expectedState: options.expectedState,
        expectedPath: normalizeCallbackPath(options.redirectPath),
        resolve,
        reject,
        timer: setTimeout(() => {
          this.settlePending({
            ok: false,
            reason: "cancelled",
            message: "OAuth zaman aşımına uğradı. Instagram girişini tamamlayıp tekrar deneyin."
          });
        }, options.timeoutMs ?? 5 * 60 * 1000)
      };
      void Promise.resolve(onListening?.()).catch((error: unknown) => {
        this.settlePending({
          ok: false,
          reason: "cancelled",
          message: error instanceof Error ? error.message : "Instagram yetkilendirme penceresi açılamadı."
        });
      });
    });

    return code;
  }

  async close(): Promise<void> {
    this.settlePending({
      ok: false,
      reason: "cancelled",
      message: "OAuth dinleyicisi kapatıldı."
    });
    await this.closeServer();
  }

  private async ensureListening(port: number): Promise<void> {
    if (this.closing) {
      await this.closing;
    }
    if (this.server?.listening && this.port === port) {
      log.info(`server already listening on 127.0.0.1:${port}`);
      return;
    }
    if (this.server) {
      await this.closeServer();
    }

    try {
      await this.listen(port);
    } catch (error) {
      if (!isAddressInUse(error)) {
        throw error instanceof Error ? error : new AuthRequiredError("Yerel OAuth callback sunucusu başlatılamadı.");
      }
      const identity = await probeOAuthListener(port);
      if (identity?.pid === process.pid) {
        if (this.server?.listening && this.port === port) {
          return;
        }
        throw new AuthRequiredError(portBusyMessage(port, true));
      }
      if (identity?.app === OAUTH_LISTENER_APP_ID) {
        throw new AuthRequiredError(portBusyMessage(port, true));
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      try {
        await this.listen(port);
      } catch (retryError) {
        if (isAddressInUse(retryError)) {
          const retryIdentity = await probeOAuthListener(port);
          throw new AuthRequiredError(portBusyMessage(port, retryIdentity?.app === OAUTH_LISTENER_APP_ID));
        }
        throw retryError instanceof Error
          ? retryError
          : new AuthRequiredError("Yerel OAuth callback sunucusu başlatılamadı.");
      }
    }
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        this.handleRequest(request, response, port);
      });
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        this.server = server;
        this.port = port;
        server.on("error", (error) => {
          log.error(`server error: ${error.message}`);
          this.settlePending({
            ok: false,
            reason: "cancelled",
            message: error.message
          });
        });
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
  }

  private handleRequest(request: http.IncomingMessage, response: http.ServerResponse, port: number): void {
    const method = (request.method ?? "GET").toUpperCase();
    const host = request.headers.host ?? `127.0.0.1:${port}`;
    const url = new URL(request.url ?? "/", `http://${host}`);
    const path = normalizeCallbackPath(url.pathname);
    log.info("request received");
    log.info(`request path: ${path}`);
    log.info(`request method: ${method}`);
    log.info(
      `query received: code=${url.searchParams.has("code")} state=${url.searchParams.has("state")} error=${url.searchParams.has("error")} test=${url.searchParams.get("test") === "1"}`
    );

    if (method !== "GET" && method !== "HEAD") {
      response.statusCode = 405;
      response.setHeader("Allow", "GET, HEAD");
      response.end("Method not allowed");
      return;
    }

    if (path === OAUTH_LISTENER_PROBE_PATH || path === "/") {
      this.writeLiveness(response, method, path === "/" ? "ok" : JSON.stringify({ app: OAUTH_LISTENER_APP_ID, pid: process.pid }));
      return;
    }

    if (url.searchParams.get("test") === "1") {
      log.info("diagnostic test request accepted; oauth session kept open");
      this.writeHtml(response, method, 200, TEST_HTML);
      return;
    }

    if (!this.pending) {
      response.statusCode = 409;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end("OAuth beklenmiyor.");
      return;
    }

    const result = interpretOAuthCallback(url, this.pending.expectedState, this.pending.expectedPath);
    if (!result.ok && result.reason === "wrong_path") {
      response.statusCode = 404;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end("Not found");
      return;
    }
    if (!result.ok && (result.reason === "missing_code" || result.reason === "invalid_state")) {
      log.info(`incomplete oauth query ignored: ${result.reason}`);
      this.writeHtml(response, method, 200, TEST_HTML);
      return;
    }

    response.statusCode = result.ok ? 200 : 400;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(result.ok ? SUCCESS_HTML : ERROR_HTML);
    this.settlePending(result);
  }

  private writeLiveness(response: http.ServerResponse, method: string, body: string): void {
    response.statusCode = 200;
    response.setHeader("Content-Type", body.startsWith("{") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8");
    if (method === "HEAD") {
      response.end();
      return;
    }
    response.end(body);
  }

  private writeHtml(response: http.ServerResponse, method: string, status: number, html: string): void {
    response.statusCode = status;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (method === "HEAD") {
      response.end();
      return;
    }
    response.end(html);
  }

  private settlePending(
    result: ReturnType<typeof interpretOAuthCallback> | { ok: false; reason: "cancelled"; message: string }
  ): void {
    const pending = this.pending;
    if (!pending) {
      return;
    }
    this.pending = null;
    this.sessionActive = false;
    clearTimeout(pending.timer);
    void this.closeServer().then(() => {
      if (result.ok) {
        pending.resolve(result.code);
        return;
      }
      pending.reject(new AuthRequiredError(result.message));
    });
  }

  private closeServer(): Promise<void> {
    if (this.closing) {
      return this.closing;
    }
    const server = this.server;
    this.server = null;
    const port = this.port;
    this.port = null;
    if (!server) {
      return Promise.resolve();
    }
    log.info(port ? `server closing 127.0.0.1:${port}` : "server closing");
    const closing = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    this.closing = closing;
    void closing.finally(() => {
      if (this.closing === closing) {
        this.closing = null;
      }
    });
    return closing;
  }
}

let sharedListener: OAuthCallbackListener | null = null;

export function getOAuthCallbackListener(): OAuthCallbackListener {
  if (!sharedListener) {
    sharedListener = new OAuthCallbackListener();
  }
  return sharedListener;
}

export async function closeOAuthCallbackListener(): Promise<void> {
  if (!sharedListener) {
    return;
  }
  await sharedListener.close();
}

export async function waitForLocalOAuthCallback(
  options: LocalCallbackWaitOptions,
  onListening?: () => void | Promise<void>
): Promise<string> {
  return getOAuthCallbackListener().waitForCallback(options, onListening);
}
