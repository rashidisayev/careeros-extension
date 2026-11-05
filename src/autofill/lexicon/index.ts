/**
 * The languages AutoFill reads form labels in. Every lexicon is applied to every page (forms
 * mix languages, and page language tags are often wrong). To add a language, write one
 * `Lexicon` file and list it here; the classifier and tests pick it up.
 */
import { norm } from "../normalize";
import type { FieldKey } from "../types";
import { de } from "./de";
import { en } from "./en";
import type { KeyTerms, Lexicon } from "./types";

export const LEXICONS: Lexicon[] = [en, de];

export type CompiledTerms = { exact: Set<string>; weak: Set<string>; phrases: string[]; not: string[] };
export type Compiled = {
  keys: Map<FieldKey, CompiledTerms>;
  otherPerson: string[];
  yes: Set<string>;
  no: Set<string>;
  salutations: Set<string>;
  questionStarts: string[];
  sections: { work: string[]; education: string[] };
  /** Month number (1-12) by normalised name and short name, every language. */
  months: Map<string, number>;
  /** Full month names by number, every language. */
  monthNames: Map<number, string[]>;
};

let compiled: Compiled | null = null;

function merge(into: CompiledTerms, terms: KeyTerms): void {
  for (const t of terms.exact ?? []) into.exact.add(norm(t));
  for (const t of terms.weak ?? []) into.weak.add(norm(t));
  into.phrases.push(...(terms.phrases ?? []).map(norm));
  into.not.push(...(terms.not ?? []).map(norm));
}

/** All lexicons, normalised and merged once. */
export function lexicon(lexicons: Lexicon[] = LEXICONS): Compiled {
  if (compiled && lexicons === LEXICONS) return compiled;
  const out: Compiled = { keys: new Map(), otherPerson: [], yes: new Set(), no: new Set(), salutations: new Set(), questionStarts: [], sections: { work: [], education: [] }, months: new Map(), monthNames: new Map() };
  for (const lx of lexicons) {
    for (const [key, terms] of Object.entries(lx.keys) as [FieldKey, KeyTerms][]) {
      let t = out.keys.get(key);
      if (!t) out.keys.set(key, (t = { exact: new Set(), weak: new Set(), phrases: [], not: [] }));
      merge(t, terms);
    }
    out.otherPerson.push(...lx.otherPerson.map(norm));
    for (const y of lx.yes) out.yes.add(norm(y));
    for (const n of lx.no) out.no.add(norm(n));
    for (const s of lx.salutations) out.salutations.add(norm(s));
    out.questionStarts.push(...lx.questionStarts.map(norm));
    out.sections.work.push(...lx.sections.work.map(norm));
    out.sections.education.push(...lx.sections.education.map(norm));
    lx.months.forEach((m, i) => {
      const n = norm(m);
      out.months.set(n, i + 1);
      out.months.set(n.slice(0, 3), i + 1);
      out.monthNames.set(i + 1, [...(out.monthNames.get(i + 1) ?? []), m]);
    });
  }
  out.sections.work.sort((a, b) => b.length - a.length);
  out.sections.education.sort((a, b) => b.length - a.length);
  // Longer phrases first, so "phone country code" is tried before "phone".
  for (const t of out.keys.values()) t.phrases.sort((a, b) => b.length - a.length);
  if (lexicons === LEXICONS) compiled = out;
  return out;
}
