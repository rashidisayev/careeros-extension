/**
 * ATS adapters: what AutoFill knows about the applicant tracking systems most career sites
 * use. Each one says where its forms live (hosts, or a marker element when the form is
 * embedded on the company's own site) and which field names it uses for what.
 *
 * Adapters only add evidence: a field name an ATS documents for "first name" counts like a
 * clear label. Everything else (labels, sections, the confidence rules, never filling
 * sensitive fields) works the same on every site, so an adapter can't make AutoFill fill
 * something it otherwise wouldn't. On a known ATS, a step of a multi-step form counts as part
 * of the application even when it doesn't ask for the applicant's name again.
 *
 * Field names come from the vendors' public application forms. They are checked against the
 * fixtures in test/fixtures/forms; live sites are never used in tests.
 */
import type { AtsId, FieldKey } from "./types";

export type AtsAdapter = {
  id: AtsId;
  name: string;
  /** Hosts serving its application forms. */
  hosts: RegExp;
  /** An element that marks a form embedded on another site. */
  marker?: string;
  /** Field name, id or automation id → what the field is (tested in order, case-insensitive). */
  fields: [RegExp, FieldKey][];
};

const ADAPTERS: AtsAdapter[] = [
  {
    id: "greenhouse",
    name: "Greenhouse",
    hosts: /(^|\.)greenhouse\.io$/,
    marker: "#grnhse_app, #grnhse_iframe, iframe[src*='greenhouse.io/embed']",
    fields: [
      [/^(job_application\[)?first_name\]?$/i, "first_name"],
      [/^(job_application\[)?last_name\]?$/i, "last_name"],
      [/^(job_application\[)?preferred_name\]?$/i, "preferred_name"],
      [/^(job_application\[)?email\]?$/i, "email"],
      [/^(job_application\[)?phone\]?$/i, "phone"],
      [/^(candidate-location|job_application\[location\])$/i, "location"],
      [/^(job_application\[)?resume(_text)?\]?$/i, "resume"],
      [/^(job_application\[)?cover_letter(_text)?\]?$/i, "cover_letter"],
      [/^school(_name_id)?--\d+$|\[school_name_id\]$/i, "edu_school"],
      [/^degree(_id)?--\d+$|\[degree_id\]$/i, "edu_degree"],
      [/^discipline(_id)?--\d+$|\[discipline_id\]$/i, "edu_field"],
      [/^start-(month|year)--\d+$|educations?\]?\[\]?\[start_date\]/i, "edu_start"],
      [/^end-(month|year)--\d+$|educations?\]?\[\]?\[end_date\]/i, "edu_end"],
      [/^company-name--\d+$/i, "work_company"],
      [/^title--\d+$/i, "work_title"],
      [/^start-date-(month|year)--\d+$/i, "work_start"],
      [/^end-date-(month|year)--\d+$/i, "work_end"],
      [/^current-role--\d+$/i, "work_current"],
    ],
  },
  {
    id: "lever",
    name: "Lever",
    hosts: /(^|\.)lever\.co$/,
    fields: [
      [/^name$/i, "full_name"],
      [/^email$/i, "email"],
      [/^phone$/i, "phone"],
      [/^location$/i, "location"],
      [/^org$/i, "current_company"],
      [/^urls\[linkedin\]$/i, "linkedin_url"],
      [/^urls\[github\]$/i, "github_url"],
      [/^urls\[portfolio\]$/i, "portfolio_url"],
      [/^urls\[other\]$/i, "website_url"],
      [/^resume$/i, "resume"],
      [/^eeo\[gender\]$/i, "gender"],
      [/^eeo\[race\]$/i, "ethnicity"],
      [/^eeo\[veteran\]$/i, "veteran_status"],
      [/^eeo\[disability/i, "disability"],
    ],
  },
  {
    id: "ashby",
    name: "Ashby",
    hosts: /(^|\.)ashbyhq\.com$/,
    marker: "#ashby_embed, iframe[src*='ashbyhq.com']",
    fields: [
      [/^_systemfield_name$/i, "full_name"],
      [/^_systemfield_email$/i, "email"],
      [/^_systemfield_phone$/i, "phone"],
      [/^_systemfield_location$/i, "location"],
      [/^_systemfield_resume$/i, "resume"],
      [/^_systemfield_linkedin/i, "linkedin_url"],
    ],
  },
  {
    id: "workday",
    name: "Workday",
    hosts: /(^|\.)(myworkdayjobs\.com|myworkdaysite\.com|myworkday\.com)$/,
    fields: [
      // Current forms (ids) and older ones (data-automation-id).
      [/legalName--firstName$|^legalNameSection_firstName$/i, "first_name"],
      [/legalName--lastName$|^legalNameSection_lastName$/i, "last_name"],
      [/preferredName--firstName$/i, "preferred_name"],
      [/address--addressLine1$|^addressSection_addressLine1$/i, "street_address"],
      [/address--city$|^addressSection_city$/i, "city"],
      [/address--postalCode$|^addressSection_postalCode$/i, "postal_code"],
      [/^country--country$|^countryDropdown$/i, "country"],
      [/phoneNumber--phoneNumber$|^phone-number$/i, "phone"],
      [/phoneNumber--countryPhoneCode$|^countryPhoneCode$/i, "phone_country_code"],
      [/^emailAddress--emailAddress$|^email$/i, "email"],
      [/^source--source$|^sourceDropdown$/i, "referral_source"],
      [/workExperience-\d+--jobTitle$|^jobTitle$/i, "work_title"],
      [/workExperience-\d+--companyName$|^company$/i, "work_company"],
      [/workExperience-\d+--location$/i, "work_location"],
      [/workExperience-\d+--currentlyWorkHere$|^currentlyWorkHere$/i, "work_current"],
      [/workExperience-\d+--startDate/i, "work_start"],
      [/workExperience-\d+--endDate/i, "work_end"],
      [/workExperience-\d+--roleDescription$/i, "work_description"],
      [/education-\d+--school(Name)?$|^school$/i, "edu_school"],
      [/education-\d+--degree$|^degree$/i, "edu_degree"],
      [/education-\d+--fieldOfStudy$|^fieldOfStudy$/i, "edu_field"],
      [/education-\d+--firstYearAttended/i, "edu_start"],
      [/education-\d+--lastYearAttended/i, "edu_end"],
      [/^skills--skills$/i, "skills"],
      [/linkedInAccount|linkedinQuestion/i, "linkedin_url"],
      [/resumeAttachments|^file-upload-input-ref$/i, "resume"],
    ],
  },
  {
    id: "smartrecruiters",
    name: "SmartRecruiters",
    hosts: /(^|\.)smartrecruiters\.com$/,
    fields: [
      [/^first-name-input$/i, "first_name"],
      [/^last-name-input$/i, "last_name"],
      [/^(confirm-)?email-input$/i, "email"],
      [/^phone-number-input$/i, "phone"],
      [/^location-input$/i, "location"],
      [/^linkedin-input$/i, "linkedin_url"],
    ],
  },
  {
    id: "personio",
    name: "Personio",
    hosts: /(^|\.)jobs\.personio\.(de|com)$/,
    fields: [
      [/^first_?name$/i, "first_name"],
      [/^last_?name$/i, "last_name"],
      [/^email$/i, "email"],
      [/^phone$/i, "phone"],
      [/^available_from$/i, "availability_date"],
      [/^salary_expectations?$/i, "salary_expectation"],
      [/^birthday$/i, "date_of_birth"],
      [/^gender$/i, "gender"],
      [/^(cv|documents?\[cv\])$/i, "resume"],
    ],
  },
  {
    id: "recruitee",
    name: "Recruitee",
    hosts: /(^|\.)recruitee\.com$/,
    fields: [
      [/^candidate\[name\]$/i, "full_name"],
      [/^candidate\[email\]$/i, "email"],
      [/^candidate\[phone\]$/i, "phone"],
      [/^candidate\[cv\]$/i, "resume"],
      [/^candidate\[cover_letter(_file)?\]$/i, "cover_letter"],
    ],
  },
  {
    id: "workable",
    name: "Workable",
    hosts: /(^|\.)workable\.com$/,
    fields: [
      [/^firstname$/i, "first_name"],
      [/^lastname$/i, "last_name"],
      [/^email$/i, "email"],
      [/^phone$/i, "phone"],
      [/^headline$/i, "headline"],
      [/^summary$/i, "summary"],
      [/^resume$/i, "resume"],
      [/^cover_letter$/i, "cover_letter"],
    ],
  },
  {
    id: "teamtailor",
    name: "Teamtailor",
    hosts: /(^|\.)teamtailor\.com$/,
    fields: [
      [/^candidate\[first_name\]$/i, "first_name"],
      [/^candidate\[last_name\]$/i, "last_name"],
      [/^candidate\[email\]$/i, "email"],
      [/^candidate\[phone\]$/i, "phone"],
      [/^candidate\[linkedin_url\]$/i, "linkedin_url"],
      [/^candidate\[(resume|cv)\]$/i, "resume"],
      [/^candidate\[cover_letter\]$/i, "cover_letter"],
    ],
  },
  {
    id: "icims",
    name: "iCIMS",
    hosts: /(^|\.)icims\.com$/,
    fields: [
      [/PersonProfileFields\.FirstName$/i, "first_name"],
      [/PersonProfileFields\.LastName$/i, "last_name"],
      [/PersonProfileFields\.Email$/i, "email"],
      [/PhoneNumber$/i, "phone"],
      [/AddressStreet1$/i, "street_address"],
      [/AddressCity$/i, "city"],
      [/AddressZip$/i, "postal_code"],
      [/AddressCountry$/i, "country"],
    ],
  },
  {
    id: "successfactors",
    name: "SAP SuccessFactors",
    hosts: /(^|\.)(successfactors\.(com|eu)|sapsf\.(com|eu))$/,
    fields: [
      [/^fbclc_fName$/i, "first_name"],
      [/^fbclc_lName$/i, "last_name"],
      [/^fbclc_email$/i, "email"],
      [/^fbclc_(cell)?phone$/i, "phone"],
      [/^fbclc_addressLine1$/i, "street_address"],
      [/^fbclc_city$/i, "city"],
      [/^fbclc_zip$/i, "postal_code"],
      [/^fbclc_country$/i, "country"],
    ],
  },
];

const BY_ID = new Map(ADAPTERS.map((a) => [a.id, a]));

export function adapter(id: AtsId | null | undefined): AtsAdapter | null {
  return (id && BY_ID.get(id)) || null;
}

export function adapterForHost(host: string): AtsAdapter | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  return ADAPTERS.find((a) => a.hosts.test(h)) ?? null;
}

/** The ATS of a page: by its host, or by a marker of an embedded form. Runs in the page. */
export function detectAts(doc: Document): AtsId | null {
  const host = doc.location?.hostname ?? "";
  const byHost = host ? adapterForHost(host) : null;
  if (byHost) return byHost.id;
  for (const a of ADAPTERS) {
    try {
      if (a.marker && doc.querySelector(a.marker)) return a.id;
    } catch {
      // An invalid selector would be a bug in the list above; never break the scan for it.
    }
  }
  return null;
}

/** What the ATS's own field name says the field is, if anything. */
export function adapterKey(a: AtsAdapter, names: (string | undefined)[]): FieldKey | null {
  for (const raw of names) {
    if (!raw) continue;
    for (const [re, key] of a.fields) if (re.test(raw)) return key;
  }
  return null;
}

export const ATS_ADAPTERS = ADAPTERS;
