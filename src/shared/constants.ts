export const APP_NAME = "Instagram Automation Manager";
export const DEFAULT_PROTOCOL_PORT = 8734;

export const APP_VERSION = "1.0.0";

export const JOB_STATUSES = [
  "pending",
  "processing",
  "success",
  "failed",
  "cancelled",
  "unsupported"
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const ACTION_TYPES = ["FOLLOW", "UNFOLLOW"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const LIST_TYPES = [
  "follow",
  "unfollow",
  "whitelist",
  "blacklist"
] as const;
export type ListType = (typeof LIST_TYPES)[number];

export const CONNECTION_STATUSES = [
  "disconnected",
  "connecting",
  "connected",
  "expired",
  "error"
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const INSTAGRAM_PROVIDERS = ["mock", "official"] as const;
export type InstagramProvider = (typeof INSTAGRAM_PROVIDERS)[number];

export const INSTAGRAM_ERROR_CODES = [
  "AUTH_REQUIRED",
  "TOKEN_EXPIRED",
  "PERMISSION_DENIED",
  "RATE_LIMITED",
  "API_ERROR",
  "NETWORK_ERROR",
  "UNSUPPORTED_ACTION",
  "ACCOUNT_DISCONNECTED"
] as const;
export type InstagramErrorCode = (typeof INSTAGRAM_ERROR_CODES)[number];

export const THEMES = ["dark", "light", "system"] as const;
export type Theme = (typeof THEMES)[number];

export const LANGUAGES = ["tr", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const UNFOLLOW_FILTERS = [
  "not_following_back",
  "selected",
  "blacklisted"
] as const;
export type UnfollowFilter = (typeof UNFOLLOW_FILTERS)[number];

export const RELATIONSHIP_FILTERS = [
  "all",
  "not_following",
  "following",
  "mutual"
] as const;
export type RelationshipFilter = (typeof RELATIONSHIP_FILTERS)[number];

export const HISTORY_FILTERS = [
  "all",
  "follow",
  "unfollow",
  "success",
  "failed",
  "unsupported",
  "cancelled"
] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

export const HISTORY_DATE_RANGES = ["today", "7d", "30d", "all"] as const;
export type HistoryDateRange = (typeof HISTORY_DATE_RANGES)[number];

export const WEB_SESSION_STATUSES = [
  "disconnected",
  "login_required",
  "connected",
  "expired",
  "security_check"
] as const;
export type WebSessionStatus = (typeof WEB_SESSION_STATUSES)[number];

export const WEB_JOB_STATUSES = [
  "pending",
  "processing",
  "success",
  "already_following",
  "already_unfollowed",
  "failed",
  "paused",
  "cancelled",
  "login_required",
  "security_check_required",
  "user_not_found"
] as const;
export type WebJobStatus = (typeof WEB_JOB_STATUSES)[number];

export const WEB_ERROR_CODES = [
  "user_not_found",
  "profile_unavailable",
  "login_required",
  "session_expired",
  "security_check_required",
  "captcha_required",
  "temporary_error",
  "failed",
  "stopped"
] as const;
export type WebErrorCode = (typeof WEB_ERROR_CODES)[number];
