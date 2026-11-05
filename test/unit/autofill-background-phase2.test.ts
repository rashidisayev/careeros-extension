/**
 * The service worker's side of AutoFill Phase 2 and 3: documents fetched only for file
 * fields and only on Fill, suggested answers, saved answers, the history entry kept per
 * application, and usage counts without form values. CareerOS is a fetch stub.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistry, detectFields } from "../../src/autofill/detector";
import type { FillItem } from "../../src/autofill/types";
import { answersTab, deleteHistory, fillTab, registerFormWatch, scanTab } from "../../src/background/autofill";
import { handle } from "../../src/background/router";
import { tokenStore } from "../../src/background/tokens";
import { vault } from "../../src/background/vault";
import { recentLogs } from "../../src/shared/log";
import { parseRequest } from "../../src/shared/messages";
import { DEFAULT_AUTOFILL, saveSettings } from "../../src/shared/settings";
import { ANNA, load } from "./autofill-helpers";

const PAGE = "https://careers.brightwave.example/apply/77";
const CV_REF = "resume:11111111-1111-1111-1111-111111111111";

function json(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Features = Partial<Record<"autofill_documents" | "autofill_answers" | "autofill_history" | "autofill_saved_answers", { enabled: boolean; reason: string | null }>>;

const BOOT = (features: Features = {}) => ({
  api_version: 1,
  min_extension_version: "0.1.0",
  app_url: "http://localhost:3000",
  user: { id: "u", email: "anna@example.com", full_name: "Anna Schmidt", preferred_language: "en", timezone: "UTC", subscription_plan: "free" },
  capabilities: { ai_available: true, ai_consent: true, has_career_direction: false, primary_direction: null },
  features: {
    save_job: { enabled: true, reason: null },
    autofill: { enabled: true, reason: null },
    autofill_documents: { enabled: true, reason: null },
    autofill_answers: { enabled: true, reason: null },
    autofill_history: { enabled: true, reason: null },
    autofill_saved_answers: { enabled: true, reason: null },
    ...features,
  },
  entitlements: { plan: "free", source: "none" },
  restricted_platforms: [],
});

async function connected() {
  await tokenStore.save({
    user: BOOT().user,
    session_id: "s",
    access_token: "a",
    access_token_expires_at: new Date(Date.now() + 900_000).toISOString(),
    refresh_token: "r",
    refresh_token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
}

/** The tab shows `fixture` on `url`; fills report every field as filled. */
function tab(url = PAGE, fixture = "history-generic.html") {
  vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 7, url } as never);
  load(fixture);
  const scan = { ...detectFields(document, createRegistry(), { layout: false }), frameUrl: url };
  vi.mocked(chrome.scripting.executeScript).mockImplementation((async (inj: { files?: string[]; func?: () => unknown; args?: unknown[] }) => {
    if (inj.files) return [];
    const src = String(inj.func);
    if (src.includes(".scan()")) return [{ frameId: 0, result: scan }];
    if (src.includes(".fill(")) {
      const [items, frameId] = inj.args as [{ fieldId: string }[], number];
      return [{ frameId, result: items.map((i) => ({ frameId, fieldId: i.fieldId, status: "filled" })) }];
    }
    return [{ frameId: 0, result: null }];
  }) as never);
}

type Call = { url: string; method: string; body: unknown };

function api(features: Features = {}, overrides: Record<string, (body: unknown) => Response> = {}) {
  const calls: Call[] = [];
  let historyId = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const path = new URL(url).pathname + new URL(url).search;
    calls.push({ url: path, method, body });
    for (const [k, f] of Object.entries(overrides)) if (path.includes(k)) return f(body);
    if (path.endsWith("/extension/bootstrap")) return json(200, BOOT(features));
    if (path.endsWith("/extension/autofill-profile")) return json(200, ANNA);
    if (path.endsWith("/extension/autofill/documents"))
      return json(200, {
        application: null,
        documents: [{ ref: CV_REF, kind: "cv", name: "Anna Schmidt - CV.pdf", formats: ["pdf"], size: 9, updated_at: "2026-11-01T00:00:00Z", recommended: false, note: null }],
      });
    if (path.includes("/autofill/documents/resume/")) return new Response(new TextEncoder().encode("%PDF-1.7"), { status: 200, headers: { "Content-Type": "application/pdf" } });
    if (path.endsWith("/autofill/history") && method === "POST") return json(201, { id: `h${++historyId}` });
    if (path.includes("/autofill/history/") && method === "PUT") return json(200, { id: path.split("/").pop() });
    if (path.endsWith("/autofill/events")) return new Response(null, { status: 204 });
    if (path.endsWith("/autofill/saved-answers") && method === "POST") return json(201, { id: "s1", field_key: body.field_key, question: body.question, answer: body.answer, updated_at: "2026-11-05T00:00:00Z" });
    return json(404, { error: { code: "not_found", message: "Not found" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const fileItem = (fieldId: string): FillItem => ({ frameId: 0, fieldId, frameOrigin: "https://careers.brightwave.example", value: { kind: "file", ref: CV_REF, format: "pdf", name: "Anna Schmidt - CV.pdf" }, overwrite: false });
const textItem = (fieldId: string): FillItem => ({ frameId: 0, fieldId, frameOrigin: "https://careers.brightwave.example", value: { kind: "text", text: "Anna" }, overwrite: false });

beforeEach(async () => {
  await vault.clear();
  await chrome.storage.session.clear();
});

describe("documents", () => {
  it("asks CareerOS for documents only when the form has a file field", async () => {
    await connected();
    tab(PAGE, "history-generic.html");
    let calls = api();
    const plan = await scanTab(7);
    expect(calls.filter((c) => c.url.endsWith("/autofill/documents"))).toHaveLength(1);
    expect(plan.documents.map((d) => d.ref)).toEqual([CV_REF]);
    tab(PAGE, "workday-form.html");
    calls = api();
    await scanTab(7);
    expect(calls.some((c) => c.url.includes("/autofill/documents"))).toBe(false);
  });

  it("downloads a file only when filling, and hands it to the page under the reviewed name", async () => {
    await connected();
    tab();
    const calls = api();
    await scanTab(7);
    expect(calls.some((c) => c.url.includes("/file?format="))).toBe(false);
    await fillTab(7, PAGE, [fileItem("f1")], []);
    expect(calls.filter((c) => c.url.includes(`/autofill/documents/resume/11111111-1111-1111-1111-111111111111/file?format=pdf`))).toHaveLength(1);
    const call = vi.mocked(chrome.scripting.executeScript).mock.calls.find(([inj]) => String((inj as { func?: unknown }).func).includes(".fill(")) as unknown as [{ args: unknown[] }];
    const files = call[0].args[3] as Record<string, { name: string; mime: string; base64: string }>;
    expect(files[`${CV_REF}|pdf`]).toEqual({ name: "Anna Schmidt - CV.pdf", mime: "application/pdf", base64: btoa("%PDF-1.7") });
  });

  it("refuses to attach files when the account has no documents feature", async () => {
    await connected();
    tab();
    api({ autofill_documents: { enabled: false, reason: null } });
    await expect(fillTab(7, PAGE, [fileItem("f1")], [])).rejects.toMatchObject({ code: "feature_unavailable" });
  });

  it("counts an attached document without its name", async () => {
    await connected();
    tab();
    const calls = api();
    await fillTab(7, PAGE, [fileItem("f1"), textItem("f2")], [], { confirmed: 1, asked: 2, ats: null });
    await vi.waitFor(() => expect(calls.filter((c) => c.url.endsWith("/autofill/events"))).toHaveLength(2));
    const events = calls.filter((c) => c.url.endsWith("/autofill/events")).map((c) => c.body);
    expect(events).toEqual([
      { event: "filled", ats: "generic", fields_filled: 2, fields_confirmed: 1, fields_asked: 2, steps: 1 },
      { event: "document_attached", ats: "generic", fields_filled: 1 },
    ]);
    expect(JSON.stringify(events)).not.toContain("Anna");
  });
});

describe("history", () => {
  it("keeps one entry per application: later steps of the same form update it", async () => {
    await connected();
    tab();
    const calls = api();
    await fillTab(7, PAGE, [textItem("f1"), fileItem("f2")], [], { confirmed: 0, asked: 1, ats: null });
    await fillTab(7, `${PAGE}/step-2`, [textItem("f3")], [], { confirmed: 1, asked: 0, ats: null });
    const posts = calls.filter((c) => c.url.endsWith("/autofill/history") && c.method === "POST");
    const puts = calls.filter((c) => c.url.includes("/autofill/history/h1") && c.method === "PUT");
    expect(posts).toHaveLength(1);
    expect(puts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({
      site: "careers.brightwave.example",
      ats: null,
      company: null,
      job_title: null,
      application_id: null,
      fields_filled: 2,
      fields_confirmed: 0,
      fields_asked: 1,
      documents: ["Anna Schmidt - CV.pdf"],
    });
    expect(puts[0]!.body).toMatchObject({ fields_filled: 3, fields_confirmed: 1, fields_asked: 1 });
    // The browser keeps the entry's id and counts, never values.
    const session = JSON.stringify(await chrome.storage.session.get(null));
    expect(session).toContain('"id":"h1"');
    expect(session).not.toContain("Anna\"");
  });

  it("keeps nothing in CareerOS when the history is off", async () => {
    await connected();
    await saveSettings({ autofill: { ...DEFAULT_AUTOFILL, history: false } });
    tab();
    const calls = api();
    await fillTab(7, PAGE, [textItem("f1")], []);
    expect(calls.some((c) => c.url.includes("/autofill/history"))).toBe(false);
  });

  it("starts a new entry after the user deleted the history", async () => {
    await connected();
    tab();
    const calls = api({}, { "/autofill/history/h1": () => json(404, { error: { code: "not_found", message: "Not found" } }) });
    await fillTab(7, PAGE, [textItem("f1")], []);
    await fillTab(7, PAGE, [textItem("f2")], []);
    expect(calls.filter((c) => c.url.endsWith("/autofill/history") && c.method === "POST")).toHaveLength(2);
  });

  it("deleting the whole history also forgets the open applications in this browser", async () => {
    await connected();
    tab();
    api({}, { "/autofill/history": () => new Response(null, { status: 204 }) });
    await chrome.storage.session.set({ "af.session.7": { origin: "x", id: "h1" }, other: 1 });
    await deleteHistory();
    const left = await chrome.storage.session.get(null);
    expect(left).toMatchObject({ other: 1 });
    expect(left).not.toHaveProperty("af.session.7");
  });
});

describe("suggested answers", () => {
  const q = [{ id: "0:f9", text: "Why do you want to join Brightwave?", max_length: 2000 }];

  it("sends only the questions and the job, with the user's length and tone", async () => {
    await connected();
    tab();
    const calls = api({}, { "/autofill/answers": () => json(200, { context: "title_only", answers: [{ id: "0:f9", status: "drafted", answer: "Because…", missing: null, issues: [] }] }) });
    const out = await answersTab(7, PAGE, q, "en");
    expect(out.answers[0]).toMatchObject({ status: "drafted" });
    const sent = calls.find((c) => c.url.endsWith("/autofill/answers"))!.body as Record<string, unknown>;
    expect(sent).toEqual({ url: PAGE, application_id: null, job_title: null, company: null, job_text: null, questions: q, language: "en", length: "medium", tone: "professional" });
    expect(JSON.stringify(recentLogs())).not.toContain("Why do you want");
  });

  it("explains that AI processing needs the user's consent", async () => {
    await connected();
    tab();
    api({ autofill_answers: { enabled: false, reason: "consent_required" } });
    await expect(answersTab(7, PAGE, q, "en")).rejects.toMatchObject({ code: "ai_consent_required" });
  });

  it("refuses when the tab moved to another site", async () => {
    await connected();
    tab("https://other.example/form");
    api();
    await expect(answersTab(7, PAGE, q, "en")).rejects.toMatchObject({ code: "page_changed" });
  });

  it("saves an answer the user chose to remember, trimmed", async () => {
    await connected();
    const calls = api();
    const res = await handle({ type: "autofill.saveAnswer", fieldKey: "notice_period", question: " Notice period ", answer: " 3 months " });
    expect(res).toMatchObject({ ok: true, data: { id: "s1" } });
    expect(calls.find((c) => c.url.endsWith("/saved-answers"))!.body).toEqual({ field_key: "notice_period", question: "Notice period", answer: "3 months" });
  });
});

describe("messages", () => {
  it("accepts the new requests only in their exact shape", () => {
    expect(parseRequest({ type: "autofill.answers", tabId: 7, pageUrl: PAGE, questions: [{ id: "0:f1", text: "Why?", max_length: null }], language: "de" })).toMatchObject({ type: "autofill.answers" });
    expect(parseRequest({ type: "autofill.answers", tabId: 7, pageUrl: PAGE, questions: [], language: "de" })).toBeNull();
    expect(parseRequest({ type: "autofill.answers", tabId: 7, pageUrl: PAGE, questions: [{ id: "0:f1", text: "Why?", max_length: null }], language: "fr" })).toBeNull();
    expect(parseRequest({ type: "autofill.saveAnswer", fieldKey: "password", question: "q", answer: "a" })).toBeNull();
    expect(parseRequest({ type: "autofill.historyDelete" })).toEqual({ type: "autofill.historyDelete" });
  });

  it("checks file values: a CareerOS reference and a plain file name", () => {
    const fill = (value: unknown) => ({ type: "autofill.fill", tabId: 7, pageUrl: PAGE, items: [{ frameId: 0, fieldId: "f1", frameOrigin: "https://x.example", value, overwrite: false }], attention: [] });
    expect(parseRequest(fill({ kind: "file", ref: CV_REF, format: "pdf", name: "CV.pdf" }))).not.toBeNull();
    expect(parseRequest(fill({ kind: "file", ref: "https://evil.example/x", format: "pdf", name: "CV.pdf" }))).toBeNull();
    expect(parseRequest(fill({ kind: "file", ref: CV_REF, format: "exe", name: "CV.pdf" }))).toBeNull();
    expect(parseRequest(fill({ kind: "file", ref: CV_REF, format: "pdf", name: "../../etc/passwd" }))).toBeNull();
    expect(parseRequest(fill({ kind: "choose", picks: [["Germany"]] }))).not.toBeNull();
    expect(parseRequest(fill({ kind: "options", indexes: [0, 2] }))).not.toBeNull();
    expect(parseRequest(fill({ kind: "options", indexes: [-1] }))).toBeNull();
  });
});

describe("multi-step forms", () => {
  it("passes the page's 'form changed' note on to the side panel, from tabs only", () => {
    registerFormWatch();
    const listener = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls.at(-1)![0] as (m: unknown, s: chrome.runtime.MessageSender) => boolean;
    vi.mocked(chrome.runtime.sendMessage).mockClear();
    listener({ type: "autofill.changed" }, { id: chrome.runtime.id, tab: { id: 7 } as chrome.tabs.Tab });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "broadcast.autofill", tabId: 7 }));
    vi.mocked(chrome.runtime.sendMessage).mockClear();
    listener({ type: "autofill.changed" }, { id: "another-extension", tab: { id: 7 } as chrome.tabs.Tab });
    listener({ type: "autofill.changed" }, { id: chrome.runtime.id });
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
