import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessToken, connect, connectUrl, disconnect, parseRedirect, refresh } from "../../src/background/auth";
import { codeChallenge, randomString } from "../../src/background/pkce";
import { tokenStore } from "../../src/background/tokens";
import { vault } from "../../src/background/vault";
import type { ExtensionTokens } from "../../src/shared/api-types";

const REDIRECT = "https://ajbdeolccbgjinhdmllogiefhmcogpma.chromiumapp.org/careeros";

function tokens(n: number, accessMinutes = 15): ExtensionTokens {
  return {
    user: { id: "u1", email: "a@example.com", full_name: "A", preferred_language: "en", timezone: "Europe/Berlin", subscription_plan: "free" },
    session_id: "s1",
    access_token: `access-${n}`,
    access_token_expires_at: new Date(Date.now() + accessMinutes * 60_000).toISOString(),
    refresh_token: `refresh-${n}`,
    refresh_token_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  };
}

function json(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(async () => {
  await vault.clear();
});

describe("PKCE", () => {
  it("matches the RFC 7636 example", async () => {
    expect(await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("makes verifiers the API accepts", () => {
    const v = randomString(48);
    expect(v).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(randomString(48)).not.toBe(v);
  });
});

describe("connect URL and redirect", () => {
  it("asks the website's connect page with S256 and the client name", () => {
    const url = new URL(connectUrl(REDIRECT, "c".repeat(43), "s".repeat(32)));
    expect(url.origin + url.pathname).toBe("http://localhost:3000/connect/extension");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("client")).toMatch(/^GetCareer Companion \d/);
  });

  it.each([
    ["state mismatch", `${REDIRECT}?code=${"a".repeat(64)}&state=other`, "connect_failed"],
    ["foreign redirect", `https://evil.example/careeros?code=${"a".repeat(64)}&state=S`, "connect_failed"],
    ["declined", `${REDIRECT}?error=access_denied&state=S`, "connect_cancelled"],
    ["missing code", `${REDIRECT}?state=S`, "connect_failed"],
    ["odd code", `${REDIRECT}?code=%3Cscript%3E&state=S`, "connect_failed"],
  ])("rejects %s", (_name, url, code) => {
    expect(() => parseRedirect(url, REDIRECT, "S")).toThrowError(expect.objectContaining({ code }));
  });

  it("returns the code for our own request", () => {
    expect(parseRedirect(`${REDIRECT}?code=${"a".repeat(64)}&state=S`, REDIRECT, "S")).toBe("a".repeat(64));
  });
});

describe("connect", () => {
  it("exchanges the code with the verifier matching the challenge, and stores the session", async () => {
    let sentChallenge = "";
    vi.mocked(chrome.identity.launchWebAuthFlow).mockImplementation(async ({ url }) => {
      const u = new URL(url);
      sentChallenge = u.searchParams.get("code_challenge")!;
      return `${REDIRECT}?code=${"k".repeat(64)}&state=${u.searchParams.get("state")}`;
    });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(await codeChallenge(body.code_verifier)).toBe(sentChallenge);
      expect(body.redirect_uri).toBe(REDIRECT);
      expect(init.credentials).toBe("omit");
      return json(200, tokens(1));
    });
    vi.stubGlobal("fetch", fetchMock);
    await connect();
    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:3000/api/v1/auth/extension/token");
    expect((await tokenStore.session())?.refreshToken).toBe("refresh-1");
    expect(await tokenStore.access()).toBe("access-1");
    // The refresh token never lands in chrome.storage (content scripts can read storage.local).
    expect(JSON.stringify((chrome.storage.local as unknown as { _data: object })._data)).not.toContain("refresh-1");
    expect(JSON.stringify((chrome.storage.session as unknown as { _data: object })._data)).not.toContain("refresh-1");
  });

  it("reports a closed window as cancelled and stores nothing", async () => {
    vi.mocked(chrome.identity.launchWebAuthFlow).mockRejectedValue(new Error("The user did not approve access."));
    await expect(connect()).rejects.toMatchObject({ code: "connect_cancelled" });
    expect(await tokenStore.session()).toBeNull();
  });
});

describe("refresh", () => {
  it("refreshes once for concurrent callers and rotates the stored refresh token", async () => {
    await tokenStore.save(tokens(1, 0));
    const fetchMock = vi.fn(async () => json(200, tokens(2)));
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([accessToken(), accessToken()]);
    expect(a).toBe("access-2");
    expect(b).toBe("access-2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ refresh_token: "refresh-1" });
    expect((await tokenStore.session())?.refreshToken).toBe("refresh-2");
  });

  it("forgets the session when the server ends it", async () => {
    await tokenStore.save(tokens(1, 0));
    vi.stubGlobal("fetch", vi.fn(async () => json(401, { error: { code: "invalid_session", message: "Session expired" } })));
    await expect(refresh()).rejects.toMatchObject({ code: "invalid_session" });
    expect(await tokenStore.session()).toBeNull();
  });

  it("keeps the session on network errors", async () => {
    await tokenStore.save(tokens(1, 0));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(refresh()).rejects.toMatchObject({ code: "network_error" });
    expect(await tokenStore.session()).not.toBeNull();
  });

  it("is not connected without a session", async () => {
    await expect(accessToken()).rejects.toMatchObject({ code: "not_connected" });
  });
});

describe("disconnect", () => {
  it("ends the session on the server with the bearer token and forgets it", async () => {
    await tokenStore.save(tokens(1));
    const fetchMock = vi.fn(async () => json(204, null));
    vi.stubGlobal("fetch", fetchMock);
    await disconnect();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/v1/auth/logout");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer access-1");
    expect(await tokenStore.session()).toBeNull();
  });

  it("forgets the session even when GetCareer can't be reached", async () => {
    await tokenStore.save(tokens(1));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await disconnect();
    expect(await tokenStore.session()).toBeNull();
    expect(await tokenStore.access()).toBeNull();
  });
});

describe("token store", () => {
  it("treats an access token about to expire as missing", async () => {
    await tokenStore.save(tokens(1, 0.5));
    expect(await tokenStore.access()).toBeNull();
  });
  it("drops an expired refresh token", async () => {
    await tokenStore.save({ ...tokens(1), refresh_token_expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await tokenStore.session()).toBeNull();
  });
});
