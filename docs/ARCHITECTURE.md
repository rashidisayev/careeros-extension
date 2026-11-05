# GetCareer Companion — Architecture

GetCareer Companion is the GetCareer browser extension for Chrome and Edge (Manifest V3). It
saves the job posting on the current page to GetCareer and shows whether you already track
it. It holds no data of its own: every job, application, match and duplicate comes from the
GetCareer API and goes through the same code the website uses.

Code: this project, `~/Desktop/careeros-extension` (the extension). The server side lives in the
GetCareer repo, `~/Desktop/careeros`: `apps/api/app/extension` and `apps/api/app/auth/extension*.py`
(API additions), `apps/web/app/(auth)/connect/extension` and `apps/web/features/extension`,
`apps/web/features/settings/extension-card.tsx` (website additions).

## Overview

```
 Job page (untrusted)            Extension                              GetCareer
 ───────────────────   ┌──────────────────────────────────┐   ┌───────────────────────────┐
                       │ popup / side panel / options      │   │ Next.js (apps/web)        │
                       │   React 19, no network access     │   │  /connect/extension       │
                       │        │ chrome.runtime messages  │   │  /settings (sessions)     │
                       │        ▼                          │   │  /api/v1 → FastAPI        │
  DOM ◀─ extractor.js ─┤ service worker (background.js)    ├──▶│ FastAPI (apps/api)        │
   injected on demand  │  auth, tokens, API client, tab    │   │  /auth/extension/*        │
   returns a capture   │  state, imports, context menus    │   │  /extension/bootstrap     │
                       │        │                          │   │  /extension/lookup        │
                       │  IndexedDB vault (refresh token)  │   │  /job-imports (capture)   │
                       │  storage.session (access token,   │   │ Celery worker: import     │
                       │  tab state) storage.local (prefs) │   │  pipeline, AI, matching   │
                       └──────────────────────────────────┘   └───────────────────────────┘
```

Three rules shape the design:

1. **The API is authoritative.** The extension reads the page and shows results; the API
   validates the capture again, extracts and normalises the job, runs matching, detects
   duplicates, creates the application and decides which features are on. The extension
   never decides access, never computes a match and never writes an application directly.
2. **Nothing runs on a page until the user asks.** There is no persistent content script.
   The extractor is injected with `chrome.scripting.executeScript` when the popup or side
   panel opens on a tab (the `activeTab` grant from the click or shortcut), or on a site the
   user granted access to. It reads the DOM, returns one JSON object and leaves nothing behind.
3. **Only the service worker talks to the API.** UI pages send typed messages to the
   service worker; they never see tokens. The extractor has no access to the API, tokens or
   extension storage.

## Components

| Part | Files | Role |
|---|---|---|
| Service worker | `src/background/*` | The only part with tokens and network access. Message router, auth (PKCE connect, refresh, disconnect), API client, per-tab state, imports, context menus, side panel |
| Extractor | `src/content/extractor.ts` → `extractor.js` (IIFE) | Injected into the page on demand; runs `extractPage(document, location.href)` from `src/extraction` and returns a `PageCapture` |
| Extraction | `src/extraction/*` | Pure functions over a `Document`: JSON-LD/microdata, meta tags, site adapters, readable text, job-page detection. Unit-tested against fixture pages in jsdom |
| Popup | `src/popup/main.tsx` | 360 px summary of the current tab: connect, status of a job you track, save, open the side panel |
| Side panel | `src/sidepanel/main.tsx` | The full flow: preview, progress, review and edit, duplicates, save, the saved state, pasted text, per-site access |
| Options | `src/options/main.tsx` | Account and disconnect, theme, default stage, follow tabs, AutoFill settings (categories, fields, default CV, answer language, length and tone, saved answers, history), site access list, privacy, clear local data, diagnostics |
| AutoFill | `src/autofill/*`, `src/content/autofill.ts` → `autofill.js` (IIFE), `src/background/autofill.ts`, `src/ui/autofill-view.tsx` | Fills application forms from the Career Profile after review: personal details, work history and education, list widgets, CVs and cover letters from GetCareer, saved and suggested answers, multi-step forms, on any site and with adapters for 11 ATS vendors. The detector, executor and form watcher run in the page; the classification, mapping and plan run in the service worker. See [AUTOFILL.md](AUTOFILL.md) |
| Shared | `src/shared/*` | Message contract (`messages.ts`), API types, restricted-platform policy, settings with migrations, redacting logger, build config |
| UI kit | `src/ui/*` | Components, hooks and views shared by popup and side panel, styled with the GetCareer tokens |

## Saving a job, step by step

1. The user opens the popup (toolbar button or `Alt+Shift+J`) or the side panel. The UI asks
   the service worker for `tab.state`.
2. The service worker classifies the tab (`src/background/tabs.ts`):
   - `careeros`: a GetCareer page. `unsupported`: not http(s), or a browser page.
   - `restricted`: LinkedIn, Indeed, Glassdoor, XING, StepStone or Monster. Not scripted.
   - `no_access`: no `activeTab` grant and no site permission.
   - Otherwise it injects the extractor and scores the result: `job`, `maybe_job` or `not_job`.
3. For `job`, `maybe_job` and restricted posting URLs it calls `POST /extension/lookup`
   (when connected) to show the tracked application, the catalog job and its match, or a
   pending import. The result is cached per tab for 2 minutes in `chrome.storage.session`.
   Lookups never run in the background for pages the user didn't open the extension on.
4. **Save job** (user action) sends the capture to `POST /job-imports {capture}`. The API
   validates it and the Celery worker runs the normal import pipeline: catalog match first,
   then JSON-LD, site-adapter fields, meta tags and the page text; AI extraction only with
   the user's consent; matching preview; duplicate detection.
5. The side panel polls `GET /job-imports/{id}` every 1.2 s and shows the steps the worker
   reports. When the import is `ready`, it shows the review form, with each field tagged by
   where it came from.
6. **Save application** sends the reviewed values to `POST /job-imports/{id}/save`. A
   possible duplicate returns 409 `possible_duplicate`. The panel then offers only *Open the
   existing application* or *Save as a separate application*, which sends
   `allow_duplicate: true`. The existing application is never changed.
7. The saved state links to the application in GetCareer. The tab's lookup is refreshed so
   the popup shows the new status at once.

Selected text and pasted text use the same import (`{text}`). A link alone uses `{url}`, and
the server fetches it with its SSRF-safe fetcher, exactly as on the website.

## State and storage

| Data | Where | Lifetime |
|---|---|---|
| Refresh token, session id, user summary | IndexedDB `careeros-vault` in the service worker's origin | Until disconnect, sign-out or 401 on refresh |
| Access token (15 min) | `chrome.storage.session` key `auth.access` (`{token, expiresAt}`) | Browser session; renewed 60 s before expiry |
| Bootstrap (features, capabilities) | `chrome.storage.session` | 5 minutes |
| Per-tab state (capture summary, lookup, import id, last error) | `chrome.storage.session` key `tab.<id>` | Until the tab navigates or closes |
| Settings (theme, default stage, follow tabs, diagnostics, AutoFill switches and excluded fields, history on or off, answer language, length and tone, default CV reference) | `chrome.storage.local` key `settings`, versioned with migrations (version 2 adds `autofill`; version 3 adds the history and job-preference categories, `history`, `answers` and `defaultCv`). A page writes an upgraded copy back only if storage still holds what it read | Persistent |
| AutoFill: Career Profile values and the plan | Memory of the service worker call and the side panel | One scan; never stored |
| AutoFill: before and after values for undo | The injected script's isolated world in the page | Until the page unloads or *Done* |
| AutoFill: documents and drafted answers | Memory of the service worker call (files) and the side panel (drafts) | One fill or one review; never stored |
| AutoFill: the open application's history entry (id, origin, counts, file names) | `chrome.storage.session` key `af.session.<tabId>` | 2 hours per application, or until the browser closes |
| Diagnostics log | Memory, last 100 entries, redacted | Service worker lifetime |

`chrome.storage.session` is restricted to trusted extension contexts (the default), so an
extractor running in a page can't read it. The service worker can stop at any time (MV3);
everything it needs again lives in these stores, not in memory.

## Messages

UI pages and the service worker talk through `chrome.runtime.sendMessage` with the typed
contract in `src/shared/messages.ts`: `session.*`, `tab.state`, `import.*`,
`application.get`, `app.open`, `settings.*`, `site.accessChanged`, `diagnostics.get`,
`autofill.scan`, `autofill.fill`, `autofill.undo`, `autofill.done`, `autofill.answers`,
`autofill.savedAnswers`, `autofill.saveAnswer`, `autofill.deleteAnswer`, `autofill.history`,
`autofill.historyDelete`, `autofill.cvs`, `data.clear`. The
router (`src/background/router.ts`) accepts a message only if the sender is this extension
and its URL is one of the extension's own pages (`isTrustedSender`); content scripts and
web pages are refused. Every request is parsed and validated (`parseRequest`) before a
handler runs. The one exception is `autofill.changed` from the AutoFill page script: a
separate listener accepts it only from this extension's injected script in a tab, it
carries nothing, and it only triggers `broadcast.autofill` for that tab. The service worker
pushes changes to open pages with `broadcast.tab`, `broadcast.session`,
`broadcast.settings` and `broadcast.autofill`.

## API additions

Smallest additions to the existing API, documented in [API_INTEGRATION.md](API_INTEGRATION.md):

- `/auth/extension/*`: the PKCE code flow, refresh, sessions list and disconnect. It reuses
  `user_sessions` (new columns `client`, `client_name`) and the existing JWT and
  refresh-rotation code (`start_session`, `rotate_session`).
- `GET /extension/bootstrap`: user, capabilities, feature switches, restricted platforms,
  minimum extension version.
- `POST /extension/lookup`: a URL's canonical form and platform, tracked applications that
  match it (same link, same posting id, same company and role), the catalog job and its
  match, and a pending import.
- `POST /job-imports` accepts `capture` (new `job_imports.capture` JSONB column) and runs it
  through the existing import pipeline (`_from_capture`).

- `GET /extension/autofill-profile`: the Career Profile as flat values marked `explicit` or
  `derived`, for AutoFill; new contact columns on `career_profiles`. Phase 2 and 3 add the
  roles, schools, skills, languages, certifications, job preferences and saved answers.
- `/extension/autofill/*` (Phases 2 and 3): documents and file download, suggested answers,
  saved answers (`autofill_saved_answers`), history (`autofill_sessions`) and usage events.

Migrations: `20261103_7c2e5a91b4d0_browser_extension.py`,
`20261105_4f8d2b6e1a37_autofill_contact_details.py`,
`20261105_b3d9e6a1c4f2_autofill_answers_history.py`.

## Build

Vite 8 builds three bundles (`scripts/build.mjs`):

- **Pages:** `popup.html`, `sidepanel.html` and `options.html` (React, Tailwind v4, Hanken
  Grotesk bundled locally).
- **`background.js`:** an ES module service worker.
- **`extractor.js`** and **`autofill.js`:** self-contained IIFEs (`vite.extractor.config.ts`,
  selected by `EXT_PAGE_SCRIPT`). They are injected as files, never as strings, so no code is
  evaluated from page data.

The manifest is generated per build (`scripts/manifest.mjs`), which fixes the GetCareer
origin. Production defaults to `https://getcareer.io`; development uses
`http://localhost:3000`. The same origin is used for `host_permissions`, the CSP
`connect-src` and the API base URL, so tokens can only ever be sent to it. Development builds
carry a public `key` for a stable extension id. Store builds don't.

## Related decisions (ADR log in docs/ARCHITECTURE.md)

36. The extension connects with a PKCE code flow into the existing session system.
37. Page captures go through the job import pipeline; the server re-validates everything.
38. Restricted platforms are never read automatically, also not by the extension.
39. The refresh token lives only in the service worker's IndexedDB.
40. AutoFill reads the Career Profile through the API per scan and never stores it, and
    sensitive and legally relevant questions are recognised but never filled. It is offered
    from the popup and side panel, not by a content script on every page.
41. AutoFill Phases 2 and 3: ATS adapters only add evidence to the generic engine (they
    can't fill what the rules leave to the user). List widgets are filled by clicking a
    matching entry, never by typing into them. Files come from GetCareer only on Fill and only
    for a ticked file field. Suggested answers are drafted on the server from the profile and
    the job only, never for salary, legal or personal questions, need AI consent, and are
    never ticked for the user. Answers are saved only when the user ticks *Remember*. The
    history holds counts and file names, not form values. Each part has its own feature flag,
    so an older server gets Phase 1 behaviour.
