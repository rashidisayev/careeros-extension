/** Handles requests from the extension's own pages. See shared/messages.ts for the contract. */
import { appUrl, EXTENSION_VERSION } from "../shared/config";
import { ExtensionError, toErrorInfo } from "../shared/errors";
import { log, recentLogs, setConsoleLogging } from "../shared/log";
import { isTrustedSender, parseRequest, type Request, type ResponseMap, type Response } from "../shared/messages";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../shared/settings";
import { api } from "./api";
import { answersTab, cvs, deleteAnswer, deleteHistory, doneTab, fillTab, history, saveAnswer, savedAnswers, scanTab, undoTab } from "./autofill";
import { broadcastSettings } from "./broadcast";
import { importFromPage, importFromSelection, importFromText, saveImport } from "./imports";
import { connectAccount, disconnectAccount, sessionInfo } from "./session";
import { patchState, tabState } from "./tabs";

type Handler<K extends Request["type"]> = (req: Extract<Request, { type: K }>) => Promise<ResponseMap[K]>;
type Handlers = { [K in Request["type"]]: Handler<K> };

const handlers: Handlers = {
  "session.get": (r) => sessionInfo(r.refresh ?? false),
  "session.connect": () => connectAccount(),
  "session.disconnect": () => disconnectAccount(),
  "tab.state": (r) => tabState(r.tabId, r.refresh ?? false),
  "import.fromPage": (r) => importFromPage(r.tabId),
  "import.fromSelection": (r) => importFromSelection(r.tabId),
  "import.fromText": (r) => importFromText(r.tabId, r.url, r.text),
  "import.get": (r) => api.getImport(r.importId),
  "import.text": (r) => api.submitText(r.importId, r.text),
  "import.retry": (r) => api.retryImport(r.importId),
  "import.save": (r) => saveImport(r.importId, r.fields, r.tabId),
  "import.dismiss": async (r) => {
    const s = await patchState(r.tabId, { importId: null, actionError: null });
    return s ?? tabState(r.tabId);
  },
  "application.get": (r) => api.application(r.applicationId),
  "app.open": async (r) => {
    await chrome.tabs.create({ url: appUrl(r.path) });
    return null;
  },
  "settings.get": () => loadSettings(),
  "settings.set": async (r) => {
    const next = await saveSettings(r.patch);
    setConsoleLogging(next.diagnostics);
    broadcastSettings();
    return next;
  },
  "site.accessChanged": async () => null,
  "diagnostics.get": async () => ({ version: EXTENSION_VERSION, logs: recentLogs() }),
  "autofill.scan": (r) => scanTab(r.tabId),
  "autofill.fill": (r) => fillTab(r.tabId, r.pageUrl, r.items, r.attention, r.stats),
  "autofill.undo": (r) => undoTab(r.tabId, r.fields),
  "autofill.done": (r) => doneTab(r.tabId),
  "autofill.answers": (r) => answersTab(r.tabId, r.pageUrl, r.questions, r.language, r.length, r.tone),
  "autofill.savedAnswers": () => savedAnswers(),
  "autofill.saveAnswer": (r) => saveAnswer(r.fieldKey, r.question, r.answer),
  "autofill.deleteAnswer": (r) => deleteAnswer(r.id),
  "autofill.history": () => history(),
  "autofill.historyDelete": (r) => deleteHistory(r.id),
  "autofill.cvs": () => cvs(),
  "data.clear": async () => {
    // Everything the extension keeps in this browser except the connection itself: page
    // readings, cached account details, open intents, and the settings (back to defaults).
    const all = await chrome.storage.session.get(null);
    await chrome.storage.session.remove(Object.keys(all).filter((k) => k !== "auth.access"));
    const next = await saveSettings(structuredClone(DEFAULT_SETTINGS));
    setConsoleLogging(next.diagnostics);
    broadcastSettings();
    log.info("data.cleared", {});
    return next;
  },
};

export async function handle(req: Request): Promise<Response<unknown>> {
  try {
    const handler = handlers[req.type] as (r: Request) => Promise<unknown>;
    return { ok: true, data: await handler(req) };
  } catch (err) {
    const error = toErrorInfo(err);
    if (!(err instanceof ExtensionError)) log.error("handler.crash", { type: req.type, name: err instanceof Error ? err.name : "unknown" });
    // Saves started from the popup finish in the side panel (the popup closes): keep the
    // problem on the tab so the panel can show it.
    if (req.type === "import.fromPage" || req.type === "import.fromSelection") {
      await patchState(req.tabId, { actionError: error }).catch(() => undefined);
    }
    return { ok: false, error };
  }
}

export function registerMessageRouter(): void {
  const origin = chrome.runtime.getURL("").replace(/\/$/, "");
  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    if (!isTrustedSender(sender, chrome.runtime.id, origin)) return false;
    // Broadcasts from other pages are not requests.
    if (raw && typeof raw === "object" && String((raw as { type?: unknown }).type).startsWith("broadcast.")) return false;
    const req = parseRequest(raw);
    if (!req) {
      sendResponse({ ok: false, error: { code: "bad_request", message: "The request was not understood." } });
      return false;
    }
    handle(req).then(sendResponse);
    return true;
  });
}
