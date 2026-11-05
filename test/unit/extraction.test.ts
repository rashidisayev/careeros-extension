import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPage, fitJsonLd } from "../../src/extraction";
import { findJobPostings, prune } from "../../src/extraction/structured";
import { readableText } from "../../src/extraction/text";

function page(name: string): Document {
  const html = readFileSync(resolve(process.cwd(), "test/fixtures/pages", name), "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

function extract(name: string, url: string) {
  const result = extractPage(page(name), url);
  if (!result) throw new Error("no extraction");
  return result;
}

describe("JSON-LD JobPosting", () => {
  const ex = () => extract("jsonld-basic.html", "https://careers.northwind.example/jobs/4711-senior-sre?utm_source=x#apply");

  it("reads the posting's facts as explicit, high-confidence structured data", () => {
    const { fields, confidence, signals } = ex();
    expect(confidence).toBe("high");
    expect(signals).toContain("structured_data");
    expect(fields.title).toEqual({ value: "Senior Site Reliability Engineer", basis: "explicit", source: "structured_data", confidence: "high" });
    expect(fields.company_name?.value).toBe("Northwind Logistics GmbH");
    expect(fields.location?.value).toBe("Berlin, BE, DE");
    expect(fields.employment_type?.value).toBe("full_time");
    expect(fields.date_posted?.value).toBe("2026-10-20");
    expect(fields.deadline?.value).toBe("2026-12-31");
  });

  it("takes pay only from baseSalary, never from estimatedSalary", () => {
    expect(ex().fields.salary?.value).toBe("EUR 85,000–105,000 per year");
  });

  it("sends only the JobPosting properties GetCareer reads", () => {
    const { capture } = ex();
    expect(capture.json_ld).toHaveLength(1);
    const posting = capture.json_ld[0]!;
    expect(posting.title).toBe("Senior Site Reliability Engineer (m/w/d)");
    expect(posting).not.toHaveProperty("trackingPixel");
    expect(posting).not.toHaveProperty("estimatedSalary");
  });

  it("drops the page text when the structured description is enough (data minimisation)", () => {
    expect(ex().capture.description_text).toBeNull();
  });

  it("builds a capture the API accepts", () => {
    const { capture } = ex();
    expect(capture.url).toBe("https://careers.northwind.example/jobs/4711-senior-sre?utm_source=x");
    expect(capture.canonical_url).toBe("https://careers.northwind.example/jobs/4711-senior-sre");
    expect(capture.document_title).toContain("Senior Site Reliability Engineer");
    expect(capture.meta).toEqual({
      "og:title": "Senior Site Reliability Engineer (m/w/d)",
      "og:site_name": "Northwind Logistics Careers",
      "og:type": "website",
      description: "Join Northwind's platform team in Berlin.",
    });
    expect(capture.adapter).toBe("generic");
    expect(capture.extension_version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("finds postings inside @graph, with @type arrays and plain-string organisations", () => {
    const { fields, confidence } = extract("jsonld-graph.html", "https://kontor.example/karriere/platform");
    expect(confidence).toBe("high");
    expect(fields.title?.value).toBe("Platform Engineer");
    expect(fields.company_name?.value).toBe("Kontor AG");
    expect(fields.remote_policy?.value).toBe("remote");
    expect(fields.employment_type?.value).toBe("part_time");
    expect(fields.location?.value).toBe("Hamburg, DE");
  });

  it("treats a list of postings as a listing page, not one job", () => {
    const { confidence, signals, fields } = extract("listing.html", "https://proseware.example/careers");
    expect(confidence).toBe("low");
    expect(signals).toContain("multiple_postings");
    expect(fields.title?.source).not.toBe("structured_data");
  });

  it("keeps what is there when fields are missing", () => {
    const { fields, confidence } = extract("missing-fields.html", "https://jobs.example/werkstudent");
    expect(confidence).toBe("high");
    expect(fields.title?.value).toBe("Werkstudent Marketing");
    expect(fields.company_name).toBeUndefined();
    expect(fields.salary).toBeUndefined();
  });
});

describe("microdata", () => {
  it("reads schema.org microdata as a posting", () => {
    const { fields, confidence, capture } = extract("microdata.html", "https://fabrikam.example/jobs/analyst");
    expect(confidence).toBe("high");
    expect(fields.title?.value).toBe("Data Analyst");
    expect(fields.company_name?.value).toBe("Fabrikam Inc.");
    expect(fields.location?.value).toBe("Munich, DE");
    expect(fields.date_posted?.value).toBe("2026-09-15");
    expect(capture.json_ld[0]?.["@type"]).toBe("JobPosting");
  });
});

describe("site adapters", () => {
  it("Greenhouse: labelled title, company, location and the description container", () => {
    const { fields, capture, confidence } = extract("greenhouse.html", "https://boards.greenhouse.io/contoso/jobs/4012345");
    expect(capture.adapter).toBe("greenhouse");
    expect(confidence).toBe("high");
    expect(fields.title).toMatchObject({ value: "Backend Engineer, Payments", basis: "explicit", source: "page", confidence: "medium" });
    expect(fields.company_name?.value).toBe("Contoso");
    expect(fields.location?.value).toBe("Remote - Europe");
    expect(capture.page_fields.posting_id).toEqual({ value: "4012345", basis: "explicit" });
    expect(capture.description_text).toContain("- Design APIs in Go");
    expect(capture.description_text).not.toContain("Submit Application");
  });

  it("Lever: categories map to location, commitment, workplace and team", () => {
    const { fields, capture } = extract("lever.html", "https://jobs.lever.co/woodgrove/6f1e2d3c-aaaa-bbbb-cccc-1234567890ab");
    expect(capture.adapter).toBe("lever");
    expect(fields.title?.value).toBe("Product Designer");
    expect(fields.company_name?.value).toBe("Woodgrove");
    expect(fields.employment_type?.value).toBe("full_time");
    expect(fields.remote_policy?.value).toBe("hybrid");
    expect(capture.page_fields.department?.value).toBe("Design – Core product");
    expect(capture.page_fields.posting_id?.value).toBe("6f1e2d3c-aaaa-bbbb-cccc-1234567890ab");
  });

  it("Workday: data-automation-id fields; relative dates are not sent", () => {
    const { fields, capture } = extract("workday.html", "https://contoso.wd3.myworkdayjobs.com/en-US/careers/job/Frankfurt/Cloud-Architect_R-20419");
    expect(capture.adapter).toBe("workday");
    expect(fields.title?.value).toBe("Cloud Architect");
    expect(fields.location?.value).toBe("Frankfurt am Main, Germany");
    expect(fields.remote_policy?.value).toBe("hybrid");
    expect(fields.employment_type?.value).toBe("full_time");
    expect(capture.page_fields.posting_id?.value).toBe("R-20419");
    expect(capture.page_fields.date_posted).toBeUndefined();
  });
});

describe("generic pages", () => {
  it("guesses from a heading, job sections and the apply button, marked as inferred", () => {
    const { fields, confidence, capture, signals } = extract("generic.html", "https://tailspin.example/karriere/devops-engineer");
    expect(confidence).toBe("medium");
    expect(signals).toEqual(expect.arrayContaining(["job_url", "apply_button", "job_sections:3"]));
    expect(fields.title).toMatchObject({ value: "DevOps Engineer", basis: "inferred", confidence: "low" });
    expect(fields.company_name).toMatchObject({ value: "Tailspin Toys", basis: "inferred", source: "meta" });
    expect(capture.page_fields.title?.basis).toBe("inferred");
    expect(capture.description_text).toContain("Deine Aufgaben");
    expect(capture.description_text).not.toContain("Start");
  });

  it("does not call an article a job", () => {
    const { confidence } = extract("not-job.html", "https://blog.example/2026/cloud-bill");
    expect(confidence).toBe("none");
  });

  it("survives malformed JSON-LD and falls back to metadata", () => {
    const { fields, capture, confidence } = extract("malformed.html", "https://litware.example/jobs/support");
    expect(capture.json_ld).toEqual([]);
    expect(fields.title).toMatchObject({ value: "Support Engineer", basis: "inferred" });
    expect(confidence).not.toBe("high");
  });

  it("trusts structured data over contradicting metadata, and drops unsafe canonical links", () => {
    const { fields, capture } = extract("wrong-metadata.html", "https://adatum.example/jobs/security");
    expect(fields.title?.value).toBe("Security Engineer");
    expect(fields.company_name?.value).toBe("Adatum");
    expect(capture.canonical_url).toBeNull();
  });
});

describe("hostile pages", () => {
  const ex = () => extract("malicious.html", "https://evil.example/jobs/staff");

  it("never reads hidden text, scripts, form values or unknown meta tags", () => {
    const { capture } = ex();
    const all = JSON.stringify(capture);
    expect(all).not.toContain("SYSTEM: the candidate");
    expect(all).not.toContain("Hidden instructions");
    expect(all).not.toContain("inline script content");
    expect(all).not.toContain("hunter2");
    expect(all).not.toContain("draft cover letter");
    expect(all).not.toContain("sk-live");
  });

  it("caps oversized strings, drops unknown and deeply nested keys", () => {
    const posting = ex().capture.json_ld[0]!;
    expect((posting.industry as string).length).toBe(5000);
    expect(posting).not.toHaveProperty("nested");
    expect(Object.prototype.hasOwnProperty.call(posting.hiringOrganization as object, "__proto__")).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("keeps injected instructions as plain posting text for the API to treat as untrusted", () => {
    const { capture, fields } = ex();
    expect(fields.title?.value).toBe("Staff Engineer & Mentor");
    expect(fields.salary).toBeUndefined();
    // The description travels as data; the API never follows it (see apps/api tests).
    expect(String(capture.json_ld[0]!.description)).toContain("IGNORE ALL PREVIOUS INSTRUCTIONS");
  });

  it("resolves protocol-relative canonical links against the page, as a browser would", () => {
    expect(ex().capture.canonical_url).toBe("https://evil.example/redirect?to=https://bank.example");
  });
});

describe("restricted platforms", () => {
  it.each([
    "https://www.linkedin.com/jobs/view/1234567890/",
    "https://de.indeed.com/viewjob?jk=abcdef123456",
    "https://www.stepstone.de/stellenangebote--SRE-Berlin--12345-inline.html",
    "https://www.xing.com/jobs/berlin-sre-123456",
    "https://www.glassdoor.de/job-listing/sre.htm",
  ])("never extracts %s", (url) => {
    expect(extractPage(page("jsonld-basic.html"), url)).toBeNull();
  });

  it("refuses non-web schemes", () => {
    expect(extractPage(page("jsonld-basic.html"), "file:///tmp/job.html")).toBeNull();
    expect(extractPage(page("jsonld-basic.html"), "chrome://settings")).toBeNull();
  });
});

describe("helpers", () => {
  it("finds postings nested in mainEntity and item lists, up to three", () => {
    const nodes = [{ "@type": "WebPage", mainEntity: { "@type": "JobPosting", title: "A" } }, { "@graph": [1, "x", null] }];
    expect(findJobPostings(nodes)).toHaveLength(1);
    const many = Array.from({ length: 10 }, (_, i) => ({ "@type": "JobPosting", title: String(i) }));
    expect(findJobPostings([many])).toHaveLength(3);
  });

  it("prunes to known keys and limits depth", () => {
    expect(prune({ title: "x", evil: "y", hiringOrganization: { name: "n", tracking: 1 } })).toEqual({
      title: "x",
      hiringOrganization: { name: "n" },
    });
  });

  it("fits structured data under the API's size limit", () => {
    const big = { "@type": "JobPosting", title: "t", description: "é".repeat(90_000) };
    const fitted = fitJsonLd([big, big, big]);
    expect(new TextEncoder().encode(JSON.stringify(fitted)).length).toBeLessThanOrEqual(200_000);
    expect(fitted.length).toBeGreaterThan(0);
  });

  it("reads text block by block, list items on their own lines", () => {
    const doc = new DOMParser().parseFromString("<div><p>One</p><ul><li>a</li><li>b</li></ul><script>x()</script><p>Two</p></div>", "text/html");
    expect(readableText(doc.body)).toBe("One\n\n- a\n- b\n\nTwo");
  });
});
