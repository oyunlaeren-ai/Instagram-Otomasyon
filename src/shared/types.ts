import type {
  ActionType,
  ConnectionStatus,
  HistoryDateRange,
  HistoryFilter,
  InstagramErrorCode,
  InstagramProvider,
  JobStatus,
  Language,
  ListType,
  RelationshipFilter,
  Theme,
  UnfollowFilter
} from "./constants";

export interface AccountRecord {
  id: number;
  provider: InstagramProvider;
  instagramUserId: string | null;
  username: string | null;
  displayName: string | null;
  profilePicture: string | null;
  connectionStatus: ConnectionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UserRecord {
  id: number;
  username: string;
  displayName: string | null;
  profilePicture: string | null;
  isFollower: boolean;
  isFollowing: boolean;
  followedAt: string | null;
  lastActionAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueueItem {
  id: number;
  username: string;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  lastActionAt: string | null;
}

export interface AutomationJob {
  id: number;
  username: string;
  action: ActionType;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  duration: number | null;
}

export interface AutomationLog {
  id: number;
  jobId: number | null;
  username: string;
  action: ActionType;
  status: JobStatus | "SUCCESS" | "FAILED";
  error: string | null;
  errorCode: InstagramErrorCode | null;
  duration: number | null;
  createdAt: string;
}

export interface AppSettings {
  theme: Theme;
  notifications: boolean;
  language: Language;
  dailyFollowLimit: number;
  dailyUnfollowLimit: number;
  actionDelaySeconds: number;
  workStart: string;
  workEnd: string;
  onboardingCompleted: boolean;
}

export interface ListRecord {
  id: number;
  name: string;
  type: ListType;
  createdAt: string;
}

export interface ListMember {
  id: number;
  listId: number;
  username: string;
  createdAt: string;
}

export interface InstagramProfile {
  id: string;
  username: string;
  displayName: string | null;
  profilePicture: string | null;
  followersCount: number | null;
  followingCount: number | null;
  mediaCount: number | null;
  countsSupported: boolean;
  followersListSupported: boolean;
  followingListSupported: boolean;
}

export interface InstagramMediaItem {
  id: string;
  caption: string | null;
  timestamp: string | null;
  mediaType: string | null;
}

export interface InstagramComment {
  id: string;
  text: string;
  username: string | null;
  timestamp: string | null;
}

export interface FollowResult {
  username: string;
  success: boolean;
  error?: string;
  errorCode?: InstagramErrorCode;
}

export interface InstagramCapabilities {
  canGetProfile: boolean;
  canGetFollowers: boolean;
  canGetFollowing: boolean;
  canFollow: boolean;
  canUnfollow: boolean;
}

export interface ConnectionSnapshot {
  connected: boolean;
  provider: InstagramProvider;
  account: AccountRecord | null;
  profile: InstagramProfile | null;
  followSupported: boolean;
  unfollowSupported: boolean;
  followersListSupported: boolean;
  followingListSupported: boolean;
  capabilities: InstagramCapabilities;
  message: string | null;
}

export interface AutomationRuntimeStatus {
  running: boolean;
  paused: boolean;
  outsideSchedule: boolean;
  processed: number;
  total: number;
  success: number;
  failed: number;
  unsupported: number;
  pending: number;
  currentUsername: string | null;
  lastAction: ActionType | null;
  lastError: string | null;
  interrupted: boolean;
}

export interface DashboardStats {
  followers: number | null;
  following: number | null;
  notFollowingBack: number | null;
  todayFollows: number;
  todayUnfollows: number;
  successCount: number;
  failedCount: number;
  followersSupported: boolean;
  followingSupported: boolean;
  notFollowingSupported: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type {
  ActionType,
  ConnectionStatus,
  HistoryDateRange,
  HistoryFilter,
  InstagramErrorCode,
  InstagramProvider,
  JobStatus,
  Language,
  ListType,
  RelationshipFilter,
  Theme,
  UnfollowFilter
};
