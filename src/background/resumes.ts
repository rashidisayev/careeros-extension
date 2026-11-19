/**
 * Tailored resumes in the service worker: what the job on the tab is, asking GetCareer for a
 * resume written for it, its progress, and the file (for the form or a download).
 *
 * GetCareer writes, stores and deletes the resumes (POST /job-resumes and friends, see
 * docs/RESUMES.md); the backend is the source of truth for which resume belongs to which
 * application. The extension keeps only ids, in chrome.storage.session (memory, cleared when
 * the browser closes, on disconnect and with "Clear data"): never the posting's text, the
 * resume's content, the file or a link to it. Files are fetched right before they are used
 * and checked (type, size, header) before they reach a page or the user's disk.
 */
import { postingFrom, requirementsOf, LIMITS } from "../extraction/posting";
import type { JobResumeCreate, JobResumeOut, ResumeFormat, UserOut } from "../shared/api-types";
import { ExtensionError, messageFor } from "../shared/errors";
import { log } from "../shared/log";
import {
  IN_FLIGHT,
  looksLike,
  MAX_RESUME_BYTES,
  RESUME_ERRORS,
  RESUME_MIME,
  safeResumeName,
  viewOf,
  type MissingDetail,
  type ResumeDetails,
  type ResumeInput,
  type ResumeProgress,
  type ResumeView,
} from "../shared/resumes";
import type { PageFile } from "../autofill/types";
import { api } from "./api";
import { allowedTab, base64, originOf } from "./pages";
import { sessionInfo } from "./session";
import { readState, refreshLookup, tabState } from "./tabs";

/** GetCareer turns this feature on per account; nothing is asked for while it is off. */
async function resumesOn(): Promise<UserOut> {
  const s = await sessionInfo();
  if (!s.connected) throw new ExtensionError("not_connected", messageFor("not_connected"), 401);
  const f = s.bootstrap?.features.job_resumes;
  if (!f?.enabled) {
    const code = f?.reason === "consent_required" ? "ai_consent_required" : f?.reason === "ai_unavailable" ? "ai_unavailable" : "feature_unavailable";
    throw new ExtensionError(code, RESUME_ERRORS[code]!);
  }
  return s.user;
}

// ---- Which resume belongs to which job ----------------------------------------------------

/**
 * One job, one key: the tracked application when there is one, else the posting's address,
 * company and title, always for this user. Hashed, so the key says nothing about the job.
 */
async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

const low = (v: string | null | undefined) => (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

async function jobKeys(userId: string, applicationId: string | null, job: { url: string | null; company: string | null; title: string | null }): Promise<string[]> {
  const keys: string[] = [];
  if (applicationId) keys.push(`jr.${await hash(`${userId}|app|${applicationId}`)}`);
  if (job.url && job.company && job.title) keys.push(`jr.${await hash(`${userId}|job|${job.url}|${low(job.company)}|${low(job.title)}`)}`);
  return keys;
}

type Remembered = { id: string; app: string; at: number };

async function remembered(keys: string[]): Promise<{ key: string; value: Remembered } | null> {
  if (!keys.length) return null;
  const got = await chrome.storage.session.get(keys);
  for (const key of keys) {
    const v = got[key] as Remembered | undefined;
    if (v && typeof v.id === "string") return { key, value: v };
  }
  return null;
}

async function remember(keys: string[], r: { id: string; application_id: string }, userId: string): Promise<void> {
  const all = [...new Set([...keys, ...(await jobKeys(userId, r.application_id, { url: null, company: null, title: null }))])];
  const value: Remembered = { id: r.id, app: r.application_id, at: Date.now() };
  await chrome.storage.session.set(Object.fromEntries(all.map((k) => [k, value])));
}

/** Drops every key that names this resume (the job's and the application's). */
async function forget(id: string): Promise<void> {
  const all = await chrome.storage.session.get(null);
  const stale = Object.keys(all).filter((k) => k.startsWith("jr.") && (all[k] as Remembered | undefined)?.id === id);
  if (stale.length) await chrome.storage.session.remove(stale);
}

const usable = (r: JobResumeOut) => IN_FLIGHT.has(r.status) || r.status === "ready";

/** The resume GetCareer has for this job: the one asked for before, else the application's. */
async function currentResume(user: UserOut, keys: string[], applicationId: string | null): Promise<ResumeView | null> {
  const known = await remembered(keys);
  if (known) {
    try {
      const r = await api.jobResume(known.value.id);
      if (usable(r)) return viewOf(r, true, user.full_name);
    } catch (err) {
      if (![404, 410].includes((err as ExtensionError).status ?? 0)) throw err;
    }
    // Deleted, failed or gone: GetCareer decides; start from what it has now.
    await forget(known.value.id);
  }
  if (!applicationId) return null;
  const versions = await api.jobResumesFor(applicationId).catch((err: ExtensionError) => {
    if (err.status === 404) return [] as JobResumeOut[];
    throw err;
  });
  // Newest first: one being written, else the current ready one.
  const pick = versions.find((r) => IN_FLIGHT.has(r.status)) ?? versions.find((r) => r.status === "ready" && r.is_current) ?? versions.find((r) => r.status === "ready");
  if (!pick) return null;
  await remember(keys, pick, user.id);
  return viewOf(pick, true, user.full_name);
}

// ---- The job ----------------------------------------------------------------------------------

/** The job on the tab as the extension read it, the application GetCareer tracks for it, and its resume. */
export async function resumeDetails(tabId: number): Promise<ResumeDetails> {
  const url = await allowedTab(tabId);
  const user = await resumesOn();
  let state = await readState(tabId);
  if (!state || state.url !== url || !state.extraction) state = await tabState(tabId).catch(() => state);
  const job = postingFrom(state?.extraction ?? null, url);

  // A page that isn't read as a posting (an /apply page) wasn't looked up yet.
  let lookup = state?.lookup ?? null;
  if (!lookup && (job.title || job.company)) {
    lookup = await api
      .lookup({ url: job.url ?? url, title: job.title, company: job.company, city: job.location?.split(",")[0]?.trim().slice(0, 120) || null })
      .catch(() => null);
  }
  const strong = lookup?.applications.find((a) => a.reasons.includes("same_link") || a.reasons.includes("same_posting")) ?? null;
  const application = strong ? { id: strong.application_id, title: strong.position_title, company: strong.company_name, status: strong.status } : null;

  // With a tracked application GetCareer uses its title, company and posting text.
  const missing: MissingDetail[] = [];
  if (!application) {
    if (!job.title) missing.push("job_title");
    if (!job.company) missing.push("company");
    if ((job.description?.trim().length ?? 0) < LIMITS.minDescription) missing.push("job_description");
  }
  const confidence = state?.extraction?.confidence ?? "none";
  // Read from a page that may not be the posting: the user checks before anything is written.
  const confirm = missing.length > 0 || (!application && confidence !== "high" && confidence !== "medium");
  const current = await currentResume(user, await jobKeys(user.id, application?.id ?? null, job), application?.id ?? null);
  log.info("resume.details", {
    confidence,
    tracked: !!application,
    missing: missing.join(",") || null,
    sections: [job.responsibilities.length, job.required.length, job.preferred.length].join("/"),
    current: current?.status ?? null,
  });
  return { job, application, confidence, missing, confirm, current };
}

const cut = (v: string | null | undefined, max: number) => {
  const t = v?.trim();
  return t ? t.slice(0, max) : undefined;
};

function bodyOf(input: ResumeInput): JobResumeCreate {
  const body: JobResumeCreate = { language: input.language };
  if (input.applicationId) body.application_id = input.applicationId;
  const set = <K extends keyof JobResumeCreate>(k: K, v: JobResumeCreate[K] | undefined) => {
    if (v !== undefined) body[k] = v;
  };
  set("job_title", cut(input.title, LIMITS.title));
  set("company", cut(input.company, LIMITS.company));
  set("job_description", cut(input.description, LIMITS.description));
  set("location", cut(input.location, LIMITS.location));
  set("seniority", cut(input.seniority, LIMITS.seniority));
  if (input.url && /^https?:\/\//i.test(input.url) && input.url.length <= 1000) body.posting_url = input.url;
  const reqs = input.requirements.map((r) => r.trim().slice(0, LIMITS.requirement)).filter(Boolean).slice(0, LIMITS.requirements);
  if (reqs.length) body.requirements = reqs;
  return body;
}

/** Requests for a resume that are on their way, per tab and job: a second click joins the first. */
const creating = new Map<string, Promise<ResumeView>>();

/**
 * Asks GetCareer for a resume tailored to this job. GetCareer finds the application by the
 * posting's link (or creates it) and returns the resume it already has for it instead of
 * writing another; a new version needs `resumeRegenerate`.
 */
export function resumeCreate(tabId: number, pageUrl: string, input: ResumeInput): Promise<ResumeView> {
  // Checked before anything is awaited, so two clicks in a row can't both get through.
  const k = `${tabId}|${input.applicationId ?? ""}|${input.url ?? ""}|${low(input.company)}|${low(input.title)}`;
  const running = creating.get(k);
  if (running) return running;
  const run = createNow(tabId, pageUrl, input);
  creating.set(k, run);
  run.finally(() => creating.delete(k)).catch(() => undefined);
  return run;
}

async function createNow(tabId: number, pageUrl: string, input: ResumeInput): Promise<ResumeView> {
  const url = await allowedTab(tabId);
  if (originOf(url) !== originOf(pageUrl)) {
    throw new ExtensionError("page_changed", "This tab shows a different site now. Check the job details again.");
  }
  const user = await resumesOn();
  const body = bodyOf(input);
  // Never written from too little: GetCareer would refuse it anyway, and the user is told why.
  if (!body.application_id) {
    const missing: MissingDetail[] = [];
    if (!body.job_title) missing.push("job_title");
    if (!body.company) missing.push("company");
    if ((body.job_description?.length ?? 0) < LIMITS.minDescription) missing.push("job_description");
    if (missing.length) throw new ExtensionError("job_details_required", RESUME_ERRORS.job_details_required!, 422, { missing });
  }
  const keys = await jobKeys(user.id, input.applicationId, { url: body.posting_url ?? null, company: body.company ?? null, title: body.job_title ?? null });
  // One Idempotency-Key for this request: resent after a network error it can't start a second resume.
  const r = await api.jobResumeCreate(body, `ext-${crypto.randomUUID()}`);
  await remember(keys, r, user.id);
  // GetCareer may have created the application: the tab's lookup should show it.
  if (!input.applicationId) void refreshLookup(tabId).catch(() => undefined);
  log.info("resume.requested", { status: r.status, version: r.version, tracked: !!input.applicationId });
  return viewOf(r, r.status === "ready", user.full_name);
}

export async function resumeProgress(id: string): Promise<ResumeProgress> {
  await resumesOn();
  const s = await api.jobResumeStatus(id);
  return {
    id: s.id,
    status: s.status,
    ready: s.ready === true && s.status === "ready",
    pollAfter: IN_FLIGHT.has(s.status) ? Math.min(Math.max(s.poll_after_seconds ?? 3, 1), 60) : null,
    error: s.error,
    deletionReason: s.deletion_reason,
  };
}

export async function resumeGet(id: string): Promise<ResumeView> {
  const user = await resumesOn();
  return viewOf(await api.jobResume(id), false, user.full_name);
}

/** A new version for the same job (the user asked for it). Joins one already being written. */
export async function resumeRegenerate(id: string, language?: "en" | "de"): Promise<ResumeView> {
  const user = await resumesOn();
  let r: JobResumeOut;
  try {
    r = await api.jobResumeRegenerate(id, language ? { language } : {}, `ext-${crypto.randomUUID()}`);
  } catch (err) {
    const e = err as ExtensionError;
    const runningId = (e.details as { resume_id?: unknown } | undefined)?.resume_id;
    if (e.code !== "generation_in_progress" || typeof runningId !== "string") throw err;
    r = await api.jobResume(runningId);
  }
  await remember(await jobKeys(user.id, r.application_id, { url: null, company: null, title: null }), r, user.id);
  log.info("resume.regenerated", { status: r.status, version: r.version });
  return viewOf(r, false, user.full_name);
}

/**
 * The file, fetched now for immediate use and kept nowhere: for the form (the AutoFill fill)
 * or for the user to save. Refused unless it is the format asked for, of a sane size, and
 * starts like such a file.
 */
export async function resumeFile(id: string, format: ResumeFormat): Promise<PageFile> {
  const user = await resumesOn();
  const meta = await api.jobResume(id);
  if (meta.status !== "ready") {
    const code = meta.status === "deleted" ? "resume_deleted" : "resume_not_ready";
    throw new ExtensionError(code, RESUME_ERRORS[code]!, 409, { status: meta.status, deletion_reason: meta.deletion_reason });
  }
  const entry = meta.files.find((f) => f.format === format);
  if (!entry) throw new ExtensionError("format_not_available", RESUME_ERRORS.format_not_available!, 404);
  const got = await api.jobResumeFile(id, format);
  const bytes = new Uint8Array(got.bytes);
  const mime = got.mime.split(";")[0]!.trim().toLowerCase();
  if (!bytes.length || bytes.length > MAX_RESUME_BYTES || mime !== RESUME_MIME[format] || !looksLike(bytes, format)) {
    log.warn("resume.bad_file", { format, size: bytes.length, mime: mime.slice(0, 60) });
    throw new ExtensionError("bad_file", RESUME_ERRORS.bad_file!);
  }
  log.info("resume.file", { format, size: bytes.length });
  return { name: safeResumeName(entry.filename, format, user.full_name), mime: RESUME_MIME[format], base64: base64(bytes) };
}
