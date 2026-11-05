/**
 * Is this page a single job posting? Local signals only (no network, no AI), scored into a
 * confidence the UI shows: high/medium = "Job detected", low = "This might be a job",
 * none = not a job page. Nothing is sent anywhere because of a detection.
 */
import type { DetectionConfidence } from "../shared/types";

export type Signals = {
  structured: number; // JobPosting nodes found (JSON-LD or microdata)
  adapterTitle: boolean; // a site adapter found the posting's title
  title: boolean; // some title candidate exists
  jobPath: boolean;
  applyControl: boolean;
  sections: number; // distinct job-section headings ("Requirements", "Ihr Profil", ...)
  ogJob: boolean;
};

const JOB_PATH = /\/(jobs?|careers?|karriere|stellen(angebote)?|positions?|openings?|vacanc(y|ies)|job-?offers?|requisitions?|postings?|o)\/[^/]+/i;
const APPLY = /^\s*(apply|apply now|apply for this job|easy apply|submit application|jetzt bewerben|bewerben|online bewerben|postuler|candidatar|solliciteer)\b/i;
const SECTIONS: RegExp[] = [
  /responsibilit|what you('|’)?ll do|your (role|tasks|mission)|the role|about the (role|job|position)|deine aufgaben|ihre aufgaben|aufgaben/i,
  /requirements|qualifications|what (you|we('|’)re looking for)|who you are|your profile|must have|ihr profil|dein profil|anforderungen|was du mitbringst|was sie mitbringen/i,
  /benefits|what we offer|perks|why join|wir bieten|was wir bieten|unser angebot/i,
  /nice to have|bonus points|preferred|wünschenswert/i,
  /how to apply|application process|hiring process|bewerbungsprozess/i,
];

export function pageSignals(doc: Document, url: URL): Omit<Signals, "structured" | "adapterTitle" | "title"> {
  const headings = Array.from(doc.querySelectorAll("h1, h2, h3, h4, strong, b, dt, [role='heading']"))
    .slice(0, 300)
    .map((h) => (h.textContent ?? "").trim())
    .filter((t) => t.length > 0 && t.length < 80);
  const sections = SECTIONS.filter((re) => headings.some((h) => re.test(h))).length;
  const applyControl = Array.from(doc.querySelectorAll("a, button, [role='button'], input[type='submit']"))
    .slice(0, 500)
    .some((el) => APPLY.test((el.textContent || el.getAttribute("value") || el.getAttribute("aria-label") || "").slice(0, 60)));
  const ogType = doc.querySelector('meta[property="og:type"]')?.getAttribute("content") ?? "";
  return {
    jobPath: JOB_PATH.test(url.pathname),
    applyControl,
    sections,
    ogJob: /job/i.test(ogType),
  };
}

export function scoreSignals(s: Signals): { confidence: DetectionConfidence; signals: string[] } {
  const signals: string[] = [];
  if (s.structured === 1) signals.push("structured_data");
  if (s.structured > 1) signals.push("multiple_postings");
  if (s.adapterTitle) signals.push("site_adapter");
  if (s.jobPath) signals.push("job_url");
  if (s.applyControl) signals.push("apply_button");
  if (s.sections) signals.push(`job_sections:${s.sections}`);
  if (s.ogJob) signals.push("og_job");

  let confidence: DetectionConfidence = "none";
  if (s.structured === 1) confidence = "high";
  else if (s.adapterTitle && (s.sections >= 1 || s.applyControl || s.jobPath)) confidence = "high";
  else if (s.structured > 1) confidence = "low"; // a list of jobs, not one posting
  else if (s.adapterTitle) confidence = "medium";
  else {
    const points = (s.jobPath ? 1 : 0) + (s.applyControl ? 1 : 0) + (s.ogJob ? 1 : 0) + Math.min(s.sections, 3);
    if (s.title && points >= 4) confidence = "medium";
    else if (s.title && points >= 2) confidence = "low";
  }
  return { confidence, signals };
}
