/**
 * The job a tailored resume is written for, normalised from what the extractor read: on every
 * supported site (Greenhouse, Lever, Workday, schema.org, generic pages), in English and
 * German, and never more than the page states.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPage } from "../../src/extraction";
import { htmlToText, languageOf, postingFrom, requirementsOf, sectionsOf, seniorityOf } from "../../src/extraction/posting";

function posting(name: string, url: string) {
  const html = readFileSync(resolve(process.cwd(), "test/fixtures/pages", name), "utf8");
  const extraction = extractPage(new DOMParser().parseFromString(html, "text/html"), url);
  return postingFrom(extraction, url);
}

describe("postings on supported sites", () => {
  it("Greenhouse: title, company, location, tasks and requirements, without the benefits", () => {
    const p = posting("greenhouse.html", "https://boards.greenhouse.io/contoso/jobs/4012345");
    expect(p).toMatchObject({ title: "Backend Engineer, Payments", company: "Contoso", location: "Remote - Europe", language: "en" });
    expect(p.responsibilities).toEqual(["Design APIs in Go", "Run Postgres at scale"]);
    expect(p.required).toEqual(["5+ years backend experience"]);
    expect(p.preferred).toEqual([]);
    expect(p.description).toContain("Contoso builds payment infrastructure");
    expect(p.url).toBe("https://boards.greenhouse.io/contoso/jobs/4012345");
    // Benefits are part of the posting's text, never of its requirements.
    expect([...p.responsibilities, ...p.required, ...p.preferred]).not.toContain("Remote-first, 30 days off");
  });

  it("Lever: the posting's sections and its employment type", () => {
    const p = posting("lever.html", "https://jobs.lever.co/woodgrove/3f1c2a9e-3b7d-4c51-9a0e-2d8f4b7c1e55");
    expect(p).toMatchObject({ title: "Product Designer", location: "Amsterdam", employmentType: "full_time" });
    expect(p.responsibilities).toEqual(["Own the onboarding journey"]);
    expect(p.required).toEqual(["A portfolio of shipped work"]);
  });

  it("Workday: bold paragraph headings count as headings", () => {
    const p = posting("workday.html", "https://contoso.wd3.myworkdayjobs.com/en-US/careers/job/Berlin/Cloud-Architect_R-1234");
    expect(p.title).toBe("Cloud Architect");
    expect(p.responsibilities).toEqual(["Architecture reviews"]);
    expect(p.required).toEqual(["AWS or Azure certification"]);
  });

  it("schema.org JobPosting: the description from the structured data, as text with its list", () => {
    const p = posting("jsonld-basic.html", "https://careers.northwind.example/jobs/4711-senior-sre?utm_source=x#apply");
    expect(p).toMatchObject({ title: "Senior Site Reliability Engineer", company: "Northwind Logistics GmbH", seniority: "senior" });
    expect(p.description).toContain("You keep our Kubernetes platform reliable.");
    expect(p.description).toContain("- Own SLOs and on-call");
    expect(p.description).not.toMatch(/<\/?[a-z]/i);
    expect(p.url).not.toContain("#apply");
  });

  it("a page without a posting gives nothing to write from", () => {
    const p = posting("not-job.html", "https://blog.example.com/post");
    expect(p.description === null || p.description.length > 0).toBe(true);
    expect(p.required).toEqual([]);
    expect(postingFrom(null, "https://x.example/apply")).toMatchObject({ title: null, company: null, description: null, url: "https://x.example/apply" });
  });
});

describe("sections", () => {
  it("reads German headings and moves 'von Vorteil' items to the nice-to-haves", () => {
    const text = [
      "Über uns",
      "- Wir sind 200 Menschen in Berlin",
      "Deine Aufgaben",
      "- Du betreibst unsere Kubernetes-Plattform",
      "- Du automatisierst mit Terraform",
      "Das bringst du mit:",
      "- 5 Jahre Erfahrung mit Linux",
      "- Go-Kenntnisse sind von Vorteil",
      "Wünschenswert",
      "- Erfahrung mit Kafka",
      "Wir bieten",
      "- 30 Tage Urlaub",
    ].join("\n");
    expect(sectionsOf(text)).toEqual({
      responsibilities: ["Du betreibst unsere Kubernetes-Plattform", "Du automatisierst mit Terraform"],
      required: ["5 Jahre Erfahrung mit Linux"],
      preferred: ["Go-Kenntnisse sind von Vorteil", "Erfahrung mit Kafka"],
    });
  });

  it("takes only list items under a heading, and a paragraph after the list ends the section", () => {
    const text = ["Requirements", "We'd love to hear from you.", "• Terraform", "* AWS", "1. Python", "Apply now and join our team today.", "- Not a requirement"].join("\n");
    expect(sectionsOf(text).required).toEqual(["Terraform", "AWS", "Python"]);
  });

  it("lists required before preferred for the API, without duplicates, at most 50", () => {
    expect(requirementsOf({ required: ["Go", "SQL"], preferred: ["SQL", "Rust"] })).toEqual(["Go", "SQL", "Rust"]);
    const many = Array.from({ length: 60 }, (_, i) => `Skill ${i}`);
    expect(requirementsOf({ required: many, preferred: [] })).toHaveLength(50);
  });

  it("ignores lists under no heading or under headings it doesn't know", () => {
    expect(sectionsOf("- Free coffee\nOur story\n- Founded in 2001")).toEqual({ responsibilities: [], required: [], preferred: [] });
  });
});

describe("seniority and language", () => {
  it.each([
    ["Senior Platform Engineer", "senior"],
    ["Sr. Data Engineer", "senior"],
    ["Senior Staff Engineer", "staff"],
    ["Head of SRE", "head"],
    ["Werkstudent (m/w/d) Marketing", "intern"],
    ["Junior Developer", "junior"],
    ["VP Engineering", "vp"],
    ["Teamleiter IT-Betrieb", "lead"],
    ["Platform Engineer", null],
    ["Seniority Analyst", null],
  ])("%s -> %s", (title, level) => {
    expect(seniorityOf(title)).toBe(level);
  });

  it("tells German from English and says nothing when unsure", () => {
    expect(languageOf("Wir suchen eine erfahrene Person für unser Team und du bist mit Kubernetes vertraut, die Erfahrung mit Linux hat.")).toBe("de");
    expect(languageOf("We are looking for an engineer with experience in Go and you will work on our platform for the team.")).toBe("en");
    expect(languageOf("Kubernetes Terraform AWS")).toBeNull();
  });
});

describe("HTML descriptions", () => {
  it("keeps lists and paragraphs, decodes entities, drops scripts, never parses a document", () => {
    const html = "<p>Fish &amp; Chips</p><ul><li>One</li><li>Two</li></ul><script>alert(1)</script><h3>Requirements</h3><ul><li>Go</li></ul>";
    const text = htmlToText(html);
    expect(text).toBe("Fish & Chips\n\n- One\n- Two\n\nRequirements\n\n- Go");
    expect(text).not.toContain("alert");
    expect(sectionsOf(text).required).toEqual(["Go"]);
  });
});
