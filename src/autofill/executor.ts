/**
 * Autofill executor: writes the values the user reviewed into the page, the way typing would,
 * so React, Vue and Angular forms notice (native value setter, then input, change and blur
 * events). Remembers what each control held before and what it wrote, for undo and to tell
 * when the user changed a field afterwards. Never submits, never clicks buttons, never
 * touches a control it wasn't given.
 *
 * List widgets (comboboxes, "Select one" buttons) are answered the way a person would: open
 * the widget, type the text to filter it if it takes text, and click the entry whose text is
 * the reviewed value. Nothing else on the page is clicked, and when no entry matches exactly
 * (or only one partly), the widget is closed again and the field is left to the user.
 */
import { widgetBox, widgetHasValue, widgetText, type Registry } from "./detector";
import { containsPhrase, norm } from "./normalize";
import type { FieldOutcome, FillItem, FillStatus, FillValue, PageFile, UndoReport } from "./types";

type Snapshot =
  | { kind: "text"; text: string }
  | { kind: "index"; index: number }
  | { kind: "check"; checked: boolean }
  | { kind: "indexes"; indexes: number[] }
  | { kind: "files"; names: string[]; list: FileList | null }
  | { kind: "widget"; text: string };
type Written = { before: Snapshot; after: Snapshot };

export type ExecutorState = {
  registry: Registry;
  written: Map<string, Written>;
  highlighted: Map<Element, { outline: string; offset: string }>;
};

export function createExecutorState(registry: Registry): ExecutorState {
  return { registry, written: new Map(), highlighted: new Map() };
}

const FILLED = "2px solid #0e7c86";
const ATTENTION = "2px dashed #d97706";
/** How long a list widget may take to show its entries. */
const LIST_WAIT_MS = 1500;

/** The browser's own setter, below any instance-level override a framework installed. */
function nativeSet(el: Element, prop: "value" | "checked" | "selectedIndex" | "selected" | "files", value: unknown): void {
  for (let p = Object.getPrototypeOf(el); p; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, prop);
    if (d?.set) {
      d.set.call(el, value);
      return;
    }
  }
  (el as unknown as Record<string, unknown>)[prop] = value;
}

function fire(el: Element, ...types: string[]): void {
  const view = el.ownerDocument.defaultView!;
  for (const t of types) {
    const ev = t === "blur" || t === "focusout" ? new view.FocusEvent(t, { bubbles: t === "focusout" }) : new view.Event(t, { bubbles: true, composed: true });
    el.dispatchEvent(ev);
  }
}

/** A pointer press and release on an element, as frameworks expect from a click. */
function press(el: Element): void {
  const view = el.ownerDocument.defaultView!;
  // No `view`: widgets don't read it, and some environments reject another realm's window.
  const init = { bubbles: true, cancelable: true, composed: true, button: 0 };
  const Pointer = (view as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent ?? view.MouseEvent;
  el.dispatchEvent(new Pointer("pointerdown", init));
  el.dispatchEvent(new view.MouseEvent("mousedown", init));
  el.dispatchEvent(new Pointer("pointerup", init));
  el.dispatchEvent(new view.MouseEvent("mouseup", init));
  el.dispatchEvent(new view.MouseEvent("click", init));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isWidget = (el: Element) => el.getAttribute("role") === "combobox" || (el.tagName === "BUTTON" && el.getAttribute("aria-haspopup") === "listbox");
const isMultiSelect = (el: Element) => el.tagName === "SELECT" && (el as HTMLSelectElement).multiple;
const isCheckGroup = (els: Element[]) => els.length > 1 && (els[0] as HTMLInputElement).type === "checkbox";

function snapshot(els: Element[]): Snapshot {
  const el = els[0]!;
  if (isWidget(el)) return { kind: "widget", text: widgetText(el) };
  if (isMultiSelect(el)) return { kind: "indexes", indexes: Array.from((el as HTMLSelectElement).options).flatMap((o, i) => (o.selected ? [i] : [])) };
  if (el.tagName === "SELECT") return { kind: "index", index: (el as HTMLSelectElement).selectedIndex };
  const input = el as HTMLInputElement;
  if (isCheckGroup(els)) return { kind: "indexes", indexes: els.flatMap((c, i) => ((c as HTMLInputElement).checked ? [i] : [])) };
  if (input.type === "radio") return { kind: "index", index: els.findIndex((r) => (r as HTMLInputElement).checked) };
  if (input.type === "checkbox") return { kind: "check", checked: input.checked };
  if (input.type === "file") return { kind: "files", names: Array.from(input.files ?? []).map((f) => f.name), list: input.files };
  return { kind: "text", text: input.value ?? "" };
}

function same(a: Snapshot, b: Snapshot): boolean {
  if (a.kind === "files" && b.kind === "files") return a.names.join("\n") === b.names.join("\n");
  return JSON.stringify(a) === JSON.stringify(b);
}

function isEmpty(s: Snapshot, els: Element[]): boolean {
  if (s.kind === "text") return s.text.trim() === "";
  if (s.kind === "check") return !s.checked;
  if (s.kind === "indexes") return s.indexes.length === 0;
  if (s.kind === "files") return s.names.length === 0;
  if (s.kind === "widget") return !widgetHasValue(els[0]!);
  const el = els[0]!;
  if (el.tagName === "SELECT") {
    const sel = el as HTMLSelectElement;
    const o = sel.options[s.index];
    return !o || !o.value || (s.index === 0 && !o.defaultSelected);
  }
  return s.index < 0;
}

function apply(els: Element[], to: Snapshot): void {
  const el = els[0]!;
  if (to.kind === "text") {
    nativeSet(el, "value", to.text);
    fire(el, "input", "change", "blur", "focusout");
  } else if (to.kind === "check") {
    if ((el as HTMLInputElement).checked !== to.checked) (el as HTMLInputElement).click();
  } else if (to.kind === "indexes") {
    if (isMultiSelect(el)) {
      Array.from((el as HTMLSelectElement).options).forEach((o, i) => nativeSet(o, "selected", to.indexes.includes(i)));
      fire(el, "input", "change", "blur", "focusout");
    } else {
      els.forEach((c, i) => {
        if ((c as HTMLInputElement).checked !== to.indexes.includes(i)) (c as HTMLInputElement).click();
      });
    }
  } else if (to.kind === "files") {
    const view = el.ownerDocument.defaultView as unknown as { DataTransfer?: typeof DataTransfer };
    const list = to.list ?? (view.DataTransfer ? new view.DataTransfer().files : null);
    if (list) nativeSet(el, "files", list);
    else nativeSet(el, "value", "");
    fire(el, "input", "change");
  } else if (to.kind === "widget") {
    throw new Error("list widgets are changed by the user");
  } else if (el.tagName === "SELECT") {
    nativeSet(el, "selectedIndex", to.index);
    fire(el, "input", "change", "blur", "focusout");
  } else {
    // Radios: click the chosen one (frameworks listen for click/change); clearing unchecks all.
    const target = els[to.index] as HTMLInputElement | undefined;
    if (target) {
      if (!target.checked) target.click();
    } else {
      for (const r of els as HTMLInputElement[]) {
        if (r.checked) {
          nativeSet(r, "checked", false);
          fire(r, "input", "change");
        }
      }
    }
  }
}

function toSnapshot(v: FillValue, els: Element[]): Snapshot | null {
  if (v.kind === "text") return { kind: "text", text: v.text };
  if (v.kind === "check") return { kind: "check", checked: v.checked };
  const el = els[0]!;
  const count = el.tagName === "SELECT" ? (el as HTMLSelectElement).options.length : els.length;
  if (v.kind === "options") {
    const indexes = [...new Set(v.indexes)].filter((i) => i >= 0 && i < count).sort((a, b) => a - b);
    return indexes.length === v.indexes.length && indexes.length ? { kind: "indexes", indexes } : null;
  }
  if (v.kind === "option") return v.index >= 0 && v.index < count ? { kind: "index", index: v.index } : null;
  return null;
}

function compatible(v: FillValue, els: Element[]): boolean {
  const el = els[0]!;
  const type = (el as HTMLInputElement).type;
  switch (v.kind) {
    case "option":
      return (el.tagName === "SELECT" && !isMultiSelect(el)) || type === "radio";
    case "options":
      return isMultiSelect(el) || isCheckGroup(els);
    case "check":
      return type === "checkbox" && !isCheckGroup(els);
    case "choose":
      return isWidget(el);
    case "file":
      return el.tagName === "INPUT" && type === "file";
    default:
      // Never type into a combobox: the text would only filter its list, not choose a value.
      if (isWidget(el)) return false;
      return el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["radio", "checkbox", "file", "password", "hidden"].includes(type));
  }
}

export function highlight(state: ExecutorState, els: Element[], tone: "filled" | "attention"): void {
  for (const raw of els) {
    // A list widget's input is often tiny or invisible: outline its box.
    const el = isWidget(raw) ? widgetBox(raw) : raw;
    const h = el as HTMLElement;
    if (!h.style) continue;
    if (!state.highlighted.has(el)) state.highlighted.set(el, { outline: h.style.outline, offset: h.style.outlineOffset });
    h.style.outline = tone === "filled" ? FILLED : ATTENTION;
    h.style.outlineOffset = "1px";
  }
}

export function clearHighlights(state: ExecutorState, only?: Element[]): void {
  const targets = only?.map((e) => (isWidget(e) ? widgetBox(e) : e));
  for (const [el, prev] of [...state.highlighted]) {
    if (targets && !targets.includes(el)) continue;
    (el as HTMLElement).style.outline = prev.outline;
    (el as HTMLElement).style.outlineOffset = prev.offset;
    state.highlighted.delete(el);
  }
}

/** "yes": still what CareerOS wrote; "edited": changed since; "no": never filled. */
export function filledState(state: ExecutorState, id: string, els: Element[]): "no" | "yes" | "edited" {
  const w = state.written.get(id);
  if (!w) return "no";
  return same(snapshot(els), w.after) ? "yes" : "edited";
}

// ---- List widgets ----------------------------------------------------------------------

function visible(el: Element): boolean {
  if (el.closest("[hidden], [aria-hidden=true]")) return false;
  const s = el.ownerDocument.defaultView?.getComputedStyle(el as HTMLElement);
  return !s || (s.display !== "none" && s.visibility !== "hidden");
}

/** The entries the widget shows now: its own listbox (aria-controls/owns), else the open one. */
function entriesOf(el: Element): Element[] {
  const doc = el.ownerDocument;
  const root = el.getRootNode() as Document | ShadowRoot;
  const ids = `${el.getAttribute("aria-controls") ?? ""} ${el.getAttribute("aria-owns") ?? ""}`.split(/\s+/).filter(Boolean);
  let lists = ids.map((id) => ("getElementById" in root ? root.getElementById(id) : doc.getElementById(id))).filter((n): n is HTMLElement => !!n);
  if (!lists.length) lists = Array.from(doc.querySelectorAll<HTMLElement>("[role=listbox]")).filter(visible);
  return lists
    .flatMap((l) => (l.matches("[role=option]") ? [l] : Array.from(l.querySelectorAll("[role=option]"))))
    .filter((o) => o.getAttribute("aria-disabled") !== "true" && visible(o));
}

/** The entry that is one of the wanted texts: the same words, else the only one containing them. */
export function matchEntry(entries: Element[], wanted: string[]): Element | null {
  const texts = entries.map((e) => norm(e.textContent ?? ""));
  const want = wanted.map(norm).filter(Boolean);
  for (const w of want) {
    const i = texts.indexOf(w);
    if (i >= 0) return entries[i]!;
  }
  const partial = entries.filter((_, i) => want.some((w) => containsPhrase(texts[i]!, w)));
  return partial.length === 1 ? partial[0]! : null;
}

async function waitForEntries(el: Element): Promise<Element[]> {
  const until = Date.now() + LIST_WAIT_MS;
  for (;;) {
    const found = entriesOf(el);
    if (found.length || Date.now() > until) return found;
    await sleep(50);
  }
}

function closeWidget(el: Element): void {
  const view = el.ownerDocument.defaultView!;
  if (el.tagName === "INPUT") {
    nativeSet(el, "value", "");
    fire(el, "input");
  }
  el.dispatchEvent(new view.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  (el as HTMLElement).blur?.();
}

/** Opens the widget, finds the entry for one pick and clicks it. */
async function pickOne(el: HTMLElement, wanted: string[]): Promise<boolean> {
  const typing = el.tagName === "INPUT";
  const tries = typing ? wanted.slice(0, 3) : [wanted[0] ?? ""];
  for (const text of tries) {
    el.focus?.();
    press(el);
    if (typing) {
      nativeSet(el, "value", text);
      fire(el, "input");
    }
    const match = matchEntry(await waitForEntries(el), wanted);
    if (match) {
      press(match);
      await sleep(30);
      return true;
    }
  }
  return false;
}

async function choose(el: HTMLElement, picks: string[][]): Promise<FillStatus> {
  for (const wanted of picks) {
    if (!(await pickOne(el, wanted))) {
      closeWidget(el);
      return "no_option";
    }
  }
  // Leave the widget closed, like after choosing by hand.
  if (el.tagName === "INPUT" && entriesOf(el).length) el.dispatchEvent(new (el.ownerDocument.defaultView!.KeyboardEvent)("keydown", { key: "Escape", bubbles: true }));
  return "filled";
}

// ---- Files -------------------------------------------------------------------------------

/** How the service worker labels the files it passes to the page. */
export const fileKey = (ref: string, format: string) => `${ref}|${format}`;

/** Whether the input's accept list allows the file ("" or missing: anything). */
export function accepts(accept: string, file: { name: string; mime: string }): boolean {
  const tokens = accept.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!tokens.length) return true;
  const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  const mime = file.mime.toLowerCase();
  return tokens.some((t) => t === ext || t === mime || (t.endsWith("/*") && mime.startsWith(t.slice(0, -1))) || t === "*/*" || (t === ".doc" && ext === ".docx"));
}

function attach(input: HTMLInputElement, file: PageFile): FillStatus {
  const view = input.ownerDocument.defaultView as unknown as { DataTransfer?: typeof DataTransfer; File: typeof File };
  if (!view.DataTransfer) return "failed";
  if (!accepts(input.accept ?? "", file)) return "wrong_file_type";
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const dt = new view.DataTransfer();
  dt.items.add(new view.File([bytes], file.name, { type: file.mime }));
  nativeSet(input, "files", dt.files);
  fire(input, "input", "change");
  return "filled";
}

// ---- Fill and undo -------------------------------------------------------------------------

export async function fill(
  state: ExecutorState,
  items: FillItem[],
  frameId: number,
  origin: string,
  doc: Document,
  files: Record<string, PageFile> = {},
): Promise<FieldOutcome[]> {
  const out: FieldOutcome[] = [];
  // The frame must still show the site the user reviewed; otherwise nothing is written.
  const here = doc.defaultView?.location.origin ?? "";
  for (const item of items) {
    const ref = { frameId, fieldId: item.fieldId };
    const result = (status: FillStatus) => out.push({ ...ref, status });
    if (item.frameOrigin !== origin || here !== origin) {
      result("wrong_page");
      continue;
    }
    const els = state.registry.entries.get(item.fieldId)?.filter((e) => e.isConnected);
    if (!els?.length) {
      result("not_found");
      continue;
    }
    if (!compatible(item.value, els)) {
      result("failed");
      continue;
    }
    const now = snapshot(els);
    const prev = state.written.get(item.fieldId);
    // What the user typed after an earlier fill always wins.
    if (prev && !same(now, prev.after)) {
      result("user_edited");
      continue;
    }
    if (!prev && !isEmpty(now, els) && !item.overwrite) {
      result("has_value");
      continue;
    }

    try {
      let status: FillStatus;
      if (item.value.kind === "choose") {
        status = await choose(els[0] as HTMLElement, item.value.picks);
      } else if (item.value.kind === "file") {
        const file = files[fileKey(item.value.ref, item.value.format)];
        status = file ? attach(els[0] as HTMLInputElement, { ...file, name: item.value.name }) : "file_unavailable";
      } else {
        const target = toSnapshot(item.value, els);
        if (!target) {
          result("no_option");
          continue;
        }
        if (target.kind === "text") {
          const max = (els[0] as HTMLInputElement).maxLength;
          if (max > 0 && target.text.length > max) {
            result("too_long");
            continue;
          }
        }
        apply(els, target);
        status = "filled";
      }
      if (status === "filled") {
        state.written.set(item.fieldId, { before: prev?.before ?? now, after: snapshot(els) });
        highlight(state, els, "filled");
      }
      result(status);
    } catch {
      result("failed");
    }
  }
  return out;
}

/** Puts back what the fields held before AutoFill, except where the user changed them since. */
export function undo(state: ExecutorState, frameId: number, fieldIds?: string[]): UndoReport["results"] {
  const out: UndoReport["results"] = [];
  for (const [id, w] of [...state.written]) {
    if (fieldIds && !fieldIds.includes(id)) continue;
    const els = state.registry.entries.get(id)?.filter((e) => e.isConnected);
    if (!els?.length) {
      state.written.delete(id);
      out.push({ frameId, fieldId: id, status: "not_found" });
      continue;
    }
    clearHighlights(state, els);
    state.written.delete(id);
    if (!same(snapshot(els), w.after)) {
      out.push({ frameId, fieldId: id, status: "kept_user_edit" });
      continue;
    }
    // A list widget's earlier entry can't be chosen back reliably: the user does it.
    if (w.before.kind === "widget") {
      out.push({ frameId, fieldId: id, status: "manual" });
      continue;
    }
    apply(els, w.before);
    out.push({ frameId, fieldId: id, status: "restored" });
  }
  return out;
}
