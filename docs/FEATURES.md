# GetCareer Companion — Features

Status as of 2026-11-05, version 0.1.0 (Phase 1, MVP, plus AutoFill Phases 1 to 3; AutoFill Phases 2 and 3 are not deployed). "Verified" means covered by automated
tests, including browser tests in Chromium against the real GetCareer API and worker
([TESTING.md](TESTING.md)). Nothing listed here is a mock-up.

## Phase 1 — implemented

| Feature | Where | Verified by |
|---|---|---|
| Connect to a GetCareer account (password or Google) through the website, with PKCE | Popup, side panel, options | e2e (real `chrome.identity` window, real login), live, unit |
| Disconnect (this extension, or any extension from the website's settings) | Options, web `/settings` | live, web unit |
| Detect job pages: JSON-LD, microdata, meta tags, Greenhouse / Lever / Workday / SmartRecruiters adapters, generic reader; `job` / `maybe_job` / `not_job` | Popup, side panel | unit (13 fixture pages), e2e |
| Posting preview: title, company, location, work model, employment type, salary only when the employer states it | Popup, side panel | unit, e2e |
| Status of a job you already track: stage, match score, last update, link to it | Popup, side panel | live, e2e |
| Match preview for a posting GetCareer lists (score, category, direction), or the reason it's unavailable | Popup, side panel | live |
| Save job: capture → server import → review and edit every field → save | Side panel (started from popup, context menu or panel) | e2e, live |
| Field provenance: *From the posting*, *Interpreted*, *Please check*, *Not found*, *Edited* | Side panel review | unit, e2e |
| Duplicate detection on save (same link, same posting id, same company and role) with two choices only: open the existing application, or save a separate one | Side panel | e2e, live |
| Initial stage on save (all 11 stages), default stage in options | Side panel, options | unit, e2e |
| Save selected text as a job description (context menu, side panel, popup) | All | unit, live |
| Paste a description | Side panel | unit |
| Restricted platforms (LinkedIn, Indeed, Glassdoor, XING, StepStone, Monster): status lookup by URL, save selected or pasted text, never read automatically | Popup, side panel | unit, live (`platform_restricted`) |
| Context menus: "Save this job to GetCareer" (page), "Save selected text as a job description" (selection) | Page | manual |
| Keyboard shortcut `Alt+Shift+J` opens the popup on the current tab | Browser | manual |
| Side panel that follows the active tab (optional), pinned to its tab during a review | Side panel | manual |
| Per-site access: let the extension read a site whenever the panel is open, and revoke it | Side panel, options | manual |
| Settings: theme (dark default, light, system), default stage, follow tabs, diagnostics | Options | unit (migrations) |
| Copy diagnostics (version, redacted log) | Options | unit (redaction) |
| Backend-controlled feature switches (`features` in bootstrap); no plan logic in the extension | All | live |
| Minimum version check (`min_extension_version`) | All | unit |
| Loading (skeletons, step progress), empty, error, offline, slow, success states | All | e2e screenshots, Impeccable |
| Light and dark themes, keyboard operation, visible focus, screen-reader labels | All | e2e, Impeccable (0 findings) |
| Chrome and Edge builds | Build | build, e2e (Chromium) |
| **AutoFill** (Phase 1): fill application forms from the Career Profile. English and German labels; personal and professional fields and links; review and edit before filling; sensitive and legal questions always left to the user; exclusions by field and category; undo; outlines on the page; never submits. Details in [AUTOFILL.md](AUTOFILL.md) | Popup (summary), side panel (review, result), options | unit, e2e (real API) |
| **AutoFill** (Phase 2): work history and education per entry, dates in the form's format; list widgets and multi-selects; adapters for Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Personio, Recruitee, Workable, Teamtailor, iCIMS and SAP SuccessFactors; multi-step forms (new fields on the page are offered after a fill); CVs and cover letters from GetCareer attached to file fields when ticked; answers typed in the review | Side panel (review, result), options (default CV) | unit (24 form fixtures, no live sites), e2e (two-step form, CV attached in Chromium) |
| **AutoFill** (Phase 3): suggested answers to open questions (AI on the server, with consent, profile and job only, never for salary, legal or personal questions, never ticked); saved answers when the user ticks *Remember*; job preferences and the target salary as unticked suggestions; answer language, length and tone; AutoFill history (optional; site, job, counts, file names); usage counts without values | Side panel (review), options (answer settings, saved answers, history) | unit, backend (33 tests), e2e (history) |

## How a save works for the user

1. On a job page, click the GetCareer icon (or press `Alt+Shift+J`). The popup shows the
   posting it found and whether you already track it.
2. **Review and save** opens the side panel. GetCareer reads the posting and shows the steps
   the worker actually reports: *Reading the posting → Finding the details → Checking how well
   it fits*.
3. Every field is editable and tagged by where it came from. Salary is filled only when the
   employer states it. Required fields are validated, and the first invalid field is focused.
4. **Save application**. If GetCareer finds the same posting or role among your applications,
   it stops and offers *Open the existing application* or *Save as a separate application*.
   Saving never changes the existing application, its notes, history, status or documents.
5. The panel confirms the save and links to the application.

Nothing is saved, sent to AI, or submitted anywhere without one of these clicks. The
extension never applies to a job and never sends a message.

## States per page

| Page | Popup and side panel show |
|---|---|
| Job posting (`job`) | Preview, tracked status and match, **Review and save** |
| Probably a posting (`maybe_job`) | The same, with "This might be a job posting. Check the details before saving." |
| Tracked posting | The application's stage, match and last update, with **Open** (in GetCareer); saving again is labelled *Review and save as a separate application* |
| Not a posting (`not_job`) | "No job posting found on this page", *Save this page anyway*, *Paste a description* |
| Restricted platform | Why it isn't read, the tracked status if the posting URL is known, *Save selected text*, *Paste the description instead* |
| No access yet (`no_access`) | How to grant it: click the icon or press `Alt+Shift+J` |
| GetCareer itself | "You're on GetCareer" |
| Browser pages, stores, files | "This page can't be read" |
| Not connected | What the extension can and can't do, **Connect to GetCareer** |
| Offline or server error | The message, and *Try again* |

## Not in Phase 1

These are not built, so they are not offered in the UI: CV tailoring or cover letters from
the extension, notes and reminders from the extension, changing an application's stage from
the extension, bulk saving from listing pages, Firefox and Safari, localisation (the UI is
English). See [ROADMAP.md](ROADMAP.md).

## Known limitations

- ATS adapters are tested against fixture pages modelled on the vendors' current markup, not
  against live sites in CI. A markup change falls back to JSON-LD and the generic reader.
- Pages that render the description only after interaction (tabs, "show more") give less
  text; the user can select the text or paste it.
- When the side panel follows tabs, it can read a newly activated tab only with a per-site
  grant or after the user clicks the icon on it (`activeTab` is per click).
- On single-page job boards, a new address drops the cached reading and the open panel
  reads the page again, if it may.
