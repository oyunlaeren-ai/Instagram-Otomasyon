export type LogPrefix =
  | "[InstagramAuth]"
  | "[InstagramAPI]"
  | "[Automation]"
  | "[Database]"
  | "[OAuthCallback]"
  | "[WebAutomation]";

function redact(value: string): string {
  return value
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/client_secret=[^&\s]+/gi, "client_secret=[redacted]")
    .replace(/code=(?!true\b|false\b)[^&\s]+/gi, "code=[redacted]")
    .replace(/META_APP_SECRET=[^&\s]+/gi, "META_APP_SECRET=[redacted]")
    .replace(/password[=:][^\s&"]+/gi, "password=[redacted]")
    .replace(/sessionid[=:][^\s&"]+/gi, "sessionid=[redacted]")
    .replace(/csrftoken[=:][^\s&"]+/gi, "csrftoken=[redacted]")
    .replace(/authorization[=:][^\s&"]+/gi, "authorization=[redacted]")
    .replace(/cookie[=:][^\n]+/gi, "cookie=[redacted]")
    .replace(/"(password|cookie|access_token|sessionid|csrftoken)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"');
}

function safeExtra(extra: unknown): string {
  try {
    return redact(typeof extra === "string" ? extra : JSON.stringify(extra));
  } catch {
    return "[unserializable]";
  }
}

export function createLogger(prefix: LogPrefix) {
  return {
    info(message: string, extra?: unknown): void {
      if (extra === undefined) {
        console.log(`${prefix} ${redact(message)}`);
        return;
      }
      console.log(`${prefix} ${redact(message)} ${safeExtra(extra)}`);
    },
    warn(message: string, extra?: unknown): void {
      if (extra === undefined) {
        console.warn(`${prefix} ${redact(message)}`);
        return;
      }
      console.warn(`${prefix} ${redact(message)} ${safeExtra(extra)}`);
    },
    error(message: string, extra?: unknown): void {
      if (extra === undefined) {
        console.error(`${prefix} ${redact(message)}`);
        return;
      }
      console.error(`${prefix} ${redact(message)} ${safeExtra(extra)}`);
    }
  };
}

export function containsSensitiveAutomationLog(text: string): boolean {
  return /access_token=(?!\[redacted\])[^\s&"]+|password=(?!\[redacted\])[^\s&"]+|sessionid=(?!\[redacted\])[^\s&"]+/i.test(
    text
  );
}
