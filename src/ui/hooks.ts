import { useCallback, useEffect, useRef, useState } from "react";
import { RUNNING_IMPORT, type ImportOut } from "../shared/api-types";
import { DEFAULT_SETTINGS, loadSettings, SETTINGS_KEY, type Settings } from "../shared/settings";
import type { ErrorInfo, SessionInfo, TabState } from "../shared/types";
import { errorInfo, onBroadcast, send } from "./client";

export type Async<T> = { data: T | null; error: ErrorInfo | null; loading: boolean; reload: (refresh?: boolean) => void };

export function useSession(): Async<SessionInfo> {
  const [data, setData] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback((refresh = false) => {
    setLoading(true);
    send({ type: "session.get", refresh })
      .then((s) => {
        setData(s);
        setError(null);
      })
      .catch((e) => setError(errorInfo(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    reload();
    return onBroadcast((b) => {
      if (b.type === "broadcast.session") reload();
    });
  }, [reload]);
  return { data, error, loading, reload };
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => Promise<void>] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    loadSettings().then(setSettings).catch(() => undefined);
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[SETTINGS_KEY]) loadSettings().then(setSettings).catch(() => undefined);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await send({ type: "settings.set", patch }));
  }, []);
  return [settings, update];
}

/** Applies the theme setting to <html> (dark is the default, "system" follows the OS). */
export function useTheme(theme: Settings["theme"]): void {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

export function useTabState(tabId: number | null, enabled: boolean): Async<TabState> {
  const [data, setData] = useState<TabState | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const current = useRef(tabId);
  current.current = tabId;
  const reload = useCallback(
    (refresh = false) => {
      if (tabId === null || !enabled) return;
      setLoading(true);
      send({ type: "tab.state", tabId, refresh })
        .then((s) => {
          if (current.current !== tabId) return;
          setData(s);
          setError(null);
        })
        .catch((e) => current.current === tabId && setError(errorInfo(e)))
        .finally(() => current.current === tabId && setLoading(false));
    },
    [tabId, enabled],
  );
  useEffect(() => {
    setData(null);
    setError(null);
    reload();
    return onBroadcast((b) => {
      if (b.type === "broadcast.tab" && b.tabId === tabId) reload();
    });
  }, [reload, tabId]);
  return { data, error, loading, reload };
}

const POLL_MS = 1200;
const SLOW_AFTER_MS = 60_000;

/** An import, polled while GetCareer is still reading it. */
export function useImport(importId: string | null): Async<ImportOut> & { slow: boolean; set: (i: ImportOut) => void } {
  const [data, setData] = useState<ImportOut | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [tick, setTick] = useState(0);
  const started = useRef(Date.now());

  useEffect(() => {
    setData(null);
    setError(null);
    setSlow(false);
    started.current = Date.now();
  }, [importId]);

  useEffect(() => {
    if (!importId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      setLoading(true);
      try {
        const imp = await send({ type: "import.get", importId });
        if (stop) return;
        setData(imp);
        setError(null);
        if (RUNNING_IMPORT.includes(imp.status)) {
          setSlow(Date.now() - started.current > SLOW_AFTER_MS);
          timer = setTimeout(poll, POLL_MS);
        }
      } catch (e) {
        if (!stop) setError(errorInfo(e));
      } finally {
        if (!stop) setLoading(false);
      }
    };
    poll();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [importId, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const set = useCallback((i: ImportOut) => {
    setData(i);
    if (RUNNING_IMPORT.includes(i.status)) setTick((t) => t + 1);
  }, []);
  return { data, error, loading, reload, slow, set };
}

/** The tab this page is about: ?tab= (fallback window), else the active tab of its window. */
export function useActiveTab(follow: boolean): number | null {
  const [tabId, setTabId] = useState<number | null>(() => {
    const fixed = Number(new URLSearchParams(location.search).get("tab"));
    return Number.isInteger(fixed) && fixed > 0 ? fixed : null;
  });
  const fixed = useRef(tabId !== null);
  const followRef = useRef(follow);
  followRef.current = follow;

  useEffect(() => {
    if (fixed.current) return;
    let windowId: number | undefined;
    chrome.windows
      .getCurrent()
      .then((w) => {
        windowId = w.id;
        return chrome.tabs.query({ active: true, windowId: w.id });
      })
      .then(([tab]) => tab?.id !== undefined && setTabId(tab.id))
      .catch(() => undefined);
    const onActivated = (info: { tabId: number; windowId: number }) => {
      if (followRef.current && info.windowId === windowId) setTabId(info.tabId);
    };
    chrome.tabs.onActivated.addListener(onActivated);
    return () => chrome.tabs.onActivated.removeListener(onActivated);
  }, []);
  return tabId;
}
