/**
 * The parts of the GetCareer API the extension uses, typed after the backend's Pydantic
 * schemas (apps/api/app/<module>/schemas.py). Keep in step with docs/API_INTEGRATION.md.
 */

export type ApplicationStatus =
  | "interested"
  | "to_apply"
  | "applied"
  | "screening"
  | "interview"
  | "technical_interview"
  | "final_interview"
  | "offer"
  | "rejected"
  | "ghosted"
  | "withdrawn";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "interested",
  "to_apply",
  "applied",
  "screening",
  "interview",
  "technical_interview",
  "final_interview",
  "offer",
  "rejected",
  "ghosted",
  "withdrawn",
];

export type UserOut = {
  id: string;
  email: string;
  full_name: string;
  preferred_language: string;
  timezone: string;
  subscription_plan: string;
};

export type ExtensionTokens = {
  user: UserOut;
  session_id: string;
  access_token: string;
  access_token_expires_at: string;
  refresh_token: string;
  refresh_token_expires_at: string;
};

export type FeatureAccess = { enabled: boolean; reason: string | null };

export type Bootstrap = {
  api_version: number;
  min_extension_version: string;
  app_url: string;
  user: UserOut;
  capabilities: {
    ai_available: boolean;
    ai_consent: boolean;
    has_career_direction: boolean;
    primary_direction: { id: string; name: string } | null;
  };
  features: Record<string, FeatureAccess>;
  entitlements: { plan: string; source: string };
  restricted_platforms: { key: string; name: string }[];
};

export type LookupMatch = {
  score: number;
  category: string;
  eligibility: string;
  exclusion_reasons: string[];
  direction_id: string;
  direction_name: string;
};

export type TrackedApplication = {
  application_id: string;
  company_name: string;
  position_title: string;
  location: string | null;
  status: ApplicationStatus;
  match_score: number | null;
  created_at: string;
  updated_at: string;
  reasons: ("same_link" | "same_posting" | "same_role")[];
  app_url: string;
};

export type LookupOut = {
  url: {
    canonical_url: string;
    platform: string;
    platform_name: string;
    posting_id: string | null;
    restricted: boolean;
  };
  applications: TrackedApplication[];
  job: {
    job_id: string;
    title: string;
    company_name: string;
    location: string | null;
    match: LookupMatch | null;
    app_url: string;
  } | null;
  pending_import: { import_id: string; status: ImportStatus; updated_at: string } | null;
};

export type ImportStatus =
  | "queued"
  | "retrieving"
  | "extracting"
  | "matching"
  | "ready"
  | "needs_text"
  | "failed"
  | "saved";

export const RUNNING_IMPORT: ImportStatus[] = ["queued", "retrieving", "extracting", "matching"];

export type ImportField = {
  value: unknown;
  basis: "explicit" | "inferred";
  source: string;
  confidence: "high" | "medium" | "low";
  quote: string | null;
};

export type MatchDimension = {
  score: number | null;
  status: "match" | "partial" | "mismatch" | "unknown";
  detail: string;
  weight: number;
  confidence?: number | string | null;
};

export type MatchPreview = {
  direction_id: string;
  direction_name: string;
  total_score: number;
  category: string;
  coverage: number;
  breakdown: Record<string, MatchDimension>;
  matched: { type: string; name: string; evidence?: string }[];
  missing: { type: string; name: string }[];
  unknown: { type: string; name: string }[];
  concerns: string[];
  positives: string[];
  explanation: string;
  eligibility: string;
  exclusion_reasons: string[];
  unknown_attributes: string[];
};

export type ImportDuplicate = {
  application_id: string;
  company_name: string;
  position_title: string;
  location: string | null;
  status: ApplicationStatus;
  created_at: string;
  reasons: string[];
};

export type ImportOut = {
  id: string;
  status: ImportStatus;
  method: string | null;
  platform: string | null;
  platform_name: string | null;
  source_url: string | null;
  canonical_url: string | null;
  posting_id: string | null;
  error_code: string | null;
  error_message: string | null;
  fields: Record<string, ImportField>;
  lists: Record<string, ImportField>;
  description: string | null;
  warnings: string[];
  match: MatchPreview | null;
  duplicates: ImportDuplicate[];
  ai_used: boolean;
  attempts: number;
  has_pasted_text: boolean;
  application_id: string | null;
  created_at: string;
  updated_at: string;
};

export type RemotePolicy = "remote" | "hybrid" | "onsite";
export type EmploymentType = "full_time" | "part_time" | "contract" | "internship";
export type Seniority =
  | "intern"
  | "junior"
  | "mid"
  | "senior"
  | "lead"
  | "manager"
  | "head"
  | "director"
  | "vp"
  | "c_level";
export type SalaryPeriod = "year" | "month" | "hour";

/** POST /job-imports/{id}/save: the reviewed fields (ImportSave). */
export type ImportSave = {
  title: string;
  company_name: string;
  company_website?: string | null;
  department?: string | null;
  location?: string | null;
  city?: string | null;
  country?: string | null;
  remote_policy?: RemotePolicy | null;
  employment_type?: EmploymentType | null;
  seniority?: Seniority | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_period?: SalaryPeriod | null;
  deadline?: string | null;
  description?: string | null;
  job_url?: string | null;
  recruiter_name?: string | null;
  recruiter_email?: string | null;
  status: ApplicationStatus;
  applied_at?: string | null;
  notes?: string | null;
  allow_duplicate?: boolean;
};

export type ApplicationDetail = {
  id: string;
  job_id: string | null;
  company_name: string;
  position_title: string;
  location: string | null;
  job_url: string | null;
  match_score: number | null;
  status: ApplicationStatus;
  applied_at: string | null;
  next_followup_at: string | null;
  created_at: string;
  updated_at: string;
};

/** The backend's error envelope: {"error": {...}}. */
export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown; request_id?: string | null };
};
