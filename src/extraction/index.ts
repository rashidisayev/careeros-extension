/**
 * Reads the job posting from the page the user has open. Runs inside the page (injected on
 * the user's action with activeTab, or on sites they allowed), returns plain data and keeps
 * nothing. Order, as the GetCareer import pipeline expects:
 *   1. schema.org JobPosting (JSON-LD, then microdata)
 *   2. Open Graph and page metadata
 *   3. a site adapter's labelled elements, else a visible heading and the main content
 * The user reviews and corrects every value before anything is saved (step 5, in the UI),
 * and the API extracts again from this capture with its own code.
 */
import { EXTENSION_VERSION } from "../shared/config";
import { restrictedPlatformFor } from "../shared/policy";
import type { Extraction, LocalFields, LocalSource, PageCapture } from "../shared/types";
import { adapterFor, readGeneric, type PageFields } from "./adapters";
import { pageSignals, scoreSignals } from "./detect";
import { canonicalUrl, documentTitle, readMeta } from "./meta";
import {
  cleanTitle,
  companyFromSiteName,
  employmentTypeFrom,
  isoDate,
  remotePolicyFrom,
  salaryFrom,
  textOf,
  titleFromDocumentTitle,
} from "./normalize";
import { structuredPostings } from "./structured";
import { readableText } from "./text";

const MAX_JSONLD_BYTES = 200_000;
const MAX_TEXT = 60_000;
const DESCRIPTION_ENOUGH = 150;

type Node = Record<string, unknown>;

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Keep the structured data under the API's size limit, trimming descriptions first. */
export function fitJsonLd(postings: Node[]): Node[] {
  let out = postings.slice(0, 3);
  if (bytes(out) <= MAX_JSONLD_BYTES) return out;
  out = out.map((p) =>
    typeof p.description === "string" ? { ...p, description: p.description.slice(0, 40_000) } : p,
  );
  if (bytes(out) <= MAX_JSONLD_BYTES) return out;
  out = out.slice(0, 1);
  return bytes(out) <= MAX_JSONLD_BYTES ? out : [];
}

function fromPosting(p: Node, fields: LocalFields): void {
  const src = { basis: "explicit" as const, source: "structured_data" as LocalSource, confidence: "high" as const };
  const set = (name: keyof LocalFields, value: string | null) => {
    if (value && !fields[name]) fields[name] = { value: value.slice(0, 500), ...src };
  };
  set("title", cleanTitle(textOf(p.title) ?? textOf(p.name)));
  const org = p.hiringOrganization;
  set("company_name", typeof org === "string" ? textOf(org) : textOf((org as Node | undefined)?.name));
  const locs = Array.isArray(p.jobLocation) ? p.jobLocation : p.jobLocation ? [p.jobLocation] : [];
  const address = (locs[0] as Node | undefined)?.address;
  if (address && typeof address === "object" && !Array.isArray(address)) {
    const a = address as Node;
    set("location", [textOf(a.addressLocality), textOf(a.addressRegion), textOf(a.addressCountry)].filter(Boolean).join(", ") || null);
  } else if (typeof address === "string") {
    set("location", textOf(address));
  }
  if (String(p.jobLocationType ?? "").toUpperCase() === "TELECOMMUTE") set("remote_policy", "remote");
  const emp = Array.isArray(p.employmentType) ? p.employmentType : [p.employmentType];
  for (const e of emp) set("employment_type", employmentTypeFrom(textOf(e)));
  set("salary", salaryFrom(p.baseSalary));
  set("date_posted", isoDate(p.datePosted));
  set("deadline", isoDate(p.validThrough));
}

function fromPageFields(pf: PageFields, fields: LocalFields): void {
  for (const [name, f] of Object.entries(pf)) {
    if (!f || name === "posting_id" || name === "department") continue;
    const key = name as keyof LocalFields;
    if (fields[key]) continue;
    let value: string | null = f.value;
    if (key === "title") value = cleanTitle(value);
    else if (key === "employment_type") value = employmentTypeFrom(value);
    else if (key === "remote_policy") value = remotePolicyFrom(value);
    else if (key === "date_posted" || key === "deadline") value = isoDate(value);
    if (value) {
      fields[key] = { value, basis: f.basis, source: "page", confidence: f.basis === "explicit" ? "medium" : "low" };
    }
  }
}

function fromMeta(meta: Record<string, string>, docTitle: string | null, fields: LocalFields): void {
  const src = { basis: "inferred" as const, source: "meta" as LocalSource, confidence: "low" as const };
  if (!fields.title) {
    const t = titleFromDocumentTitle(meta["og:title"] ?? meta["twitter:title"] ?? docTitle);
    if (t) fields.title = { value: t, ...src };
  }
  if (!fields.company_name) {
    const c = companyFromSiteName(meta["og:site_name"]);
    if (c) fields.company_name = { value: c, ...src };
  }
}

/**
 * The posting on this page, or null where the extension must not read pages (platforms whose
 * terms forbid automated access; the API refuses those captures as well).
 */
export function extractPage(doc: Document, href: string): Extraction | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (restrictedPlatformFor(href)) return null;
  url.hash = "";

  const { postings } = structuredPostings(doc);
  const adapter = adapterFor(url);
  const read = adapter ? adapter.read(doc, url) : readGeneric(doc);
  const generic = adapter ? readGeneric(doc) : read;
  const meta = readMeta(doc);
  const docTitle = documentTitle(doc);

  const fields: LocalFields = {};
  if (postings.length === 1 && postings[0]) fromPosting(postings[0], fields);
  fromPageFields(read.fields, fields);
  if (adapter) fromPageFields(generic.fields, fields);
  fromMeta(meta, docTitle, fields);

  // Microdata travels as JSON-LD-shaped objects so the API reads both the same way.
  const jsonLd = fitJsonLd(postings);
  const structuredDescription = postings.length === 1 ? textOf(postings[0]?.description) ?? "" : "";
  const root = read.description ?? generic.description;
  // Data minimisation: when the structured data already carries the description, the page
  // text is not sent as well.
  const description =
    jsonLd.length === 1 && structuredDescription.length >= DESCRIPTION_ENOUGH
      ? null
      : root
        ? readableText(root, MAX_TEXT) || null
        : null;

  const capture: PageCapture = {
    url: url.toString().slice(0, 2000),
    canonical_url: canonicalUrl(doc, url.toString()),
    document_title: docTitle,
    meta,
    json_ld: jsonLd,
    // The adapter's labelled values win over the generic heading guess.
    page_fields: { ...(adapter ? generic.fields : {}), ...read.fields } as PageCapture["page_fields"],
    description_text: description,
    adapter: adapter?.key ?? "generic",
    extension_version: EXTENSION_VERSION,
  };

  const { confidence, signals } = scoreSignals({
    structured: postings.length,
    adapterTitle: !!(adapter && read.fields.title),
    title: !!fields.title,
    ...pageSignals(doc, url),
  });

  return { url: capture.url, adapter: capture.adapter, confidence, signals, fields, capture };
}
