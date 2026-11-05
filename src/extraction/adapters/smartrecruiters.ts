import type { Adapter, PageFields } from "./types";
import { first, hostIs, put, putValue } from "./util";

/** SmartRecruiters postings: jobs.smartrecruiters.com/<Company>/<id>-<slug>. */
export const smartrecruiters: Adapter = {
  key: "smartrecruiters",
  matches: (url) => hostIs(url, /(^|\.)smartrecruiters\.com$/),
  read(doc, url) {
    const fields: PageFields = {};
    put(fields, "title", first(doc, ["h1.job-title", "h1[itemprop='title']"]));
    put(fields, "location", first(doc, ["spl-job-location", ".job-location", "[itemprop='jobLocation']"]));
    put(fields, "company_name", first(doc, ["[itemprop='hiringOrganization'] [itemprop='name']"]));
    const id = /\/(\d{6,})(?:-|$)/.exec(url.pathname)?.[1];
    putValue(fields, "posting_id", id, "explicit");
    return { fields, description: first(doc, [".job-sections", "[itemprop='description']"]) };
  },
};
