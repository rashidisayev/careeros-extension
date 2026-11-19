/**
 * Job-specific resumes, shared by the service worker and the side panel: the shapes that cross
 * between them, the file name every resume carries, the checks a downloaded file must pass,
 * and the words for each state and error. GetCareer writes, stores and deletes the resumes;
 * the extension only asks for one, waits for it, and hands the file to the form or the user.
 */
import type { JobPosting } from "../extraction/posting";
import type { JobResumeOut, ResumeFormat } from "./api-types";
import type { DetectionConfidence } from "./types";

export type { JobPosting };

/** A resume version as the panel shows it. Ids and metadata only, never the file. */
export type ResumeView = {
  id: string;
  applicationId: string;
  version: number;
  status: string;
  jobTitle: string;
  company: string;
  createdAt: string;
  generatedAt: string | null;
  expiresAt: string | null;
  files: { format: ResumeFormat; filename: string; size: number }[];
  review: { notes: string[]; issues: string[]; flagged: number } | null;
  requirements: { supported: string[]; unsupported: string[]; coverage: number | null };
  error: { code: string; message: string } | null;
  deletionReason: string | null;
  /** GetCareer returned a version that already existed instead of starting one. */
  reused: boolean;
};

/** One answer of the lightweight status endpoint. */
export type ResumeProgress = {
  id: string;
  status: string;
  ready: boolean;
  /** Set while it is being written: when to ask again. */
  pollAfter: number | null;
  error: { code: string; message: string } | null;
  deletionReason: string | null;
};

export type MissingDetail = "job_title" | "company" | "job_description";

/** What the extension knows about the job before asking for a resume. */
export type ResumeDetails = {
  /** Read from the page (fields are null where the page says nothing). */
  job: JobPosting;
  /** The application GetCareer already tracks for this posting (same link or posting). */
  application: { id: string; title: string; company: string; status: string } | null;
  /** How sure the extension is that the page is this job's posting. */
  confidence: DetectionConfidence;
  /** What GetCareer needs and neither the page nor the tracked application gives. */
  missing: MissingDetail[];
  /** The user should look at the details before GetCareer writes anything. */
  confirm: boolean;
  /** A resume GetCareer already has for this job (generating or ready). */
  current: ResumeView | null;
};

/** The job as the user confirmed it in the panel: what is sent to GetCareer. */
export type ResumeInput = {
  applicationId: string | null;
  title: string | null;
  company: string | null;
  description: string | null;
  location: string | null;
  seniority: string | null;
  requirements: string[];
  language: "en" | "de";
  url: string | null;
};

export const RESUME_MIME: Record<ResumeFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Largest resume file the extension handles (GetCareer's own documents stay far below). */
export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

/**
 * "Anna_Schmidt_Resume.pdf": the name words joined by "_", the same for every job (the
 * employer sees no internal naming). The same rule as GetCareer's download_filename.
 */
export function resumeFileName(fullName: string | null | undefined, format: ResumeFormat): string {
  const words = (fullName ?? "").match(/[\p{L}\p{N}\p{M}]+(?:['-][\p{L}\p{N}\p{M}]+)*/gu) ?? [];
  const stem = words.join("_").slice(0, 80);
  return stem ? `${stem}_Resume.${format}` : `Resume.${format}`;
}

/** The name GetCareer gave the file, if it is a plain file name of this format; else ours. */
export function safeResumeName(name: string | null | undefined, format: ResumeFormat, fullName: string | null | undefined): string {
  const n = (name ?? "").trim();
  const plain = n.length > 0 && n.length <= 150 && !/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(n) && !n.startsWith(".");
  return plain && n.toLowerCase().endsWith(`.${format}`) ? n : resumeFileName(fullName, format);
}

/** Whether the bytes are a file of this format (a PDF header, a Word document's ZIP header). */
export function looksLike(bytes: Uint8Array, format: ResumeFormat): boolean {
  if (format === "pdf") return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** The API's version as the panel shows it; file names checked (`fullName`: the account's). */
export function viewOf(r: JobResumeOut, reused = false, fullName: string | null = null): ResumeView {
  const formats = new Set(["pdf", "docx"]);
  return {
    id: r.id,
    applicationId: r.application_id,
    version: r.version,
    status: r.status,
    jobTitle: r.job_title,
    company: r.company_name,
    createdAt: r.created_at,
    generatedAt: r.generated_at,
    expiresAt: r.expires_at,
    files: (r.files ?? [])
      .filter((f) => formats.has(f.format))
      .map((f) => ({ format: f.format as ResumeFormat, filename: safeResumeName(f.filename, f.format as ResumeFormat, fullName), size: f.size_bytes })),
    review: r.review ? { notes: r.review.notes ?? [], issues: r.review.issues ?? [], flagged: r.review.flagged_bullets ?? 0 } : null,
    requirements: {
      supported: r.requirements?.supported ?? [],
      unsupported: r.requirements?.unsupported ?? [],
      coverage: typeof r.requirements?.keyword_coverage === "number" ? r.requirements.keyword_coverage : null,
    },
    error: r.error,
    deletionReason: r.deletion_reason,
    reused,
  };
}

/** Statuses after which polling stops. An unknown status counts as not ready, and final. */
export const IN_FLIGHT = new Set(["pending", "generating"]);

/** The words for a failed version's error.code (docs/integrations/EXTENSION-JOB-RESUMES.md). */
export const FAILURE: Record<string, string> = {
  ai_failed: "The AI service couldn't write this resume.",
  storage_failed: "Something went wrong while creating the files.",
  generation_failed: "Something went wrong while creating the files.",
  queue_unavailable: "Something went wrong while creating the files.",
  generation_timeout: "This took too long and was stopped.",
};

export const DELETED: Record<string, string> = {
  user_deleted: "You deleted this resume in GetCareer.",
  expired: "It was deleted automatically 30 days after it was created.",
  application_rejected: "It was deleted because the application was marked rejected.",
  application_withdrawn: "It was deleted because the application was marked withdrawn.",
  application_ghosted: "It was deleted because the application was marked ghosted.",
};

/** The words for API errors of the resume endpoints, by code. */
export const RESUME_ERRORS: Record<string, string> = {
  ai_consent_required: "Turn on AI processing in GetCareer (CV & Documents) to create tailored resumes.",
  ai_unavailable: "Tailored resumes aren't available on this GetCareer server.",
  feature_unavailable: "Tailored resumes aren't available for your GetCareer account.",
  application_closed: "This application is marked rejected, withdrawn or ghosted in GetCareer. Change its status to create a resume.",
  job_details_required: "GetCareer needs the job title, the company and the job description to write a resume.",
  job_description_required: "Couldn't read the job description. Paste the posting's text and try again.",
  profile_incomplete: "Add at least one role to your Career Profile first.",
  rate_limited: "You've reached the hourly limit for AI documents (shared with Tailor CV and cover letters). Try again later.",
  generation_unavailable: "Couldn't start right now. Try again in a minute.",
  storage_unavailable: "Couldn't load the file. Try again in a moment.",
  resume_deleted: "This resume was deleted.",
  resume_expired: "This resume was deleted after 30 days.",
  resume_not_ready: "The resume isn't ready yet.",
  format_not_available: "This format isn't available for this resume.",
  not_found: "GetCareer doesn't have this resume (any more).",
  bad_file: "GetCareer sent a file the extension didn't expect, so it wasn't used.",
  invalid_session: "Your connection to GetCareer ended. Connect again to continue.",
  not_connected: "Connect the extension to your GetCareer account first.",
};
