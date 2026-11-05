import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, call } from "../../src/background/api";
import { http } from "../../src/background/http";
import { tokenStore } from "../../src/background/tokens";
import { vault } from "../../src/background/vault";

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const t = (n: number, min = 15) => ({
  user: { id: "u", email: "e@example.com", full_name: "E", preferred_language: "en", timezone: "UTC", subscription_plan: "free" },
  session_id: "s",
  access_token: `a${n}`,
  access_token_expires_at: new Date(Date.now() + min * 60_000).toISOString(),
  refresh_token: `r${n}`,
  refresh_token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
});

beforeEach(async () => {
  vi.useRealTimers();
  await vault.clear();
});

describe("http", () => {
  it("sends JSON without cookies, with a request id and client header", async () => {
    const fetchMock = vi.fn(async () => json(200, { ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await http("/x", { method: "POST", body: { a: 1 }, token: "tok" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(url).toBe("http://localhost:3000/api/v1/x");
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect(h.Authorization).toBe("Bearer tok");
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["X-Request-ID"]).toMatch(/^[a-f0-9]{32}$/);
    expect(h["X-CareerOS-Client"]).toMatch(/^extension\/\d/);
  });

  it("turns the API's error envelope into a typed error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(409, { error: { code: "possible_duplicate", message: "Looks tracked", details: { duplicates: [] }, request_id: "rid1" } })));
    await expect(http("/x", { method: "POST" })).rejects.toMatchObject({ code: "possible_duplicate", status: 409, message: "Looks tracked", requestId: "rid1" });
  });

  it("passes Retry-After on rate limits", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(429, { error: { code: "rate_limited", message: "Slow down" } }, { "Retry-After": "30" })));
    await expect(http("/x", { method: "POST" })).rejects.toMatchObject({ code: "rate_limited", details: { retry_after: "30" } });
  });

  it("retries GETs on 503 and network errors, but never POSTs", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const p = http("/x");
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();

    const postMock = vi.fn(async () => json(503, {}));
    vi.stubGlobal("fetch", postMock);
    await expect(http("/x", { method: "POST" })).rejects.toMatchObject({ code: "server_error" });
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init: RequestInit) => new Promise((_r, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))),
    );
    await expect(http("/x", { method: "POST", timeoutMs: 20 })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("authenticated calls", () => {
  it("refreshes once on 401 and repeats the request", async () => {
    await tokenStore.save(t(1));
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (url.endsWith("/auth/extension/refresh")) return json(200, t(2));
      return auth === "Bearer a2" ? json(200, { fine: true }) : json(401, { error: { code: "invalid_token", message: "expired" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(call("/extension/bootstrap")).resolves.toEqual({ fine: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shares one request between identical GETs in flight", async () => {
    await tokenStore.save(t(1));
    const fetchMock = vi.fn(async () => json(200, { n: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([api.getImport("11111111-1111-1111-1111-111111111111"), api.getImport("11111111-1111-1111-1111-111111111111")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tells open pages when the connection ended", async () => {
    await tokenStore.save(t(1));
    vi.stubGlobal("fetch", vi.fn(async () => json(401, { error: { code: "invalid_session", message: "gone" } })));
    await expect(call("/extension/bootstrap")).rejects.toMatchObject({ code: "invalid_session" });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "broadcast.session" });
  });

  it("sends a page capture as the import body", async () => {
    await tokenStore.save(t(1));
    const fetchMock = vi.fn(async () => json(201, { id: "i" }));
    vi.stubGlobal("fetch", fetchMock);
    const capture = { url: "https://jobs.example/1", canonical_url: null, document_title: null, meta: {}, json_ld: [], page_fields: {}, description_text: "x", adapter: "generic", extension_version: "0.1.0" };
    await api.importFromCapture(capture);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/v1/job-imports");
    expect(JSON.parse(String(init.body))).toEqual({ capture });
  });
});
