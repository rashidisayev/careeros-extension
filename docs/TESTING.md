# CareerOS Companion — Testing

Four layers, from fast to real. CI-safe layers use local fixture pages only. No test loads
LinkedIn, Indeed or any other live job site.

| Layer | Command (in this folder) | Needs | What it proves |
|---|---|---|---|
| Unit | `pnpm test` | Nothing | Extraction, auth, HTTP, message validation, policy, settings, review form, AutoFill (detection, classification, plan, filling, undo, history entries, dates, ATS adapters, list widgets, files, answers, the form watcher, the review panel) |
| Live API | `pnpm test:live` | Running stack at `localhost:3000` | The extension's API client against the real API and worker |
| Browser (e2e) | `pnpm test:e2e` | Running stack; Playwright Chromium | The built extension in Chromium: connect window, popup, side panel, save, duplicates, AutoFill |
| Backend | `docker compose run --rm -e ENVIRONMENT=test api pytest tests/test_extension.py` | Postgres, Redis | The API additions, including security and tenant isolation |

Type checking: `pnpm typecheck`. Visual and accessibility review: Impeccable on rendered
snapshots (below).

## Results (2026-11-05, with AutoFill Phases 1 to 3)

| Suite | Result |
|---|---|
| Extension unit (Vitest, jsdom, fake-indexeddb) | **342 passed**, 14 files |
| Extension live API | **8 passed** |
| Extension browser (Playwright 1.64, Chromium, unpacked `dist-e2e`) | **9 passed** |
| Backend, full suite | **505 passed, 3 skipped** (including 54 in `tests/test_extension.py` and 33 in `tests/test_extension_autofill.py`); `tests/test_analytics_dashboard.py` is run outside the container because it needs `deploy/` |
| Type and lint checks | Extension `tsc` clean; web `tsc` clean; `ruff` clean |
| Builds | Chrome production, Edge production |

Not rerun for AutoFill Phases 2 and 3: web unit tests and `eslint` (no web code changed
besides the regenerated API types), the Chrome Web Store zip, and Impeccable (last run:
0 findings, 1 advisory, with Phase 1).

## Unit tests (`test/unit`)

| File | Tests | Covers |
|---|---|---|
| `extraction.test.ts` | 30 | Every fixture page: fields, provenance, detection confidence, JSON-LD over adapters over meta, salary only from `baseSalary`, gender markers removed from titles, size limits, data minimisation, restricted and non-http URLs return nothing |
| `shared.test.ts` | 58 | Message validation (hostile shapes dropped), trusted senders, restricted platforms and posting URLs, settings migrations and downgrades, CareerOS paths only, version comparison, log redaction |
| `auth.test.ts` | 19 | PKCE (RFC 7636 example), connect URL, redirect parsing (wrong origin or path, state mismatch, `access_denied`, malformed codes), a closed window is "cancelled", token storage and expiry, refresh de-duplication and rotation, 401 → forgotten, network errors keep the session, disconnect with and without the server |
| `tabs.test.ts` | 12 | Page kinds, restricted pages never scripted (posting URLs looked up, feeds and profiles not), no access, CareerOS itself, lookup failures; imports from the capture (not a server fetch), restricted refusal with instructions, selected text from a restricted page saved as pasted text, a failed popup save recorded for the panel |
| `http.test.ts` | 9 | Headers and no cookies, error envelope, `Retry-After` on 429, GET-only retries, timeouts, one refresh on 401, shared in-flight GETs, session-ended broadcast, capture body |
| `autofill-classifier.test.ts` | 58 | English and German labels from the brief, `autocomplete`, names and ids (camelCase, brackets, ATS prefixes), placeholders and ARIA, ambiguity ("Company" is a suggestion), salutation by its options, skill-specific experience questions, preferences, full/first/last name, phone country code, newsletter boxes, fields about other people, open questions, every sensitive and legal question, lexicon merging and adding a language |
| `autofill-plan.test.ts` | 28 | Each form fixture end to end: which forms are application forms, what is filled, confirmed, asked or kept, option matching (countries, ranges, yes/no), derived values, repeated fields, references, exclusions and categories, values that don't fit, unclear labels, missing profile fields |
| `autofill-executor.test.tsx` | 12 | Writing text, selects, numbers, radios with the right events; never submitting or clicking; origin check; missing fields and options; keeping existing values and user edits; undo (all and per field); a React-controlled form's state updates |
| `autofill-background.test.ts` | 33 | Allowed pages (restricted platforms, non-web pages, restricted frames), feature switches, scan and fill through mocked `chrome.scripting`, page-changed refusal, undo and done, message validation of fill requests, no profile data in storage or logs, settings migration, clearing local data |
| `autofill-history.test.ts` | 41 | Sections (by name and heading; "Current job title" under "Experience"), dates (formats, month and year lists, the assumed day), roles and schools per entry, the current role, more roles than the form shows, the history category off, an older server, job preferences and the salary target only as suggestions, saved answers (and never for an excluded field), skills and languages, open questions, documents (accept lists, the default CV, the job's own), the 11 vendors' hosts, embedded forms, adapter evidence, sensitive fields on an ATS, Workday's experience step |
| `autofill-widgets.test.ts` | 15 | List widgets (opening, typing and waiting for a loaded list, no match, never typed into as text, undo reports "manual"), multi-selects and checkbox groups (fill and undo), files (name, type and content, `accept`, unavailable file, an attached file kept unless ticked), the form watcher (one note after a burst, nothing for text changes, nothing before a scan) |
| `autofill-background-phase2.test.ts` | 15 | Documents fetched only for file fields and downloaded only on Fill, no documents feature, counts without names, one history entry per application across steps, history off, a deleted entry, deleting the history, answers (what is sent, consent, another site), saving an answer, message validation (answers, file references and names, picks, options), the changed-form relay only from this extension's tabs |
| `autofill-panel.test.tsx` | 6 | The review: the CV unticked with its picker, role labels, a draft that stays unticked with its issues, the consent hint, nothing offered by an older server, an answer typed in the panel filled and saved only after the fill, the next step offered after new fields appear |
| `review.test.tsx` | 6 | Prefill and default stage, validation matching the API, empty values sent as null, provenance tags, the duplicate panel offers only open or separate (never update), focus moves to the first invalid field |

### Fixture pages (`test/fixtures/pages`)

`jsonld-basic`, `jsonld-graph` (`@graph`, `mainEntity`), `microdata`, `greenhouse`, `lever`,
`workday`, `generic` (no structured data), `not-job` (a blog post), `listing` (several
postings), `malformed` (broken JSON-LD), `wrong-metadata` (meta tags that contradict the
posting), `missing-fields`, and `malicious`:

- prompt-injection text, both visible and hidden;
- a 300,000-character string and deeply nested JSON-LD;
- `__proto__` keys;
- a password field and a form;
- an escaped `<\/script>` inside JSON-LD.

The fixtures are hand-written to match each vendor's public markup and contain no real
personal data.

### Form fixtures (`test/fixtures/forms`)

`simple-en`, `simple-de` (German labels, Anrede, PLZ, ranges), `ambiguous` (bare "Company",
"Name", unlabelled fields), `repeated` (references and an emergency contact),
`greenhouse-form`, `greenhouse-job-boards` (comboboxes, a phone country picker with a search box), `lever-form`, `workday-form` (`data-automation-id`, a separate phone
country code), and `unsupported` (search, newsletter and login forms only).

Phases 2 and 3: `history-generic` (two roles, a school, preferences, files, an open
question), `workday-experience` (Workday's "My Experience" step), `greenhouse-embed` (a
Greenhouse form on a company site, with an education block), `widgets` (a list button and a
search combobox whose list loads after typing), `steps` (a two-step form, used by the e2e
test), and one per remaining vendor: `ats-ashby`, `ats-smartrecruiters`, `ats-personio`,
`ats-recruitee`, `ats-workable`, `ats-teamtailor`, `ats-icims`, `ats-successfactors`. The
vendor fixtures follow each vendor's public form markup (field names and ids), simplified.
Their scripts run in jsdom and in Chromium.

## Live API tests (`test/live/backend.test.ts`)

They run only with `CAREEROS_LIVE=1` (set by `pnpm test:live`). They register a throwaway
account, connect through the real PKCE flow (the website's authorize call is made with that
account's cookie session), and then:

1. connect and get an extension session;
2. read bootstrap: features from the server, the restricted list equal to the extension's;
3. import a fixture page's capture through the real worker, without fetching anything;
4. look up the saved job's status;
5. refuse a duplicate unless `allow_duplicate`, leaving the existing application unchanged;
6. refuse a restricted capture, but accept selected text;
7. rotate the refresh token;
8. disconnect, after which the server refuses the old tokens.

The account is deleted afterwards through the normal account-deletion endpoint.

## Browser tests (`test/e2e/extension.spec.ts`)

`pnpm test:e2e` builds `dist-e2e` (development build, plus `http://127.0.0.1/*` host access
for the fixture server) and loads it into Playwright's Chromium with `--load-extension`
(headless, `channel: "chromium"`). The tests run serially against one throwaway account,
which is deleted at the end:

1. The extension loads with the expected id and permissions, and without errors.
2. Not connected: the popup offers to connect.
3. Connect through the CareerOS website: the real `chrome.identity` window, login form,
   **Connect**.
4. Read a fixture job page, review it in the side panel (tags, an edit marked *Edited*),
   save it, and see "Already in your applications" in the panel and popup. Saving again shows
   "You may already be tracking this job" with only *Open the existing application* and
   *Save as a separate application*.
5. A page that isn't a job says so and sends nothing.
6. AutoFill on an English form, with the Career Profile set through the API: the popup's
   counts, the review (values, sensitive questions listed, a value edited), *Fill 11
   fields*, the page's values and outlines, consent, salary and legal fields left empty, no
   request sent by the page, then *Undo AutoFill*, which keeps a value the user corrected.
7. AutoFill on a German form: salutation, date of birth, nationality, salary and start date
   left empty; *Done* removes the outlines.
8. AutoFill settings: excluding a field is saved; with AutoFill off, the side panel doesn't
   offer it.
9. AutoFill on a two-step form, with two roles, a degree and a CV uploaded to CareerOS: the
   review shows the roles per entry and the CV and the country list unticked; after ticking
   them, the page holds both roles, the start date as MM/YYYY, "Germany" picked in the list
   widget, and the CV attached as a real file. After *Next*, the panel shows *New fields on
   the page*; *Fill this step* fills the school and graduation year and leaves the degree
   suggestion and the open question empty. Nothing is submitted, and Options shows one
   history entry for both steps, with the file name and no values.

Screenshots of each state (dark and light) are written to `test-results/screens`, and
rendered HTML snapshots to `test-results/snapshots`.

## Impeccable

Impeccable can't open `chrome-extension://` pages, so the e2e run saves rendered snapshots,
and they are served over HTTP and checked:

```sh
cd test-results/snapshots && python3 -m http.server 8765 &
npx impeccable detect http://127.0.0.1:8765/<snapshot>.html …
```

The last run had 0 anti-patterns, after raising tag text from 0.7rem to 12 px. One advisory
remains: the popup's type hierarchy is flat (few sizes in a 360 px surface). It was kept
deliberately.

## Manual checks before a release

Automated tests don't cover the browser chrome around the extension:

- [ ] Toolbar click and `Alt+Shift+J` open the popup; the shortcut can be changed in
      `chrome://extensions/shortcuts`.
- [ ] Context menus on a page and on selected text open the side panel and start the import.
- [ ] Side panel follows tabs; it stays on its tab during a review.
- [ ] *Read this site automatically* shows Chrome's permission prompt for that one site;
      *Stop* removes it; Options lists it.
- [ ] A restricted posting (open a LinkedIn job manually): no page reading, status lookup,
      *Save selected text* works.
- [ ] Edge: the same, from `dist-edge` loaded in `edge://extensions`.
- [ ] Keyboard only: every action is reachable, focus is visible, Escape closes dialogs.
- [ ] Light and dark themes in popup, side panel and options.
- [ ] AutoFill on one real application form per ATS you rely on (by hand, never in CI):
      the review is right, nothing is submitted, undo works. For Workday, also the "My
      Experience" step and a CV upload; for Greenhouse, the education block.
