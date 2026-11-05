/**
 * The field catalog: what each FieldKey is, whether AutoFill may ever write it, and which
 * controls can hold it. Sensitive and legally relevant facts are recognised (so the review
 * can say why they are left to the user) but have no `fill` entry: they are never filled,
 * whatever the profile or the page holds.
 */
import type { ControlKind, FieldCategory, FieldKey, FillableCategory, PlanReason } from "./types";

type Spec = {
  category: FieldCategory;
  label: string;
  /** Filled from the profile (subject to confidence and settings). Absent: always asked. */
  fill?: true;
  /** Why it is always asked, when it is. */
  ask?: PlanReason;
  /** Controls that can hold it. */
  kinds: ControlKind[];
  /** May appear more than once in one form without being suspicious (e.g. "confirm email"). */
  repeatable?: true;
  /** Only ever suggested for the user to tick, never pre-selected (job preferences). */
  suggestOnly?: true;
};

const TEXT: ControlKind[] = ["text", "textarea"];
const CHOICE: ControlKind[] = ["select", "radio"];
const ANY: ControlKind[] = ["text", "email", "tel", "url", "number", "date", "textarea", "select", "radio", "checkbox", "checkboxes", "custom"];
const DATE: ControlKind[] = ["text", "date", "select", "number", "custom"];
const LIST: ControlKind[] = ["text", "textarea", "select", "checkboxes", "custom"];

export const KEYS: Record<FieldKey, Spec> = {
  first_name: { category: "personal", label: "First name", fill: true, kinds: ["text"] },
  last_name: { category: "personal", label: "Last name", fill: true, kinds: ["text"] },
  full_name: { category: "personal", label: "Full name", fill: true, kinds: ["text"] },
  preferred_name: { category: "personal", label: "Preferred name", fill: true, kinds: ["text"] },
  email: { category: "personal", label: "Email", fill: true, kinds: ["text", "email"], repeatable: true },
  phone: { category: "personal", label: "Phone", fill: true, kinds: ["text", "tel", "number"] },
  phone_country_code: { category: "personal", label: "Phone country code", fill: true, kinds: ["text", "tel", "select", "custom"] },
  street_address: { category: "personal", label: "Street address", fill: true, kinds: TEXT },
  postal_code: { category: "personal", label: "Postal code", fill: true, kinds: ["text", "number"] },
  city: { category: "personal", label: "City", fill: true, kinds: ["text", "select"] },
  country: { category: "personal", label: "Country", fill: true, kinds: ["text", "select", "custom"] },
  location: { category: "personal", label: "Location", fill: true, kinds: ["text"] },

  current_title: { category: "professional", label: "Current job title", fill: true, kinds: ["text"] },
  current_company: { category: "professional", label: "Current employer", fill: true, kinds: ["text"] },
  headline: { category: "professional", label: "Professional headline", fill: true, kinds: TEXT },
  years_of_experience: { category: "professional", label: "Years of experience", fill: true, kinds: ["text", "number", "select", "radio", "custom"] },
  summary: { category: "professional", label: "Professional summary", fill: true, kinds: ["textarea"] },
  industry: { category: "professional", label: "Industry", fill: true, kinds: ["text", "select", "custom"] },
  seniority: { category: "professional", label: "Seniority", fill: true, kinds: ["text", "select", "radio", "custom"] },
  management_experience: { category: "professional", label: "People management experience", fill: true, kinds: ["select", "radio", "checkbox"] },
  leadership_experience: { category: "professional", label: "Leadership experience", fill: true, kinds: TEXT },
  skills: { category: "professional", label: "Skills", fill: true, kinds: LIST },
  languages: { category: "professional", label: "Languages", fill: true, kinds: LIST },
  certifications: { category: "professional", label: "Certifications", fill: true, kinds: TEXT },

  work_company: { category: "history", label: "Employer", fill: true, kinds: ["text", "custom"], repeatable: true },
  work_title: { category: "history", label: "Job title", fill: true, kinds: ["text", "custom"], repeatable: true },
  work_location: { category: "history", label: "Location of the role", fill: true, kinds: ["text", "custom"], repeatable: true },
  work_start: { category: "history", label: "Start of the role", fill: true, kinds: DATE, repeatable: true },
  work_end: { category: "history", label: "End of the role", fill: true, kinds: DATE, repeatable: true },
  work_current: { category: "history", label: "Current role", fill: true, kinds: ["checkbox", "radio", "select"], repeatable: true },
  work_description: { category: "history", label: "Role description", fill: true, kinds: TEXT, repeatable: true },
  edu_school: { category: "history", label: "School or university", fill: true, kinds: ["text", "select", "custom"], repeatable: true },
  edu_degree: { category: "history", label: "Degree", fill: true, kinds: ["text", "select", "custom"], repeatable: true },
  edu_field: { category: "history", label: "Field of study", fill: true, kinds: ["text", "select", "custom"], repeatable: true },
  edu_start: { category: "history", label: "Start of studies", fill: true, kinds: DATE, repeatable: true },
  edu_end: { category: "history", label: "End of studies", fill: true, kinds: DATE, repeatable: true },

  linkedin_url: { category: "links", label: "LinkedIn", fill: true, kinds: ["text", "url"] },
  github_url: { category: "links", label: "GitHub", fill: true, kinds: ["text", "url"] },
  portfolio_url: { category: "links", label: "Portfolio", fill: true, kinds: ["text", "url"] },
  website_url: { category: "links", label: "Website", fill: true, kinds: ["text", "url"] },

  date_of_birth: { category: "sensitive", label: "Date of birth", ask: "sensitive", kinds: ANY },
  nationality: { category: "sensitive", label: "Nationality", ask: "sensitive", kinds: ANY },
  citizenship: { category: "sensitive", label: "Citizenship", ask: "sensitive", kinds: ANY },
  gender: { category: "sensitive", label: "Gender", ask: "sensitive", kinds: ANY },
  salutation: { category: "sensitive", label: "Salutation", ask: "sensitive", kinds: ANY },
  work_authorization: { category: "sensitive", label: "Work authorisation", ask: "sensitive", kinds: ANY },
  visa_sponsorship: { category: "sensitive", label: "Visa sponsorship", ask: "sensitive", kinds: ANY },
  disability: { category: "sensitive", label: "Disability", ask: "sensitive", kinds: ANY },
  veteran_status: { category: "sensitive", label: "Veteran status", ask: "sensitive", kinds: ANY },
  ethnicity: { category: "sensitive", label: "Ethnicity", ask: "sensitive", kinds: ANY },
  criminal_record: { category: "sensitive", label: "Criminal record", ask: "sensitive", kinds: ANY },
  salary_expectation: { category: "preferences", label: "Salary expectation", ask: "sensitive", kinds: ANY },
  current_salary: { category: "preferences", label: "Current salary", ask: "sensitive", kinds: ANY },
  relocation: { category: "preferences", label: "Willingness to relocate", fill: true, suggestOnly: true, kinds: ["select", "radio", "checkbox", "custom"] },
  preferred_location: { category: "preferences", label: "Preferred location", fill: true, suggestOnly: true, kinds: ["text", "select", "checkboxes", "custom"] },
  remote_preference: { category: "preferences", label: "Remote or on-site", fill: true, suggestOnly: true, kinds: ["text", "select", "radio", "checkboxes", "custom"] },
  employment_type: { category: "preferences", label: "Employment type", fill: true, suggestOnly: true, kinds: ["text", "select", "radio", "checkboxes", "custom"] },
  notice_period: { category: "preferences", label: "Notice period", ask: "preference", kinds: ANY },
  availability_date: { category: "preferences", label: "Availability", ask: "preference", kinds: ANY },
  consent: { category: "consent", label: "Consent", ask: "consent", kinds: ["checkbox", "radio", "select"] },
  referral_source: { category: "questions", label: "How you found the job", ask: "question", kinds: ANY },
  open_question: { category: "questions", label: "Application question", ask: "question", kinds: TEXT },

  resume: { category: "documents", label: "CV", ask: "document", kinds: ["file", "textarea"] },
  cover_letter: { category: "documents", label: "Cover letter", ask: "document", kinds: ["file", "textarea"] },
  other_document: { category: "documents", label: "Document", ask: "document", kinds: ["file"] },
};

export const FIELD_KEYS = Object.keys(KEYS) as FieldKey[];

/** Keys AutoFill may write, grouped by the categories users switch on or off. */
export const FILLABLE_KEYS = FIELD_KEYS.filter((k) => KEYS[k].fill);

export function isFillableCategory(c: FieldCategory): c is FillableCategory {
  return (FILLABLE_CATEGORY_SET as Set<string>).has(c);
}

const FILLABLE_CATEGORY_SET = new Set<FieldCategory>(["personal", "professional", "links", "history", "preferences"]);

/** History keys, by the part of the profile they come from. */
export const WORK_KEYS: FieldKey[] = ["work_company", "work_title", "work_location", "work_start", "work_end", "work_current", "work_description"];
export const EDU_KEYS: FieldKey[] = ["edu_school", "edu_degree", "edu_field", "edu_start", "edu_end"];

/**
 * Keys an answer can be saved for, so it is offered on every form that asks the same thing
 * (CareerOS: SavedAnswerIn.field_key). Sensitive ones too: a saved answer is the user's own.
 */
export const REUSABLE_KEYS: FieldKey[] = [
  "nationality", "citizenship", "date_of_birth", "salutation", "gender", "ethnicity", "disability", "veteran_status",
  "salary_expectation", "current_salary", "relocation", "notice_period", "availability_date", "referral_source",
  "preferred_location", "remote_preference", "employment_type",
];

export function isFieldKey(v: unknown): v is FieldKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(KEYS, v);
}

export const CHOICE_KINDS = CHOICE;
