/**
 * The job a tailored resume is written for, normalised from what the extractor read on the
 * page: title, company, location, employment type, seniority, the posting's text and the
 * lists it gives under "Your tasks", "Requirements" and "Nice to have". Pure: runs in the
 * service worker on the tab's cached extraction, never touches a DOM.
 *
 * Only what the page states is used. Seniority comes from words in the title ("Senior",
 * "Head of"), never from the text; a list goes into a section only under a heading that names
 * it. Skills are not guessed here: GetCareer checks the posting against its own skills
 * taxonomy and the Career Profile when it writes the resume.
 */
import type { Extraction } from "../shared/types";
import { textOf, unescapeHtml } from "./normalize";

export type JobPosting = {
  title: string | null;
  company: string | null;
  location: string | null;
  employmentType: string | null;
  seniority: string | null;
  /** The posting's address (canonical when the page names one). */
  url: string | null;
  /** The posting's text, plain, with "- " list lines. */
  description: string | null;
  responsibilities: string[];
  required: string[];
  preferred: string[];
  language: "en" | "de" | null;
};

/** The API's limits (docs/api/job-resumes.md); values are cut to them before sending. */
export const LIMITS = { title: 300, company: 200, description: 50_000, location: 300, seniority: 60, requirement: 300, requirements: 50, minDescription: 40 } as const;
const MAX_ITEMS = 25;

// ---- HTML descriptions (schema.org) -------------------------------------------------------

const BLOCK_TAG = /^(p|div|section|article|br|tr|h[1-6]|ul|ol|table|dl|dt|dd|blockquote|hr|pre|figure|figcaption)$/i;

/**
 * Text of an HTML fragment (a JobPosting description), with list items as "- " lines and
 * blocks on their own lines. String work only: the HTML is never parsed into a document,
 * and the result is only ever sent as data.
 */
export function htmlToText(html: string): string {
  const out: string[] = [];
  const cleaned = html.replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  for (const part of cleaned.split(/(<[^>]{0,500}>)/)) {
    if (!part) continue;
    const tag = /^<\s*(\/)?\s*([a-z][a-z0-9]*)/i.exec(part);
    if (!tag) {
      if (!part.startsWith("<")) out.push(unescapeHtml(part).replace(/\s+/g, " "));
      continue;
    }
    const name = tag[2]!.toLowerCase();
    // Each item starts its own "- " line; the list's end closes the last one.
    if (name === "li") {
      if (!tag[1]) out.push("\n- ");
    } else if (BLOCK_TAG.test(name)) out.push("\n");
  }
  return tidyLines(out.join(""));
}

function tidyLines(text: string): string {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[ \t ​]+/g, " ").trim();
    if (line === "-" || line === "") {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }
    lines.push(line);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

// ---- Sections ------------------------------------------------------------------------------

type Section = "responsibilities" | "required" | "preferred" | "other";

// Headings, English and German. Order matters: "preferred" before "required" ("Preferred
// qualifications"), "other" first for benefits and company blurbs.
const HEADINGS: [Section, RegExp][] = [
  ["other", /^(benefits|perks|what we offer|we offer|our offer|why (join|work)|about (us|the company|the team)|how to apply|compensation|salary|equal opportunity|wir bieten|was wir (dir|ihnen) bieten|unser angebot|deine vorteile|ihre vorteile|benefits für dich|über uns|wer wir sind|kontakt)\b/i],
  ["preferred", /^(nice[- ]to[- ]have|preferred|bonus|bonus points|plus|it'?s a plus|would be (great|a plus)|ideally|good to have|wünschenswert|von vorteil|pluspunkte|idealerweise|wäre schön)\b/i],
  [
    "required",
    /^(requirements?|qualifications?|minimum qualifications|basic qualifications|required|must[- ]haves?|what you('ll)? bring|what we('re| are) looking for|who you are|your profile|about you|you have|you bring|skills|your skills|experience|anforderungen|qualifikationen|dein profil|ihr profil|das bringst du mit|das bringen sie mit|was du mitbringst|was sie mitbringen|deine qualifikationen|ihre qualifikationen)\b/i,
  ],
  [
    "responsibilities",
    /^(responsibilities|key responsibilities|what you('ll| will) do|your (role|tasks|responsibilities|mission|impact)|the role|in this role|your day|day to day|aufgaben|deine aufgaben|ihre aufgaben|dein job|deine rolle|ihre rolle|deine verantwortung|ihr verantwortungsbereich|was du tust|was du bewegst)\b/i,
  ],
];

const PREFERRED_ITEM = /\b(nice to have|is a plus|a plus|bonus|preferred|ideally|von vorteil|wünschenswert|idealerweise|ein plus)\b/i;
const BULLET = /^(?:[-•*·–—▪◦‣]|\d{1,2}[.)])\s+/;

function headingOf(line: string): Section | null {
  if (line.length > 80 || BULLET.test(line)) return null;
  const bare = line.replace(/[:：.!?]+$/, "").replace(/^[^\p{L}]+/u, "").trim();
  if (!bare || bare.split(/\s+/).length > 8) return null;
  for (const [section, re] of HEADINGS) if (re.test(bare)) return section;
  return null;
}

/** The lists under "Your tasks", "Requirements" and "Nice to have" headings. */
export function sectionsOf(text: string | null): Pick<JobPosting, "responsibilities" | "required" | "preferred"> {
  const out = { responsibilities: [] as string[], required: [] as string[], preferred: [] as string[] };
  if (!text) return out;
  let current: Section | null = null;
  let items = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const heading = headingOf(line);
    if (heading) {
      current = heading;
      items = 0;
      continue;
    }
    if (!current || current === "other") continue;
    if (!BULLET.test(line)) {
      // A paragraph after the list ends the section; one before it (an intro) doesn't.
      if (items > 0 || line.endsWith(":")) current = line.endsWith(":") ? current : null;
      continue;
    }
    const item = line.replace(BULLET, "").trim().slice(0, LIMITS.requirement);
    if (item.length < 2) continue;
    items++;
    const target = current === "required" && PREFERRED_ITEM.test(item) ? "preferred" : current;
    const list = out[target];
    if (list.length < MAX_ITEMS && !list.includes(item)) list.push(item);
  }
  return out;
}

// ---- Seniority and language ----------------------------------------------------------------

// From the title only. Checked top-down and the first match wins, so the more specific level
// comes first: "Senior Staff Engineer" is staff, "Lead Senior Engineer" is lead.
const SENIORITY: [string, RegExp][] = [
  ["intern", /\b(intern|internship|praktikant(in)?|praktikum|werkstudent(in)?|working student|trainee|apprentice|azubi|ausbildung)\b/i],
  ["executive", /\b(chief [a-z]+ officer|c[etfo]o|cpo|ciso|geschäftsführer(in)?|managing director)\b/i],
  ["vp", /\b(vp|vice president)\b/i],
  ["director", /\b(director|direktor(in)?)\b/i],
  ["head", /\b(head of|leiter(in)?|leitung)\b/i],
  ["principal", /\bprincipal\b/i],
  ["staff", /\bstaff\b/i],
  ["lead", /\b(lead|team ?lead|tech lead|teamleiter(in)?|teamleitung)\b/i],
  ["senior", /\b(senior|sr\.?)(?=\s|$|,)/i],
  ["mid", /\b(mid[- ]level|intermediate)\b/i],
  ["junior", /\b(junior|jr\.?|entry[- ]level|graduate|berufseinsteiger(in)?|einsteiger(in)?)(?=\s|$|,)/i],
];

export function seniorityOf(title: string | null): string | null {
  if (!title) return null;
  for (const [level, re] of SENIORITY) if (re.test(title)) return level;
  return null;
}

const DE_WORDS = /\b(und|der|die|das|mit|für|wir|sie|du|dich|dein|deine|ist|eine|einen|auf|bei|von|oder|nicht|sowie|erfahrung|kenntnisse)\b/gi;
const EN_WORDS = /\b(and|the|with|for|we|you|your|is|are|our|to|of|in|on|experience|skills|will)\b/gi;

/** "de" or "en" when the text clearly is one of them, else null. */
export function languageOf(text: string | null): "en" | "de" | null {
  if (!text) return null;
  const sample = text.slice(0, 4000);
  const de = sample.match(DE_WORDS)?.length ?? 0;
  const en = sample.match(EN_WORDS)?.length ?? 0;
  if (de >= 5 && de > en * 1.2) return "de";
  if (en >= 5 && en >= de) return "en";
  return null;
}

// ---- The posting ---------------------------------------------------------------------------

function httpUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 1000) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** The description: the page's text, else the schema.org description (HTML or text). */
function descriptionOf(extraction: Extraction): string | null {
  const page = extraction.capture.description_text?.trim();
  if (page) return page.slice(0, LIMITS.description);
  const posting = extraction.capture.json_ld.find((p) => typeof p.description === "string");
  const raw = posting?.description as string | undefined;
  if (!raw) return null;
  const text = /<[a-z][^>]*>/i.test(raw) ? htmlToText(raw) : (textOf(raw) ?? "");
  return text.trim().slice(0, LIMITS.description) || null;
}

const cut = (v: string | null | undefined, max: number) => {
  const t = v?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** The job on the page, from the extractor's reading (null fields where the page says nothing). */
export function postingFrom(extraction: Extraction | null, pageUrl: string | null): JobPosting {
  const f = extraction?.fields ?? {};
  const description = extraction ? descriptionOf(extraction) : null;
  const title = cut(f.title?.value, LIMITS.title);
  return {
    title,
    company: cut(f.company_name?.value, LIMITS.company),
    location: cut(f.location?.value, LIMITS.location),
    employmentType: cut(f.employment_type?.value, 60),
    seniority: seniorityOf(title),
    url: httpUrl(extraction?.capture.canonical_url) ?? httpUrl(extraction?.capture.url) ?? httpUrl(pageUrl),
    description,
    ...sectionsOf(description),
    language: languageOf(description),
  };
}

/** The listed requirements as the API takes them: required first, then preferred. */
export function requirementsOf(p: Pick<JobPosting, "required" | "preferred">): string[] {
  return [...new Set([...p.required, ...p.preferred])].slice(0, LIMITS.requirements);
}
