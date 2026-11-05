/**
 * The AutoFill review in the side panel: documents and suggestions start unticked, a drafted
 * answer is never ticked for the user, an answer is saved only when the user asked and only
 * after it was filled, and the next step of a form is offered after the fill.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistry, detectFields } from "../../src/autofill/detector";
import { buildPlan } from "../../src/autofill/planner";
import type { AutofillPlan, AutofillProfile } from "../../src/autofill/types";
import { DEFAULT_AUTOFILL } from "../../src/shared/settings";
import { AutofillPanel, type AnswersAccess, type AutofillState } from "../../src/ui/autofill-view";
import { ANNA, load } from "./autofill-helpers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CV_REF = "resume:11111111-1111-1111-1111-111111111111";
const PROFILE: AutofillProfile = {
  ...ANNA,
  experiences: [{ company: "Nordlicht Payments", title: "Head of Platform", location: "Berlin", start: "2021-04", end: null, current: true, description: null, achievements: [] }],
  education: [],
  saved_answers: [],
};

function planOf(): AutofillPlan {
  load("history-generic.html");
  const scan = detectFields(document, createRegistry(), { layout: false });
  const plan = buildPlan([{ frameId: 0, result: { ...scan, frameUrl: location.href } }], PROFILE, DEFAULT_AUTOFILL, location.href, {
    documents: { application: null, documents: [{ ref: CV_REF, kind: "cv", name: "Anna Schmidt - CV.pdf", formats: ["pdf"], size: 9, updated_at: "2026-11-01", recommended: false, note: null }] },
  });
  document.body.innerHTML = "";
  return plan;
}

const ANSWERS: AnswersAccess = { enabled: true, reason: null, remember: true, prefs: { language: "auto", length: "medium", tone: "professional" } };
const sent: { type: string; [k: string]: unknown }[] = [];

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement;

function state(plan: AutofillPlan, changed = 0): AutofillState {
  return { plan, error: null, loading: false, rescan: vi.fn(), changed };
}

function render(plan: AutofillPlan, answers = ANSWERS) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const panel = (s: AutofillState) => <AutofillPanel tabId={7} state={s} excluded={[]} answers={answers} onExclude={() => undefined} onOpen={() => undefined} startInReview />;
  act(() => root!.render(panel(state(plan))));
  return { rerender: (s: AutofillState) => act(() => root!.render(panel(s))) };
}

const byText = (text: string | RegExp) =>
  Array.from(host.querySelectorAll<HTMLElement>("button")).find((b) => (typeof text === "string" ? b.textContent?.trim().startsWith(text) : text.test(b.textContent ?? "")))!;
const checkboxFor = (plan: AutofillPlan, label: string) => {
  const item = plan.items.find((i) => i.label === label)!;
  return host.querySelector<HTMLInputElement>(`#${CSS.escape(`af-on-${item.frameId}:${item.fieldId}`)}`);
};
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
    await new Promise((r) => setTimeout(r, 0));
  });
}
function type(el: HTMLTextAreaElement | HTMLInputElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  sent.length = 0;
  vi.mocked(chrome.runtime.sendMessage).mockImplementation((async (req: { type: string; items?: { fieldId: string; frameId: number }[]; questions?: { id: string }[] }) => {
    sent.push(req as never);
    switch (req.type) {
      case "autofill.answers":
        return { ok: true, data: { context: "page", answers: req.questions!.map((q) => ({ id: q.id, status: "drafted", answer: "I build reliable platforms.", missing: null, issues: ["Check the number 12."] })) } };
      case "autofill.fill":
        return { ok: true, data: { filled: req.items!.length, results: req.items!.map((i) => ({ frameId: i.frameId, fieldId: i.fieldId, status: "filled" })) } };
      case "autofill.saveAnswer":
        return { ok: true, data: { id: "s1" } };
      default:
        return { ok: true, data: null };
    }
  }) as never);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("AutoFill review", () => {
  it("shows the CV to attach and the role entries, with nothing but the clear fields ticked", () => {
    const plan = planOf();
    render(plan);
    expect(host.textContent).toContain("Review AutoFill");
    expect(checkboxFor(plan, "CV")!.checked).toBe(false);
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Document for CV"]')!.value).toBe(CV_REF);
    expect(checkboxFor(plan, "First name")!.checked).toBe(true);
    expect(host.textContent).toContain("Employer · role 1");
    expect(host.textContent).toContain("Employer · role 2");
  });

  it("drafts an answer to an open question, unticked, with what CareerOS couldn't check", async () => {
    const plan = planOf();
    render(plan);
    const before = byText(/^Fill \d+ fields?$/).textContent;
    await click(byText("Suggest an answer"));
    const draft = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Your answer for Why do you want to join Brightwave?"]')!;
    expect(draft.value).toBe("I build reliable platforms.");
    expect(checkboxFor(plan, "Why do you want to join Brightwave?")!.checked).toBe(false);
    expect(host.textContent).toContain("Check the number 12.");
    expect(byText(/^Fill \d+ fields?$/).textContent).toBe(before);
    const req = sent.find((r) => r.type === "autofill.answers")!;
    expect(req).toMatchObject({ language: "en", questions: [{ text: "Why do you want to join Brightwave?" }] });
  });

  it("explains the consent CareerOS needs instead of offering drafts", () => {
    const plan = planOf();
    render(plan, { ...ANSWERS, enabled: false, reason: "consent_required" });
    expect(byText("Suggest an answer")).toBeUndefined();
    expect(host.textContent).toContain("allow AI processing in your CareerOS settings");
  });

  it("offers neither drafts nor 'Remember' when the server keeps no answers (an older CareerOS)", async () => {
    const plan = planOf();
    render(plan, { ...ANSWERS, enabled: false, reason: null, remember: false });
    expect(byText("Suggest an answer")).toBeUndefined();
    await click(byText(/^Answer here: Notice period$/));
    expect(host.textContent).not.toContain("Remember for other applications");
    expect(host.textContent).not.toContain("allow AI processing");
  });

  it("fills an answer typed in the panel and saves it only when asked, after the fill", async () => {
    const plan = planOf();
    render(plan);
    const notice = plan.items.find((i) => i.label === "Notice period")!;
    await click(byText(/^Answer here: Notice period$/));
    const box = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="Your answer for Notice period"]`)!;
    type(box, "2 months");
    const remember = Array.from(host.querySelectorAll<HTMLLabelElement>("label")).find((l) => l.textContent?.startsWith("Remember for other applications"))!.querySelector("input")!;
    await click(remember);
    expect(sent.some((r) => r.type === "autofill.saveAnswer")).toBe(false);
    await click(byText(/^Fill \d+ fields?$/));
    const fill = sent.find((r) => r.type === "autofill.fill")! as unknown as { items: { fieldId: string; value: unknown }[]; stats: unknown };
    expect(fill.items.find((i) => i.fieldId === notice.fieldId)!.value).toEqual({ kind: "text", text: "2 months" });
    expect(fill.stats).toEqual({ confirmed: 1, asked: expect.any(Number), ats: null });
    const types = sent.map((r) => r.type);
    expect(types.indexOf("autofill.saveAnswer")).toBeGreaterThan(types.indexOf("autofill.fill"));
    expect(sent.find((r) => r.type === "autofill.saveAnswer")).toMatchObject({ fieldKey: "notice_period", question: "Notice period", answer: "2 months" });
    expect(host.textContent).toContain("1 answer saved for other applications.");
  });

  it("offers the next step of the form once the page shows new fields", async () => {
    const plan = planOf();
    const { rerender } = render(plan);
    await click(byText(/^Fill \d+ fields?$/));
    expect(host.textContent).toMatch(/Filled \d+ fields/);
    expect(host.textContent).not.toContain("New fields on the page");
    rerender(state(plan, 1));
    expect(host.textContent).toContain("New fields on the page");
    expect(byText("Fill this step")).toBeDefined();
  });
});
