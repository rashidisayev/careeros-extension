/**
 * End-to-end against a running GetCareer (default http://localhost:3000, the dev build's
 * server): the extension's own background code connects, reads, saves, checks status,
 * refreshes and disconnects. A throwaway account is registered and deleted afterwards.
 *
 *   docker compose up   (api, worker, web)   then   pnpm test:live
 *
 * Only the browser window of chrome.identity is simulated: the test does what the website's
 * /connect/extension page does (POST /auth/extension/authorize with the website session).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { api } from "../../src/background/api";
import { connect, disconnect } from "../../src/background/auth";
import { http } from "../../src/background/http";
import { sessionInfo } from "../../src/background/session";
import { tokenStore } from "../../src/background/tokens";
import { vault } from "../../src/background/vault";
import { extractPage } from "../../src/extraction";
import { RESTRICTED_KEYS } from "../../src/shared/policy";
import type { ApplicationDetail, ImportOut } from "../../src/shared/api-types";
import { API_BASE } from "../../src/shared/config";
import { initialValues, toBody } from "../../src/ui/review";

const run = Date.now().toString(36);
const EMAIL = `ext-live-${run}@example.com`;
const PASSWORD = `Live-test-${run}-pw!`;
const jar = new Map<string, string>();

function remember(res: Response) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const [name, ...rest] = pair!.split("=");
    jar.set(name!.trim(), rest.join("="));
  }
}

/** A request as the GetCareer website makes it: cookies + CSRF header. */
async function web(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Cookie: Array.from(jar, ([k, v]) => `${k}=${v}`).join("; "),
      "X-CSRF-Token": jar.get("careeros_csrf") ?? "",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  remember(res);
  return res;
}

function page(name: string, replace: [string, string][] = []): Document {
  let html = readFileSync(resolve(process.cwd(), "test/fixtures/pages", name), "utf8");
  for (const [a, b] of replace) html = html.replaceAll(a, b);
  return new DOMParser().parseFromString(html, "text/html");
}

async function waitForImport(id: string): Promise<ImportOut> {
  for (let i = 0; i < 60; i++) {
    const imp = await api.getImport(id);
    if (!["queued", "retrieving", "extracting", "matching"].includes(imp.status)) return imp;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("import did not finish (is the worker running with the new code?)");
}

// Unique company and URL so catalog jobs and other runs never interfere.
const COMPANY = `Northwind Live ${run}`;
const JOB_URL = `https://careers.northwind-${run}.example/jobs/4711-senior-sre`;
const capturePage = () =>
  extractPage(page("jsonld-basic.html", [["Northwind Logistics GmbH", COMPANY], ["https://careers.northwind.example/jobs/4711-senior-sre", JOB_URL]]), JOB_URL)!;

let saved: ApplicationDetail;

beforeAll(async () => {
  await vault.clear();
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, full_name: "Extension Live Test", accept_terms: true, accept_privacy: true }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  remember(res);
  expect(jar.get("careeros_csrf")).toBeTruthy();
});

afterAll(async () => {
  const res = await web("/privacy/delete-account", { method: "POST", body: { password: PASSWORD, confirm: "DELETE" } });
  expect(res.status).toBe(204);
});

describe("GetCareer backend, through the extension's own code", () => {
  it("connects with the PKCE code flow and gets its own session", async () => {
    vi.mocked(chrome.identity.launchWebAuthFlow).mockImplementation(async ({ url }) => {
      const q = new URL(url).searchParams;
      expect(new URL(url).pathname).toBe("/connect/extension");
      const res = await web("/auth/extension/authorize", {
        method: "POST",
        body: {
          redirect_uri: q.get("redirect_uri"),
          code_challenge: q.get("code_challenge"),
          code_challenge_method: "S256",
          state: q.get("state"),
          client_name: q.get("client"),
        },
      });
      expect(res.status, await res.clone().text()).toBe(200);
      return ((await res.json()) as { redirect_to: string }).redirect_to;
    });
    const tokens = await connect();
    expect(tokens.user.email).toBe(EMAIL);
    const sessions = (await (await web("/auth/extension/sessions")).json()) as { id: string; client_name: string }[];
    expect(sessions.map((s) => s.id)).toContain(tokens.session_id);
    expect(sessions[0]?.client_name).toMatch(/^GetCareer Companion/);
  });

  it("reads bootstrap: features from the server, no plan logic in the extension", async () => {
    const s = await sessionInfo(true);
    expect(s.connected).toBe(true);
    if (!s.connected) return;
    expect(s.updateRequired).toBe(false);
    expect(s.bootstrap?.features.save_job?.enabled).toBe(true);
    expect(s.bootstrap?.entitlements.source).toBe("none");
    // The extension's copy of the list must match the API's, or pages could be read that GetCareer refuses.
    expect(s.bootstrap?.restricted_platforms.map((p) => p.key).sort()).toEqual([...RESTRICTED_KEYS].sort());
  });

  it("imports a posting from the page capture, without fetching anything", async () => {
    const ex = capturePage();
    expect((await api.lookup({ url: JOB_URL, title: ex.fields.title?.value, company: COMPANY })).applications).toEqual([]);
    const created = await api.importFromCapture(ex.capture);
    expect(created.method).toBe("extension");
    const imp = await waitForImport(created.id);
    expect(imp.status, JSON.stringify(imp.error_code)).toBe("ready");
    expect(imp.fields.title).toMatchObject({ value: "Senior Site Reliability Engineer", basis: "explicit", source: "structured_data" });
    expect(imp.fields.company_name?.value).toBe(COMPANY);
    expect(imp.fields.salary_min?.value).toBe(85000);
    expect(imp.duplicates).toEqual([]);

    saved = await api.saveImport(imp.id, toBody(initialValues(imp, "interested"), false));
    expect(saved.position_title).toBe("Senior Site Reliability Engineer");
    expect(saved.status).toBe("interested");
  });

  it("shows the status of a saved job on the same page", async () => {
    const out = await api.lookup({ url: JOB_URL, title: "Senior Site Reliability Engineer", company: COMPANY, city: "Berlin" });
    expect(out.applications).toHaveLength(1);
    expect(out.applications[0]).toMatchObject({ application_id: saved.id, status: "interested" });
    expect(out.applications[0]!.reasons).toContain("same_link");
  });

  it("detects the duplicate and refuses to save it unless asked for a separate application", async () => {
    const created = await api.importFromCapture(capturePage().capture);
    const imp = await waitForImport(created.id);
    expect(imp.duplicates.map((d) => d.application_id)).toContain(saved.id);
    await expect(api.saveImport(imp.id, toBody(initialValues(imp, "interested"), false))).rejects.toMatchObject({
      code: "possible_duplicate",
      status: 409,
    });
    // The existing application is untouched.
    const app = await api.application(saved.id);
    expect(app.status).toBe("interested");
    expect(app.updated_at).toBe(saved.updated_at);
  });

  it("refuses captures from restricted platforms, but accepts the text the user selected", async () => {
    const capture = { ...capturePage().capture, url: "https://www.linkedin.com/jobs/view/3999999999/" };
    await expect(api.importFromCapture(capture)).rejects.toMatchObject({ code: "platform_restricted", status: 400 });
    const text =
      "Senior Platform Engineer at Contoso in Berlin. You will run Kubernetes clusters, build CI/CD pipelines and mentor two engineers. Requirements: five years with Linux and Terraform.";
    const imp = await api.importFromText(text, "https://www.linkedin.com/jobs/view/3999999999/");
    expect(imp.method === "pasted_text" || imp.status === "queued").toBe(true);
  });

  it("rotates the refresh token when the access token expires", async () => {
    const before = (await tokenStore.session())!.refreshToken;
    await chrome.storage.session.remove("auth.access");
    await api.bootstrap();
    const after = (await tokenStore.session())!.refreshToken;
    expect(after).not.toBe(before);
    // The old refresh token is spent: replaying it (after the grace window) ends the session,
    // inside the window it's reported as stale.
    await expect(http("/auth/extension/refresh", { method: "POST", body: { refresh_token: before } })).rejects.toMatchObject({ status: 401 });
  });

  it("disconnects: the session ends on the server too", async () => {
    const stored = (await tokenStore.session())!;
    await disconnect();
    expect(await tokenStore.session()).toBeNull();
    await expect(http("/auth/extension/refresh", { method: "POST", body: { refresh_token: stored.refreshToken } })).rejects.toMatchObject({ status: 401 });
    const sessions = (await (await web("/auth/extension/sessions")).json()) as { id: string }[];
    expect(sessions.map((s) => s.id)).not.toContain(stored.sessionId);
  });
});
