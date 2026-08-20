import type {
  FollowResult,
  InstagramCapabilities,
  InstagramComment,
  InstagramMediaItem,
  InstagramProfile
} from "@shared/types";
import type { ConnectionStatus } from "@shared/constants";

export const OFFICIAL_SUPPORTED_ACTIONS = {
  getProfile: true,
  getMedia: true,
  getComments: true,
  getFollowers: false,
  getFollowing: false,
  follow: false,
  unfollow: false
} as const;

export interface InstagramService {
  readonly provider: "mock" | "official";
  readonly followSupported: boolean;
  readonly unfollowSupported: boolean;
  readonly followersListSupported: boolean;
  readonly followingListSupported: boolean;
  getCapabilities(): InstagramCapabilities;
  getConnectionStatus(): Promise<ConnectionStatus>;
  getProfile(): Promise<InstagramProfile>;
  getFollowers(): Promise<string[]>;
  getFollowing(): Promise<string[]>;
  follow(username: string): Promise<FollowResult>;
  unfollow(username: string): Promise<FollowResult>;
  getMedia(): Promise<InstagramMediaItem[]>;
  getComments(mediaId: string): Promise<InstagramComment[]>;
}
