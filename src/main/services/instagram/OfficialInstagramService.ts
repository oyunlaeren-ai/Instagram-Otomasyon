import {
  AccountDisconnectedError,
  ApiError,
  AuthRequiredError,
  NetworkError,
  PermissionDeniedError,
  RateLimitedError,
  TokenExpiredError,
  UnsupportedInstagramActionError
} from "@shared/errors";
import type { FollowResult, InstagramComment, InstagramMediaItem, InstagramProfile } from "@shared/types";
import type { ConnectionStatus } from "@shared/constants";
import { createLogger } from "../logging/logger";
import type { InstagramService } from "./InstagramService";
import { OFFICIAL_SUPPORTED_ACTIONS } from "./InstagramService";
import type { TokenStore } from "../security/TokenStore";
import { DEFAULT_TOKEN_ACCOUNT_KEY } from "../security/TokenStore";

const log = createLogger("[InstagramAPI]");

export interface GraphApiClient {
  get<T>(path: string, accessToken: string, query?: Record<string, string>): Promise<T>;
}

export class FetchGraphApiClient implements GraphApiClient {
  constructor(private readonly baseUrl = "https://graph.instagram.com") {}

  async get<T>(path: string, accessToken: string, query: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set("access_token", accessToken);

    let response: Response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch {
      throw new NetworkError();
    }

    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number; type?: string };
    };

    if (response.status === 429 || payload.error?.code === 4 || payload.error?.code === 17) {
      throw new RateLimitedError();
    }
    if (response.status === 401 || payload.error?.code === 190) {
      throw new TokenExpiredError();
    }
    if (response.status === 403) {
      throw new PermissionDeniedError();
    }
    if (!response.ok) {
      throw new ApiError(payload.error?.message ?? "Instagram API hatası oluştu.");
    }
    return payload as T;
  }
}

export class OfficialInstagramService implements InstagramService {
  readonly provider = "official" as const;
  readonly followSupported = OFFICIAL_SUPPORTED_ACTIONS.follow;
  readonly unfollowSupported = OFFICIAL_SUPPORTED_ACTIONS.unfollow;
  readonly followersListSupported = OFFICIAL_SUPPORTED_ACTIONS.getFollowers;
  readonly followingListSupported = OFFICIAL_SUPPORTED_ACTIONS.getFollowing;

  constructor(
    private readonly tokenStore: TokenStore,
    private readonly client: GraphApiClient = new FetchGraphApiClient(),
    private readonly accountKey = DEFAULT_TOKEN_ACCOUNT_KEY
  ) {}

  getCapabilities() {
    return {
      canGetProfile: OFFICIAL_SUPPORTED_ACTIONS.getProfile,
      canGetFollowers: OFFICIAL_SUPPORTED_ACTIONS.getFollowers,
      canGetFollowing: OFFICIAL_SUPPORTED_ACTIONS.getFollowing,
      canFollow: OFFICIAL_SUPPORTED_ACTIONS.follow,
      canUnfollow: OFFICIAL_SUPPORTED_ACTIONS.unfollow
    };
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    const token = await this.tokenStore.get(this.accountKey);
    if (!token) {
      return "disconnected";
    }
    if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
      return "expired";
    }
    return "connected";
  }

  async getProfile(): Promise<InstagramProfile> {
    const token = await this.requireToken();
    const data = await this.client.get<{
      id: string;
      username?: string;
      name?: string;
      profile_picture_url?: string;
      followers_count?: number;
      follows_count?: number;
      media_count?: number;
    }>("/me", token.accessToken, {
      fields: "id,username,name,profile_picture_url,followers_count,follows_count,media_count"
    });

    log.info(`Loaded profile for ${data.username ?? data.id}`);

    return {
      id: data.id,
      username: data.username ?? data.id,
      displayName: data.name ?? null,
      profilePicture: data.profile_picture_url ?? null,
      followersCount: data.followers_count ?? null,
      followingCount: data.follows_count ?? null,
      mediaCount: data.media_count ?? null,
      countsSupported: data.followers_count !== undefined || data.follows_count !== undefined,
      followersListSupported: false,
      followingListSupported: false
    };
  }

  async getFollowers(): Promise<string[]> {
    throw new PermissionDeniedError("Takipçi listesi mevcut Instagram API izinleriyle alınamıyor.");
  }

  async getFollowing(): Promise<string[]> {
    throw new PermissionDeniedError("Takip edilen listesi mevcut Instagram API izinleriyle alınamıyor.");
  }

  async follow(username: string): Promise<FollowResult> {
    throw new UnsupportedInstagramActionError(`FOLLOW @${username}`);
  }

  async unfollow(username: string): Promise<FollowResult> {
    throw new UnsupportedInstagramActionError(`UNFOLLOW @${username}`);
  }

  async getMedia(): Promise<InstagramMediaItem[]> {
    const token = await this.requireToken();
    const data = await this.client.get<{
      data?: Array<{ id: string; caption?: string; timestamp?: string; media_type?: string }>;
    }>("/me/media", token.accessToken, {
      fields: "id,caption,timestamp,media_type"
    });
    return (data.data ?? []).map((item) => ({
      id: item.id,
      caption: item.caption ?? null,
      timestamp: item.timestamp ?? null,
      mediaType: item.media_type ?? null
    }));
  }

  async getComments(mediaId: string): Promise<InstagramComment[]> {
    const token = await this.requireToken();
    const data = await this.client.get<{
      data?: Array<{ id: string; text?: string; username?: string; timestamp?: string }>;
    }>(`/${mediaId}/comments`, token.accessToken, {
      fields: "id,text,username,timestamp"
    });
    return (data.data ?? []).map((item) => ({
      id: item.id,
      text: item.text ?? "",
      username: item.username ?? null,
      timestamp: item.timestamp ?? null
    }));
  }

  private async requireToken() {
    const token = await this.tokenStore.get(this.accountKey);
    if (!token) {
      throw new AuthRequiredError();
    }
    if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
      throw new TokenExpiredError();
    }
    if (!token.accessToken) {
      throw new AccountDisconnectedError();
    }
    return token;
  }
}
