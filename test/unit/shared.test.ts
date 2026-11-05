import { describe, expect, it, vi } from "vitest";
import { cleanTitle, companyFromSiteName, employmentTypeFrom, isoDate, remotePolicyFrom, salaryFrom, textOf, unescapeHtml } from "../../src/extraction/normalize";
import { appUrl, isVersionAtLeast } from "../../src/shared/config";
import { recentLogs, redact, log } from "../../src/shared/log";
import { isTrustedSender, parseRequest } from "../../src/shared/messages";
import { isRestrictedJobUrl, originPattern, pageKind, restrictedPlatformFor } from "../../src/shared/policy";
import { DEFAULT_SETTINGS, loadSettings, migrateSettings, saveSettings } from "../../src/shared/settings";

const ID = "ajbdeolccbgjinhdmllogiefhmcogpma";
const ORIGIN = `chrome-extension://${ID}`;
const UUID = "6f1e2d3c-aaaa-4bbb-8ccc-1234567890ab";

describe("messages: only the extension's own pages, only well-formed requests", () => {
  it.each([
    [{ id: ID, url: `${ORIGIN}/popup.html` }, true],
    [{ id: ID, url: `${ORIGIN}/options.html`, tab: { id: 3 } }, true],
    [{ id: ID, url: "https://evil.example/" }, false], // our content script on a page
    [{ id: "other-extension", url: `chrome-extension://other-extension/x.html` }, false],
    [{ id: ID, url: `chrome-extension://${ID}evil/x.html` }, false],
    [{ id: ID }, false],
    [{ url: `${ORIGIN}/popup.html` }, false],
  ])("trusts %o: %s", (sender, ok) => {
    expect(isTrustedSender(sender as chrome.runtime.MessageSender, ID, ORIGIN)).toBe(ok);
  });

  it("accepts valid requests", () => {
    expect(parseRequest({ type: "tab.state", tabId: 4, refresh: true })).toEqual({ type: "tab.state", tabId: 4, refresh: true });
    expect(parseRequest({ type: "import.get", importId: UUID })).toEqual({ type: "import.get", importId: UUID });
    expect(parseRequest({ type: "app.open", path: "/applications/" + UUID })).not.toBeNull();
    expect(parseRequest({ type: "settings.set", patch: { theme: "light" } })).not.toBeNull();
    expect(parseRequest({ type: "import.save", importId: UUID, tabId: null, fields: { title: "T", company_name: "C", status: "applied", salary_min: 1 } })).not.toBeNull();
  });

  it.each([
    null,
    "session.get",
    { type: "nope" },
    { type: "tab.state", tabId: -1 },
    { type: "tab.state", tabId: "1" },
    { type: "import.get", importId: "../../admin" },
    { type: "import.fromText", tabId: null, url: "javascript:alert(1)", text: "x".repeat(200) },
    { type: "import.fromText", tabId: null, url: null, text: "   " },
    { type: "import.fromText", tabId: null, url: null, text: "x".repeat(60_001) },
    { type: "app.open", path: "https://evil.example" },
    { type: "app.open", path: "//evil.example" },
    { type: "app.open", path: "/x\"><script>" },
    { type: "settings.set", patch: { theme: "dark", apiUrl: "https://evil.example" } },
    { type: "import.save", importId: UUID, tabId: null, fields: { title: "T", company_name: "C", status: "hired" } },
    { type: "import.save", importId: UUID, tabId: null, fields: { title: "T", company_name: "C", status: "applied", notes: { $gt: "" } } },
  ])("drops %o", (raw) => {
    expect(parseRequest(raw)).toBeNull();
  });
});

describe("policy", () => {
  it.each([
    ["https://www.linkedin.com/jobs/view/123", "linkedin"],
    ["https://lnkd.in/abc", "linkedin"],
    ["https://uk.indeed.com/viewjob?jk=1", "indeed"],
    ["https://www.stepstone.de/x", "stepstone"],
    ["https://www.xing.com/jobs/x", "xing"],
    ["https://www.glassdoor.co.uk/x", "glassdoor"],
    ["https://www.monster.de/x", "monster"],
    ["https://notlinkedin.com/jobs", null],
    ["https://linkedin.com.evil.example/jobs", null],
    ["https://boards.greenhouse.io/x/jobs/1", null],
  ])("%s -> %s", (url, key) => {
    expect(restrictedPlatformFor(url)?.key ?? null).toBe(key);
  });

  it("looks up only posting addresses on restricted platforms", () => {
    expect(isRestrictedJobUrl("https://www.linkedin.com/jobs/view/3999999999/")).toBe(true);
    expect(isRestrictedJobUrl("https://www.linkedin.com/jobs/view/senior-sre-at-acme-3999999999")).toBe(true);
    expect(isRestrictedJobUrl("https://www.linkedin.com/jobs/search/?currentJobId=3999999999")).toBe(true);
    expect(isRestrictedJobUrl("https://www.linkedin.com/feed/")).toBe(false);
    expect(isRestrictedJobUrl("https://www.linkedin.com/in/someone/")).toBe(false);
    expect(isRestrictedJobUrl("https://de.indeed.com/jobs?q=sre")).toBe(false);
    expect(isRestrictedJobUrl("https://de.indeed.com/jobs?q=sre&vjk=abc123def456")).toBe(true);
  });

  it("classifies pages and asks for one https site at a time", () => {
    expect(pageKind("https://jobs.example/1", "http://localhost:3000")).toBe("web");
    expect(pageKind("http://localhost:3000/applications", "http://localhost:3000")).toBe("careeros");
    expect(pageKind("chrome://extensions", "http://localhost:3000")).toBe("unsupported");
    expect(pageKind("https://chromewebstore.google.com/detail/x", "http://localhost:3000")).toBe("unsupported");
    expect(pageKind(undefined, "http://localhost:3000")).toBe("unsupported");
    expect(originPattern("https://jobs.example/a/b?c")).toBe("https://jobs.example/*");
    expect(originPattern("http://jobs.example/")).toBeNull();
  });
});

describe("config", () => {
  it("builds GetCareer links only for app paths", () => {
    expect(appUrl("/applications/1")).toBe("http://localhost:3000/applications/1");
    expect(() => appUrl("//evil.example")).toThrow();
    expect(() => appUrl("https://evil.example")).toThrow();
  });
  it("compares versions", () => {
    expect(isVersionAtLeast("0.1.0", "0.1.0")).toBe(true);
    expect(isVersionAtLeast("0.2.0", "0.10.0")).toBe(false);
    expect(isVersionAtLeast("1.0", "0.9.9")).toBe(true);
  });
});

describe("settings", () => {
  it("defaults to dark and fills invalid values field by field", () => {
    expect(migrateSettings(undefined).settings).toEqual(DEFAULT_SETTINGS);
    const { settings } = migrateSettings({ version: 1, theme: "neon", defaultStatus: "applied", followTabs: "yes" });
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, defaultStatus: "applied" });
  });
  it("runs migrations forward in order", () => {
    const steps = { 1: (r: Record<string, unknown>) => ({ ...r, theme: r.dark ? "dark" : "light" }) };
    const { settings, changed } = migrateSettings({ version: 1, dark: false }, steps, 2);
    expect(settings.theme).toBe("light");
    expect(settings.version).toBe(2);
    expect(changed).toBe(true);
  });
  it("never overwrites settings from a newer version", async () => {
    await chrome.storage.local.set({ settings: { version: 9, theme: "light", future: true } });
    const s = await loadSettings();
    expect(s.theme).toBe("light");
    expect((await chrome.storage.local.get("settings")).settings).toMatchObject({ version: 9, future: true });
  });
  it("doesn't write an upgraded old copy over a change saved meanwhile", async () => {
    let stored: unknown = { version: 1, theme: "light" };
    let reads = 0;
    const area = {
      get: async () => {
        // Another page saves "dark" between this page's read and its write-back.
        if (reads++ === 1) stored = { ...DEFAULT_SETTINGS, theme: "dark" };
        return { settings: stored };
      },
      set: async (v: { settings: unknown }) => void (stored = v.settings),
    } as unknown as chrome.storage.StorageArea;
    expect((await loadSettings(area)).theme).toBe("dark");
    expect(stored).toMatchObject({ theme: "dark", version: 3 });
  });
  it("doesn't rewrite current settings stored with their keys in another order", async () => {
    const reordered = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).reverse());
    expect(migrateSettings(reordered).changed).toBe(false);
    const set = vi.spyOn(chrome.storage.local, "set");
    await chrome.storage.local.set({ settings: reordered });
    set.mockClear();
    await loadSettings();
    expect(set).not.toHaveBeenCalled();
  });
  it("upgrades an old copy in storage", async () => {
    await chrome.storage.local.set({ settings: { version: 1, theme: "light" } });
    expect((await loadSettings()).autofill).toEqual(DEFAULT_SETTINGS.autofill);
    expect((await chrome.storage.local.get("settings")).settings).toMatchObject({ version: 3, theme: "light", autofill: { enabled: true } });
  });
  it("saves a patch", async () => {
    expect((await saveSettings({ theme: "system" })).theme).toBe("system");
    expect((await loadSettings()).theme).toBe("system");
  });
});

describe("logs", () => {
  it("keep codes and origins but not secrets or personal data", () => {
    const r = redact({
      access_token: "a",
      refresh_token: "b",
      code_verifier: "c",
      email: "x@example.com",
      title: "Senior SRE",
      company: "Acme",
      description: "text",
      url: "https://jobs.example/acme/123?ref=abc",
      code: "invalid_session",
      status: 401,
      error: "network_error",
    });
    expect(r).toEqual({
      access_token: "[redacted]",
      refresh_token: "[redacted]",
      code_verifier: "[redacted]",
      email: "[redacted]",
      title: "[redacted]",
      company: "[redacted]",
      description: "[redacted]",
      url: "https://jobs.example",
      code: "invalid_session",
      status: 401,
      error: "network_error",
    });
  });
  it("keeps a bounded buffer", () => {
    for (let i = 0; i < 150; i++) log.info("tick", { i });
    expect(recentLogs().length).toBe(100);
  });
});

describe("normalisers (ports of the API's)", () => {
  it.each([
    ["Senior SRE (m/w/d)", "Senior SRE"],
    ["Werkstudent (w/m/d) Marketing", "Werkstudent Marketing"],
    ["Engineer [f/m/x]", "Engineer"],
    ["Designer (all genders)", "Designer"],
    ["  - Platform Lead | ", "Platform Lead"],
  ])("cleanTitle(%s)", (raw, out) => expect(cleanTitle(raw)).toBe(out));

  it.each([
    ["Datadog Careers | Datadog", "Datadog"],
    ["Karriere bei Tailspin Toys", "Tailspin Toys"],
    ["Jobs at Acme", "Acme"],
    ["Careers", null],
  ])("companyFromSiteName(%s)", (raw, out) => expect(companyFromSiteName(raw)).toBe(out));

  it("maps employment and remote wording", () => {
    expect(employmentTypeFrom("FULL_TIME")).toBe("full_time");
    expect(employmentTypeFrom("Werkstudent")).toBe("internship");
    expect(employmentTypeFrom("Teilzeit")).toBe("part_time");
    expect(employmentTypeFrom("Volunteer")).toBeNull();
    expect(remotePolicyFrom("Hybrid (2 days)")).toBe("hybrid");
    expect(remotePolicyFrom("Fully remote")).toBe("remote");
    expect(remotePolicyFrom("On-site")).toBe("onsite");
    expect(remotePolicyFrom("Berlin")).toBeNull();
  });

  it("reads salaries only when currency and period are stated", () => {
    expect(salaryFrom({ currency: "eur", value: { minValue: 60000, maxValue: 70000, unitText: "YEAR" } })).toBe("EUR 60,000–70,000 per year");
    expect(salaryFrom({ currency: "EUR", value: 25, unitText: "HOUR" })).toBe("EUR 25 per hour");
    expect(salaryFrom({ currency: "EUR", value: { value: 60000 } })).toBeNull();
    expect(salaryFrom({ currency: "euros", value: { minValue: 1, unitText: "YEAR" } })).toBeNull();
    expect(salaryFrom("competitive")).toBeNull();
  });

  it("decodes entities without the DOM and reads JSON-LD values", () => {
    expect(unescapeHtml("R&amp;D &lt;team&gt; &#39;x&#x27; &nbsp;")).toBe("R&D <team> 'x'  ");
    expect(unescapeHtml("&#xD800;")).toBe("&#xD800;");
    expect(textOf([{ name: "A" }, { "@value": "B" }, null])).toBe("A, B");
    expect(isoDate("2026-10-20T08:00:00Z")).toBe("2026-10-20");
    expect(isoDate("soon")).toBeNull();
  });
});
