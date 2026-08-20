import { PermissionDeniedError, UnsupportedInstagramActionError } from "@shared/errors";
import type { FollowResult, InstagramComment, InstagramMediaItem, InstagramProfile } from "@shared/types";
import type { ConnectionStatus } from "@shared/constants";
import type { InstagramService } from "./InstagramService";

export interface MockInstagramServiceOptions {
  failUsernames?: string[];
  connected?: boolean;
  profile?: InstagramProfile;
  followers?: string[];
  following?: string[];
}

const DEFAULT_PROFILE: InstagramProfile = {
  id: "mock-user-1",
  username: "demo_account",
  displayName: "Demo Account",
  profilePicture: null,
  followersCount: 1284,
  followingCount: 412,
  mediaCount: 36,
  countsSupported: true,
  followersListSupported: true,
  followingListSupported: true
};

const DEFAULT_FOLLOWERS = ["ayse_design", "mehmet.dev", "selin.foto", "ornek", "studio.nord"];
const DEFAULT_FOLLOWING = ["ayse_design", "ornek", "brand_hub", "ornek2", "travel.notes", "cafe.istanbul"];

export class MockInstagramService implements InstagramService {
  readonly provider = "mock" as const;
  readonly followSupported = true;
  readonly unfollowSupported = true;
  readonly followersListSupported = true;
  readonly followingListSupported = true;

  private connected: boolean;
  private readonly failUsernames: Set<string>;
  private readonly profile: InstagramProfile;
  private followers: string[];
  private following: string[];

  constructor(options: MockInstagramServiceOptions = {}) {
    this.connected = options.connected ?? false;
    this.failUsernames = new Set(options.failUsernames ?? ["ornek2"]);
    this.profile = options.profile ?? DEFAULT_PROFILE;
    this.followers = [...(options.followers ?? DEFAULT_FOLLOWERS)];
    this.following = [...(options.following ?? DEFAULT_FOLLOWING)];
  }

  getCapabilities() {
    return {
      canGetProfile: true,
      canGetFollowers: true,
      canGetFollowing: true,
      canFollow: true,
      canUnfollow: true
    };
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    return this.connected ? "connected" : "disconnected";
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  async getProfile(): Promise<InstagramProfile> {
    return { ...this.profile, followersCount: this.followers.length, followingCount: this.following.length };
  }

  async getFollowers(): Promise<string[]> {
    return [...this.followers];
  }

  async getFollowing(): Promise<string[]> {
    return [...this.following];
  }

  async follow(username: string): Promise<FollowResult> {
    if (!this.connected) {
      return { username, success: false, error: "Instagram hesabı bağlı değil.", errorCode: "AUTH_REQUIRED" };
    }
    if (this.failUsernames.has(username)) {
      return { username, success: false, error: "Mock işlem başarısız.", errorCode: "API_ERROR" };
    }
    if (!this.following.includes(username)) {
      this.following.push(username);
    }
    return { username, success: true };
  }

  async unfollow(username: string): Promise<FollowResult> {
    if (!this.connected) {
      return { username, success: false, error: "Instagram hesabı bağlı değil.", errorCode: "AUTH_REQUIRED" };
    }
    if (this.failUsernames.has(username)) {
      return { username, success: false, error: "Mock işlem başarısız.", errorCode: "API_ERROR" };
    }
    this.following = this.following.filter((item) => item !== username);
    return { username, success: true };
  }

  async getMedia(): Promise<InstagramMediaItem[]> {
    return [
      { id: "media-1", caption: "Studio ışıkları", timestamp: new Date().toISOString(), mediaType: "IMAGE" },
      { id: "media-2", caption: "Yeni koleksiyon", timestamp: new Date().toISOString(), mediaType: "CAROUSEL_ALBUM" }
    ];
  }

  async getComments(mediaId: string): Promise<InstagramComment[]> {
    return [
      {
        id: `${mediaId}-c1`,
        text: "Harika görünüyor",
        username: "ayse_design",
        timestamp: new Date().toISOString()
      }
    ];
  }

  unsupported(action: string): never {
    throw new UnsupportedInstagramActionError(action);
  }

  permissionDenied(message: string): never {
    throw new PermissionDeniedError(message);
  }
}

export function seedMockRelationships(): Array<{
  username: string;
  isFollower: boolean;
  isFollowing: boolean;
}> {
  const followers = new Set(DEFAULT_FOLLOWERS);
  const following = new Set(DEFAULT_FOLLOWING);
  const all = new Set([...DEFAULT_FOLLOWERS, ...DEFAULT_FOLLOWING]);
  return [...all].map((username) => ({
    username,
    isFollower: followers.has(username),
    isFollowing: following.has(username)
  }));
}
