import { beforeEach, describe, expect, it } from "vitest";
import { createRegistry, detectFields, type Registry } from "../../src/autofill/detector";
import { buildPlan } from "../../src/autofill/planner";
import type { AutofillProfile, AutofillSettings, PlanItem } from "../../src/autofill/types";
import { DEFAULT_AUTOFILL } from "../../src/shared/settings";
import { ANNA, e, load } from "./autofill-helpers";

let registry: Registry;
beforeEach(() => {
  registry = createRegistry();
});

function scan() {
  return detectFields(document, registry, { layout: false });
}

function plan(fixture: string, profile: AutofillProfile = ANNA, settings: AutofillSettings = DEFAULT_AUTOFILL) {
  load(fixture);
  return buildPlan([{ frameId: 0, result: scan() }], profile, settings, "https://jobs.northwind.example/apply", 1);
}

const byLabel = (items: PlanItem[], label: string) => {
  const hit = items.find((i) => i.label === label);
  if (!hit) throw new Error(`no field labelled ${label}: ${items.map((i) => i.label).join(" | ")}`);
  return hit;
};

describe("detector", () => {
  it("finds the controls and describes them without reading their values", () => {
    load("repeated.html");
    const r = scan();
    expect(r.fields).toHaveLength(9);
    const phone = r.fields.find((f) => f.label === "Phone")!;
    expect(phone.hasValue).toBe(true);
    // Whether a field is filled is known; what it holds never leaves the page.
    expect(JSON.stringify(r)).not.toContain("999999");
  });

  it("skips hidden, password, submit and hidden-by-style controls", () => {
    load("simple-en.html");
    const r = scan();
    const names = r.fields.map((f) => f.signals.name);
    expect(names).not.toContain("token");
    expect(names).not.toContain("pw");
    expect(r.fields.some((f) => f.kind === "custom")).toBe(false);
  });

  it("groups controls by form, and recognises search forms", () => {
    load("simple-en.html");
    const r = scan();
    expect(r.groups).toHaveLength(3);
    expect(r.groups[0]).toMatchObject({ isSearch: true, controlCount: 1 });
    expect(r.groups[1]).toMatchObject({ controlCount: 19, hasPassword: false });
  });

  it("reads a radio group as one field with its legend and options", () => {
    load("simple-en.html");
    const radio = scan().fields.find((f) => f.kind === "radio")!;
    expect(radio.label).toBe("Do you have people management experience?");
    expect(radio.options.map((o) => o.label)).toEqual(["Yes", "No"]);
  });

  it("reads select options, required markers and length limits", () => {
    load("simple-de.html");
    const r = scan();
    const land = r.fields.find((f) => f.label === "Land")!;
    expect(land.options.map((o) => o.label)).toEqual(["Bitte wählen", "Österreich", "Deutschland", "Schweiz"]);
    expect(land.hasValue).toBe(false); // the placeholder option isn't a value
    expect(r.fields.find((f) => f.label === "Vorname")!.required).toBe(true);
    expect(r.fields.find((f) => f.label === "PLZ")!.maxLength).toBe(5);
    expect(r.lang).toBe("de");
  });

  it("finds labels through aria-labelledby (Workday) and the surrounding markup (Lever)", () => {
    load("workday-form.html");
    expect(scan().fields.map((f) => f.label)).toContain("Given Name(s)");
    load("lever-form.html");
    registry = createRegistry();
    const lever = scan();
    expect(lever.fields.map((f) => f.label)).toContain("Current company");
    expect(lever.fields.find((f) => f.label === "Full name")!.required).toBe(true);
  });

  it("keeps ids stable across scans and finds fields added later", () => {
    load("greenhouse-form.html");
    const first = scan();
    const extra = document.createElement("div");
    extra.innerHTML = '<label for="gh">GitHub</label><input id="gh" name="github">';
    document.querySelector("#custom_fields")!.append(extra);
    const second = scan();
    expect(second.fields.slice(0, first.fields.length).map((f) => f.id)).toEqual(first.fields.map((f) => f.id));
    expect(second.fields).toHaveLength(first.fields.length + 1);
    expect(second.fields.at(-1)!.label).toBe("GitHub");
  });

  it("looks inside open shadow roots", () => {
    load("unsupported.html");
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<form><label for="s1">Vorname</label><input id="s1"><label for="s2">Nachname</label><input id="s2"><label for="s3">E-Mail</label><input id="s3" type="email"></form>';
    const labels = scan().fields.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(["Vorname", "Nachname", "E-Mail"]));
  });
});

describe("planner: English form", () => {
  it("fills what is clear, asks what isn't, and counts both", () => {
    const p = plan("simple-en.html");
    expect(p.isApplicationForm).toBe(true);
    const a = (l: string) => byLabel(p.items, l);
    expect(a("First name")).toMatchObject({ action: "fill", confidence: "high", display: "Anna" });
    expect(a("Email address")).toMatchObject({ action: "fill", value: { kind: "text", text: "anna@example.com" } });
    expect(a("Country")).toMatchObject({ action: "fill", value: { kind: "option", index: 2 }, display: "Germany" });
    expect(a("Years of experience")).toMatchObject({ action: "fill", display: "12" });
    expect(a("LinkedIn profile")).toMatchObject({ action: "fill" });
    // Yes/no wording varies: a suggestion to confirm.
    expect(a("Do you have people management experience?")).toMatchObject({ action: "confirm", value: { kind: "option", index: 0 } });
    expect(a("Resume/CV")).toMatchObject({ action: "ask", reasons: ["document"] });
    expect(a("Why do you want to work at Northwind?")).toMatchObject({ action: "ask", reasons: ["question"] });
    expect(p.counts).toEqual({ detected: 19, ready: 11, confirm: 1, input: 7, keep: 0, excluded: 0, filled: 0 });
  });

  it("never touches the search box or the newsletter form on the same page", () => {
    const p = plan("simple-en.html");
    expect(p.items.some((i) => i.label === "Search jobs" || i.label === "Get job alerts by email")).toBe(false);
  });

  it("finds no application form on a page with only a login, a search and a contact box", () => {
    const p = plan("unsupported.html");
    expect(p.isApplicationForm).toBe(false);
    expect(p.items).toEqual([]);
  });
});

describe("planner: no invented or sensitive values", () => {
  it("asks for what the profile doesn't hold, and lists it as missing", () => {
    const values = { ...ANNA.values };
    delete values.phone;
    delete values.github_url;
    const p = plan("simple-en.html", { ...ANNA, values });
    expect(byLabel(p.items, "Phone number")).toMatchObject({ action: "ask", reasons: ["missing_in_profile"], value: null });
    expect(byLabel(p.items, "GitHub")).toMatchObject({ action: "ask", value: null });
    expect(p.missingProfileKeys).toEqual(expect.arrayContaining(["phone", "github_url"]));
  });

  it("never fills sensitive, legal or preference fields, even if a value existed", () => {
    const values: AutofillProfile["values"] = {
      ...ANNA.values,
      salary_expectation: e("90000"),
      gender: e("Female"),
      work_authorization: e(true),
      nationality: e("German"),
      date_of_birth: e("1990-01-01"),
      notice_period: e("3 months"),
    };
    for (const fixture of ["simple-en.html", "simple-de.html", "greenhouse-form.html"]) {
      registry = createRegistry();
      const p = plan(fixture, { ...ANNA, values });
      const sensitive = p.items.filter((i) => i.category === "sensitive" || i.category === "preferences" || i.category === "consent");
      expect(sensitive.length).toBeGreaterThan(0);
      for (const i of sensitive) expect(i).toMatchObject({ action: "ask", value: null });
    }
  });

  it("only suggests values GetCareer derived (first name from the full name)", () => {
    const p = plan("simple-en.html", { ...ANNA, values: { ...ANNA.values, first_name: { value: "Anna", basis: "derived" } } });
    expect(byLabel(p.items, "First name")).toMatchObject({ action: "confirm", confidence: "medium", reasons: ["derived_value"] });
  });

  it("asks when no option on the page fits the profile", () => {
    const p = plan("simple-en.html", { ...ANNA, values: { ...ANNA.values, country: e("FR") } });
    expect(byLabel(p.items, "Country")).toMatchObject({ action: "ask", reasons: ["no_matching_option"] });
  });

  it("refuses values longer than the field allows", () => {
    const p = plan("simple-de.html", { ...ANNA, values: { ...ANNA.values, postal_code: e("10119-123") } });
    expect(byLabel(p.items, "PLZ")).toMatchObject({ action: "ask", reasons: ["too_long"] });
  });
});

describe("planner: unclear labels", () => {
  it("fills only what is clear, suggests the vague, and asks the rest", () => {
    const p = plan("ambiguous.html");
    expect(p.isApplicationForm).toBe(true);
    // Labels from the text next to unlabelled inputs.
    expect(byLabel(p.items, "Name")).toMatchObject({ key: "full_name", action: "fill" });
    expect(byLabel(p.items, "Email")).toMatchObject({ key: "email", action: "fill" });
    expect(byLabel(p.items, "Phone")).toMatchObject({ key: "phone", action: "fill" });
    // A bare "Company" could be any company: a suggestion, unticked.
    expect(byLabel(p.items, "Company")).toMatchObject({ key: "current_company", action: "confirm", confidence: "medium" });
    // "Title" with Mr / Ms / Dr is a salutation, which is never filled.
    expect(byLabel(p.items, "Title")).toMatchObject({ key: "salutation", action: "ask", reasons: ["sensitive"] });
    for (const label of ["Position", "Field 7", "Years of experience with Kubernetes"]) {
      expect(byLabel(p.items, label)).toMatchObject({ key: null, action: "ask", reasons: ["not_recognised"], value: null });
    }
    expect(byLabel(p.items, "Which city would you like to work in?")).toMatchObject({ action: "ask", value: null });
    expect(p.counts).toMatchObject({ detected: 9, ready: 3, confirm: 1, input: 5 });
  });
});

describe("planner: German form", () => {
  it("maps German labels and options", () => {
    const p = plan("simple-de.html");
    const a = (l: string) => byLabel(p.items, l);
    expect(a("Vorname")).toMatchObject({ action: "fill", display: "Anna" });
    expect(a("Telefonnummer")).toMatchObject({ action: "fill", display: "+49 151 2345678" });
    expect(a("Straße und Hausnummer")).toMatchObject({ action: "fill", display: "Torstraße 1" });
    expect(a("Land")).toMatchObject({ action: "fill", display: "Deutschland" });
    expect(a("Berufserfahrung")).toMatchObject({ action: "fill", display: "mehr als 10 Jahre" });
    expect(a("Anrede")).toMatchObject({ action: "ask", reasons: ["sensitive"] });
    expect(a("Gehaltsvorstellung (brutto/Jahr)")).toMatchObject({ action: "ask", reasons: ["sensitive"] });
    expect(a("Kündigungsfrist")).toMatchObject({ action: "ask", reasons: ["preference"] });
  });
});

describe("planner: repeated fields, other people and existing values", () => {
  it("fills the applicant's fields once, leaves references alone, and asks about repeats", () => {
    const p = plan("repeated.html");
    const items = p.items;
    expect(items[0]).toMatchObject({ label: "Full name", action: "fill" });
    expect(items[1]).toMatchObject({ label: "Email", action: "fill" });
    // "Confirm email" is expected to repeat.
    expect(items[2]).toMatchObject({ label: "Confirm email", action: "fill" });
    // Already has a value: kept unless the user chooses to replace it.
    expect(items[3]).toMatchObject({ label: "Phone", action: "keep" });
    expect(items[3]!.reasons).toContain("has_value");
    // Reference and emergency contact: someone else's details.
    for (const i of items.slice(4, 8)) expect(i).toMatchObject({ action: "skip", reasons: ["other_person"] });
    // A second "Full name" for the applicant: confirm, don't assume.
    expect(items[8]).toMatchObject({ action: "confirm", reasons: ["repeated_field"] });
  });
});

describe("planner: settings", () => {
  it("leaves out excluded fields and switched-off categories", () => {
    const settings: AutofillSettings = { ...DEFAULT_AUTOFILL, categories: { ...DEFAULT_AUTOFILL.categories, professional: false }, excluded: ["phone"] };
    const p = plan("simple-en.html", ANNA, settings);
    expect(byLabel(p.items, "Phone number")).toMatchObject({ action: "excluded", reasons: ["excluded_field"] });
    expect(byLabel(p.items, "Current employer")).toMatchObject({ action: "excluded", reasons: ["excluded_category"] });
    expect(byLabel(p.items, "LinkedIn profile").action).toBe("fill");
    expect(p.counts.excluded).toBe(5);
  });
});

describe("planner: ATS forms through the generic engine", () => {
  it("Greenhouse: names, contact, links; the city suggested for 'Location (City)'", () => {
    const p = plan("greenhouse-form.html");
    expect(p.items.filter((i) => i.action === "fill").map((i) => i.label)).toEqual(["First Name", "Last Name", "Email", "Phone", "LinkedIn Profile"]);
    expect(byLabel(p.items, "Location (City)")).toMatchObject({ action: "confirm", display: "Berlin, Germany" });
    expect(byLabel(p.items, "Are you legally authorized to work in Germany?").action).toBe("ask");
  });

  it("Lever: one full-name field and the link list", () => {
    const p = plan("lever-form.html");
    expect(byLabel(p.items, "Full name")).toMatchObject({ action: "fill", display: "Anna Schmidt" });
    expect(byLabel(p.items, "Current company")).toMatchObject({ action: "fill", display: "Nordlicht Payments" });
    expect(byLabel(p.items, "GitHub URL").action).toBe("fill");
    expect(byLabel(p.items, "Portfolio URL")).toMatchObject({ action: "ask", reasons: ["missing_in_profile"] });
  });

  it("Workday: a separate country code takes the code, and the number goes in without it", () => {
    const p = plan("workday-form.html");
    expect(byLabel(p.items, "Country Phone Code")).toMatchObject({ action: "fill", display: "Germany (+49)" });
    expect(byLabel(p.items, "Phone Number")).toMatchObject({ action: "fill", display: "151 2345678" });
    expect(byLabel(p.items, "How Did You Hear About Us?")).toMatchObject({ action: "ask" });
  });

  it("Workday: +1 is the US or Canada, so the profile's country decides (as a suggestion)", () => {
    const p = plan("workday-form.html", { ...ANNA, values: { ...ANNA.values, phone: e("+1 415 555 0100"), country: e("CA") } });
    expect(byLabel(p.items, "Country Phone Code")).toMatchObject({ action: "confirm", display: "Canada (+1)" });
    registry = createRegistry();
    const unknown = plan("workday-form.html", { ...ANNA, values: { ...ANNA.values, phone: e("+1 415 555 0100"), country: e("MX") } });
    expect(byLabel(unknown.items, "Country Phone Code")).toMatchObject({ action: "ask", reasons: ["no_matching_option"] });
  });
});

describe("planner: Greenhouse job boards (comboboxes, phone country picker)", () => {
  it("is an application form, though the phone picker holds a search box", () => {
    const p = plan("greenhouse-job-boards.html");
    expect(p.isApplicationForm).toBe(true);
    for (const label of ["First Name", "Last Name", "Email", "Phone", "LinkedIn Profile"]) expect(byLabel(p.items, label)).toMatchObject({ action: "fill" });
    // The picker's search box isn't a field, and the job search above the form is left alone.
    expect(p.items.some((i) => /search/i.test(i.label))).toBe(false);
  });

  it("picks from list widgets by their entries, as a suggestion to confirm; the location search stays with the user", () => {
    const p = plan("greenhouse-job-boards.html");
    const country = byLabel(p.items, "Country");
    expect(country).toMatchObject({ kind: "custom", action: "confirm", reasons: ["list_choice"], display: "Germany" });
    expect(country.value).toMatchObject({ kind: "choose" });
    expect((country.value as { picks: string[][] }).picks[0]).toContain("Germany");
    expect(byLabel(p.items, "Location (City)")).toMatchObject({ kind: "custom", action: "ask", value: null });
    expect(byLabel(p.items, "Gender")).toMatchObject({ action: "ask", reasons: ["sensitive"], value: null });
  });

  it("still treats a small form with a search box as a search", () => {
    document.body.innerHTML =
      '<form><input type="search" aria-label="Keywords"><label for="w">Where</label><input id="w"><select aria-label="Radius"><option>10 km</option></select></form>';
    expect(scan().groups).toEqual([expect.objectContaining({ isSearch: true })]);
    load("greenhouse-job-boards.html");
    expect(scan().groups).toEqual([expect.objectContaining({ isSearch: false, controlCount: 10 })]);
  });
});

describe("planner: frames", () => {
  it("plans every frame's form under its own frame id and origin", () => {
    load("lever-form.html");
    const lever = detectFields(document, createRegistry(), { layout: false });
    const p = buildPlan(
      [
        { frameId: 0, result: { ...lever, fields: [], groups: [] } },
        { frameId: 3, result: { ...lever, frameUrl: "https://jobs.lever.co/northwind/apply" } },
      ],
      ANNA,
      DEFAULT_AUTOFILL,
      "https://northwind.example/careers",
    );
    expect(p.items.length).toBe(9);
    expect(new Set(p.items.map((i) => `${i.frameId} ${i.frameOrigin}`))).toEqual(new Set(["3 https://jobs.lever.co"]));
  });
});
