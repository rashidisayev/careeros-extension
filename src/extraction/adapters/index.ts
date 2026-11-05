import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { smartrecruiters } from "./smartrecruiters";
import type { Adapter } from "./types";
import { workday } from "./workday";

export { readGeneric, mainContent } from "./generic";
export type { Adapter, AdapterResult, PageFields, PageFieldName } from "./types";
export { PAGE_FIELDS } from "./types";

/**
 * Site adapters by host. Every other site (Ashby, Personio, Recruitee, JOIN, Workable, company
 * career pages) takes the generic path: JSON-LD or microdata when the page publishes it, then
 * metadata, a visible heading and the main content.
 */
export const ADAPTERS: Adapter[] = [greenhouse, lever, workday, smartrecruiters];

export function adapterFor(url: URL): Adapter | null {
  return ADAPTERS.find((a) => a.matches(url)) ?? null;
}
