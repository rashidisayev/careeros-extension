/**
 * Planner: turns the page's fields (from every frame) and the Career Profile into the list
 * the user reviews. Decides which forms are application forms, so search boxes, logins and
 * newsletter sign-ups on the same page are never touched. Pure.
 *
 * Beyond the profile's own values it adds, as suggestions the user ticks:
 * - answers the user saved for a question or a kind of field (never anything else for
 *   sensitive questions),
 * - the target salary of the primary career direction (only with Preferences on),
 * - the CV or cover letter to attach (the one GetCareer prepared for this job first).
 */
import { adapter, adapterForHost, type AtsAdapter } from "./adapters";
import { classify } from "./classifier";
import { decide } from "./confidence";
import { dateShape } from "./dates";
import { EDU_KEYS, FILLABLE_KEYS, KEYS, REUSABLE_KEYS, WORK_KEYS } from "./keys";
import { lexicon, type Compiled } from "./lexicon";
import { propose, type Proposal } from "./mapper";
import { norm } from "./normalize";
import type {
  AtsId,
  AutofillPlan,
  AutofillProfile,
  AutofillSettings,
  Classification,
  DocumentRef,
  DocumentsOut,
  FieldDescriptor,
  FieldKey,
  FillValue,
  FormGroup,
  FrameScan,
  PlanAction,
  PlanCounts,
  PlanItem,
  PlanReason,
} from "./types";

type Classified = { frameId: number; frameOrigin: string; lang: string | null; field: FieldDescriptor; c: Classification };

const IDENTITY: FieldKey[] = ["first_name", "last_name", "full_name", "email", "phone"];
const HISTORY = new Set<FieldKey>([...WORK_KEYS, ...EDU_KEYS]);

function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "null";
  }
}

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * An application form names at least three different things GetCareer knows (or two plus a
 * CV upload), and at least one of them identifies the applicant. A login (password, few
 * fields), a search box or a newsletter (email only) never qualifies.
 *
 * Later steps of a multi-step application don't ask for the name again: a step with an
 * employment history or education counts, and on a known ATS any step asking two things
 * GetCareer knows.
 */
export function isApplicationGroup(group: FormGroup, fields: Classified[], knownAts = false): boolean {
  if (group.isSearch) return false;
  if (group.hasPassword && group.controlCount <= 4) return false;
  const known = new Set(fields.filter((f) => f.c.key && f.c.level !== "none" && f.c.level !== "low").map((f) => f.c.key!));
  const identity = IDENTITY.some((k) => known.has(k));
  const profileKeys = [...known].filter((k) => KEYS[k].fill).length;
  const cv = known.has("resume");
  if (identity && (known.size >= 3 || (profileKeys >= 2 && cv))) return true;
  if ([...known].filter((k) => HISTORY.has(k)).length >= 2) return true;
  return knownAts && known.size >= 2;
}

// "experience[1][title]", "workExperience-2--jobTitle", "school--0", "Work Experience 2".
const ENTRY_IN_NAME = /(?:\[|--|-|_)(\d{1,2})(?:\]|--|-|_|$)/;

/** Which profile entry (0 = most recent) each history field of one form is for. */
function entries(fields: Classified[], lx: Compiled): Map<string, number> {
  const out = new Map<string, number>();
  for (const family of [WORK_KEYS, EDU_KEYS]) {
    const members = fields.filter((x) => x.c.key && family.includes(x.c.key) && !x.c.otherPerson);
    if (!members.length) continue;
    const numbered = members.map((x) => {
      const s = x.field.signals;
      const m = [s.name, s.id, s.dataId].filter(Boolean).join(" ").match(ENTRY_IN_NAME) ?? (s.section ?? "").match(/(\d{1,2})\s*$/);
      return m ? Number(m[1]) : null;
    });
    if (numbered.every((n) => n !== null)) {
      // Forms count from 0 or 1: the order is what matters.
      const ranks = [...new Set(numbered as number[])].sort((a, b) => a - b);
      members.forEach((x, i) => out.set(x.field.id, ranks.indexOf(numbered[i]!)));
      continue;
    }
    // No numbers: the second "Company" field is the second role.
    const seen = new Map<string, number>();
    for (const x of members) {
      const k = x.c.key!;
      const part = k.endsWith("_start") || k.endsWith("_end") ? dateShape(x.field, lx, family === EDU_KEYS).part : "";
      const id = `${k}:${part}`;
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      out.set(x.field.id, n);
    }
  }
  return out;
}

/** A saved answer, as a value for this control (only an exact choice for lists). */
function savedValue(answer: string, field: FieldDescriptor): { value: FillValue; display: string } | null {
  const text = answer.trim();
  if (!text) return null;
  switch (field.kind) {
    case "text":
    case "textarea":
    case "email":
    case "tel":
    case "url":
    case "date":
      if (field.maxLength && text.length > field.maxLength) return null;
      return { value: { kind: "text", text }, display: text };
    case "number":
      return /^\d+([.,]\d+)?$/.test(text) ? { value: { kind: "text", text }, display: text } : null;
    case "select":
    case "radio": {
      const n = norm(text);
      const o = field.options.find((x) => norm(x.label) === n || (x.value && norm(x.value) === n));
      return o ? { value: { kind: "option", index: o.index }, display: o.label.trim() || o.value } : null;
    }
    case "custom":
      return { value: { kind: "choose", picks: [[text]] }, display: text };
    default:
      return null;
  }
}

function savedFor(key: FieldKey | null, label: string, field: FieldDescriptor, profile: AutofillProfile) {
  const saved = profile.saved_answers ?? [];
  if (!saved.length) return null;
  const byKey = key && REUSABLE_KEYS.includes(key) ? saved.find((a) => a.field_key === key) : undefined;
  const q = norm(label);
  const byQuestion = q ? saved.find((a) => !a.field_key && norm(a.question) === q) : undefined;
  const hit = byKey ?? byQuestion;
  return hit ? savedValue(hit.answer, field) : null;
}

function salaryFor(field: FieldDescriptor, profile: AutofillProfile, lang: string | null): { value: FillValue; display: string } | null {
  const p = profile.preferences;
  const amount = p?.salary_target ?? p?.salary_min ?? null;
  if (!p || amount === null) return null;
  if (field.kind === "number") return { value: { kind: "text", text: String(amount) }, display: String(amount) };
  if (field.kind !== "text" && field.kind !== "textarea") return null;
  const text = `${amount.toLocaleString(lang?.toLowerCase().startsWith("de") ? "de-DE" : "en-US")} ${p.salary_currency}`;
  if (field.maxLength && text.length > field.maxLength) return null;
  return { value: { kind: "text", text }, display: text };
}

const ACCEPT_PDF = /(^|,)\s*(\.pdf|application\/pdf|\*\/\*|application\/\*)\s*(,|$)/i;
const ACCEPT_DOCX = /(^|,)\s*(\.docx|\.doc|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|\*\/\*|application\/\*)\s*(,|$)/i;

/** The format to attach a document in, given what the input accepts; null if none fits. */
export function formatFor(doc: DocumentRef, accept: string | null): "pdf" | "docx" | null {
  const a = (accept ?? "").trim();
  const ok = (f: "pdf" | "docx") => doc.formats.includes(f) && (!a || (f === "pdf" ? ACCEPT_PDF : ACCEPT_DOCX).test(a));
  return ok("pdf") ? "pdf" : ok("docx") ? "docx" : null;
}

export function fileName(doc: DocumentRef, format: "pdf" | "docx"): string {
  return `${doc.name.replace(/\.(pdf|docx?)$/i, "")}.${format}`;
}

/** The document to suggest for a file input: prepared for this job, the default CV, the newest. */
export function documentFor(kind: "cv" | "cover_letter", accept: string | null, documents: DocumentRef[], defaultCv: string | null): { value: FillValue; display: string } | null {
  const fits = documents.filter((d) => d.kind === kind && formatFor(d, accept));
  const pick = fits.find((d) => d.recommended) ?? (kind === "cv" ? fits.find((d) => d.ref === defaultCv) : undefined) ?? fits[0];
  if (!pick) return null;
  const format = formatFor(pick, accept)!;
  const name = fileName(pick, format);
  return { value: { kind: "file", ref: pick.ref, format, name }, display: name };
}

/** What the user may answer in the review themselves (never consent, never a file). */
function answerable(action: PlanAction, reasons: PlanReason[], kind: FieldDescriptor["kind"]): boolean {
  if (action !== "ask") return false;
  if (reasons.includes("consent") || reasons.includes("document")) return false;
  return ["text", "textarea", "email", "tel", "url", "number", "date", "select", "radio", "custom"].includes(kind);
}

export type PlanExtras = {
  now?: number;
  /** Documents GetCareer can attach for this page (null: not fetched or unavailable). */
  documents?: DocumentsOut | null;
};

export function buildPlan(
  scans: FrameScan[],
  profile: AutofillProfile,
  settings: AutofillSettings,
  pageUrl: string,
  extras: PlanExtras | number = {},
): AutofillPlan {
  const opts: PlanExtras = typeof extras === "number" ? { now: extras } : extras;
  const lx = lexicon();
  const items: PlanItem[] = [];
  const pageAts = adapterForHost(host(pageUrl));
  const documents = opts.documents?.documents ?? [];
  let planAts: AtsAdapter | null = null;
  const maxEntry = { work: -1, edu: -1, hasWork: false, hasEdu: false };

  for (const { frameId, result } of scans) {
    const frameOrigin = origin(result.frameUrl);
    const ats = adapter(result.ats) ?? adapterForHost(host(result.frameUrl)) ?? pageAts;
    const classified: Classified[] = result.fields.map((field) => ({ frameId, frameOrigin, lang: result.lang, field, c: classify(field, lx, ats) }));
    for (const group of result.groups) {
      const inGroup = classified.filter((x) => x.field.group === group.id);
      if (!isApplicationGroup(group, inGroup, !!ats)) continue;
      planAts ??= ats;
      const separateCountryCode = inGroup.some((x) => x.c.key === "phone_country_code" && x.c.level !== "low" && !x.c.otherPerson);
      const entryOf = entries(inGroup, lx);
      const seen = new Map<FieldKey, number>();
      for (const x of inGroup) {
        const { field, c } = x;
        let repeated = false;
        if (c.key && !c.otherPerson) {
          const n = (seen.get(c.key) ?? 0) + 1;
          seen.set(c.key, n);
          repeated = n > 1;
        }
        const entry = c.key && HISTORY.has(c.key) ? (entryOf.get(field.id) ?? 0) : null;
        if (entry !== null && c.key) {
          if (WORK_KEYS.includes(c.key)) maxEntry.work = Math.max(maxEntry.work, entry);
          else maxEntry.edu = Math.max(maxEntry.edu, entry);
        }
        let proposal: Proposal | null = null;
        if (c.key && KEYS[c.key].fill) proposal = propose(c.key, field, profile, { lang: x.lang, separateCountryCode, entry });
        const d = decide(field, c, proposal, settings, { repeated });
        let action = d.action;
        let reasons = d.reasons;
        let confidence = d.confidence;
        // A value is proposed only for what AutoFill may fill or suggest: a question left to
        // the user (a preference with the category off, say) carries none.
        const proposed = proposal && proposal.ok && (action === "fill" || action === "confirm" || action === "keep") ? proposal : null;
        let value: FillValue | null = proposed?.value ?? null;
        let display: string | null = proposed?.display ?? null;
        const label = field.label || (c.key ? KEYS[c.key].label : "Unlabelled field");
        let document: PlanItem["document"] = null;

        // A file input asking for a CV or cover letter: the document to attach, never ticked.
        if (field.kind === "file" && (c.key === "resume" || c.key === "cover_letter") && !c.otherPerson) {
          const kind = c.key === "resume" ? "cv" : "cover_letter";
          document = { kind, accept: field.accept || null };
          const doc = documentFor(kind, field.accept || null, documents, settings.defaultCv);
          if (doc) {
            value = doc.value;
            display = doc.display;
            action = field.hasValue ? "keep" : "confirm";
            reasons = field.hasValue ? ["replace_file"] : ["document_choice"];
            confidence = "medium";
          }
        }

        // Questions left to the user: an answer they saved, or their target salary.
        const excluded = !!c.key && settings.excluded.includes(c.key);
        if (action === "ask" && !c.otherPerson && !excluded && !reasons.includes("consent") && !reasons.includes("document")) {
          const saved = savedFor(c.key, label, field, profile);
          const salary = !saved && c.key === "salary_expectation" && settings.categories.preferences ? salaryFor(field, profile, x.lang) : null;
          const hit = saved ?? salary;
          if (hit) {
            value = hit.value;
            display = hit.display;
            action = field.hasValue ? "keep" : "confirm";
            reasons = [saved ? "saved_answer" : "salary_target", ...(field.hasValue ? (["has_value"] as PlanReason[]) : [])];
            confidence = "medium";
          }
        }

        items.push({
          frameId,
          frameOrigin,
          fieldId: field.id,
          kind: field.kind,
          label,
          required: field.required,
          key: c.key,
          category: c.key ? KEYS[c.key].category : null,
          confidence,
          action,
          reasons,
          value,
          display,
          options: field.options,
          maxLength: field.maxLength,
          entry,
          question: label,
          answerable: answerable(action, reasons, field.kind),
          draftable:
            action === "ask" &&
            !c.otherPerson &&
            (field.kind === "textarea" || field.kind === "text") &&
            (c.key === "open_question" || (!c.key && field.kind === "textarea" && label.length >= 10)),
          document,
        });
        if (c.key && WORK_KEYS.includes(c.key)) maxEntry.hasWork = true;
        if (c.key && EDU_KEYS.includes(c.key)) maxEntry.hasEdu = true;
      }
    }
  }

  const counts: PlanCounts = { detected: items.length, ready: 0, confirm: 0, input: 0, keep: 0, excluded: 0, filled: 0 };
  for (const i of items) {
    if (i.action === "fill") counts.ready++;
    else if (i.action === "confirm") counts.confirm++;
    else if (i.action === "ask") counts.input++;
    else if (i.action === "keep") {
      counts.keep++;
      if (i.reasons.includes("already_filled")) counts.filled++;
    } else counts.excluded++;
  }

  // What the form asked for that the profile could hold but doesn't: worth adding there.
  const missing = new Set<FieldKey>();
  for (const i of items) if (i.key && FILLABLE_KEYS.includes(i.key) && i.reasons.includes("missing_in_profile")) missing.add(i.key);

  const more = {
    experiences: maxEntry.hasWork ? Math.max(0, (profile.experiences?.length ?? 0) - (maxEntry.work + 1)) : 0,
    education: maxEntry.hasEdu ? Math.max(0, (profile.education?.length ?? 0) - (maxEntry.edu + 1)) : 0,
  };
  const ats = planAts ?? pageAts;

  return {
    pageUrl,
    scannedAt: opts.now ?? Date.now(),
    isApplicationForm: items.length > 0,
    items,
    counts,
    profileVersion: profile.profile_version,
    missingProfileKeys: [...missing],
    ats: ats ? { id: ats.id as AtsId, name: ats.name } : null,
    lang: scans.find((s) => s.result.lang)?.result.lang ?? null,
    documents,
    application: opts.documents?.application ?? null,
    more,
  };
}

