# CareerOS AutoFill

Status as of 2026-11-05: **Phases 1, 2 and 3 implemented and verified** in the extension
and the CareerOS API (tests below). Phase 1 runs on career.isayev.app. Phases 2 and 3 are
not deployed and not committed. AutoFill fills job application forms from the user's Career
Profile in CareerOS. The user reviews every value first and submits the application
themselves.

Rules that hold in every phase:

- **Never submits.** AutoFill writes field values and nothing else. It never clicks submit
  or "next", and never presses Enter in a form.
- **One source of truth.** Values come from the Career Profile through the API. The extension
  has no profile database of its own, and does no application management of its own.
- **Never guesses sensitive or legal answers.** These are always left to the user: work
  authorisation, visa, citizenship, nationality, date of birth, gender and salutation,
  disability, veteran status, ethnicity, criminal record, current salary, notice period,
  start date and consent boxes. AutoFill offers a value for one of them only when the user
  typed it in the review and ticked *Remember for other applications*. It is then offered
  unticked on later forms.
- **Suggestions are never ticked for the user.** Job preferences (expected salary from the
  target, relocation, remote work, employment type), saved answers, CVs and cover letters,
  list choices and AI drafts all start unticked.
- **Review before filling.** Nothing is written until the user presses *Fill N fields*.
  Every value can be edited or unticked before that.
- **The user's input wins.** AutoFill keeps a value already on the page unless the user
  chooses to overwrite it. It never rewrites a field the user changed after AutoFill. Undo
  restores the previous values and keeps the user's own corrections.
- **Restricted platforms** (LinkedIn, Indeed, XING, StepStone, Glassdoor, Monster) are
  never read or filled.

## Implementation plan

| Phase | Scope | Status |
|---|---|---|
| **1** | Career Profile mapping, generic form detection, English and German labels, personal and professional fields and links, confidence rules, review, field and category exclusions, undo, highlights, settings | **Done**, deployed |
| **2** | Employment and education history (repeating entries, dates in the form's format), list widgets and multi-selects, ATS adapters for 11 vendors, multi-step forms (the page is watched for new fields), CV and cover letter attachment from CareerOS, answers typed in the review | **Done**, not deployed |
| **3** | Suggested answers to open questions (AI, with consent, drafts never ticked), saved answers (only when the user ticks *Remember*), job preferences and salary target as suggestions, answer language, length and tone, AutoFill history, usage counts | **Done**, not deployed |

### Product decision: suggested answers (Phase 3)

The brief left this open. It was decided as follows, and the code enforces each point:

1. **Grounded in the profile only.** The prompt (`form-answers-1`) gets the Career Profile
   facts and the job (the tracked application, else the posting text the side panel read,
   else the title). It is told not to invent anything. The server checks each draft:
   numbers and skills that aren't in the profile, or a length over the field's limit, are
   returned as `issues`, and the panel shows them as warnings under the draft.
2. **Salary, legal and personal questions are never drafted.** The server declines any
   question that matches its sensitive pattern (salary, visa and work permit, citizenship,
   health and disability, criminal record, gender, ethnicity, religion, age, marital status
   and others, in English and German). These questions are never sent to the model. In the
   extension, only open questions and unrecognised long text fields are offered for drafting.
3. **Consent required.** Drafting needs AI enabled on the server and the user's AI consent
   (`features.autofill_answers`). Without consent the review explains how to allow it.
4. **Drafts are never ticked.** A draft lands in the answer box, unticked, marked "Drafted
   by CareerOS from your profile". The user reads it, edits it and ticks it.
5. **Saved only on request.** An answer is kept in CareerOS only when the user ticks
   *Remember for other applications*, and only after it was filled. Options lists the saved
   answers and lets the user delete them.

### Backend capabilities: what was missing, and what was added

The existing Career Profile held no contact details an application form needs. For Phase 1,
these were added:

| Added | Where |
|---|---|
| `given_name`, `family_name`, `preferred_name`, `phone`, `street_address`, `postal_code`, `github_url`, `portfolio_url` on `career_profiles` (nullable, validated: phone 6–15 digits, postal code normalised, URLs http(s)) | Migration `20261105_4f8d2b6e1a37_autofill_contact_details.py`, `app/career_profiles/*` |
| The same fields in the profile editor ("Contact details for applications", GitHub and Portfolio links) | `apps/web/features/profile/summary-form.tsx` |
| `GET /extension/autofill-profile`: a read-only, flat view of the profile for AutoFill, with each value marked `explicit` or `derived`. It is rate-limited (`extension_autofill_per_hour`, default 600), returned with `Cache-Control: no-store`, and never creates a profile | `app/extension/router.py`, `service.py`, `schemas.py` |
| `features.autofill` in bootstrap, the switch for the feature | `features_for()` |

For Phases 2 and 3 (`app/extension/autofill.py`, migration
`20261105_b3d9e6a1c4f2_autofill_answers_history.py`):

| Added | What it does |
|---|---|
| `GET /extension/autofill-profile` extended | Adds `experiences` (newest first: company, title, location, start and end month, current), `education` (institution, degree, field, start and graduation year), `skills`, `languages`, `certifications`, `preferences` (relocation, remote, employment types, locations, salary minimum and target, currency) and `saved_answers`. Older extensions ignore the new keys |
| `POST /extension/autofill/documents` | The documents CareerOS can attach for a page: ready tailored CVs and cover letters for the tracked application (the newest of each kind is recommended, "Prepared for …"), then the uploaded CVs (PDF, DOCX). Also returns the tracked application for the URL (same link or same posting) |
| `GET /extension/autofill/documents/{resume\|generated}/{id}/file?format=pdf\|docx` | Streams one owned document, at most `extension_document_max_bytes` (10 MB). Generated documents are rendered on request. `Cache-Control: private, no-store`; audited as `resume.downloaded` or `document.exported` with `via=extension_autofill` |
| `POST /extension/autofill/answers` | Drafts answers, 1–10 questions per call (see the decision above). Rate limit `extension_answers_per_hour` (30). Errors: `ai_unavailable`, `ai_consent_required`, `profile_empty`, `ai_failed`. Usage is recorded as `autofill_answers` |
| `GET`, `POST /extension/autofill/saved-answers`, `DELETE /…/{id}` | Saved answers (`autofill_saved_answers`): by field key (for the reusable keys) or by question; at most 200 per user; a second save of the same key or question updates it |
| `GET`, `POST /extension/autofill/history`, `PUT`, `DELETE /…/{id}`, `DELETE /extension/autofill/history` | History entries (`autofill_sessions`): site, ATS, company, job title, application, counts of filled, confirmed and asked fields, and the names of attached files. No form values. At most 500 per user (oldest dropped) |
| `POST /extension/autofill/events` | Usage counts: `form_detected`, `filled`, `no_form`, `document_attached`, with the ATS and numbers only. They follow the user's analytics opt-out |
| Feature flags | `autofill_documents`, `autofill_answers` (off without AI or consent, with the reason), `autofill_saved_answers`, `autofill_history`. The extension shows each part only when its flag is on. Against an older CareerOS without these flags it behaves like Phase 1: no documents, drafts, *Remember* or history, and no Options sections for them |
| Privacy | Saved answers and history are in the privacy export and are deleted with the account |

Still not filled: date of birth and nationality are not stored in the profile. They are
sensitive anyway, so AutoFill offers them only from an answer the user saved.

## How it works for the user

1. On an application form, open the extension (icon, `Alt+Shift+J`, or the side panel).
   The **CareerOS AutoFill** card shows the counts: *19 fields detected · 11 ready to fill ·
   1 needs your confirmation · 7 need your input*.
2. **Fill application** opens the review in the side panel. It has five groups: *Ready to
   fill* (ticked), *Please confirm* (unticked suggestions), *Already filled in on the page*,
   *Needs your input* (with the reason, e.g. "Sensitive or legal. CareerOS never fills this;
   answer it yourself."), and *Left alone*. Each value is editable. *Never fill X* adds a
   field to the exclusions.
3. **Fill N fields** writes only the ticked values. Filled fields get a solid teal outline;
   fields still to answer get a dashed amber outline.
4. The result lists what is still to answer and any field that couldn't be filled. It offers
   **Undo AutoFill** (all fields, or one field at a time) and **Done**, which removes the
   outlines.

In the review (Phases 2 and 3):

- **Work history and education** appear per entry ("Employer · role 2", "Degree · school
  1"). The current role's end date is left empty, and only its "I currently work here" box is
  ticked. If the form shows fewer entries than the profile, the review says how many more
  there are; the user adds entries on the page and AutoFill offers them on its next check.
- **List widgets** (Workday, Greenhouse react-select, other `role=combobox` or
  `aria-haspopup=listbox` controls) are filled by opening the list, typing to filter when the
  widget is a search box, and clicking the matching entry. The entry must have the same
  words, or be the only entry containing them. Otherwise nothing is picked. These are
  suggestions to confirm.
- **CVs and cover letters**: a file field shows the document CareerOS suggests (prepared for
  this job, else the default CV from Options, else the newest), with a picker and a format
  choice that respects the field's `accept`. The file is downloaded only when the user fills,
  and a file already on the form is replaced only if the user ticks it.
- **Questions left to the user** can be answered right in the panel (*Answer here*), with
  *Remember for other applications*. Open questions get *Suggest an answer*, or *Suggest
  answers (n)* for all of them.
- **Multi-step forms**: after a fill the page is watched (30 minutes after the last check).
  When fields are added or removed, the result shows *New fields on the page* with *Fill this
  step*, which opens the review for the new step.

Settings (Options → AutoFill): turn AutoFill on or off, switch the categories (personal,
professional, links, work history and education, job preferences; job preferences are off
by default), and untick single fields. Options also holds the CV to suggest when none was
prepared for the job, the language, length and tone of suggested answers, the saved
answers (view, delete), and the history (on by default; view, delete one, delete all). The
list of fields that are never filled is shown there for transparency.

## Architecture

```
page (isolated world)                 service worker                         CareerOS API
─────────────────────                 ──────────────                         ────────────
autofill.js (injected on demand)      background/autofill.ts                 GET /extension/bootstrap
  detector: DOM → FieldDescriptor[] ──► scanTab: allowed? feature on?          (features.autofill*)
  executor: write / undo / outline      classifier + mapper + confidence   ◄─ GET /extension/autofill-profile
  watcher: fields added or removed      → planner → AutofillPlan           ◄─ POST /autofill/documents (file fields only)
    └─ "autofill.changed" ───────────► broadcast.autofill ──► side panel: "New fields on the page"
                                    ◄── fillTab(items reviewed by the user)
                                        files: GET /autofill/documents/…/file (on Fill only)
                                        history: POST/PUT /autofill/history; counts: POST /autofill/events
                                        answersTab ──────────────────────► POST /autofill/answers
```

| Module | Role |
|---|---|
| `src/autofill/detector.ts` | Finds the form controls, including inside open shadow roots. It skips hidden, disabled, read-only, password and hidden-type inputs. It records the signals for each control: label (from `labels`, `label[for]`, `aria-labelledby`, the surrounding text), placeholder, name, id, `data-*` automation ids, `autocomplete`, the section heading or legend, options, `required`, `maxlength`. Radio groups become one field. Each field gets a stable id per document (`f1`, `f2`, …). The page itself is never sent anywhere |
| `src/autofill/lexicon/{en,de}.ts` | Label vocabulary per language: exact labels, weaker labels, phrases, vetoes (e.g. "current salary" is not "salary expectation"), other-person sections (references, emergency contact), yes/no words, salutations. A new language is one file |
| `src/autofill/classifier.ts` | Scores each field against every key. Signal weights: `autocomplete` and label 1.0, context 0.92, placeholder 0.85, name/id 0.8. Levels: high ≥ 0.85, medium ≥ 0.65, low ≥ 0.45. A second key within 0.08 makes it ambiguous, which caps the level at medium. It also recognises open questions, salutation selects (by their options), fields about another person, and skill-specific experience questions ("years of experience with Kubernetes") |
| `src/autofill/mapper.ts`, `values.ts` | Turns a profile value into a value for this control: option matching for countries (English and German names, ISO codes), phone codes, experience ranges ("6–10 years", "mehr als 10 Jahre"; the narrowest matching range, never a tie), seniority, and yes/no. Also splits phone numbers when the form has a separate country code field. It reports `too_long`, `no_matching_option` or `unsupported_control` instead of truncating or guessing |
| `src/autofill/confidence.ts` | The decision for each field: high → fill. Medium, a derived value, an ambiguous label or a repeated field → confirm (unticked). Low or missing → ask. Sensitive, preference, consent, question and document keys → always ask. A value already on the page → keep. Excluded field or category → excluded |
| `src/autofill/planner.ts` | Decides which forms are application forms. It needs an identity field plus either three known fields or two profile fields and a CV field. It ignores search, newsletter and login forms. It then builds the plan and counts, and lists the profile fields missing for this form |
| `src/autofill/executor.ts` | Writes through the element's native value setter, then dispatches `input`, `change`, `blur` and `focusout`, so React, Vue and Angular forms update their state. It clicks radios and checkboxes. It checks the frame origin before writing, keeps before and after snapshots for undo and edit detection, and draws the outlines |
| `src/background/autofill.ts` | Checks that the page is allowed (http(s), not a restricted platform, every frame checked separately) and that the feature is on (settings, connection, `bootstrap.features.autofill`). It injects `autofill.js` into all frames, fetches the profile, builds the plan, and refuses to fill if the tab's origin changed since the scan (`page_changed`) |
| `src/autofill/adapters.ts` | ATS adapters for Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Personio, Recruitee, Workable, Teamtailor, iCIMS and SAP SuccessFactors. Each one lists its hosts, a marker element for forms embedded on company sites (`#grnhse_app`, `#ashby_embed`), and its field names. A field name adds evidence (weight 1.0, like a clear label). It can't override the confidence rules or the sensitive list. On a known ATS, a form step with two known fields counts as part of the application, even without a name field |
| `src/autofill/dates.ts` | What a date control asks for: a month, a year, both, or a full date, and in which format ("MM.YYYY", "MM/YYYY", `type=month`, month or year lists). It writes the profile's month in that format. A day the profile doesn't have is the 1st, marked "check the date" |
| `src/autofill/classifier.ts` (Phase 2) | Sections: a field belongs to a role or school by its name (`experience[1][title]`, `workExperience-2--jobTitle`, `school--0`) or the heading above it. Outside a section, "Company" or "From" are not read as a role's. "Current job title" under an "Experience" heading stays the applicant's own title |
| `src/autofill/planner.ts` (Phase 2) | Entry numbers (from the name or the heading, else by order), documents for file fields, saved answers, the salary target with job preferences on, `answerable` and `draftable` per item, `plan.more` (roles and schools the form doesn't show yet) |
| `src/autofill/page.ts` | The page object; the form watcher (a `MutationObserver` that waits 700 ms for quiet and reports only a changed number of controls) |
| `src/ui/autofill-view.tsx` | Summary card (popup and side panel), review (documents, list choices, answers, drafts, *Remember*), result (undo, saved answers, next step), and the "No application form on this page yet. Look again" hint |
| `src/options/main.tsx` | AutoFill settings, default CV, answer settings, saved answers, history |

Messages (validated in `src/shared/messages.ts`): `autofill.scan`, `autofill.fill` (at most
400 items; field ids `f<digits>`; values: text ≤ 10,000 characters, an option index, a
checkbox state, a list of option indexes, list-widget picks, or a file given by a CareerOS
reference `resume:<uuid>`/`generated:<uuid>`, a format and a plain file name; optional
`stats` with counts and the ATS id), `autofill.undo`, `autofill.done`, `autofill.answers`
(1–10 questions, language `en` or `de`), `autofill.savedAnswers`, `autofill.saveAnswer`,
`autofill.deleteAnswer`, `autofill.history`, `autofill.historyDelete`, `autofill.cvs`, and
`data.clear` (Options → Privacy). Pages send only `autofill.changed`, which carries nothing.

## Security and privacy

- **No new permissions.** It uses the same `activeTab` + `scripting` as job reading, injected
  only when the user opens the extension on that tab. There are no content scripts and no
  host permissions beyond CareerOS.
- **The profile is fetched per scan and held in memory only.** Nothing from the profile or
  the form is written to extension storage. The plan lives in the side panel's memory, and
  the page keeps only the before and after snapshots needed for undo, in the injected
  script's isolated world.
- **Nothing typed into the form is sent to CareerOS.** Classification runs in the service
  worker, on labels and attributes, not on values. CareerOS receives only: the question
  texts the user asks it to draft, with the job; an answer the user chose to remember; and,
  with the history on, the site, job, counts and the names of attached files.
- **Files** are downloaded by the service worker only when the user fills with them, passed
  to the page once as bytes, and attached through `DataTransfer`. They are not stored. The
  file must match the field's `accept` list (`wrong_file_type` otherwise).
- **Usage counts** contain the event, the ATS id and numbers. They contain no names,
  emails, phone numbers, salary answers, legal status or other form values, and they follow
  the CareerOS analytics opt-out.
- **The history session in the browser** (`chrome.storage.session`, cleared when the browser
  closes) holds the entry id, the origin and the counts for an open application, so later
  steps update the same entry.
- **Logs** hold counts only (fields detected, filled, asked), never values or labels. This
  is checked in `autofill-background.test.ts`.
- **Writes are bound to the page that was reviewed.** The fill request carries the origin of
  each frame. The executor refuses to write if the frame now shows another origin, and the
  service worker refuses if the tab moved to another site.
- **The server is authoritative.** `features.autofill` can switch the feature off. The
  endpoint is per user, read-only and not cacheable.

## Tests

| Suite | Result (2026-11-05) |
|---|---|
| Extension unit (Vitest) | **342 passed**, 14 files. AutoFill: classifier 58, plan 28, executor 12, background 33; Phase 2 and 3: `autofill-history` 41 (sections, dates, history entries, preferences, saved answers, documents, the 11 vendors, multi-step), `autofill-widgets` 15 (list widgets, multi-selects, checkbox groups, file attach, the form watcher), `autofill-background-phase2` 15 (documents only for file fields and only on Fill, history per application, answers, consent, message validation, the changed-form relay), `autofill-panel` 6 (drafts unticked, saving only after the fill, nothing offered by an older server, the next step); settings v1→v2→v3 migrations |
| Extension live API | **8 passed** |
| Extension browser (Playwright, Chromium, real API) | **9 passed**. The new AutoFill test runs a two-step form: two roles (dates as MM/YYYY), a list widget, a CV uploaded to CareerOS and attached to the file field in the real browser, then the second step (school, graduation year) offered after *Next*, and one history entry for both steps. Nothing is submitted |
| Backend, full suite | **505 passed, 3 skipped**; `ruff` clean. Web `tsc` clean |
| Backend `tests/test_extension_autofill.py` | **33 passed**: profile arrays, documents and file streaming (ownership, size limit), answers (consent, grounding issues, declined sensitive questions never sent to the model, context, failure, validation, rate limit), saved answers, history (step updates, trimming, foreign application ids dropped), events and opt-out, privacy export and deletion |

Form fixtures (`test/fixtures/forms`, hand-written, no real personal data): `simple-en`,
`simple-de`, `ambiguous`, `repeated` (references and an emergency contact),
`greenhouse-form`, `greenhouse-job-boards` (react-select comboboxes, a phone country picker
with a search box), `greenhouse-embed` (an embedded Greenhouse form with an education
block), `lever-form`, `workday-form` (data-automation-id, phone country code),
`workday-experience` (Workday's "My Experience" step: numbered roles, month and year
fields, a degree list widget), `history-generic` (two roles, a school, preferences, files, an
open question), `widgets` (a list button and a search combobox), `steps` (a two-step form),
`ats-ashby`, `ats-smartrecruiters`, `ats-personio`, `ats-recruitee`, `ats-workable`,
`ats-teamtailor`, `ats-icims`, `ats-successfactors`, and `unsupported` (search, newsletter
and login forms only). No test loads a live job site.

Screenshots: `test-results/screens/popup-autofill-dark.png`, `panel-autofill-*.png`
(including `panel-autofill-history-review-dark.png` and `panel-autofill-next-step-dark.png`),
`form-autofilled.png`, `options-autofill-dark.png`, `options-autofill-history-dark.png`.

## Known limitations

- **ATS adapters are checked against fixtures only.** The vendor fixtures are hand-written
  from the vendors' public form markup (field names and ids). They are simplified, and
  vendors change their markup. Greenhouse was also checked on a live posting during Phase 1;
  the other ten vendors have not been tried on a live site. An adapter that no longer
  matches only removes evidence: the generic engine still reads labels.
- **Location search boxes are not filled.** Greenhouse's "Location (City)" and similar
  fields search a remote place list. They are listed for the user, because several places
  often share a name.
- **List choices and attached files can't be undone by AutoFill.** Undo reports them as
  "change it on the page". Text, selects, radios, checkboxes and multi-selects are restored.
- **One role per entry the form shows.** AutoFill never clicks "Add another". When the
  profile has more roles or schools, the review says so, and the user adds entries.
- **The form watcher is per page.** After a full page load (some Workday steps reload), the
  user opens AutoFill again; the panel does this on its own when it follows the tab.
- **No contextual button inside the page.** AutoFill is offered in the popup and side panel.
  An in-page button would need a content script on every site, which goes against the
  minimal-permission design.
- **Closed shadow roots** can't be reached. Frames from restricted platforms inside an
  allowed page are skipped.
- **English and German** labels and suggested answers only; the UI is English.
