/** Settings: account, appearance, saving, site access, privacy and diagnostics. */
import "../pages/styles.css";
import { Check, Copy, ExternalLink, Trash2 } from "lucide-react";
import { StrictMode, useCallback, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { APPLICATION_STATUSES, type ApplicationStatus } from "../shared/api-types";
import { CAREEROS_URL, EXTENSION_VERSION } from "../shared/config";
import { FILLABLE_KEYS, KEYS, isFieldKey } from "../autofill/keys";
import { FILLABLE_CATEGORIES, type AnswerLength, type AnswerTone, type AutofillSettings, type DocumentRef, type FillableCategory, type HistoryEntry, type SavedAnswer } from "../autofill/types";
import type { Theme } from "../shared/settings";
import { Alert, Button, CONTROL, Logo } from "../ui/components";
import { errorInfo, send } from "../ui/client";
import { useSession, useSettings, useTheme } from "../ui/hooks";
import { STATUS_LABEL } from "../ui/labels";
import { ConnectView } from "../ui/connect";

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-4 py-8 first:pt-0">
      <div className="grid gap-1">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {description && <p className="max-w-prose text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Account() {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const s = session.data;
  if (!s) return <p role="status" className="text-muted-foreground">Loading…</p>;
  if (!s.connected) return <ConnectView reason={s.reason} onConnected={() => session.reload(true)} compact />;
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2">
        <dt className="text-muted-foreground">Signed in as</dt>
        <dd className="min-w-0 truncate font-medium">{s.user.email}</dd>
        <dt className="text-muted-foreground">GetCareer</dt>
        <dd className="min-w-0 truncate">{new URL(CAREEROS_URL).host}</dd>
      </dl>
      {confirming ? (
        <Alert
          tone="warning"
          title="Disconnect this browser?"
          action={
            <>
              <Button
                size="sm"
                variant="destructive"
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  await send({ type: "session.disconnect" }).catch(() => undefined);
                  setBusy(false);
                  setConfirming(false);
                }}
              >
                Disconnect
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Keep connected
              </Button>
            </>
          }
        >
          <p>The extension forgets your connection and GetCareer ends its session. Your saved applications stay in GetCareer.</p>
        </Alert>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setConfirming(true)}>
            Disconnect
          </Button>
          <Button variant="ghost" onClick={() => send({ type: "app.open", path: "/settings" }).catch(() => undefined)}>
            Connected browsers in GetCareer <ExternalLink aria-hidden />
            <span className="sr-only">(opens a new tab)</span>
          </Button>
        </div>
      )}
    </div>
  );
}

function SiteList() {
  const [origins, setOrigins] = useState<string[] | null>(null);
  const load = useCallback(() => {
    chrome.permissions
      .getAll()
      // Only sites the user added; the manifest's own (GetCareer) access can't be removed.
      .then((p) => {
        const required = new Set(chrome.runtime.getManifest().host_permissions ?? []);
        setOrigins((p.origins ?? []).filter((o) => !required.has(o)));
      })
      .catch(() => setOrigins([]));
  }, []);
  useEffect(() => {
    load();
    chrome.permissions.onAdded.addListener(load);
    chrome.permissions.onRemoved.addListener(load);
    return () => {
      chrome.permissions.onAdded.removeListener(load);
      chrome.permissions.onRemoved.removeListener(load);
    };
  }, [load]);
  if (origins === null) return null;
  if (!origins.length) {
    return (
      <p className="rounded-xl border border-dashed p-4 text-muted-foreground">
        No sites. The extension reads a page only when you click its icon, press Alt+Shift+J or use the right-click menu.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-xl border bg-card shadow-card">
      {origins.map((o) => {
        const host = o.replace(/^https?:\/\//, "").replace(/\/\*$/, "");
        return (
          <li key={o} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0 truncate font-medium">{host}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await chrome.permissions.remove({ origins: [o] });
                load();
              }}
            >
              <Trash2 aria-hidden /> Remove<span className="sr-only"> {host}</span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function Diagnostics({ enabled, onToggle }: { enabled: boolean; onToggle: (v: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = async () => {
    try {
      const d = await send({ type: "diagnostics.get" });
      const text = JSON.stringify({ version: EXTENSION_VERSION, browser: navigator.userAgent, logs: d.logs }, null, 2);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      setError(errorInfo(e).message);
    }
  };
  return (
    <div className="grid gap-3">
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        <span className="grid gap-0.5">
          <span className="font-medium">Write diagnostic logs to the browser console</span>
          <span className="text-xs text-muted-foreground">For troubleshooting. Logs never contain tokens, page text, job details or your email address.</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy diagnostics"}
        </Button>
        <span role="status" className="sr-only">
          {copied ? "Diagnostics copied to the clipboard" : ""}
        </span>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}

const CATEGORY: Record<FillableCategory, { title: string; hint: string }> = {
  personal: { title: "Personal details", hint: "Name, email, phone, address, city, country" },
  professional: { title: "Professional details", hint: "Current title and employer, years of experience, summary, industry, seniority, leadership" },
  links: { title: "Links", hint: "LinkedIn, GitHub, portfolio, website" },
  history: { title: "Work history and education", hint: "Employers, job titles, dates, schools, degrees, skills, languages, certifications" },
  preferences: {
    title: "Job preferences",
    hint: "Expected salary (your target), relocation, preferred location, remote work, employment type. Only suggested, never ticked for you: they depend on the job.",
  },
};

const NEVER = [
  "date of birth",
  "nationality and citizenship",
  "gender and salutation",
  "work authorisation and visa",
  "disability, ethnicity, veteran status, criminal record",
  "current salary",
  "notice period and start date",
  "consent and privacy checkboxes",
];

const LANGUAGES: { value: AutofillSettings["answers"]["language"]; label: string }[] = [
  { value: "auto", label: "Language of the job page" },
  { value: "en", label: "English" },
  { value: "de", label: "German" },
];
const LENGTHS: { value: AnswerLength; label: string }[] = [
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
];
const TONES: { value: AnswerTone; label: string }[] = [
  { value: "professional", label: "Professional" },
  { value: "concise", label: "Concise" },
  { value: "warm", label: "Warm" },
  { value: "executive", label: "Executive" },
];

function Select<T extends string>({ id, label, value, options, onChange, disabled }: { id: string; label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-medium">
        {label}
      </label>
      <select id={id} className={CONTROL} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Loads a list from GetCareer (only while connected); `reload` after a change. */
function useRemote<T>(load: () => Promise<T>, enabled: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    if (!enabled) return;
    load()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(errorInfo(e).message));
  }, [enabled]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

/** The uploaded CV AutoFill suggests when GetCareer prepared none for the job. */
function DefaultCv({ value, onChange, connected }: { value: string | null; onChange: (v: string | null) => void; connected: boolean }) {
  const cvs = useRemote<DocumentRef[]>(() => send({ type: "autofill.cvs" }), connected);
  if (!connected) return null;
  return (
    <div className="grid max-w-md gap-1.5">
      <label htmlFor="default-cv" className="text-[0.8125rem] font-medium">
        CV to suggest when none was prepared for the job
      </label>
      <select id="default-cv" className={CONTROL} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">The newest CV</option>
        {(cvs.data ?? []).map((d) => (
          <option key={d.ref} value={d.ref}>
            {d.name}
          </option>
        ))}
        {value && cvs.data && !cvs.data.some((d) => d.ref === value) && <option value={value}>A CV that is no longer in GetCareer</option>}
      </select>
      {cvs.error && <p className="text-xs text-destructive">{cvs.error}</p>}
      <p className="text-xs text-muted-foreground">
        When GetCareer prepared a CV or cover letter for the job, AutoFill suggests that one. A file is attached only when you tick it in the review, and a file already on the form is replaced only if you tick it too.
      </p>
    </div>
  );
}

function SavedAnswers({ connected }: { connected: boolean }) {
  const list = useRemote<SavedAnswer[]>(() => send({ type: "autofill.savedAnswers" }), connected);
  const [busy, setBusy] = useState<string | null>(null);
  if (!connected) return null;
  const items = list.data ?? [];
  return (
    <details className="rounded-xl border bg-card px-4 py-3 shadow-card">
      <summary className="cursor-pointer font-medium">Saved answers ({items.length})</summary>
      <div className="mt-3 grid gap-2">
        <p className="text-xs text-muted-foreground">
          Answers you chose to remember in the review ("Remember for other applications"). They are kept in GetCareer and offered, unticked, when a form asks the same thing.
        </p>
        {list.error && <p className="text-xs text-destructive">{list.error}</p>}
        {!items.length && !list.error && <p className="text-xs text-muted-foreground">None yet.</p>}
        <ul className="divide-y">
          {items.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 py-2">
              <span className="grid min-w-0 gap-0.5">
                <span className="text-[0.8125rem] font-medium break-words">{a.field_key && isFieldKey(a.field_key) ? KEYS[a.field_key].label : a.question}</span>
                <span className="text-xs break-words whitespace-pre-line text-muted-foreground">{a.answer.length > 240 ? `${a.answer.slice(0, 240)}…` : a.answer}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                busy={busy === a.id}
                onClick={async () => {
                  setBusy(a.id);
                  await send({ type: "autofill.deleteAnswer", id: a.id }).catch(() => undefined);
                  setBusy(null);
                  list.reload();
                }}
              >
                <Trash2 aria-hidden />
                <span className="sr-only">Delete the saved answer to {a.question}</span>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

function History({ connected, enabled }: { connected: boolean; enabled: boolean }) {
  const list = useRemote<HistoryEntry[]>(() => send({ type: "autofill.history" }), connected);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  if (!connected) return null;
  const items = list.data ?? [];
  const remove = async (id?: string) => {
    setBusy(id ?? "all");
    await send({ type: "autofill.historyDelete", id }).catch(() => undefined);
    setBusy(null);
    setConfirming(false);
    list.reload();
  };
  return (
    <details className="rounded-xl border bg-card px-4 py-3 shadow-card">
      <summary className="cursor-pointer font-medium">AutoFill history ({items.length})</summary>
      <div className="mt-3 grid gap-2">
        <p className="text-xs text-muted-foreground">
          {enabled ? "Kept in GetCareer: " : "Off: nothing new is kept. Earlier entries: "}the site, the company and job, how many fields were filled, and the files attached. Never what you typed or what was filled in.
        </p>
        {list.error && <p className="text-xs text-destructive">{list.error}</p>}
        {!items.length && !list.error && <p className="text-xs text-muted-foreground">No entries.</p>}
        <ul className="divide-y">
          {items.map((h) => (
            <li key={h.id} className="flex items-start justify-between gap-3 py-2">
              <span className="grid min-w-0 gap-0.5">
                <span className="text-[0.8125rem] font-medium break-words">
                  {h.job_title || h.company ? [h.job_title, h.company].filter(Boolean).join(" at ") : h.site}
                </span>
                <span className="text-xs text-muted-foreground">
                  {when(h.created_at)} · {h.site}
                  {h.ats ? ` (${h.ats})` : ""} · {h.fields_filled} filled
                  {h.fields_confirmed ? `, ${h.fields_confirmed} confirmed by you` : ""}
                  {h.fields_asked ? `, ${h.fields_asked} left to you` : ""}
                  {h.documents.length ? ` · ${h.documents.join(", ")}` : ""}
                </span>
              </span>
              <Button variant="ghost" size="sm" busy={busy === h.id} onClick={() => remove(h.id)}>
                <Trash2 aria-hidden />
                <span className="sr-only">Delete this entry</span>
              </Button>
            </li>
          ))}
        </ul>
        {items.length > 0 &&
          (confirming ? (
            <Alert
              tone="warning"
              title="Delete the whole AutoFill history?"
              action={
                <>
                  <Button size="sm" variant="destructive" busy={busy === "all"} onClick={() => remove()}>
                    Delete history
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </>
              }
            >
              <p>Your applications and documents in GetCareer stay as they are.</p>
            </Alert>
          ) : (
            <div>
              <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                <Trash2 aria-hidden /> Delete history
              </Button>
            </div>
          ))}
      </div>
    </details>
  );
}

function Toggle({ checked, onChange, title, hint, id }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint?: string; id?: string }) {
  return (
    <label className="flex items-start gap-3" htmlFor={id}>
      <input id={id} type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="grid gap-0.5">
        <span className="font-medium">{title}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function AutofillSettingsView({ value, onChange }: { value: AutofillSettings; onChange: (v: AutofillSettings) => void }) {
  const set = (patch: Partial<AutofillSettings>) => onChange({ ...value, ...patch });
  const session = useSession();
  const connected = session.data?.connected === true;
  // GetCareer says which parts it offers; an older server offers none of these.
  const features = session.data?.connected ? session.data.bootstrap?.features : undefined;
  const answersFeature = features?.autofill_answers;
  const documentsOn = features?.autofill_documents?.enabled === true;
  const savedOn = features?.autofill_saved_answers?.enabled === true;
  const historyOn = features?.autofill_history?.enabled === true;
  return (
    <div className="grid gap-5">
      <Toggle
        id="autofill-enabled"
        checked={value.enabled}
        onChange={(enabled) => set({ enabled })}
        title="Offer AutoFill on application forms"
        hint="When you open the extension on a job application form, it shows what it can fill from your Career Profile. Nothing is filled until you review it and press Fill, and nothing is ever submitted."
      />
      <fieldset className="grid gap-3" disabled={!value.enabled}>
        <legend className="pb-2 text-[0.8125rem] font-semibold">What AutoFill may fill</legend>
        {FILLABLE_CATEGORIES.map((c) => (
          <Toggle
            key={c}
            checked={value.categories[c]}
            onChange={(on) => set({ categories: { ...value.categories, [c]: on } })}
            title={CATEGORY[c].title}
            hint={CATEGORY[c].hint}
          />
        ))}
      </fieldset>
      <details className="rounded-xl border bg-card px-4 py-3 shadow-card">
        <summary className="cursor-pointer font-medium">
          Fields ({FILLABLE_KEYS.length - value.excluded.filter((k) => FILLABLE_KEYS.includes(k)).length} of {FILLABLE_KEYS.length} on)
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {FILLABLE_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                disabled={!value.enabled || !value.categories[KEYS[k].category as FillableCategory]}
                checked={!value.excluded.includes(k)}
                onChange={(e) => set({ excluded: e.target.checked ? value.excluded.filter((x) => x !== k) : [...value.excluded, k] })}
              />
              {KEYS[k].label}
            </label>
          ))}
        </div>
      </details>
      <div className="grid gap-1.5">
        <p className="text-[0.8125rem] font-semibold">Never filled by AutoFill</p>
        <p className="max-w-prose text-xs text-muted-foreground">
          AutoFill recognises these questions and leaves them to you, whatever your profile says: {NEVER.join("; ")}. You can answer them in the review; an answer you choose to remember is offered next time, unticked.
        </p>
      </div>
      {documentsOn && (
        <fieldset className="grid gap-3" disabled={!value.enabled}>
          <legend className="pb-2 text-[0.8125rem] font-semibold">CVs and cover letters</legend>
          <DefaultCv value={value.defaultCv} onChange={(defaultCv) => set({ defaultCv })} connected={connected} />
        </fieldset>
      )}
      {(answersFeature || savedOn) && (
        <fieldset className="grid gap-3" disabled={!value.enabled}>
          <legend className="pb-2 text-[0.8125rem] font-semibold">Suggested answers to open questions</legend>
          <p className="max-w-prose text-xs text-muted-foreground">
            In the review, GetCareer can draft answers to open questions ("Why do you want to work here?") from your Career Profile and the job. Drafts are never ticked for you,
            and GetCareer doesn't draft salary, legal or personal questions.
            {answersFeature && !answersFeature.enabled && answersFeature.reason === "consent_required" && " To use them, allow AI processing in your GetCareer settings."}
            {answersFeature && !answersFeature.enabled && answersFeature.reason === "ai_unavailable" && " They aren't available on this GetCareer server."}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select id="answers-language" label="Language" value={value.answers.language} options={LANGUAGES} onChange={(language) => set({ answers: { ...value.answers, language } })} />
            <Select id="answers-length" label="Length" value={value.answers.length} options={LENGTHS} onChange={(length) => set({ answers: { ...value.answers, length } })} />
            <Select id="answers-tone" label="Tone" value={value.answers.tone} options={TONES} onChange={(tone) => set({ answers: { ...value.answers, tone } })} />
          </div>
          <SavedAnswers connected={connected && savedOn} />
        </fieldset>
      )}
      {historyOn && (
        <fieldset className="grid gap-3">
          <legend className="pb-2 text-[0.8125rem] font-semibold">History</legend>
          <Toggle
            id="autofill-history"
            checked={value.history}
            onChange={(history) => set({ history })}
            title="Keep an AutoFill history in GetCareer"
            hint="Which forms you filled and when, so you can find them again. No form values are kept."
          />
          <History connected={connected} enabled={value.history} />
        </fieldset>
      )}
      <p className="max-w-prose text-xs text-muted-foreground">
        The values come from your Career Profile in GetCareer and are fetched when you open AutoFill; the extension doesn't store them. Files are downloaded from GetCareer only when you fill a form with them.{" "}
        <Button variant="link" className="text-xs" onClick={() => send({ type: "app.open", path: "/profile" }).catch(() => undefined)}>
          Edit your Career Profile <ExternalLink className="size-3" aria-hidden />
          <span className="sr-only">(opens a new tab)</span>
        </Button>
      </p>
    </div>
  );
}

function ClearData() {
  const [state, setState] = useState<"idle" | "confirm" | "done">("idle");
  if (state === "confirm") {
    return (
      <Alert
        tone="warning"
        title="Clear the data this extension keeps in the browser?"
        action={
          <>
            <Button
              size="sm"
              variant="destructive"
              onClick={async () => {
                // The settings on this page reload by themselves (storage change).
                await send({ type: "data.clear" }).catch(() => null);
                setState("done");
              }}
            >
              Clear data
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setState("idle")}>
              Cancel
            </Button>
          </>
        }
      >
        <p>Page readings and cached account details are removed and these settings go back to their defaults. You stay connected; disconnect above to remove the connection too.</p>
      </Alert>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setState("confirm")}>
        <Trash2 aria-hidden /> Clear extension data
      </Button>
      {state === "done" && (
        <span role="status" className="text-xs text-muted-foreground">
          Cleared.
        </span>
      )}
    </div>
  );
}

const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "Same as the system" },
];

function Options() {
  const [settings, update] = useSettings();
  useTheme(settings.theme);
  // "Customize AutoFill" links to options.html#autofill; the page renders after load.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, []);
  return (
    <div className="mx-auto grid max-w-2xl gap-2 px-6 py-8">
      <header className="flex items-center justify-between gap-3 pb-6">
        <Logo />
        <span className="tabular text-xs text-muted-foreground">Companion {EXTENSION_VERSION}</span>
      </header>
      <h1 className="pb-2 text-[1.75rem] leading-tight font-semibold tracking-[-0.022em]">Extension settings</h1>
      <div className="divide-y">
        <Section id="account" title="Account">
          <Account />
        </Section>

        <Section id="appearance" title="Appearance">
          <fieldset className="grid gap-2">
            <legend className="sr-only">Theme</legend>
            {THEMES.map((t) => (
              <label key={t.value} className="flex items-center gap-3">
                <input type="radio" name="theme" className="size-4 accent-[var(--primary)]" checked={settings.theme === t.value} onChange={() => update({ theme: t.value })} />
                {t.label}
              </label>
            ))}
          </fieldset>
        </Section>

        <Section id="saving" title="Saving jobs">
          <div className="grid max-w-xs gap-1.5">
            <label htmlFor="default-status" className="text-[0.8125rem] font-medium">
              Status for new applications
            </label>
            <select
              id="default-status"
              className={CONTROL}
              value={settings.defaultStatus}
              onChange={(e) => update({ defaultStatus: e.target.value as ApplicationStatus })}
            >
              {APPLICATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">You can change it for each job before saving.</p>
          </div>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={settings.followTabs} onChange={(e) => update({ followTabs: e.target.checked })} />
            <span className="grid gap-0.5">
              <span className="font-medium">Side panel follows the tab you're on</span>
              <span className="text-xs text-muted-foreground">Off: the panel stays on the page you opened it for.</span>
            </span>
          </label>
        </Section>

        <Section
          id="autofill"
          title="AutoFill"
          description="Fill job application forms from your Career Profile. You review every value first and submit the application yourself."
        >
          <AutofillSettingsView value={settings.autofill} onChange={(autofill) => update({ autofill })} />
        </Section>

        <Section
          id="sites"
          title="Sites the extension may read"
          description="Sites you allowed from the side panel, so it can read postings as you move between them. Everywhere else it reads a page only when you ask."
        >
          <SiteList />
        </Section>

        <Section
          id="privacy"
          title="Privacy"
          description="The extension sends GetCareer only the posting you choose to save or check: its address, its structured job data and the posting text. AutoFill fetches your Career Profile when you open it on a form and writes into the page only the values you reviewed. It never sends what is typed into a form to GetCareer: only the questions you ask it to draft answers to, the answers you choose to remember, and, if the AutoFill history is on, the site, job and field counts. Usage counts contain no form values and follow your GetCareer analytics setting. It never reads LinkedIn, Indeed, XING, StepStone, Glassdoor or Monster pages, and never applies or sends messages for you."
        >
          <Diagnostics enabled={settings.diagnostics} onToggle={(v) => update({ diagnostics: v })} />
          <ClearData />
        </Section>

        <Section id="shortcut" title="Keyboard shortcut">
          <p className="text-muted-foreground">
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium text-foreground">Alt+Shift+J</kbd> opens the
            extension on the current page. Change it in your browser's extension shortcuts.
          </p>
          <div>
            <Button variant="outline" size="sm" onClick={() => chrome.tabs.create({ url: navigator.userAgent.includes("Edg/") ? "edge://extensions/shortcuts" : "chrome://extensions/shortcuts" })}>
              Open shortcut settings
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
