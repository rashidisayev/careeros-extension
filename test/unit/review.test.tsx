import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportOut } from "../../src/shared/api-types";
import { initialValues, Review, toBody, validate } from "../../src/ui/review";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const field = (value: unknown, basis: "explicit" | "inferred" = "explicit", source = "structured_data", confidence: "high" | "medium" | "low" = "high") => ({
  value,
  basis,
  source,
  confidence,
  quote: null,
});

function imp(over: Partial<ImportOut> = {}): ImportOut {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    status: "ready",
    method: "extension",
    platform: "other",
    platform_name: "northwind.example",
    source_url: "https://careers.northwind.example/jobs/4711",
    canonical_url: null,
    posting_id: "4711",
    error_code: null,
    error_message: null,
    fields: {
      title: field("Senior SRE"),
      company_name: field("Northwind"),
      department: field("Platform", "inferred", "ai", "medium"),
      seniority: field("senior", "inferred", "rules", "low"),
      salary_min: field(85000),
    },
    lists: {},
    description: "Keep things running.",
    warnings: [],
    match: null,
    duplicates: [],
    ai_used: true,
    attempts: 1,
    has_pasted_text: false,
    application_id: null,
    created_at: "2026-11-03T10:00:00Z",
    updated_at: "2026-11-03T10:00:00Z",
    ...over,
  };
}

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement | null = null;
function render(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("review values", () => {
  it("prefills from the import and the default status", () => {
    const v = initialValues(imp(), "to_apply");
    expect(v.title).toBe("Senior SRE");
    expect(v.salary_min).toBe("85000");
    expect(v.job_url).toBe("https://careers.northwind.example/jobs/4711");
    expect(v.status).toBe("to_apply");
  });

  it("checks fields like the API does", () => {
    const v = { ...initialValues(imp(), "interested"), title: " ", salary_max: "1000", salary_currency: "", job_url: "ftp://x", recruiter_email: "nope" };
    expect(validate(v)).toMatchObject({
      title: expect.any(String),
      salary_max: expect.stringContaining("at least"),
      salary_currency: expect.any(String),
      job_url: expect.any(String),
      recruiter_email: expect.any(String),
    });
  });

  it("sends nulls for empty values and no applied date before applying", () => {
    const body = toBody({ ...initialValues(imp(), "interested"), salary_currency: "eur" }, false);
    expect(body).toMatchObject({ title: "Senior SRE", location: null, salary_min: 85000, salary_currency: "EUR", applied_at: null, allow_duplicate: false });
  });
});

describe("review form", () => {
  it("labels where each value came from", () => {
    const el = render(<Review imp={imp()} bootstrap={null} defaultStatus="interested" tabId={1} onSaved={() => {}} onCancel={() => {}} />);
    const text = el.textContent ?? "";
    expect(text).toContain("From the posting");
    expect(text).toContain("Interpreted"); // AI, medium confidence
    expect(text).toContain("Please check"); // low confidence
    expect(text).toContain("Not found");
    expect(text).toContain("5 details found with AI");
  });

  it("with a likely duplicate, offers to open it or save separately, never to update it", () => {
    const dup = { application_id: "33333333-3333-3333-3333-333333333333", company_name: "Northwind", position_title: "Senior SRE", location: null, status: "applied" as const, created_at: "2026-10-01T00:00:00Z", reasons: ["same_link"] };
    const el = render(<Review imp={imp({ duplicates: [dup] })} bootstrap={null} defaultStatus="interested" tabId={1} onSaved={() => {}} onCancel={() => {}} />);
    const buttons = Array.from(el.querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(buttons).toContain("Open the existing application");
    expect(buttons).toContain("Save as a separate application");
    expect(buttons.join(" ")).not.toMatch(/update/i);
    expect(el.textContent).toContain("Saving never changes the existing application");
  });

  it("focuses the first invalid field instead of saving", async () => {
    const send = vi.fn();
    chrome.runtime.sendMessage = send as never;
    const el = render(<Review imp={imp({ fields: {} })} bootstrap={null} defaultStatus="interested" tabId={1} onSaved={() => {}} onCancel={() => {}} />);
    const form = el.querySelector("form")!;
    act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(document.activeElement?.id).toBe("rv-title");
    expect(el.querySelector("#rv-title")?.getAttribute("aria-invalid")).toBe("true");
    expect(el.querySelector("#rv-title-error")?.textContent).toBe("Add the position.");
    expect(send).not.toHaveBeenCalled();
  });
});
