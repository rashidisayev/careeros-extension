import { RefreshCw, Settings as SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { SessionInfo } from "../shared/types";
import { Alert, Button, Logo } from "./components";
import { ConnectView } from "./connect";

export function Header({ right }: { right?: ReactNode }) {
  return (
    <header className="flex h-12 items-center justify-between gap-2 border-b px-4">
      <Logo />
      <div className="flex items-center gap-1">
        {right}
        <button
          type="button"
          onClick={() => chrome.runtime.openOptionsPage()}
          className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Extension settings"
          title="Extension settings"
        >
          <SettingsIcon className="size-4" aria-hidden />
        </button>
      </div>
    </header>
  );
}

/** Session gate: loading, not connected, update required, or the connected content. */
export function SessionGate({
  session,
  error,
  onReload,
  children,
  compact,
}: {
  session: SessionInfo | null;
  error: { message: string } | null;
  onReload: (refresh?: boolean) => void;
  children: (s: Extract<SessionInfo, { connected: true }>) => ReactNode;
  compact?: boolean;
}) {
  if (error && !session) {
    return (
      <Alert
        tone="error"
        title="The extension couldn't start"
        action={
          <Button size="sm" variant="outline" onClick={() => onReload(true)}>
            <RefreshCw aria-hidden /> Try again
          </Button>
        }
      >
        <p>{error.message}</p>
      </Alert>
    );
  }
  if (!session) {
    return (
      <p role="status" className="text-muted-foreground">
        Loading…
      </p>
    );
  }
  if (!session.connected) return <ConnectView reason={session.reason} onConnected={() => onReload(true)} compact={compact} />;
  if (session.updateRequired) {
    return (
      <Alert tone="warning" title="Update the extension">
        <p>This version of CareerOS Companion is too old for CareerOS. Update it in your browser's extension settings, then reopen it.</p>
      </Alert>
    );
  }
  return (
    <>
      {session.bootstrapError && (
        <div className="mb-4">
          <Alert
            tone="warning"
            title="CareerOS can't be reached right now"
            action={
              <Button size="sm" variant="outline" onClick={() => onReload(true)}>
                <RefreshCw aria-hidden /> Try again
              </Button>
            }
          >
            <p>{session.bootstrapError.message}</p>
          </Alert>
        </div>
      )}
      {children(session)}
    </>
  );
}

export const INTENT_KEY = (tabId: number) => `intent.${tabId}`;
export type Intent = { mode: "paste" | "autofill"; at: number };

/** Opens the side panel for a tab inside the user's click, or a window where it's missing. */
export async function openPanelFor(tabId: number): Promise<void> {
  try {
    if (!chrome.sidePanel?.open) throw new Error("no side panel");
    await chrome.sidePanel.open({ tabId });
  } catch {
    await chrome.windows.create({ url: chrome.runtime.getURL(`sidepanel.html?tab=${tabId}`), type: "popup", width: 420, height: 760 });
  }
}
