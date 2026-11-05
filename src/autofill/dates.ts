/**
 * Dates in history fields: what one control asks for (a month, a year, both, a full date)
 * and in which format, and the profile's month and year written that way. Pure.
 *
 * The Career Profile stores roles by month (YYYY-MM) and studies by year. A form asking for a
 * day gets the first of the month, and a free-text date without a format hint gets MM/YYYY;
 * both are suggestions the user confirms, never filled on their own.
 */
import type { Compiled } from "./lexicon";
import { norm, splitIdentifier } from "./normalize";
import type { FieldDescriptor, FieldOption } from "./types";

export type DatePart = "month" | "year" | "month_year" | "date";
export type DateShape = { part: DatePart; format: string | null; assumed: boolean };
export type YearMonth = { year: number; month: number | null };

const FORMATS: [RegExp, string, DatePart][] = [
  [/\b(dd|tt)[./-](mm)[./-](yyyy|jjjj)\b/i, "DD.MM.YYYY", "date"],
  [/\bmm[./-]dd[./-]yyyy\b/i, "MM/DD/YYYY", "date"],
  [/\byyyy-mm-dd\b/i, "YYYY-MM-DD", "date"],
  [/\bmm[./-](yyyy|jjjj)\b/i, "MM/YYYY", "month_year"],
  [/\bmm[./-]yy\b/i, "MM/YY", "month_year"],
  [/\byyyy[./-]mm\b/i, "YYYY-MM", "month_year"],
];

export function isMonthOption(o: FieldOption, lx: Compiled): number | null {
  const l = norm(o.label);
  const byName = lx.months.get(l) ?? lx.months.get(l.slice(0, 3));
  if (byName && (l.length <= 3 || lx.months.has(l))) return byName;
  for (const t of [o.label.trim(), o.value.trim()]) {
    if (/^(0?[1-9]|1[0-2])$/.test(t)) return Number(t);
  }
  return null;
}

const isYearOption = (o: FieldOption): number | null => {
  for (const t of [o.label.trim(), o.value.trim()]) if (/^(19|20)\d\d$/.test(t)) return Number(t);
  return null;
};

/** What one date control asks for. */
export function dateShape(field: FieldDescriptor, lx: Compiled, studies: boolean): DateShape {
  if (field.kind === "date") {
    if (field.inputType === "month") return { part: "month_year", format: "YYYY-MM", assumed: false };
    return { part: "date", format: "YYYY-MM-DD", assumed: true };
  }
  if (field.options.length) {
    const months = field.options.filter((o) => isMonthOption(o, lx) !== null).length;
    const years = field.options.filter((o) => isYearOption(o) !== null).length;
    if (years >= 3 && years >= months) return { part: "year", format: null, assumed: false };
    if (months >= 10) return { part: "month", format: null, assumed: false };
  }
  const s = field.signals;
  const raw = [s.placeholder, s.label, s.aria, s.context, s.description, s.title].filter(Boolean).join(" ");
  for (const [re, format, part] of FORMATS) {
    const m = raw.match(re);
    if (m) {
      // The page's own separator ("MM.YYYY" → ".").
      const sep = m[0].match(/[./-]/)?.[0] ?? "/";
      return { part, format: format.replace(/[./-]/g, sep), assumed: part === "date" };
    }
  }
  const words = ` ${[norm(raw), splitIdentifier([s.name, s.id, s.dataId].filter(Boolean).join(" "))].join(" ")} `;
  const month = /\s(month|monat|mm)\s/.test(words);
  const year = /\s(year|jahr|yyyy|jjjj|yy)\s/.test(words);
  if (month && !year) return { part: "month", format: null, assumed: false };
  if (year && !month) return { part: "year", format: null, assumed: false };
  if (field.kind === "number" || (field.maxLength !== null && field.maxLength <= 4)) return { part: "year", format: null, assumed: false };
  // Studies are kept by year; a role's free-text date gets a common format to check.
  return studies ? { part: "year", format: null, assumed: false } : { part: "month_year", format: "MM/YYYY", assumed: true };
}

/** "2019-03" → { year: 2019, month: 3 }. */
export function parseYearMonth(v: string | number | null | undefined): YearMonth | null {
  if (v === null || v === undefined) return null;
  const m = String(v).match(/^(\d{4})(?:-(\d{2}))?/);
  if (!m) return null;
  return { year: Number(m[1]), month: m[2] ? Number(m[2]) : null };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The date as text in the shape's format; null when the profile lacks a part it needs. */
export function dateText(d: YearMonth, shape: DateShape): string | null {
  if (shape.part === "year") return String(d.year);
  if (d.month === null) return null;
  if (shape.part === "month") return pad(d.month);
  const f = shape.format ?? (shape.part === "date" ? "YYYY-MM-DD" : "MM/YYYY");
  return f.replace("YYYY", String(d.year)).replace("YY", String(d.year).slice(2)).replace("MM", pad(d.month)).replace("DD", "01");
}

/** The option of a month or year list that is this date. */
export function dateOption(d: YearMonth, shape: DateShape, options: FieldOption[], lx: Compiled): FieldOption | null {
  if (shape.part === "year") return options.find((o) => isYearOption(o) === d.year) ?? null;
  if (shape.part === "month" && d.month !== null) return options.find((o) => isMonthOption(o, lx) === d.month) ?? null;
  return null;
}

/** Ways a list widget may show the month or year (English and German names, numbers). */
export function dateLabels(d: YearMonth, shape: DateShape, lx: Compiled): string[] {
  if (shape.part === "year") return [String(d.year)];
  if (shape.part !== "month" || d.month === null) return [];
  return [...(lx.monthNames.get(d.month) ?? []), pad(d.month), String(d.month)];
}
