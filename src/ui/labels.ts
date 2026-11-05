/** Wording shared with the web app (apps/web/features/applications/status.ts, lib/labels.ts). */
import type { ApplicationStatus } from "../shared/api-types";

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  interested: "Interested",
  to_apply: "To apply",
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  technical_interview: "Technical interview",
  final_interview: "Final interview",
  offer: "Offer",
  rejected: "Rejected",
  ghosted: "Ghosted",
  withdrawn: "Withdrawn",
};

/** Dot colour per stage; the label is always shown next to it. Interviews carry saffron. */
export const STATUS_DOT: Record<ApplicationStatus, string> = {
  interested: "bg-muted-foreground",
  to_apply: "bg-muted-foreground",
  applied: "bg-brand",
  screening: "bg-brand",
  interview: "bg-brand-node",
  technical_interview: "bg-brand-node",
  final_interview: "bg-brand-node",
  offer: "bg-success",
  rejected: "bg-destructive",
  ghosted: "bg-warning",
  withdrawn: "bg-muted-foreground",
};

export const REMOTE: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
export const EMPLOYMENT: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
};
export const SENIORITY: Record<string, string> = {
  intern: "Intern",
  junior: "Junior",
  mid: "Mid-level",
  senior: "Senior",
  lead: "Lead",
  manager: "Manager",
  head: "Head of",
  director: "Director",
  vp: "VP",
  c_level: "C-level",
};
export const CATEGORY_LABEL: Record<string, string> = {
  excellent: "Excellent",
  strong: "Strong",
  good: "Good",
  moderate: "Moderate",
  low: "Low",
};

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (Date.parse(iso) - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}

export const REASON_LABEL: Record<string, string> = {
  same_link: "same link",
  same_posting: "same posting",
  same_role: "same company and title",
};
