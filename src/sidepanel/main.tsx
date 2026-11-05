/**
 * Side panel: follows the active tab (unless turned off in settings) and hosts the review
 * and save flow. While you review a job it stays on that job, even if you switch tabs.
 */
import "../pages/styles.css";
import { ArrowLeftRight, X } from "lucide-react";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { FieldKey } from "../autofill/types";
import { restrictedPlatformFor } from "../shared/policy";
import { Alert, Button } from "../ui/components";
import { send } from "../ui/client";
import { AutofillHint, AutofillPanel, answersAccess, autofillAvailable, useAutofill } from "../ui/autofill-view";
import { useActiveTab, useSession, useSettings, useTabState, useTheme } from "../ui/hooks";
import { ImportFlow, PasteForm } from "../ui/import-view";
import { Header, INTENT_KEY, SessionGate, type Intent } from "../ui/shell";
import { SiteAccess } from "../ui/site-access";
import { TabSkeleton, TabView } from "../ui/tab-view";

/** What the popup asked the panel to do for this tab (paste a description, or AutoFill). */
function useIntent(tabId: number | null): [Intent["mode"] | null, (v: Intent["mode"] | null) => void] {
  const [intent, setIntent] = useState<Intent["mode"] | null>(null);
  useEffect(() => {
    setIntent(null);
    if (tabId === null) return;
    const key = INTENT_KEY(tabId);
    const check = () =>
      chrome.storage.session.get(key).then((got) => {
        const found = got[key] as Intent | undefined;
        if (found && Date.now() - found.at < 60_000) {
          setIntent(found.mode);
          chrome.storage.session.remove(key).catch(() => undefined);
        }
      });
    check().catch(() => undefined);
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && changes[key]?.newValue) check().catch(() => undefined);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [tabId]);
  return [intent, setIntent];
}

function Panel() {
  const [settings, updateSettings] = useSettings();
  useTheme(settings.theme);
  const session = useSession();
  const activeTab = useActiveTab(settings.followTabs);
  const [pinned, setPinned] = useState<number | null>(null);
  const tabId = pinned ?? activeTab;
  const connected = session.data?.connected === true;
  const tab = useTabState(tabId, connected);
  const [intent, setIntent] = useIntent(tabId);
  const paste = intent === "paste";
  const setPaste = (v: boolean) => setIntent(v ? "paste" : null);
  const [busy, setBusy] = useState(false);
  const [autofillBusy, setAutofillBusy] = useState(false);
  const onAutofillMode = useCallback((m: string) => setAutofillBusy(m !== "summary"), []);

  // AutoFill reads forms only on pages the extension may already read (not restricted ones).
  const readable = !!tab.data && ["job", "maybe_job", "not_job"].includes(tab.data.kind);
  const bootstrap = session.data?.connected ? session.data.bootstrap : null;
  const autofillOn = connected && readable && autofillAvailable(bootstrap, settings.autofill.enabled);
  const autofill = useAutofill(autofillOn ? tabId : null, autofillOn);
  const exclude = (key: FieldKey) =>
    void updateSettings({ autofill: { ...settings.autofill, excluded: [...new Set([...settings.autofill.excluded, key])] } }).catch(() => undefined);

  const importId = tab.data?.importId ?? null;
  // Stay on the job being reviewed when the user switches tabs.
  useEffect(() => {
    if (importId && tabId !== null && pinned === null) setPinned(tabId);
    if (!importId && pinned !== null && tab.data?.tabId === pinned) setPinned(null);
  }, [importId, tabId, pinned, tab.data?.tabId]);

  const run = async (type: "import.fromPage" | "import.fromSelection") => {
    if (tabId === null) return;
    setBusy(true);
    try {
      await send({ type, tabId });
    } catch {
      // Shown from the tab's actionError.
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async () => {
    if (tabId !== null) await send({ type: "import.dismiss", tabId }).catch(() => undefined);
    setPinned(null);
  };
  const open = (path: string) => send({ type: "app.open", path }).catch(() => undefined);
  const url = tab.data?.url ?? null;

  return (
    <div className="flex min-h-svh flex-col">
      <Header />
      <main className="grid flex-1 content-start gap-4 p-4">
        <SessionGate session={session.data} error={session.error} onReload={session.reload}>
          {(s) => (
            <>
              {pinned !== null && activeTab !== null && activeTab !== pinned && (
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <ArrowLeftRight className="size-3.5" aria-hidden />
                  Showing the job you're saving from another tab.
                  <Button variant="link" className="text-xs" onClick={() => setPinned(null)}>
                    Show this tab
                  </Button>
                </p>
              )}
              {tab.data?.actionError && (
                <Alert
                  tone="error"
                  title="Not saved"
                  action={
                    <Button size="sm" variant="ghost" onClick={() => dismiss()}>
                      <X aria-hidden /> Dismiss
                    </Button>
                  }
                >
                  <p>{tab.data.actionError.message}</p>
                </Alert>
              )}
              {tab.error && !tab.data ? (
                <Alert tone="error" title="This tab couldn't be checked" action={<Button size="sm" variant="outline" onClick={() => tab.reload(true)}>Try again</Button>}>
                  <p>{tab.error.message}</p>
                </Alert>
              ) : tabId === null || !tab.data ? (
                <TabSkeleton />
              ) : importId ? (
                <ImportFlow
                  key={importId}
                  importId={importId}
                  tabId={tabId}
                  bootstrap={s.bootstrap}
                  defaultStatus={settings.defaultStatus}
                  onClose={dismiss}
                />
              ) : paste ? (
                <PasteForm
                  title="Paste the job description"
                  intro="GetCareer reads the details from the text; you check them before saving."
                  onSubmit={async (text) => {
                    await send({ type: "import.fromText", tabId, url: url && /^https?:/.test(url) ? url : null, text });
                    setPaste(false);
                  }}
                  onCancel={() => setPaste(false)}
                />
              ) : (
                <>
                  {autofillOn && tabId !== null && (
                    <AutofillPanel
                      key={tabId}
                      tabId={tabId}
                      state={autofill}
                      excluded={settings.autofill.excluded}
                      answers={answersAccess(s.bootstrap, settings.autofill)}
                      onExclude={exclude}
                      onOpen={open}
                      startInReview={intent === "autofill"}
                      onModeChange={onAutofillMode}
                    />
                  )}
                  {!(autofillOn && autofillBusy) && (
                  <TabView
                    state={tab.data}
                    bootstrap={s.bootstrap}
                    actions={{
                      onSave: () => void run("import.fromPage"),
                      onSaveSelection: () => void run("import.fromSelection"),
                      onPaste: () => setPaste(true),
                      onOpen: open,
                      onRetry: () => tab.reload(true),
                      saving: busy,
                    }}
                  />
                  )}
                  {autofillOn && !autofillBusy && <AutofillHint state={autofill} />}
                  {url && !restrictedPlatformFor(url) && ["job", "maybe_job", "not_job"].includes(tab.data.kind) && <SiteAccess url={url} />}
                </>
              )}
            </>
          )}
        </SessionGate>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Panel />
  </StrictMode>,
);
