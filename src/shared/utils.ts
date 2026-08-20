import type { HistoryDateRange } from "./constants";

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function todayStartIso(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

export function rangeStartIso(range: HistoryDateRange): string | null {
  if (range === "all") {
    return null;
  }
  const date = new Date();
  if (range === "today") {
    date.setHours(0, 0, 0, 0);
    return date.toISOString();
  }
  const days = range === "7d" ? 7 : 30;
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

const USERNAME_PATTERN = /^[a-zA-Z0-9._]{1,30}$/;

export function sanitizeUsername(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /^[=+\t]/.test(trimmed) || trimmed.startsWith("@=") || trimmed.includes("://")) {
    return null;
  }
  const cleaned = trimmed.replace(/^@/, "").replace(/^['`]+/, "");
  if (!USERNAME_PATTERN.test(cleaned) || cleaned.toLowerCase() === "username") {
    return null;
  }
  return cleaned;
}

export function parseCsvUsernames(
  csvText: string,
  options: { maxBytes?: number; maxRows?: number } = {}
): string[] {
  const maxBytes = options.maxBytes ?? 1_000_000;
  const maxRows = options.maxRows ?? 5000;
  const bytes = new TextEncoder().encode(csvText).length;
  if (bytes > maxBytes) {
    throw new Error("CSV dosyası çok büyük.");
  }
  const lines = csvText.split(/\r?\n/);
  const usernames: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (usernames.length >= maxRows) {
      break;
    }
    const firstCell = line.split(",")[0] ?? "";
    const username = sanitizeUsername(firstCell);
    if (!username || seen.has(username)) {
      continue;
    }
    seen.add(username);
    usernames.push(username);
  }
  return usernames;
}

export function toCsv(usernames: string[]): string {
  return ["username", ...usernames].join("\n");
}

export function isWithinWorkingHours(now: Date, start: string, end: string): boolean {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const current = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  if (startMinutes <= endMinutes) {
    return current >= startMinutes && current <= endMinutes;
  }
  return current >= startMinutes || current <= endMinutes;
}

export function generateOAuthState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toUserMessage(error: unknown): string {
  if (error instanceof Error && error.message && !/TypeError|Cannot read|undefined/i.test(error.message)) {
    return error.message;
  }
  return "İşlem sırasında beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.";
}
