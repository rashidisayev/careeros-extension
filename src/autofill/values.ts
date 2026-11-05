/**
 * Reference data for turning profile values into what forms show: country names, phone
 * calling codes, seniority words, experience ranges and yes/no. Pure.
 */
import { norm } from "./normalize";

// ---- Countries -------------------------------------------------------------------------

const ALIASES: Record<string, string[]> = {
  US: ["usa", "u s a", "united states of america", "us", "america", "vereinigte staaten", "vereinigte staaten von amerika"],
  GB: ["uk", "u k", "great britain", "britain", "united kingdom of great britain and northern ireland", "england", "grossbritannien", "vereinigtes konigreich"],
  DE: ["germany", "deutschland", "federal republic of germany", "bundesrepublik deutschland", "brd"],
  AT: ["austria", "osterreich"],
  CH: ["switzerland", "schweiz", "suisse"],
  NL: ["netherlands", "the netherlands", "holland", "niederlande"],
  CZ: ["czech republic", "czechia", "tschechien", "tschechische republik"],
  KR: ["south korea", "korea republic of", "republic of korea", "korea"],
  RU: ["russia", "russian federation", "russland"],
  AE: ["uae", "united arab emirates", "vereinigte arabische emirate"],
  TR: ["turkey", "turkiye", "turkei"],
  AZ: ["azerbaijan", "aserbaidschan"],
};

function displayName(code: string, lang: string): string | null {
  try {
    const name = new Intl.DisplayNames([lang], { type: "region" }).of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

/** Every way a form may name the country (normalised): code, English and German names, aliases. */
export function countryNames(code: string): string[] {
  const c = code.toUpperCase();
  const names = [c, displayName(c, "en"), displayName(c, "de"), ...(ALIASES[c] ?? [])].filter((n): n is string => !!n);
  return [...new Set(names.map(norm))];
}

/** The country's name for a text field, in the page's language (German on German pages). */
export function countryLabel(code: string, pageLang: string | null): string {
  const lang = pageLang?.toLowerCase().startsWith("de") ? "de" : "en";
  return displayName(code.toUpperCase(), lang) ?? code.toUpperCase();
}

/** "Germany (+49)", "DE - Germany", "+49 Deutschland" → the country words only. */
export function stripDecorations(label: string): string {
  return norm(label.replace(/\+\s?\d{1,4}/g, " ").replace(/\(.*?\)/g, " "));
}

// ---- Phone -----------------------------------------------------------------------------

// ITU country calling codes. They are prefix-free, so the longest prefix of a number is its code.
const CALLING_CODES = new Set(
  (
    "1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98 " +
    "211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 244 245 246 248 249 " +
    "250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 290 291 297 298 299 350 351 352 353 354 355 356 357 358 359 " +
    "370 371 372 373 374 375 376 377 378 379 380 381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505 506 507 508 509 590 591 592 " +
    "593 594 595 596 597 598 599 670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 850 852 853 855 856 880 " +
    "886 960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 992 993 994 995 996 998"
  ).split(" "),
);

const COUNTRY_CODE: Record<string, string> = {
  DE: "49", AT: "43", CH: "41", NL: "31", BE: "32", FR: "33", ES: "34", IT: "39", GB: "44", IE: "353", PL: "48", CZ: "420",
  DK: "45", SE: "46", NO: "47", FI: "358", PT: "351", LU: "352", US: "1", CA: "1", AU: "61", IN: "91", TR: "90", AZ: "994",
  UA: "380", RO: "40", HU: "36", GR: "30", SK: "421", SI: "386", HR: "385", BG: "359", EE: "372", LV: "371", LT: "370",
};

export type PhoneParts = { code: string | null; national: string; codeBasis: "explicit" | "derived" | null };

/** "+49 151 2345678" → {code "49", national "151 2345678"}. Without "+", the code comes from the country. */
export function splitPhone(phone: string, country: string | null): PhoneParts {
  const p = phone.trim();
  const intl = p.match(/^(\+|00)\s*([\d\s().-]+)$/);
  if (intl) {
    const digits = intl[2]!.replace(/\D/g, "");
    for (const len of [3, 2, 1]) {
      const code = digits.slice(0, len);
      if (CALLING_CODES.has(code)) {
        // Keep the user's grouping after the code: "+49 151 2345678" → "151 2345678".
        let rest = intl[2]!.trim();
        let removed = 0;
        let i = 0;
        while (removed < len && i < rest.length) {
          if (/\d/.test(rest[i]!)) removed++;
          i++;
        }
        rest = rest.slice(i).replace(/^[\s().-]+/, "").replace(/^\(0\)\s*/, "");
        return { code, national: rest, codeBasis: "explicit" };
      }
    }
    return { code: null, national: p, codeBasis: null };
  }
  const code = country ? (COUNTRY_CODE[country.toUpperCase()] ?? null) : null;
  return { code, national: p, codeBasis: code ? "derived" : null };
}

/** Calling codes mentioned in an option label: "Germany (+49)" → "49". */
export function codeInLabel(label: string): string | null {
  const m = label.match(/\+\s?(\d{1,4})\b/) ?? label.match(/^\s*(\d{1,4})\s*$/) ?? label.match(/^00(\d{1,4})\b/);
  return m ? m[1]! : null;
}

// ---- Seniority -------------------------------------------------------------------------

export const SENIORITY_WORDS: Record<string, string[]> = {
  intern: ["intern", "internship", "praktikant", "praktikum", "student", "werkstudent"],
  junior: ["junior", "entry level", "entry", "graduate", "berufseinsteiger", "einsteiger"],
  mid: ["mid", "mid level", "intermediate", "professional", "experienced", "berufserfahren", "mid senior"],
  senior: ["senior", "senior level", "expert", "experte"],
  lead: ["lead", "team lead", "teamleiter", "teamleitung", "principal", "staff"],
  manager: ["manager", "management", "fuhrungskraft"],
  head: ["head", "head of", "abteilungsleiter", "abteilungsleitung", "bereichsleiter", "bereichsleitung"],
  director: ["director", "direktor"],
  vp: ["vp", "vice president"],
  c_level: ["c level", "executive", "c suite", "cxo", "geschaftsfuhrung", "geschaftsfuhrer", "vorstand"],
};

export const SENIORITY_LABEL: Record<string, string> = {
  intern: "Intern", junior: "Junior", mid: "Mid-level", senior: "Senior", lead: "Lead", manager: "Manager",
  head: "Head of", director: "Director", vp: "VP", c_level: "C-level",
};

// ---- Experience ranges -----------------------------------------------------------------

/** "3-5 years" → [3,5]; "10+" → [10,∞]; "less than 1" → [0,0]; "7" → [7,7]; else null. */
export function parseRange(label: string): [number, number] | null {
  const t = label.toLowerCase().replace(/\s+/g, " ").trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/(\d+)\s*(?:-|–|—|to|bis)\s*(\d+)/))) return [Number(m[1]), Number(m[2])];
  if ((m = t.match(/(?:more than|over|mehr als|uber|über|greater than)\s*(\d+)/))) return [Number(m[1]) + 1, Infinity];
  if ((m = t.match(/(\d+)\s*(?:\+|or more|und mehr|oder mehr|plus|years? or more)/))) return [Number(m[1]), Infinity];
  if ((m = t.match(/(?:at least|mindestens|min\.?)\s*(\d+)/))) return [Number(m[1]), Infinity];
  if ((m = t.match(/(?:less than|under|fewer than|weniger als|unter)\s*(\d+)/))) return [0, Math.max(0, Number(m[1]) - 1)];
  if ((m = t.match(/^(\d+)\s*(?:years?|yrs?|jahre?n?)?$/))) return [Number(m[1]), Number(m[1])];
  if (/^(none|no experience|keine|keine erfahrung)$/.test(t)) return [0, 0];
  return null;
}

/** The narrowest option whose range holds n; null when none or two equally narrow. */
export function pickRange(options: { index: number; label: string }[], n: number): number | null {
  const hits = options
    .map((o) => ({ index: o.index, r: parseRange(o.label) }))
    .filter((o): o is { index: number; r: [number, number] } => !!o.r && o.r[0] <= n && n <= o.r[1])
    .map((o) => ({ index: o.index, width: o.r[1] - o.r[0] }))
    .sort((a, b) => a.width - b.width);
  if (!hits.length) return null;
  if (hits.length > 1 && hits[0]!.width === hits[1]!.width) return null;
  return hits[0]!.index;
}
