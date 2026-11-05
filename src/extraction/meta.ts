/** Page metadata the API accepts (CAPTURE_META_KEYS in apps/api/app/job_imports/schemas.py). */

export const META_KEYS = [
  "og:title",
  "og:site_name",
  "og:description",
  "og:url",
  "og:type",
  "twitter:title",
  "description",
] as const;

const MAX_META = 1000;
const MAX_URL = 2000;

export function readMeta(doc: Document): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of Array.from(doc.querySelectorAll("meta[property], meta[name]")).slice(0, 400)) {
    const key = (el.getAttribute("property") ?? el.getAttribute("name") ?? "").trim().toLowerCase();
    if (!(META_KEYS as readonly string[]).includes(key) || key in out) continue;
    const value = (el.getAttribute("content") ?? "").replace(/\s+/g, " ").trim();
    if (value) out[key] = value.slice(0, MAX_META);
  }
  return out;
}

/** An absolute http(s) URL, resolved against the page, without the fragment; else null. */
export function absoluteUrl(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    const s = u.toString();
    return s.length <= MAX_URL ? s : null;
  } catch {
    return null;
  }
}

export function canonicalUrl(doc: Document, base: string): string | null {
  const link = doc.querySelector('link[rel~="canonical" i]');
  return absoluteUrl(link?.getAttribute("href"), base);
}

export function documentTitle(doc: Document): string | null {
  const t = (doc.title ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 500) : null;
}
