/** Toolbar popup: what's on this tab, whether you track it, and one next action. */
import "../pages/styles.css";
import { ExternalLink } from "lucide-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Alert, Button } from "../ui/components";
import { send } from "../ui/client";
import { AutofillSummary, autofillAvailable, useAutofill } from "../ui/autofill-view";
import { useSession, useSettings, useTabState, useTheme } from "../ui/hooks";
import { Header, INTENT_KEY, openPanelFor, SessionGate, type Intent } from "../ui/shell";
import { TabSkeleton, TabView } from "../ui/tab-view";

function Popup() {
  const [settings] = useSettings();
  useTheme(settings.theme);
  const session = useSession();
  const [tabId, setTabId] = useState<number | null>(null);
  const connected = session.data?.connected === true;
  const tab = useTabState(tabId, connected);
  const [busy, setBusy] = useState(false);
  const readable = !!tab.data && ["job", "maybe_job", "not_job"].includes(tab.data.kind);
  const bootstrap = session.data?.connected ? session.data.bootstrap : null;
  const autofillOn = connected && readable && autofillAvailable(bootstrap, settings.autofill.enabled);
  const autofill = useAutofill(autofillOn ? tabId : null, autofillOn);

  useEffect(() => {
    // ?tab= is only used by the browser tests, which open the popup page in a tab.
    const fixed = Number(new URLSearchParams(location.search).get("tab"));
    if (Number.isInteger(fixed) && fixed > 0) return setTabId(fixed);
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([t]) => setTabId(t?.id ?? null))
      .catch(() => setTabId(null));
  }, []);

  const open = (path: string) => {
    send({ type: "app.open", path }).catch(() => undefined);
    window.close();
  };
  /** The review happens in the side panel: open it within this click, then start reading. */
  const startInPanel = (type: "import.fromPage" | "import.fromSelection") => {
    if (tabId === null) return;
    setBusy(true);
    const opened = openPanelFor(tabId);
    // The background keeps going after the popup closes; failures show up in the panel.
    send({ type, tabId }).catch(() => undefined);
    opened.finally(() => window.close());
  };
  const inPanel = async (mode: Intent["mode"]) => {
    if (tabId === null) return;
    const opened = openPanelFor(tabId);
    await chrome.storage.session.set({ [INTENT_KEY(tabId)]: { mode, at: Date.now() } satisfies Intent });
    opened.finally(() => window.close());
  };
  const paste = () => inPanel("paste");

  return (
    <div className="flex max-h-[600px] min-h-[280px] flex-col">
      <Header />
      <main className="grid gap-4 overflow-y-auto p-4">
        <SessionGate session={session.data} error={session.error} onReload={session.reload} compact>
          {(s) => (
            <>
              {tab.error && !tab.data ? (
                <Alert tone="error" title="This page couldn't be checked">
                  <p>{tab.error.message}</p>
                </Alert>
              ) : !tab.data ? (
                <TabSkeleton />
              ) : (
                <>
                {autofill.plan?.isApplicationForm && (
                  <AutofillSummary
                    plan={autofill.plan}
                    onOpen={open}
                    action={
                      <div className="grid gap-1.5">
                        <Button onClick={() => inPanel("autofill")}>Fill application</Button>
                        <p className="text-xs text-muted-foreground">You review every value in the side panel first.</p>
                      </div>
                    }
                  />
                )}
                <TabView
                  state={tab.data}
                  bootstrap={s.bootstrap}
                  actions={{
                    onSave: () => startInPanel("import.fromPage"),
                    onSaveSelection: () => startInPanel("import.fromSelection"),
                    onPaste: paste,
                    onOpen: open,
                    onRetry: () => tab.reload(true),
                    saving: busy,
                  }}
                />
                </>
              )}
            </>
          )}
        </SessionGate>
      </main>
      {connected && session.data?.connected && (
        <footer className="flex items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <span className="min-w-0 truncate" title={session.data.user.email}>
            {session.data.user.email}
          </span>
          <Button variant="link" className="text-xs" onClick={() => open("/applications")}>
            Your applications <ExternalLink className="size-3" aria-hidden />
            <span className="sr-only">(opens CareerOS in a new tab)</span>
          </Button>
        </footer>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
