import { config as loadDotenv } from "dotenv";
import { DEFAULT_PROTOCOL_PORT } from "@shared/constants";
import type { InstagramProvider } from "@shared/constants";
import { resolveInstagramRedirectUri, validateHttpsRedirectUri } from "./services/instagram/instagramOAuth";

loadDotenv();

export interface AppConfig {
  instagramProvider: InstagramProvider;
  metaAppId: string;
  metaAppSecret: string;
  redirectUri: string;
  oauthCallbackPort: number;
  tunnelOrigin: string;
}

function readProvider(): InstagramProvider {
  const value = (process.env.INSTAGRAM_PROVIDER ?? "official").toLowerCase();
  return value === "mock" ? "mock" : "official";
}

function readCallbackPort(): number {
  const raw = process.env.OAUTH_CALLBACK_PORT?.trim();
  if (!raw) {
    return DEFAULT_PROTOCOL_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return DEFAULT_PROTOCOL_PORT;
  }
  return port;
}

export function getAppConfig(): AppConfig {
  return {
    instagramProvider: readProvider(),
    metaAppId: process.env.META_APP_ID?.trim() ?? "",
    metaAppSecret: process.env.META_APP_SECRET?.trim() ?? "",
    redirectUri: resolveInstagramRedirectUri(),
    oauthCallbackPort: readCallbackPort(),
    tunnelOrigin: process.env.INSTAGRAM_TUNNEL_ORIGIN?.trim() ?? ""
  };
}

export function isOfficialConfigured(config = getAppConfig()): boolean {
  return config.metaAppId.length > 0 && validateHttpsRedirectUri(config.redirectUri) === null;
}

export function officialConfigError(config = getAppConfig()): string | null {
  if (!config.metaAppId) {
    return "Resmi Instagram API yapılandırması eksik. META_APP_ID (Instagram App ID) gerekli.";
  }
  return validateHttpsRedirectUri(config.redirectUri);
}

export function isTestRuntime(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}
