import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importFromPage, importFromSelection } from "../../src/background/imports";
import { handle } from "../../src/background/router";
import { tabState } from "../../src/background/tabs";
import { tokenStore } from "../../src/background/tokens";
import { vault } from "../../src/background/vault";
import { extractPage } from "../../src/extraction";

const fixture = (name: string) =>
  new DOMParser().parseFromString(readFileSync(resolve(process.cwd(), "test/fixtures/pages", name), "utf8"), "text/html");

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const LOOKUP = {
  url: { canonical_url: "x", platform: "other", platform_name: "x", posting_id: null, restricted: false },
  applications: [],
  job: null,
  pending_import: null,
};

/** Fake browser: a tab with an address and a page; executeScript runs the real extractor on it. */
function tab(url: string | undefined, page = "jsonld-basic.html") {
  vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 7, url } as never);
  vi.mocked(chrome.scripting.executeScript).mockImplementation((async (inj: { func?: () => unknown; files?: string[] }) => {
    if (inj.files) return [];
    const src = String(inj.func);
    if (src.includes("getSelection")) return [{ result: "Selected job description text that the user highlighted on the page, long enough." }];
    return [{ result: extractPage(fixture(page), url!) }];
  }) as never);
}

async function connected() {
  await tokenStore.save({
    user: { id: "u", email: "e@example.com", full_name: "E", preferred_language: "en", timezone: "UTC", subscription_plan: "free" },
    session_id: "s",
    access_token: "a",
    access_token_expires_at: new Date(Date.now() + 900_000).toISOString(),
    refresh_token: "r",
    refresh_token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
}

beforeEach(async () => {
  await vault.clear();
});

describe("tab state", () => {
  it("reads a job page and looks it up with the posting's title and company", async () => {
    await connected();
    tab("https://careers.northwind.example/jobs/4711-senior-sre");
    const fetchMock = vi.fn(async () => json(200, LOOKUP));
    vi.stubGlobal("fetch", fetchMock);
    const s = await tabState(7);
    expect(s.kind).toBe("job");
    expect(s.extraction?.fields.title?.value).toBe("Senior Site Reliability Engineer");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/extension\/lookup$/);
    expect(JSON.parse(String(init.body))).toEqual({
      url: "https://careers.northwind.example/jobs/4711-senior-sre",
      title: "Senior Site Reliability Engineer",
      company: "Northwind Logistics GmbH",
      city: "Berlin",
    });
  });

  it("sends nothing for pages that aren't jobs", async () => {
    await connected();
    tab("https://blog.example/2026/cloud-bill", "not-job.html");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await tabState(7)).kind).toBe("not_job");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never scripts restricted platforms, but checks the status of a posting address", async () => {
    await connected();
    tab("https://www.linkedin.com/jobs/view/3999999999/");
    const fetchMock = vi.fn(async () => json(200, { ...LOOKUP, url: { ...LOOKUP.url, restricted: true } }));
    vi.stubGlobal("fetch", fetchMock);
    const s = await tabState(7);
    expect(s.kind).toBe("restricted");
    expect(s.restricted?.name).toBe("LinkedIn");
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't look up LinkedIn feeds or profiles", async () => {
    await connected();
    tab("https://www.linkedin.com/feed/");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await tabState(7)).kind).toBe("restricted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports no access when the browser hides the address", async () => {
    tab(undefined);
    const s = await tabState(7);
    expect(s.kind).toBe("no_access");
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("reports no access when scripting is refused", async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 7, url: "https://jobs.example/1" } as never);
    vi.mocked(chrome.scripting.executeScript).mockRejectedValue(new Error("Cannot access contents of the page"));
    expect((await tabState(7)).kind).toBe("no_access");
  });

  it("doesn't read CareerOS itself", async () => {
    tab("http://localhost:3000/applications");
    expect((await tabState(7)).kind).toBe("careeros");
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("keeps the lookup out of the result when CareerOS fails, with the reason", async () => {
    await connected();
    tab("https://careers.northwind.example/jobs/4711-senior-sre");
    vi.stubGlobal("fetch", vi.fn(async () => json(500, {})));
    const s = await tabState(7);
    expect(s.kind).toBe("job");
    expect(s.lookup).toBeNull();
    expect(s.lookupError?.code).toBe("server_error");
  });
});

describe("imports", () => {
  it("creates the import from the page capture, not from a link the server fetches", async () => {
    await connected();
    tab("https://careers.northwind.example/jobs/4711-senior-sre");
    const fetchMock = vi.fn(async (url: string) => (url.endsWith("/lookup") ? json(200, LOOKUP) : json(201, { id: "11111111-1111-1111-1111-111111111111", status: "queued" })));
    vi.stubGlobal("fetch", fetchMock);
    const imp = await importFromPage(7);
    expect(imp.id).toBe("11111111-1111-1111-1111-111111111111");
    const create = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/job-imports")) as unknown as [string, RequestInit];
    const body = JSON.parse(String(create[1].body));
    expect(Object.keys(body)).toEqual(["capture"]);
    expect(body.capture.json_ld[0].title).toBe("Senior Site Reliability Engineer (m/w/d)");
    expect((await chrome.storage.session.get("tab.7"))["tab.7"]).toMatchObject({ importId: "11111111-1111-1111-1111-111111111111" });
  });

  it("refuses to read restricted platforms and says what to do instead", async () => {
    await connected();
    tab("https://www.linkedin.com/jobs/view/3999999999/");
    vi.stubGlobal("fetch", vi.fn(async () => json(200, LOOKUP)));
    await expect(importFromPage(7)).rejects.toMatchObject({ code: "platform_restricted", message: expect.stringContaining("Select the job description") });
  });

  it("saves selected text from a restricted platform as pasted text", async () => {
    await connected();
    tab("https://www.linkedin.com/jobs/view/3999999999/");
    const fetchMock = vi.fn(async () => json(201, { id: "22222222-2222-2222-2222-222222222222", status: "queued" }));
    vi.stubGlobal("fetch", fetchMock);
    await importFromSelection(7);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ text: expect.stringContaining("Selected job description"), url: "https://www.linkedin.com/jobs/view/3999999999/" });
  });

  it("records a failed save from the popup on the tab, for the side panel", async () => {
    await connected();
    tab("https://www.linkedin.com/jobs/view/3999999999/");
    vi.stubGlobal("fetch", vi.fn(async () => json(200, LOOKUP)));
    const res = await handle({ type: "import.fromPage", tabId: 7 });
    expect(res.ok).toBe(false);
    expect((await chrome.storage.session.get("tab.7"))["tab.7"]).toMatchObject({ actionError: { code: "platform_restricted" } });
  });
});
