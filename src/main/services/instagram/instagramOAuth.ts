export const INSTAGRAM_OAUTH_CALLBACK_PATH = "/auth/instagram/callback";
export const INSTAGRAM_OAUTH_SCOPES = "instagram_business_basic,instagram_business_manage_comments";
export const INSTAGRAM_AUTHORIZE_ORIGIN = "https://www.instagram.com/oauth/authorize";
export const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
export const INSTAGRAM_LONG_LIVED_TOKEN_URL = "https://graph.instagram.com/access_token";

export function sanitizeAuthorizationCode(raw: string): string {
  return raw.split("#")[0]?.trim() ?? "";
}

export function normalizeCallbackPath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/";
  }
  return pathname.replace(/\/+$/, "") || "/";
}

export function composeRedirectUriFromOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, "");
  return `${trimmed}${INSTAGRAM_OAUTH_CALLBACK_PATH}`;
}

export function resolveInstagramRedirectUri(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.INSTAGRAM_REDIRECT_URI?.trim() ?? "";
  if (explicit) {
    return explicit;
  }
  const origin = env.INSTAGRAM_TUNNEL_ORIGIN?.trim() ?? "";
  if (origin) {
    return composeRedirectUriFromOrigin(origin);
  }
  return "";
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

export function validateHttpsRedirectUri(uri: string): string | null {
  if (!uri) {
    return "INSTAGRAM_REDIRECT_URI veya INSTAGRAM_TUNNEL_ORIGIN gerekli.";
  }
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return "INSTAGRAM_REDIRECT_URI geçerli bir HTTPS URL olmalı.";
  }
  if (parsed.protocol !== "https:") {
    return "INSTAGRAM_REDIRECT_URI https:// ile başlamalı. HTTP loopback kabul edilmez.";
  }
  if (isLoopbackHostname(parsed.hostname)) {
    return "localhost veya 127.0.0.1 redirect URI kullanılamaz. HTTPS domain veya tunnel origin kullanın.";
  }
  if (normalizeCallbackPath(parsed.pathname) !== INSTAGRAM_OAUTH_CALLBACK_PATH) {
    return `OAuth callback yolu ${INSTAGRAM_OAUTH_CALLBACK_PATH} olmalı.`;
  }
  return null;
}

export function buildInstagramAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const url = new URL(INSTAGRAM_AUTHORIZE_ORIGIN);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", params.scope ?? INSTAGRAM_OAUTH_SCOPES);
  url.searchParams.set("state", params.state);
  return url.toString();
}

export type OAuthCallbackSuccess = { ok: true; code: string; state: string };
export type OAuthCallbackFailure = {
  ok: false;
  reason: "cancelled" | "missing_code" | "invalid_state" | "wrong_path";
  message: string;
};
export type OAuthCallbackInterpretation = OAuthCallbackSuccess | OAuthCallbackFailure;

export function interpretOAuthCallback(
  requestUrl: URL,
  expectedState: string,
  expectedPath: string
): OAuthCallbackInterpretation {
  if (normalizeCallbackPath(requestUrl.pathname) !== normalizeCallbackPath(expectedPath)) {
    return { ok: false, reason: "wrong_path", message: "Beklenmeyen callback yolu." };
  }

  const error = requestUrl.searchParams.get("error");
  if (error) {
    const description =
      requestUrl.searchParams.get("error_description") ??
      requestUrl.searchParams.get("error_reason") ??
      error;
    return {
      ok: false,
      reason: "cancelled",
      message: description || "OAuth yetkilendirmesi iptal edildi."
    };
  }

  const receivedState = requestUrl.searchParams.get("state");
  if (!expectedState || receivedState !== expectedState) {
    return { ok: false, reason: "invalid_state", message: "OAuth state doğrulaması başarısız." };
  }

  const code = sanitizeAuthorizationCode(requestUrl.searchParams.get("code") ?? "");
  if (!code) {
    return { ok: false, reason: "missing_code", message: "Yetkilendirme kodu alınamadı." };
  }

  return { ok: true, code, state: receivedState };
}
