/**
 * HTTP to the GetCareer API: JSON in and out, timeouts, the API's error envelope, request ids.
 * Cookies are never sent (credentials: "omit"): the extension authenticates with its own
 * bearer token only, so it can't act through the website's session.
 */
import type { ApiErrorBody } from "../shared/api-types";
import { API_BASE, BUILD_TARGET, EXTENSION_VERSION } from "../shared/config";
import { ExtensionError, messageFor } from "../shared/errors";
import { log } from "../shared/log";

export type HttpOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** "bytes": the body as an ArrayBuffer with its type (documents to attach), not JSON. */
  as?: "json" | "bytes";
  body?: unknown;
  token?: string | null;
  timeoutMs?: number;
  /** Extra attempts on network errors and 502/503/504. Only used for GET. */
  retries?: number;
};

const DEFAULT_TIMEOUT = 15_000;
const RETRY_STATUS = new Set([502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function requestId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

async function errorFrom(res: Response, rid: string): Promise<ExtensionError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  const e = body?.error;
  if (e && typeof e.code === "string") {
    const details = res.status === 429 ? { ...(e.details as object), retry_after: res.headers.get("Retry-After") } : e.details;
    return new ExtensionError(e.code, typeof e.message === "string" ? e.message : messageFor(e.code), res.status, details, e.request_id ?? rid);
  }
  const code = res.status >= 500 ? "server_error" : res.status === 401 ? "invalid_session" : "unknown";
  return new ExtensionError(code, messageFor(code), res.status, undefined, rid);
}

async function once<T>(path: string, opts: HttpOptions): Promise<T> {
  const rid = requestId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
  const headers: Record<string, string> = {
    Accept: opts.as === "bytes" ? "*/*" : "application/json",
    "X-Request-ID": rid,
    "X-CareerOS-Client": `extension/${EXTENSION_VERSION} (${BUILD_TARGET})`,
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
  } catch (err) {
    const code = controller.signal.aborted ? "timeout" : navigator.onLine === false ? "offline" : "network_error";
    throw new ExtensionError(code, messageFor(code), undefined, undefined, rid);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw await errorFrom(res, res.headers.get("X-Request-ID") ?? rid);
  if (res.status === 204) return null as T;
  if (opts.as === "bytes") {
    try {
      return { bytes: await res.arrayBuffer(), mime: res.headers.get("Content-Type") ?? "application/octet-stream" } as T;
    } catch {
      throw new ExtensionError("network_error", messageFor("network_error"), res.status, undefined, rid);
    }
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ExtensionError("server_error", messageFor("server_error"), res.status, undefined, rid);
  }
}

export async function http<T>(path: string, opts: HttpOptions = {}): Promise<T> {
  const retries = (opts.method ?? "GET") === "GET" ? (opts.retries ?? 2) : 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await once<T>(path, opts);
    } catch (err) {
      const e = err as ExtensionError;
      const transient = ["network_error", "timeout"].includes(e.code) || (e.status !== undefined && RETRY_STATUS.has(e.status));
      if (!transient || attempt >= retries) {
        log.warn("api.error", { path: path.split("?")[0], code: e.code, status: e.status ?? null, request_id: e.requestId ?? null });
        throw err;
      }
      await sleep(500 * 3 ** attempt);
    }
  }
}
