export type LogPrefix = "[InstagramAuth]" | "[InstagramAPI]" | "[Automation]" | "[Database]" | "[OAuthCallback]";

function redact(value: string): string {
  return value
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/client_secret=[^&\s]+/gi, "client_secret=[redacted]")
    .replace(/code=(?!true\b|false\b)[^&\s]+/gi, "code=[redacted]")
    .replace(/META_APP_SECRET=[^&\s]+/gi, "META_APP_SECRET=[redacted]");
}

export function createLogger(prefix: LogPrefix) {
  return {
    info(message: string, extra?: unknown): void {
      if (extra === undefined) {
        console.log(`${prefix} ${redact(message)}`);
        return;
      }
      console.log(`${prefix} ${redact(message)}`, extra);
    },
    warn(message: string, extra?: unknown): void {
      if (extra === undefined) {
        console.warn(`${prefix} ${redact(message)}`);
        return;
      }
      console.warn(`${prefix} ${redact(message)}`, extra);
    },
    error(message: string, extra?: unknown): void {
      if (extra === undefined) {
        console.error(`${prefix} ${redact(message)}`);
        return;
      }
      console.error(`${prefix} ${redact(message)}`, extra);
    }
  };
}
