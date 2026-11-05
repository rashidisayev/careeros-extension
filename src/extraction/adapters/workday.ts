import type { Adapter, PageFields } from "./types";
import { first, hostIs, put } from "./util";

/** Workday career sites (*.myworkdayjobs.com), which label their parts with data-automation-id. */
export const workday: Adapter = {
  key: "workday",
  matches: (url) => hostIs(url, /(^|\.)myworkdayjobs\.com$|(^|\.)myworkdaysite\.com$/),
  read(doc) {
    const fields: PageFields = {};
    const auto = (id: string) => `[data-automation-id="${id}"]`;
    put(fields, "title", first(doc, [auto("jobPostingHeader")]));
    put(fields, "location", first(doc, [`${auto("locations")} dd`, auto("locations")]));
    put(fields, "employment_type", first(doc, [`${auto("time")} dd`, auto("time")]));
    put(fields, "remote_policy", first(doc, [`${auto("remoteType")} dd`, auto("remoteType")]));
    // "Posted 3 Days Ago" is relative; the API keeps only ISO dates, so it is not sent.
    put(fields, "posting_id", first(doc, [`${auto("requisitionId")} dd`, auto("requisitionId")]));
    return { fields, description: first(doc, [auto("jobPostingDescription")]) };
  },
};
