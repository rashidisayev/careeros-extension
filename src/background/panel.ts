/** Opening the side panel, with a small window as fallback where the API is missing. */
import { log } from "../shared/log";

export async function openPanel(target: { tabId?: number; windowId?: number }): Promise<boolean> {
  if (!chrome.sidePanel?.open) return false;
  try {
    if (target.tabId !== undefined) await chrome.sidePanel.open({ tabId: target.tabId });
    else if (target.windowId !== undefined) await chrome.sidePanel.open({ windowId: target.windowId });
    else return false;
    return true;
  } catch (err) {
    log.warn("panel.open_failed", { reason: err instanceof Error ? err.message.slice(0, 60) : "unknown" });
    return false;
  }
}

/** The side panel page in a popup window, for browsers without chrome.sidePanel. */
export async function openPanelWindow(tabId: number): Promise<void> {
  await chrome.windows.create({
    url: chrome.runtime.getURL(`sidepanel.html?tab=${tabId}`),
    type: "popup",
    width: 420,
    height: 760,
  });
}
