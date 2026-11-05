/**
 * Small ports of the API's normalisers, used only for the local preview ("Senior SRE at
 * Acme · Berlin") and the status lookup. The saved values always come from the API, which
 * normalises the capture again with the originals (apps/api/app/job_imports/extract.py,
 * apps/api/app/jobs/normalize.py, apps/api/app/jobs/locations.py).
 */

const GENDER = /\s*[([]\s*(?:[mwfdx]\s*[/|,]\s*){1,3}[mwfdx]\s*[)\]]|\s*\((?:all genders|gn|w\*m\*d)\)/gi;
const CAREERS_WORD = /\b(careers?|jobs?|karriere|stellenangebote|stellen|hiring|join us)\b/i;
const SEPARATOR = /\s[|–—·-]\s/;
const REMOTE = /\b(remote|fully remote|work from home|home ?office|homeoffice)\b/i;
const HYBRID = /\bhybrid\b/i;
const ONSITE = /\bon[- ]?site\b|\bin[- ]office\b|\bvor ort\b|\bpr(?:ä|ae)senz/i;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

/** Common HTML entities, decoded without touching the DOM (no innerHTML on a live page). */
export function unescapeHtml(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** A JSON-LD value as plain text (strings, {name}/{@value} objects, lists), like text_of. */
export function textOf(value: unknown, depth = 0): string | null {
  if (value === null || value === undefined || depth > 4) return null;
  if (Array.isArray(value)) {
    const parts = value.map((v) => textOf(v, depth + 1)).filter((v): v is string => !!v);
    return parts.join(", ") || null;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    return textOf(o.name ?? o["@value"] ?? o.value, depth + 1);
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = unescapeHtml(String(value)).replace(/\s+/g, " ").trim();
  return s || null;
}

export function cleanTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const t = title.replace(GENDER, "").replace(/\s{2,}/g, " ");
  return t.replace(/^[\s\-|–]+|[\s\-|–]+$/g, "") || null;
}

/** "Head of SRE - Acme | Careers" -> "Head of SRE". */
export function titleFromDocumentTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  return cleanTitle(title.split(SEPARATOR)[0] ?? null);
}

/** "Datadog Careers | Datadog" -> "Datadog". */
export function companyFromSiteName(site: string | null | undefined): string | null {
  if (!site || site.length > 120) return null;
  const parts = site.split(SEPARATOR).map((p) => p.trim()).filter(Boolean);
  const plain = parts.filter((p) => !CAREERS_WORD.test(p));
  if (plain.length) return plain[0] ?? null;
  if (!parts.length) return null;
  const rest = (parts[0] ?? "").replace(new RegExp(CAREERS_WORD.source, "gi"), "").replace(/^[\s\-|]+|[\s\-|]+$/g, "");
  return rest.replace(/^(bei|at|with|@)\s+/i, "").trim() || null;
}

export function employmentTypeFrom(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.toLowerCase().replace(/[-_]/g, " ");
  if (/intern|praktik|working student|werkstudent/.test(v)) return "internship";
  if (/part|teilzeit/.test(v)) return "part_time";
  if (/contract|freelance|temporary|befristet/.test(v)) return "contract";
  if (/full|permanent|vollzeit|fulltime/.test(v)) return "full_time";
  return null;
}

export function remotePolicyFrom(value: string | null | undefined): string | null {
  if (!value) return null;
  if (HYBRID.test(value)) return "hybrid";
  if (REMOTE.test(value)) return "remote";
  if (ONSITE.test(value)) return "onsite";
  return null;
}

export function isoDate(value: unknown): string | null {
  const s = textOf(value);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1] ?? null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const PERIODS: Record<string, string> = {
  year: "year", yearly: "year", annual: "year", annually: "year",
  month: "month", monthly: "month", hour: "hour", hourly: "hour",
};

function toInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Math.round(Number(String(v).replace(/,/g, "").trim()));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The salary the employer states in `baseSalary`, or null. Never estimated: estimatedSalary
 * and figures in free text are ignored, as the API does.
 */
export function salaryFrom(baseSalary: unknown): string | null {
  if (!baseSalary || typeof baseSalary !== "object" || Array.isArray(baseSalary)) return null;
  const s = baseSalary as Record<string, unknown>;
  const currency = textOf(s.currency)?.toUpperCase() ?? null;
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return null;
  let low: number | null;
  let high: number | null;
  let period: string | undefined;
  if (s.value && typeof s.value === "object" && !Array.isArray(s.value)) {
    const v = s.value as Record<string, unknown>;
    period = PERIODS[String(v.unitText ?? "").toLowerCase()];
    low = toInt(v.minValue ?? v.value);
    high = toInt(v.maxValue ?? v.value);
  } else {
    period = PERIODS[String(s.unitText ?? "").toLowerCase()];
    low = high = toInt(s.value);
  }
  if (!period || (!low && !high)) return null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  const amount = low && high && low !== high ? `${fmt(low)}–${fmt(high)}` : fmt((low ?? high) as number);
  return `${currency} ${amount} per ${period}`;
}
