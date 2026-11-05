/**
 * Profile data mapper: the value CareerOS would put into one classified control, and how sure
 * it is. Only values from the Career Profile are used; when the profile doesn't hold
 * something, or no option on the page fits it, there is no proposal (never a guess).
 */
import { dateLabels, dateOption, dateShape, dateText, parseYearMonth, type YearMonth } from "./dates";
import { EDU_KEYS, WORK_KEYS } from "./keys";
import { lexicon } from "./lexicon";
import { containsPhrase, norm } from "./normalize";
import type { AutofillProfile, Confidence, FieldDescriptor, FieldKey, FieldOption, FillValue, PlanReason, ProfileValue } from "./types";
import { codeInLabel, countryLabel, countryNames, pickRange, SENIORITY_LABEL, SENIORITY_WORDS, splitPhone, stripDecorations } from "./values";

export type Proposal =
  | { ok: true; value: FillValue; display: string; confidence: Confidence; reasons: PlanReason[] }
  | { ok: false; reason: PlanReason };

export type MapContext = {
  /** The page's language (for country names in text fields). */
  lang: string | null;
  /** The same form has a separate country-code field, so the phone goes in without it. */
  separateCountryCode: boolean;
  /** Which role or school a history field is for (0 = the most recent). */
  entry?: number | null;
};

const none = (reason: PlanReason): Proposal => ({ ok: false, reason });

function fromBasis(v: ProfileValue): { confidence: Confidence; reasons: PlanReason[] } {
  return v.basis === "explicit" ? { confidence: "high", reasons: [] } : { confidence: "medium", reasons: ["derived_value"] };
}

function lower(a: Confidence, b: Confidence): Confidence {
  const order: Confidence[] = ["low", "medium", "high"];
  return order[Math.min(order.indexOf(a), order.indexOf(b))]!;
}

const realOptions = (field: FieldDescriptor): FieldOption[] =>
  field.options.filter((o) => o.label.trim() !== "" || o.value.trim() !== "");

function optionByNames(field: FieldDescriptor, names: string[]): FieldOption | null {
  const wanted = new Set(names.map(norm));
  const opts = realOptions(field);
  return (
    opts.find((o) => wanted.has(norm(o.label)) || wanted.has(norm(o.value))) ??
    opts.find((o) => wanted.has(stripDecorations(o.label))) ??
    null
  );
}

function yesNo(field: FieldDescriptor, yes: boolean): FieldOption | null {
  const lx = lexicon();
  const set = yes ? lx.yes : lx.no;
  return (
    realOptions(field).find((o) => {
      const l = norm(o.label);
      const first = l.split(" ")[0] ?? "";
      return set.has(l) || set.has(norm(o.value)) || (set.has(first) && l.length > first.length);
    }) ?? null
  );
}

function textValue(key: FieldKey, profile: AutofillProfile, ctx: MapContext): { text: string; v: ProfileValue } | null {
  const vals = profile.values;
  const v = vals[key];
  switch (key) {
    case "phone": {
      if (!v) return null;
      if (!ctx.separateCountryCode) return { text: String(v.value), v };
      const parts = splitPhone(String(v.value), (vals.country?.value as string | undefined) ?? null);
      return { text: parts.national, v };
    }
    case "phone_country_code": {
      const phone = vals.phone;
      if (!phone) return null;
      const parts = splitPhone(String(phone.value), (vals.country?.value as string | undefined) ?? null);
      if (!parts.code) return null;
      return { text: `+${parts.code}`, v: { value: parts.code, basis: parts.codeBasis === "explicit" ? phone.basis : "derived" } };
    }
    case "country":
      return v ? { text: countryLabel(String(v.value), ctx.lang), v } : null;
    case "seniority":
      // The profile's level in a free-text field reads differently per company: confirm it.
      return v ? { text: SENIORITY_LABEL[String(v.value)] ?? String(v.value), v: { ...v, basis: "derived" } } : null;
    case "location": {
      if (v) return { text: String(v.value), v };
      // "Location (City)": the city (and country) the user entered, as a suggestion.
      const city = vals.city;
      if (!city) return null;
      const country = vals.country ? countryLabel(String(vals.country.value), ctx.lang) : null;
      return { text: country ? `${city.value}, ${country}` : String(city.value), v: { value: String(city.value), basis: "derived" } };
    }
    case "years_of_experience":
      return v ? { text: String(v.value), v } : null;
    default:
      if (!v || typeof v.value === "boolean") return null;
      return { text: String(v.value), v };
  }
}

function chooseOption(key: FieldKey, field: FieldDescriptor, profile: AutofillProfile): Proposal {
  const vals = profile.values;
  const v = vals[key === "phone_country_code" ? "phone" : key];
  if (!v) return none("missing_in_profile");
  const base = fromBasis(v);
  const pick = (o: FieldOption | null, conf: Confidence = base.confidence, reasons: PlanReason[] = base.reasons): Proposal =>
    o ? { ok: true, value: { kind: "option", index: o.index }, display: o.label.trim() || o.value, confidence: lower(base.confidence, conf), reasons } : none("no_matching_option");

  switch (key) {
    case "country":
      return pick(optionByNames(field, countryNames(String(v.value))));
    case "phone_country_code": {
      const parts = splitPhone(String(v.value), (vals.country?.value as string | undefined) ?? null);
      if (!parts.code) return none("missing_in_profile");
      const hits = realOptions(field).filter((o) => codeInLabel(o.label) === parts.code || codeInLabel(o.value) === parts.code);
      if (hits.length === 1) return pick(hits[0]!, parts.codeBasis === "explicit" ? "high" : "medium", parts.codeBasis === "explicit" ? base.reasons : ["derived_value"]);
      // +1 is the US and Canada: the profile's country decides, or the user does.
      const country = vals.country ? countryNames(String(vals.country.value)) : [];
      const byCountry = hits.filter((o) => country.some((c) => containsPhrase(stripDecorations(o.label), c)));
      return byCountry.length === 1 ? pick(byCountry[0]!, "medium", ["ambiguous_label"]) : none("no_matching_option");
    }
    case "years_of_experience": {
      const n = Number(v.value);
      const index = Number.isFinite(n) ? pickRange(realOptions(field), n) : null;
      return pick(index === null ? null : (field.options.find((o) => o.index === index) ?? null));
    }
    case "seniority": {
      const words = SENIORITY_WORDS[String(v.value)] ?? [];
      const hits = realOptions(field).filter((o) => words.some((w) => containsPhrase(norm(o.label), norm(w))));
      // Levels mean different things at different companies: always a suggestion.
      return hits.length === 1 ? pick(hits[0]!, "medium", ["ambiguous_label"]) : none("no_matching_option");
    }
    case "management_experience":
      if (typeof v.value !== "boolean") return none("missing_in_profile");
      // Yes/no questions are phrased in many ways: confirm the answer.
      return pick(yesNo(field, v.value), "medium", [...base.reasons, "ambiguous_label"]);
    default: {
      const exact = optionByNames(field, [String(v.value)]);
      if (exact) return pick(exact);
      const t = norm(String(v.value));
      const partial = realOptions(field).filter((o) => t && containsPhrase(norm(o.label), t));
      return partial.length === 1 ? pick(partial[0]!, "medium", [...base.reasons, "ambiguous_label"]) : none("no_matching_option");
    }
  }
}

export function propose(key: FieldKey, field: FieldDescriptor, profile: AutofillProfile, ctx: MapContext): Proposal {
  if (field.kind === "file") return none("document");
  if (HISTORY.has(key)) return proposeHistory(key, field, profile, ctx);
  if (LIST_KEYS.has(key)) return proposeList(key, field, profile);
  if (key === "relocation") return proposeRelocation(field, profile);
  if (field.kind === "custom") return proposeChoice(key, field, profile, ctx);
  if (field.kind === "checkboxes" || field.multiple) return none("unsupported_control");

  if (field.kind === "select" || field.kind === "radio") return chooseOption(key, field, profile);

  if (field.kind === "checkbox") {
    const v = profile.values[key];
    if (key !== "management_experience" || !v || typeof v.value !== "boolean") return v ? none("unsupported_control") : none("missing_in_profile");
    return { ok: true, value: { kind: "check", checked: v.value }, display: v.value ? "Ticked" : "Not ticked", confidence: "medium", reasons: ["ambiguous_label"] };
  }

  const got = textValue(key, profile, ctx);
  if (!got) return none(profile.values[key] && typeof profile.values[key]!.value === "boolean" ? "unsupported_control" : "missing_in_profile");
  let { text } = got;
  const { confidence, reasons } = fromBasis(got.v);
  if (field.kind === "number") {
    // Number inputs take digits only: a phone number loses its "+" and spaces.
    const digits = text.replace(/\D/g, "");
    if (!digits) return none("no_matching_option");
    if (digits !== text) return { ok: true, value: { kind: "text", text: digits }, display: digits, confidence: "medium", reasons: [...reasons, "ambiguous_label"] };
    text = digits;
  }
  if (field.maxLength !== null && field.maxLength > 0 && text.length > field.maxLength) return none("too_long");
  return { ok: true, value: { kind: "text", text }, display: text, confidence, reasons };
}

// ---- History, lists, preferences, list widgets ----------------------------------------------

const HISTORY = new Set<FieldKey>([...WORK_KEYS, ...EDU_KEYS]);
const LIST_KEYS = new Set<FieldKey>(["skills", "languages", "certifications", "preferred_location", "remote_preference", "employment_type"]);

const choose = (picks: string[][], display: string, reasons: PlanReason[] = []): Proposal => ({
  ok: true,
  value: { kind: "choose", picks },
  display,
  confidence: "medium",
  reasons: [...reasons, "list_choice"],
});

/** The option of a list that is this text: the same words, else the only one containing them. */
function optionFor(field: FieldDescriptor, names: string[]): { option: FieldOption; exact: boolean } | null {
  const exact = optionByNames(field, names);
  if (exact) return { option: exact, exact: true };
  const wanted = names.map(norm).filter((n) => n.length >= 2);
  const hits = realOptions(field).filter((o) => wanted.some((w) => containsPhrase(norm(o.label), w) || containsPhrase(w, norm(o.label))));
  return hits.length === 1 ? { option: hits[0]!, exact: false } : null;
}

/** A text for a select, radios or a list widget, as the right kind of value. */
function pickText(field: FieldDescriptor, names: string[], display: string, base: { confidence: Confidence; reasons: PlanReason[] }): Proposal {
  if (field.kind === "select" || field.kind === "radio") {
    const hit = optionFor(field, names);
    if (!hit) return none("no_matching_option");
    return {
      ok: true,
      value: { kind: "option", index: hit.option.index },
      display: hit.option.label.trim() || hit.option.value,
      confidence: hit.exact ? base.confidence : lower(base.confidence, "medium"),
      reasons: hit.exact ? base.reasons : [...base.reasons, "ambiguous_label"],
    };
  }
  if (field.kind === "custom") return choose([names], display, base.reasons);
  if (!["text", "textarea", "email", "url", "tel"].includes(field.kind)) return none("unsupported_control");
  if (field.maxLength !== null && field.maxLength > 0 && display.length > field.maxLength) return none("too_long");
  return { ok: true, value: { kind: "text", text: display }, display, confidence: base.confidence, reasons: base.reasons };
}

// "B.Sc." on the profile, "Bachelor's Degree" on the form.
const DEGREES: [RegExp, string[]][] = [
  [/\b(ph\s?d|doctor|doctorate|dr|promotion|doktor)\b/, ["phd", "doctorate", "doctor", "doctoral degree", "promotion", "doktor"]],
  [/\b(mba)\b/, ["mba", "master of business administration", "master"]],
  [/\b(m\s?sc|m\s?a|m\s?eng|master|magister|m\s?s)\b/, ["master", "masters", "master s degree", "master degree", "master of science", "master of arts"]],
  [/\b(b\s?sc|b\s?a|b\s?eng|bachelor|b\s?s)\b/, ["bachelor", "bachelors", "bachelor s degree", "bachelor degree", "bachelor of science", "bachelor of arts"]],
  [/\b(diplom|diploma)\b/, ["diplom", "diploma"]],
  [/\b(abitur|a levels?|high school)\b/, ["abitur", "high school", "a levels", "secondary school"]],
];

function degreeNames(degree: string): string[] {
  const t = norm(degree);
  for (const [re, names] of DEGREES) if (re.test(t)) return [degree, ...names];
  return [degree];
}

function proposeHistory(key: FieldKey, field: FieldDescriptor, profile: AutofillProfile, ctx: MapContext): Proposal {
  const entry = ctx.entry ?? 0;
  const work = WORK_KEYS.includes(key);
  const list = work ? profile.experiences : profile.education;
  if (!list) return none("missing_in_profile");
  const item = list[entry];
  if (!item) return none(entry > 0 ? "history_entry" : "missing_in_profile");
  const base = { confidence: "high" as Confidence, reasons: [] as PlanReason[] };

  if (key === "work_start" || key === "work_end" || key === "edu_start" || key === "edu_end") {
    let d: YearMonth | null;
    if (work) {
      const exp = item as NonNullable<AutofillProfile["experiences"]>[number];
      if (key === "work_end" && exp.current) return none("current_role");
      d = parseYearMonth(key === "work_start" ? exp.start : exp.end);
    } else {
      const edu = item as NonNullable<AutofillProfile["education"]>[number];
      const year = key === "edu_start" ? edu.start_year : edu.graduation_year;
      d = year ? { year, month: null } : null;
    }
    if (!d) return none("missing_in_profile");
    return proposeDate(d, field, !work);
  }

  if (key === "work_current") {
    const exp = item as NonNullable<AutofillProfile["experiences"]>[number];
    if (field.kind === "checkbox") return { ok: true, value: { kind: "check", checked: exp.current }, display: exp.current ? "Ticked" : "Not ticked", confidence: "high", reasons: [] };
    const o = yesNo(field, exp.current);
    return o ? { ok: true, value: { kind: "option", index: o.index }, display: o.label, confidence: "medium", reasons: ["ambiguous_label"] } : none("no_matching_option");
  }

  let text: string | null = null;
  let names: string[] = [];
  if (work) {
    const exp = item as NonNullable<AutofillProfile["experiences"]>[number];
    if (key === "work_company") text = exp.company;
    if (key === "work_title") text = exp.title;
    if (key === "work_location") text = exp.location;
    if (key === "work_description") {
      const parts = [exp.description?.trim(), ...exp.achievements.map((a) => `• ${a.trim()}`)].filter(Boolean);
      text = parts.length ? parts.join("\n") : null;
    }
    names = text ? [text] : [];
  } else {
    const edu = item as NonNullable<AutofillProfile["education"]>[number];
    if (key === "edu_school") text = edu.institution;
    if (key === "edu_field") text = edu.field_of_study;
    if (key === "edu_degree") text = edu.degree;
    names = text ? (key === "edu_degree" ? degreeNames(text) : [text]) : [];
  }
  if (!text) return none("missing_in_profile");
  const proposal = pickText(field, names, text, base);
  // A different school or degree name in a list is a match to check, not a fact.
  if (proposal.ok && proposal.value.kind === "option" && key === "edu_degree" && norm(proposal.display) !== norm(text)) {
    return { ...proposal, confidence: "medium", reasons: [...new Set([...proposal.reasons, "ambiguous_label" as PlanReason])] };
  }
  return proposal;
}

function proposeDate(d: YearMonth, field: FieldDescriptor, studies: boolean): Proposal {
  const lx = lexicon();
  const shape = dateShape(field, lx, studies);
  if (field.kind === "select" || field.kind === "radio") {
    const o = dateOption(d, shape, realOptions(field), lx);
    if (!o) return d.month === null && shape.part !== "year" ? none("missing_in_profile") : none("no_matching_option");
    return { ok: true, value: { kind: "option", index: o.index }, display: o.label.trim() || o.value, confidence: "high", reasons: [] };
  }
  if (field.kind === "custom") {
    const labels = dateLabels(d, shape.part === "month" || shape.part === "year" ? shape : { ...shape, part: "year" }, lx);
    return labels.length ? choose([labels], labels[0]!) : none("missing_in_profile");
  }
  const text = dateText(d, shape);
  if (!text) return none("missing_in_profile");
  return { ok: true, value: { kind: "text", text }, display: text, confidence: shape.assumed ? "medium" : "high", reasons: shape.assumed ? ["date_assumed"] : [] };
}

// How forms name the remote and employment preferences of a career direction.
const REMOTE_NAMES: Record<string, string[]> = {
  remote: ["remote", "fully remote", "100 remote", "work from home", "home office", "homeoffice", "mobiles arbeiten"],
  hybrid: ["hybrid", "hybrid work", "teilweise remote"],
  onsite: ["on site", "onsite", "in office", "office", "in person", "vor ort", "prasenz", "buro"],
};
const EMPLOYMENT_NAMES: Record<string, string[]> = {
  full_time: ["full time", "fulltime", "vollzeit", "full time permanent"],
  part_time: ["part time", "parttime", "teilzeit"],
  contract: ["contract", "contractor", "fixed term", "befristet", "temporary"],
  freelance: ["freelance", "freelancer", "freiberuflich", "freie mitarbeit"],
  internship: ["internship", "intern", "praktikum"],
};
const PREF_LABEL: Record<string, string> = {
  remote: "Remote", hybrid: "Hybrid", onsite: "On-site",
  full_time: "Full-time", part_time: "Part-time", contract: "Contract", freelance: "Freelance", internship: "Internship",
};

/** The values of a list key, each with the names a form may use for it. */
function listOf(key: FieldKey, profile: AutofillProfile): { text: string; names: string[] }[] | null {
  const prefs = profile.preferences ?? null;
  switch (key) {
    case "skills":
      return profile.skills?.length ? profile.skills.map((s) => ({ text: s, names: [s] })) : null;
    case "languages":
      return profile.languages?.length
        ? profile.languages.map((l) => ({ text: `${l.language}${l.cefr || l.proficiency ? ` (${l.cefr ?? l.proficiency})` : ""}`, names: [l.language] }))
        : null;
    case "certifications":
      return profile.certifications?.length
        ? profile.certifications.map((c) => ({ text: [c.name, [c.issuer, c.year].filter(Boolean).join(", ")].filter(Boolean).join(" (") + (c.issuer || c.year ? ")" : ""), names: [c.name] }))
        : null;
    case "preferred_location":
      return prefs?.preferred_locations.length ? prefs.preferred_locations.map((l) => ({ text: l, names: [l] })) : null;
    case "remote_preference":
      return prefs?.remote.length ? prefs.remote.map((r) => ({ text: PREF_LABEL[r] ?? r, names: REMOTE_NAMES[r] ?? [r] })) : null;
    case "employment_type":
      return prefs?.employment_types.length ? prefs.employment_types.map((t) => ({ text: PREF_LABEL[t] ?? t, names: EMPLOYMENT_NAMES[t] ?? [t] })) : null;
    default:
      return null;
  }
}

function proposeList(key: FieldKey, field: FieldDescriptor, profile: AutofillProfile): Proposal {
  const items = listOf(key, profile);
  if (!items) return none("missing_in_profile");
  const prefs = key === "preferred_location" || key === "remote_preference" || key === "employment_type";
  const reasons: PlanReason[] = prefs ? ["preference_value"] : [];

  if (field.kind === "checkboxes" || field.multiple) {
    const indexes = [...new Set(items.map((i) => optionFor(field, i.names)?.option.index).filter((x): x is number => x !== undefined))];
    if (!indexes.length) return none("no_matching_option");
    const display = indexes.map((i) => field.options.find((o) => o.index === i)?.label ?? "").filter(Boolean).join(", ");
    return { ok: true, value: { kind: "options", indexes }, display, confidence: "medium", reasons: [...reasons, "derived_value"] };
  }
  if (field.kind === "select" || field.kind === "radio") {
    // One answer: the first of the user's values the list offers.
    for (const i of items) {
      const hit = optionFor(field, i.names);
      if (hit) return { ok: true, value: { kind: "option", index: hit.option.index }, display: hit.option.label.trim() || hit.option.value, confidence: "medium", reasons: [...reasons, ...(items.length > 1 ? (["derived_value"] as PlanReason[]) : [])] };
    }
    return none("no_matching_option");
  }
  if (field.kind === "custom") return choose(items.map((i) => [i.text, ...i.names]), items.map((i) => i.text).join(", "), reasons);
  if (field.kind !== "text" && field.kind !== "textarea") return none("unsupported_control");
  // As many whole entries as the field holds.
  const max = field.maxLength && field.maxLength > 0 ? field.maxLength : Infinity;
  const kept: string[] = [];
  for (const i of items) {
    const next = [...kept, i.text].join(", ");
    if (next.length > max) break;
    kept.push(i.text);
  }
  if (!kept.length) return none("too_long");
  const text = kept.join(", ");
  return { ok: true, value: { kind: "text", text }, display: text, confidence: "medium", reasons: [...reasons, "derived_value"] };
}

function proposeRelocation(field: FieldDescriptor, profile: AutofillProfile): Proposal {
  const prefs = profile.preferences;
  if (!prefs) return none("missing_in_profile");
  const yes = prefs.willing_to_relocate;
  const reasons: PlanReason[] = ["preference_value"];
  if (field.kind === "checkbox") return { ok: true, value: { kind: "check", checked: yes }, display: yes ? "Ticked" : "Not ticked", confidence: "medium", reasons };
  if (field.kind === "custom") return choose([yes ? ["Yes", "Ja"] : ["No", "Nein"]], yes ? "Yes" : "No", reasons);
  const o = yesNo(field, yes);
  return o ? { ok: true, value: { kind: "option", index: o.index }, display: o.label, confidence: "medium", reasons } : none("no_matching_option");
}

// Keys a list widget can be answered for, and the texts to look for in its list.
function proposeChoice(key: FieldKey, field: FieldDescriptor, profile: AutofillProfile, ctx: MapContext): Proposal {
  const vals = profile.values;
  switch (key) {
    case "country": {
      const v = vals.country;
      if (!v) return none("missing_in_profile");
      const code = String(v.value);
      return choose([[countryLabel(code, ctx.lang), ...countryNames(code)]], countryLabel(code, ctx.lang));
    }
    case "phone_country_code": {
      const phone = vals.phone;
      if (!phone) return none("missing_in_profile");
      const parts = splitPhone(String(phone.value), (vals.country?.value as string | undefined) ?? null);
      return parts.code ? choose([[`+${parts.code}`]], `+${parts.code}`) : none("missing_in_profile");
    }
    case "industry":
    case "city":
    case "location": {
      const got = textValue(key, profile, ctx);
      return got ? choose([[got.text]], got.text) : none("missing_in_profile");
    }
    default:
      return none("unsupported_control");
  }
}
