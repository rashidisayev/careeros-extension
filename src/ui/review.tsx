/**
 * Review and save: every value GetCareer read is shown with where it came from ("From the
 * posting", "Interpreted", "Please check", "Not found", "Edited") and can be corrected.
 * Nothing is saved until Save. A likely duplicate is never merged or changed: you open the
 * existing application, or save this one as a separate application on purpose.
 */
import { AlertTriangle, Check, ExternalLink } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import type {
  ApplicationDetail,
  ApplicationStatus,
  ImportDuplicate,
  ImportField,
  ImportOut,
  ImportSave,
  MatchPreview as Match,
} from "../shared/api-types";
import { APPLICATION_STATUSES } from "../shared/api-types";
import type { Bootstrap } from "../shared/api-types";
import type { ErrorInfo } from "../shared/types";
import { Alert, Button, CONTROL, Field, MatchBadge, SourceTag, StatusPill, cn } from "./components";
import { errorInfo, send } from "./client";
import { EMPLOYMENT, REASON_LABEL, REMOTE, SENIORITY, STATUS_LABEL } from "./labels";

type Values = {
  title: string;
  company_name: string;
  location: string;
  remote_policy: string;
  employment_type: string;
  seniority: string;
  department: string;
  salary_min: string;
  salary_max: string;
  salary_currency: string;
  salary_period: string;
  deadline: string;
  job_url: string;
  recruiter_name: string;
  recruiter_email: string;
  description: string;
  status: ApplicationStatus;
  applied_at: string;
  notes: string;
};
type Key = keyof Values;

const FROM_FIELDS: Key[] = [
  "title",
  "company_name",
  "location",
  "remote_policy",
  "employment_type",
  "seniority",
  "department",
  "salary_min",
  "salary_max",
  "salary_currency",
  "salary_period",
  "deadline",
  "recruiter_name",
  "recruiter_email",
];

const today = () => new Date().toISOString().slice(0, 10);

export function initialValues(imp: ImportOut, defaultStatus: ApplicationStatus): Values {
  const v = (k: string) => {
    const value = imp.fields[k]?.value;
    return value === null || value === undefined ? "" : String(value);
  };
  const out = Object.fromEntries(FROM_FIELDS.map((k) => [k, v(k)])) as unknown as Values;
  out.job_url = imp.source_url ?? v("application_url");
  out.description = imp.description ?? "";
  out.status = defaultStatus;
  out.applied_at = today();
  out.notes = "";
  return out;
}

const PRE_APPLIED: ApplicationStatus[] = ["interested", "to_apply"];

export function toBody(v: Values, allowDuplicate: boolean): ImportSave {
  const s = (x: string) => x.trim() || null;
  const n = (x: string) => (x.trim() ? Number(x.replace(/[^\d]/g, "")) : null);
  return {
    title: v.title.trim(),
    company_name: v.company_name.trim(),
    location: s(v.location),
    remote_policy: (s(v.remote_policy) as ImportSave["remote_policy"]) ?? null,
    employment_type: (s(v.employment_type) as ImportSave["employment_type"]) ?? null,
    seniority: (s(v.seniority) as ImportSave["seniority"]) ?? null,
    department: s(v.department),
    salary_min: n(v.salary_min),
    salary_max: n(v.salary_max),
    salary_currency: s(v.salary_currency)?.toUpperCase() ?? null,
    salary_period: (s(v.salary_period) as ImportSave["salary_period"]) ?? null,
    deadline: s(v.deadline),
    description: s(v.description),
    job_url: s(v.job_url),
    recruiter_name: s(v.recruiter_name),
    recruiter_email: s(v.recruiter_email),
    status: v.status,
    applied_at: PRE_APPLIED.includes(v.status) ? null : s(v.applied_at),
    notes: s(v.notes),
    allow_duplicate: allowDuplicate,
  };
}

/** Field-level checks, mirrored from the API's ImportSave so mistakes show next to the field. */
export function validate(v: Values): Partial<Record<Key, string>> {
  const e: Partial<Record<Key, string>> = {};
  if (!v.title.trim()) e.title = "Add the position.";
  else if (v.title.trim().length > 300) e.title = "Keep the position under 300 characters.";
  if (!v.company_name.trim()) e.company_name = "Add the company.";
  else if (v.company_name.trim().length > 200) e.company_name = "Keep the company under 200 characters.";
  const num = (x: string) => (x.trim() ? Number(x.replace(/[^\d]/g, "")) : null);
  const lo = num(v.salary_min);
  const hi = num(v.salary_max);
  if (v.salary_min.trim() && !/\d/.test(v.salary_min)) e.salary_min = "Enter a number.";
  if (v.salary_max.trim() && !/\d/.test(v.salary_max)) e.salary_max = "Enter a number.";
  if (lo !== null && hi !== null && lo > hi) e.salary_max = "“To” should be at least “From”.";
  if ((lo !== null && lo > 10_000_000) || (hi !== null && hi > 10_000_000)) e.salary_max = "That amount looks too large.";
  if (v.salary_currency.trim() && !/^[A-Za-z]{3}$/.test(v.salary_currency.trim())) e.salary_currency = "Use a 3-letter code, like EUR.";
  if ((lo !== null || hi !== null) && !v.salary_currency.trim()) e.salary_currency = "Add the currency.";
  if (v.job_url.trim() && !/^https?:\/\/\S+$/i.test(v.job_url.trim())) e.job_url = "Enter a web address starting with https://";
  if (v.recruiter_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.recruiter_email.trim())) e.recruiter_email = "Enter an email address.";
  if (v.notes.length > 10_000) e.notes = "Keep the note under 10,000 characters.";
  return e;
}

const ORDER: Key[] = ["title", "company_name", "salary_min", "salary_max", "salary_currency", "job_url", "recruiter_email", "notes"];

export function Review({
  imp,
  bootstrap,
  defaultStatus,
  tabId,
  onSaved,
  onCancel,
}: {
  imp: ImportOut;
  bootstrap: Bootstrap | null;
  defaultStatus: ApplicationStatus;
  tabId: number | null;
  onSaved: (app: ApplicationDetail) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Values>(() => initialValues(imp, defaultStatus));
  const [edited, setEdited] = useState<Set<Key>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ErrorInfo | null>(null);
  const [conflicts, setConflicts] = useState<ImportDuplicate[] | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const duplicates = conflicts ?? imp.duplicates;
  const set = (k: Key, value: string) => {
    setValues((s) => ({ ...s, [k]: value }));
    setEdited((s) => new Set(s).add(k));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const openApp = (path: string) => send({ type: "app.open", path }).catch(() => undefined);

  const save = async (allowDuplicate: boolean) => {
    const found = validate(values);
    setErrors(found);
    const first = ORDER.find((k) => found[k]);
    if (first) {
      formRef.current?.querySelector<HTMLElement>(`#rv-${first}`)?.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const app = await send({ type: "import.save", importId: imp.id, fields: toBody(values, allowDuplicate), tabId });
      onSaved(app);
    } catch (e) {
      const info = errorInfo(e);
      if (info.code === "possible_duplicate") {
        const d = (info.details as { duplicates?: ImportDuplicate[] } | undefined)?.duplicates;
        setConflicts(d && d.length ? d : imp.duplicates);
      } else {
        setSaveError(info);
      }
    } finally {
      setSaving(false);
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (duplicates.length === 0) void save(false);
  };

  const tag = (k: Key, source?: ImportField) => <SourceTag source={source ?? imp.fields[k]} edited={edited.has(k)} empty={!values[k]} />;
  const describedBy = (k: Key) => (errors[k] ? `rv-${k}-error` : undefined);
  const input = (k: Key, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={`rv-${k}`}
      className={CONTROL}
      value={values[k]}
      onChange={(e) => set(k, e.target.value)}
      aria-invalid={errors[k] ? true : undefined}
      aria-describedby={describedBy(k)}
      {...props}
    />
  );
  const select = (k: Key, options: Record<string, string>, none = "Not stated") => (
    <select id={`rv-${k}`} className={CONTROL} value={values[k]} onChange={(e) => set(k, e.target.value)}>
      <option value="">{none}</option>
      {Object.entries(options).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
  const field = (k: Key, label: string, control: ReactNode, opts: { className?: string; hint?: string } = {}) => (
    <Field id={`rv-${k}`} label={label} tag={tag(k)} error={errors[k]} hint={opts.hint} className={opts.className}>
      {control}
    </Field>
  );
  const hasPay = !!(values.salary_min || values.salary_max);
  const preApplied = PRE_APPLIED.includes(values.status);
  const found = Object.keys(imp.fields).length;

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="grid gap-5" aria-labelledby="review-title">
      <div className="grid gap-1">
        <h2 id="review-title" className="text-base font-semibold">
          Review the job details
        </h2>
        <p className="text-[0.8125rem] text-muted-foreground">
          {found > 0 ? `${found} ${found === 1 ? "detail" : "details"} found${imp.ai_used ? " with AI" : ""}. ` : ""}
          Correct anything that's off. Nothing is saved until you choose Save.
        </p>
        {imp.warnings.length > 0 && (
          <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
            {imp.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </div>

      {duplicates.length > 0 && <Duplicates duplicates={duplicates} onOpen={openApp} />}

      {imp.match ? (
        <MatchPreview match={imp.match} />
      ) : bootstrap?.features.job_match && !bootstrap.features.job_match.enabled && bootstrap.features.job_match.reason === "no_direction" ? (
        <p className="text-xs text-muted-foreground">
          Set up a career direction in GetCareer to see how well jobs fit.{" "}
          <Button variant="link" className="text-xs" onClick={() => openApp("/profile")}>
            Set it up
          </Button>
        </p>
      ) : null}

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-[0.8125rem] font-semibold">Role</legend>
        {field("title", "Position", input("title", { required: true, maxLength: 300 }))}
        {field("company_name", "Company", input("company_name", { required: true, maxLength: 200 }))}
        {field("location", "Location", input("location", { maxLength: 300 }))}
        <div className="grid grid-cols-2 gap-3">
          {field("remote_policy", "Work arrangement", select("remote_policy", REMOTE))}
          {field("employment_type", "Employment", select("employment_type", EMPLOYMENT))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field("seniority", "Seniority", select("seniority", SENIORITY))}
          {field("department", "Department", input("department", { maxLength: 200 }))}
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-[0.8125rem] font-semibold">Pay</legend>
        {!hasPay && <p className="-mt-1 text-xs text-muted-foreground">The posting doesn't state pay. Leave it empty unless you know it.</p>}
        <div className="grid grid-cols-2 gap-3">
          {field("salary_min", "From", input("salary_min", { inputMode: "numeric" }))}
          {field("salary_max", "To", input("salary_max", { inputMode: "numeric" }))}
          {field("salary_currency", "Currency", input("salary_currency", { maxLength: 3, placeholder: "EUR", autoCapitalize: "characters" }))}
          {field("salary_period", "Per", select("salary_period", { year: "Year", month: "Month", hour: "Hour" }, "—"))}
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-[0.8125rem] font-semibold">Posting and contact</legend>
        <Field id="rv-job_url" label="Job posting URL" tag={tag("job_url", imp.source_url ? undefined : imp.fields.application_url)} error={errors.job_url}>
          {input("job_url", { type: "url", maxLength: 1000 })}
        </Field>
        {field("deadline", "Application deadline", input("deadline", { type: "date" }))}
        {field("recruiter_name", "Contact person", input("recruiter_name", { maxLength: 200 }))}
        {field("recruiter_email", "Contact email", input("recruiter_email", { type: "email" }))}
      </fieldset>

      <details className="group rounded-xl border">
        <summary className="flex items-center justify-between gap-2 px-3 py-2.5 text-[0.8125rem] font-medium [&::-webkit-details-marker]:hidden">
          Job description
          <span className="text-xs font-normal text-muted-foreground group-open:hidden">
            {values.description ? `${values.description.length.toLocaleString("en")} characters` : "Empty"}
          </span>
        </summary>
        <div className="grid gap-1.5 border-t p-3">
          <label htmlFor="rv-description" className="sr-only">
            Job description
          </label>
          <textarea
            id="rv-description"
            rows={10}
            className={cn(CONTROL, "h-auto max-h-96 min-h-40 py-2 leading-relaxed")}
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Kept as published. CV tailoring and cover letters use it.</p>
        </div>
      </details>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-[0.8125rem] font-semibold">Your application</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field id="rv-status" label="Status">
            <select id="rv-status" className={CONTROL} value={values.status} onChange={(e) => setValues((s) => ({ ...s, status: e.target.value as ApplicationStatus }))}>
              {APPLICATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="rv-applied" label="Applied on">
            <input
              id="rv-applied"
              type="date"
              className={CONTROL}
              disabled={preApplied}
              value={preApplied ? "" : values.applied_at}
              onChange={(e) => setValues((s) => ({ ...s, applied_at: e.target.value }))}
            />
          </Field>
        </div>
        <Field id="rv-notes" label="Note (optional)" error={errors.notes}>
          <textarea
            id="rv-notes"
            rows={3}
            className={cn(CONTROL, "h-auto py-2")}
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
            aria-invalid={errors.notes ? true : undefined}
            aria-describedby={describedBy("notes")}
          />
        </Field>
      </fieldset>

      {saveError && (
        <Alert tone="error" title="Not saved">
          <p>{saveError.message}</p>
        </Alert>
      )}

      <div className="sticky bottom-0 -mx-4 grid gap-2 border-t bg-background/95 px-4 py-3">
        {duplicates.length > 0 ? (
          <>
            <Button variant="primary" onClick={() => duplicates[0] && openApp(`/applications/${duplicates[0].application_id}`)}>
              Open the existing application <ExternalLink aria-hidden />
            </Button>
            <Button variant="outline" busy={saving} onClick={() => void save(true)}>
              Save as a separate application
            </Button>
          </>
        ) : (
          <Button type="submit" busy={saving}>
            Save to GetCareer
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Duplicates({ duplicates, onOpen }: { duplicates: ImportDuplicate[]; onOpen: (path: string) => void }) {
  return (
    <section aria-labelledby="dup-title" className="grid gap-2 rounded-xl border border-warning/50 bg-warning/10 p-3" role="status">
      <p id="dup-title" className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
        You may already be tracking this job
      </p>
      <ul className="grid gap-2">
        {duplicates.map((d) => (
          <li key={d.application_id} className="grid gap-1 rounded-lg border bg-card p-2.5">
            <p className="min-w-0">
              <span className="font-medium">{d.position_title}</span>
              <span className="text-muted-foreground"> · {d.company_name}</span>
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-x-2">
                <StatusPill status={d.status} />
                <span className="text-xs text-muted-foreground">{d.reasons.map((r) => REASON_LABEL[r] ?? r).join(", ")}</span>
              </span>
              <Button variant="link" className="text-[0.8125rem]" onClick={() => onOpen(`/applications/${d.application_id}`)}>
                Open <ExternalLink className="size-3.5" aria-hidden />
                <span className="sr-only">{d.position_title} in GetCareer (opens a new tab)</span>
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Saving never changes the existing application, its status, notes or documents.</p>
    </section>
  );
}

export function MatchPreview({ match }: { match: Match }) {
  const positives = (match.positives ?? []).slice(0, 3);
  const missing = (match.missing ?? []).map((m) => m.name).filter(Boolean);
  const concerns = [...(match.concerns ?? []), ...(missing.length ? [`Not in your profile: ${missing.slice(0, 5).join(", ")}`] : [])].slice(0, 3);
  const items = { positives, concerns };
  return (
    <section aria-labelledby="match-title" className="grid gap-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="match-title" className="text-[0.8125rem] font-semibold">
          Fit with {match.direction_name}
        </h3>
        <MatchBadge score={match.total_score} category={match.category} />
      </div>
      {match.explanation && <p className="text-[0.8125rem] text-muted-foreground">{match.explanation}</p>}
      {items.positives.length > 0 && (
        <ul className="grid gap-1 text-[0.8125rem]" aria-label="Why it fits">
          {items.positives.map((p) => (
            <li key={p} className="flex gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      )}
      {items.concerns.length > 0 && (
        <ul className="grid gap-1 text-[0.8125rem]" aria-label="Worth checking">
          {items.concerns.map((c) => (
            <li key={c} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
              {c}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
