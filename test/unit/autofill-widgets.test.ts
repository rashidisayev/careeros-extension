/**
 * The executor for Phase 2 values: entries picked from list widgets, several options of a
 * multi-select or checkbox group, and files attached from GetCareer. The fixtures' own scripts
 * open and fill their lists, as the vendors' widgets do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accepts, fileKey, matchEntry } from "../../src/autofill/executor";
import { createPageAutofill, type PageAutofill } from "../../src/autofill/page";
import type { FieldDescriptor, FillItem, FillValue } from "../../src/autofill/types";
import { load } from "./autofill-helpers";

const ORIGIN = location.origin;
let page: PageAutofill;
let fields: FieldDescriptor[];

const $ = <T extends Element = HTMLInputElement>(sel: string) => document.querySelector(sel) as unknown as T;
const field = (label: string) => fields.find((f) => f.label === label)!;
const item = (label: string, value: FillValue, overwrite = false): FillItem => ({ frameId: 0, fieldId: field(label).id, frameOrigin: ORIGIN, value, overwrite });

function open(fixture: string) {
  load(fixture);
  page = createPageAutofill(document);
  fields = page.scan({ layout: false }).fields;
}

describe("list widgets", () => {
  beforeEach(() => open("widgets.html"));

  it("opens a list, clicks the entry with the wanted text and leaves the list closed", async () => {
    const [out] = await page.fill([item("Country", { kind: "choose", picks: [["Deutschland", "Germany"]] })], 0, ORIGIN);
    expect(out!.status).toBe("filled");
    expect($("#country").textContent).toBe("Germany");
    expect($<HTMLElement>("#country-list").hidden).toBe(true);
  });

  it("types into a search box and waits for the list it loads", async () => {
    const [out] = await page.fill([item("City", { kind: "choose", picks: [["Berlin"]] })], 0, ORIGIN);
    expect(out!.status).toBe("filled");
    expect($("#city").value).toBe("Berlin");
  });

  it("picks nothing when no entry matches, and clears what it typed", async () => {
    const [out] = await page.fill([item("City", { kind: "choose", picks: [["Hamburg"]] })], 0, ORIGIN);
    expect(out!.status).toBe("no_option");
    expect($("#city").value).toBe("");
  });

  it("matches the same words first, else the only entry containing them", () => {
    const entries = ["Master's Degree", "Master of Business Administration", "Bachelor's Degree"].map((t) => Object.assign(document.createElement("li"), { textContent: t }));
    expect(matchEntry(entries, ["master s degree"])?.textContent).toBe("Master's Degree");
    expect(matchEntry(entries, ["Bachelor"])?.textContent).toBe("Bachelor's Degree");
    // "Master" is in two entries: no guess.
    expect(matchEntry(entries, ["Master"])).toBeNull();
  });

  it("never types into a list widget as if it were a text field", async () => {
    const [out] = await page.fill([item("Country", { kind: "text", text: "Germany" })], 0, ORIGIN);
    expect(out!.status).toBe("failed");
    expect($("#country").textContent).toBe("Select...");
  });

  it("can't put a list choice back: undo says so, so the user changes it on the page", async () => {
    await page.fill([item("Country", { kind: "choose", picks: [["Germany"]] })], 0, ORIGIN);
    expect(page.undo(0).map((r) => r.status)).toEqual(["manual"]);
  });
});

describe("several options", () => {
  beforeEach(() => open("widgets.html"));

  it("selects options of a multi-select and ticks boxes of a group, and undoes both", async () => {
    const out = await page.fill(
      [item("Languages", { kind: "options", indexes: [0, 1] }), item("Work arrangement", { kind: "options", indexes: [1] })],
      0,
      ORIGIN,
    );
    expect(out.map((o) => o.status)).toEqual(["filled", "filled"]);
    expect(Array.from($<HTMLSelectElement>("#langs").selectedOptions).map((o) => o.text)).toEqual(["English", "German"]);
    expect(Array.from(document.querySelectorAll<HTMLInputElement>("input[name=arr]")).map((c) => c.checked)).toEqual([false, true]);
    page.undo(0);
    expect($<HTMLSelectElement>("#langs").selectedOptions.length).toBe(0);
    expect(Array.from(document.querySelectorAll<HTMLInputElement>("input[name=arr]")).some((c) => c.checked)).toBe(false);
  });

  it("rejects option numbers the field doesn't have", async () => {
    const [out] = await page.fill([item("Languages", { kind: "options", indexes: [7] })], 0, ORIGIN);
    expect(out!.status).toBe("no_option");
  });
});

describe("files", () => {
  // jsdom has no DataTransfer and only takes its own FileList: stand-ins for both.
  const files = new WeakMap<HTMLInputElement, File[]>();
  const proto = HTMLInputElement.prototype;
  const original = Object.getOwnPropertyDescriptor(proto, "files")!;
  const PDF = { name: "x.pdf", mime: "application/pdf", base64: btoa("%PDF-1.7 test") };
  const ref = "resume:11111111-1111-1111-1111-111111111111";
  const cv = (format: "pdf" | "docx" = "pdf"): FillValue => ({ kind: "file", ref, format, name: `Anna Schmidt - CV.${format}` });

  beforeEach(() => {
    (window as unknown as { DataTransfer: unknown }).DataTransfer = class {
      private list: File[] = [];
      items = { add: (f: File) => this.list.push(f) };
      get files() {
        return Object.assign([...this.list], { item: (i: number) => this.list[i] ?? null });
      }
    };
    Object.defineProperty(proto, "files", {
      configurable: true,
      get(this: HTMLInputElement) {
        return files.get(this) ?? [];
      },
      set(this: HTMLInputElement, v: File[]) {
        files.set(this, Array.from(v));
      },
    });
    open("widgets.html");
  });
  afterEach(() => {
    Object.defineProperty(proto, "files", original);
    delete (window as unknown as { DataTransfer?: unknown }).DataTransfer;
  });

  it("attaches the file under the name shown in the review, and tells the page", async () => {
    let changed = 0;
    $("#cv").addEventListener("change", () => changed++);
    const [out] = await page.fill([item("Resume", cv())], 0, ORIGIN, { [fileKey(ref, "pdf")]: PDF });
    expect(out!.status).toBe("filled");
    const attached = $("#cv").files![0]!;
    expect(attached.name).toBe("Anna Schmidt - CV.pdf");
    expect(attached.type).toBe("application/pdf");
    expect(await attached.text()).toBe("%PDF-1.7 test");
    expect(changed).toBe(1);
  });

  it("refuses a file type the field doesn't accept", async () => {
    const docx = { name: "x.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", base64: btoa("PK") };
    const [out] = await page.fill([item("Resume", cv("docx"))], 0, ORIGIN, { [fileKey(ref, "docx")]: docx });
    expect(out!.status).toBe("wrong_file_type");
    expect($("#cv").files!.length).toBe(0);
  });

  it("reports a file the service worker couldn't fetch", async () => {
    const [out] = await page.fill([item("Resume", cv())], 0, ORIGIN, {});
    expect(out!.status).toBe("file_unavailable");
  });

  it("doesn't replace a file already attached unless the user ticked it", async () => {
    files.set($("#cv"), [new File(["mine"], "my-own-cv.pdf", { type: "application/pdf" })]);
    const [kept] = await page.fill([item("Resume", cv())], 0, ORIGIN, { [fileKey(ref, "pdf")]: PDF });
    expect(kept!.status).toBe("has_value");
    expect($("#cv").files![0]!.name).toBe("my-own-cv.pdf");
    const [replaced] = await page.fill([item("Resume", cv(), true)], 0, ORIGIN, { [fileKey(ref, "pdf")]: PDF });
    expect(replaced!.status).toBe("filled");
  });

  it("reads accept lists like the browser", () => {
    const pdf = { name: "a.pdf", mime: "application/pdf" };
    const docx = { name: "a.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    expect(accepts("", pdf)).toBe(true);
    expect(accepts(".pdf,.doc", docx)).toBe(true);
    expect(accepts("application/pdf", pdf)).toBe(true);
    expect(accepts("application/*", docx)).toBe(true);
    expect(accepts("image/*", pdf)).toBe(false);
    expect(accepts(".pdf", docx)).toBe(false);
  });
});

describe("multi-step forms: watching the page", () => {
  it("says once that the form changed when a step adds fields, after the page settles", async () => {
    vi.useFakeTimers();
    try {
      load("simple-en.html");
      const notify = vi.fn();
      const p = createPageAutofill(document, notify);
      p.scan({ layout: false });
      // A burst of changes: the next step's fields appear one after another.
      const form = document.querySelector("form")!;
      for (let i = 0; i < 3; i++) form.appendChild(Object.assign(document.createElement("input"), { name: `step2_${i}` }));
      await vi.advanceTimersByTimeAsync(100);
      expect(notify).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(800);
      expect(notify).toHaveBeenCalledTimes(1);
      // Text changes that add no fields say nothing.
      form.appendChild(document.createElement("p"));
      await vi.advanceTimersByTimeAsync(1000);
      expect(notify).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't watch a page that was never scanned for AutoFill", async () => {
    load("simple-en.html");
    const notify = vi.fn();
    createPageAutofill(document, notify);
    document.querySelector("form")!.appendChild(document.createElement("input"));
    await new Promise((r) => setTimeout(r, 900));
    expect(notify).not.toHaveBeenCalled();
  });
});
