import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistry, detectFields } from "../../src/autofill/detector";
import { fillTab, scanTab, undoTab } from "../../src/background/autofill";
import { handle } from "../../src/background/router";
import { tokenStore } from "../../src/background/tokens";
import { vault } from "../../src/background/vault";
import { log, recentLogs } from "../../src/shared/log";
import { parseRequest } from "../../src/shared/messages";
import { DEFAULT_AUTOFILL, DEFAULT_SETTINGS, migrateSettings, saveSettings } from "../../src/shared/settings";
import { ANNA, load } from "./autofill-helpers";

const PAGE = "https://jobs.northwind.example/apply/4711";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const BOOT = (autofill: boolean | null) => ({
  api_version: 1,
  min_extension_version: "0.1.0",
  app_url: "http://localhost:3000",
  user: { id: "u", email: "anna@example.com", full_name: "Anna Schmidt", preferred_language: "en", timezone: "UTC", subscription_plan: "free" },
  capabilities: { ai_available: false, ai_consent: false, has_career_direction: false, primary_direction: null },
  features: { save_job: { enabled: true, reason: null }, ...(autofill === null ? {} : { autofill: { enabled: autofill, reason: null } }) },
  entitlements: { plan: "free", source: "none" },
  restricted_platforms: [],
});

async function connected() {
  await tokenStore.save({
    user: BOOT(true).user,
    session_id: "s",
    access_token: "a",
    access_token_expires_at: new Date(Date.now() + 900_000).toISOString(),
    refresh_token: "r",
    refresh_token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
}

/** A tab on `url` whose frame 0 holds a fixture form; frame 5 is a LinkedIn iframe. */
function tab(url: string, fixture = "simple-en.html") {
  vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 7, url } as never);
  load(fixture);
  const scan = { ...detectFields(document, createRegistry(), { layout: false }), frameUrl: url };
  const linkedin = { ...scan, frameUrl: "https://www.linkedin.com/jobs/apply/1" };
  vi.mocked(chrome.scripting.executeScript).mockImplementation((async (inj: { files?: string[]; func?: () => unknown; args?: unknown[]; target: { frameIds?: number[] } }) => {
    if (inj.files) return [];
    const src = String(inj.func);
    if (src.includes(".scan()")) return [{ frameId: 0, result: scan }, { frameId: 5, result: linkedin }];
    if (src.includes(".fill(")) {
      const [items, frameId] = inj.args as [{ fieldId: string }[], number];
      return [{ frameId, result: items.map((i) => ({ frameId, fieldId: i.fieldId, status: "filled" })) }];
    }
    if (src.includes(".undo(")) return [{ frameId: 0, result: [{ frameId: -1, fieldId: "f2", status: "restored" }] }];
    return [{ frameId: 0, result: null }];
  }) as never);
}

function api(autofill: boolean | null = true) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/extension/bootstrap")) return json(200, BOOT(autofill));
    if (url.endsWith("/extension/autofill-profile")) return json(200, ANNA);
    return json(404, { error: { code: "not_found", message: "Not found" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  await vault.clear();
});

describe("scan", () => {
  it("reads the form, fetches the profile with the extension token, and plans", async () => {
    await connected();
    tab(PAGE);
    const fetchMock = api();
    const plan = await scanTab(7);
    expect(plan.isApplicationForm).toBe(true);
    expect(plan.pageUrl).toBe(PAGE);
    expect(plan.counts.ready).toBe(11);
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/autofill-profile")) as unknown as [string, RequestInit];
    expect((call[1].headers as Record<string, string>).Authorization).toBe("Bearer a");
  });

  it("ignores frames from restricted platforms inside the page", async () => {
    await connected();
    tab(PAGE);
    api();
    const plan = await scanTab(7);
    expect(new Set(plan.items.map((i) => i.frameId))).toEqual(new Set([0]));
  });

  it("keeps no profile data in the browser's storage, and none in the logs", async () => {
    await connected();
    tab(PAGE);
    api();
    log.info("start", {});
    await scanTab(7);
    const stored = JSON.stringify([await chrome.storage.local.get(null), await chrome.storage.session.get(null)]);
    for (const v of ["Torstraße", "+49 151", "Nordlicht", "linkedin.com/in/anna"]) expect(stored).not.toContain(v);
    const logs = JSON.stringify(recentLogs());
    for (const v of ["Anna", "anna@example.com", "+49 151", "Nordlicht"]) expect(logs).not.toContain(v);
    expect(logs).toContain("autofill.scanned");
  });

  it.each([
    ["https://www.linkedin.com/jobs/view/123/apply", "platform_restricted"],
    ["https://de.indeed.com/viewjob?jk=abc", "platform_restricted"],
    ["http://localhost:3000/applications", "autofill_unsupported"],
    ["chrome://settings", "autofill_unsupported"],
  ])("refuses %s without touching the page", async (url, code) => {
    await connected();
    tab(url);
    api();
    await expect(scanTab(7)).rejects.toMatchObject({ code });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("follows GetCareer: no AutoFill when the account doesn't have the feature", async () => {
    await connected();
    tab(PAGE);
    api(null);
    await expect(scanTab(7)).rejects.toMatchObject({ code: "feature_unavailable" });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("does nothing when AutoFill is switched off", async () => {
    await connected();
    tab(PAGE);
    api();
    await saveSettings({ autofill: { ...DEFAULT_AUTOFILL, enabled: false } });
    await expect(scanTab(7)).rejects.toMatchObject({ code: "autofill_disabled" });
  });

  it("needs a connected account", async () => {
    tab(PAGE);
    api();
    await expect(scanTab(7)).rejects.toMatchObject({ code: "not_connected" });
  });

  it("reports no access when the tab can't be scripted", async () => {
    await connected();
    vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 7, url: PAGE } as never);
    vi.mocked(chrome.scripting.executeScript).mockRejectedValue(new Error("Cannot access contents of the page"));
    api();
    await expect(scanTab(7)).rejects.toMatchObject({ code: "no_access" });
  });
});

describe("fill and undo", () => {
  const item = (fieldId: string, frameOrigin = "https://jobs.northwind.example", frameId = 0) => ({
    frameId,
    fieldId,
    frameOrigin,
    value: { kind: "text" as const, text: "Anna" },
    overwrite: false,
  });

  it("passes the reviewed values to their frame and nothing else", async () => {
    await connected();
    tab(PAGE);
    api();
    const report = await fillTab(7, PAGE, [item("f2"), item("f3")], []);
    expect(report.filled).toBe(2);
    const call = vi.mocked(chrome.scripting.executeScript).mock.calls.find(([inj]) => String((inj as { func?: unknown }).func).includes(".fill(")) as unknown as [{ target: unknown; args: unknown[] }];
    expect(call[0].target).toEqual({ tabId: 7, frameIds: [0] });
    // No files were chosen, so none are fetched or passed.
    expect(call[0].args).toEqual([[item("f2"), item("f3")], 0, "https://jobs.northwind.example", {}]);
  });

  it("refuses to fill when the tab moved to another site since the review", async () => {
    await connected();
    tab("https://evil.example/form");
    api();
    await expect(fillTab(7, PAGE, [item("f2")], [])).rejects.toMatchObject({ code: "page_changed" });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("refuses frames on restricted platforms", async () => {
    await connected();
    tab(PAGE);
    api();
    const report = await fillTab(7, PAGE, [item("f2", "https://www.linkedin.com", 5)], []);
    expect(report).toEqual({ filled: 0, results: [{ frameId: 5, fieldId: "f2", status: "wrong_page" }] });
  });

  it("undoes in every frame and reports per frame", async () => {
    await connected();
    tab(PAGE);
    const report = await undoTab(7);
    expect(report).toEqual({ restored: 1, kept: 0, results: [{ frameId: 0, fieldId: "f2", status: "restored" }] });
  });

  it("is reachable through the message router", async () => {
    await connected();
    tab(PAGE);
    api();
    const res = await handle({ type: "autofill.scan", tabId: 7 });
    expect(res.ok).toBe(true);
  });
});

describe("messages", () => {
  const ok = { frameId: 0, fieldId: "f12", frameOrigin: "https://jobs.example", value: { kind: "text", text: "Anna" }, overwrite: false };

  it("accepts well-formed AutoFill requests and drops extra keys", () => {
    const r = parseRequest({ type: "autofill.fill", tabId: 3, pageUrl: PAGE, items: [{ ...ok, extra: "x", value: { ...ok.value, html: "<b>" } }], attention: [{ frameId: 0, fieldId: "f1", junk: 1 }] });
    expect(r).toEqual({ type: "autofill.fill", tabId: 3, pageUrl: PAGE, items: [ok], attention: [{ frameId: 0, fieldId: "f1" }] });
    expect(parseRequest({ type: "autofill.scan", tabId: 3 })).toEqual({ type: "autofill.scan", tabId: 3 });
    expect(parseRequest({ type: "autofill.undo", tabId: 3 })).toEqual({ type: "autofill.undo", tabId: 3, fields: undefined });
    expect(parseRequest({ type: "settings.set", patch: { autofill: { enabled: false } } })).not.toBeNull();
  });

  it.each([
    { type: "autofill.fill", tabId: 3, pageUrl: PAGE, items: [], attention: [] },
    { type: "autofill.fill", tabId: 3, pageUrl: "javascript:alert(1)", items: [ok], attention: [] },
    { type: "autofill.fill", tabId: 3, pageUrl: PAGE, items: [{ ...ok, fieldId: "#fn" }], attention: [] },
    { type: "autofill.fill", tabId: 3, pageUrl: PAGE, items: [{ ...ok, frameOrigin: "https://x.example/path" }], attention: [] },
    { type: "autofill.fill", tabId: 3, pageUrl: PAGE, items: [{ ...ok, value: { kind: "script", text: "x" } }], attention: [] },
    { type: "autofill.fill", tabId: 3, pageUrl: PAGE, items: [{ ...ok, value: { kind: "text", text: "x".repeat(10_001) } }], attention: [] },
    { type: "autofill.fill", tabId: 3, pageUrl: PAGE, items: Array(401).fill(ok), attention: [] },
    { type: "autofill.fill", tabId: 3, pageUrl: PAGE, items: [{ ...ok, overwrite: "yes" }], attention: [] },
    { type: "autofill.undo", tabId: 3, fields: [{ frameId: -1, fieldId: "f1" }] },
    { type: "autofill.scan", tabId: "3" },
    { type: "settings.set", patch: { autofill: "off" } },
  ])("drops %o", (raw) => {
    expect(parseRequest(raw)).toBeNull();
  });
});

describe("settings", () => {
  it("adds AutoFill (on, every category but job preferences) when upgrading from version 1", () => {
    const { settings } = migrateSettings({ version: 1, theme: "light", defaultStatus: "applied", followTabs: false, diagnostics: false });
    expect(settings).toMatchObject({ version: 3, theme: "light", autofill: DEFAULT_AUTOFILL });
    expect(DEFAULT_SETTINGS.autofill.enabled).toBe(true);
  });

  it("cleans AutoFill settings field by field", () => {
    const { settings } = migrateSettings({
      version: 2,
      autofill: { enabled: "no", categories: { personal: false, links: "x", sensitive: true }, excluded: ["phone", "phone", "password", 3, "salary_expectation"] },
    });
    expect(settings.autofill).toEqual({
      enabled: true,
      categories: { personal: false, professional: true, links: true, history: true, preferences: false },
      excluded: ["phone", "salary_expectation"],
      history: true,
      answers: { language: "auto", length: "medium", tone: "professional" },
      defaultCv: null,
    });
  });

  it("upgrades version 2 to 3 keeping the user's choices, with job preferences off", () => {
    const { settings } = migrateSettings({
      version: 2,
      theme: "light",
      autofill: { enabled: false, categories: { personal: true, professional: false, links: true }, excluded: ["phone"] },
    });
    expect(settings.version).toBe(3);
    expect(settings.autofill).toEqual({ ...DEFAULT_AUTOFILL, enabled: false, categories: { ...DEFAULT_AUTOFILL.categories, professional: false }, excluded: ["phone"] });
    expect(settings.autofill.categories.preferences).toBe(false);
  });

  it("keeps valid answer settings and a CV reference, and drops anything else", () => {
    const cv = "resume:0b6f1f7e-3c2a-4a59-9e4e-2d2f1c7f9a11";
    const ok = migrateSettings({ version: 3, autofill: { answers: { language: "de", length: "short", tone: "warm" }, defaultCv: cv, history: false } }).settings.autofill;
    expect(ok).toMatchObject({ answers: { language: "de", length: "short", tone: "warm" }, defaultCv: cv, history: false });
    const bad = migrateSettings({ version: 3, autofill: { answers: { language: "fr", length: 9, tone: "rude" }, defaultCv: "generated:x/../../y", history: "yes" } }).settings.autofill;
    expect(bad).toMatchObject({ answers: DEFAULT_AUTOFILL.answers, defaultCv: null, history: true });
  });
});

describe("clearing local data (Options → Privacy)", () => {
  it("drops page readings and settings but keeps the connection", async () => {
    await chrome.storage.session.set({ "auth.access": { token: "a", expiresAt: 1 }, "tab.7": { url: PAGE }, "intent.7": { mode: "autofill" } });
    await saveSettings({ theme: "light", autofill: { ...DEFAULT_AUTOFILL, excluded: ["phone"] } });
    const res = await handle({ type: "data.clear" });
    expect(res).toMatchObject({ ok: true, data: { theme: "dark", autofill: DEFAULT_AUTOFILL } });
    expect(await chrome.storage.session.get(null)).toEqual({ "auth.access": { token: "a", expiresAt: 1 } });
    expect(parseRequest({ type: "data.clear" })).toEqual({ type: "data.clear" });
  });
});
