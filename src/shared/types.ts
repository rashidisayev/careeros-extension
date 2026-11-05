import type { ImportOut, LookupOut, UserOut, Bootstrap } from "./api-types";
import type { RestrictedPlatform } from "./policy";

/** Where a locally detected value came from, in the API's vocabulary (shown as tags). */
export type Basis = "explicit" | "inferred";
export type Confidence = "high" | "medium" | "low";
export type LocalSource = "structured_data" | "page" | "meta";

export type LocalField = { value: string; basis: Basis; source: LocalSource; confidence: Confidence };

export const PREVIEW_FIELDS = [
  "title",
  "company_name",
  "location",
  "employment_type",
  "remote_policy",
  "salary",
  "date_posted",
  "deadline",
] as const;
export type PreviewField = (typeof PREVIEW_FIELDS)[number];
export type LocalFields = Partial<Record<PreviewField, LocalField>>;

/** Mirrors the API's PageCapture (apps/api/app/job_imports/schemas.py). */
export type PageCapture = {
  url: string;
  canonical_url: string | null;
  document_title: string | null;
  meta: Record<string, string>;
  json_ld: Record<string, unknown>[];
  page_fields: Record<string, { value: string; basis: Basis }>;
  description_text: string | null;
  adapter: string;
  extension_version: string;
};

export type DetectionConfidence = "high" | "medium" | "low" | "none";

/** What the extractor returns from a page (structured-clone safe). */
export type Extraction = {
  url: string;
  adapter: string;
  confidence: DetectionConfidence;
  signals: string[];
  fields: LocalFields;
  capture: PageCapture;
};

export type ErrorInfo = {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
  requestId?: string | null;
};

/** One tab as the extension sees it, cached in chrome.storage.session per tab. */
export type TabState = {
  tabId: number;
  url: string | null;
  kind: "job" | "maybe_job" | "not_job" | "restricted" | "careeros" | "unsupported" | "no_access";
  restricted: RestrictedPlatform | null;
  extraction: Extraction | null;
  lookup: LookupOut | null;
  lookupError: ErrorInfo | null;
  /** A save started from the context menu that failed; shown in the side panel. */
  actionError: ErrorInfo | null;
  importId: string | null;
  checkedAt: number;
};

export type SessionInfo =
  | { connected: false; reason?: "expired" | "signed_out" | "never" }
  | {
      connected: true;
      user: UserOut;
      bootstrap: Bootstrap | null;
      bootstrapError: ErrorInfo | null;
      updateRequired: boolean;
    };

export type { ImportOut };
