/**
 * Structured logging without personal or sensitive data. Every field passes through
 * `redact`: secrets and free text are dropped, URLs are cut to their origin, strings are
 * shortened. The last 100 entries are kept in memory for "Copy diagnostics" in Options.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogEntry = { at: string; level: LogLevel; event: string; fields: Record<string, unknown> };

// Field names whose values never reach a log. Error codes (`error`) and statuses stay.
const SENSITIVE = /token|password|secret|authorization|cookie|verifier|challenge|auth_?code|state$|email|full_?name|user|text|description|notes?$|body|selection|html|query|title|company/i;
const MAX = 100;
const buffer: LogEntry[] = [];
let toConsole = false;

export function setConsoleLogging(enabled: boolean): void {
  toConsole = enabled;
}

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE.test(key)) return "[redacted]";
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) {
      try {
        return new URL(value).origin;
      } catch {
        return "[url]";
      }
    }
    return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  return "[object]";
}

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = redactValue(k, v);
  return out;
}

function write(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const entry: LogEntry = { at: new Date().toISOString(), level, event, fields: redact(fields) };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  if (toConsole || level === "error") {
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    fn(`[careeros] ${event}`, entry.fields);
  }
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => write("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write("error", event, fields),
};

export function recentLogs(): LogEntry[] {
  return buffer.slice();
}
