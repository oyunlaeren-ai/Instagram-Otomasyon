import type { InstagramErrorCode } from "./constants";

export class InstagramServiceError extends Error {
  readonly code: InstagramErrorCode;
  readonly retryable: boolean;

  constructor(code: InstagramErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "InstagramServiceError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class UnsupportedInstagramActionError extends InstagramServiceError {
  constructor(action: string) {
    super(
      "UNSUPPORTED_ACTION",
      `Instagram API bu işlemi desteklemiyor: ${action}`
    );
    this.name = "UnsupportedInstagramActionError";
  }
}

export class AuthRequiredError extends InstagramServiceError {
  constructor(message = "Instagram hesabı bağlı değil.") {
    super("AUTH_REQUIRED", message);
    this.name = "AuthRequiredError";
  }
}

export class TokenExpiredError extends InstagramServiceError {
  constructor(message = "Instagram oturumunun süresi doldu.") {
    super("TOKEN_EXPIRED", message);
    this.name = "TokenExpiredError";
  }
}

export class PermissionDeniedError extends InstagramServiceError {
  constructor(message = "Bu bilgi mevcut API izinleriyle alınamıyor.") {
    super("PERMISSION_DENIED", message);
    this.name = "PermissionDeniedError";
  }
}

export class RateLimitedError extends InstagramServiceError {
  constructor(
    message = "Instagram API işlem limiti nedeniyle otomasyon duraklatıldı."
  ) {
    super("RATE_LIMITED", message, true);
    this.name = "RateLimitedError";
  }
}

export class ApiError extends InstagramServiceError {
  constructor(message = "Instagram API hatası oluştu.") {
    super("API_ERROR", message, true);
    this.name = "ApiError";
  }
}

export class NetworkError extends InstagramServiceError {
  constructor(message = "Ağ bağlantısı kurulamadı.") {
    super("NETWORK_ERROR", message, true);
    this.name = "NetworkError";
  }
}

export class AccountDisconnectedError extends InstagramServiceError {
  constructor(message = "Instagram hesabı bağlantısı kesildi.") {
    super("ACCOUNT_DISCONNECTED", message);
    this.name = "AccountDisconnectedError";
  }
}
