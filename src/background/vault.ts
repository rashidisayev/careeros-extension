/**
 * Long-lived credentials (the refresh token) live in IndexedDB of the extension's own origin.
 * Unlike chrome.storage.local, content scripts can't read it: only the extension's pages and
 * its service worker run on chrome-extension://<id>, and only the service worker uses this.
 * The short-lived access token is kept in chrome.storage.session (memory, trusted contexts).
 */
const DB_NAME = "careeros-vault";
const STORE = "secrets";

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => {
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error ?? new Error("vault unavailable"));
    };
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error ?? new Error("vault error"));
    tx.onabort = () => reject(tx.error ?? new Error("vault aborted"));
  });
}

export const vault = {
  get: <T>(key: string) => run<T>("readonly", (s) => s.get(key) as IDBRequest<T>),
  set: (key: string, value: unknown) => run("readwrite", (s) => void s.put(value, key)).then(() => undefined),
  delete: (key: string) => run("readwrite", (s) => void s.delete(key)).then(() => undefined),
  clear: () => run("readwrite", (s) => void s.clear()).then(() => undefined),
};
