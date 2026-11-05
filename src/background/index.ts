/**
 * CareerOS Companion service worker. All listeners are registered synchronously at the top
 * level so the browser can wake the worker for them (Manifest V3).
 */
import { log, setConsoleLogging } from "../shared/log";
import { loadSettings } from "../shared/settings";
import { registerFormWatch } from "./autofill";
import { createMenus, registerMenuListener } from "./menus";
import { registerMessageRouter } from "./router";
import { registerTabListeners } from "./tabs";

registerMessageRouter();
registerTabListeners();
registerMenuListener();
registerFormWatch();

chrome.runtime.onInstalled.addListener((details) => {
  createMenus();
  log.info("extension.installed", { reason: details.reason });
  // The toolbar icon opens the popup; the side panel opens from there or the menu.
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => createMenus());

loadSettings()
  .then((s) => setConsoleLogging(s.diagnostics))
  .catch(() => undefined);
