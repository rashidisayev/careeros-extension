import type { Adapter, PageFields } from "./types";
import { first, hostIs, put, putValue } from "./util";

/** Greenhouse hosted job boards: boards.greenhouse.io (classic) and job-boards.greenhouse.io. */
export const greenhouse: Adapter = {
  key: "greenhouse",
  matches: (url) => hostIs(url, /(^|\.)greenhouse\.io$/),
  read(doc, url) {
    const fields: PageFields = {};
    put(fields, "title", first(doc, ["#header .app-title", ".job__title h1", "h1.section-header", ".job-title"]));
    const company = first(doc, ["#header .company-name", ".job__title .company-name"]);
    // Classic boards print "at Acme".
    putValue(fields, "company_name", company?.textContent?.replace(/^\s*at\s+/i, ""), "explicit");
    put(fields, "location", first(doc, ["#header .location", ".job__location"]));
    const id = /\/jobs\/(\d+)/.exec(url.pathname)?.[1] ?? url.searchParams.get("gh_jid");
    putValue(fields, "posting_id", id, "explicit");
    return { fields, description: first(doc, ["#content", ".job__description", "[data-testid='job-description']"]) };
  },
};
