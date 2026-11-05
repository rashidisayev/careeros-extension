/**
 * Right-click actions. Clicking one grants activeTab for that tab, so the extension can read
 * the page (or the selection) without permanent access to the site.
 */
import { toErrorInfo } from "../shared/errors";
import { log } from "../shared/log";
import { importFromPage, importFromSelection } from "./imports";
import { openPanel, openPanelWindow } from "./panel";
import { patchState } from "./tabs";

export const MENU_SAVE_PAGE = "careeros-save-page";
export const MENU_SAVE_SELECTION = "careeros-save-selection";

export function createMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SAVE_PAGE,
      title: "Save this job to CareerOS",
      contexts: ["page"],
      documentUrlPatterns: ["https://*/*", "http://*/*"],
    });
    chrome.contextMenus.create({
      id: MENU_SAVE_SELECTION,
      title: "Save selected text as a job description",
      contexts: ["selection"],
      documentUrlPatterns: ["https://*/*", "http://*/*"],
    });
  });
}

export function registerMenuListener(): void {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id || tab.id < 0) return;
    const tabId = tab.id;
    // Open the panel first, inside the user gesture; the import shows up in it when ready.
    const opened = openPanel({ tabId });
    const run =
      info.menuItemId === MENU_SAVE_SELECTION
        ? importFromSelection(tabId, info.selectionText)
        : info.menuItemId === MENU_SAVE_PAGE
          ? importFromPage(tabId)
          : null;
    if (!run) return;
    opened
      .then((ok) => (ok ? undefined : openPanelWindow(tabId)))
      .catch(() => undefined);
    run.catch(async (err) => {
      const error = toErrorInfo(err);
      log.warn("menu.import_failed", { code: error.code });
      // The panel shows the problem for this tab.
      await patchState(tabId, { actionError: error }).catch(() => undefined);
    });
  });
}
