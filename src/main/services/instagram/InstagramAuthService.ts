import { shell } from "electron";
import { generateOAuthState, nowIso } from "@shared/utils";
import { AuthRequiredError, TokenExpiredError } from "@shared/errors";
import type { AccountRecord, ConnectionSnapshot } from "@shared/types";
import { getAppConfig, isOfficialConfigured, isTestRuntime, officialConfigError } from "../../config";
import { createLogger } from "../logging/logger";
import type { DatabaseService } from "../../database/DatabaseService";
import type { TokenStore } from "../security/TokenStore";
import { DEFAULT_TOKEN_ACCOUNT_KEY } from "../security/TokenStore";
import type { InstagramService } from "./InstagramService";
import { MockInstagramService } from "./MockInstagramService";
import { closeOAuthCallbackListener, waitForLocalOAuthCallback } from "./OAuthCallbackServer";
import {
  INSTAGRAM_LONG_LIVED_TOKEN_URL,
  INSTAGRAM_TOKEN_URL,
  buildInstagramAuthorizeUrl,
  sanitizeAuthorizationCode
} from "./instagramOAuth";

const log = createLogger("[InstagramAuth]");

export interface OAuthHttp {
  getJson<T>(url: string, init?: RequestInit): Promise<T>;
  postForm<T>(url: string, body: Record<string, string>): Promise<T>;
}

export class FetchOAuthHttp implements OAuthHttp {
  async getJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    return (await response.json()) as T;
  }

  async postForm<T>(url: string, body: Record<string, string>): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body)
    });
    return (await response.json()) as T;
  }
}

export type AuthorizationCodeWaiter = (params: {
  clientId: string;
  redirectUri: string;
  state: string;
  localPort: number;
  openExternal: (url: string) => Promise<void>;
}) => Promise<string>;

export async function defaultAuthorizationCodeWaiter(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  localPort: number;
  openExternal: (url: string) => Promise<void>;
}): Promise<string> {
  const redirect = new URL(params.redirectUri);
  const authorizeUrl = buildInstagramAuthorizeUrl({
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    state: params.state
  });
  return waitForLocalOAuthCallback(
    {
      expectedState: params.state,
      redirectPath: redirect.pathname,
      port: params.localPort
    },
    async () => {
      log.info("callback listener ready; opening authorization browser");
      await params.openExternal(authorizeUrl);
    }
  );
}

export class InstagramAuthService {
  private pendingState: string | null = null;
  private connectLock = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly tokenStore: TokenStore,
    private readonly getService: () => InstagramService,
    private readonly http: OAuthHttp = new FetchOAuthHttp(),
    private readonly openExternal: (url: string) => Promise<void> = (url) => shell.openExternal(url),
    private readonly waitForCode: AuthorizationCodeWaiter = defaultAuthorizationCodeWaiter
  ) {}

  async connect(): Promise<ConnectionSnapshot> {
    if (this.connectLock) {
      throw new AuthRequiredError(
        "Instagram girişi zaten devam ediyor. Tarayıcıdaki Instagram penceresini tamamlayın."
      );
    }
    this.connectLock = true;
    try {
      return await this.connectInternal();
    } finally {
      this.connectLock = false;
      await closeOAuthCallbackListener();
    }
  }

  private async connectInternal(): Promise<ConnectionSnapshot> {
    const service = this.getService();
    if (service.provider === "mock" && isTestRuntime()) {
      log.info("Mock connect (test runtime)");
      const profile = await service.getProfile();
      const account = this.database.upsertAccount({
        provider: "mock",
        instagramUserId: profile.id,
        username: profile.username,
        displayName: profile.displayName,
        profilePicture: profile.profilePicture,
        connectionStatus: "connected"
      });
      if (service instanceof MockInstagramService) {
        service.setConnected(true);
      }
      return this.toSnapshot(account, service, profile);
    }

    const config = getAppConfig();
    const configError = officialConfigError(config);
    if (!isOfficialConfigured(config) || configError) {
      throw new AuthRequiredError(configError ?? "Resmi Instagram API yapılandırması eksik.");
    }
    if (!config.metaAppSecret) {
      throw new AuthRequiredError("META_APP_SECRET (Instagram App Secret) gerekli.");
    }

    const state = generateOAuthState();
    this.pendingState = state;
    log.info("Instagram Business Login authorization started");
    const rawCode = await this.waitForCode({
      clientId: config.metaAppId,
      redirectUri: config.redirectUri,
      state,
      localPort: config.oauthCallbackPort,
      openExternal: this.openExternal
    });
    this.assertState(state);
    const code = sanitizeAuthorizationCode(rawCode);
    if (!code) {
      throw new AuthRequiredError("Yetkilendirme kodu alınamadı.");
    }

    const tokenResponse = await this.http.postForm<{
      access_token?: string;
      token_type?: string;
      expires_in?: number;
      error_message?: string;
      error_type?: string;
    }>(INSTAGRAM_TOKEN_URL, {
      client_id: config.metaAppId,
      client_secret: config.metaAppSecret,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
      code
    });

    if (!tokenResponse.access_token) {
      throw new AuthRequiredError(tokenResponse.error_message ?? "OAuth token alınamadı.");
    }

    const longLived = await this.exchangeLongLived(tokenResponse.access_token, config.metaAppSecret);
    await this.tokenStore.save(DEFAULT_TOKEN_ACCOUNT_KEY, {
      accessToken: longLived.accessToken,
      tokenType: longLived.tokenType,
      expiresAt: longLived.expiresAt,
      accountKey: DEFAULT_TOKEN_ACCOUNT_KEY
    });

    const profile = await service.getProfile();
    const account = this.database.upsertAccount({
      provider: "official",
      instagramUserId: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      profilePicture: profile.profilePicture,
      connectionStatus: "connected"
    });
    log.info(`Connected official account @${profile.username}`);
    return this.toSnapshot(account, service, profile);
  }

  async disconnect(): Promise<ConnectionSnapshot> {
    await this.tokenStore.clear(DEFAULT_TOKEN_ACCOUNT_KEY);
    const service = this.getService();
    if (service instanceof MockInstagramService) {
      service.setConnected(false);
    }
    const account = this.database.disconnectAccount();
    log.info("Account disconnected");
    return this.toSnapshot(account, service, null);
  }

  async getConnectionStatus(): Promise<ConnectionSnapshot> {
    const service = this.getService();
    const account = this.database.getPrimaryAccount();
    if (!account || account.connectionStatus !== "connected") {
      return this.toSnapshot(account, service, null);
    }
    try {
      const status = await service.getConnectionStatus();
      if (status === "expired") {
        throw new TokenExpiredError();
      }
      if (status === "connected") {
        const profile = await service.getProfile();
        return this.toSnapshot(account, service, profile);
      }
      return this.toSnapshot(account, service, null);
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        return this.toSnapshot(account, service, null, error.message);
      }
      return this.toSnapshot(account, service, null, error instanceof Error ? error.message : "Bağlantı hatası");
    }
  }

  async refreshConnection(): Promise<ConnectionSnapshot> {
    return this.getConnectionStatus();
  }

  async getConnectedAccount(): Promise<AccountRecord | null> {
    return this.database.getPrimaryAccount();
  }

  validateOAuthState(expected: string, received: string | null): boolean {
    return Boolean(expected) && expected === received;
  }

  private assertState(expected: string): void {
    if (!this.validateOAuthState(expected, this.pendingState)) {
      throw new AuthRequiredError("OAuth state doğrulaması başarısız.");
    }
    this.pendingState = null;
  }

  private async exchangeLongLived(shortToken: string, clientSecret: string): Promise<{
    accessToken: string;
    tokenType: string;
    expiresAt: string | null;
  }> {
    const url = new URL(INSTAGRAM_LONG_LIVED_TOKEN_URL);
    url.searchParams.set("grant_type", "ig_exchange_token");
    url.searchParams.set("client_secret", clientSecret);
    url.searchParams.set("access_token", shortToken);
    const data = await this.http.getJson<{ access_token?: string; token_type?: string; expires_in?: number }>(
      url.toString()
    );
    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null;
    return {
      accessToken: data.access_token ?? shortToken,
      tokenType: data.token_type ?? "bearer",
      expiresAt
    };
  }

  private toSnapshot(
    account: AccountRecord | null,
    service: InstagramService,
    profile: ConnectionSnapshot["profile"],
    message: string | null = null
  ): ConnectionSnapshot {
    return {
      connected: account?.connectionStatus === "connected" && profile !== null,
      provider: service.provider,
      account,
      profile,
      followSupported: service.followSupported,
      unfollowSupported: service.unfollowSupported,
      followersListSupported: service.followersListSupported,
      followingListSupported: service.followingListSupported,
      capabilities: service.getCapabilities(),
      message
    };
  }

  connectedAt(): string {
    return nowIso();
  }
}
