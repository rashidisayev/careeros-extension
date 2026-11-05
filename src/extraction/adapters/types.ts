import type { Basis } from "../../shared/types";

/** Page field names the API accepts from an adapter (CAPTURE_PAGE_FIELDS). */
export const PAGE_FIELDS = [
  "title",
  "company_name",
  "location",
  "employment_type",
  "remote_policy",
  "department",
  "date_posted",
  "deadline",
  "posting_id",
] as const;
export type PageFieldName = (typeof PAGE_FIELDS)[number];
export type PageFields = Partial<Record<PageFieldName, { value: string; basis: Basis }>>;

export type AdapterResult = {
  fields: PageFields;
  /** The element holding the posting's description, if the adapter knows it. */
  description: Element | null;
};

/**
 * A site adapter reads a posting from markup it knows. Adapters only read the page the user
 * has open; they never click, scroll, log in or fetch anything.
 */
export type Adapter = {
  key: string;
  /** Hostname match; `read` may still find nothing (a listing page, a different layout). */
  matches(url: URL): boolean;
  read(doc: Document, url: URL): AdapterResult;
};
