/**
 * The tailored resume in the side panel: "Fill application" asks for it (when the user wants
 * that), the steps are shown as they run, the review offers it for the CV field, it is
 * attached only when the form shows it, the user checks the job first when the page isn't
 * clear, AutoFill works whatever happens to the resume, and downloads say how they went.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistry, detectFields } from "../../src/autofill/detector";
import { buildPlan } from "../../src/autofill/planner";
import type { AutofillPlan, AutofillProfile } from "../../src/autofill/types";
import type { ResumeDetails, ResumeView } from "../../src/shared/resumes";
import { DEFAULT_AUTOFILL } from "../../src/shared/settings";
import { AutofillPanel, type AnswersAccess, type AutofillState } from "../../src/ui/autofill-view";
import type { ResumeAccess } from "../../src/ui/resume-view";
import { ANNA, load } from "./autofill-helpers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RID = "6f1c2a9e-3b7d-4c51-9a0e-2d8f4b7c1e55";
const APP = "a3d9c7e1-8b2f-4a6d-9e0c-5f1b2a3c4d5e";
const PROFILE: AutofillProfile = { ...ANNA, experiences: [], education: [], saved_answers: [] };
const ANSWERS: AnswersAccess = { enabled: false, reason: null, remember: false, prefs: { language: "auto", length: "medium", tone: "professional" } };
const ON: ResumeAccess = { enabled: true, reason: null, auto: true };

function planOf(fixture = "history-generic.html"): AutofillPlan {
  load(fixture);
  const scan = detectFields(document, createRegistry(), { layout: false });
  const plan = buildPlan([{ frameId: 0, result: { ...scan, frameUrl: location.href } }], PROFILE, DEFAULT_AUTOFILL, location.href, { documents: { application: null, documents: [] } });
  document.body.innerHTML = "";
  return plan;
}

const view = (over: Partial<ResumeView> = {}): ResumeView => ({
  id: RID,
  applicationId: APP,
  version: 1,
  status: "pending",
  jobTitle: "Backend Engineer, Payments",
  company: "Contoso",
  createdAt: "2026-11-18T10:00:00Z",
  generatedAt: null,
  expiresAt: null,
  files: [],
  review: null,
  requirements: { supported: [], unsupported: [], coverage: null },
  error: null,
  deletionReason: null,
  reused: false,
  ...over,
});

const READY = (over: Partial<ResumeView> = {}) =>
  view({
    status: "ready",
    generatedAt: "2026-11-18T10:01:00Z",
    files: [
      { format: "pdf", filename: "Anna_Schmidt_Resume.pdf", size: 9 },
      { format: "docx", filename: "Anna_Schmidt_Resume.docx", size: 9 },
    ],
    review: { notes: [], issues: [], flagged: 0 },
    requirements: { supported: ["Go"], unsupported: ["Kafka"], coverage: 0.5 },
    ...over,
  });

const job = {
  title: "Backend Engineer, Payments",
  company: "Contoso",
  location: "Remote - Europe",
  employmentType: null,
  seniority: null,
  url: "https://boards.greenhouse.io/contoso/jobs/4012345",
  description: "Contoso builds payment infrastructure for small businesses across Europe. You design APIs in Go.",
  responsibilities: ["Design APIs in Go"],
  required: ["5+ years backend experience"],
  preferred: [],
  language: "en" as const,
};

const DETAILS = (over: Partial<ResumeDetails> = {}): ResumeDetails => ({ job, application: null, confidence: "high", missing: [], confirm: false, current: null, ...over });

type Req = { type: string; [k: string]: unknown };
let sent: Req[] = [];
let handlers: Record<string, (r: Req) => unknown>;

function reply(type: string, fn: (r: Req) => unknown) {
  handlers[type] = fn;
}

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement;

function render(plan: AutofillPlan, resumes: ResumeAccess | null = ON) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const state: AutofillState = { plan, error: null, loading: false, rescan: vi.fn(), changed: 0 };
  act(() => root!.render(<AutofillPanel tabId={7} state={state} excluded={[]} answers={ANSWERS} resumes={resumes} onExclude={() => undefined} onOpen={(p) => sent.push({ type: "open", path: p })} />));
}

const buttons = () => Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
const button = (text: string | RegExp) => buttons().find((b) => (typeof text === "string" ? b.textContent?.trim().startsWith(text) : text.test(b.textContent ?? "")));
const text = () => host.textContent ?? "";
const types = () => sent.map((r) => r.type);

async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error("no such button");
  await act(async () => {
    el.click();
    await Promise.resolve();
  });
}
/** Lets pending messages answer and timers (the polling) run. */
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  handlers = {
    "resume.details": () => DETAILS(),
    "resume.create": () => view(),
    "resume.progress": () => ({ id: RID, status: "ready", ready: true, pollAfter: null, error: null, deletionReason: null }),
    "resume.get": () => READY(),
    "autofill.fill": (r) => ({ filled: (r.items as unknown[]).length, results: (r.items as { frameId: number; fieldId: string }[]).map((i) => ({ frameId: i.frameId, fieldId: i.fieldId, status: "filled" })) }),
  };
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (req: Req) => {
    sent.push(req);
    const h = handlers[req.type];
    if (!h) return { ok: true, data: null };
    try {
      return { ok: true, data: await h(req) };
    } catch (e) {
      return { ok: false, error: e };
    }
  }) as never);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const cvChecked = (plan: AutofillPlan) => {
  const cv = plan.items.find((i) => i.label === "CV")!;
  return host.querySelector<HTMLInputElement>(`#${CSS.escape(`af-on-${cv.frameId}:${cv.fieldId}`)}`)!.checked;
};

describe("tailored resume on Fill application", () => {
  it("asks for it, shows each step, offers it ticked for the empty CV field, and confirms the attachment", async () => {
    const plan = planOf();
    render(plan);
    await flush();
    await click(button("Fill application"));
    expect(types()).toContain("resume.details");
    await flush();
    expect(types()).toContain("resume.create");
    expect(text()).toContain("Generating your tailored resume…");
    expect(text()).toContain("Backend Engineer, Payments · Contoso");
    // The CV row says what happens while it's written.
    expect(text()).toContain("GetCareer is writing a resume for this job");
    await flush(3100);
    expect(text()).toContain("Your tailored resume is ready.");
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Document for CV"]')!.value).toBe(`job-resume:${RID}`);
    expect(cvChecked(plan)).toBe(true);
    await click(button(/^Fill \d+ fields?$/));
    await flush();
    const fill = sent.find((r) => r.type === "autofill.fill")! as unknown as { items: { value: { kind: string; ref?: string; name?: string } }[] };
    expect(fill.items.find((i) => i.value.kind === "file")!.value).toMatchObject({ ref: `job-resume:${RID}`, name: "Anna_Schmidt_Resume.pdf" });
    expect(text()).toContain("Resume successfully attached to the application.");
    expect(text()).toContain("Autofill completed.");
  });

  it("attaches it when it's ready if the form was filled before", async () => {
    const plan = planOf();
    reply("resume.progress", () => ({ id: RID, status: "generating", ready: false, pollAfter: 3, error: null, deletionReason: null }));
    render(plan);
    await flush();
    await click(button("Fill application"));
    await flush();
    await click(button(/^Fill \d+ fields?$/));
    await flush();
    expect(text()).toContain("It's attached to “CV” as soon as it's ready.");
    const fills = () => sent.filter((r) => r.type === "autofill.fill");
    expect(fills()).toHaveLength(1);
    reply("resume.progress", () => ({ id: RID, status: "ready", ready: true, pollAfter: null, error: null, deletionReason: null }));
    await flush(3100);
    await flush();
    expect(fills()).toHaveLength(2);
    expect((fills()[1] as unknown as { items: { value: { ref: string } }[] }).items).toHaveLength(1);
    expect((fills()[1] as unknown as { items: { value: { ref: string } }[] }).items[0]!.value.ref).toBe(`job-resume:${RID}`);
    expect(text()).toContain("Resume successfully attached to the application.");
  });

  it("never claims the attachment when the form didn't show the file", async () => {
    const plan = planOf();
    reply("autofill.fill", (r) => ({ filled: 0, results: (r.items as { frameId: number; fieldId: string; value: { kind: string } }[]).map((i) => ({ frameId: i.frameId, fieldId: i.fieldId, status: i.value.kind === "file" ? "unconfirmed" : "filled" })) }));
    render(plan);
    await flush();
    await click(button("Fill application"));
    await flush();
    await flush(3100);
    await click(button(/^Fill \d+ fields?$/));
    await flush();
    expect(text()).not.toContain("Resume successfully attached");
    expect(text()).toContain("Your tailored resume is ready. Please download it and attach it manually to your application.");
    expect(text()).toContain("The form didn't show the file");
  });

  it("uses the resume GetCareer already has instead of asking for another", async () => {
    const plan = planOf();
    reply("resume.details", () => DETAILS({ current: READY({ reused: true }) }));
    render(plan);
    await flush();
    expect(text()).toContain("Your tailored resume is ready.");
    await click(button("Fill application"));
    await flush();
    expect(types()).not.toContain("resume.create");
  });

  it("lets the user check the job first when the page isn't clearly the posting", async () => {
    const plan = planOf();
    reply("resume.details", () => DETAILS({ job: { ...job, title: null, description: null, required: [], responsibilities: [] }, confidence: "none", missing: ["job_title", "job_description"], confirm: true }));
    render(plan);
    await flush();
    await click(button("Fill application"));
    await flush();
    expect(types()).not.toContain("resume.create");
    expect(text()).toContain("GetCareer couldn't read the job description on this page");
    const submit = button("Create tailored resume")!;
    expect(submit.disabled).toBe(true);
    const field = (label: string) => Array.from(host.querySelectorAll("label")).find((l) => l.textContent?.startsWith(label))!.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea")!;
    const type = (el: HTMLInputElement | HTMLTextAreaElement, v: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
    type(field("Job title"), "Platform Engineer");
    type(field("Job description"), "We run Kubernetes for 200 engineers and need someone who automates everything with Terraform.");
    await click(button("Create tailored resume"));
    await flush();
    expect(sent.find((r) => r.type === "resume.create")).toMatchObject({ input: { title: "Platform Engineer", company: "Contoso", description: expect.stringContaining("Terraform") } });
  });

  it("keeps AutoFill working when the resume can't be made", async () => {
    const plan = planOf();
    reply("resume.create", () => {
      throw { code: "rate_limited", message: "Too many" };
    });
    render(plan);
    await flush();
    await click(button("Fill application"));
    await flush();
    expect(text()).toContain("You've reached the hourly limit for AI documents");
    expect(text()).toContain("AutoFill works without it");
    await click(button(/^Fill \d+ fields?$/));
    await flush();
    expect(text()).toMatch(/Filled \d+ fields/);
    expect(button("Try again")).toBeDefined();
  });

  it("leaves a resume with unverified points unticked and asks before attaching it", async () => {
    const plan = planOf();
    reply("resume.get", () => READY({ review: { notes: [], issues: [], flagged: 2 } }));
    render(plan);
    await flush();
    await click(button("Fill application"));
    await flush();
    await flush(3100);
    expect(cvChecked(plan)).toBe(false);
    expect(text()).toContain("2 points GetCareer couldn't verify");
    await click(button(/^Fill \d+ fields?$/));
    await flush();
    expect(sent.filter((r) => r.type === "autofill.fill")).toHaveLength(1);
    await click(button("Attach to “CV”"));
    expect(text()).toContain("Check the resume before attaching it");
    expect(sent.filter((r) => r.type === "autofill.fill")).toHaveLength(1);
    await click(button("Attach anyway"));
    await flush();
    expect(sent.filter((r) => r.type === "autofill.fill")).toHaveLength(2);
    expect(text()).toContain("Resume successfully attached to the application.");
  });

  it("asks for nothing on Fill application when the user turned that off", async () => {
    const plan = planOf();
    render(plan, { ...ON, auto: false });
    await flush();
    await click(button("Fill application"));
    await flush();
    expect(types()).not.toContain("resume.create");
    expect(button("Create tailored resume")).toBeDefined();
  });

  it("explains consent and asks GetCareer nothing while AI processing is off", async () => {
    const plan = planOf();
    render(plan, { enabled: false, reason: "consent_required", auto: true });
    await flush();
    await click(button("Fill application"));
    await flush();
    expect(types().filter((t) => t.startsWith("resume."))).toEqual([]);
    expect(text()).toContain("Turn on AI processing in GetCareer (CV & Documents) to create tailored resumes.");
  });

  it("says to attach it by hand on a form without a CV field", async () => {
    const plan = planOf("simple-de.html");
    const noCv = { ...plan, items: plan.items.filter((i) => i.kind !== "file") };
    reply("resume.details", () => DETAILS({ current: READY() }));
    render(noCv);
    await flush();
    expect(text()).toContain("Resume is ready for download. Please attach it manually.");
  });

  it("opens the application in GetCareer", async () => {
    reply("resume.details", () => DETAILS({ current: READY() }));
    render(planOf());
    await flush();
    await click(button("Open application in GetCareer"));
    expect(sent.find((r) => r.type === "open")).toMatchObject({ path: `/applications/${APP}` });
  });
});

describe("downloads", () => {
  beforeEach(() => {
    reply("resume.details", () => DETAILS({ current: READY() }));
    reply("resume.file", (r) => ({ name: `Anna_Schmidt_Resume.${r.format}`, mime: r.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", base64: btoa("%PDF-1.7") }));
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:chrome-extension://x/1");
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  });

  it("saves through the browser's downloads once allowed, says when it's done, and not twice by accident", async () => {
    const listeners: ((d: unknown) => void)[] = [];
    const download = vi.fn(async () => 42);
    Object.assign(chrome, {
      permissions: { request: vi.fn(async () => true) },
      downloads: { download, onChanged: { addListener: (l: (d: unknown) => void) => listeners.push(l), removeListener: vi.fn() } },
    });
    render(planOf());
    await flush();
    await click(button("Download PDF"));
    await flush();
    expect(text()).toContain("Downloading Anna_Schmidt_Resume.pdf…");
    expect(download).toHaveBeenCalledWith({ url: "blob:chrome-extension://x/1", filename: "Anna_Schmidt_Resume.pdf", conflictAction: "uniquify", saveAs: false });
    await act(async () => listeners.forEach((l) => l({ id: 42, state: { current: "complete" } })));
    await flush();
    expect(text()).toContain("Saved Anna_Schmidt_Resume.pdf to your downloads.");
    expect(button("Downloaded PDF")!.disabled).toBe(true);
    expect(sent.filter((r) => r.type === "resume.file")).toHaveLength(1);
    await click(button("Download again"));
    await flush();
    expect(sent.filter((r) => r.type === "resume.file")).toHaveLength(2);
  });

  it("falls back to an ordinary download without the permission, and reports a failed one", async () => {
    Object.assign(chrome, { permissions: { request: vi.fn(async () => false) } });
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(planOf());
    await flush();
    await click(button("Download Word"));
    await flush();
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Downloading Anna_Schmidt_Resume.docx. Your browser shows it in its downloads.");
    reply("resume.file", () => {
      throw { code: "resume_expired", message: "gone" };
    });
    await click(button("Download PDF"));
    await flush();
    expect(text()).toContain("This resume was deleted after 30 days.");
  });
});
