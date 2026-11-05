/**
 * CareerOS AutoFill in the side panel (and its summary in the popup): what the form on this
 * tab asks for, what CareerOS would fill from the Career Profile, the review where every
 * value can be changed or left out, and the result with undo. Nothing is written into the
 * page before the user presses "Fill", and nothing is ever submitted.
 *
 * In the review the user can also attach a CV or cover letter from CareerOS, answer the
 * questions AutoFill leaves to them (and save an answer for next time), and ask CareerOS to
 * draft answers to open questions. Every one of those is unticked until the user ticks it.
 */
import { CheckCircle2, ExternalLink, FileText, RefreshCw, Sparkles, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EDU_KEYS, KEYS, REUSABLE_KEYS, WORK_KEYS } from "../autofill/keys";
import { fileName, formatFor } from "../autofill/planner";
import type { AutofillPlan, AutofillSettings, FieldKey, FillReport, FillValue, PlanItem, PlanReason } from "../autofill/types";
import type { Bootstrap } from "../shared/api-types";
import type { ErrorInfo } from "../shared/types";
import { Alert, Button, CONTROL, cn } from "./components";
import { errorInfo, onBroadcast, send } from "./client";

/** Codes that mean "AutoFill doesn't apply here"; the tab view already explains the page. */
const QUIET = new Set(["no_access", "autofill_unsupported", "platform_restricted", "feature_unavailable", "autofill_disabled", "tab_closed", "not_connected"]);

export function autofillAvailable(bootstrap: Bootstrap | null, enabled: boolean): boolean {
  return enabled && bootstrap?.features.autofill?.enabled === true;
}

export type AutofillState = {
  plan: AutofillPlan | null;
  error: ErrorInfo | null;
  loading: boolean;
  rescan: () => void;
  /** Counts the times the page reported new or removed form fields (the next step). */
  changed: number;
};

/**
 * Answers for this account: whether CareerOS drafts them (and why not), whether it keeps
 * answers the user asks it to remember, and the user's settings. An older server offers neither.
 */
export type AnswersAccess = { enabled: boolean; reason: string | null; remember: boolean; prefs: AutofillSettings["answers"] };

export function answersAccess(bootstrap: Bootstrap | null, settings: AutofillSettings): AnswersAccess {
  const f = bootstrap?.features.autofill_answers;
  return { enabled: f?.enabled === true, reason: f?.reason ?? null, remember: bootstrap?.features.autofill_saved_answers?.enabled === true, prefs: settings.answers };
}

/** Scans the tab's form when the panel shows it, and again after the page changes. */
export function useAutofill(tabId: number | null, enabled: boolean): AutofillState {
  const [plan, setPlan] = useState<AutofillPlan | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [changed, setChanged] = useState(0);
  const current = useRef(tabId);
  current.current = tabId;
  const rescan = useCallback(() => {
    if (tabId === null || !enabled) return;
    setLoading(true);
    send({ type: "autofill.scan", tabId })
      .then((p) => {
        if (current.current !== tabId) return;
        setPlan(p);
        setError(null);
      })
      .catch((e) => {
        if (current.current !== tabId) return;
        setPlan(null);
        setError(errorInfo(e));
      })
      .finally(() => current.current === tabId && setLoading(false));
  }, [tabId, enabled]);
  useEffect(() => {
    setPlan(null);
    setError(null);
    rescan();
    // A navigation in the tab (or a new address in a single-page app) means a new form.
    return onBroadcast((b) => {
      if (b.type === "broadcast.tab" && b.tabId === tabId) rescan();
      if (b.type === "broadcast.settings") rescan();
      // The form gained or lost fields: the next step of the application, or a new block.
      if (b.type === "broadcast.autofill" && b.tabId === tabId) {
        setChanged((n) => n + 1);
        rescan();
      }
    });
  }, [rescan, tabId]);
  return { plan, error, loading, rescan, changed };
}

const REASON: Record<PlanReason, string> = {
  sensitive: "Sensitive or legal. CareerOS never fills this; answer it yourself.",
  preference: "Depends on this job. Answer it yourself.",
  consent: "Only you can give consent.",
  question: "A question for you to answer.",
  document: "Attach the file yourself.",
  missing_in_profile: "Not in your Career Profile.",
  not_recognised: "CareerOS doesn't recognise this field.",
  has_value: "Already filled in on the page.",
  user_edited: "You changed this after AutoFill; it stays as you left it.",
  already_filled: "Filled by AutoFill.",
  low_confidence: "The label is unclear.",
  other_person: "About someone else (a reference or contact).",
  too_long: "Your profile text is longer than this field allows.",
  no_matching_option: "None of the choices matches your profile.",
  unsupported_control: "This kind of field can't be filled yet.",
  derived_value: "Worked out from your profile. Check it.",
  ambiguous_label: "Check that this answer fits the question.",
  repeated_field: "This field appears more than once.",
  excluded_field: "You excluded this field.",
  excluded_category: "This category is off in AutoFill settings.",
  history_entry: "Your Career Profile has no role or school for this entry.",
  current_role: "Your current role: it has no end date.",
  date_assumed: "Check the date: the form's format or the day was assumed.",
  saved_answer: "Your saved answer. Tick it to use it here.",
  preference_value: "From your job preferences in CareerOS. Tick it if it fits this job.",
  salary_target: "Your target salary in CareerOS. Tick it to use it, or answer yourself.",
  document_choice: "Attached only if you tick it.",
  replace_file: "A file is already attached. Tick to replace it.",
  list_choice: "Picked from the field's list. Check the choice.",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function openOptions() {
  chrome.tabs.create({ url: chrome.runtime.getURL("options.html#autofill") }).catch(() => undefined);
}

function Links({ onOpen }: { onOpen: (path: string) => void }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <Button variant="link" className="text-xs" onClick={() => onOpen("/profile")}>
        Review profile <ExternalLink className="size-3" aria-hidden />
        <span className="sr-only">(opens CareerOS in a new tab)</span>
      </Button>
      <Button variant="link" className="text-xs" onClick={openOptions}>
        Customize AutoFill
      </Button>
    </p>
  );
}

/** The counts, in the brief's words. */
function Counts({ plan }: { plan: AutofillPlan }) {
  const c = plan.counts;
  const rows: [number, string][] = [
    [c.ready, plural(c.ready, "field ready to fill", "fields ready to fill")],
    [c.confirm, plural(c.confirm, "field needs your confirmation", "fields need your confirmation")],
    [c.input, plural(c.input, "field needs your input", "fields need your input")],
    [c.keep, plural(c.keep, "field already filled in", "fields already filled in")],
  ];
  return (
    <div className="grid gap-1 text-[0.8125rem]">
      <p className="font-medium">{plural(c.detected, "field detected", "fields detected")}</p>
      <ul className="grid gap-0.5 text-muted-foreground">
        {rows
          .filter(([n]) => n > 0)
          .map(([n, text]) => (
            <li key={text} className="tabular">
              {text}
            </li>
          ))}
      </ul>
    </div>
  );
}

function MissingHint({ plan, onOpen }: { plan: AutofillPlan; onOpen: (path: string) => void }) {
  if (!plan.missingProfileKeys.length) return null;
  const names = plan.missingProfileKeys.slice(0, 4).map((k) => KEYS[k].label.toLowerCase());
  return (
    <p className="text-xs text-muted-foreground">
      Add your {names.join(", ")} to your Career Profile to fill more of this form.{" "}
      <Button variant="link" className="text-xs" onClick={() => onOpen("/profile")}>
        Open profile
      </Button>
    </p>
  );
}

/** Summary card: the popup shows it with a button that opens the side panel. */
export function AutofillSummary({ plan, action, onOpen }: { plan: AutofillPlan; action: React.ReactNode; onOpen: (path: string) => void }) {
  return (
    <section aria-labelledby="autofill-title" className="grid gap-3 rounded-xl border bg-card p-4 shadow-card">
      <h2 id="autofill-title" className="flex items-center gap-2 text-[0.9375rem] font-semibold">
        <Sparkles className="size-4 text-primary" aria-hidden /> CareerOS AutoFill
      </h2>
      <Counts plan={plan} />
      {action}
      <Links onOpen={onOpen} />
    </section>
  );
}

/**
 * What the user decided for one field. `remember`: save the answer in CareerOS for other
 * forms. `issues`: what CareerOS couldn't verify in a drafted answer.
 */
type Choice = { on: boolean; value: FillValue | null; overwrite: boolean; remember?: boolean; issues?: string[]; drafted?: boolean };

function initialChoices(plan: AutofillPlan): Record<string, Choice> {
  const out: Record<string, Choice> = {};
  for (const i of plan.items) {
    if ((i.action === "fill" || i.action === "confirm" || i.action === "keep") && i.value) {
      out[key(i)] = { on: i.action === "fill", value: i.value, overwrite: i.action === "keep" };
    }
  }
  return out;
}

/** "Employer · role 2": which entry of the profile a history field is for. */
function keyLabel(item: PlanItem): string | null {
  if (!item.key) return null;
  const base = KEYS[item.key].label;
  if (item.entry === null) return base;
  if (WORK_KEYS.includes(item.key)) return `${base} · role ${item.entry + 1}`;
  if (EDU_KEYS.includes(item.key)) return `${base} · school ${item.entry + 1}`;
  return base;
}

/** A text answer as the value this kind of field takes. */
function answerValue(item: PlanItem, text: string): FillValue {
  if (item.kind === "custom") return { kind: "choose", picks: [[text]] };
  return { kind: "text", text };
}

function chooseText(v: { picks: string[][] }): string {
  return v.picks.map((p) => p[0] ?? "").join(", ");
}

const key = (i: { frameId: number; fieldId: string }) => `${i.frameId}:${i.fieldId}`;

function ValueEditor({ item, choice, plan, onChange }: { item: PlanItem; choice: Choice; plan: AutofillPlan; onChange: (v: FillValue) => void }) {
  const id = `af-${key(item)}`;
  const v = choice.value;
  const label = `Value for ${item.label}`;
  if (!v) return null;
  if (v.kind === "file") {
    const docs = plan.documents.filter((d) => d.kind === item.document?.kind && formatFor(d, item.document?.accept ?? null));
    const doc = docs.find((d) => d.ref === v.ref);
    const formats = doc ? doc.formats.filter((f) => formatFor({ ...doc, formats: [f] }, item.document?.accept ?? null)) : [];
    return (
      <div className="flex flex-wrap gap-2">
        <select
          id={id}
          aria-label={`Document for ${item.label}`}
          className={cn(CONTROL, "h-8 min-w-0 flex-1 text-[0.8125rem]")}
          value={v.ref}
          onChange={(e) => {
            const d = docs.find((x) => x.ref === e.target.value);
            const f = d && formatFor(d, item.document?.accept ?? null);
            if (d && f) onChange({ kind: "file", ref: d.ref, format: f, name: fileName(d, f) });
          }}
        >
          {docs.map((d) => (
            <option key={d.ref} value={d.ref}>
              {d.name}
              {d.note ? ` · ${d.note}` : ""}
              {d.recommended ? " (recommended)" : ""}
            </option>
          ))}
        </select>
        {doc && formats.length > 1 && (
          <select
            aria-label={`Format for ${item.label}`}
            className={cn(CONTROL, "h-8 w-20 text-[0.8125rem]")}
            value={v.format}
            onChange={(e) => {
              const f = e.target.value as "pdf" | "docx";
              onChange({ kind: "file", ref: doc.ref, format: f, name: fileName(doc, f) });
            }}
          >
            {formats.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }
  if (v.kind === "options") {
    return (
      <fieldset className="grid gap-1">
        <legend className="sr-only">{label}</legend>
        {item.options.map((o) => (
          <label key={o.index} className="flex items-center gap-2 text-[0.8125rem]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={v.indexes.includes(o.index)}
              onChange={(e) => onChange({ kind: "options", indexes: e.target.checked ? [...v.indexes, o.index] : v.indexes.filter((i) => i !== o.index) })}
            />
            {o.label || o.value}
          </label>
        ))}
      </fieldset>
    );
  }
  if (v.kind === "choose") {
    return (
      <input
        id={id}
        aria-label={label}
        className={cn(CONTROL, "h-8 text-[0.8125rem]")}
        value={chooseText(v)}
        onChange={(e) => {
          const parts = e.target.value.split(",").map((t) => t.trim());
          onChange({ kind: "choose", picks: v.picks.length > 1 ? parts.filter(Boolean).map((t) => [t]) : [[e.target.value]] });
        }}
      />
    );
  }
  if (v.kind === "option") {
    return (
      <select id={id} aria-label={label} className={cn(CONTROL, "h-8 text-[0.8125rem]")} value={v.index} onChange={(e) => onChange({ kind: "option", index: Number(e.target.value) })}>
        {item.options.map((o) => (
          <option key={o.index} value={o.index}>
            {o.label || o.value || "—"}
          </option>
        ))}
      </select>
    );
  }
  if (v.kind === "check") {
    return (
      <label className="flex items-center gap-2 text-[0.8125rem]">
        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={v.checked} onChange={(e) => onChange({ kind: "check", checked: e.target.checked })} />
        Tick the box on the page
      </label>
    );
  }
  const long = item.kind === "textarea" || v.text.length > 60;
  return long ? (
    <textarea
      id={id}
      aria-label={label}
      rows={3}
      maxLength={item.maxLength ?? 10_000}
      className={cn(CONTROL, "h-auto py-1.5 text-[0.8125rem]")}
      value={v.text}
      onChange={(e) => onChange({ kind: "text", text: e.target.value })}
    />
  ) : (
    <input
      id={id}
      aria-label={label}
      maxLength={item.maxLength ?? 10_000}
      className={cn(CONTROL, "h-8 text-[0.8125rem]")}
      value={v.text}
      onChange={(e) => onChange({ kind: "text", text: e.target.value })}
    />
  );
}

function reasonText(item: PlanItem): string | null {
  const shown = item.reasons.filter((r) => r !== "already_filled" || item.action !== "keep");
  return shown.length ? [...new Set(shown.map((r) => REASON[r]))].join(" ") : null;
}

/**
 * For a question left to the user: answer it here (it is then filled with the rest), have
 * CareerOS draft an answer to an open question, and save the answer for other forms.
 */
function Answer({
  item,
  choice,
  answers,
  drafting,
  onChange,
  onDraft,
}: {
  item: PlanItem;
  choice?: Choice;
  answers: AnswersAccess;
  drafting: boolean;
  onChange: (c: Choice | null) => void;
  onDraft: () => void;
}) {
  const [open, setOpen] = useState(!!choice);
  const id = `af-answer-${key(item)}`;
  const v = choice?.value ?? null;
  const canDraft = item.draftable && answers.enabled;
  const reusable = !!item.key && REUSABLE_KEYS.includes(item.key);
  if (!open && !choice) {
    return (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <Button variant="link" className="text-xs" onClick={() => setOpen(true)}>
          Answer here<span className="sr-only">: {item.label}</span>
        </Button>
        {canDraft && (
          <Button variant="link" className="text-xs" busy={drafting} onClick={onDraft}>
            <Sparkles className="size-3" aria-hidden /> Suggest an answer<span className="sr-only">: {item.label}</span>
          </Button>
        )}
      </p>
    );
  }
  const set = (value: FillValue | null) => onChange(value ? { on: choice?.on ?? true, value, overwrite: false, remember: choice?.remember } : null);
  const text = v?.kind === "text" ? v.text : v?.kind === "choose" ? chooseText(v) : "";
  return (
    <div className="grid gap-1.5">
      {item.kind === "select" || item.kind === "radio" ? (
        <select
          id={id}
          aria-label={`Your answer for ${item.label}`}
          className={cn(CONTROL, "h-8 text-[0.8125rem]")}
          value={v?.kind === "option" ? v.index : ""}
          onChange={(e) => set(e.target.value === "" ? null : { kind: "option", index: Number(e.target.value) })}
        >
          <option value="">Choose…</option>
          {item.options
            .filter((o) => o.label.trim() || o.value.trim())
            .map((o) => (
              <option key={o.index} value={o.index}>
                {o.label || o.value}
              </option>
            ))}
        </select>
      ) : (
        <textarea
          id={id}
          aria-label={`Your answer for ${item.label}`}
          rows={item.kind === "textarea" ? 4 : 1}
          maxLength={item.maxLength ?? 10_000}
          className={cn(CONTROL, "h-auto py-1.5 text-[0.8125rem]")}
          value={text}
          onChange={(e) => set(e.target.value.trim() ? answerValue(item, e.target.value) : null)}
        />
      )}
      {choice?.issues && choice.issues.length > 0 && (
        <ul className="grid gap-0.5 text-xs text-warning-foreground">
          {choice.issues.map((i) => (
            <li key={i}>⚠ {i}</li>
          ))}
        </ul>
      )}
      {choice?.drafted && <p className="text-xs text-muted-foreground">Drafted by CareerOS from your profile. Read it, change it, then tick it to use it.</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {choice && answers.remember && (
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--primary)]"
              checked={!!choice.remember}
              onChange={(e) => onChange({ ...choice, remember: e.target.checked })}
            />
            Remember for other applications{reusable ? "" : " with this question"}
          </label>
        )}
        {canDraft && (
          <Button variant="link" className="text-xs" busy={drafting} onClick={onDraft}>
            <Sparkles className="size-3" aria-hidden /> {choice?.drafted ? "Draft again" : "Suggest an answer"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({
  item,
  plan,
  choice,
  onToggle,
  onValue,
  onExclude,
  answer,
}: {
  item: PlanItem;
  plan?: AutofillPlan;
  choice?: Choice;
  onToggle?: (on: boolean) => void;
  onValue?: (v: FillValue) => void;
  onExclude?: () => void;
  /** The answer editor for a question left to the user. */
  answer?: React.ReactNode;
}) {
  const reason = reasonText(item);
  const checkId = `af-on-${key(item)}`;
  return (
    <li className="grid gap-1.5 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        {choice && onToggle ? (
          <label htmlFor={checkId} className="flex min-w-0 items-start gap-2">
            <input id={checkId} type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={choice.on} onChange={(e) => onToggle(e.target.checked)} />
            <span className="min-w-0 text-[0.8125rem] font-medium break-words">
              {item.label}
              {item.required && <span className="text-muted-foreground"> (required)</span>}
            </span>
          </label>
        ) : (
          <span className="min-w-0 text-[0.8125rem] font-medium break-words">
            {item.label}
            {item.required && <span className="text-muted-foreground"> (required)</span>}
          </span>
        )}
        {item.key && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {item.document && <FileText className="size-3" aria-hidden />}
            {keyLabel(item)}
          </span>
        )}
      </div>
      {choice && onValue && plan && !answer && (item.action !== "keep" || choice.on) && <ValueEditor item={item} choice={choice} plan={plan} onChange={onValue} />}
      {answer}
      {(reason || onExclude) && (
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
          {reason && <span>{reason}</span>}
          {onExclude && item.key && (
            <Button variant="link" className="text-xs" onClick={onExclude}>
              Never fill {KEYS[item.key].label.toLowerCase()}
            </Button>
          )}
        </p>
      )}
    </li>
  );
}

function Group({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <h3 id={id} className="text-[0.8125rem] font-semibold">
        {title} <span className="tabular font-normal text-muted-foreground">({count})</span>
      </h3>
      <ul className="divide-y rounded-xl border bg-card shadow-card">{children}</ul>
    </section>
  );
}

/** The language suggested answers are written in: the user's setting, else the page's. */
function answerLanguage(answers: AnswersAccess, plan: AutofillPlan): "en" | "de" {
  if (answers.prefs.language !== "auto") return answers.prefs.language;
  return plan.lang?.toLowerCase().startsWith("de") ? "de" : "en";
}

/** The answer as text, for saving it for other forms. */
function answerText(item: PlanItem, v: FillValue | null): string | null {
  if (!v) return null;
  if (v.kind === "text") return v.text.trim() || null;
  if (v.kind === "choose") return chooseText(v).trim() || null;
  if (v.kind === "option") {
    const o = item.options.find((x) => x.index === v.index);
    return (o?.label || o?.value || "").trim() || null;
  }
  return null;
}

const AI_HINT: Record<string, string> = {
  consent_required: "To get suggested answers to open questions, allow AI processing in your CareerOS settings.",
  ai_unavailable: "Suggested answers aren't available on this CareerOS server.",
};

/** What happened after the fill besides the fields: answers saved for other forms. */
type FillOutcome = { report: FillReport; saved: number; saveFailed: number };

function Review({
  plan,
  tabId,
  excluded,
  answers,
  onExclude,
  onOpen,
  onDone,
  onCancel,
}: {
  plan: AutofillPlan;
  tabId: number;
  excluded: FieldKey[];
  answers: AnswersAccess;
  onExclude: (k: FieldKey) => void;
  onOpen: (path: string) => void;
  onDone: (r: FillOutcome) => void;
  onCancel: () => void;
}) {
  const [choices, setChoices] = useState(() => initialChoices(plan));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [drafting, setDrafting] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [draftError, setDraftError] = useState<ErrorInfo | null>(null);
  const by = (a: PlanItem["action"]) => plan.items.filter((i) => i.action === a);
  const selected = plan.items.filter((i) => choices[key(i)]?.on && choices[key(i)]?.value);
  const set = (i: PlanItem, patch: Partial<Choice>) => setChoices((c) => ({ ...c, [key(i)]: { ...c[key(i)]!, ...patch } }));
  const draftable = by("ask").filter((i) => i.draftable && !choices[key(i)]?.value);

  const draft = async (items: PlanItem[]) => {
    if (!items.length) return;
    const ids = items.map(key);
    setDrafting((d) => new Set([...d, ...ids]));
    setDraftError(null);
    try {
      // At most 10 questions per request.
      for (let n = 0; n < items.length; n += 10) {
        const batch = items.slice(n, n + 10);
        const out = await send({
          type: "autofill.answers",
          tabId,
          pageUrl: plan.pageUrl,
          questions: batch.map((i) => ({ id: key(i), text: i.question.slice(0, 1000), max_length: i.maxLength })),
          language: answerLanguage(answers, plan),
        });
        const next: Record<string, Choice> = {};
        const said: Record<string, string> = {};
        for (const a of out.answers) {
          const item = batch.find((i) => key(i) === a.id);
          if (!item) continue;
          if (a.status === "drafted" && a.answer) {
            // A draft is never ticked: the user reads it and ticks it.
            next[a.id] = { on: false, value: answerValue(item, a.answer), overwrite: false, issues: a.issues, drafted: true };
            said[a.id] = "";
          } else if (a.status === "declined") {
            said[a.id] = "CareerOS doesn't draft answers to this kind of question. Answer it yourself.";
          } else {
            said[a.id] = a.missing ? `CareerOS needs more from you to answer this: ${a.missing}` : "Your profile doesn't say enough to answer this. Answer it yourself.";
          }
        }
        setChoices((c) => ({ ...c, ...next }));
        setNotes((x) => ({ ...x, ...said }));
      }
    } catch (e) {
      setDraftError(errorInfo(e));
    } finally {
      setDrafting((d) => new Set([...d].filter((x) => !ids.includes(x))));
    }
  };

  const fill = async () => {
    setBusy(true);
    setError(null);
    try {
      const items = selected.map((i) => {
        const c = choices[key(i)]!;
        return { frameId: i.frameId, fieldId: i.fieldId, frameOrigin: i.frameOrigin, value: c.value!, overwrite: c.overwrite };
      });
      const unanswered = plan.items.filter((i) => i.action === "ask" && (i.required || i.key) && !(choices[key(i)]?.on && choices[key(i)]?.value));
      const attention = unanswered.map((i) => ({ frameId: i.frameId, fieldId: i.fieldId }));
      const stats = { confirmed: selected.filter((i) => i.action !== "fill").length, asked: attention.length, ats: plan.ats?.id ?? null };
      const report = await send({ type: "autofill.fill", tabId, pageUrl: plan.pageUrl, items, attention, stats });
      // Answers the user asked to remember, once they are on the page.
      let saved = 0;
      let saveFailed = 0;
      const filled = new Set(report.results.filter((r) => r.status === "filled").map(key));
      for (const i of selected) {
        const c = choices[key(i)]!;
        const text = c.remember && filled.has(key(i)) ? answerText(i, c.value) : null;
        if (!text) continue;
        try {
          await send({ type: "autofill.saveAnswer", fieldKey: i.key && REUSABLE_KEYS.includes(i.key) ? i.key : null, question: i.question.slice(0, 500), answer: text.slice(0, 5000) });
          saved++;
        } catch {
          saveFailed++;
        }
      }
      onDone({ report, saved, saveFailed });
    } catch (e) {
      setError(errorInfo(e));
    } finally {
      setBusy(false);
    }
  };

  const editable = (i: PlanItem) => (
    <Row
      key={key(i)}
      item={i}
      plan={plan}
      choice={choices[key(i)]}
      onToggle={(on) => set(i, { on })}
      onValue={(value) => set(i, { value, on: true })}
      onExclude={
        i.key && !excluded.includes(i.key) && !i.document
          ? () => {
              const k = i.key!;
              onExclude(k);
              setChoices((c) => {
                const next = { ...c };
                for (const x of plan.items) if (x.key === k && next[key(x)]) next[key(x)] = { ...next[key(x)]!, on: false };
                return next;
              });
            }
          : undefined
      }
    />
  );

  const asked = (i: PlanItem) => {
    const k = key(i);
    const choice = choices[k];
    if (!i.answerable) return <Row key={k} item={i} />;
    return (
      <Row
        key={k}
        item={i}
        plan={plan}
        choice={choice}
        onToggle={choice ? (on) => set(i, { on }) : undefined}
        answer={
          <>
            <Answer
              item={i}
              choice={choice}
              answers={answers}
              drafting={drafting.has(k)}
              onDraft={() => draft([i])}
              onChange={(c) =>
                setChoices((all) => {
                  const next = { ...all };
                  if (c) next[k] = c;
                  else delete next[k];
                  return next;
                })
              }
            />
            {notes[k] && <p className="text-xs text-muted-foreground">{notes[k]}</p>}
          </>
        }
      />
    );
  };

  const hasOpen = by("ask").some((i) => i.draftable);
  const more = plan.more.experiences + plan.more.education;

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden /> Review AutoFill
        </h2>
        {(plan.ats || plan.application) && (
          <p className="text-xs text-muted-foreground">
            {plan.ats && <>Form by {plan.ats.name}. </>}
            {plan.application && (
              <>
                For your application: {plan.application.position_title} at {plan.application.company_name}.
              </>
            )}
          </p>
        )}
        <p className="text-xs text-muted-foreground">Change any value or untick it. Only the ticked fields are filled; nothing is submitted.</p>
      </div>
      <Group id="af-ready" title="Ready to fill" count={by("fill").length}>
        {by("fill").map(editable)}
      </Group>
      <Group id="af-confirm" title="Please confirm" count={by("confirm").length}>
        {by("confirm").map(editable)}
      </Group>
      {more > 0 && (
        <p className="text-xs text-muted-foreground">
          Your Career Profile has{" "}
          {[plan.more.experiences ? plural(plan.more.experiences, "more role", "more roles") : null, plan.more.education ? plural(plan.more.education, "more school", "more schools") : null]
            .filter(Boolean)
            .join(" and ")}{" "}
          than the form shows. Add entries on the page (usually "Add another"); AutoFill offers them on its next check.
        </p>
      )}
      <Group id="af-keep" title="Already filled in on the page" count={by("keep").length}>
        {by("keep").map((i) => (i.value && !i.reasons.includes("user_edited") && !i.reasons.includes("already_filled") ? editable(i) : <Row key={key(i)} item={i} />))}
      </Group>
      <Group id="af-input" title="Needs your input" count={by("ask").length}>
        {by("ask").map(asked)}
      </Group>
      {hasOpen && (
        <div className="grid gap-1.5">
          {answers.enabled ? (
            draftable.length > 1 && (
              <Button variant="outline" size="sm" className="justify-self-start" busy={draftable.some((i) => drafting.has(key(i)))} onClick={() => draft(draftable)}>
                <Sparkles aria-hidden /> Suggest answers ({draftable.length})
              </Button>
            )
          ) : (
            answers.reason && (
              <p className="text-xs text-muted-foreground">
                {AI_HINT[answers.reason] ?? "Suggested answers aren't available for your account."}{" "}
                {answers.reason === "consent_required" && (
                  <Button variant="link" className="text-xs" onClick={() => onOpen("/settings")}>
                    Open settings
                  </Button>
                )}
              </p>
            )
          )}
          {answers.enabled && <p className="text-xs text-muted-foreground">Drafts use only your Career Profile and this job. CareerOS never drafts salary, legal or personal questions.</p>}
          {draftError && (
            <Alert tone="warning" title="No answers suggested">
              <p>{draftError.message}</p>
            </Alert>
          )}
        </div>
      )}
      <Group id="af-skip" title="Left alone" count={by("skip").length + by("excluded").length}>
        {[...by("skip"), ...by("excluded")].map((i) => (
          <Row key={key(i)} item={i} />
        ))}
      </Group>
      {error && (
        <Alert tone="error" title="Nothing was filled">
          <p>{error.message}</p>
        </Alert>
      )}
      <div className="sticky bottom-0 -mx-4 grid gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap gap-2">
          <Button busy={busy} disabled={!selected.length} onClick={fill}>
            Fill {plural(selected.length, "field", "fields")}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">You check the form and submit it yourself.</p>
      </div>
    </div>
  );
}

const FAILED: Record<string, string> = {
  has_value: "already had a value",
  user_edited: "you had changed it",
  not_found: "no longer on the page",
  no_option: "the choice is gone",
  too_long: "too long for the field",
  wrong_page: "the page changed",
  wrong_file_type: "the field doesn't take this file type",
  file_unavailable: "CareerOS couldn't provide the file",
  failed: "couldn't be written",
};

function Result({
  plan,
  outcome,
  tabId,
  next,
  onAgain,
  onNext,
  onClose,
}: {
  plan: AutofillPlan;
  outcome: FillOutcome;
  tabId: number;
  /** The page now shows a form with fields to fill (the next step of the application). */
  next: AutofillPlan | null;
  onAgain: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const report = outcome.report;
  const [undone, setUndone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = (r: { frameId: number; fieldId: string }) => plan.items.find((i) => key(i) === key(r))?.label ?? "A field";
  const problems = report.results.filter((r) => r.status !== "filled");
  const filled = report.results.filter((r) => r.status === "filled");
  const ask = plan.items.filter((i) => i.action === "ask" && (i.required || i.key));

  const undo = async (fields?: { frameId: number; fieldId: string }[]) => {
    setBusy(true);
    try {
      const r = await send({ type: "autofill.undo", tabId, fields });
      const manual = r.results.filter((x) => x.status === "manual").length;
      setUndone(
        `${plural(r.restored, "field", "fields")} restored.${r.kept ? ` ${plural(r.kept, "field", "fields")} you changed stayed as you left ${r.kept === 1 ? "it" : "them"}.` : ""}${
          manual ? ` ${plural(manual, "list choice", "list choices")} and attached files can't be undone by AutoFill; change ${manual === 1 ? "it" : "them"} on the page.` : ""
        }`,
      );
      if (!fields) onAgain();
    } catch (e) {
      setUndone(errorInfo(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Alert tone="success" role="status" title={`Filled ${plural(report.filled, "field", "fields")}`}>
        <p>Check the highlighted fields on the page, then submit the application yourself.</p>
        {outcome.saved > 0 && <p>{plural(outcome.saved, "answer", "answers")} saved for other applications.</p>}
      </Alert>
      {outcome.saveFailed > 0 && (
        <Alert tone="warning" title={`${plural(outcome.saveFailed, "answer wasn't", "answers weren't")} saved`}>
          <p>The fields were filled; CareerOS couldn't keep the answers for next time.</p>
        </Alert>
      )}
      {next && (
        <Alert
          tone="info"
          role="status"
          title="New fields on the page"
          action={
            <Button size="sm" onClick={onNext}>
              Fill this step
            </Button>
          }
        >
          <p>{plural(next.counts.ready + next.counts.confirm, "field", "fields")} on this step can be filled from your profile.</p>
        </Alert>
      )}
      {problems.length > 0 && (
        <Alert tone="warning" title={`${plural(problems.length, "field wasn't", "fields weren't")} filled`}>
          <ul className="grid gap-0.5">
            {problems.map((p) => (
              <li key={key(p)}>
                {label(p)}: {FAILED[p.status] ?? p.status}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {ask.length > 0 && (
        <section aria-labelledby="af-left" className="grid gap-1.5">
          <h3 id="af-left" className="text-[0.8125rem] font-semibold">
            Still for you to answer
          </h3>
          <ul className="grid gap-0.5 text-[0.8125rem] text-muted-foreground">
            {ask.map((i) => (
              <li key={key(i)}>
                {i.label}
                {i.required && " (required)"}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">They are outlined on the page.</p>
        </section>
      )}
      {filled.length > 0 && (
        <details className="rounded-xl border bg-card px-3 py-2 shadow-card">
          <summary className="cursor-pointer text-[0.8125rem] font-medium">Filled fields</summary>
          <ul className="mt-2 divide-y">
            {filled.map((f) => (
              <li key={key(f)} className="flex items-center justify-between gap-2 py-1.5 text-[0.8125rem]">
                <span className="min-w-0 truncate">{label(f)}</span>
                <Button variant="link" className="text-xs" disabled={busy} onClick={() => undo([f])}>
                  Clear<span className="sr-only"> {label(f)}</span>
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {undone && (
        <p role="status" className="text-xs text-muted-foreground">
          {undone}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" busy={busy} onClick={() => undo()}>
          <Undo2 aria-hidden /> Undo AutoFill
        </Button>
        <Button variant="ghost" onClick={onClose}>
          <CheckCircle2 aria-hidden /> Done
        </Button>
      </div>
    </div>
  );
}

/**
 * The side panel's AutoFill section. `mode` starts at "summary"; "review" when the user asked
 * from the popup.
 */
export function AutofillPanel({
  tabId,
  state,
  excluded,
  answers,
  onExclude,
  onOpen,
  startInReview,
  onModeChange,
}: {
  tabId: number;
  state: AutofillState;
  excluded: FieldKey[];
  answers: AnswersAccess;
  onExclude: (k: FieldKey) => void;
  onOpen: (path: string) => void;
  startInReview?: boolean;
  /** The panel hides the posting while the user reviews or checks the result. */
  onModeChange?: (mode: "summary" | "review" | "result") => void;
}) {
  const { plan, error, rescan, loading, changed } = state;
  const [mode, setMode] = useState<"summary" | "review" | "result">("summary");
  const [outcome, setOutcome] = useState<FillOutcome | null>(null);
  // The page's form changed after the fill (the next step): offer it in the result.
  const [changedAtFill, setChangedAtFill] = useState(0);
  // The plan being reviewed stays as it was, even if the page is scanned again meanwhile.
  const [frozen, setFrozen] = useState<AutofillPlan | null>(null);
  const review = useCallback(() => {
    if (!plan) return;
    setFrozen(plan);
    setMode("review");
  }, [plan]);

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  // Opened from the popup's "Fill application": go straight to the review, once.
  const intentUsed = useRef(false);
  useEffect(() => {
    if (startInReview && !intentUsed.current && plan?.isApplicationForm && mode === "summary") {
      intentUsed.current = true;
      review();
    }
  }, [startInReview, plan, mode, review]);

  if (error && !QUIET.has(error.code)) {
    return (
      <Alert
        tone="warning"
        title="AutoFill couldn't check this form"
        action={
          <Button size="sm" variant="outline" onClick={rescan}>
            <RefreshCw aria-hidden /> Try again
          </Button>
        }
      >
        <p>{error.message}</p>
      </Alert>
    );
  }
  if (mode === "review" && frozen) {
    return (
      <Review
        plan={frozen}
        tabId={tabId}
        excluded={excluded}
        answers={answers}
        onExclude={onExclude}
        onOpen={onOpen}
        onCancel={() => {
          setMode("summary");
          setFrozen(null);
        }}
        onDone={(r) => {
          setOutcome(r);
          setChangedAtFill(changed);
          setMode("result");
        }}
      />
    );
  }
  if (mode === "result" && outcome && frozen) {
    // Fields the user can still fill: the next step, once the page shows a new form.
    const next = changed > changedAtFill && plan?.isApplicationForm && plan.counts.ready + plan.counts.confirm > 0 ? plan : null;
    return (
      <Result
        plan={frozen}
        outcome={outcome}
        tabId={tabId}
        next={next}
        onNext={() => {
          if (!next) return;
          send({ type: "autofill.done", tabId }).catch(() => undefined);
          setFrozen(next);
          setMode("review");
        }}
        onAgain={() => {
          setMode("summary");
          setFrozen(null);
          rescan();
        }}
        onClose={() => {
          send({ type: "autofill.done", tabId }).catch(() => undefined);
          setMode("summary");
          setFrozen(null);
          rescan();
        }}
      />
    );
  }
  if (!plan || !plan.isApplicationForm) return null;
  const ready = plan.counts.ready + plan.counts.confirm;
  return (
    <div className="grid gap-2">
      <AutofillSummary
        plan={plan}
        onOpen={onOpen}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={review} disabled={!ready && !plan.counts.keep}>
              Fill application
            </Button>
            <Button variant="ghost" size="sm" busy={loading} onClick={rescan}>
              <RefreshCw aria-hidden /> Check again
            </Button>
          </div>
        }
      />
      <MissingHint plan={plan} onOpen={onOpen} />
    </div>
  );
}

/** One line under the tab view when no form was found: forms often appear after "Apply". */
export function AutofillHint({ state }: { state: AutofillState }) {
  if (!state.plan || state.plan.isApplicationForm) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      No application form on this page yet.
      <Button variant="link" className="text-xs" busy={state.loading} onClick={state.rescan}>
        Look again
      </Button>
    </p>
  );
}
