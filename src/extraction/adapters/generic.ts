import { isHidden, shortText } from "../text";
import type { AdapterResult, PageFields } from "./types";
import { first, putValue } from "./util";

const CONTAINERS = ["[itemprop='description']", "main article", "article", "main", "[role='main']", "#content", ".content"];
const MIN_DESCRIPTION = 300;

function textLength(el: Element): number {
  return (el.textContent ?? "").replace(/\s+/g, " ").length;
}

/**
 * The element most likely to hold the posting on an unknown site: the first common content
 * container with enough text, else the body. Headers, navigation, forms and footers inside
 * it are skipped when it is read (text.ts).
 */
export function mainContent(doc: Document): Element | null {
  for (const sel of CONTAINERS) {
    const el = doc.querySelector(sel);
    if (el && !isHidden(el) && textLength(el) >= MIN_DESCRIPTION) return el;
  }
  return doc.body;
}

/** No adapter: a visible <h1> is a guess at the title, so it stays `inferred`. */
export function readGeneric(doc: Document): AdapterResult {
  const fields: PageFields = {};
  const h1 = Array.from(doc.querySelectorAll("h1")).find((el) => !isHidden(el)) ?? null;
  const title = shortText(h1, 300);
  if (title && title.length >= 3) putValue(fields, "title", title, "inferred");
  return { fields, description: first(doc, CONTAINERS.slice(0, 1)) ?? mainContent(doc) };
}
