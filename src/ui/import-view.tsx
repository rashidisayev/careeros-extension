/** One import from start to saved: progress, the paste fallback, review, and the result. */
import { Check, CircleDashed, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import type { ApplicationDetail, ApplicationStatus, Bootstrap, ImportOut } from "../shared/api-types";
import { RUNNING_IMPORT } from "../shared/api-types";
import type { ErrorInfo } from "../shared/types";
import { Alert, Button, CONTROL, StatusPill, cn } from "./components";
import { errorInfo, send } from "./client";
import { useImport } from "./hooks";
import { Review } from "./review";

const STAGES = [
  { status: "retrieving", label: "Reading the posting" },
  { status: "extracting", label: "Finding the details" },
  { status: "matching", label: "Checking how well it fits" },
] as const;
const ORDER = ["queued", "retrieving", "extracting", "matching", "ready"];

function Progress({ imp, slow }: { imp: ImportOut | null; slow: boolean }) {
  const current = imp ? Math.max(ORDER.indexOf(imp.status), 1) : 1;
  const active = STAGES.find((s) => ORDER.indexOf(s.status) === current)?.label ?? "Starting";
  return (
    <div className="grid gap-3">
      <h2 className="text-base font-semibold">Reading the job details</h2>
      <ol className="grid gap-2.5" aria-label="Progress">
        {STAGES.map((s) => {
          const idx = ORDER.indexOf(s.status);
          const state = idx < current ? "done" : idx === current ? "active" : "waiting";
          return (
            <li key={s.status} className="flex items-center gap-2.5">
              {state === "done" ? (
                <Check className="size-4 text-success" aria-hidden />
              ) : state === "active" ? (
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
              ) : (
                <CircleDashed className="size-4 text-muted-foreground" aria-hidden />
              )}
              <span className={cn(state === "waiting" && "text-muted-foreground", state === "active" && "font-medium")}>
                {s.label}
                {state === "active" ? "…" : ""}
              </span>
              <span className="sr-only">{state === "done" ? "done" : state === "active" ? "in progress" : "waiting"}</span>
            </li>
          );
        })}
      </ol>
      <p role="status" className="sr-only">
        {active}
      </p>
      {slow && <p className="text-xs text-muted-foreground">This is taking longer than usual. You can keep browsing; it continues in CareerOS.</p>}
    </div>
  );
}

/** Paste the description: when the page couldn't be read, or on restricted sites. */
export function PasteForm({
  title,
  intro,
  submitLabel = "Read these details",
  onSubmit,
  onCancel,
  extraActions,
}: {
  title: string;
  intro?: string;
  submitLabel?: string;
  onSubmit: (text: string) => Promise<void>;
  onCancel?: () => void;
  extraActions?: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const tooShort = text.trim().length < 150;
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (tooShort) return;
        setBusy(true);
        setError(null);
        try {
          await onSubmit(text);
        } catch (err) {
          setError(errorInfo(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {intro && <p className="text-[0.8125rem] text-muted-foreground">{intro}</p>}
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="paste-text" className="text-[0.8125rem] font-medium">
          Job description
        </label>
        <textarea
          id="paste-text"
          rows={10}
          className={cn(CONTROL, "h-auto min-h-48 py-2")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby="paste-hint"
          maxLength={60_000}
        />
        <p id="paste-hint" className="text-xs text-muted-foreground">
          Copy the whole posting: title, company, location and description. At least 150 characters.
        </p>
      </div>
      {error && (
        <Alert tone="error" title="Couldn't read the text">
          <p>{error.message}</p>
        </Alert>
      )}
      <div className="grid gap-2">
        <Button type="submit" busy={busy} disabled={tooShort}>
          {submitLabel}
        </Button>
        {extraActions}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function Saved({ app, onDone }: { app: ApplicationDetail; onDone: () => void }) {
  return (
    <div className="grid gap-4" role="status">
      <div className="grid gap-1.5">
        <p className="flex items-center gap-2 text-base font-semibold">
          <Check className="size-5 text-success" aria-hidden />
          Saved to your applications
        </p>
        <p>
          <span className="font-medium">{app.position_title}</span>
          <span className="text-muted-foreground"> · {app.company_name}</span>
        </p>
        <StatusPill status={app.status} />
      </div>
      <div className="grid gap-2">
        <Button onClick={() => send({ type: "app.open", path: `/applications/${app.id}` }).catch(() => undefined)}>
          Open in CareerOS <ExternalLink aria-hidden />
          <span className="sr-only">(opens a new tab)</span>
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function ImportFlow({
  importId,
  tabId,
  bootstrap,
  defaultStatus,
  onClose,
}: {
  importId: string;
  tabId: number | null;
  bootstrap: Bootstrap | null;
  defaultStatus: ApplicationStatus;
  onClose: () => void;
}) {
  const imp = useImport(importId);
  const [saved, setSaved] = useState<ApplicationDetail | null>(null);
  const [manual, setManual] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const data = imp.data;

  if (saved) return <Saved app={saved} onDone={onClose} />;
  if (imp.error && !data) {
    return (
      <Alert
        tone="error"
        title="Couldn't load this import"
        action={
          <>
            <Button size="sm" variant="outline" onClick={() => imp.reload()}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </>
        }
      >
        <p>{imp.error.message}</p>
      </Alert>
    );
  }
  if (!data || RUNNING_IMPORT.includes(data.status)) return <Progress imp={data} slow={imp.slow} />;
  if (data.status === "saved") {
    return (
      <Alert tone="success" title="This posting is already saved" action={<Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}>
        {data.application_id && (
          <Button variant="link" onClick={() => send({ type: "app.open", path: `/applications/${data.application_id}` }).catch(() => undefined)}>
            Open the application
          </Button>
        )}
      </Alert>
    );
  }
  if (data.status === "ready" || manual) {
    return <Review imp={data} bootstrap={bootstrap} defaultStatus={defaultStatus} tabId={tabId} onSaved={setSaved} onCancel={onClose} />;
  }
  // needs_text / failed
  const canRetry = data.status === "failed";
  return (
    <div className="grid gap-4">
      <Alert tone="warning" title="CareerOS couldn't read this posting">
        <p>{data.error_message ?? "Paste the job description below and CareerOS reads the details from it."}</p>
      </Alert>
      <PasteForm
        title="Paste the job description"
        onSubmit={async (text) => imp.set(await send({ type: "import.text", importId: data.id, text }))}
        onCancel={onClose}
        extraActions={
          <>
            {canRetry && (
              <Button
                variant="outline"
                busy={retrying}
                onClick={async () => {
                  setRetrying(true);
                  try {
                    imp.set(await send({ type: "import.retry", importId: data.id }));
                  } catch {
                    imp.reload();
                  } finally {
                    setRetrying(false);
                  }
                }}
              >
                Try again
              </Button>
            )}
            <Button variant="outline" onClick={() => setManual(true)}>
              Fill in the details myself
            </Button>
          </>
        }
      />
    </div>
  );
}
