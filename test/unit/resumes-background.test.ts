/**
 * Tailored resumes in the service worker, against a fetch stub of GetCareer's job-resumes API:
 * the job read from the tab, one request per user action (Idempotency-Key, repeated clicks
 * joined, resent only when that is safe), progress, a new version, the file checked before it
 * is used, attaching through AutoFill, and nothing but ids kept in the browser.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractPage } from "../../src/extraction";
import { fillTab } from "../../src/background/autofill";
import { resumeCreate, resumeDetails, resumeFile, resumeProgress, resumeRegenerate } from "../../src/background/resumes";
import { tokenStore } from "../../src/background/tokens";
import { vault } from "../../src/background/vault";
import type { FillItem } from "../../src/autofill/types";
import type { LookupOut } from "../../src/shared/api-types";
import { recentLogs } from "../../src/shared/log";
import { parseRequest } from "../../src/shared/messages";
import { resumeFileName, safeResumeName, type ResumeInput } from "../../src/shared/resumes";
import type { TabState } from "../../src/shared/types";

const POSTING = "https://boards.greenhouse.io/contoso/jobs/4012345";
const APPLY = "https://careers.contoso.example/apply/77";
const RID = "6f1c2a9e-3b7d-4c51-9a0e-2d8f4b7c1e55";
const RID2 = "7a2d3b0f-4c8e-4d62-8b1f-3e9a5c8d2f66";
const APP = "a3d9c7e1-8b2f-4a6d-9e0c-5f1b2a3c4d5e";
const PDF = new TextEncoder().encode("%PDF-1.7 tailored");

function json(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const USER = { id: "u1", email: "anna@example.com", full_name: "Anna Schmidt", preferred_language: "en", timezone: "UTC", subscription_plan: "free" };

const BOOT = (jobResumes: { enabled: boolean; reason: string | null } | null = { enabled: true, reason: null }) => ({
  api_version: 1,
  min_extension_version: "0.1.0",
  app_url: "http://localhost:3000",
  user: USER,
  capabilities: { ai_available: true, ai_consent: true, has_career_direction: false, primary_direction: null },
  features: {
    autofill: { enabled: true, reason: null },
    autofill_documents: { enabled: false, reason: null },
    ...(jobResumes ? { job_resumes: jobResumes } : {}),
  },
  entitlements: { plan: "free", source: "none" },
  restricted_platforms: [],
});

function resume(over: Record<string, unknown> = {}) {
  return {
    id: RID,
    user_id: "u1",
    application_id: APP,
    version: 1,
    is_current: false,
    status: "pending",
    job_title: "Backend Engineer, Payments",
    company_name: "Contoso",
    posting_url: POSTING,
    location: "Remote - Europe",
    seniority: null,
    language: "en",
    source: "profile",
    resume_version_id: null,
    requirements: { listed: [], items: [], supported: ["Go"], unsupported: ["Kafka"], keyword_coverage: 0.5 },
    review: null,
    formats: [],
    files: [],
    error: null,
    generated_at: null,
    expires_at: "2026-12-18T10:00:00Z",
    deleted_at: null,
    deletion_reason: null,
    auto_deleted: false,
    generation: {},
    created_at: "2026-11-18T10:00:00Z",
    updated_at: "2026-11-18T10:00:00Z",
    ...over,
  };
}

const READY = (over: Record<string, unknown> = {}) =>
  resume({
    status: "ready",
    is_current: true,
    formats: ["docx", "pdf"],
    review: { notes: [], issues: [], flagged_bullets: 0 },
    generated_at: "2026-11-18T10:01:00Z",
    files: [
      { id: "f1", format: "docx", filename: "Anna_Schmidt_Resume.docx", content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size_bytes: 9, created_at: "2026-11-18T10:01:00Z" },
      { id: "f2", format: "pdf", filename: "Anna_Schmidt_Resume.pdf", content_type: "application/pdf", size_bytes: PDF.length, created_at: "2026-11-18T10:01:00Z" },
    ],
    ...over,
  });

type Call = { path: string; method: string; body: Record<string, unknown> | null; headers: Record<string, string> };

/** GetCareer: `routes` answer by "METHOD path-fragment"; anything else is 404. */
function api(routes: Record<string, (call: Call) => Response | Promise<Response>> = {}, boot = BOOT()) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const call: Call = {
      path: u.pathname + u.search,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    if (call.path.endsWith("/extension/bootstrap")) return json(200, boot);
    for (const [k, f] of Object.entries(routes)) {
      const [method, frag] = k.split(" ");
      if (call.method === method && call.path.includes(frag!)) return f(call);
    }
    if (call.path.endsWith("/extension/lookup")) return json(200, lookup(null));
    return json(404, { error: { code: "not_found", message: "Not found" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function lookup(app: string | null): LookupOut {
  return {
    url: { canonical_url: POSTING, platform: "greenhouse", platform_name: "Greenhouse", posting_id: "4012345", restricted: false },
    applications: app
      ? [{ application_id: app, company_name: "Contoso", position_title: "Backend Engineer, Payments", location: null, status: "to_apply", match_score: null, created_at: "", updated_at: "", reasons: ["same_link"], app_url: "" }]
      : [],
    job: null,
    pending_import: null,
  };
}

async function connected() {
  await tokenStore.save({
    user: USER,
    session_id: "s",
    access_token: "secret-access-token",
    access_token_expires_at: new Date(Date.now() + 900_000).toISOString(),
    refresh_token: "secret-refresh-token",
    refresh_token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
}

/** Tab 7 shows `fixture` at `url`, already read by the side panel (with `lookupOut`). */
async function tab(url: string, fixture: string | null, lookupOut: LookupOut | null = null) {
  vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 7, url } as never);
  const extraction = fixture
    ? extractPage(new DOMParser().parseFromString(readFileSync(resolve(process.cwd(), "test/fixtures/pages", fixture), "utf8"), "text/html"), url)
    : null;
  const state: TabState = {
    tabId: 7,
    url,
    kind: extraction ? "job" : "not_job",
    restricted: null,
    extraction,
    lookup: lookupOut,
    lookupError: null,
    actionError: null,
    importId: null,
    checkedAt: Date.now(),
  };
  await chrome.storage.session.set({ "tab.7": state });
}

const input = (over: Partial<ResumeInput> = {}): ResumeInput => ({
  applicationId: null,
  title: "Backend Engineer, Payments",
  company: "Contoso",
  description: "Contoso builds payment infrastructure for small businesses across Europe. You design APIs in Go.",
  location: "Remote - Europe",
  seniority: null,
  requirements: ["5+ years backend experience"],
  language: "en",
  url: POSTING,
  ...over,
});

beforeEach(async () => {
  await vault.clear();
  await chrome.storage.session.clear();
});

describe("the job on the tab", () => {
  it("reads the posting, finds the tracked application and the resume GetCareer already has", async () => {
    await connected();
    await tab(POSTING, "greenhouse.html", lookup(APP));
    const calls = api({ "GET /job-resumes?application_id=": () => json(200, [READY()]) });
    const d = await resumeDetails(7);
    expect(d.job).toMatchObject({ title: "Backend Engineer, Payments", company: "Contoso", required: ["5+ years backend experience"] });
    expect(d.application).toMatchObject({ id: APP });
    expect(d).toMatchObject({ missing: [], confirm: false });
    expect(d.current).toMatchObject({ id: RID, status: "ready", reused: true });
    expect(calls.find((c) => c.path.includes("/job-resumes?"))!.path).toContain("include_deleted=false");
  });

  it("asks the user on an application page that doesn't show the posting, after looking it up", async () => {
    await connected();
    await tab(APPLY, null);
    const calls = api();
    const d = await resumeDetails(7);
    expect(d.missing).toEqual(["job_title", "company", "job_description"]);
    expect(d.confirm).toBe(true);
    expect(d.current).toBeNull();
    // Nothing to look up without a title or company.
    expect(calls.some((c) => c.path.endsWith("/extension/lookup"))).toBe(false);
  });

  it("doesn't ask for anything while GetCareer has the feature off, and explains consent", async () => {
    await connected();
    await tab(POSTING, "greenhouse.html");
    let calls = api({}, BOOT({ enabled: false, reason: "consent_required" }));
    await expect(resumeDetails(7)).rejects.toMatchObject({ code: "ai_consent_required" });
    expect(calls.some((c) => c.path.includes("/job-resumes"))).toBe(false);
    await chrome.storage.session.remove("bootstrap");
    calls = api({}, BOOT(null));
    await expect(resumeDetails(7)).rejects.toMatchObject({ code: "feature_unavailable" });
    expect(calls.some((c) => c.path.includes("/job-resumes"))).toBe(false);
  });

  it("never works on restricted platforms", async () => {
    await connected();
    vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 7, url: "https://www.linkedin.com/jobs/view/123" } as never);
    const calls = api();
    await expect(resumeDetails(7)).rejects.toMatchObject({ code: "platform_restricted" });
    await expect(resumeCreate(7, "https://www.linkedin.com/jobs/view/123", input())).rejects.toMatchObject({ code: "platform_restricted" });
    expect(calls).toHaveLength(0);
  });
});

describe("asking for a resume", () => {
  it("sends the job with one Idempotency-Key and keeps only ids", async () => {
    await connected();
    await tab(POSTING, "greenhouse.html");
    const calls = api({ "POST /job-resumes": () => json(202, resume()) });
    const r = await resumeCreate(7, POSTING, input());
    expect(r).toMatchObject({ id: RID, applicationId: APP, status: "pending", reused: false });
    const post = calls.find((c) => c.method === "POST" && c.path.endsWith("/job-resumes"))!;
    expect(post.headers["Idempotency-Key"]).toMatch(/^ext-[0-9a-f-]{36}$/);
    expect(post.headers.Authorization).toBe("Bearer secret-access-token");
    expect(post.body).toEqual({
      language: "en",
      job_title: "Backend Engineer, Payments",
      company: "Contoso",
      job_description: input().description,
      location: "Remote - Europe",
      posting_url: POSTING,
      requirements: ["5+ years backend experience"],
    });
    // Only ids are kept: nothing of the job, the resume or the connection.
    const kept = JSON.stringify(Object.entries((chrome.storage.session as unknown as { _data: Record<string, unknown> })._data).filter(([k]) => k.startsWith("jr.")));
    expect(kept).toContain(RID);
    expect(kept).not.toMatch(/Contoso|Backend|payment|secret/i);
  });

  it("joins repeated clicks into one request, and uses a new key for the next action", async () => {
    await connected();
    await tab(POSTING, "greenhouse.html");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls = api({
      "POST /job-resumes": async () => {
        await gate;
        return json(202, resume());
      },
    });
    const a = resumeCreate(7, POSTING, input());
    const b = resumeCreate(7, POSTING, input());
    release();
    expect((await a).id).toBe((await b).id);
    const posts = () => calls.filter((c) => c.method === "POST" && c.path.endsWith("/job-resumes"));
    expect(posts()).toHaveLength(1);
    await resumeCreate(7, POSTING, input());
    const keys = posts().map((c) => c.headers["Idempotency-Key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("resends the same request with the same key after a network error, never after 503", async () => {
    await connected();
    await tab(POSTING, "greenhouse.html");
    let n = 0;
    const calls = api({
      "POST /job-resumes": () => {
        if (++n === 1) throw new TypeError("Failed to fetch");
        return json(202, resume());
      },
    });
    await resumeCreate(7, POSTING, input());
    const posts = calls.filter((c) => c.method === "POST" && c.path.endsWith("/job-resumes"));
    expect(posts).toHaveLength(2);
    expect(posts[0]!.headers["Idempotency-Key"]).toBe(posts[1]!.headers["Idempotency-Key"]);

    const later = api({ "POST /job-resumes": () => json(503, { error: { code: "generation_unavailable", message: "Couldn't start", details: null, request_id: "r1" } }) });
    await expect(resumeCreate(7, POSTING, input())).rejects.toMatchObject({ code: "generation_unavailable" });
    expect(later.filter((c) => c.method === "POST" && c.path.endsWith("/job-resumes"))).toHaveLength(1);
  });

  it("refuses to ask with too little about the job, and names what's missing", async () => {
    await connected();
    await tab(APPLY, null);
    const calls = api();
    await expect(resumeCreate(7, APPLY, input({ title: null, description: "Short." }))).rejects.toMatchObject({
      code: "job_details_required",
      details: { missing: ["job_title", "job_description"] },
    });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("with a tracked application sends its id and lets GetCareer use its own title and company", async () => {
    await connected();
    await tab(POSTING, "greenhouse.html", lookup(APP));
    const calls = api({ "POST /job-resumes": () => json(200, READY()) });
    const r = await resumeCreate(7, POSTING, input({ applicationId: APP, title: null, company: null, description: null }));
    expect(r).toMatchObject({ status: "ready", reused: true });
    const body = calls.find((c) => c.method === "POST")!.body!;
    expect(body.application_id).toBe(APP);
    expect(body).not.toHaveProperty("job_title");
    expect(body).not.toHaveProperty("job_description");
  });

  it("refuses when the tab moved to another site", async () => {
    await connected();
    await tab(POSTING, "greenhouse.html");
    const calls = api();
    await expect(resumeCreate(7, "https://other.example/apply", input())).rejects.toMatchObject({ code: "page_changed" });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("finds the resume it asked for again when the panel reopens", async () => {
    await connected();
    await tab(POSTING, "greenhouse.html");
    api({ "POST /job-resumes": () => json(202, resume()) });
    await resumeCreate(7, POSTING, input());
    api({ [`GET /job-resumes/${RID}`]: () => json(200, resume({ status: "generating" })) });
    const d = await resumeDetails(7);
    expect(d.current).toMatchObject({ id: RID, status: "generating" });
  });

  it("forgets a resume GetCareer deleted and starts from what GetCareer has", async () => {
    await connected();
    await tab(POSTING, "greenhouse.html");
    api({ "POST /job-resumes": () => json(202, resume()) });
    await resumeCreate(7, POSTING, input());
    api({ [`GET /job-resumes/${RID}`]: () => json(200, resume({ status: "deleted", deletion_reason: "application_rejected" })) });
    expect((await resumeDetails(7)).current).toBeNull();
    const kept = Object.keys((chrome.storage.session as unknown as { _data: Record<string, unknown> })._data).filter((k) => k.startsWith("jr."));
    expect(kept).toHaveLength(0);
  });
});

describe("progress and new versions", () => {
  it("says when to ask again while it's written, and nothing once it's done", async () => {
    await connected();
    api({ [`GET /job-resumes/${RID}/status`]: () => json(200, { id: RID, application_id: APP, version: 1, status: "generating", ready: false, formats: [], error: null, poll_after_seconds: 3, expires_at: null, deletion_reason: null }) });
    expect(await resumeProgress(RID)).toMatchObject({ status: "generating", ready: false, pollAfter: 3 });
    api({ [`GET /job-resumes/${RID}/status`]: () => json(200, { id: RID, application_id: APP, version: 1, status: "failed", ready: false, formats: [], error: { code: "ai_failed", message: "x" }, poll_after_seconds: null, expires_at: null, deletion_reason: null }) });
    expect(await resumeProgress(RID)).toMatchObject({ status: "failed", pollAfter: null, error: { code: "ai_failed" } });
  });

  it("joins the version already being written instead of starting another", async () => {
    await connected();
    const calls = api({
      [`POST /job-resumes/${RID}/regenerate`]: () => json(409, { error: { code: "generation_in_progress", message: "Busy", details: { resume_id: RID2 }, request_id: "r" } }),
      [`GET /job-resumes/${RID2}`]: () => json(200, resume({ id: RID2, version: 2, status: "generating" })),
    });
    const r = await resumeRegenerate(RID);
    expect(r).toMatchObject({ id: RID2, version: 2, status: "generating" });
    expect(calls.find((c) => c.method === "POST")!.headers["Idempotency-Key"]).toMatch(/^ext-/);
  });
});

describe("the file", () => {
  it("is fetched from the owner's file stream, checked, and named by GetCareer", async () => {
    await connected();
    const calls = api({
      [`GET /job-resumes/${RID}/files/pdf`]: () => new Response(PDF, { status: 200, headers: { "Content-Type": "application/pdf" } }),
      [`GET /job-resumes/${RID}`]: () => json(200, READY()),
    });
    const f = await resumeFile(RID, "pdf");
    expect(f).toMatchObject({ name: "Anna_Schmidt_Resume.pdf", mime: "application/pdf" });
    expect(atob(f.base64)).toBe("%PDF-1.7 tailored");
    // No download link is asked for: the file comes straight from the authenticated stream.
    expect(calls.some((c) => c.path.includes("/download"))).toBe(false);
  });

  it.each([
    ["the wrong type", () => new Response(PDF, { status: 200, headers: { "Content-Type": "text/html" } })],
    ["not a PDF inside", () => new Response("<html>hi</html>", { status: 200, headers: { "Content-Type": "application/pdf" } })],
    ["an empty file", () => new Response(new Uint8Array(0), { status: 200, headers: { "Content-Type": "application/pdf" } })],
  ])("is refused when GetCareer sends %s", async (_name, file) => {
    await connected();
    api({ [`GET /job-resumes/${RID}/files/pdf`]: file, [`GET /job-resumes/${RID}`]: () => json(200, READY()) });
    await expect(resumeFile(RID, "pdf")).rejects.toMatchObject({ code: "bad_file" });
  });

  it("isn't fetched before the resume is ready, or after it was deleted", async () => {
    await connected();
    api({ [`GET /job-resumes/${RID}`]: () => json(200, resume({ status: "generating" })) });
    await expect(resumeFile(RID, "pdf")).rejects.toMatchObject({ code: "resume_not_ready" });
    api({ [`GET /job-resumes/${RID}`]: () => json(200, resume({ status: "deleted", deletion_reason: "expired" })) });
    await expect(resumeFile(RID, "pdf")).rejects.toMatchObject({ code: "resume_deleted", details: { deletion_reason: "expired" } });
  });

  it("follows the naming convention, and replaces a name that isn't a plain file name", () => {
    expect(resumeFileName("Rashid Isayev", "pdf")).toBe("Rashid_Isayev_Resume.pdf");
    expect(resumeFileName("Anna-Lena O'Brien Müller", "docx")).toBe("Anna-Lena_O'Brien_Müller_Resume.docx");
    expect(resumeFileName("", "pdf")).toBe("Resume.pdf");
    expect(safeResumeName("../../evil.pdf", "pdf", "Anna Schmidt")).toBe("Anna_Schmidt_Resume.pdf");
    expect(safeResumeName("Anna_Schmidt_Resume.exe", "pdf", "Anna Schmidt")).toBe("Anna_Schmidt_Resume.pdf");
    expect(safeResumeName("Anna_Schmidt_Resume.pdf", "pdf", "Someone Else")).toBe("Anna_Schmidt_Resume.pdf");
  });

  it("is attached through AutoFill's fill, without GetCareer's other documents being on", async () => {
    await connected();
    vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 7, url: APPLY } as never);
    const passed: unknown[] = [];
    vi.mocked(chrome.scripting.executeScript).mockImplementation((async (inj: { func?: () => unknown; args?: unknown[] }) => {
      if (String(inj.func).includes(".fill(")) {
        passed.push(inj.args![3]);
        return [{ frameId: 0, result: [{ frameId: 0, fieldId: "f3", status: "filled" }] }];
      }
      return [{ frameId: 0, result: null }];
    }) as never);
    api({
      [`GET /job-resumes/${RID}/files/pdf`]: () => new Response(PDF, { status: 200, headers: { "Content-Type": "application/pdf" } }),
      [`GET /job-resumes/${RID}`]: () => json(200, READY()),
      "POST /extension/autofill/events": () => new Response(null, { status: 204 }),
    });
    const item: FillItem = { frameId: 0, fieldId: "f3", frameOrigin: "https://careers.contoso.example", value: { kind: "file", ref: `job-resume:${RID}`, format: "pdf", name: "Anna_Schmidt_Resume.pdf" }, overwrite: false };
    const report = await fillTab(7, APPLY, [item], []);
    expect(report.filled).toBe(1);
    expect(passed[0]).toEqual({ [`job-resume:${RID}|pdf`]: { name: "Anna_Schmidt_Resume.pdf", mime: "application/pdf", base64: btoa("%PDF-1.7 tailored") } });
  });
});

describe("what the extension logs and accepts", () => {
  it("logs no job text, company, title, tokens or file contents", async () => {
    await connected();
    await tab(POSTING, "greenhouse.html", lookup(APP));
    api({
      "GET /job-resumes?application_id=": () => json(200, []),
      "POST /job-resumes": () => json(202, resume()),
      [`GET /job-resumes/${RID}/files/pdf`]: () => new Response(PDF, { status: 200, headers: { "Content-Type": "application/pdf" } }),
      [`GET /job-resumes/${RID}`]: () => json(200, READY()),
    });
    await resumeDetails(7);
    await resumeCreate(7, POSTING, input());
    await resumeFile(RID, "pdf");
    const logs = JSON.stringify(recentLogs());
    expect(logs).toContain("resume.requested");
    expect(logs).not.toMatch(/Contoso|Backend Engineer|payment infrastructure|secret-|PDF-1\.7|Anna/);
  });

  it("accepts only well-formed resume requests from the extension's pages", () => {
    const ok = { type: "resume.create", tabId: 7, pageUrl: POSTING, input: input() };
    expect(parseRequest(ok)).toEqual(ok);
    expect(parseRequest({ ...ok, input: { ...input(), extra: "x" } })).toEqual(ok);
    expect(parseRequest({ ...ok, input: input({ url: "javascript:alert(1)" }) })).toBeNull();
    expect(parseRequest({ ...ok, input: input({ title: "x".repeat(301) }) })).toBeNull();
    expect(parseRequest({ ...ok, input: input({ requirements: Array(51).fill("Go") }) })).toBeNull();
    expect(parseRequest({ ...ok, input: input({ applicationId: "not-a-uuid" }) })).toBeNull();
    expect(parseRequest({ type: "resume.file", resumeId: RID, format: "exe" })).toBeNull();
    expect(parseRequest({ type: "resume.file", resumeId: RID, format: "docx" })).toEqual({ type: "resume.file", resumeId: RID, format: "docx" });
    expect(parseRequest({ type: "resume.progress", resumeId: "../x" })).toBeNull();
    expect(parseRequest({ type: "resume.regenerate", resumeId: RID, language: "fr" })).toBeNull();
    // A tailored resume is a document AutoFill may attach, by id only.
    const fill = { type: "autofill.fill", tabId: 7, pageUrl: APPLY, items: [{ frameId: 0, fieldId: "f3", frameOrigin: "https://careers.contoso.example", overwrite: false, value: { kind: "file", ref: `job-resume:${RID}`, format: "pdf", name: "Anna_Schmidt_Resume.pdf" } }], attention: [] };
    expect(parseRequest(fill)).not.toBeNull();
    expect(parseRequest({ ...fill, items: [{ ...fill.items[0], value: { ...fill.items[0]!.value, ref: "job-resume:../../x" } }] })).toBeNull();
  });
});
