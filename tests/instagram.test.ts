import { afterEach, describe, expect, it, vi } from "vitest";
import { InstagramAuthService, type OAuthHttp } from "../src/main/services/instagram/InstagramAuthService";
import { InstagramServiceFactory } from "../src/main/services/instagram/InstagramServiceFactory";
import { MockInstagramService } from "../src/main/services/instagram/MockInstagramService";
import { OfficialInstagramService } from "../src/main/services/instagram/OfficialInstagramService";
import { MemoryTokenStore } from "../src/main/services/security/TokenStore";
import { AuthRequiredError, TokenExpiredError } from "../src/shared/errors";
import {
  buildInstagramAuthorizeUrl,
  interpretOAuthCallback,
  resolveInstagramRedirectUri,
  sanitizeAuthorizationCode,
  validateHttpsRedirectUri
} from "../src/main/services/instagram/instagramOAuth";
import {
  closeOAuthCallbackListener,
  OAUTH_LISTENER_APP_ID,
  OAUTH_LISTENER_PROBE_PATH,
  waitForLocalOAuthCallback
} from "../src/main/services/instagram/OAuthCallbackServer";
import { createTestDatabase } from "./helpers";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";

const dirs: string[] = [];
const TEST_REDIRECT = "https://oauth-test.example.com/auth/instagram/callback";

function stubOfficialEnv(): void {
  vi.stubEnv("INSTAGRAM_PROVIDER", "official");
  vi.stubEnv("META_APP_ID", "instagram-app-id");
  vi.stubEnv("META_APP_SECRET", "instagram-app-secret");
  vi.stubEnv("INSTAGRAM_REDIRECT_URI", TEST_REDIRECT);
  vi.stubEnv("INSTAGRAM_TUNNEL_ORIGIN", "");
}

function stubHttp(overrides: Partial<OAuthHttp> = {}): OAuthHttp {
  return {
    postForm: async <T>() => ({}) as T,
    getJson: async <T>() => ({}) as T,
    ...overrides
  };
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address) {
        const port = address.port;
        server.close(() => resolve(port));
        return;
      }
      reject(new Error("port yok"));
    });
  });
}

afterEach(async () => {
  await closeOAuthCallbackListener();
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
  vi.unstubAllEnvs();
});

describe("oauth helpers", () => {
  it("resolves redirect URI from INSTAGRAM_REDIRECT_URI", () => {
    expect(
      resolveInstagramRedirectUri({
        INSTAGRAM_REDIRECT_URI: TEST_REDIRECT,
        INSTAGRAM_TUNNEL_ORIGIN: "https://ignored.example.com"
      })
    ).toBe(TEST_REDIRECT);
  });

  it("composes redirect URI from tunnel origin", () => {
    expect(
      resolveInstagramRedirectUri({
        INSTAGRAM_REDIRECT_URI: "",
        INSTAGRAM_TUNNEL_ORIGIN: "https://random-words.trycloudflare.com/"
      })
    ).toBe("https://random-words.trycloudflare.com/auth/instagram/callback");
  });

  it("rejects loopback and http redirect URIs", () => {
    expect(validateHttpsRedirectUri("http://127.0.0.1:8734/auth/callback")).not.toBeNull();
    expect(validateHttpsRedirectUri("https://localhost:8734/auth/instagram/callback")).not.toBeNull();
    expect(validateHttpsRedirectUri(TEST_REDIRECT)).toBeNull();
  });

  it("encodes authorize URL parameters", () => {
    const url = new URL(
      buildInstagramAuthorizeUrl({
        clientId: "123",
        redirectUri: TEST_REDIRECT,
        state: "abc def"
      })
    );
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("123");
    expect(url.searchParams.get("redirect_uri")).toBe(TEST_REDIRECT);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_manage_comments"
    );
    expect(url.searchParams.get("state")).toBe("abc def");
  });

  it("strips Instagram hash suffixes from authorization codes", () => {
    expect(sanitizeAuthorizationCode("AQBx-hBsH3#_")).toBe("AQBx-hBsH3");
  });

  it("interprets successful callback query", () => {
    const url = new URL(`${TEST_REDIRECT}?code=AQBx-hBsH3%23_&state=s1`);
    const result = interpretOAuthCallback(url, "s1", "/auth/instagram/callback");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code).toBe("AQBx-hBsH3");
    }
  });

  it("rejects mismatched state, missing code, and cancelled oauth", () => {
    const path = "/auth/instagram/callback";
    const badState = interpretOAuthCallback(new URL(`${TEST_REDIRECT}?code=x&state=nope`), "s1", path);
    const missing = interpretOAuthCallback(new URL(`${TEST_REDIRECT}?state=s1`), "s1", path);
    const cancelled = interpretOAuthCallback(
      new URL(
        `${TEST_REDIRECT}?error=access_denied&error_reason=user_denied&error_description=Cancel&state=s1`
      ),
      "s1",
      path
    );
    expect(badState.ok).toBe(false);
    expect(missing.ok).toBe(false);
    expect(cancelled.ok).toBe(false);
    if (!badState.ok) {
      expect(badState.reason).toBe("invalid_state");
    }
    if (!missing.ok) {
      expect(missing.reason).toBe("missing_code");
    }
    if (!cancelled.ok) {
      expect(cancelled.reason).toBe("cancelled");
    }
  });
});

describe("oauth callback server", () => {
  it("accepts a tunneled HTTPS-style callback on the local listener", async () => {
    const port = await freePort();
    const pending = waitForLocalOAuthCallback(
      {
        expectedState: "state-1",
        redirectPath: "/auth/instagram/callback",
        port,
        timeoutMs: 5000
      },
      async () => {
        const probe = await fetch(`http://127.0.0.1:${port}${OAUTH_LISTENER_PROBE_PATH}`);
        const identity = (await probe.json()) as { app: string; pid: number };
        expect(identity.app).toBe(OAUTH_LISTENER_APP_ID);
        expect(identity.pid).toBe(process.pid);
        const response = await fetch(
          `http://127.0.0.1:${port}/auth/instagram/callback?code=AUTHCODE%23_&state=state-1`
        );
        expect(response.ok).toBe(true);
      }
    );
    await expect(pending).resolves.toBe("AUTHCODE");
  });

  it("accepts a local test query without closing the oauth listener", async () => {
    const port = await freePort();
    const pending = waitForLocalOAuthCallback(
      {
        expectedState: "state-1",
        redirectPath: "/auth/instagram/callback",
        port,
        timeoutMs: 5000
      },
      async () => {
        const testResponse = await fetch(`http://127.0.0.1:${port}/auth/instagram/callback?test=1`);
        expect(testResponse.ok).toBe(true);
        const incomplete = await fetch(`http://127.0.0.1:${port}/auth/instagram/callback`);
        expect(incomplete.ok).toBe(true);
        const response = await fetch(
          `http://127.0.0.1:${port}/auth/instagram/callback?code=AFTERTEST&state=state-1`
        );
        expect(response.ok).toBe(true);
      }
    );
    await expect(pending).resolves.toBe("AFTERTEST");
  });

  it("reuses a single listener and rejects a second wait while oauth is in progress", async () => {
    const port = await freePort();
    const first = waitForLocalOAuthCallback(
      {
        expectedState: "state-1",
        redirectPath: "/auth/instagram/callback",
        port,
        timeoutMs: 5000
      },
      async () => {
        await expect(
          waitForLocalOAuthCallback({
            expectedState: "state-2",
            redirectPath: "/auth/instagram/callback",
            port,
            timeoutMs: 5000
          })
        ).rejects.toMatchObject({
          message: "Instagram girişi zaten devam ediyor. Tarayıcıdaki Instagram penceresini tamamlayın."
        });
        const response = await fetch(
          `http://127.0.0.1:${port}/auth/instagram/callback?code=ONLYONE&state=state-1`
        );
        expect(response.ok).toBe(true);
      }
    );
    await expect(first).resolves.toBe("ONLYONE");
  });

  it("does not kill a foreign process occupying the callback port", async () => {
    const port = await freePort();
    const foreign = http.createServer((_request, response) => {
      response.statusCode = 200;
      response.end("foreign-app");
    });
    await new Promise<void>((resolve, reject) => {
      foreign.once("error", reject);
      foreign.listen(port, "127.0.0.1", () => resolve());
    });
    try {
      await expect(
        waitForLocalOAuthCallback({
          expectedState: "state-1",
          redirectPath: "/auth/instagram/callback",
          port,
          timeoutMs: 1000
        })
      ).rejects.toMatchObject({
        message: expect.stringContaining("başka bir uygulama tarafından kullanılıyor")
      });
      const still = await fetch(`http://127.0.0.1:${port}/`);
      expect(await still.text()).toBe("foreign-app");
    } finally {
      await new Promise<void>((resolve) => foreign.close(() => resolve()));
    }
  });
});

describe("oauth and accounts", () => {
  it("validates oauth state", async () => {
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const auth = new InstagramAuthService(database, new MemoryTokenStore(), () => new MockInstagramService());
    expect(auth.validateOAuthState("abc", "abc")).toBe(true);
    expect(auth.validateOAuthState("abc", "nope")).toBe(false);
    expect(auth.validateOAuthState("abc", null)).toBe(false);
  });

  it("connects and disconnects a mock account", async () => {
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const service = new MockInstagramService();
    const auth = new InstagramAuthService(database, new MemoryTokenStore(), () => service);
    const connected = await auth.connect();
    expect(connected.connected).toBe(true);
    expect(connected.account?.username).toBe("demo_account");
    expect(connected.capabilities.canFollow).toBe(true);
    const disconnected = await auth.disconnect();
    expect(disconnected.connected).toBe(false);
  });

  it("completes official oauth, stores the token, and saves the real account", async () => {
    stubOfficialEnv();
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const tokens = new MemoryTokenStore();
    const official = new OfficialInstagramService(tokens, {
      get: async <T>() =>
        ({
          id: "17841400000000000",
          username: "gercek_kullanici",
          name: "Gerçek Kullanıcı",
          profile_picture_url: "https://example.com/p.jpg",
          followers_count: 10,
          follows_count: 4
        }) as T
    });
    const http: OAuthHttp = {
      postForm: async <T>(_url: string, _body: Record<string, string>) =>
        ({ access_token: "short-token", token_type: "bearer" }) as T,
      getJson: async <T>() =>
        ({ access_token: "long-token", token_type: "bearer", expires_in: 5184000 }) as T
    };
    const postForm = vi.spyOn(http, "postForm");
    const auth = new InstagramAuthService(
      database,
      tokens,
      () => official,
      http,
      async () => undefined,
      async () => "AUTHCODE#_"
    );
    const snapshot = await auth.connect();
    expect(snapshot.connected).toBe(true);
    expect(snapshot.account?.username).toBe("gercek_kullanici");
    expect(snapshot.account?.instagramUserId).toBe("17841400000000000");
    expect(snapshot.account?.connectionStatus).toBe("connected");
    expect(await tokens.get("instagram-primary")).toMatchObject({ accessToken: "long-token" });
    expect(postForm).toHaveBeenCalledWith(
      "https://api.instagram.com/oauth/access_token",
      expect.objectContaining({
        client_id: "instagram-app-id",
        grant_type: "authorization_code",
        redirect_uri: TEST_REDIRECT,
        code: "AUTHCODE"
      })
    );
    const disconnected = await auth.disconnect();
    expect(disconnected.connected).toBe(false);
    expect(await tokens.get("instagram-primary")).toBeNull();
  });

  it("rejects a second connectAccount while oauth is already running", async () => {
    stubOfficialEnv();
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const tokens = new MemoryTokenStore();
    const official = new OfficialInstagramService(tokens, {
      get: async <T>() =>
        ({
          id: "17841400000000000",
          username: "gercek_kullanici",
          name: "Gerçek Kullanıcı",
          profile_picture_url: null,
          followers_count: 1,
          follows_count: 1
        }) as T
    });
    let waiterStarts = 0;
    const deferred: { resolve: (code: string) => void } = {
      resolve: () => undefined
    };
    const auth = new InstagramAuthService(
      database,
      tokens,
      () => official,
      stubHttp({
        postForm: async <T>() => ({ access_token: "short-token", token_type: "bearer" }) as T,
        getJson: async <T>() =>
          ({ access_token: "long-token", token_type: "bearer", expires_in: 5184000 }) as T
      }),
      async () => undefined,
      async () => {
        waiterStarts += 1;
        return await new Promise<string>((resolve) => {
          deferred.resolve = resolve;
        });
      }
    );
    const first = auth.connect();
    await vi.waitFor(() => {
      expect(waiterStarts).toBe(1);
    });
    const second = auth.connect();
    await expect(second).rejects.toMatchObject({
      message: "Instagram girişi zaten devam ediyor. Tarayıcıdaki Instagram penceresini tamamlayın."
    });
    expect(waiterStarts).toBe(1);
    deferred.resolve("AUTHCODE");
    const snapshot = await first;
    expect(snapshot.connected).toBe(true);
    expect(snapshot.account?.username).toBe("gercek_kullanici");
  });

  it("rejects oauth when state does not match", async () => {
    stubOfficialEnv();
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const auth = new InstagramAuthService(
      database,
      new MemoryTokenStore(),
      () => new OfficialInstagramService(new MemoryTokenStore()),
      stubHttp(),
      async () => undefined,
      async () => {
        throw new AuthRequiredError("OAuth state doğrulaması başarısız.");
      }
    );
    await expect(auth.connect()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it("rejects oauth when the authorization code is missing", async () => {
    stubOfficialEnv();
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const auth = new InstagramAuthService(
      database,
      new MemoryTokenStore(),
      () => new OfficialInstagramService(new MemoryTokenStore()),
      stubHttp(),
      async () => undefined,
      async () => ""
    );
    await expect(auth.connect()).rejects.toMatchObject({ message: "Yetkilendirme kodu alınamadı." });
  });

  it("rejects oauth when the user cancels login", async () => {
    stubOfficialEnv();
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const auth = new InstagramAuthService(
      database,
      new MemoryTokenStore(),
      () => new OfficialInstagramService(new MemoryTokenStore()),
      stubHttp(),
      async () => undefined,
      async () => {
        throw new AuthRequiredError("user_denied");
      }
    );
    await expect(auth.connect()).rejects.toMatchObject({ message: "user_denied" });
  });

  it("surfaces token exchange errors", async () => {
    stubOfficialEnv();
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const auth = new InstagramAuthService(
      database,
      new MemoryTokenStore(),
      () => new OfficialInstagramService(new MemoryTokenStore()),
      stubHttp({
        postForm: async <T>() => ({ error_message: "Error validating verification code." }) as T
      }),
      async () => undefined,
      async () => "AUTHCODE"
    );
    await expect(auth.connect()).rejects.toMatchObject({
      message: "Error validating verification code."
    });
  });

  it("reports token expiration", async () => {
    const { database, dir } = await createTestDatabase();
    dirs.push(dir);
    const tokens = new MemoryTokenStore();
    await tokens.save("instagram-primary", {
      accessToken: "expired",
      tokenType: "bearer",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      accountKey: "instagram-primary"
    });
    const official = new OfficialInstagramService(tokens);
    await expect(official.getProfile()).rejects.toBeInstanceOf(TokenExpiredError);
    expect(await official.getConnectionStatus()).toBe("expired");
    database.upsertAccount({
      provider: "official",
      instagramUserId: "17841400000000000",
      username: "gercek_kullanici",
      displayName: "Gerçek Kullanıcı",
      profilePicture: null,
      connectionStatus: "connected"
    });
    const auth = new InstagramAuthService(database, tokens, () => official);
    const status = await auth.getConnectionStatus();
    expect(status.connected).toBe(false);
    expect(status.message).toBe("Instagram oturumunun süresi doldu.");
  });

  it("maps API errors from the graph client", async () => {
    const tokens = new MemoryTokenStore();
    await tokens.save("instagram-primary", {
      accessToken: "token",
      tokenType: "bearer",
      expiresAt: null,
      accountKey: "instagram-primary"
    });
    const official = new OfficialInstagramService(tokens, {
      get: async () => {
        throw new Error("boom");
      }
    });
    await expect(official.getProfile()).rejects.toThrow("boom");
  });

  it("selects official provider by default", () => {
    vi.stubEnv("INSTAGRAM_PROVIDER", "official");
    vi.stubEnv("META_APP_ID", "");
    const factory = new InstagramServiceFactory(new MemoryTokenStore());
    expect(factory.create().provider).toBe("official");
  });

  it("selects mock provider when explicitly requested", () => {
    vi.stubEnv("INSTAGRAM_PROVIDER", "mock");
    vi.stubEnv("META_APP_ID", "");
    const factory = new InstagramServiceFactory(new MemoryTokenStore());
    expect(factory.create().provider).toBe("mock");
  });

  it("selects official provider when configured", () => {
    stubOfficialEnv();
    const factory = new InstagramServiceFactory(new MemoryTokenStore());
    expect(factory.create()).toBeInstanceOf(OfficialInstagramService);
  });

  it("exposes official capabilities without follow", () => {
    const official = new OfficialInstagramService(new MemoryTokenStore());
    expect(official.getCapabilities().canFollow).toBe(false);
    expect(official.getCapabilities().canGetProfile).toBe(true);
  });
});
