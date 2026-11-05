/**
 * Authenticated calls to GetCareer. Every endpoint the extension uses is listed here; they are
 * the same endpoints the web app uses (job imports, applications) plus the two extension
 * endpoints (bootstrap, lookup). See docs/API_INTEGRATION.md.
 */
import type {
  ApplicationDetail,
  Bootstrap,
  ImportOut,
  ImportSave,
  LookupOut,
} from "../shared/api-types";
import type { AnswersOut, AutofillProfile, DocumentsOut, HistoryEntry, SavedAnswer } from "../autofill/types";
import type { ExtensionError } from "../shared/errors";
import type { PageCapture } from "../shared/types";
import { accessToken, refresh } from "./auth";
import { broadcastSession } from "./broadcast";
import { http, type HttpOptions } from "./http";

const inflight = new Map<string, Promise<unknown>>();

/** One authenticated request; on 401 the token is refreshed once and the request repeated. */
export async function call<T>(path: string, opts: Omit<HttpOptions, "token"> = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const key = method === "GET" ? path : null;
  if (key && inflight.has(key)) return inflight.get(key) as Promise<T>;
  const run = (async () => {
    try {
      const token = await accessToken();
      try {
        return await http<T>(path, { ...opts, token });
      } catch (err) {
        if ((err as ExtensionError).status !== 401) throw err;
        return await http<T>(path, { ...opts, token: await refresh() });
      }
    } catch (err) {
      // The connection ended (revoked in Settings, expired): every open page should know.
      if ((err as ExtensionError).code === "invalid_session") broadcastSession();
      throw err;
    }
  })();
  if (key) {
    inflight.set(key, run);
    run.finally(() => inflight.delete(key)).catch(() => undefined);
  }
  return run;
}

export const api = {
  bootstrap: () => call<Bootstrap>("/extension/bootstrap"),
  lookup: (body: { url: string; title?: string | null; company?: string | null; city?: string | null }) =>
    call<LookupOut>("/extension/lookup", { method: "POST", body }),
  importFromCapture: (capture: PageCapture) => call<ImportOut>("/job-imports", { method: "POST", body: { capture } }),
  importFromText: (text: string, url: string | null) =>
    call<ImportOut>("/job-imports", { method: "POST", body: { text, url } }),
  getImport: (id: string) => call<ImportOut>(`/job-imports/${id}`),
  submitText: (id: string, text: string) => call<ImportOut>(`/job-imports/${id}/text`, { method: "POST", body: { text } }),
  retryImport: (id: string) => call<ImportOut>(`/job-imports/${id}/retry`, { method: "POST" }),
  saveImport: (id: string, fields: ImportSave) =>
    call<ApplicationDetail>(`/job-imports/${id}/save`, { method: "POST", body: fields, timeoutMs: 30_000 }),
  application: (id: string) => call<ApplicationDetail>(`/applications/${id}`),
  autofillProfile: () => call<AutofillProfile>("/extension/autofill-profile"),
  // AutoFill, Phases 2 and 3 (see docs/API_INTEGRATION.md).
  autofillDocuments: (url: string, applicationId: string | null) =>
    call<DocumentsOut>("/extension/autofill/documents", { method: "POST", body: { url, application_id: applicationId } }),
  autofillFile: (ref: string, format: "pdf" | "docx") => {
    const [source, id] = ref.split(":");
    return call<{ bytes: ArrayBuffer; mime: string }>(`/extension/autofill/documents/${source}/${id}/file?format=${format}`, { as: "bytes", timeoutMs: 60_000 });
  },
  autofillAnswers: (body: Record<string, unknown>) => call<AnswersOut>("/extension/autofill/answers", { method: "POST", body, timeoutMs: 90_000 }),
  savedAnswers: () => call<SavedAnswer[]>("/extension/autofill/saved-answers"),
  saveAnswer: (body: { field_key: string | null; question: string; answer: string }) =>
    call<SavedAnswer>("/extension/autofill/saved-answers", { method: "POST", body }),
  deleteAnswer: (id: string) => call<null>(`/extension/autofill/saved-answers/${id}`, { method: "DELETE" }),
  history: () => call<HistoryEntry[]>("/extension/autofill/history?limit=100"),
  addHistory: (body: Record<string, unknown>) => call<HistoryEntry>("/extension/autofill/history", { method: "POST", body }),
  updateHistory: (id: string, body: Record<string, unknown>) => call<HistoryEntry>(`/extension/autofill/history/${id}`, { method: "PUT", body }),
  deleteHistory: (id?: string) => call<null>(id ? `/extension/autofill/history/${id}` : "/extension/autofill/history", { method: "DELETE" }),
  autofillEvent: (body: Record<string, unknown>) => call<null>("/extension/autofill/events", { method: "POST", body }),
};
