import { describe, expect, it } from "vitest";
import { classify } from "../../src/autofill/classifier";
import { de } from "../../src/autofill/lexicon/de";
import { en } from "../../src/autofill/lexicon/en";
import { lexicon } from "../../src/autofill/lexicon";
import type { ControlKind, FieldDescriptor, FieldSignals } from "../../src/autofill/types";

/** A descriptor as the detector would produce it, without a page. */
function d(signals: FieldSignals, kind: ControlKind = "text", options: string[] = []): FieldDescriptor {
  return {
    id: "f1",
    kind,
    group: "g1",
    label: signals.label ?? "",
    signals,
    options: options.map((label, index) => ({ index, value: label, label })),
    required: false,
    multiple: false,
    maxLength: null,
    hasValue: false,
    filledByCareerOS: "no",
  };
}

describe("classifier: the labels in the brief", () => {
  it.each([
    ["First Name", "first_name"],
    ["Given Name", "first_name"],
    ["Last Name", "last_name"],
    ["Family Name", "last_name"],
    ["Email", "email"],
    ["Mobile Phone", "phone"],
    ["Current Employer", "current_company"],
    ["Current Position", "current_title"],
    ["LinkedIn Profile", "linkedin_url"],
    ["Years of Experience", "years_of_experience"],
    ["Country", "country"],
    ["City", "city"],
  ])("English %s → %s (high)", (label, key) => {
    const kind: ControlKind = key === "country" ? "select" : "text";
    const c = classify(d({ label }, kind));
    expect(c.key).toBe(key);
    expect(c.level).toBe("high");
  });

  it.each([
    ["Vorname", "first_name"],
    ["Nachname", "last_name"],
    ["Telefonnummer", "phone"],
    ["Aktueller Arbeitgeber", "current_company"],
    ["Berufserfahrung", "years_of_experience"],
    ["Gehaltsvorstellung", "salary_expectation"],
    ["E-Mail-Adresse *", "email"],
    ["Straße und Hausnummer", "street_address"],
    ["PLZ", "postal_code"],
    ["Wohnort", "city"],
    ["Staatsangehörigkeit", "nationality"],
    ["Geburtsdatum", "date_of_birth"],
    ["Kündigungsfrist", "notice_period"],
    ["Lebenslauf", "resume"],
  ])("German %s → %s", (label, key) => {
    const kind: ControlKind = key === "resume" ? "file" : "text";
    expect(classify(d({ label }, kind)).key).toBe(key);
  });
});

describe("classifier: signals besides the label", () => {
  it("trusts the page's autocomplete attribute", () => {
    expect(classify(d({ autocomplete: "given-name" }))).toMatchObject({ key: "first_name", level: "high", source: "autocomplete" });
    expect(classify(d({ autocomplete: "section-apply shipping postal-code" })).key).toBe("postal_code");
    expect(classify(d({ autocomplete: "off", label: "Email" }, "email")).key).toBe("email");
  });

  it("reads field names and ids like a person would (camelCase, brackets, ATS prefixes)", () => {
    expect(classify(d({ name: "job_application[first_name]" })).key).toBe("first_name");
    expect(classify(d({ id: "candidateLastName" })).key).toBe("last_name");
    expect(classify(d({ name: "urls[LinkedIn]" })).key).toBe("linkedin_url");
    expect(classify(d({ dataId: "legalNameSection_firstName" })).key).toBe("first_name");
    // Names alone are weaker evidence than a visible label.
    expect(classify(d({ name: "job_application[first_name]" })).level).toBe("medium");
  });

  it("uses placeholders, ARIA and the text around unlabelled fields", () => {
    expect(classify(d({ placeholder: "Your e-mail address" })).key).toBe("email");
    expect(classify(d({ aria: "Telefonnummer" })).key).toBe("phone");
    expect(classify(d({ context: "Postal code" })).key).toBe("postal_code");
  });

  it("takes the input type as evidence", () => {
    expect(classify(d({}, "email"))).toMatchObject({ key: "email", source: "type" });
    expect(classify(d({}, "tel")).key).toBe("phone");
  });
});

describe("classifier: ambiguity and things that aren't what they seem", () => {
  it("treats a bare 'Company' as a suggestion, not a fact", () => {
    expect(classify(d({ label: "Company" }))).toMatchObject({ key: "current_company", level: "medium" });
    expect(classify(d({ label: "Firma" }))).toMatchObject({ key: "current_company", level: "medium" });
  });

  it("recognises a salutation from its options, whatever the label", () => {
    expect(classify(d({ label: "Title" }, "select", ["", "Mr", "Ms", "Dr"])).key).toBe("salutation");
    expect(classify(d({ label: "Bitte wählen" }, "select", ["Herr", "Frau", "Divers"])).key).toBe("salutation");
  });

  it("doesn't take a skill-specific question for total experience", () => {
    expect(classify(d({ label: "Years of experience with Kubernetes" })).key).not.toBe("years_of_experience");
    expect(classify(d({ label: "Years of experience in total" })).key).toBe("years_of_experience");
    expect(classify(d({ label: "Berufserfahrung in Jahren" })).key).toBe("years_of_experience");
    expect(classify(d({ label: "How many years of management experience do you have?" })).key).not.toBe("years_of_experience");
  });

  it("doesn't read a preference as the applicant's own data", () => {
    expect(classify(d({ label: "Which city would you like to work in?" })).key).not.toBe("city");
    expect(classify(d({ label: "Preferred location" })).key).not.toBe("location");
    expect(classify(d({ label: "Country of citizenship" }, "select", ["Germany"])).key).toBe("citizenship");
  });

  it("keeps first, last and full name apart", () => {
    expect(classify(d({ label: "First and last name" })).key).toBe("full_name");
    expect(classify(d({ label: "Preferred first name" })).key).toBe("preferred_name");
    expect(classify(d({ label: "Company name" })).key).toBe("current_company");
    expect(classify(d({ label: "Name" })).key).toBe("full_name");
  });

  it("keeps a phone's country code apart from the number", () => {
    expect(classify(d({ label: "Country code" }, "select", ["+49", "+44"])).key).toBe("phone_country_code");
    expect(classify(d({ label: "Phone country code" })).key).toBe("phone_country_code");
    expect(classify(d({ label: "Ländervorwahl" })).key).toBe("phone_country_code");
  });

  it("doesn't take a newsletter checkbox for the email field", () => {
    expect(classify(d({ label: "Send me job alerts by email" }, "checkbox")).key).not.toBe("email");
  });

  it("flags fields about someone else", () => {
    expect(classify(d({ label: "Full name", section: "Reference 1" })).otherPerson).toBe(true);
    expect(classify(d({ label: "Name", section: "Notfallkontakt" })).otherPerson).toBe(true);
    // A job title in a heading isn't someone else's data.
    expect(classify(d({ label: "First name", section: "Apply for Senior Recruiter" })).otherPerson).toBe(false);
  });

  it("calls open questions questions", () => {
    expect(classify(d({ label: "Why do you want to work for us?" }, "textarea")).key).toBe("open_question");
    expect(classify(d({ label: "Beschreiben Sie Ihre größte berufliche Herausforderung" }, "textarea")).key).toBe("open_question");
  });

  it("leaves unknown fields unclassified rather than guessing", () => {
    expect(classify(d({ label: "Field 7", name: "field_7" }))).toMatchObject({ key: null, level: "none" });
    expect(classify(d({ label: "Position" })).key).toBeNull();
  });
});

describe("classifier: sensitive and legal questions are recognised (and later always asked)", () => {
  it.each([
    ["Are you legally authorized to work in Germany?", "select", "work_authorization"],
    ["Will you now or in the future require visa sponsorship?", "select", "visa_sponsorship"],
    ["Date of birth", "date", "date_of_birth"],
    ["Nationality", "text", "nationality"],
    ["Gender", "select", "gender"],
    ["Do you have a disability?", "select", "disability"],
    ["Have you ever been convicted of a criminal offence?", "radio", "criminal_record"],
    ["Race / Ethnicity", "select", "ethnicity"],
    ["What are your salary expectations?", "text", "salary_expectation"],
    ["Current salary", "text", "current_salary"],
    ["Are you willing to relocate?", "radio", "relocation"],
    ["Notice period", "text", "notice_period"],
    ["Earliest start date", "date", "availability_date"],
    ["I agree to the privacy policy", "checkbox", "consent"],
    ["Arbeitserlaubnis für Deutschland vorhanden?", "radio", "work_authorization"],
    ["Schwerbehinderung", "select", "disability"],
  ] as [string, ControlKind, string][])("%s → %s", (label, kind, key) => {
    const options = kind === "select" || kind === "radio" ? ["Yes", "No"] : [];
    expect(classify(d({ label }, kind, options)).key).toBe(key);
  });
});

describe("lexicons", () => {
  it("are merged per key, normalised, and longer phrases are tried first", () => {
    const lx = lexicon();
    const phone = lx.keys.get("phone")!;
    expect(phone.exact.has("telefonnummer")).toBe(true);
    expect(phone.exact.has("mobile phone")).toBe(true);
    expect(phone.phrases[0]!.length).toBeGreaterThanOrEqual(phone.phrases.at(-1)!.length);
    expect(lx.keys.get("street_address")!.exact.has("strasse und hausnummer")).toBe(true);
  });

  it("a new language is one file: a lexicon added to the list is used", () => {
    const fr = { ...en, lang: "fr", keys: { first_name: { exact: ["prénom"] } } };
    const lx = lexicon([en, de, fr]);
    expect(classify(d({ label: "Prénom" }), lx).key).toBe("first_name");
  });
});
