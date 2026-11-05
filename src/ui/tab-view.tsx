/**
 * What the extension found on the current tab: the posting it read (with where each value
 * came from), whether you already track it, and what you can do. Used by the popup and the
 * side panel.
 */
import { Ban, ExternalLink, FileSearch, Globe, Lock, RefreshCw, TextSelect } from "lucide-react";
import type { ReactNode } from "react";
import type { Bootstrap, LookupOut, TrackedApplication } from "../shared/api-types";
import type { LocalField, TabState } from "../shared/types";
import { Alert, Button, Empty, MatchBadge, Skeleton, SourceTag, StatusPill } from "./components";
import { EMPLOYMENT, REASON_LABEL, REMOTE, relativeTime } from "./labels";

export function TabSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true">
      <span role="status" className="sr-only">Reading this page…</span>
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function display(name: string, f: LocalField | undefined): string | null {
  if (!f) return null;
  if (name === "employment_type") return EMPLOYMENT[f.value] ?? f.value;
  if (name === "remote_policy") return REMOTE[f.value] ?? f.value;
  return f.value;
}

/** The posting as read from the page (a preview; the review step shows GetCareer's reading). */
export function PostingPreview({ state }: { state: TabState }) {
  const f = state.extraction?.fields ?? {};
  const title = f.title;
  const facts = [
    ["Company", "company_name"],
    ["Location", "location"],
    ["Work arrangement", "remote_policy"],
    ["Employment", "employment_type"],
    ["Salary", "salary"],
    ["Deadline", "deadline"],
  ] as const;
  return (
    <section aria-labelledby="posting-title" className="grid gap-2">
      <div className="grid justify-items-start gap-1">
        <h2 id="posting-title" className="text-base leading-snug font-semibold">
          {title?.value ?? "Untitled posting"}
        </h2>
        {title && <SourceTag source={title} />}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[0.8125rem]">
        {facts.map(([label, key]) => {
          const value = display(key, f[key]);
          if (!value) return null;
          return (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate" title={value}>
                {value}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function Tracked({ app, onOpen }: { app: TrackedApplication; onOpen: (path: string) => void }) {
  const reasons = app.reasons.map((r) => REASON_LABEL[r] ?? r).join(", ");
  return (
    <li className="grid gap-1.5 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0">
          <span className="font-medium">{app.position_title}</span>
          <span className="text-muted-foreground"> · {app.company_name}</span>
        </p>
        {app.match_score !== null && <span className="tabular shrink-0 text-xs text-muted-foreground">Match {app.match_score}</span>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <StatusPill status={app.status} />
          <span className="text-xs text-muted-foreground">
            updated {relativeTime(app.updated_at)} · {reasons}
          </span>
        </span>
        <Button variant="link" className="text-[0.8125rem]" onClick={() => onOpen(`/applications/${app.application_id}`)}>
          Open <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only">{app.position_title} in GetCareer (opens a new tab)</span>
        </Button>
      </div>
    </li>
  );
}

/** "Already in your applications", the catalog match, or nothing. */
export function LookupView({ lookup, bootstrap, onOpen }: { lookup: LookupOut | null; bootstrap: Bootstrap | null; onOpen: (path: string) => void }) {
  if (!lookup) return null;
  const apps = lookup.applications;
  const exact = apps.filter((a) => a.reasons.some((r) => r !== "same_role"));
  const similar = apps.filter((a) => a.reasons.every((r) => r === "same_role"));
  const match = lookup.job?.match;
  return (
    <div className="grid gap-3">
      {exact.length > 0 && (
        <section aria-labelledby="tracked-title" className="grid gap-2">
          <h3 id="tracked-title" className="text-[0.8125rem] font-semibold">
            Already in your applications
          </h3>
          <ul className="divide-y rounded-xl border bg-card shadow-card">
            {exact.map((a) => (
              <Tracked key={a.application_id} app={a} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      )}
      {similar.length > 0 && (
        <section aria-labelledby="similar-title" className="grid gap-2">
          <h3 id="similar-title" className="text-[0.8125rem] font-semibold">
            You track a similar role
          </h3>
          <ul className="divide-y rounded-xl border bg-card shadow-card">
            {similar.map((a) => (
              <Tracked key={a.application_id} app={a} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      )}
      {match && bootstrap?.features.job_match?.enabled !== false && (
        <p className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
          <span className="text-muted-foreground">Fit with {match.direction_name}</span>
          <MatchBadge score={match.score} category={match.category} />
          {match.eligibility === "ineligible" && <span className="text-xs text-warning">Outside your requirements</span>}
        </p>
      )}
    </div>
  );
}

export type TabActions = {
  onSave: () => void;
  onSaveSelection: () => void;
  onPaste: () => void;
  onOpen: (path: string) => void;
  onRetry: () => void;
  saving: boolean;
};

/** Everything below the header for one tab, by page kind. */
export function TabView({ state, bootstrap, actions, extra }: { state: TabState; bootstrap: Bootstrap | null; actions: TabActions; extra?: ReactNode }) {
  const tracked = (state.lookup?.applications ?? []).some((a) => a.reasons.some((r) => r !== "same_role"));
  const lookupError = state.lookupError && (
    <Alert tone="warning" title="Couldn't check your applications">
      <p>{state.lookupError.message}</p>
    </Alert>
  );

  switch (state.kind) {
    case "job":
    case "maybe_job":
      return (
        <div className="grid gap-4">
          {state.kind === "maybe_job" && (
            <p className="text-[0.8125rem] text-muted-foreground">This might be a job posting. Check the details before saving.</p>
          )}
          <PostingPreview state={state} />
          <LookupView lookup={state.lookup} bootstrap={bootstrap} onOpen={actions.onOpen} />
          {lookupError}
          {extra}
          <div className="grid gap-2">
            <Button variant={tracked ? "outline" : "primary"} busy={actions.saving} onClick={actions.onSave}>
              {tracked ? "Review and save as a separate application" : "Review and save"}
            </Button>
            <p className="text-xs text-muted-foreground">Nothing is saved until you've checked the details.</p>
          </div>
        </div>
      );
    case "restricted":
      return (
        <div className="grid gap-4">
          <Empty icon={<Lock />} title={`${state.restricted?.name ?? "This site"} isn't read automatically`}>
            <p>
              {state.restricted?.name ?? "This site"} doesn't allow other services to read its job pages, so GetCareer doesn't. Select the job
              description on the page, then save the selection.
            </p>
          </Empty>
          <LookupView lookup={state.lookup} bootstrap={bootstrap} onOpen={actions.onOpen} />
          {lookupError}
          {extra}
          <div className="grid gap-2">
            <Button busy={actions.saving} onClick={actions.onSaveSelection}>
              <TextSelect aria-hidden /> Save selected text
            </Button>
            <Button variant="ghost" onClick={actions.onPaste}>
              Paste the description instead
            </Button>
          </div>
        </div>
      );
    case "not_job":
      return (
        <div className="grid gap-3">
          <Empty
            icon={<FileSearch />}
            title="No job posting found on this page"
            action={
              <>
                <Button variant="outline" size="sm" busy={actions.saving} onClick={actions.onSave}>
                  Save this page anyway
                </Button>
                <Button variant="ghost" size="sm" onClick={actions.onPaste}>
                  Paste a description
                </Button>
              </>
            }
          >
            <p>Open a single job posting, or select its description on the page and right-click to save the selection.</p>
          </Empty>
          {extra}
        </div>
      );
    case "no_access":
      return (
        <Empty
          icon={<Globe />}
          title="Click the GetCareer icon to read this page"
          action={
            <Button variant="outline" size="sm" onClick={actions.onRetry}>
              <RefreshCw aria-hidden /> Check again
            </Button>
          }
        >
          <p>
            The extension only reads a page after you ask: click the toolbar icon or press <kbd className="font-sans font-medium">Alt+Shift+J</kbd>{" "}
            on it. Once it has, you can let it read this site whenever the panel is open.
          </p>
        </Empty>
      );
    case "careeros":
      return (
        <Empty icon={<Globe />} title="You're on GetCareer">
          <p>Open a job posting on another site to save it here.</p>
        </Empty>
      );
    default:
      return (
        <Empty icon={<Ban />} title="This page can't be read">
          <p>Browser pages, extension stores and files aren't readable by extensions.</p>
        </Empty>
      );
  }
}
