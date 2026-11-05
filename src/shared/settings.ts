/**
 * User settings, stored in chrome.storage.local under one versioned key. Nothing secret
 * lives here (tokens are in the background's IndexedDB vault, see background/vault.ts).
 *
 * Changing the shape: bump SETTINGS_VERSION and add a step to MIGRATIONS that turns the
 * previous version into the new one. Steps run forward in order. Unknown or invalid values
 * fall back to defaults field by field. A stored version newer than this build (after a
 * downgrade) is read leniently and never written back, so it survives the next upgrade.
 */
import { isFieldKey } from "../autofill/keys";
import { FILLABLE_CATEGORIES, type AnswerLength, type AnswerTone, type AutofillSettings, type FieldKey } from "../autofill/types";
import { APPLICATION_STATUSES, type ApplicationStatus } from "./api-types";

export const SETTINGS_KEY = "settings";
export const SETTINGS_VERSION = 3;

export type Theme = "dark" | "light" | "system";

export type Settings = {
  version: number;
  /** CareerOS defaults to dark (product decision); light and system are supported. */
  theme: Theme;
  /** Stage a saved posting starts in. */
  defaultStatus: ApplicationStatus;
  /** The side panel switches to the tab you're on (it still reads a page only where it may). */
  followTabs: boolean;
  /** Write structured diagnostics to the console (no personal data). */
  diagnostics: boolean;
  /** CareerOS AutoFill: on/off, what it may fill, history, suggested answers, default CV. */
  autofill: AutofillSettings;
};

export const DEFAULT_AUTOFILL: AutofillSettings = {
  enabled: true,
  // Job preferences are the user's to opt into: they say something about this job only.
  categories: { personal: true, professional: true, links: true, history: true, preferences: false },
  excluded: [],
  history: true,
  answers: { language: "auto", length: "medium", tone: "professional" },
  defaultCv: null,
};

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  theme: "dark",
  defaultStatus: "interested",
  followTabs: true,
  diagnostics: false,
  autofill: DEFAULT_AUTOFILL,
};

export type RawSettings = Record<string, unknown>;
export type Migration = (raw: RawSettings) => RawSettings;

/** version n -> n + 1. */
export const MIGRATIONS: Record<number, Migration> = {
  // 2: AutoFill settings, on by default with every category; nothing excluded yet.
  1: (raw) => ({ ...raw, autofill: raw.autofill ?? { enabled: true, categories: { personal: true, professional: true, links: true }, excluded: [] } }),
  // 3: history and preferences categories, AutoFill history, suggested answers, default CV.
  2: (raw) => {
    const a = raw.autofill && typeof raw.autofill === "object" ? (raw.autofill as Record<string, unknown>) : {};
    const cats = a.categories && typeof a.categories === "object" ? (a.categories as Record<string, unknown>) : {};
    return {
      ...raw,
      autofill: {
        ...a,
        categories: { ...cats, history: true, preferences: false },
        history: true,
        answers: structuredClone(DEFAULT_AUTOFILL.answers),
        defaultCv: null,
      },
    };
  },
};

const THEMES: Theme[] = ["dark", "light", "system"];

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** AutoFill settings, field by field: anything unknown falls back to the default. */
export function cleanAutofill(value: unknown): AutofillSettings {
  const v = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const cats = v.categories && typeof v.categories === "object" ? (v.categories as Record<string, unknown>) : {};
  const categories = { ...DEFAULT_AUTOFILL.categories };
  for (const c of FILLABLE_CATEGORIES) categories[c] = bool(cats[c], DEFAULT_AUTOFILL.categories[c]);
  const excluded = Array.isArray(v.excluded) ? [...new Set(v.excluded.filter(isFieldKey))].slice(0, 100) as FieldKey[] : [];
  const ans = v.answers && typeof v.answers === "object" ? (v.answers as Record<string, unknown>) : {};
  const d = DEFAULT_AUTOFILL.answers;
  const answers = {
    language: pick(ans.language, ["auto", "en", "de"] as const, d.language),
    length: pick<AnswerLength>(ans.length, ["short", "medium", "long"], d.length),
    tone: pick<AnswerTone>(ans.tone, ["professional", "concise", "warm", "executive"], d.tone),
  };
  const defaultCv = typeof v.defaultCv === "string" && /^resume:[0-9a-f-]{36}$/i.test(v.defaultCv) ? v.defaultCv : null;
  return { enabled: bool(v.enabled, DEFAULT_AUTOFILL.enabled), categories, excluded, history: bool(v.history, DEFAULT_AUTOFILL.history), answers, defaultCv };
}

/** JSON with sorted keys: storage may return keys in another order than they were written. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : val,
  );
}

export type MigrationResult = { settings: Settings; changed: boolean; writable: boolean };

export function migrateSettings(
  stored: unknown,
  migrations: Record<number, Migration> = MIGRATIONS,
  target: number = SETTINGS_VERSION,
): MigrationResult {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { settings: { ...DEFAULT_SETTINGS, version: target }, changed: true, writable: true };
  }
  let raw: RawSettings = { ...(stored as RawSettings) };
  const storedVersion = Number.isInteger(raw.version) ? (raw.version as number) : 0;
  const writable = storedVersion <= target;
  for (let v = Math.max(storedVersion, 0); v < target; v++) {
    const step = migrations[v];
    raw = step ? step(raw) : raw;
  }
  const settings: Settings = {
    version: writable ? target : storedVersion,
    theme: pick(raw.theme, THEMES, DEFAULT_SETTINGS.theme),
    defaultStatus: pick(raw.defaultStatus, APPLICATION_STATUSES, DEFAULT_SETTINGS.defaultStatus),
    followTabs: bool(raw.followTabs, DEFAULT_SETTINGS.followTabs),
    diagnostics: bool(raw.diagnostics, DEFAULT_SETTINGS.diagnostics),
    autofill: cleanAutofill(raw.autofill),
  };
  const changed = canonical(settings) !== canonical(stored);
  return { settings, changed, writable };
}

export async function loadSettings(area: chrome.storage.StorageArea = chrome.storage.local): Promise<Settings> {
  const stored = (await area.get(SETTINGS_KEY))[SETTINGS_KEY];
  const { settings, changed, writable } = migrateSettings(stored);
  if (changed && writable) {
    // Every extension page reads settings; write the upgraded copy back only if nobody saved
    // in the meantime, so a page holding an old copy can't undo a newer change.
    const now = (await area.get(SETTINGS_KEY))[SETTINGS_KEY];
    if (canonical(now) === canonical(stored)) await area.set({ [SETTINGS_KEY]: settings });
    else return migrateSettings(now).settings;
  }
  return settings;
}

export async function saveSettings(
  patch: Partial<Settings>,
  area: chrome.storage.StorageArea = chrome.storage.local,
): Promise<Settings> {
  const current = await loadSettings(area);
  const { settings } = migrateSettings({ ...current, ...patch, version: SETTINGS_VERSION });
  await area.set({ [SETTINGS_KEY]: settings });
  return settings;
}
