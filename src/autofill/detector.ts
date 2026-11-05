/**
 * Form detector: finds the controls on a page and describes each one by its label, ARIA,
 * placeholder, name, id, autocomplete, options, section heading and surrounding text. Runs
 * in the page (isolated world) and in jsdom for tests.
 *
 * It reads descriptions only. It never reads what a field contains, only whether it is empty,
 * and it skips password, hidden, disabled and read-only controls entirely.
 */
import { detectAts } from "./adapters";
import type { ControlKind, FieldDescriptor, FieldOption, FieldSignals, FormGroup, ScanResult } from "./types";

// List widgets: comboboxes, and "Select one" buttons that open a listbox (Workday).
const CONTROLS = "input, select, textarea, [role=combobox]:not(input):not(select), button[aria-haspopup=listbox]";
const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "password", "search", "range", "color"]);
const MAX_FIELDS = 400;
const MAX_NODES = 40_000;
const MAX_TEXT = 200;

/** Elements are tracked per page so the same control keeps its id between scans. */
export type Registry = {
  next: number;
  ids: WeakMap<Element, string>;
  /** id → the control (radios: every radio of the group). */
  entries: Map<string, Element[]>;
};

export function createRegistry(): Registry {
  return { next: 1, ids: new WeakMap(), entries: new Map() };
}

export type DetectOptions = {
  /** Use layout (client rects) to skip invisible controls. Off in jsdom, which has no layout. */
  layout?: boolean;
  /** What GetCareer wrote into a control earlier, to tell "still ours" from "edited". */
  filledState?: (id: string, els: Element[]) => "no" | "yes" | "edited";
};

/** For attribute values inside quoted selectors (CSS.escape isn't everywhere, e.g. jsdom). */
const quote = (v: string) => v.replace(/["\\]/g, "\\$&");

const clean = (t: string | null | undefined, max = MAX_TEXT): string | undefined => {
  const s = (t ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
};

/** Visible text of a node, without the text of controls inside it (a label around a select). */
function textOf(node: Element, max = MAX_TEXT): string | undefined {
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll("select, option, textarea, input, script, style, svg, [aria-hidden=true], [hidden]").forEach((n) => n.remove());
  return clean(copy.textContent, max);
}

function root(el: Element): Document | ShadowRoot {
  return el.getRootNode() as Document | ShadowRoot;
}

function byId(el: Element, id: string): Element | null {
  const r = root(el);
  return "getElementById" in r ? r.getElementById(id) : el.ownerDocument.getElementById(id);
}

function idrefText(el: Element, attr: string): string | undefined {
  const ids = el.getAttribute(attr)?.split(/\s+/).filter(Boolean) ?? [];
  const parts = ids.map((id) => byId(el, id)).filter((n): n is Element => !!n).map((n) => textOf(n));
  return clean(parts.filter(Boolean).join(" "));
}

function labelsOf(el: Element): string | undefined {
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) return clean(Array.from(labels).map((l) => textOf(l)).filter(Boolean).join(" "));
  // Shadow DOM and some frameworks: <label for> without the browser linking it.
  const id = el.getAttribute("id");
  if (id) {
    const r = root(el);
    const l = r.querySelector?.(`label[for="${quote(id)}"]`);
    if (l) return textOf(l);
  }
  return undefined;
}

function isHidden(el: Element, layout: boolean): boolean {
  if (el.closest("[hidden], [aria-hidden=true], [inert]")) return true;
  const view = el.ownerDocument.defaultView;
  for (let n: Element | null = el, i = 0; n && i < 8; n = n.parentElement, i++) {
    const s = view?.getComputedStyle(n);
    if (s && (s.display === "none" || s.visibility === "hidden")) return true;
  }
  return layout && el.getClientRects().length === 0;
}

function kindOf(el: Element): ControlKind | null {
  const tag = el.tagName;
  if (tag === "SELECT") return "select";
  if (tag === "BUTTON") return el.getAttribute("aria-haspopup") === "listbox" ? "custom" : null;
  if (tag === "TEXTAREA") return "textarea";
  if (tag !== "INPUT") return "custom";
  const type = ((el as HTMLInputElement).type || "text").toLowerCase();
  if (SKIP_TYPES.has(type)) return null;
  // A text box that opens a list (react-select, downshift, …) only takes one of its options;
  // typing a value into it doesn't choose anything. Treated like other custom widgets.
  if (el.getAttribute("role") === "combobox" && (type === "text" || type === "search")) return "custom";
  switch (type) {
    case "email":
      return "email";
    case "tel":
      return "tel";
    case "url":
      return "url";
    case "number":
      return "number";
    case "date":
    case "month":
    case "datetime-local":
      return "date";
    case "radio":
      return "radio";
    case "checkbox":
      return "checkbox";
    case "file":
      return "file";
    default:
      return "text";
  }
}

const HEADING = /^(H[1-6]|LEGEND)$/;

/** The closest heading or legend above the control, inside its form. */
function sectionOf(el: Element, stop: Element | null): string | undefined {
  const fs = el.closest("fieldset");
  const legend = fs?.querySelector(":scope > legend");
  if (legend && (!stop || stop.contains(fs!))) return textOf(legend, 120);
  for (let n: Element | null = el; n && n !== stop && n.parentElement; n = n.parentElement) {
    let sib = n.previousElementSibling;
    for (let i = 0; sib && i < 12; sib = sib.previousElementSibling, i++) {
      if (HEADING.test(sib.tagName) || sib.getAttribute("role") === "heading") return textOf(sib, 120);
      const inner = sib.querySelector?.("h1, h2, h3, h4, h5, h6, legend, [role=heading]");
      if (inner && sib.querySelectorAll(CONTROLS).length === 0) return textOf(inner, 120);
    }
  }
  return undefined;
}

/** Text around a control that has no <label>: the nearest wrapper holding only this field. */
function contextOf(el: Element, fieldEls: Element[], stop: Element | null): string | undefined {
  let n: Element | null = el.parentElement;
  for (let i = 0; n && i < 4 && n !== stop; i++, n = n.parentElement) {
    const controls = Array.from(n.querySelectorAll(CONTROLS)).filter((c) => kindOf(c) !== null);
    if (controls.some((c) => !fieldEls.includes(c))) return undefined;
    const t = textOf(n, 300);
    if (t) return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) : t;
  }
  return undefined;
}

function signalsOf(el: Element, fieldEls: Element[], stop: Element | null, section: string | undefined): FieldSignals {
  const a = (name: string) => clean(el.getAttribute(name), 120);
  const s: FieldSignals = {
    label: labelsOf(el),
    aria: a("aria-label") ?? idrefText(el, "aria-labelledby"),
    placeholder: a("placeholder"),
    title: a("title"),
    name: a("name"),
    id: a("id"),
    dataId: a("data-automation-id") ?? a("data-qa") ?? a("data-testid") ?? a("data-field") ?? a("data-ui"),
    autocomplete: a("autocomplete"),
    description: idrefText(el, "aria-describedby"),
    section,
  };
  if (!s.label && !s.aria) s.context = contextOf(el, fieldEls, stop);
  for (const k of Object.keys(s) as (keyof FieldSignals)[]) if (s[k] === undefined) delete s[k];
  return s;
}

function radioGroupLabel(radios: HTMLInputElement[], stop: Element | null): string | undefined {
  const first = radios[0]!;
  const group = first.closest("[role=radiogroup], [role=group]");
  if (group) {
    const t = clean(group.getAttribute("aria-label")) ?? idrefText(group, "aria-labelledby");
    if (t) return t;
  }
  const fs = first.closest("fieldset");
  if (fs && radios.every((r) => fs.contains(r))) {
    const legend = fs.querySelector(":scope > legend");
    if (legend) return textOf(legend);
  }
  // The wrapper holding every radio of the group and nothing else, minus the option labels.
  let n: Element | null = first.parentElement;
  for (let i = 0; n && i < 5 && n !== stop; i++, n = n.parentElement) {
    if (!radios.every((r) => n!.contains(r))) continue;
    const others = Array.from(n.querySelectorAll(CONTROLS)).filter((c) => kindOf(c) !== null && !radios.includes(c as HTMLInputElement));
    if (others.length) return undefined;
    const copy = n.cloneNode(true) as Element;
    copy.querySelectorAll("label, input, [hidden], [aria-hidden=true]").forEach((x) => x.remove());
    const t = clean(copy.textContent);
    if (t) return t;
  }
  return undefined;
}

function radioOptionLabel(r: HTMLInputElement): string {
  return labelsOf(r) ?? clean(r.getAttribute("aria-label")) ?? clean(r.nextSibling?.textContent) ?? r.value;
}

// What an empty list widget shows.
const PLACEHOLDER = /^(?:(?:select|choose|please select|select one|search|type to search|start typing|bitte wahlen|bitte auswahlen|auswahlen|wahlen sie|none selected)\b|-{1,3}(?:\s|$))/i;

/** A list widget's visible box: the largest wrapper holding only this control. */
export function widgetBox(el: Element): Element {
  if (el.tagName === "BUTTON") return el;
  let box: Element = el;
  for (let n = el.parentElement, i = 0; n && i < 4; n = n.parentElement, i++) {
    if (n.querySelectorAll(CONTROLS).length > 1 || n.tagName === "FORM" || n.querySelector("label")) break;
    box = n;
  }
  return box;
}

/** The text a list widget shows (its chosen entry, or its placeholder). */
export function widgetText(el: Element): string {
  if (el.tagName === "BUTTON") return textOf(el) ?? "";
  const box = widgetBox(el);
  if (box === el) return "";
  const copy = box.cloneNode(true) as Element;
  copy.querySelectorAll("[class*=placeholder i], [class*=indicator i], [aria-live], [role=listbox], [role=option], [role=alert], .visually-hidden, .sr-only").forEach((n) => n.remove());
  return clean(copy.textContent) ?? "";
}

/** Whether a list widget shows a chosen entry (not its placeholder). */
export function widgetHasValue(el: Element): boolean {
  const t = widgetText(el).replace(/[\s*✱]+$/, "");
  if (!t) return false;
  return !PLACEHOLDER.test(t.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""));
}

function hasValue(el: Element, kind: ControlKind, group: Element[]): boolean {
  if (kind === "radio" || kind === "checkboxes") return group.some((r) => (r as HTMLInputElement).checked);
  if (kind === "checkbox") return (el as HTMLInputElement).checked;
  if (kind === "file") return ((el as HTMLInputElement).files?.length ?? 0) > 0;
  if (kind === "select") {
    const s = el as HTMLSelectElement;
    const o = s.options[s.selectedIndex];
    if (!o || !o.value || o.disabled) return false;
    // A select shows its first option until someone picks one: that isn't a value.
    return s.selectedIndex > 0 || o.defaultSelected;
  }
  if (kind === "custom") return widgetHasValue(el);
  return ((el as HTMLInputElement).value ?? "").trim() !== "";
}

/** Every control, also inside open shadow roots. */
function collect(doc: Document): Element[] {
  const out: Element[] = [];
  let seen = 0;
  const walk = (r: Document | ShadowRoot) => {
    for (const el of Array.from(r.querySelectorAll("*"))) {
      if (++seen > MAX_NODES) return;
      if (el.matches(CONTROLS)) out.push(el);
      const sr = (el as HTMLElement).shadowRoot;
      if (sr) walk(sr);
    }
  };
  walk(doc);
  return out;
}

function groupRoot(el: Element): Element | null {
  const f = (el as HTMLInputElement).form ?? el.closest("form");
  if (f) return f;
  // Inside a shadow root, the host's form.
  const host = (el.getRootNode() as ShadowRoot).host;
  return host ? groupRoot(host) : null;
}

export function detectFields(doc: Document, registry: Registry, opts: DetectOptions = {}): ScanResult {
  const layout = opts.layout ?? true;
  const groups = new Map<Element | null, FormGroup>();
  const groupIds = new Map<Element | null, string>();
  const fields: FieldDescriptor[] = [];
  const doneRadios = new Set<Element>();
  let truncated = false;

  const groupFor = (rootEl: Element | null): FormGroup => {
    let g = groups.get(rootEl);
    if (!g) {
      const id = `g${groups.size + 1}`;
      const scope = rootEl ?? doc.body;
      // A search box, not a form with a search field inside a widget (the country picker of
      // a phone field has one): a search input counts only in a small form.
      const isSearch =
        !!rootEl &&
        (rootEl.getAttribute("role") === "search" ||
          !!rootEl.closest("[role=search]") ||
          /search|suche/i.test(rootEl.getAttribute("action") ?? "") ||
          (!!rootEl.querySelector("input[type=search]") &&
            rootEl.querySelectorAll("input:not([type=hidden]):not([type=search]):not([type=submit]):not([type=button]), select, textarea").length <= 3));
      const hasPassword = Array.from(scope?.querySelectorAll("input[type=password]") ?? []).some((p) => !isHidden(p, layout));
      g = { id, controlCount: 0, hasPassword, isSearch };
      groups.set(rootEl, g);
      groupIds.set(rootEl, id);
    }
    return g;
  };

  for (const el of collect(doc)) {
    if (fields.length >= MAX_FIELDS) {
      truncated = true;
      break;
    }
    const kind = kindOf(el);
    if (!kind) continue;
    const input = el as HTMLInputElement;
    if (input.disabled || (input.readOnly && kind !== "select") || el.getAttribute("aria-disabled") === "true") continue;
    if (kind !== "file" && isHidden(el, layout)) continue;
    if (kind === "custom" && el.getAttribute("contenteditable") === null && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !labelsOf(el)) continue;
    if (doneRadios.has(el)) continue;

    const rootEl = groupRoot(el);
    const group = groupFor(rootEl);
    let els: Element[] = [el];
    let options: FieldOption[] = [];
    let label: string | undefined;
    let kindNow: ControlKind = kind;

    // Checkboxes sharing a name are one question with several answers ("Languages: ☐ German ☐ English").
    if (kind === "checkbox" && input.name) {
      const scope = rootEl ?? el.ownerDocument;
      const same = Array.from(scope.querySelectorAll(`input[type=checkbox][name="${quote(input.name)}"]`)).filter((r) => !isHidden(r, layout) && !(r as HTMLInputElement).disabled);
      if (same.length >= 2) {
        kindNow = "checkboxes";
        els = same;
        els.forEach((r) => doneRadios.add(r));
        options = (els as HTMLInputElement[]).map((r, index) => ({ index, value: r.value, label: radioOptionLabel(r) }));
      }
    }

    if (kind === "radio") {
      const name = input.name;
      const scope = rootEl ?? el.ownerDocument;
      els = name
        ? Array.from(scope.querySelectorAll(`input[type=radio][name="${quote(name)}"]`)).filter((r) => !isHidden(r, layout))
        : [el];
      els.forEach((r) => doneRadios.add(r));
      options = (els as HTMLInputElement[]).map((r, index) => ({ index, value: r.value, label: radioOptionLabel(r) }));
    } else if (kind === "select") {
      options = Array.from((el as HTMLSelectElement).options).map((o, index) => ({ index, value: o.value, label: clean(o.textContent, 120) ?? "" }));
    }

    let id = registry.ids.get(els[0]!);
    if (!id) {
      id = `f${registry.next++}`;
      for (const e of els) registry.ids.set(e, id);
    }
    registry.entries.set(id, els);
    group.controlCount++;

    const section = sectionOf(el, rootEl);
    const signals = kindNow === "radio" || kindNow === "checkboxes" ? radioSignals(els as HTMLInputElement[], rootEl, section) : signalsOf(el, els, rootEl, section);
    label = signals.label ?? signals.aria ?? signals.context ?? signals.placeholder ?? signals.title;
    const required =
      els.some((e) => (e as HTMLInputElement).required || e.getAttribute("aria-required") === "true") || /[*✱]\s*$/.test(label ?? "");

    fields.push({
      id,
      kind: kindNow,
      group: group.id,
      label: (label ?? "").replace(/[\s*✱]+$/, "").slice(0, 120),
      signals,
      options,
      required,
      multiple: kind === "select" && (el as HTMLSelectElement).multiple,
      maxLength: (kind === "text" || kind === "textarea" || kind === "email" || kind === "tel" || kind === "url") && input.maxLength > 0 ? input.maxLength : null,
      hasValue: hasValue(el, kindNow, els),
      filledByGetCareer: opts.filledState?.(id, els) ?? "no",
      ...(kind === "date" ? { inputType: input.type.toLowerCase() } : {}),
      ...(kind === "file" ? { accept: clean(input.accept, 200) ?? "" } : {}),
    });
  }

  return {
    frameUrl: doc.location?.href ?? doc.URL,
    lang: clean(doc.documentElement.getAttribute("lang"), 20) ?? null,
    groups: [...groups.values()],
    fields,
    truncated,
    ats: detectAts(doc),
  };
}

function radioSignals(radios: HTMLInputElement[], stop: Element | null, section: string | undefined): FieldSignals {
  const first = radios[0]!;
  const s: FieldSignals = { label: radioGroupLabel(radios, stop), name: clean(first.name, 120), section };
  for (const k of Object.keys(s) as (keyof FieldSignals)[]) if (s[k] === undefined) delete s[k];
  return s;
}
