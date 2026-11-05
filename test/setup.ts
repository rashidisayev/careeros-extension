/**
 * Test environment: jsdom plus an in-memory IndexedDB and a minimal `chrome` stub with the
 * storage areas and runtime the code under test touches. Tests replace pieces as needed.
 */
import "fake-indexeddb/auto";
import { beforeEach, vi } from "vitest";

type Store = Record<string, unknown>;

function area(): chrome.storage.StorageArea & { _data: Store } {
  const data: Store = {};
  const pick = (keys: unknown): Store => {
    if (keys === null || keys === undefined) return { ...data };
    const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys as object);
    const out: Store = {};
    for (const k of list as string[]) if (k in data) out[k] = structuredClone(data[k]);
    return out;
  };
  return {
    _data: data,
    get: vi.fn(async (keys?: unknown) => pick(keys)),
    set: vi.fn(async (items: Store) => {
      for (const [k, v] of Object.entries(items)) data[k] = structuredClone(v);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const k of typeof keys === "string" ? [keys] : keys) delete data[k];
    }),
    clear: vi.fn(async () => {
      for (const k of Object.keys(data)) delete data[k];
    }),
  } as unknown as chrome.storage.StorageArea & { _data: Store };
}

export function installChrome(): typeof chrome {
  const c = {
    runtime: {
      id: "ajbdeolccbgjinhdmllogiefhmcogpma",
      getURL: (p: string) => `chrome-extension://ajbdeolccbgjinhdmllogiefhmcogpma/${p.replace(/^\//, "")}`,
      sendMessage: vi.fn(async () => undefined),
      onMessage: { addListener: vi.fn() },
    },
    storage: { local: area(), session: area(), onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    identity: {
      getRedirectURL: (path = "") => `https://ajbdeolccbgjinhdmllogiefhmcogpma.chromiumapp.org/${path}`,
      launchWebAuthFlow: vi.fn(),
    },
    tabs: { get: vi.fn(), create: vi.fn(), query: vi.fn(), onUpdated: { addListener: vi.fn() }, onRemoved: { addListener: vi.fn() } },
    scripting: { executeScript: vi.fn() },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = c;
  return c as unknown as typeof chrome;
}

beforeEach(() => {
  installChrome();
});
