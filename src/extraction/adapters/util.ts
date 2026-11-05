import { shortText } from "../text";
import type { PageFieldName, PageFields } from "./types";
import type { Basis } from "../../shared/types";

const MAX_FIELD = 500;

export function first(doc: ParentNode, selectors: string[]): Element | null {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  return null;
}

/** Put the short text of the first matching element into `fields`, if any. */
export function put(fields: PageFields, name: PageFieldName, el: Element | null, basis: Basis = "explicit"): void {
  const value = shortText(el, MAX_FIELD);
  if (value && !fields[name]) fields[name] = { value, basis };
}

export function putValue(fields: PageFields, name: PageFieldName, value: string | null | undefined, basis: Basis): void {
  const v = value?.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD);
  if (v && !fields[name]) fields[name] = { value: v, basis };
}

export function hostIs(url: URL, pattern: RegExp): boolean {
  return pattern.test(url.hostname.toLowerCase());
}
