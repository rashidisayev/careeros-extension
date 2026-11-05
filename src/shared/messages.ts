/**
 * Messages between the extension's pages (popup, side panel, options) and the background
 * service worker, which alone holds tokens and talks to CareerOS. Every request is
 * validated here before it is handled; anything malformed is dropped.
 */
import type {
  ApplicationDetail,
  ApplicationStatus,
  ImportOut,
  ImportSave,
} from "./api-types";
import { APPLICATION_STATUSES } from "./api-types";
import { ATS_ADAPTERS } from "../autofill/adapters";
import { isFieldKey } from "../autofill/keys";
import type {
  AnswerLength,
  AnswerQuestion,
  AnswersOut,
  AnswerTone,
  AutofillPlan,
  DocumentRef,
  FieldKey,
  FieldRef,
  FillItem,
  FillReport,
  FillStats,
  FillValue,
  HistoryEntry,
  SavedAnswer,
  UndoReport,
} from "../autofill/types";
import type { Settings } from "./settings";
import type { ErrorInfo, SessionInfo, TabState } from "./types";
import type { LogEntry } from "./log";

export type Request =
  | { type: "session.get"; refresh?: boolean }
  | { type: "session.connect" }
  | { type: "session.disconnect" }
  | { type: "tab.state"; tabId: number; refresh?: boolean }
  | { type: "import.fromPage"; tabId: number }
  | { type: "import.fromSelection"; tabId: number }
  | { type: "import.fromText"; tabId: number | null; url: string | null; text: string }
  | { type: "import.get"; importId: string }
  | { type: "import.text"; importId: string; text: string }
  | { type: "import.retry"; importId: string }
  | { type: "import.save"; importId: string; fields: ImportSave; tabId: number | null }
  | { type: "import.dismiss"; tabId: number }
  | { type: "application.get"; applicationId: string }
  | { type: "app.open"; path: string }
  | { type: "settings.get" }
  | { type: "settings.set"; patch: Partial<Settings> }
  | { type: "site.accessChanged" }
  | { type: "diagnostics.get" }
  | { type: "autofill.scan"; tabId: number }
  | { type: "autofill.fill"; tabId: number; pageUrl: string; items: FillItem[]; attention: FieldRef[]; stats?: FillStats }
  | { type: "autofill.undo"; tabId: number; fields?: FieldRef[] }
  | { type: "autofill.done"; tabId: number }
  | { type: "autofill.answers"; tabId: number; pageUrl: string; questions: AnswerQuestion[]; language: "en" | "de"; length?: AnswerLength; tone?: AnswerTone }
  | { type: "autofill.savedAnswers" }
  | { type: "autofill.saveAnswer"; fieldKey: FieldKey | null; question: string; answer: string }
  | { type: "autofill.deleteAnswer"; id: string }
  | { type: "autofill.history" }
  | { type: "autofill.historyDelete"; id?: string }
  | { type: "autofill.cvs" }
  | { type: "data.clear" };

export type ResponseMap = {
  "session.get": SessionInfo;
  "session.connect": SessionInfo;
  "session.disconnect": SessionInfo;
  "tab.state": TabState;
  "import.fromPage": ImportOut;
  "import.fromSelection": ImportOut;
  "import.fromText": ImportOut;
  "import.get": ImportOut;
  "import.text": ImportOut;
  "import.retry": ImportOut;
  "import.save": ApplicationDetail;
  "import.dismiss": TabState;
  "application.get": ApplicationDetail;
  "app.open": null;
  "settings.get": Settings;
  "settings.set": Settings;
  "site.accessChanged": null;
  "diagnostics.get": { version: string; logs: LogEntry[] };
  "autofill.scan": AutofillPlan;
  "autofill.fill": FillReport;
  "autofill.undo": UndoReport;
  "autofill.done": null;
  "autofill.answers": AnswersOut;
  "autofill.savedAnswers": SavedAnswer[];
  "autofill.saveAnswer": SavedAnswer;
  "autofill.deleteAnswer": null;
  "autofill.history": HistoryEntry[];
  "autofill.historyDelete": null;
  "autofill.cvs": DocumentRef[];
  "data.clear": Settings;
};

export type Response<T> = { ok: true; data: T } | { ok: false; error: ErrorInfo };

/** Background -> pages, fire and forget. */
export type Broadcast =
  | { type: "broadcast.tab"; tabId: number }
  | { type: "broadcast.session" }
  | { type: "broadcast.settings" }
  /** The form on a tab gained or lost fields (the next step of an application). */
  | { type: "broadcast.autofill"; tabId: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 60_000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isTab = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isUrl = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 2000 && /^https?:\/\//i.test(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= MAX_TEXT;
const optBool = (v: unknown) => v === undefined || typeof v === "boolean";

function validSave(v: unknown): v is ImportSave {
  if (!isObj(v)) return false;
  if (typeof v.title !== "string" || typeof v.company_name !== "string") return false;
  if (!APPLICATION_STATUSES.includes(v.status as ApplicationStatus)) return false;
  for (const [k, val] of Object.entries(v)) {
    if (val === null || val === undefined) continue;
    if (typeof val === "string" && val.length > MAX_TEXT) return false;
    if (typeof val === "object") return false;
    if (!["string", "number", "boolean"].includes(typeof val)) return false;
    if (k.length > 40) return false;
  }
  return true;
}

function validPatch(v: unknown): v is Partial<Settings> {
  if (!isObj(v)) return false;
  const allowed = new Set(["theme", "defaultStatus", "followTabs", "diagnostics", "autofill"]);
  if (v.autofill !== undefined && !isObj(v.autofill)) return false;
  return Object.keys(v).every((k) => allowed.has(k));
}

const MAX_FILL = 400;
const isFieldId = (v: unknown): v is string => typeof v === "string" && /^f\d{1,6}$/.test(v);
const isFrame = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isOrigin = (v: unknown): v is string => typeof v === "string" && v.length <= 300 && /^https?:\/\/[^/\s]+$/.test(v);

function validRef(v: unknown): v is FieldRef {
  return isObj(v) && isFrame(v.frameId) && isFieldId(v.fieldId);
}

const isIndex = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 5000;
const DOC_REF = /^(resume|generated):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validValue(val: unknown): val is FillValue {
  if (!isObj(val)) return false;
  switch (val.kind) {
    case "text":
      return typeof val.text === "string" && val.text.length <= 10_000;
    case "option":
      return isIndex(val.index);
    case "check":
      return typeof val.checked === "boolean";
    case "options":
      return Array.isArray(val.indexes) && val.indexes.length > 0 && val.indexes.length <= 500 && val.indexes.every(isIndex);
    case "choose":
      return (
        Array.isArray(val.picks) &&
        val.picks.length > 0 &&
        val.picks.length <= 50 &&
        val.picks.every((p) => Array.isArray(p) && p.length > 0 && p.length <= 12 && p.every((t) => typeof t === "string" && t.length > 0 && t.length <= 300))
      );
    case "file":
      return (
        typeof val.ref === "string" &&
        DOC_REF.test(val.ref) &&
        (val.format === "pdf" || val.format === "docx") &&
        typeof val.name === "string" &&
        val.name.length > 0 &&
        val.name.length <= 200 &&
        !/[\\/\u0000-\u001f]/.test(val.name)
      );
    default:
      return false;
  }
}

function validFillItem(v: unknown): v is FillItem {
  if (!isObj(v) || !validRef(v)) return false;
  const o = v as Record<string, unknown>;
  if (!isOrigin(o.frameOrigin) || typeof o.overwrite !== "boolean") return false;
  return validValue(o.value);
}

/** The value with only its own keys. */
function cleanValue(v: FillValue): FillValue {
  switch (v.kind) {
    case "text":
      return { kind: "text", text: v.text };
    case "option":
      return { kind: "option", index: v.index };
    case "check":
      return { kind: "check", checked: v.checked };
    case "options":
      return { kind: "options", indexes: [...v.indexes] };
    case "choose":
      return { kind: "choose", picks: v.picks.map((p) => [...p]) };
    case "file":
      return { kind: "file", ref: v.ref, format: v.format, name: v.name };
  }
}

const isCount = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1000;
const ATS = new Set(ATS_ADAPTERS.map((a) => a.id as string));
const validStats = (v: unknown): v is FillStats => isObj(v) && isCount(v.confirmed) && isCount(v.asked) && (v.ats === null || ATS.has(v.ats as string));

const QUESTION_ID = /^\d{1,4}:f\d{1,6}$/;
function validQuestion(v: unknown): v is AnswerQuestion {
  return (
    isObj(v) &&
    typeof v.id === "string" &&
    QUESTION_ID.test(v.id) &&
    typeof v.text === "string" &&
    v.text.trim().length >= 3 &&
    v.text.length <= 1000 &&
    (v.max_length === null || (Number.isInteger(v.max_length) && (v.max_length as number) > 0 && (v.max_length as number) <= 20_000))
  );
}

const refs = (v: unknown, max = MAX_FILL): v is FieldRef[] => Array.isArray(v) && v.length <= max && v.every(validRef);

/** Only the fields named, with only their own keys (nothing else crosses into the page). */
function cleanItem(i: FillItem): FillItem {
  return { frameId: i.frameId, fieldId: i.fieldId, frameOrigin: i.frameOrigin, overwrite: i.overwrite, value: cleanValue(i.value) };
}

export function parseRequest(raw: unknown): Request | null {
  if (!isObj(raw) || typeof raw.type !== "string") return null;
  const r = raw;
  switch (r.type) {
    case "session.get":
      return optBool(r.refresh) ? { type: r.type, refresh: r.refresh as boolean | undefined } : null;
    case "session.connect":
    case "session.disconnect":
    case "settings.get":
    case "site.accessChanged":
    case "diagnostics.get":
    case "data.clear":
    case "autofill.savedAnswers":
    case "autofill.history":
    case "autofill.cvs":
      return { type: r.type };
    case "tab.state":
      return isTab(r.tabId) && optBool(r.refresh)
        ? { type: r.type, tabId: r.tabId, refresh: r.refresh as boolean | undefined }
        : null;
    case "import.fromPage":
    case "import.fromSelection":
    case "import.dismiss":
      return isTab(r.tabId) ? { type: r.type, tabId: r.tabId } : null;
    case "import.fromText":
      return (r.tabId === null || isTab(r.tabId)) && (r.url === null || isUrl(r.url)) && isText(r.text)
        ? { type: r.type, tabId: r.tabId as number | null, url: r.url as string | null, text: r.text }
        : null;
    case "import.get":
    case "import.retry":
      return isUuid(r.importId) ? { type: r.type, importId: r.importId } : null;
    case "import.text":
      return isUuid(r.importId) && isText(r.text) ? { type: r.type, importId: r.importId, text: r.text } : null;
    case "import.save":
      return isUuid(r.importId) && validSave(r.fields) && (r.tabId === null || isTab(r.tabId))
        ? { type: r.type, importId: r.importId, fields: r.fields, tabId: r.tabId as number | null }
        : null;
    case "application.get":
      return isUuid(r.applicationId) ? { type: r.type, applicationId: r.applicationId } : null;
    case "app.open":
      return typeof r.path === "string" && /^\/[A-Za-z0-9/_\-?=&.%]{0,300}$/.test(r.path) && !r.path.startsWith("//")
        ? { type: r.type, path: r.path }
        : null;
    case "settings.set":
      return validPatch(r.patch) ? { type: r.type, patch: r.patch } : null;
    case "autofill.scan":
    case "autofill.done":
      return isTab(r.tabId) ? { type: r.type, tabId: r.tabId } : null;
    case "autofill.fill":
      return isTab(r.tabId) &&
        isUrl(r.pageUrl) &&
        Array.isArray(r.items) &&
        r.items.length > 0 &&
        r.items.length <= MAX_FILL &&
        r.items.every(validFillItem) &&
        refs(r.attention) &&
        (r.stats === undefined || validStats(r.stats))
        ? {
            type: r.type,
            tabId: r.tabId,
            pageUrl: r.pageUrl,
            items: (r.items as FillItem[]).map(cleanItem),
            attention: (r.attention as FieldRef[]).map((a) => ({ frameId: a.frameId, fieldId: a.fieldId })),
            ...(r.stats ? { stats: { confirmed: (r.stats as FillStats).confirmed, asked: (r.stats as FillStats).asked, ats: (r.stats as FillStats).ats } } : {}),
          }
        : null;
    case "autofill.answers":
      return isTab(r.tabId) &&
        isUrl(r.pageUrl) &&
        Array.isArray(r.questions) &&
        r.questions.length > 0 &&
        r.questions.length <= 10 &&
        r.questions.every(validQuestion) &&
        (r.language === "en" || r.language === "de") &&
        (r.length === undefined || ["short", "medium", "long"].includes(r.length as string)) &&
        (r.tone === undefined || ["professional", "concise", "warm", "executive"].includes(r.tone as string))
        ? {
            type: r.type,
            tabId: r.tabId,
            pageUrl: r.pageUrl,
            questions: (r.questions as AnswerQuestion[]).map((q) => ({ id: q.id, text: q.text, max_length: q.max_length })),
            language: r.language as "en" | "de",
            ...(r.length ? { length: r.length as AnswerLength } : {}),
            ...(r.tone ? { tone: r.tone as AnswerTone } : {}),
          }
        : null;
    case "autofill.saveAnswer":
      return (r.fieldKey === null || isFieldKey(r.fieldKey)) &&
        typeof r.question === "string" &&
        r.question.trim().length > 0 &&
        r.question.length <= 500 &&
        typeof r.answer === "string" &&
        r.answer.trim().length > 0 &&
        r.answer.length <= 5000
        ? { type: r.type, fieldKey: r.fieldKey as FieldKey | null, question: r.question, answer: r.answer }
        : null;
    case "autofill.deleteAnswer":
      return isUuid(r.id) ? { type: r.type, id: r.id } : null;
    case "autofill.historyDelete":
      return r.id === undefined || isUuid(r.id) ? { type: r.type, ...(r.id ? { id: r.id as string } : {}) } : null;
    case "autofill.undo":
      return isTab(r.tabId) && (r.fields === undefined || refs(r.fields))
        ? { type: r.type, tabId: r.tabId, fields: (r.fields as FieldRef[] | undefined)?.map((a) => ({ frameId: a.frameId, fieldId: a.fieldId })) }
        : null;
    default:
      return null;
  }
}

/**
 * Only the extension's own pages may call the background: not content scripts (they run in
 * web pages), not other extensions, not websites.
 */
export function isTrustedSender(sender: chrome.runtime.MessageSender, extensionId: string, extensionOrigin: string): boolean {
  if (sender.id !== extensionId) return false;
  // Content scripts report the web page's URL; extension pages (also when opened in a tab,
  // like Options) report their chrome-extension:// URL.
  if (!sender.url) return false;
  return sender.url.startsWith(`${extensionOrigin}/`);
}
