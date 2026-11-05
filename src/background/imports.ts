/**
 * Starting and finishing a job import for a tab. An import is created only when the user
 * asks to save (button, menu, shortcut), never because a page was opened, so CareerOS (and
 * its AI, where the user allowed it) only processes postings the user chose.
 */
import type { ApplicationDetail, ImportOut, ImportSave } from "../shared/api-types";
import { ExtensionError, messageFor } from "../shared/errors";
import { log } from "../shared/log";
import { restrictedPlatformFor } from "../shared/policy";
import { api } from "./api";
import { patchState, selectionIn, tabState } from "./tabs";

async function remember(tabId: number | null, imp: ImportOut): Promise<ImportOut> {
  if (tabId !== null) await patchState(tabId, { importId: imp.id, actionError: null });
  log.info("import.started", { import_id: imp.id, method: imp.method, status: imp.status });
  return imp;
}

export async function importFromPage(tabId: number): Promise<ImportOut> {
  const state = await tabState(tabId, true);
  if (state.kind === "restricted") {
    const name = state.restricted?.name ?? "This site";
    throw new ExtensionError(
      "platform_restricted",
      `${name} doesn't allow other services to read its job pages, so CareerOS doesn't. Select the job description on the page and save the selection, or paste it.`,
    );
  }
  if (state.kind === "no_access") throw new ExtensionError("no_access", messageFor("no_access"));
  if (!state.extraction || state.kind === "careeros" || state.kind === "unsupported") {
    throw new ExtensionError("extraction_failed", messageFor("extraction_failed"));
  }
  return remember(tabId, await api.importFromCapture(state.extraction.capture));
}

export async function importFromSelection(tabId: number, fallbackText?: string): Promise<ImportOut> {
  const tab = await chrome.tabs.get(tabId);
  let text = "";
  try {
    text = await selectionIn(tabId);
  } catch {
    // No access to the tab (the panel followed it there): the menu's own copy still works.
    if (!fallbackText) {
      throw new ExtensionError(
        "no_access",
        "The extension can't read this tab yet. Right-click the selected text and choose “Save selected text as a job description”, or click the CareerOS icon first.",
      );
    }
  }
  text = text || (fallbackText ?? "").trim();
  if (text.length < 40) {
    throw new ExtensionError("selection_empty", "Select the job description on the page first, then save the selection.");
  }
  const url = tab.url && /^https?:\/\//.test(tab.url) ? tab.url : null;
  return remember(tabId, await api.importFromText(text, url));
}

export async function importFromText(tabId: number | null, url: string | null, text: string): Promise<ImportOut> {
  return remember(tabId, await api.importFromText(text, url));
}

/** Saves the reviewed fields. A likely duplicate is refused by the API (409) unless the user
 * chose "Save as a separate application"; existing applications are never changed. */
export async function saveImport(importId: string, fields: ImportSave, tabId: number | null): Promise<ApplicationDetail> {
  const app = await api.saveImport(importId, fields);
  log.info("import.saved", { import_id: importId, status: app.status });
  // The import stays on the tab (now "saved") so the panel can confirm; closing it clears
  // it. The page is looked up again so its status shows right away.
  if (tabId !== null) await tabState(tabId, true).catch(() => undefined);
  return app;
}

export function isRestrictedUrl(url: string | null): boolean {
  return !!url && !!restrictedPlatformFor(url);
}
