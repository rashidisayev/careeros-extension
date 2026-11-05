/**
 * AutoFill Phase 2 and 3 in the engine: work history and education, dates, list widgets,
 * ATS adapters, documents, saved answers and job preferences. Fixtures only, never live sites.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { ATS_ADAPTERS, adapter, adapterForHost, adapterKey, detectAts } from "../../src/autofill/adapters";
import { classify, sectionOf } from "../../src/autofill/classifier";
import { dateLabels, dateOption, dateShape, dateText, parseYearMonth } from "../../src/autofill/dates";
import { createRegistry, detectFields } from "../../src/autofill/detector";
import { lexicon } from "../../src/autofill/lexicon";
import { buildPlan, type PlanExtras } from "../../src/autofill/planner";
import type { AtsId, AutofillPlan, AutofillProfile, AutofillSettings, DocumentRef, FieldDescriptor, PlanItem } from "../../src/autofill/types";
import { DEFAULT_AUTOFILL } from "../../src/shared/settings";
import { ANNA, load } from "./autofill-helpers";

const PROFILE: AutofillProfile = {
  ...ANNA,
  experiences: [
    { company: "Nordlicht Payments", title: "Head of Platform", location: "Berlin", start: "2021-04", end: null, current: true, description: "Leads the platform group.", achievements: [] },
    { company: "Kiezbank", title: "Senior SRE", location: "Berlin", start: "2017-09", end: "2021-03", current: false, description: null, achievements: [] },
    { company: "Elbe Logistics", title: "Engineer", location: null, start: "2014-01", end: "2017-08", current: false, description: null, achievements: [] },
  ],
  education: [{ institution: "TU Berlin", degree: "Master of Science", field_of_study: "Computer Science", start_year: 2011, graduation_year: 2013 }],
  skills: ["Kubernetes", "Go", "Terraform"],
  languages: [
    { language: "German", proficiency: "native", cefr: "C2" },
    { language: "English", proficiency: "fluent", cefr: "C1" },
  ],
  certifications: [],
  preferences: { willing_to_relocate: true, remote: ["hybrid", "remote"], employment_types: ["full_time"], preferred_locations: ["Berlin"], salary_min: 95000, salary_target: 110000, salary_currency: "EUR" },
  saved_answers: [
    { id: "a1", field_key: "notice_period", question: "Notice period", answer: "3 months", updated_at: "2026-11-01T00:00:00Z" },
    { id: "a2", field_key: null, question: "How did you hear about Brightwave?", answer: "A former colleague", updated_at: "2026-11-01T00:00:00Z" },
  ],
};

const CV: DocumentRef = { ref: "resume:11111111-1111-1111-1111-111111111111", kind: "cv", name: "Anna Schmidt - CV.pdf", formats: ["pdf"], size: 1000, updated_at: "2026-11-01", recommended: false, note: null };
const OLD_CV: DocumentRef = { ...CV, ref: "resume:33333333-3333-3333-3333-333333333333", name: "CV 2024.docx", formats: ["docx"] };
const LETTER: DocumentRef = {
  ref: "generated:22222222-2222-2222-2222-222222222222",
  kind: "cover_letter",
  name: "Anna Schmidt - Cover letter",
  formats: ["pdf", "docx"],
  size: null,
  updated_at: "2026-11-02",
  recommended: true,
  note: "Prepared for Platform Lead at Brightwave",
};

const WITH_PREFS: AutofillSettings = { ...DEFAULT_AUTOFILL, categories: { ...DEFAULT_AUTOFILL.categories, preferences: true } };

function plan(fixture: string, opts: { profile?: AutofillProfile; settings?: AutofillSettings; url?: string; extras?: PlanExtras } = {}): AutofillPlan {
  load(fixture);
  const url = opts.url ?? location.href;
  const scan = detectFields(document, createRegistry(), { layout: false });
  return buildPlan([{ frameId: 0, result: { ...scan, frameUrl: url } }], opts.profile ?? PROFILE, opts.settings ?? DEFAULT_AUTOFILL, url, { now: 0, ...opts.extras });
}

const all = (items: PlanItem[], label: string) => items.filter((i) => i.label === label);
const one = (items: PlanItem[], label: string) => {
  const found = all(items, label);
  if (found.length !== 1) throw new Error(`${found.length} items labelled ${label}`);
  return found[0]!;
};

function fieldsOf(fixture: string): FieldDescriptor[] {
  load(fixture);
  return detectFields(document, createRegistry(), { layout: false }).fields;
}

describe("sections: which role or school a field belongs to", () => {
  it("places fields by their names and by the heading above them", () => {
    const f = fieldsOf("history-generic.html");
    const byName = (n: string) => f.find((x) => x.signals.name === n)!;
    expect(sectionOf(byName("experience[1][company]"))).toBe("work");
    expect(sectionOf(byName("education[0][school]"))).toBe("education");
    expect(sectionOf(byName("first_name"))).toBeNull();
  });

  it("keeps 'Current job title' under an 'Experience' heading as the applicant's own title", () => {
    const f = fieldsOf("simple-en.html");
    const title = f.find((x) => x.label === "Current job title")!;
    expect(sectionOf(title)).toBe("work");
    expect(classify(title).key).toBe("current_title");
    expect(classify(f.find((x) => x.label === "Current employer")!).key).toBe("current_company");
  });

  it("reads 'Company' and 'From' as a role's only inside a work section", () => {
    document.body.innerHTML = '<form><label for="c">Company</label><input id="c" name="company"><label for="f">From</label><input id="f" name="from"></form>';
    const f = detectFields(document, createRegistry(), { layout: false }).fields;
    expect(f.map((x) => classify(x).key)).not.toContain("work_company");
    expect(f.map((x) => classify(x).key)).not.toContain("work_start");
  });
});

describe("dates", () => {
  const lx = lexicon();
  const field = (patch: Partial<FieldDescriptor>): FieldDescriptor => ({ ...fieldsOf("history-generic.html")[0]!, ...patch });

  it("reads the format a free-text date asks for, and writes the profile's month in it", () => {
    const shape = dateShape(field({ signals: { ...field({}).signals, label: "From (MM.YYYY)" } }), lx, false);
    expect(shape).toEqual({ part: "month_year", format: "MM.YYYY", assumed: false });
    expect(dateText({ year: 2021, month: 4 }, shape)).toBe("04.2021");
  });

  it("gives a full date the first of the month, as an assumption to check", () => {
    const shape = dateShape(field({ kind: "date", inputType: "date" }), lx, false);
    expect(shape).toMatchObject({ part: "date", assumed: true });
    expect(dateText({ year: 2021, month: 4 }, shape)).toBe("2021-04-01");
    expect(dateText({ year: 2021, month: null }, shape)).toBeNull();
  });

  it("finds month and year options by name or number, in English and German", () => {
    const opts = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((label, index) => ({ index, label, value: label }));
    const shape = dateShape(field({ kind: "select", options: opts }), lx, false);
    expect(shape.part).toBe("month");
    expect(dateOption({ year: 2021, month: 5 }, shape, opts, lx)?.label).toBe("May");
    expect(dateLabels({ year: 2021, month: 5 }, shape, lx)).toEqual(expect.arrayContaining(["may", "mai", "05"]));
    const years = ["Year", "2013", "2012", "2011"].map((label, index) => ({ index, label, value: label }));
    const ys = dateShape(field({ kind: "select", options: years }), lx, true);
    expect(dateOption({ year: 2012, month: null }, ys, years, lx)?.index).toBe(2);
  });

  it("parses the profile's months and years", () => {
    expect(parseYearMonth("2019-03")).toEqual({ year: 2019, month: 3 });
    expect(parseYearMonth(2013)).toEqual({ year: 2013, month: null });
    expect(parseYearMonth("soon")).toBeNull();
  });
});

describe("planner: work history and education", () => {
  it("fills each role and school in order, newest first, and says how many more the profile has", () => {
    const p = plan("history-generic.html");
    expect(all(p.items, "Company").map((i) => [i.entry, i.display, i.action])).toEqual([
      [0, "Nordlicht Payments", "fill"],
      [1, "Kiezbank", "fill"],
    ]);
    expect(all(p.items, "Job title").map((i) => i.display)).toEqual(["Head of Platform", "Senior SRE"]);
    expect(all(p.items, "From (MM/YYYY)").map((i) => i.display)).toEqual(["04/2021", "09/2017"]);
    expect(p.more).toEqual({ experiences: 1, education: 0 });
  });

  it("leaves the end date of the current role empty and ticks 'I currently work here' only for it", () => {
    const p = plan("history-generic.html");
    const [toNow, toThen] = all(p.items, "To (MM/YYYY)");
    expect(toNow).toMatchObject({ action: "skip", reasons: ["current_role"], value: null });
    expect(toThen).toMatchObject({ action: "fill", display: "03/2021" });
    expect(all(p.items, "I currently work here").map((i) => i.value)).toEqual([
      { kind: "check", checked: true },
      { kind: "check", checked: false },
    ]);
  });

  it("chooses the degree and graduation year from the lists", () => {
    const p = plan("history-generic.html");
    expect(one(p.items, "University")).toMatchObject({ action: "fill", display: "TU Berlin", entry: 0 });
    expect(one(p.items, "Degree")).toMatchObject({ value: { kind: "option", index: 3 }, display: "Master's degree" });
    expect(one(p.items, "Graduation year")).toMatchObject({ action: "fill", display: "2013" });
  });

  it("asks when the form has a role the profile doesn't", () => {
    const p = plan("history-generic.html", { profile: { ...PROFILE, experiences: PROFILE.experiences!.slice(0, 1) } });
    expect(all(p.items, "Company")[1]).toMatchObject({ action: "ask", reasons: ["history_entry"], value: null });
  });

  it("leaves history alone when the category is off", () => {
    const p = plan("history-generic.html", { settings: { ...DEFAULT_AUTOFILL, categories: { ...DEFAULT_AUTOFILL.categories, history: false } } });
    expect(all(p.items, "Company").every((i) => i.action === "excluded")).toBe(true);
    expect(one(p.items, "First name").action).toBe("fill");
  });

  it("works with an older server that sends no history", () => {
    const p = plan("history-generic.html", { profile: ANNA });
    expect(all(p.items, "Company").every((i) => i.action === "ask" && i.value === null)).toBe(true);
    expect(one(p.items, "Email").action).toBe("fill");
  });
});

describe("planner: job preferences, saved answers, skills", () => {
  it("leaves preferences to the user unless the category is on, and then only suggests them", () => {
    const off = plan("history-generic.html");
    expect(one(off.items, "Are you willing to relocate?")).toMatchObject({ action: "ask", value: null });
    expect(one(off.items, "Expected salary (EUR per year)")).toMatchObject({ action: "ask", reasons: ["sensitive"], value: null });
    const on = plan("history-generic.html", { settings: WITH_PREFS });
    expect(one(on.items, "Are you willing to relocate?")).toMatchObject({ action: "confirm", reasons: ["preference_value"], display: "Yes" });
    expect(one(on.items, "Preferred work arrangement")).toMatchObject({ action: "confirm", value: { kind: "options", indexes: [1, 0] } });
    expect(one(on.items, "Expected salary (EUR per year)")).toMatchObject({ action: "confirm", reasons: ["salary_target"] });
  });

  it("offers a saved answer, unticked, for the same question or the same kind of field", () => {
    const p = plan("history-generic.html");
    expect(one(p.items, "Notice period")).toMatchObject({ action: "confirm", reasons: ["saved_answer"], display: "3 months" });
    const without = plan("history-generic.html", { profile: { ...PROFILE, saved_answers: [] } });
    expect(one(without.items, "Notice period")).toMatchObject({ action: "ask", value: null, answerable: true });
  });

  it("never offers a saved answer for a field the user excluded", () => {
    const p = plan("history-generic.html", { settings: { ...DEFAULT_AUTOFILL, excluded: ["notice_period"] } });
    expect(one(p.items, "Notice period").value).toBeNull();
  });

  it("suggests skills and languages from the profile for confirmation", () => {
    const p = plan("history-generic.html");
    expect(one(p.items, "Skills")).toMatchObject({ action: "confirm", display: "Kubernetes, Go, Terraform" });
    expect(one(p.items, "Which languages do you speak?")).toMatchObject({ action: "confirm", value: { kind: "options", indexes: [1, 0] } });
  });

  it("marks open questions as ones CareerOS can draft, and other questions as ones to answer", () => {
    const p = plan("history-generic.html");
    expect(one(p.items, "Why do you want to join Brightwave?")).toMatchObject({ action: "ask", answerable: true, draftable: true, question: "Why do you want to join Brightwave?" });
    expect(one(p.items, "Notice period").draftable).toBe(false);
  });
});

describe("planner: CVs and cover letters", () => {
  const documents = { application: null, documents: [LETTER, CV, OLD_CV] };

  it("suggests the documents, never ticked, and only in a format the field accepts", () => {
    const p = plan("history-generic.html", { extras: { documents } });
    // The CV field takes PDF only: the DOCX CV is never offered for it.
    expect(one(p.items, "CV")).toMatchObject({ action: "confirm", reasons: ["document_choice"], value: { kind: "file", ref: CV.ref, format: "pdf", name: "Anna Schmidt - CV.pdf" }, document: { kind: "cv", accept: ".pdf" } });
    // The cover letter prepared for this job comes first.
    expect(one(p.items, "Cover letter")).toMatchObject({ action: "confirm", value: { kind: "file", ref: LETTER.ref, format: "pdf", name: "Anna Schmidt - Cover letter.pdf" } });
    expect(p.documents).toEqual(documents.documents);
  });

  it("prefers the user's default CV when nothing was prepared for the job", () => {
    const second = { ...CV, ref: "resume:44444444-4444-4444-4444-444444444444", name: "Anna Schmidt - CV (short).pdf" };
    const p = plan("history-generic.html", { extras: { documents: { application: null, documents: [CV, second] } }, settings: { ...DEFAULT_AUTOFILL, defaultCv: second.ref } });
    expect((one(p.items, "CV").value as { ref: string }).ref).toBe(second.ref);
  });

  it("leaves file fields to the user when CareerOS has no document that fits", () => {
    const p = plan("history-generic.html", { extras: { documents: { application: null, documents: [OLD_CV] } } });
    expect(one(p.items, "CV")).toMatchObject({ action: "ask", reasons: ["document"], value: null });
  });
});

describe("ATS adapters", () => {
  it("covers the eleven vendors of the brief", () => {
    const ids: AtsId[] = ["greenhouse", "lever", "ashby", "workday", "smartrecruiters", "personio", "recruitee", "workable", "teamtailor", "icims", "successfactors"];
    expect(ATS_ADAPTERS.map((a) => a.id).sort()).toEqual([...ids].sort());
  });

  it("knows the vendors' hosts, and nothing else", () => {
    expect(adapterForHost("acme.wd3.myworkdayjobs.com")?.id).toBe("workday");
    expect(adapterForHost("boards.greenhouse.io")?.id).toBe("greenhouse");
    expect(adapterForHost("jobs.lever.co")?.id).toBe("lever");
    expect(adapterForHost("acme.jobs.personio.de")?.id).toBe("personio");
    expect(adapterForHost("career5.successfactors.eu")?.id).toBe("successfactors");
    expect(adapterForHost("greenhouse.io.evil.example")).toBeNull();
    expect(adapterForHost("notlever.co")).toBeNull();
  });

  it("finds a form embedded on the company's own site", () => {
    load("greenhouse-embed.html");
    expect(detectAts(document)).toBe("greenhouse");
    load("simple-en.html");
    expect(detectAts(document)).toBeNull();
  });

  it("adds the vendor's field names as evidence, nothing more", () => {
    const sf = adapter("successfactors")!;
    expect(adapterKey(sf, ["fbclc_fName"])).toBe("first_name");
    document.body.innerHTML = '<form><input id="fbclc_fName" name="fbclc_fName"></form>';
    const [f] = detectFields(document, createRegistry(), { layout: false }).fields;
    expect(classify(f!).key).toBeNull();
    expect(classify(f!, lexicon(), sf).key).toBe("first_name");
  });

  it("never lets an adapter fill a sensitive field", () => {
    const p = plan("ats-personio.html", { url: "https://acme.jobs.personio.de/job/1#apply" });
    expect(p.ats?.id).toBe("personio");
    expect(one(p.items, "Geburtsdatum")).toMatchObject({ action: "ask", value: null });
    expect(one(p.items, "Gehaltsvorstellung")).toMatchObject({ action: "ask", value: null });
  });

  const VENDORS: [string, string, AtsId, string[]][] = [
    ["greenhouse-form.html", "https://boards.greenhouse.io/northwind/jobs/1", "greenhouse", ["First Name", "Last Name", "Email"]],
    ["lever-form.html", "https://jobs.lever.co/northwind/1/apply", "lever", ["Email"]],
    ["ats-ashby.html", "https://jobs.ashbyhq.com/northwind/1/application", "ashby", ["Name", "Email", "Phone", "LinkedIn"]],
    ["workday-form.html", "https://acme.wd3.myworkdayjobs.com/en-US/careers/job/1/apply", "workday", ["Given Name(s)", "Family Name"]],
    ["ats-smartrecruiters.html", "https://jobs.smartrecruiters.com/Northwind/1", "smartrecruiters", ["First name", "Last name", "Email", "Phone number"]],
    ["ats-personio.html", "https://acme.jobs.personio.de/job/1", "personio", ["Vorname", "Nachname", "E-Mail", "Telefon"]],
    ["ats-recruitee.html", "https://acme.recruitee.com/o/platform-lead/c/new", "recruitee", ["Full name", "Email address", "Phone number"]],
    ["ats-workable.html", "https://apply.workable.com/acme/j/ABC123/apply/", "workable", ["First name", "Last name", "Email", "Phone"]],
    ["ats-teamtailor.html", "https://acme.teamtailor.com/jobs/1/applications/new", "teamtailor", ["First name", "Last name", "Email", "Phone", "LinkedIn profile"]],
    ["ats-icims.html", "https://careers-acme.icims.com/jobs/1/login", "icims", ["First Name", "Last Name", "Email", "Phone", "City"]],
    ["ats-successfactors.html", "https://career5.successfactors.eu/careers?company=acme", "successfactors", ["First Name", "Last Name", "Email", "Cell Phone", "City"]],
  ];

  it.each(VENDORS)("%s: recognised as %s and filled from the profile", (fixture, url, id, filled) => {
    const p = plan(fixture, { url });
    expect(p.isApplicationForm).toBe(true);
    expect(p.ats?.id).toBe(id);
    for (const label of filled) expect(one(p.items, label).action, label).toBe("fill");
    // The same rules hold everywhere: nothing sensitive, no consent, no file without a choice.
    expect(p.items.filter((i) => i.action === "fill" && (i.category === "sensitive" || i.kind === "file"))).toEqual([]);
  });
});

describe("planner: steps of a multi-step form", () => {
  const WORKDAY = "https://acme.wd3.myworkdayjobs.com/en-US/careers/job/Berlin/Platform-Lead_R-1/apply/applyManually";

  it("treats Workday's 'My Experience' step as part of the application, though it asks for no name", () => {
    const p = plan("workday-experience.html", { url: WORKDAY });
    expect(p.isApplicationForm).toBe(true);
    expect(p.ats).toEqual({ id: "workday", name: "Workday" });
  });

  it("matches Workday's numbered entries to the profile's roles and fills month and year separately", () => {
    const p = plan("workday-experience.html", { url: WORKDAY });
    expect(all(p.items, "Job Title").map((i) => [i.entry, i.display])).toEqual([
      [0, "Head of Platform"],
      [1, "Senior SRE"],
    ]);
    const months = all(p.items, "Month").map((i) => [i.key, i.entry, i.display]);
    expect(months).toEqual([
      ["work_start", 0, "04"],
      ["work_start", 1, "09"],
      ["work_end", 1, "03"],
    ]);
    expect(all(p.items, "Year").map((i) => i.display)).toEqual(["2021", "2017", "2021"]);
  });

  it("chooses the degree from Workday's list widget by its entries, for the user to confirm", () => {
    const p = plan("workday-experience.html", { url: WORKDAY });
    const degree = one(p.items, "Degree");
    expect(degree).toMatchObject({ kind: "custom", action: "confirm", reasons: ["list_choice"] });
    expect((degree.value as { picks: string[][] }).picks[0]).toEqual(expect.arrayContaining(["Master of Science", "master s degree"]));
  });

  it("on an unknown site, a step with only a few unrelated fields is not an application", () => {
    document.body.innerHTML = '<form><label for="a">Company</label><input id="a"><label for="b">Notes</label><textarea id="b"></textarea></form>';
    const scan = detectFields(document, createRegistry(), { layout: false });
    expect(buildPlan([{ frameId: 0, result: { ...scan, frameUrl: location.href } }], PROFILE, DEFAULT_AUTOFILL, location.href).isApplicationForm).toBe(false);
  });
});

beforeEach(() => {
  document.body.innerHTML = "";
});
