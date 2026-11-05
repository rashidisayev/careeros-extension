import type { Adapter, PageFields } from "./types";
import { first, hostIs, put, putValue } from "./util";

/** Lever hosted postings: jobs.lever.co/<company>/<id> (and jobs.eu.lever.co). */
export const lever: Adapter = {
  key: "lever",
  matches: (url) => hostIs(url, /(^|\.)lever\.co$/),
  read(doc, url) {
    const fields: PageFields = {};
    put(fields, "title", first(doc, [".posting-headline h2", ".posting-header h2"]));
    put(fields, "location", first(doc, [".posting-categories .location", ".posting-categories .sort-by-location"]));
    put(fields, "employment_type", first(doc, [".posting-categories .commitment", ".posting-categories .sort-by-commitment"]));
    put(fields, "remote_policy", first(doc, [".posting-categories .workplaceTypes"]));
    put(fields, "department", first(doc, [".posting-categories .department", ".posting-categories .sort-by-team"]));
    // The logo's alt text names the company; the slug in the path is only a fallback guess.
    const logo = doc.querySelector(".main-header-logo img[alt]");
    putValue(fields, "company_name", logo?.getAttribute("alt")?.replace(/\s+logo$/i, ""), "explicit");
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length >= 2) putValue(fields, "posting_id", segments[1], "explicit");
    return { fields, description: first(doc, ["[data-qa='job-description']", ".posting-page .content", ".section-wrapper.page-full-width"]) };
  },
};
