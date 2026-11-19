/**
 * The tailored resume in the AutoFill section of the side panel: the job it is for, how far
 * GetCareer got writing it, whether it is attached to the form, and the file to download.
 *
 * GetCareer writes the resume (POST /job-resumes) and keeps it; the panel only asks, waits
 * (polling while it is open; it picks up again when reopened) and shows. Before anything is
 * asked for, the job must be clear: on a page that may not be the posting, or with the title,
 * company or description missing, the user checks the details first.
 */
import { CheckCircle2, Download, ExternalLink, FileText, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { requirementsOf } from "../extraction/posting";
import type { PageFile } from "../autofill/types";
import type { Bootstrap, ResumeFormat } from "../shared/api-types";
import { DELETED, FAILURE, IN_FLIGHT, RESUME_ERRORS, type ResumeDetails, type ResumeInput, type ResumeView } from "../shared/resumes";
import type { ErrorInfo } from "../shared/types";
import { Alert, Button, CONTROL, cn } from "./components";
import { errorInfo, send } from "./client";

/** Whether this account gets tailored resumes, why not, and whether "Fill application" asks for one. */
export type ResumeAccess = { enabled: boolean; reason: string | null; auto: boolean };

/** null: nothing to show (an older GetCareer, or one without AI). */
export function resumeAccess(bootstrap: Bootstrap | null, settings: { tailoredResume: boolean }): ResumeAccess | null {
  const f = bootstrap?.features.job_resumes;
  if (!f || (!f.enabled && f.reason !== "consent_required")) return null;
  return { enabled: f.enabled, reason: f.reason, auto: settings.tailoredResume };
}

export type Stage = "idle" | "detecting" | "details" | "analyzing" | "generating" | "preparing" | "ready" | "waiting" | "failed";

/** The words of each step, as the user sees them while it runs. */
export const STAGE_TEXT: Partial<Record<Stage, string>> = {
  detecting: "Detecting job details…",
  analyzing: "Analyzing job description…",
  generating: "Generating your tailored resume…",
  preparing: "Preparing resume document…",
};

export const RUNNING: Stage[] = ["detecting", "analyzing", "generating", "preparing"];

/** Stop waiting after this long; GetCareer goes on and the user can check again. */
const WAIT_MS = 5 * 60_000;

export type ResumeFlow = {
  stage: Stage;
  details: ResumeDetails | null;
  resume: ResumeView | null;
  error: ErrorInfo | null;
  /** Start: read the job, then use the resume GetCareer has or ask for one. */
  start: () => void;
  /** Ask for a resume for the job as the user confirmed it. */
  create: (input: ResumeInput) => void;
  /** A new version (after a failure, or because the user wants one). */
  regenerate: () => void;
  /** Wait again after giving up waiting. */
  checkAgain: () => void;
  /** The job details, to correct them before asking. */
  editDetails: () => void;
  /** No resume for now: back to the offer. */
  dismiss: () => void;
};

/** The language to write in: the posting's, else the form's, else the browser's. */
function languageFor(details: ResumeDetails | null, formLang: string | null): "en" | "de" {
  if (details?.job.language) return details.job.language;
  if (formLang?.toLowerCase().startsWith("de")) return "de";
  return (globalThis.navigator?.language ?? "en").toLowerCase().startsWith("de") ? "de" : "en";
}

export function inputFrom(details: ResumeDetails, language: "en" | "de"): ResumeInput {
  const j = details.job;
  const tracked = details.application;
  return {
    applicationId: tracked?.id ?? null,
    // With a tracked application GetCareer uses its own title and company.
    title: tracked ? null : j.title,
    company: tracked ? null : j.company,
    description: (j.description?.trim().length ?? 0) >= 40 ? j.description : null,
    location: j.location,
    seniority: j.seniority,
    requirements: requirementsOf(j),
    language,
    url: j.url,
  };
}

export function useTailoredResume(tabId: number, pageUrl: string | null, enabled: boolean, formLang: string | null): ResumeFlow {
  const [stage, setStage] = useState<Stage>("idle");
  const [details, setDetails] = useState<ResumeDetails | null>(null);
  const [resume, setResume] = useState<ResumeView | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  // One step at a time: repeated clicks don't start a second request.
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fail = useCallback((info: ErrorInfo) => {
    if (!alive.current) return;
    setError(info);
    setStage("failed");
  }, []);

  /** Where a version GetCareer returned leaves the flow. */
  const follow = useCallback(
    (r: ResumeView) => {
      setResume(r);
      if (IN_FLIGHT.has(r.status)) setStage("generating");
      else if (r.status === "ready") setStage("ready");
      else if (r.status === "failed") fail({ code: r.error?.code ?? "generation_failed", message: FAILURE[r.error?.code ?? ""] ?? "GetCareer couldn't write this resume." });
      else if (r.status === "deleted") fail({ code: "resume_deleted", message: DELETED[r.deletionReason ?? ""] ?? RESUME_ERRORS.resume_deleted! });
      else fail({ code: "unknown_status", message: "GetCareer says this resume isn't ready. Open it in GetCareer to check." });
    },
    [fail],
  );

  const create = useCallback(
    (input: ResumeInput) => {
      if (busy.current || !pageUrl) return;
      busy.current = true;
      setError(null);
      setStage("analyzing");
      send({ type: "resume.create", tabId, pageUrl, input })
        .then((r) => alive.current && follow(r))
        .catch((e) => {
          const info = errorInfo(e);
          // GetCareer needs more about the job: the user adds it.
          if (alive.current && (info.code === "job_details_required" || info.code === "job_description_required")) {
            setError(info);
            setStage("details");
          } else fail(info);
        })
        .finally(() => {
          busy.current = false;
        });
    },
    [tabId, pageUrl, follow, fail],
  );

  const start = useCallback(() => {
    if (busy.current || !enabled) return;
    busy.current = true;
    setError(null);
    setStage("detecting");
    send({ type: "resume.details", tabId })
      .then((d) => {
        if (!alive.current) return;
        setDetails(d);
        busy.current = false;
        if (d.current) return follow(d.current);
        // Unclear or incomplete: never written from it without the user seeing the details.
        if (d.confirm) return setStage("details");
        create(inputFrom(d, languageFor(d, formLang)));
      })
      .catch((e) => {
        busy.current = false;
        fail(errorInfo(e));
      });
  }, [tabId, enabled, formLang, follow, create, fail]);

  // A resume asked for earlier (before the panel closed, or in GetCareer) is picked up.
  useEffect(() => {
    if (!enabled) return;
    send({ type: "resume.details", tabId })
      .then((d) => {
        if (!alive.current || busy.current) return;
        setDetails(d);
        if (d.current && (IN_FLIGHT.has(d.current.status) || d.current.status === "ready")) follow(d.current);
      })
      .catch(() => undefined);
  }, [tabId, enabled, follow]);

  const regenerate = useCallback(() => {
    if (busy.current || !resume) return;
    busy.current = true;
    setError(null);
    setStage("analyzing");
    // The same language and job as the version it replaces (GetCareer keeps them).
    send({ type: "resume.regenerate", resumeId: resume.id })
      .then((r) => alive.current && follow(r))
      .catch((e) => fail(errorInfo(e)))
      .finally(() => {
        busy.current = false;
      });
  }, [resume, follow, fail]);

  // Waiting: ask GetCareer how far it got, as often as it says.
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (stage !== "generating" || !resume) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + WAIT_MS;
    let errors = 0;
    const after = (seconds: number) => {
      if (Date.now() + seconds * 1000 > deadline) {
        setStage("waiting");
        return;
      }
      timer = setTimeout(poll, seconds * 1000);
    };
    const poll = async () => {
      if (stopped) return;
      try {
        const p = await send({ type: "resume.progress", resumeId: resume.id });
        if (stopped) return;
        errors = 0;
        if (p.pollAfter !== null) return after(p.pollAfter);
        if (!p.ready) {
          return follow({ ...resume, status: p.status, error: p.error, deletionReason: p.deletionReason });
        }
        setStage("preparing");
        const full = await send({ type: "resume.get", resumeId: resume.id });
        if (!stopped) follow(full);
      } catch (e) {
        if (stopped) return;
        const info = errorInfo(e);
        // Too many questions: slow down. A hiccup: try a few more times.
        if (info.code === "rate_limited") return after(30);
        if (["network_error", "timeout", "server_error", "offline"].includes(info.code) && ++errors < 4) return after(5);
        fail(info);
      }
    };
    after(3);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // `round` restarts the wait after "Check again".
  }, [stage, resume?.id, round]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkAgain = useCallback(() => {
    setRound((n) => n + 1);
    setStage("generating");
  }, []);

  const editDetails = useCallback(() => {
    if (!busy.current && details) setStage("details");
  }, [details]);

  const dismiss = useCallback(() => {
    if (busy.current) return;
    setError(null);
    setStage("idle");
  }, []);

  return { stage, details, resume, error, start, create, regenerate, checkAgain, editDetails, dismiss };
}

// ---- Downloads -------------------------------------------------------------------------------

type DownloadState = { status: "busy" | "done" | "started" | "error"; text: string };

/** Asks for the optional "downloads" permission; must be called in the click itself. */
function askDownloads(declined: { current: boolean }): Promise<boolean> {
  const p = (globalThis.chrome as { permissions?: typeof chrome.permissions } | undefined)?.permissions;
  if (!p?.request || declined.current) return Promise.resolve(false);
  return p.request({ permissions: ["downloads"] }).then(
    (ok) => {
      if (!ok) declined.current = true;
      return ok;
    },
    () => false,
  );
}

function waitForDownload(id: number): Promise<"complete" | string> {
  return new Promise((resolve) => {
    const listener = (d: chrome.downloads.DownloadDelta) => {
      if (d.id !== id || !d.state?.current) return;
      if (d.state.current === "complete") done("complete");
      else if (d.state.current === "interrupted") done(d.error?.current ?? "interrupted");
    };
    const done = (r: string) => {
      chrome.downloads.onChanged.removeListener(listener);
      resolve(r);
    };
    chrome.downloads.onChanged.addListener(listener);
  });
}

/** Saves the file: through the browser's downloads (with its outcome) or as a plain download. */
async function saveFile(file: PageFile, allowed: Promise<boolean>): Promise<"complete" | "started" | string> {
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
  try {
    // Present only once the user granted the optional "downloads" permission.
    const downloads = (globalThis.chrome as { downloads?: typeof chrome.downloads } | undefined)?.downloads;
    if ((await allowed) && downloads?.download) {
      const id = await downloads.download({ url, filename: file.name, conflictAction: "uniquify", saveAs: false });
      return await waitForDownload(id);
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return "started";
  } finally {
    // The file lives only as long as the browser needs to save it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** One download per resume version and format at a time, and no second one by accident. */
function useDownloads() {
  const [state, setState] = useState<Record<string, DownloadState>>({});
  const declined = useRef(false);
  const download = (resume: ResumeView, format: ResumeFormat, again = false) => {
    const k = `${resume.id}|${format}`;
    const current = state[k]?.status;
    if (current === "busy" || ((current === "done" || current === "started") && !again)) return;
    const allowed = askDownloads(declined);
    const name = resume.files.find((f) => f.format === format)?.filename ?? `Resume.${format}`;
    setState((s) => ({ ...s, [k]: { status: "busy", text: `Downloading ${name}…` } }));
    send({ type: "resume.file", resumeId: resume.id, format })
      .then((file) => saveFile(file, allowed))
      .then((r) =>
        setState((s) => ({
          ...s,
          [k]:
            r === "complete"
              ? { status: "done", text: `Saved ${name} to your downloads.` }
              : r === "started"
                ? { status: "started", text: `Downloading ${name}. Your browser shows it in its downloads.` }
                : { status: "error", text: `The download didn't finish (${r.toLowerCase().replace(/_/g, " ")}). Try again.` },
        })),
      )
      .catch((e) => {
        const info = errorInfo(e);
        setState((s) => ({ ...s, [k]: { status: "error", text: RESUME_ERRORS[info.code] ?? info.message } }));
      });
  };
  return { state, download };
}

// ---- The card --------------------------------------------------------------------------------

/** Where the resume stands on the form. */
export type AttachState =
  | { kind: "none" }
  /** Attach it as soon as it's ready (the form was filled before it was). */
  | { kind: "pending" }
  | { kind: "attaching" }
  | { kind: "attached" }
  /** The resume has points GetCareer couldn't verify: the user decides. */
  | { kind: "confirm" }
  /** The CV field already holds a file. */
  | { kind: "occupied" }
  | { kind: "manual"; reason: string | null };

function Busy({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-[0.8125rem]">
      <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
      {text}
    </p>
  );
}

function DetailsForm({ flow, formLang, onCancel }: { flow: ResumeFlow; formLang: string | null; onCancel?: () => void }) {
  const d = flow.details!;
  const [title, setTitle] = useState(d.application?.title ?? d.job.title ?? "");
  const [company, setCompany] = useState(d.application?.company ?? d.job.company ?? "");
  const [description, setDescription] = useState(d.job.description ?? "");
  const [language, setLanguage] = useState<"en" | "de">(languageFor(d, formLang));
  const tracked = !!d.application;
  const short = description.trim().length < 40;
  const ok = (tracked || (title.trim() && company.trim() && !short)) && description.length <= 50_000;
  const missing = flow.error?.code === "job_description_required" || (!tracked && d.missing.includes("job_description"));
  const submit = () => {
    const base = inputFrom(d, language);
    flow.create({
      ...base,
      title: tracked ? null : title.trim().slice(0, 300),
      company: tracked ? null : company.trim().slice(0, 200),
      description: short ? null : description.trim(),
    });
  };
  return (
    <form
      className="grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) submit();
      }}
    >
      <p className="text-xs text-muted-foreground">
        {missing
          ? "GetCareer couldn't read the job description on this page. Paste the posting's text so the resume fits this job."
          : d.missing.length
            ? "Some details of the job are missing. Add them so the resume fits this job."
            : "Check the job details. The resume is written for this job only."}
      </p>
      {flow.error && <p className="text-xs text-warning">{RESUME_ERRORS[flow.error.code] ?? flow.error.message}</p>}
      <label className="grid gap-1 text-xs font-medium">
        Job title
        <input className={cn(CONTROL, "h-8 text-[0.8125rem]")} value={title} maxLength={300} disabled={tracked} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="grid gap-1 text-xs font-medium">
        Company
        <input className={cn(CONTROL, "h-8 text-[0.8125rem]")} value={company} maxLength={200} disabled={tracked} onChange={(e) => setCompany(e.target.value)} />
      </label>
      <label className="grid gap-1 text-xs font-medium">
        Job description{tracked ? " (optional: GetCareer has the one you saved)" : ""}
        <textarea className={cn(CONTROL, "h-auto py-1.5 text-[0.8125rem]")} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Paste the job posting's text" />
      </label>
      {(d.job.required.length > 0 || d.job.responsibilities.length > 0) && (
        <p className="text-xs text-muted-foreground">
          Read from the posting: {d.job.responsibilities.length} tasks, {d.job.required.length} requirements{d.job.preferred.length ? `, ${d.job.preferred.length} nice-to-haves` : ""}.
        </p>
      )}
      <label className="flex items-center gap-2 text-xs font-medium">
        Write it in
        <select aria-label="Resume language" className={cn(CONTROL, "h-8 w-28 text-[0.8125rem]")} value={language} onChange={(e) => setLanguage(e.target.value as "en" | "de")}>
          <option value="en">English</option>
          <option value="de">German</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!ok}>
          Create tailored resume
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Not now
          </Button>
        )}
      </div>
    </form>
  );
}

const FORMAT_LABEL: Record<ResumeFormat, string> = { pdf: "PDF", docx: "Word" };

function ErrorLinks({ error, applicationId, onOpen }: { error: ErrorInfo; applicationId: string | null; onOpen: (path: string) => void }) {
  const link = (path: string, text: string) => (
    <Button variant="link" className="text-xs" onClick={() => onOpen(path)}>
      {text} <ExternalLink className="size-3" aria-hidden />
    </Button>
  );
  if (error.code === "ai_consent_required") return link("/documents", "Open CV & Documents");
  if (error.code === "profile_incomplete") return link("/profile", "Open your Career Profile");
  if (error.code === "application_closed" && applicationId) return link(`/applications/${applicationId}`, "Open the application");
  return null;
}

export function TailoredResumeCard({
  flow,
  access,
  attach,
  cvLabel,
  formDone,
  formLang,
  onAttach,
  onOpen,
}: {
  flow: ResumeFlow;
  access: ResumeAccess;
  attach: AttachState;
  /** The form's CV field, if it has one. */
  cvLabel: string | null;
  /** The user filled the form (the result is showing). */
  formDone: boolean;
  formLang: string | null;
  onAttach: (overwrite: boolean) => void;
  onOpen: (path: string) => void;
}) {
  const { stage, resume, details, error } = flow;
  const downloads = useDownloads();
  const title = resume?.jobTitle ?? details?.application?.title ?? details?.job.title ?? null;
  const company = resume?.company ?? details?.application?.company ?? details?.job.company ?? null;
  const applicationId = resume?.applicationId ?? details?.application?.id ?? null;
  const ready = stage === "ready" && resume;

  if (!access.enabled) {
    return (
      <section aria-labelledby="resume-title" className="grid gap-1.5 rounded-xl border bg-card p-3 shadow-card">
        <h3 id="resume-title" className="flex items-center gap-2 text-[0.8125rem] font-semibold">
          <FileText className="size-4 text-primary" aria-hidden /> Tailored resume
        </h3>
        <p className="text-xs text-muted-foreground">
          {RESUME_ERRORS.ai_consent_required}{" "}
          <Button variant="link" className="text-xs" onClick={() => onOpen("/documents")}>
            Open CV & Documents
          </Button>
        </p>
      </section>
    );
  }

  const attachLine = (() => {
    if (!ready) return attach.kind === "pending" && cvLabel ? <p className="text-xs text-muted-foreground">It's attached to “{cvLabel}” as soon as it's ready.</p> : null;
    switch (attach.kind) {
      case "attaching":
        return <Busy text="Attaching resume…" />;
      case "attached":
        return (
          <p role="status" className="flex items-center gap-2 text-[0.8125rem] text-success">
            <CheckCircle2 className="size-4" aria-hidden /> Resume successfully attached to the application.
          </p>
        );
      case "confirm":
        return (
          <Alert
            tone="warning"
            title="Check the resume before attaching it"
            action={
              <Button size="sm" variant="outline" onClick={() => onAttach(false)}>
                Attach anyway
              </Button>
            }
          >
            <p>
              {resume.review?.flagged === 1 ? "One point" : `${resume.review?.flagged ?? 0} points`} in it name a number or skill GetCareer couldn't find in your profile. Download it and read
              it first.
            </p>
          </Alert>
        );
      case "occupied":
        return (
          <Alert
            tone="info"
            title={`“${cvLabel ?? "CV"}” already has a file`}
            action={
              <Button size="sm" variant="outline" onClick={() => onAttach(true)}>
                Replace the file
              </Button>
            }
          >
            <p>Replace it with the tailored resume, or keep the file that's there.</p>
          </Alert>
        );
      case "manual":
        return (
          <div className="grid gap-0.5 text-xs">
            <p className="text-[0.8125rem]">{cvLabel ? "Your tailored resume is ready. Please download it and attach it manually to your application." : "Resume is ready for download. Please attach it manually."}</p>
            {attach.reason && <p className="text-muted-foreground">{attach.reason}</p>}
          </div>
        );
      default:
        return cvLabel ? null : <p className="text-[0.8125rem]">Resume is ready for download. Please attach it manually.</p>;
    }
  })();

  const canAttach = ready && cvLabel && ["none", "manual"].includes(attach.kind);
  const completed = formDone && ready && (attach.kind === "attached" || attach.kind === "manual" || !cvLabel);

  return (
    <section aria-labelledby="resume-title" className="grid gap-2.5 rounded-xl border bg-card p-3 shadow-card">
      <div className="grid gap-0.5">
        <h3 id="resume-title" className="flex items-center gap-2 text-[0.8125rem] font-semibold">
          <FileText className="size-4 text-primary" aria-hidden /> Tailored resume
        </h3>
        {(title || company) && (
          <p className="text-xs text-muted-foreground">
            {title ?? "Job"}
            {company ? ` · ${company}` : ""}
            {resume && resume.version > 1 ? ` · version ${resume.version}` : ""}
          </p>
        )}
      </div>

      {stage === "idle" && (
        <div className="grid gap-1.5">
          <p className="text-xs text-muted-foreground">GetCareer can write a resume for this job from your Career Profile and attach it to the form.</p>
          <Button size="sm" variant="outline" className="justify-self-start" onClick={flow.start}>
            Create tailored resume
          </Button>
        </div>
      )}
      {STAGE_TEXT[stage] && <Busy text={STAGE_TEXT[stage]!} />}
      {stage === "generating" && <p className="text-xs text-muted-foreground">This can take a minute or two. You can go on with the form meanwhile.</p>}
      {stage === "details" && details && <DetailsForm flow={flow} formLang={formLang} onCancel={flow.dismiss} />}
      {stage === "waiting" && (
        <Alert
          tone="info"
          title="Still being prepared"
          action={
            <Button size="sm" variant="outline" onClick={flow.checkAgain}>
              <RefreshCw aria-hidden /> Check again
            </Button>
          }
        >
          <p>GetCareer is still working on your resume. Check again in a minute.</p>
        </Alert>
      )}
      {stage === "failed" && error && (
        <Alert
          tone="warning"
          title="No tailored resume"
          action={
            !["ai_consent_required", "profile_incomplete", "application_closed", "feature_unavailable", "ai_unavailable", "invalid_session", "not_connected"].includes(error.code) && (
              <Button size="sm" variant="outline" onClick={resume && resume.status === "failed" ? flow.regenerate : flow.start}>
                <RefreshCw aria-hidden /> Try again
              </Button>
            )
          }
        >
          <p>{RESUME_ERRORS[error.code] ?? error.message}</p>
          <p className="text-xs">AutoFill works without it: the form's other fields aren't affected.</p>
          <ErrorLinks error={error} applicationId={applicationId} onOpen={onOpen} />
        </Alert>
      )}

      {ready && (
        <>
          <p role="status" className="flex items-center gap-2 text-[0.8125rem] font-medium">
            <CheckCircle2 className="size-4 text-primary" aria-hidden />
            {completed ? "Autofill completed." : "Your tailored resume is ready."}
          </p>
          {resume.reused && !completed && <p className="text-xs text-muted-foreground">GetCareer already had a resume for this job, so it used that one instead of writing another.</p>}
          {resume.requirements.unsupported.length > 0 && (
            <p className="text-xs text-muted-foreground">
              The job asks for {resume.requirements.unsupported.slice(0, 4).join(", ")}
              {resume.requirements.unsupported.length > 4 ? " and more" : ""}, which your profile doesn't show; the resume doesn't claim {resume.requirements.unsupported.length === 1 ? "it" : "them"}.
            </p>
          )}
        </>
      )}
      {attachLine}

      {ready && (
        <div className="flex flex-wrap items-center gap-2">
          {canAttach && (
            <Button size="sm" onClick={() => onAttach(false)}>
              Attach to “{cvLabel}”
            </Button>
          )}
          {resume.files.map((f) => {
            const st = downloads.state[`${resume.id}|${f.format}`];
            const done = st?.status === "done" || st?.status === "started";
            return (
              <Button key={f.format} size="sm" variant="outline" busy={st?.status === "busy"} disabled={done} onClick={() => downloads.download(resume, f.format)}>
                <Download aria-hidden /> {done ? `Downloaded ${FORMAT_LABEL[f.format]}` : `Download ${FORMAT_LABEL[f.format]}`}
              </Button>
            );
          })}
        </div>
      )}
      {ready &&
        resume.files.map((f) => {
          const st = downloads.state[`${resume.id}|${f.format}`];
          if (!st || st.status === "busy") return st ? <p key={f.format} role="status" className="text-xs text-muted-foreground">{st.text}</p> : null;
          return (
            <p key={f.format} role="status" className={cn("text-xs", st.status === "error" ? "text-warning" : "text-muted-foreground")}>
              {st.text}{" "}
              {st.status !== "error" && (
                <Button variant="link" className="text-xs" onClick={() => downloads.download(resume, f.format, true)}>
                  Download again
                </Button>
              )}
            </p>
          );
        })}

      {(applicationId || (ready && !RUNNING.includes(stage))) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {applicationId && (
            <Button variant="link" className="text-xs" onClick={() => onOpen(`/applications/${applicationId}`)}>
              Open application in GetCareer <ExternalLink className="size-3" aria-hidden />
              <span className="sr-only">(opens a new tab)</span>
            </Button>
          )}
          {ready && (
            <Button variant="link" className="text-xs" onClick={flow.regenerate}>
              Create a new version
            </Button>
          )}
        </p>
      )}
    </section>
  );
}
