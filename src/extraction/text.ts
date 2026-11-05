/**
 * Readable text of a part of the page: block-aware (paragraphs and list items keep their
 * lines), without scripts, navigation, forms or hidden elements. Same idea as the API's
 * page reader (apps/api/app/job_imports/parse.py), but on the live DOM.
 */

const SKIP = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "NAV", "HEADER", "FOOTER", "ASIDE", "FORM",
  "BUTTON", "IFRAME", "SELECT", "OPTION", "INPUT", "TEXTAREA", "CANVAS", "VIDEO", "AUDIO",
  "OBJECT", "EMBED", "DIALOG", "HEAD", "LINK", "META",
]);
const BLOCK = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "MAIN", "BR", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "UL",
  "OL", "TABLE", "DL", "DT", "DD", "BLOCKQUOTE", "HR", "PRE", "FIGURE", "FIGCAPTION", "LI",
]);
const MAX_DEPTH = 200;

type Visible = Element & { checkVisibility?: (opts?: object) => boolean };

export function isHidden(el: Element): boolean {
  if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return true;
  const style = (el as HTMLElement).style;
  if (style && (style.display === "none" || style.visibility === "hidden")) return true;
  const v = el as Visible;
  if (typeof v.checkVisibility === "function") {
    try {
      return !v.checkVisibility({ visibilityProperty: true });
    } catch {
      return false;
    }
  }
  return false;
}

/** Collapse runs of spaces, trim lines and keep at most one empty line in a row. */
export function tidy(text: string): string {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[ \t ​]+/g, " ").trim();
    if (!line && (!out.length || !out[out.length - 1])) continue;
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out.join("\n");
}

export function readableText(root: Element, maxChars = 60_000): string {
  const parts: string[] = [];
  let length = 0;
  const walk = (node: Node, depth: number) => {
    if (length > maxChars || depth > MAX_DEPTH) return;
    if (node.nodeType === 3) {
      const t = node.nodeValue ?? "";
      parts.push(t);
      length += t.length;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    // The root itself is always read: the caller chose it (a <header> holding the title).
    if (depth > 0 && (SKIP.has(tag) || isHidden(el))) return;
    // List items start a "- " line; the next item (or block) ends it.
    if (tag === "LI") parts.push("\n- ");
    else if (BLOCK.has(tag)) parts.push("\n");
    for (const child of Array.from(el.childNodes)) walk(child, depth + 1);
    if (BLOCK.has(tag) && tag !== "LI") parts.push("\n");
  };
  walk(root, 0);
  return tidy(parts.join("")).slice(0, maxChars);
}

/** Short single-line text of an element (headings, labels), or null. */
export function shortText(el: Element | null | undefined, max = 300): string | null {
  if (!el) return null;
  const t = tidy(readableText(el, max * 2)).replace(/\n+/g, " ").trim();
  return t && t.length <= max ? t : t ? t.slice(0, max) : null;
}
