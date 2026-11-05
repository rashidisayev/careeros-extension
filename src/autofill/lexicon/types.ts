import type { FieldKey } from "../types";

/**
 * How one language names form fields. Patterns are written naturally ("E-Mail-Adresse",
 * "Straße") and normalised when loaded, so they match the page's text after the same
 * normalisation.
 *
 * - `exact`: the whole label (after filler words like "your" and "required" are removed).
 * - `weak`: like exact, but only a medium-confidence hint ("Company" usually, not always,
 *   means the current employer).
 * - `phrases`: whole-word phrases inside a longer label or question.
 * - `not`: phrases that rule the key out ("city you'd like to work in" isn't your city).
 */
export type KeyTerms = { exact?: string[]; weak?: string[]; phrases?: string[]; not?: string[] };

export type Lexicon = {
  lang: string;
  keys: Partial<Record<FieldKey, KeyTerms>>;
  /** Sections or labels about someone else: references, emergency contacts, referrers. */
  otherPerson: string[];
  /** Option texts meaning yes / no. */
  yes: string[];
  no: string[];
  /** Option texts that are salutations (a select of these is a salutation, never filled). */
  salutations: string[];
  /** Words that start an open question ("Why…", "Describe…"). */
  questionStarts: string[];
  /** Section headings (or field names) of the employment history and the education. */
  sections: { work: string[]; education: string[] };
  /** Month names, January first (option lists of a month). */
  months: string[];
};
