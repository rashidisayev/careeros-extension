/**
 * Field classifier: what a detected control asks for, from its descriptions only (label,
 * ARIA, placeholder, name/id, autocomplete, surrounding text, options). Pure: no DOM, no
 * profile, so it is tested on plain descriptors.
 *
 * Every signal is scored against the lexicons (exact label > phrase in a short label >
 * phrase in a long question), weighted by how reliable the signal is, and the best key
 * wins. A close second meaning makes the result ambiguous, which caps it at "medium".
 */
import { adapterKey, type AtsAdapter } from "./adapters";
import { EDU_KEYS, KEYS, WORK_KEYS } from "./keys";
import { lexicon, type Compiled, type CompiledTerms } from "./lexicon";
import { containsPhrase, labelCore, norm, splitIdentifier, wordCount } from "./normalize";
import type { Classification, FieldDescriptor, FieldKey, FieldSignals, Level } from "./types";

/** How much each signal is trusted. */
const WEIGHT: Record<keyof FieldSignals, number> = {
  autocomplete: 1,
  label: 1,
  aria: 1,
  context: 0.92,
  placeholder: 0.85,
  title: 0.8,
  name: 0.8,
  id: 0.8,
  dataId: 0.8,
  description: 0.6,
  section: 0,
};

/** HTML autocomplete tokens: the page's own statement of what a field is. */
const AUTOCOMPLETE: Record<string, FieldKey> = {
  "given-name": "first_name",
  "family-name": "last_name",
  name: "full_name",
  nickname: "preferred_name",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  "tel-country-code": "phone_country_code",
  "street-address": "street_address",
  "address-line1": "street_address",
  "postal-code": "postal_code",
  "address-level2": "city",
  country: "country",
  "country-name": "country",
  organization: "current_company",
  "organization-title": "current_title",
  url: "website_url",
  bday: "date_of_birth",
  "bday-day": "date_of_birth",
  "bday-month": "date_of_birth",
  "bday-year": "date_of_birth",
  sex: "gender",
  "honorific-prefix": "salutation",
};

// Leading words in field names that say nothing about the field (job_application[...]).
const ID_NOISE = /^((job|application|applicant|candidate|input|field|form|question|answers?|attributes|data|personal|contact|details|info|urls?|cards?|custom|fields?|user|q|ctl\d*|txt|tb)\s+)+/;

const THRESHOLD: [Level, number][] = [
  ["high", 0.85],
  ["medium", 0.65],
  ["low", 0.45],
];

function levelOf(score: number): Level {
  for (const [level, min] of THRESHOLD) if (score >= min) return level;
  return "none";
}

/** 0..1: how well one piece of text names this key. */
export function matchTerms(text: string, terms: CompiledTerms): number {
  if (!text) return 0;
  for (const n of terms.not) if (containsPhrase(text, n)) return 0;
  if (terms.exact.has(text)) return 1;
  if (terms.weak.has(text)) return 0.72;
  const words = wordCount(text);
  for (const p of terms.phrases) {
    if (!containsPhrase(text, p)) continue;
    const pw = wordCount(p);
    if (words <= pw + 2) return 0.95;
    if (words <= 8) return 0.85;
    return 0.72;
  }
  return 0;
}

// "Years of experience with Kubernetes" asks about one skill, not the career.
const SKILL_SPECIFIC = /\b(with|using|in|mit|als)\s+(?!total\b|years?\b|jahren?\b|insgesamt\b|gesamt\b)[a-z0-9]/;

function prepared(key: keyof FieldSignals, raw: string): string {
  if (key === "name" || key === "id" || key === "dataId") {
    return splitIdentifier(raw).replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim().replace(ID_NOISE, "");
  }
  return labelCore(raw).replace(/\bin total\b/g, "total");
}

type Scored = { key: FieldKey; score: number; source: string };

export type Section = "work" | "education" | null;

// Field names that place a field in a history entry (experience[0][title], workExperience-1--…).
const WORK_NAME = /work.?experience|experiences?(\[|--|_\d|-\d)|employment(_?history|\[|--|-\d)|employers?\[|positions?\[|jobs?\[\d/i;
const EDU_NAME = /educations?(\[|--|_\d|-\d)|schools?\[|academic/i;

/** Whether a field belongs to the employment history or the education, by its section or name. */
export function sectionOf(field: FieldDescriptor, lx: Compiled = lexicon()): Section {
  const ids = [field.signals.name, field.signals.id, field.signals.dataId].filter(Boolean).join(" ");
  if (WORK_NAME.test(ids)) return "work";
  if (EDU_NAME.test(ids)) return "education";
  const heading = field.signals.section ? labelCore(field.signals.section) : "";
  if (!heading) return null;
  const edu = lx.sections.education.some((t) => containsPhrase(heading, t));
  const work = lx.sections.work.some((t) => containsPhrase(heading, t));
  // "Education and experience": the field's own words decide below.
  if (edu && !work) return "education";
  if (work && !edu) return "work";
  return null;
}

// Words the history sections share with the applicant's own details: inside a section,
// "Company" is that role's employer and "Location" its place, not the applicant's.
const PLAIN_IN_SECTIONS: FieldKey[] = ["current_company", "current_title", "city", "location", "country", "availability_date", "summary", "headline", "leadership_experience", "full_name"];

// "Current job title" under a heading "Experience" is the applicant's own: a heading alone
// is weak evidence, and the label says so plainly.
const CURRENT_KEYS: FieldKey[] = ["current_title", "current_company"];

/**
 * Keeps the meanings that fit where the field is (see sectionOf). `byName`: the field's name
 * places it in the section (an entry of a list), not just a heading above it.
 */
function bySection(scored: Scored[], section: Section, byName: boolean): Scored[] {
  const work = new Set(WORK_KEYS);
  const edu = new Set(EDU_KEYS);
  if (section === "work") {
    const current = byName ? undefined : scored.find((s) => CURRENT_KEYS.includes(s.key) && s.score >= 0.85);
    if (current) return scored.filter((s) => !work.has(s.key) && !edu.has(s.key));
    return scored.filter((s) => !edu.has(s.key) && !PLAIN_IN_SECTIONS.includes(s.key) && !(s.key === "salutation" && s.source !== "options"));
  }
  if (section === "education") {
    return scored
      .map((s) => (s.key === "work_start" ? { ...s, key: "edu_start" as FieldKey } : s.key === "work_end" ? { ...s, key: "edu_end" as FieldKey } : s))
      .filter((s) => !work.has(s.key) && !PLAIN_IN_SECTIONS.includes(s.key) && !(s.key === "salutation" && s.source !== "options"));
  }
  // Outside a history section only clear evidence counts: the ATS's own field name, or an
  // unmistakable label ("University", "Graduation year"). "From" or "Title" mean nothing here.
  return scored.filter((s) => {
    if (s.source === "adapter") return true;
    if (work.has(s.key)) return false;
    if (edu.has(s.key)) return s.score >= 0.85 && s.key !== "edu_start";
    return true;
  });
}

function scoreSignals(field: FieldDescriptor, lx: Compiled, ats: AtsAdapter | null): Scored[] {
  const best = new Map<FieldKey, Scored>();
  const agree = new Map<FieldKey, number>();
  const add = (key: FieldKey, score: number, source: string) => {
    if (!KEYS[key].kinds.includes(field.kind)) return;
    if (score >= 0.6) agree.set(key, (agree.get(key) ?? 0) + 1);
    const cur = best.get(key);
    if (!cur || score > cur.score) best.set(key, { key, score, source });
  };

  const ac = field.signals.autocomplete?.trim().toLowerCase().split(/\s+/).pop();
  if (ac && AUTOCOMPLETE[ac]) add(AUTOCOMPLETE[ac]!, WEIGHT.autocomplete, "autocomplete");

  // The ATS's documented name for the field.
  const hinted = ats ? adapterKey(ats, [field.signals.name, field.signals.id, field.signals.dataId]) : null;
  if (hinted) add(hinted, 1, "adapter");

  for (const sig of Object.keys(field.signals) as (keyof FieldSignals)[]) {
    const raw = field.signals[sig];
    const weight = WEIGHT[sig];
    if (!raw || !weight || sig === "autocomplete") continue;
    const text = prepared(sig, raw);
    if (!text) continue;
    for (const [key, terms] of lx.keys) {
      let m = matchTerms(text, terms);
      if (!m) continue;
      if (key === "years_of_experience" && SKILL_SPECIFIC.test(text)) continue;
      add(key, m * weight, sig);
    }
  }

  // The input type is a statement too.
  if (field.kind === "email") add("email", 0.9, "type");
  if (field.kind === "tel") add("phone", 0.85, "type");

  // A choice of Mr / Ms / Herr / Frau is a salutation, whatever its label says.
  if ((field.kind === "select" || field.kind === "radio") && field.options.length >= 2) {
    const sal = field.options.filter((o) => lx.salutations.has(norm(o.label))).length;
    if (sal >= 2) add("salutation", 0.95, "options");
  }

  // Files are documents; an unnamed upload is still one.
  if (field.kind === "file" && !best.size) add("other_document", 0.6, "type");

  // Agreement between signals (label and name both say "email") adds a little certainty.
  return [...best.values()].map((s) => ({ ...s, score: Math.min(1, s.score + ((agree.get(s.key) ?? 0) >= 2 ? 0.05 : 0)) }));
}

function isOpenQuestion(field: FieldDescriptor, lx: Compiled): boolean {
  if (field.kind !== "textarea" && field.kind !== "text") return false;
  const raw = field.signals.label ?? field.signals.aria ?? field.signals.context ?? "";
  if (!raw) return false;
  const t = norm(raw);
  const question = raw.trim().endsWith("?") || lx.questionStarts.some((q) => t.startsWith(`${q} `));
  return question && (field.kind === "textarea" || wordCount(t) >= 6);
}

function aboutSomeoneElse(field: FieldDescriptor, lx: Compiled): boolean {
  const texts = [field.signals.section, field.signals.label, field.signals.context, field.signals.aria].filter(Boolean).map((t) => norm(t!));
  return texts.some((t) => lx.otherPerson.some((p) => containsPhrase(t, p)));
}

export function classify(field: FieldDescriptor, lx: Compiled = lexicon(), ats: AtsAdapter | null = null): Classification {
  const ids = [field.signals.name, field.signals.id, field.signals.dataId].filter(Boolean).join(" ");
  const byName = WORK_NAME.test(ids) || EDU_NAME.test(ids);
  const scored = bySection(scoreSignals(field, lx, ats), sectionOf(field, lx), byName).sort((a, b) => b.score - a.score || (a.source === "adapter" ? -1 : b.source === "adapter" ? 1 : 0));
  let top = scored[0];
  const second = scored[1];
  const otherPerson = aboutSomeoneElse(field, lx);

  if ((!top || top.score < 0.85) && isOpenQuestion(field, lx)) {
    top = { key: "open_question", score: 0.8, source: "question" };
  }
  if (!top || top.score < 0.45) {
    return { key: null, score: top?.score ?? 0, level: "none", source: null, otherPerson, ambiguous: false };
  }
  // "Mobile / Email" or a label that fits two keys equally well: a suggestion at most. The
  // ATS's own field name settles it.
  const ambiguous = top.source !== "adapter" && !!second && second.key !== top.key && second.score >= 0.65 && top.score - second.score < 0.08;
  let level = levelOf(top.score);
  if (ambiguous && level === "high") level = "medium";
  return { key: top.key, score: Number(top.score.toFixed(3)), level, source: top.source, otherPerson, ambiguous };
}
