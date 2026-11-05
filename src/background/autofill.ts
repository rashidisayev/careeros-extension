/**
 * AutoFill in the service worker: reads the form on a tab, fetches the Career Profile, plans
 * what to fill, and writes only the values the user reviewed.
 *
 * - Runs only on a tab the extension may script (activeTab after the user's click, or a site
 *   they allowed), never on restricted platforms or CareerOS itself.
 * - The profile is fetched from CareerOS for each scan and kept in memory only for that call:
 *   nothing of it is stored in the browser. It reaches the page only in `fill`, field by
 *   field, after the user reviewed it.
 * - Documents are listed with the scan but downloaded only when the user fills a file input
 *   they picked one for; the bytes go to that frame only and are not kept.
 * - Before writing, the tab and each frame must still show the site that was reviewed.
 * - Suggested answers, saved answers, the history and usage counts go to CareerOS only. The
 *   history holds the site, the job, counts and document names, never values; usage counts
 *   hold counts and the ATS vendor only.
 */
import { adapterForHost } from "../autofill/adapters";
import { fileKey } from "../autofill/executor";
import { buildPlan } from "../autofill/planner";
import type {
  AnswerLength,
  AnswerQuestion,
  AnswersOut,
  AnswerTone,
  AutofillPlan,
  DocumentRef,
  DocumentsOut,
  FieldKey,
  FieldOutcome,
  FieldRef,
  FillItem,
  FillReport,
  FillStats,
  FrameScan,
  HistoryEntry,
  PageFile,
  SavedAnswer,
  ScanResult,
  UndoReport,
} from "../autofill/types";
import { appUrl, CAREEROS_ORIGIN } from "../shared/config";
import { ExtensionError, messageFor } from "../shared/errors";
import { log } from "../shared/log";
import { pageKind, restrictedPlatformFor } from "../shared/policy";
import { loadSettings } from "../shared/settings";
import type { TabState } from "../shared/types";
import { api } from "./api";
import { broadcastAutofill } from "./broadcast";
import { sessionInfo } from "./session";
import { readState } from "./tabs";

const SCRIPT = "autofill.js";
/** Largest document passed into a page (bytes), matching CareerOS's own limit. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Fills on the same site within this time are one application (the steps of a long form). */
const SESSION_MS = 2 * 60 * 60_000;

type PageApi = {
  scan: () => ScanResult;
  fill: (items: FillItem[], frameId: number, origin: string, files?: Record<string, PageFile>) => Promise<FieldOutcome[]>;
  undo: (frameId: number, fieldIds?: string[]) => UndoReport["results"];
  attention: (fieldIds: string[]) => void;
  clearHighlights: () => void;
};

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** The tab's address, after checking AutoFill may work there at all. */
async function allowedTab(tabId: number): Promise<string> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new ExtensionError("tab_closed", "This tab is no longer open.");
  }
  const url = tab.url ?? null;
  if (!url) throw new ExtensionError("no_access", messageFor("no_access"));
  if (pageKind(url, CAREEROS_ORIGIN) !== "web") throw new ExtensionError("autofill_unsupported", "AutoFill works on job application forms on other websites.");
  const restricted = restrictedPlatformFor(url);
  if (restricted) {
    throw new ExtensionError(
      "platform_restricted",
      `${restricted.name} doesn't allow other services to read or fill its pages, so CareerOS AutoFill doesn't work there.`,
    );
  }
  return url;
}

async function featureOn(feature: "autofill" | "autofill_documents" | "autofill_answers" | "autofill_history" | "autofill_saved_answers" = "autofill"): Promise<void> {
  const settings = await loadSettings();
  if (!settings.autofill.enabled) throw new ExtensionError("autofill_disabled", "AutoFill is turned off in the extension settings.");
  const s = await sessionInfo();
  if (!s.connected) throw new ExtensionError("not_connected", messageFor("not_connected"), 401);
  const f = s.bootstrap?.features[feature];
  // CareerOS decides which features an account has; an older server without one says nothing.
  if (!f?.enabled) {
    if (feature === "autofill_answers" && f?.reason === "consent_required") {
      throw new ExtensionError("ai_consent_required", "Allow AI processing in your CareerOS settings to get suggested answers.");
    }
    throw new ExtensionError("feature_unavailable", feature === "autofill" ? "AutoFill isn't available for your CareerOS account yet." : "This part of AutoFill isn't available for your CareerOS account.");
  }
}

async function hasFeature(feature: "autofill_documents" | "autofill_history"): Promise<boolean> {
  const s = await sessionInfo();
  return s.connected && s.bootstrap?.features[feature]?.enabled === true;
}

/** A frame may be read only if it is an ordinary site (not a restricted platform, not CareerOS). */
function frameAllowed(frameUrl: string): boolean {
  return pageKind(frameUrl, CAREEROS_ORIGIN) === "web" && !restrictedPlatformFor(frameUrl);
}

/** The job this tab shows, from what the side panel already read: the tracked application first. */
function jobOf(state: TabState | null): { applicationId: string | null; title: string | null; company: string | null; text: string | null } {
  const strong = state?.lookup?.applications.find((a) => a.reasons.includes("same_link") || a.reasons.includes("same_posting")) ?? null;
  const fields = state?.extraction?.capture?.page_fields ?? {};
  return {
    applicationId: strong?.application_id ?? null,
    title: strong?.position_title ?? fields.title?.value ?? state?.lookup?.job?.title ?? null,
    company: strong?.company_name ?? fields.company_name?.value ?? state?.lookup?.job?.company_name ?? null,
    text: state?.extraction?.capture?.description_text ?? null,
  };
}

// ---- Usage counts --------------------------------------------------------------------------

/** Pages whose form was already counted in this worker's life (no repeat per re-scan). */
const counted = new Set<string>();

function countEvent(body: Record<string, unknown>): void {
  api.autofillEvent(body).catch(() => undefined);
}

// ---- Scan ------------------------------------------------------------------------------------

export async function scanTab(tabId: number): Promise<AutofillPlan> {
  const url = await allowedTab(tabId);
  await featureOn();
  let results: chrome.scripting.InjectionResult<ScanResult | null>[];
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [SCRIPT] });
    results = (await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => (globalThis as unknown as { __careerosAutofill?: PageApi }).__careerosAutofill?.scan() ?? null,
    })) as chrome.scripting.InjectionResult<ScanResult | null>[];
  } catch (err) {
    log.info("autofill.no_access", { reason: err instanceof Error ? err.message.slice(0, 60) : "unknown" });
    throw new ExtensionError("no_access", messageFor("no_access"));
  }
  const scans: FrameScan[] = results
    .filter((r) => r.result && frameAllowed(r.result.frameUrl))
    .map((r) => ({ frameId: r.frameId, result: r.result! }));

  const settings = await loadSettings();
  const job = jobOf(await readState(tabId).catch(() => null));
  const fileInputs = scans.some((s) => s.result.fields.some((f) => f.kind === "file"));
  // Documents only matter when the form takes files; they never hold up the scan.
  const docs: Promise<DocumentsOut | null> =
    fileInputs && (await hasFeature("autofill_documents")) ? api.autofillDocuments(url, job.applicationId).catch(() => null) : Promise.resolve(null);
  const [profile, documents] = await Promise.all([api.autofillProfile(), docs]);
  const plan = buildPlan(scans, profile, settings.autofill, url, { documents });
  log.info("autofill.scanned", {
    frames: scans.length,
    application_form: plan.isApplicationForm,
    ats: plan.ats?.id ?? null,
    fields: plan.counts.detected,
    ready: plan.counts.ready,
    confirm: plan.counts.confirm,
    input: plan.counts.input,
    documents: plan.documents.length,
  });
  const key = `${tabId}|${url}`;
  if (!counted.has(key) && plan.isApplicationForm) {
    counted.add(key);
    countEvent({ event: "form_detected", ats: plan.ats?.id ?? "generic", fields_detected: plan.counts.detected });
  }
  return plan;
}

function byFrame<T extends FieldRef>(items: T[]): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const i of items) m.set(i.frameId, [...(m.get(i.frameId) ?? []), i]);
  return m;
}

function base64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < view.length; i += 0x8000) out += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Downloads the documents the user picked; one that can't be had is left out (the page reports it). */
async function filesFor(items: FillItem[]): Promise<Record<string, PageFile>> {
  const out: Record<string, PageFile> = {};
  const wanted = new Map<string, { ref: string; format: "pdf" | "docx"; name: string }>();
  for (const i of items) if (i.value.kind === "file") wanted.set(fileKey(i.value.ref, i.value.format), i.value);
  for (const [key, w] of wanted) {
    try {
      const got = await api.autofillFile(w.ref, w.format);
      if (got.bytes.byteLength === 0 || got.bytes.byteLength > MAX_FILE_BYTES) continue;
      out[key] = { name: w.name, mime: got.mime.split(";")[0]!.trim(), base64: base64(got.bytes) };
    } catch (err) {
      log.warn("autofill.document_unavailable", { code: (err as ExtensionError).code ?? "unknown" });
    }
  }
  return out;
}

// ---- Fill ------------------------------------------------------------------------------------

type HistorySession = { origin: string; id: string; at: number; filled: number; confirmed: number; asked: number; documents: string[]; steps: number };
const sessionKey = (tabId: number) => `af.session.${tabId}`;

/** One history entry per application: later steps of the same form update it. */
async function recordHistory(tabId: number, url: string, plan: { ats: string | null }, filled: number, stats: FillStats, documents: string[]): Promise<number> {
  const origin = originOf(url) ?? "";
  const stored = (await chrome.storage.session.get(sessionKey(tabId)))[sessionKey(tabId)] as HistorySession | undefined;
  const current = stored && stored.origin === origin && Date.now() - stored.at < SESSION_MS ? stored : null;
  const next = {
    filled: (current?.filled ?? 0) + filled,
    confirmed: (current?.confirmed ?? 0) + stats.confirmed,
    asked: (current?.asked ?? 0) + stats.asked,
    documents: [...new Set([...(current?.documents ?? []), ...documents])].slice(0, 5),
    steps: (current?.steps ?? 0) + 1,
  };
  const settings = await loadSettings();
  let id = current?.id ?? null;
  if (settings.autofill.history && (await hasFeature("autofill_history"))) {
    const job = jobOf(await readState(tabId).catch(() => null));
    const body = {
      site: hostOf(url),
      ats: plan.ats,
      company: job.company?.slice(0, 200) ?? null,
      job_title: job.title?.slice(0, 300) ?? null,
      application_id: job.applicationId,
      fields_filled: Math.min(next.filled, 1000),
      fields_confirmed: Math.min(next.confirmed, 1000),
      fields_asked: Math.min(next.asked, 1000),
      documents: next.documents,
    };
    try {
      id = id ? (await api.updateHistory(id, body)).id : (await api.addHistory(body)).id;
    } catch (err) {
      // The entry may have been deleted in the meantime: start a new one.
      if ((err as ExtensionError).status === 404) id = (await api.addHistory(body).catch(() => null))?.id ?? null;
      else log.warn("autofill.history_failed", { code: (err as ExtensionError).code ?? "unknown" });
    }
  }
  // Only ids and counts are kept here (in memory for the browser session), never values.
  await chrome.storage.session.set({ [sessionKey(tabId)]: { origin, id: id ?? "", at: Date.now(), ...next } satisfies HistorySession });
  return next.steps;
}

export async function fillTab(tabId: number, pageUrl: string, items: FillItem[], attention: FieldRef[], stats: FillStats = { confirmed: 0, asked: 0, ats: null }): Promise<FillReport> {
  const url = await allowedTab(tabId);
  await featureOn();
  // The user reviewed values for one site: they go nowhere else.
  if (originOf(url) !== originOf(pageUrl)) {
    throw new ExtensionError("page_changed", "This tab shows a different site now. Check the form again before filling it.");
  }
  if (items.some((i) => i.value.kind === "file")) await featureOn("autofill_documents");
  const results: FieldOutcome[] = [];
  for (const [frameId, frameItems] of byFrame(items)) {
    const origin = frameItems[0]!.frameOrigin;
    if (!frameAllowed(origin) || frameItems.some((i) => i.frameOrigin !== origin)) {
      results.push(...frameItems.map((i) => ({ frameId, fieldId: i.fieldId, status: "wrong_page" as const })));
      continue;
    }
    // Downloaded only now, only for this frame's file inputs.
    const files = await filesFor(frameItems);
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        func: (list: FillItem[], fid: number, o: string, f: Record<string, PageFile>) =>
          (globalThis as unknown as { __careerosAutofill?: PageApi }).__careerosAutofill?.fill(list, fid, o, f) ?? null,
        args: [frameItems, frameId, origin, files],
      });
      const got = r?.result as FieldOutcome[] | null | undefined;
      results.push(...(got ?? frameItems.map((i) => ({ frameId, fieldId: i.fieldId, status: "not_found" as const }))));
    } catch {
      results.push(...frameItems.map((i) => ({ frameId, fieldId: i.fieldId, status: "not_found" as const })));
    }
  }
  for (const [frameId, refs] of byFrame(attention)) {
    await chrome.scripting
      .executeScript({
        target: { tabId, frameIds: [frameId] },
        func: (ids: string[]) => (globalThis as unknown as { __careerosAutofill?: PageApi }).__careerosAutofill?.attention(ids),
        args: [refs.map((r) => r.fieldId)],
      })
      .catch(() => undefined);
  }
  const filled = results.filter((r) => r.status === "filled").length;
  const problems: Record<string, number> = {};
  for (const r of results) if (r.status !== "filled") problems[r.status] = (problems[r.status] ?? 0) + 1;
  log.info("autofill.filled", { requested: items.length, filled, ...problems });

  if (filled > 0) {
    const ok = new Set(results.filter((r) => r.status === "filled").map((r) => `${r.frameId}:${r.fieldId}`));
    const attached = items.filter((i) => i.value.kind === "file" && ok.has(`${i.frameId}:${i.fieldId}`));
    const names = attached.map((i) => (i.value.kind === "file" ? i.value.name : "")).filter(Boolean);
    const ats = stats.ats ?? adapterForHost(hostOf(url)?.replace(/:\d+$/, "") ?? "")?.id ?? null;
    const steps = await recordHistory(tabId, url, { ats }, filled, stats, names).catch(() => 1);
    countEvent({ event: "filled", ats: ats ?? "generic", fields_filled: filled, fields_confirmed: stats.confirmed, fields_asked: stats.asked, steps: Math.min(steps, 50) });
    if (attached.length) countEvent({ event: "document_attached", ats: ats ?? "generic", fields_filled: attached.length });
  }
  return { results, filled };
}

export async function undoTab(tabId: number, fields?: FieldRef[]): Promise<UndoReport> {
  await allowedTab(tabId);
  const out: UndoReport["results"] = [];
  const run = async (target: chrome.scripting.InjectionTarget, frameId: number, ids?: string[]) => {
    const res = await chrome.scripting.executeScript({
      target,
      func: (fid: number, list: string[] | null) =>
        (globalThis as unknown as { __careerosAutofill?: PageApi }).__careerosAutofill?.undo(fid, list ?? undefined) ?? [],
      args: [frameId, ids ?? null],
    });
    // With allFrames each frame reports under its own id.
    for (const r of res) for (const x of (r.result as UndoReport["results"]) ?? []) out.push({ ...x, frameId: r.frameId });
  };
  try {
    if (fields?.length) {
      for (const [frameId, refs] of byFrame(fields)) await run({ tabId, frameIds: [frameId] }, frameId, refs.map((r) => r.fieldId));
    } else {
      await run({ tabId, allFrames: true }, 0);
    }
  } catch {
    throw new ExtensionError("no_access", messageFor("no_access"));
  }
  const restored = out.filter((r) => r.status === "restored").length;
  const kept = out.filter((r) => r.status === "kept_user_edit").length;
  log.info("autofill.undone", { restored, kept, manual: out.filter((r) => r.status === "manual").length });
  return { results: out, restored, kept };
}

/** Removes the outlines AutoFill drew (the values stay). */
export async function doneTab(tabId: number): Promise<null> {
  await chrome.scripting
    .executeScript({
      target: { tabId, allFrames: true },
      func: () => (globalThis as unknown as { __careerosAutofill?: PageApi }).__careerosAutofill?.clearHighlights(),
    })
    .catch(() => undefined);
  return null;
}

// ---- Suggested answers -----------------------------------------------------------------------

export async function answersTab(
  tabId: number,
  pageUrl: string,
  questions: AnswerQuestion[],
  language: "en" | "de",
  length?: AnswerLength,
  tone?: AnswerTone,
): Promise<AnswersOut> {
  const url = await allowedTab(tabId);
  if (originOf(url) !== originOf(pageUrl)) {
    throw new ExtensionError("page_changed", "This tab shows a different site now. Check the form again first.");
  }
  await featureOn("autofill_answers");
  const settings = await loadSettings();
  const job = jobOf(await readState(tabId).catch(() => null));
  // The question texts and the posting go to CareerOS, never anything typed into the form.
  const out = await api.autofillAnswers({
    url,
    application_id: job.applicationId,
    job_title: job.title?.slice(0, 300) ?? null,
    company: job.company?.slice(0, 200) ?? null,
    job_text: job.text?.slice(0, 8000) ?? null,
    questions,
    language,
    length: length ?? settings.autofill.answers.length,
    tone: tone ?? settings.autofill.answers.tone,
  });
  log.info("autofill.answers", { questions: questions.length, drafted: out.answers.filter((a) => a.status === "drafted").length, context: out.context });
  return out;
}

// ---- Saved answers, history, CVs (Options and the review) ------------------------------------

export const savedAnswers = (): Promise<SavedAnswer[]> => api.savedAnswers();

export async function saveAnswer(fieldKey: FieldKey | null, question: string, answer: string): Promise<SavedAnswer> {
  await featureOn("autofill_saved_answers");
  return api.saveAnswer({ field_key: fieldKey, question: question.trim().slice(0, 500), answer: answer.trim() });
}

export async function deleteAnswer(id: string): Promise<null> {
  await api.deleteAnswer(id);
  return null;
}

export const history = (): Promise<HistoryEntry[]> => api.history();

export async function deleteHistory(id?: string): Promise<null> {
  await api.deleteHistory(id);
  if (!id) {
    // The steps of an open application start a new entry.
    const all = await chrome.storage.session.get(null);
    await chrome.storage.session.remove(Object.keys(all).filter((k) => k.startsWith("af.session.")));
  }
  return null;
}

/** The uploaded CVs (for the default CV in Options). */
export async function cvs(): Promise<DocumentRef[]> {
  const out = await api.autofillDocuments(appUrl("/"), null);
  return out.documents.filter((d) => d.kind === "cv" && d.ref.startsWith("resume:"));
}

// ---- Multi-step forms --------------------------------------------------------------------

/**
 * The page script reports that the form gained or lost fields (the next step). Only the
 * extension's own page script, in a tab, is listened to; the tab comes from the browser, not
 * from the message, which carries nothing else.
 */
export function registerFormWatch(): void {
  chrome.runtime.onMessage.addListener((raw, sender) => {
    if (sender.id !== chrome.runtime.id || !sender.tab?.id || sender.tab.id < 0) return false;
    if (!raw || typeof raw !== "object" || (raw as { type?: unknown }).type !== "autofill.changed") return false;
    broadcastAutofill(sender.tab.id);
    return false;
  });
}
