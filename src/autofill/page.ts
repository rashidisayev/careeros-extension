/**
 * The page side of AutoFill, as one object kept in the extension's isolated world for the
 * life of the document (page scripts can't see or call it). `autofill.js` creates it once;
 * the service worker then calls scan, fill, undo and highlight through executeScript.
 *
 * After the first scan it watches the page for new form fields (the next step of a
 * multi-step application, an "Add another role" block) and tells the extension that the form
 * changed: a bare notice, with nothing from the page in it.
 */
import { createRegistry, detectFields } from "./detector";
import { clearHighlights, createExecutorState, fill, filledState, highlight, undo, type ExecutorState } from "./executor";
import type { FieldOutcome, FillItem, PageFile, ScanResult, UndoReport } from "./types";

export type PageAutofill = {
  scan: (opts?: { layout?: boolean }) => ScanResult;
  fill: (items: FillItem[], frameId: number, origin: string, files?: Record<string, PageFile>) => Promise<FieldOutcome[]>;
  undo: (frameId: number, fieldIds?: string[]) => UndoReport["results"];
  attention: (fieldIds: string[]) => void;
  clearHighlights: () => void;
};

const WATCHED = "input:not([type=hidden]), select, textarea, [role=combobox], button[aria-haspopup=listbox]";
/** Quiet time before a change is reported (pages add fields in bursts). */
const SETTLE_MS = 700;
/** The page is watched this long after the last scan. */
const WATCH_MS = 30 * 60_000;

/** Calls `notify` when the set of form controls on the page changes. */
export function watchForm(doc: Document, notify: () => void): { touch: () => void; stop: () => void } {
  const view = doc.defaultView;
  if (!view?.MutationObserver) return { touch: () => undefined, stop: () => undefined };
  const count = () => doc.querySelectorAll(WATCHED).length;
  let last = count();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let until = Date.now() + WATCH_MS;
  const observer = new view.MutationObserver(() => {
    if (Date.now() > until) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const n = count();
      if (n !== last) {
        last = n;
        notify();
      }
    }, SETTLE_MS);
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  return {
    touch: () => {
      last = count();
      until = Date.now() + WATCH_MS;
    },
    stop: () => observer.disconnect(),
  };
}

export function createPageAutofill(doc: Document, notify?: () => void): PageAutofill {
  const state: ExecutorState = createExecutorState(createRegistry());
  const els = (ids: string[]) => ids.flatMap((id) => state.registry.entries.get(id) ?? []);
  let watcher: ReturnType<typeof watchForm> | null = null;
  return {
    scan: (opts) => {
      const result = detectFields(doc, state.registry, { layout: opts?.layout ?? true, filledState: (id, e) => filledState(state, id, e) });
      if (notify) {
        watcher ??= watchForm(doc, notify);
        watcher.touch();
      }
      return result;
    },
    fill: (items, frameId, origin, files) => fill(state, items, frameId, origin, doc, files ?? {}),
    undo: (frameId, fieldIds) => undo(state, frameId, fieldIds),
    attention: (fieldIds) => highlight(state, els(fieldIds).filter((e) => !state.highlighted.has(e)), "attention"),
    clearHighlights: () => clearHighlights(state),
  };
}
