/**
 * GetCareer AutoFill: the shapes passed between its parts.
 *
 *   page (autofill.js)                 service worker                    side panel
 *   detector: DOM → FieldDescriptor ─▶ classifier → mapper → confidence ─▶ review (user edits,
 *   executor: FillItem → DOM      ◀─── planner: AutofillPlan             ◀─ picks, confirms)
 *
 * Detection never decides what a field means, and filling never decides what to write: the
 * same descriptor can be classified and tested without a page, and the executor only writes
 * the values the user reviewed.
 */

/** What GetCareer knows a form field to ask for. */
export type FieldKey =
  // Personal
  | "first_name"
  | "last_name"
  | "full_name"
  | "preferred_name"
  | "email"
  | "phone"
  | "phone_country_code"
  | "street_address"
  | "postal_code"
  | "city"
  | "country"
  | "location"
  // Professional
  | "current_title"
  | "current_company"
  | "headline"
  | "years_of_experience"
  | "summary"
  | "industry"
  | "seniority"
  | "management_experience"
  | "leadership_experience"
  // Employment history (one set of fields per role; see PlanItem.entry)
  | "work_company"
  | "work_title"
  | "work_location"
  | "work_start"
  | "work_end"
  | "work_current"
  | "work_description"
  // Education (one set of fields per school)
  | "edu_school"
  | "edu_degree"
  | "edu_field"
  | "edu_start"
  | "edu_end"
  // Skills and qualifications
  | "skills"
  | "languages"
  | "certifications"
  // Job preferences (the primary career direction): only ever suggested
  | "preferred_location"
  | "remote_preference"
  | "employment_type"
  // Links
  | "linkedin_url"
  | "github_url"
  | "portfolio_url"
  | "website_url"
  // Recognised, but always left to the user (sensitive, legal, preferences, consent)
  | "date_of_birth"
  | "nationality"
  | "citizenship"
  | "gender"
  | "salutation"
  | "work_authorization"
  | "visa_sponsorship"
  | "disability"
  | "veteran_status"
  | "ethnicity"
  | "criminal_record"
  | "salary_expectation"
  | "current_salary"
  | "relocation"
  | "notice_period"
  | "availability_date"
  | "consent"
  | "referral_source"
  | "open_question"
  // Documents: attached only when the user picks one in the review
  | "resume"
  | "cover_letter"
  | "other_document";

export type FieldCategory = "personal" | "professional" | "links" | "history" | "sensitive" | "preferences" | "consent" | "questions" | "documents";

/** The categories a user can switch on or off for filling. */
export const FILLABLE_CATEGORIES = ["personal", "professional", "links", "history", "preferences"] as const;
export type FillableCategory = (typeof FILLABLE_CATEGORIES)[number];

/**
 * "checkboxes": several checkboxes sharing one name, answered together (like radios).
 * "custom": a widget that opens a list (a combobox, a "Select one" button); AutoFill picks
 * from its list like the user would, never types a value into it.
 */
export type ControlKind = "text" | "email" | "tel" | "url" | "number" | "date" | "textarea" | "select" | "radio" | "checkbox" | "checkboxes" | "file" | "custom";

export type FieldOption = { index: number; value: string; label: string };

/** Text describing a control, by where it came from. Nothing here is the field's value. */
export type FieldSignals = {
  label?: string;
  aria?: string;
  placeholder?: string;
  title?: string;
  name?: string;
  id?: string;
  dataId?: string;
  autocomplete?: string;
  /** Text around the control when no label is associated (e.g. a div "label"). */
  context?: string;
  /** Helper text (aria-describedby). */
  description?: string;
  /** The nearest heading or fieldset legend above the control. */
  section?: string;
};

export type FieldDescriptor = {
  /** Stable for the life of the page: the same element keeps its id across scans. */
  id: string;
  kind: ControlKind;
  /** Form (or page) the control belongs to; see FormGroup. */
  group: string;
  /** Best human-readable label, for the review list. */
  label: string;
  signals: FieldSignals;
  options: FieldOption[];
  required: boolean;
  multiple: boolean;
  maxLength: number | null;
  /** Whether the control holds something already. The value itself is never read out. */
  hasValue: boolean;
  /** "yes": still holds what GetCareer wrote; "edited": the user changed it since. */
  filledByGetCareer: "no" | "yes" | "edited";
  /** The input's own type for date-like controls ("date", "month"). */
  inputType?: string;
  /** What a file input accepts (".pdf,.docx"). */
  accept?: string;
};

export type FormGroup = {
  id: string;
  controlCount: number;
  hasPassword: boolean;
  isSearch: boolean;
};

/** One frame's reading of the page. */
export type ScanResult = {
  frameUrl: string;
  lang: string | null;
  groups: FormGroup[];
  fields: FieldDescriptor[];
  truncated: boolean;
  /** The applicant tracking system the frame belongs to (by host or embed marker). */
  ats?: AtsId | null;
};

export type FrameScan = { frameId: number; result: ScanResult };

export type Level = "high" | "medium" | "low" | "none";

export type Classification = {
  key: FieldKey | null;
  score: number;
  level: Level;
  /** Which signal decided it (label, autocomplete, name…), for tests and diagnostics. */
  source: string | null;
  /** The field is about someone else (a reference, an emergency contact, a referrer). */
  otherPerson: boolean;
  /** Another meaning scored almost as high. */
  ambiguous: boolean;
};

/** The Career Profile as application-form values (GET /extension/autofill-profile). */
export type ProfileValue = { value: string | number | boolean; basis: "explicit" | "derived" };
export type ProfileExperience = {
  company: string;
  title: string;
  location: string | null;
  /** YYYY-MM */
  start: string | null;
  /** YYYY-MM; null while current. */
  end: string | null;
  current: boolean;
  description: string | null;
  achievements: string[];
};
export type ProfileEducation = {
  institution: string;
  degree: string | null;
  field_of_study: string | null;
  start_year: number | null;
  graduation_year: number | null;
};
export type ProfilePreferences = {
  willing_to_relocate: boolean;
  remote: string[];
  employment_types: string[];
  preferred_locations: string[];
  salary_min: number | null;
  salary_target: number | null;
  salary_currency: string;
};
/** An answer the user chose to reuse: for every field asking for `field_key`, or for one question. */
export type SavedAnswer = { id: string; field_key: string | null; question: string; answer: string; updated_at: string };
export type AutofillProfile = {
  profile_version: number;
  updated_at: string;
  language: string;
  values: Partial<Record<string, ProfileValue>>;
  // Phase 2 and 3 (absent from older servers): newest first.
  experiences?: ProfileExperience[];
  education?: ProfileEducation[];
  skills?: string[];
  languages?: { language: string; proficiency: string | null; cefr: string | null }[];
  certifications?: { name: string; issuer: string | null; year: number | null }[];
  preferences?: ProfilePreferences | null;
  saved_answers?: SavedAnswer[];
};

/** A CV or cover letter GetCareer can attach (POST /extension/autofill/documents). */
export type DocumentRef = {
  /** "resume:<id>" (an uploaded CV) or "generated:<id>" (prepared in GetCareer). */
  ref: string;
  kind: "cv" | "cover_letter";
  name: string;
  formats: ("pdf" | "docx")[];
  size: number | null;
  updated_at: string;
  recommended: boolean;
  note: string | null;
};
export type ApplicationRef = { application_id: string; company_name: string; position_title: string };
export type DocumentsOut = { application: ApplicationRef | null; documents: DocumentRef[] };

/**
 * What to write into one control. "options": the options to select in a multi-select or a
 * group of checkboxes. "choose": the entries to pick from a widget's list, by their text.
 * "file": a document from GetCareer (fetched by the service worker only when filling).
 */
export type FillValue =
  | { kind: "text"; text: string }
  | { kind: "option"; index: number }
  | { kind: "check"; checked: boolean }
  | { kind: "options"; indexes: number[] }
  /** Each pick: the texts the wanted entry may show (its name in English, in German…). */
  | { kind: "choose"; picks: string[][] }
  | { kind: "file"; ref: string; format: "pdf" | "docx"; name: string };

/** A file as it reaches the page: only for the file inputs the user picked it for. */
export type PageFile = { name: string; mime: string; base64: string };

export type Confidence = "high" | "medium" | "low";

/**
 * fill: ready, selected for filling. confirm: a suggestion the user ticks first. ask: the
 * user answers it (sensitive, missing, unrecognised, unsupported). keep: the page already
 * has a value. skip: not the applicant's data. excluded: switched off in settings.
 */
export type PlanAction = "fill" | "confirm" | "ask" | "keep" | "skip" | "excluded";

export type PlanReason =
  | "sensitive"
  | "preference"
  | "consent"
  | "question"
  | "document"
  | "missing_in_profile"
  | "not_recognised"
  | "has_value"
  | "user_edited"
  | "already_filled"
  | "low_confidence"
  | "other_person"
  | "too_long"
  | "no_matching_option"
  | "unsupported_control"
  | "derived_value"
  | "ambiguous_label"
  | "repeated_field"
  | "excluded_field"
  | "excluded_category"
  | "history_entry"
  | "current_role"
  | "date_assumed"
  | "saved_answer"
  | "preference_value"
  | "salary_target"
  | "document_choice"
  | "replace_file"
  | "list_choice";

export type PlanItem = {
  frameId: number;
  frameOrigin: string;
  fieldId: string;
  kind: ControlKind;
  label: string;
  required: boolean;
  key: FieldKey | null;
  category: FieldCategory | null;
  confidence: Confidence;
  action: PlanAction;
  reasons: PlanReason[];
  /** The proposed value (null when GetCareer proposes nothing). */
  value: FillValue | null;
  /** The proposed value in words, for the review list. */
  display: string | null;
  options: FieldOption[];
  maxLength: number | null;
  /** Which role or school of the profile (0 = most recent), for history fields. */
  entry: number | null;
  /** The field's question, for saved and suggested answers (its label). */
  question: string;
  /** The user may type or choose an answer for it in the review. */
  answerable: boolean;
  /** GetCareer can draft an answer to it (an open question; AI, with consent). */
  draftable: boolean;
  /** For file inputs: what the field asks for and accepts. */
  document: { kind: "cv" | "cover_letter"; accept: string | null } | null;
};

export type PlanCounts = { detected: number; ready: number; confirm: number; input: number; keep: number; excluded: number; filled: number };

export type AutofillPlan = {
  pageUrl: string;
  scannedAt: number;
  isApplicationForm: boolean;
  items: PlanItem[];
  counts: PlanCounts;
  profileVersion: number;
  /** Profile keys AutoFill could use but the Career Profile doesn't have (for "add them"). */
  missingProfileKeys: FieldKey[];
  /** The applicant tracking system the form belongs to, when known. */
  ats: { id: AtsId; name: string } | null;
  /** The page's language ("de", "en"…), for suggested answers. */
  lang: string | null;
  /** Documents GetCareer can attach, and the tracked application they were prepared for. */
  documents: DocumentRef[];
  application: ApplicationRef | null;
  /** Roles and schools in the profile beyond the entries the form shows now. */
  more: { experiences: number; education: number };
};

export type AtsId =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "smartrecruiters"
  | "personio"
  | "recruitee"
  | "workable"
  | "teamtailor"
  | "icims"
  | "successfactors";

export type FieldRef = { frameId: number; fieldId: string };

/** One reviewed value to write. `overwrite` replaces something already on the page. */
export type FillItem = FieldRef & { frameOrigin: string; value: FillValue; overwrite: boolean };

export type FillStatus = "filled" | "has_value" | "user_edited" | "not_found" | "no_option" | "too_long" | "wrong_page" | "wrong_file_type" | "file_unavailable" | "failed";
export type FieldOutcome = FieldRef & { status: FillStatus };
export type FillReport = { results: FieldOutcome[]; filled: number };

/** "manual": a list widget AutoFill can't put back; the user changes it if they want. */
export type UndoStatus = "restored" | "kept_user_edit" | "not_found" | "manual";
export type UndoReport = { results: (FieldRef & { status: UndoStatus })[]; restored: number; kept: number };

export type AnswerLength = "short" | "medium" | "long";
export type AnswerTone = "professional" | "concise" | "warm" | "executive";

/** Settings → AutoFill (stored with the other settings, see shared/settings.ts). */
export type AutofillSettings = {
  enabled: boolean;
  categories: Record<FillableCategory, boolean>;
  excluded: FieldKey[];
  /** Keep an AutoFill history in GetCareer (site, job, field counts, documents; no values). */
  history: boolean;
  /** Suggested answers: language ("auto": the page's), length and tone. */
  answers: { language: "auto" | "en" | "de"; length: AnswerLength; tone: AnswerTone };
  /** The uploaded CV to suggest when GetCareer prepared none for the job ("resume:<id>"). */
  defaultCv: string | null;
};

// ---- Suggested answers, history (GetCareer API) --------------------------------------------

export type AnswerQuestion = { id: string; text: string; max_length: number | null };
export type AnswerOut = {
  /** "frameId:fieldId" */
  id: string;
  status: "drafted" | "needs_input" | "declined";
  answer: string | null;
  missing: string | null;
  /** Claims GetCareer couldn't find in the profile (numbers, skills), or a length problem. */
  issues: string[];
};
export type AnswersOut = { context: "application" | "page" | "title_only"; answers: AnswerOut[] };

export type HistoryEntry = {
  id: string;
  created_at: string;
  site: string;
  ats: string | null;
  company: string | null;
  job_title: string | null;
  application_id: string | null;
  fields_filled: number;
  fields_confirmed: number;
  fields_asked: number;
  documents: string[];
};

/** Counts from the review, for the history and usage statistics (never values). */
export type FillStats = { confirmed: number; asked: number; ats: AtsId | null };
