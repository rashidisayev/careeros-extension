import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlan } from "../../src/autofill/planner";
import { createPageAutofill, type PageAutofill } from "../../src/autofill/page";
import type { FillItem, PlanItem } from "../../src/autofill/types";
import { DEFAULT_AUTOFILL } from "../../src/shared/settings";
import { ANNA, load } from "./autofill-helpers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORIGIN = location.origin; // jsdom: http://localhost:3000 or similar

let page: PageAutofill;

function planHere() {
  const scan = page.scan({ layout: false });
  return buildPlan([{ frameId: 0, result: { ...scan, frameUrl: location.href } }], ANNA, DEFAULT_AUTOFILL, location.href);
}

/** What the side panel sends after review: every "fill" item, unchanged. */
function reviewed(items: PlanItem[], include: (i: PlanItem) => boolean = (i) => i.action === "fill"): FillItem[] {
  return items.filter(include).map((i) => ({ frameId: 0, fieldId: i.fieldId, frameOrigin: i.frameOrigin, value: i.value!, overwrite: false }));
}

const $ = <T extends Element = HTMLInputElement>(sel: string) => document.querySelector(sel) as unknown as T;

beforeEach(() => {
  load("simple-en.html");
  page = createPageAutofill(document);
});

describe("executor: writing values", () => {
  it("fills text, email, selects and number fields, with input, change and blur events", async () => {
    const events: string[] = [];
    for (const t of ["input", "change", "focusout"]) $("#fn").addEventListener(t, () => events.push(t));
    const items = reviewed(planHere().items);
    const out = await page.fill(items, 0, ORIGIN);
    expect(out.every((o) => o.status === "filled")).toBe(true);
    expect($("#fn").value).toBe("Anna");
    expect($("#em").value).toBe("anna@example.com");
    expect($<HTMLSelectElement>("#country").value).toBe("DE");
    expect($("#yoe").value).toBe("12");
    expect(events).toEqual(["input", "change", "focusout"]);
  });

  it("chooses radios by clicking and ticks checkboxes only when told", async () => {
    const plan = planHere();
    const mgmt = plan.items.find((i) => i.kind === "radio")!;
    const out = await page.fill(reviewed(plan.items, (i) => i === mgmt), 0, ORIGIN);
    expect(out[0]!.status).toBe("filled");
    expect($('input[name=mgmt][value=yes]').checked).toBe(true);
    // The consent box was never in the list, so it stays unticked.
    expect($('input[name=privacy]').checked).toBe(false);
  });

  it("highlights what it filled and what needs attention, and removes the outlines on request", async () => {
    const plan = planHere();
    await page.fill(reviewed(plan.items), 0, ORIGIN);
    const ask = plan.items.find((i) => i.label === "Resume/CV")!;
    page.attention([ask.fieldId]);
    expect($("#fn").style.outline).toContain("solid");
    expect($("#cv").style.outline).toContain("dashed");
    page.clearHighlights();
    expect($("#fn").style.outline).toBe("");
    expect($("#fn").value).toBe("Anna"); // the values stay
  });

  it("never submits the form or clicks anything else", async () => {
    const submit = vi.fn((e: Event) => e.preventDefault());
    $("#application").addEventListener("submit", submit);
    const button = vi.fn();
    $("button[type=submit]").addEventListener("click", button);
    await page.fill(reviewed(planHere().items, (i) => i.value !== null), 0, ORIGIN);
    expect(submit).not.toHaveBeenCalled();
    expect(button).not.toHaveBeenCalled();
  });

  it("writes nothing when the frame now shows another site", async () => {
    const items = reviewed(planHere().items);
    const out = await page.fill(items.map((i) => ({ ...i, frameOrigin: "https://evil.example" })), 0, "https://evil.example");
    expect(out.every((o) => o.status === "wrong_page")).toBe(true);
    expect($("#fn").value).toBe("");
  });

  it("reports fields that disappeared and values that don't fit", async () => {
    const plan = planHere();
    const first = plan.items.find((i) => i.label === "First name")!;
    const country = plan.items.find((i) => i.label === "Country")!;
    $("#fn").remove();
    const out = await page.fill(
      [
        { frameId: 0, fieldId: first.fieldId, frameOrigin: ORIGIN, value: { kind: "text", text: "Anna" }, overwrite: false },
        { frameId: 0, fieldId: country.fieldId, frameOrigin: ORIGIN, value: { kind: "option", index: 99 }, overwrite: false },
        { frameId: 0, fieldId: country.fieldId, frameOrigin: ORIGIN, value: { kind: "text", text: "x" }, overwrite: false },
      ],
      0,
      ORIGIN,
    );
    expect(out.map((o) => o.status)).toEqual(["not_found", "no_option", "failed"]);
  });
});

describe("executor: comboboxes", () => {
  it("never types into a combobox, even when asked to", async () => {
    load("greenhouse-job-boards.html");
    page = createPageAutofill(document);
    const country = planHere().items.find((i) => i.label === "Country")!;
    const out = await page.fill([{ frameId: 0, fieldId: country.fieldId, frameOrigin: ORIGIN, value: { kind: "text", text: "Germany" }, overwrite: false }], 0, ORIGIN);
    expect(out[0]!.status).toBe("failed");
    expect($("#country").value).toBe("");
  });
});

describe("executor: the user's own input wins", () => {
  it("doesn't overwrite a field that already has a value unless the user chose to", async () => {
    $("#fn").value = "Annie";
    const plan = planHere();
    const first = plan.items.find((i) => i.label === "First name")!;
    expect(first).toMatchObject({ action: "keep" });
    const item: FillItem = { frameId: 0, fieldId: first.fieldId, frameOrigin: ORIGIN, value: { kind: "text", text: "Anna" }, overwrite: false };
    expect((await page.fill([item], 0, ORIGIN))[0]!.status).toBe("has_value");
    expect($("#fn").value).toBe("Annie");
    expect((await page.fill([{ ...item, overwrite: true }], 0, ORIGIN))[0]!.status).toBe("filled");
    expect($("#fn").value).toBe("Anna");
    page.undo(0);
    expect($("#fn").value).toBe("Annie");
  });

  it("never fills again a field the user edited after AutoFill, and a new scan says so", async () => {
    const items = reviewed(planHere().items);
    await page.fill(items, 0, ORIGIN);
    $("#fn").value = "Annika"; // the user corrects it
    const again = planHere();
    expect(again.items.find((i) => i.label === "First name")).toMatchObject({ action: "keep", reasons: ["user_edited"] });
    expect(again.items.find((i) => i.label === "Last name")).toMatchObject({ action: "keep", reasons: ["already_filled"] });
    expect(again.counts.filled).toBeGreaterThan(0);
    const out = await page.fill(items, 0, ORIGIN);
    expect(out.find((o) => o.fieldId === items[0]!.fieldId)!.status).toBe("user_edited");
    expect($("#fn").value).toBe("Annika");
  });
});

describe("executor: undo", () => {
  it("restores every field to what it held before, including selects and radios", async () => {
    const plan = planHere();
    await page.fill(reviewed(plan.items, (i) => i.value !== null && (i.action === "fill" || i.action === "confirm")), 0, ORIGIN);
    expect($<HTMLSelectElement>("#country").value).toBe("DE");
    const report = page.undo(0);
    expect(report.every((r) => r.status === "restored")).toBe(true);
    expect($("#fn").value).toBe("");
    expect($<HTMLSelectElement>("#country").selectedIndex).toBe(0);
    expect($('input[name=mgmt][value=yes]').checked).toBe(false);
    expect($("#fn").style.outline).toBe("");
  });

  it("keeps what the user changed after AutoFill, and can undo single fields", async () => {
    const plan = planHere();
    await page.fill(reviewed(plan.items), 0, ORIGIN);
    $("#ln").value = "Schmidt-Lang";
    const city = plan.items.find((i) => i.label === "City")!;
    expect(page.undo(0, [city.fieldId])).toEqual([{ frameId: 0, fieldId: city.fieldId, status: "restored" }]);
    expect($("#city").value).toBe("");
    expect($("#fn").value).toBe("Anna");
    const rest = page.undo(0);
    expect(rest.find((r) => r.status === "kept_user_edit")).toBeTruthy();
    expect($("#ln").value).toBe("Schmidt-Lang");
    expect($("#fn").value).toBe("");
  });
});

describe("executor: React-controlled inputs", () => {
  function ReactForm({ onState }: { onState: (s: Record<string, string>) => void }) {
    const [s, set] = useState({ first: "", country: "" });
    const update = (k: "first" | "country", v: string) => {
      const next = { ...s, [k]: v };
      set(next);
      onState(next);
    };
    return (
      <form>
        <label htmlFor="r-first">First name</label>
        <input id="r-first" value={s.first} onChange={(e) => update("first", e.target.value)} />
        <label htmlFor="r-last">Last name</label>
        <input id="r-last" defaultValue="" />
        <label htmlFor="r-mail">Email</label>
        <input id="r-mail" type="email" defaultValue="" />
        <label htmlFor="r-country">Country</label>
        <select id="r-country" value={s.country} onChange={(e) => update("country", e.target.value)}>
          <option value="">Select</option>
          <option value="de">Germany</option>
        </select>
      </form>
    );
  }

  it("updates React state, so the page sees the values (not just the DOM)", async () => {
    document.body.innerHTML = '<div id="app"></div>';
    let state: Record<string, string> = {};
    const root = createRoot(document.getElementById("app")!);
    await act(async () => root.render(<ReactForm onState={(s) => (state = s)} />));
    page = createPageAutofill(document);
    const items = reviewed(planHere().items);
    await act(async () => {
      await page.fill(items, 0, ORIGIN);
    });
    expect(state).toEqual({ first: "Anna", country: "de" });
    expect($("#r-first").value).toBe("Anna");
    await act(async () => {
      page.undo(0);
    });
    expect(state.first).toBe("");
    root.unmount();
  });
});
