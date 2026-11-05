/**
 * What the extension knows about a tab: what kind of page it is, the posting read from it,
 * and whether the user already tracks that job. Kept in chrome.storage.session (memory only,
 * not readable by content scripts) per tab, and dropped when the tab navigates or closes.
 *
 * A page is read only when the extension may script it: right after the user clicked the
 * toolbar icon, pressed the shortcut or used the context menu (activeTab), or on a site they
 * allowed. Nothing runs on other pages, and nothing is sent to CareerOS unless the page is a
 * job posting.
 */
import type { LookupOut } from "../shared/api-types";
import { CAREEROS_ORIGIN } from "../shared/config";
import { ExtensionError, messageFor, toErrorInfo } from "../shared/errors";
import { log } from "../shared/log";
import { isRestrictedJobUrl, pageKind, restrictedPlatformFor } from "../shared/policy";
import type { Extraction, TabState } from "../shared/types";
import { api } from "./api";
import { broadcastTab } from "./broadcast";
import { tokenStore } from "./tokens";

const KEY = (tabId: number) => `tab.${tabId}`;
const EXTRACTOR = "extractor.js";
// A lookup is repeated after this long, or after saving.
const LOOKUP_TTL_MS = 2 * 60_000;

export async function readState(tabId: number): Promise<TabState | null> {
  const got = await chrome.storage.session.get(KEY(tabId));
  return (got[KEY(tabId)] as TabState | undefined) ?? null;
}

async function writeState(state: TabState): Promise<TabState> {
  await chrome.storage.session.set({ [KEY(state.tabId)]: state });
  broadcastTab(state.tabId);
  return state;
}

export async function patchState(tabId: number, patch: Partial<TabState>): Promise<TabState | null> {
  const current = await readState(tabId);
  return current ? writeState({ ...current, ...patch }) : null;
}

export async function forgetTab(tabId: number): Promise<void> {
  await chrome.storage.session.remove(KEY(tabId));
  broadcastTab(tabId);
}

function empty(tabId: number, url: string | null, kind: TabState["kind"]): TabState {
  return {
    tabId,
    url,
    kind,
    restricted: null,
    extraction: null,
    lookup: null,
    lookupError: null,
    actionError: null,
    importId: null,
    checkedAt: Date.now(),
  };
}

/** Run the extractor in the tab. Throws no_access when the extension may not script it. */
export async function extractTab(tabId: number): Promise<Extraction | null> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [EXTRACTOR] });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (globalThis as unknown as { __careerosExtract?: () => unknown }).__careerosExtract?.() ?? null,
    });
    return (result?.result as Extraction | null) ?? null;
  } catch (err) {
    log.info("tab.no_access", { reason: err instanceof Error ? err.message.slice(0, 60) : "unknown" });
    throw new ExtensionError("no_access", messageFor("no_access"));
  }
}

/** The text the user selected in the tab (newlines kept), or "". */
export async function selectionIn(tabId: number): Promise<string> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (globalThis.getSelection?.()?.toString() ?? "").trim().slice(0, 60_000),
    });
    return typeof result?.result === "string" ? result.result : "";
  } catch {
    throw new ExtensionError("no_access", messageFor("no_access"));
  }
}

async function lookupFor(url: string, extraction: Extraction | null): Promise<LookupOut> {
  const f = extraction?.fields;
  return api.lookup({
    url,
    title: f?.title?.value.slice(0, 300) ?? null,
    company: f?.company_name?.value.slice(0, 200) ?? null,
    city: f?.location?.value.split(",")[0]?.trim().slice(0, 120) || null,
  });
}

async function withLookup(state: TabState): Promise<TabState> {
  const shouldLook =
    state.kind === "job" || state.kind === "maybe_job" || (state.kind === "restricted" && !!state.url && isRestrictedJobUrl(state.url));
  if (!shouldLook || !state.url || !(await tokenStore.session())) return state;
  try {
    const lookup = await lookupFor(state.extraction?.capture.canonical_url ?? state.url, state.extraction);
    return { ...state, lookup, lookupError: null, importId: state.importId ?? (lookup.pending_import?.import_id ?? null) };
  } catch (err) {
    return { ...state, lookup: null, lookupError: toErrorInfo(err) };
  }
}

/**
 * The state of a tab, from cache when the page hasn't changed. `refresh` reads the page and
 * looks it up again (after the user asked, or after saving).
 */
export async function tabState(tabId: number, refresh = false): Promise<TabState> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new ExtensionError("tab_closed", "This tab is no longer open.");
  }
  // Without the "tabs" permission the address is only visible where the extension has access.
  const url = tab.url ?? tab.pendingUrl ?? null;
  const cached = await readState(tabId);
  if (!url) return writeState({ ...empty(tabId, null, "no_access"), importId: cached?.importId ?? null });

  if (cached && cached.url === url && !refresh) {
    if ((cached.kind === "job" || cached.kind === "maybe_job" || cached.kind === "restricted") && Date.now() - cached.checkedAt > LOOKUP_TTL_MS) {
      return writeState({ ...(await withLookup(cached)), checkedAt: Date.now() });
    }
    return cached;
  }
  const keepImport = cached && cached.url === url ? cached.importId : null;

  const kind = pageKind(url, CAREEROS_ORIGIN);
  if (kind !== "web") return writeState(empty(tabId, url, kind === "careeros" ? "careeros" : "unsupported"));

  const restricted = restrictedPlatformFor(url);
  if (restricted) {
    const state = { ...empty(tabId, url, "restricted"), restricted, importId: keepImport };
    return writeState(await withLookup(state));
  }

  let extraction: Extraction | null;
  try {
    extraction = await extractTab(tabId);
  } catch (err) {
    if ((err as ExtensionError).code === "no_access") return writeState({ ...empty(tabId, url, "no_access"), importId: keepImport });
    throw err;
  }
  const confidence = extraction?.confidence ?? "none";
  const pageType: TabState["kind"] = confidence === "high" || confidence === "medium" ? "job" : confidence === "low" ? "maybe_job" : "not_job";
  log.info("tab.read", { adapter: extraction?.adapter ?? null, confidence, signals: extraction?.signals.join(",") ?? "" });
  const state: TabState = { ...empty(tabId, url, pageType), extraction, importId: keepImport };
  return writeState(await withLookup(state));
}

export function registerTabListeners(): void {
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    // A new page (or a new address in a single-page app) makes the cached reading stale.
    if (info.status === "loading" || info.url) {
      readState(tabId)
        .then((s) => {
          if (s && (!info.url || info.url !== s.url)) return forgetTab(tabId);
        })
        .catch(() => undefined);
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.session.remove(KEY(tabId)).catch(() => undefined);
  });
}
