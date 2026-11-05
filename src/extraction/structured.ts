/**
 * schema.org JobPosting from the page: JSON-LD first, microdata second. Only JobPosting
 * nodes are kept, pruned to the properties CareerOS reads and size-limited; the API parses
 * them again with its own code (apps/api/app/job_imports/extract.py, from_jsonld).
 */
import { readableText, tidy } from "./text";

type Node = Record<string, unknown>;

const MAX_SCRIPTS = 20;
const MAX_SCRIPT_CHARS = 1_000_000;
const MAX_POSTINGS = 3;
const MAX_DESCRIPTION = 100_000;
const MAX_STRING = 5_000;
const MAX_ITEMS = 25;

const KEEP = new Set([
  "@context", "@type", "@id", "title", "name", "description", "hiringOrganization", "jobLocation",
  "jobLocationType", "applicantLocationRequirements", "employmentType", "baseSalary", "datePosted",
  "validThrough", "industry", "workHours", "identifier", "url", "responsibilities", "qualifications",
  "experienceRequirements", "educationRequirements", "skills", "jobBenefits", "benefits",
  "occupationalCategory", "directApply", "address", "addressLocality", "addressRegion",
  "addressCountry", "postalCode", "streetAddress", "sameAs", "logo", "currency", "value", "minValue",
  "maxValue", "unitText", "propertyID",
]);

export function parseJsonLd(doc: Document): unknown[] {
  const out: unknown[] = [];
  const scripts = Array.from(doc.querySelectorAll('script[type*="ld+json" i]')).slice(0, MAX_SCRIPTS);
  for (const s of scripts) {
    const raw = (s.textContent ?? "").trim();
    if (!raw || raw.length > MAX_SCRIPT_CHARS) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Malformed JSON-LD is common; other sources still apply.
    }
  }
  return out;
}

function types(node: Node): string[] {
  const t = node["@type"];
  const list = Array.isArray(t) ? t : [t];
  return list.filter((x) => typeof x === "string").map((x) => (x as string).split("/").pop() ?? "");
}

/** Every JobPosting object (handles @graph, mainEntity, lists), like the API's job_postings. */
export function findJobPostings(nodes: unknown[]): Node[] {
  const found: Node[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 6 || found.length >= MAX_POSTINGS) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
    } else if (node && typeof node === "object") {
      const obj = node as Node;
      if (types(obj).includes("JobPosting")) found.push(obj);
      for (const key of ["@graph", "mainEntity", "itemListElement", "item"]) {
        if (key in obj) walk(obj[key], depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return found;
}

/** Keep only the properties CareerOS reads, with strings and lists capped. */
export function prune(value: unknown, key = "", depth = 0): unknown {
  if (depth > 6) return undefined;
  if (typeof value === "string") {
    const max = key === "description" ? MAX_DESCRIPTION : MAX_STRING;
    return value.length > max ? value.slice(0, max) : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((v) => prune(v, key, depth + 1)).filter((v) => v !== undefined);
  }
  if (value && typeof value === "object") {
    const out: Node = {};
    for (const [k, v] of Object.entries(value as Node)) {
      if (!KEEP.has(k)) continue;
      const pruned = prune(v, k, depth + 1);
      if (pruned !== undefined) out[k] = pruned;
    }
    return out;
  }
  return undefined;
}

// --- microdata --------------------------------------------------------------------------------

function propValue(el: Element): string | null {
  const tag = el.tagName.toUpperCase();
  const attr =
    el.getAttribute("content") ??
    (tag === "TIME" ? el.getAttribute("datetime") : null) ??
    (tag === "A" || tag === "LINK" ? el.getAttribute("href") : null) ??
    (tag === "IMG" ? el.getAttribute("src") : null) ??
    (tag === "DATA" || tag === "METER" ? el.getAttribute("value") : null);
  if (attr !== null) return attr.trim() || null;
  const text = el.getAttribute("itemprop")?.split(/\s+/).includes("description")
    ? readableText(el, MAX_DESCRIPTION)
    : tidy(el.textContent ?? "").replace(/\n+/g, " ");
  return text.trim() || null;
}

function ownerScope(el: Element): Element | null {
  return (el.parentElement?.closest("[itemscope]") as Element | null) ?? null;
}

function readItem(scope: Element, depth: number): Node {
  const item: Node = { "@type": (scope.getAttribute("itemtype") ?? "").split("/").pop() ?? "" };
  if (depth > 4) return item;
  const props = Array.from(scope.querySelectorAll("[itemprop]")).filter((el) =>
    el.hasAttribute("itemscope") ? ownerScope(el) === scope : el.closest("[itemscope]") === scope,
  );
  for (const el of props.slice(0, 200)) {
    const value = el.hasAttribute("itemscope") ? readItem(el, depth + 1) : propValue(el);
    if (value === null) continue;
    for (const name of (el.getAttribute("itemprop") ?? "").split(/\s+/).filter(Boolean)) {
      const existing = item[name];
      if (existing === undefined) item[name] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else item[name] = [existing, value];
    }
  }
  return item;
}

export function microdataJobPostings(doc: Document): Node[] {
  return Array.from(doc.querySelectorAll('[itemscope][itemtype*="JobPosting" i]'))
    .filter((el) => !el.hasAttribute("itemprop"))
    .slice(0, MAX_POSTINGS)
    .map((el) => readItem(el, 0));
}

export function structuredPostings(doc: Document): { postings: Node[]; source: "json_ld" | "microdata" | null } {
  const fromLd = findJobPostings(parseJsonLd(doc)).map((p) => prune(p) as Node);
  if (fromLd.length) return { postings: fromLd, source: "json_ld" };
  const fromMicro = microdataJobPostings(doc).map((p) => prune(p) as Node);
  return { postings: fromMicro, source: fromMicro.length ? "microdata" : null };
}
