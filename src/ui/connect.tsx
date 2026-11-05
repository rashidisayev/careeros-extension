import { Check, ExternalLink, Minus } from "lucide-react";
import { useState } from "react";
import type { ErrorInfo } from "../shared/types";
import { Alert, Button } from "./components";
import { errorInfo, send } from "./client";

const CAN = ["Save job postings you choose, after you've checked them", "Show whether you already track a job, and its status", "Show how well a job fits your career direction"];
const CANNOT = ["Read pages you haven't asked it to", "Apply or send messages for you", "Read LinkedIn, Indeed, XING or StepStone pages"];

/** Not connected yet (or the connection ended). */
export function ConnectView({ reason, onConnected, compact }: { reason?: "expired" | "signed_out" | "never"; onConnected: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await send({ type: "session.connect" });
      onConnected();
    } catch (e) {
      setError(errorInfo(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <h1 className="text-base font-semibold">
          {reason === "expired" ? "Connect again to continue" : "Connect to your CareerOS account"}
        </h1>
        <p className="text-muted-foreground">
          {reason === "expired"
            ? "The connection to CareerOS ended, for example because it was disconnected in Settings."
            : "You approve the connection on the CareerOS website, signed in as usual. Your password never passes through the extension."}
        </p>
      </div>
      {!compact && (
        <div className="grid gap-3 text-[0.8125rem]">
          <ul className="grid gap-1.5" aria-label="The extension can">
            {CAN.map((c) => (
              <li key={c} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                {c}
              </li>
            ))}
          </ul>
          <ul className="grid gap-1.5 text-muted-foreground" aria-label="The extension never">
            {CANNOT.map((c) => (
              <li key={c} className="flex gap-2">
                <Minus className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <span className="sr-only">Never: </span>
                  {c}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && error.code !== "connect_cancelled" && (
        <Alert tone="error" title="Connecting didn't work">
          <p>{error.message}</p>
        </Alert>
      )}
      {error?.code === "connect_cancelled" && (
        <p role="status" className="text-xs text-muted-foreground">
          Connecting was cancelled. You can try again whenever you like.
        </p>
      )}
      <div className="grid gap-2">
        <Button busy={busy} onClick={connect}>
          Connect to CareerOS
        </Button>
        <Button variant="ghost" onClick={() => send({ type: "app.open", path: "/register" }).catch(() => undefined)}>
          Create a CareerOS account <ExternalLink aria-hidden />
          <span className="sr-only">(opens a new tab)</span>
        </Button>
      </div>
    </div>
  );
}
