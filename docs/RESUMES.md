# Tailored resumes in AutoFill

Status as of 2026-11-19: implemented and tested in the extension (tests below). Not deployed,
not committed.

When the user runs AutoFill on an application form, the extension can ask GetCareer for a
resume written for this job, and then attach it to the form's CV field or offer it as a
download. **GetCareer writes, stores and deletes the resume.** The extension reads the
posting, starts the job, shows the progress, and hands the file to the page or to the
browser's downloads. It does not generate anything, has no database, keeps no files, and does
not manage applications.

The backend side is documented in the GetCareer repo: `docs/api/job-resumes.md`, the OpenAPI
file `docs/api/job-resumes.openapi.json`, and
`docs/integrations/EXTENSION-JOB-RESUMES.md`. This page covers only the extension.

## What the user sees

1. On an application form, **Fill application** opens the review. If *Create a tailored
   resume when I fill an application* is on (Options → AutoFill, on by default), the
   **Tailored resume** card appears above the review and starts:
   *Detecting job details…* → *Analyzing job description…* → *Generating your tailored
   resume…* → *Preparing resume document…*. The review can be used meanwhile, and the CV row
   says "GetCareer is writing a resume for this job. It's attached here when it's ready,
   unless you tick another document."
2. If the job details are incomplete or uncertain (no title, company or description; a page
   that only *may* be a job), the card asks first: the title, company, description (a text
   box to paste it) and the language (English or German), with *Create tailored resume*.
   Nothing is generated from details the user hasn't seen.
3. When the resume is ready: **Your tailored resume is ready.** The CV row of the review now
   shows it ("Tailored for this job"), ticked unless GetCareer flagged something in it.
4. After *Fill*, the resume is attached to the CV field together with the other values, or
   right away if the form was filled before it was ready. The card says **Resume
   successfully attached to the application.** only when the form shows the file (see
   *Confirming an attachment*). Otherwise:
   - no CV field, or AutoFill turned off for it: **Resume is ready for download. Please
     attach it manually.**
   - the form didn't show the file, refused it, or the field couldn't be filled: **Your
     tailored resume is ready. Please download it and attach it manually to your
     application.**
   - the field already holds a file: *Replace the file* (never replaced without asking).
   - GetCareer flagged a claim it couldn't ground in the profile: *Check the resume before
     attaching it*, with *Attach anyway* and the download buttons.
5. **Download PDF** / **Download Word**: "Downloading Rashid_Isayev_Resume.pdf…", then
   "Saved Rashid_Isayev_Resume.pdf to your downloads." (or, without the downloads
   permission, "Your browser shows it in its downloads."). The button then reads
   *Downloaded PDF*; *Download again* is a separate link, so a double click never saves two
   copies.
6. When the form is filled and the resume step is over, the card ends with **Autofill
   completed.**
7. Always available: *Open application in GetCareer*, *Create a new version* (regenerate),
   and *Try again* or *Check again* after a failure or a long wait.

If the resume step fails at any point, AutoFill goes on as before: the review, the fill and
the user's uploaded documents are unaffected.

File names follow GetCareer's rule (the backend sets them): the words of the profile's full
name joined by `_`, then `_Resume.pdf` or `_Resume.docx`, e.g. `Rashid_Isayev_Resume.pdf`;
`Resume.pdf` without a name. The extension accepts the server's name only if it is a safe
plain file name and rebuilds it from the profile name otherwise (`resumeFileName` and
`safeResumeName` in `src/shared/resumes.ts`).

## Endpoints used

All calls go from the service worker to the GetCareer API with the extension's bearer token
(the same `call()` as every other request: no cookies, `redirect: "error"`, one refresh on
401). Nothing else is contacted.

| Call | Used for |
|---|---|
| `GET /extension/bootstrap` → `features.job_resumes {enabled, reason}` | Whether to offer the card at all. `reason: consent_required` shows the card with a link to the AI setting; `ai_unavailable` or no flag hides it |
| `POST /extension/lookup` | Already used for job pages; gives the tracked application (`same_link` / `same_posting`) |
| `GET /job-resumes?application_id=…&include_deleted=false` | Is there a resume for this application already? Newest one in progress first, else the current ready one |
| `POST /job-resumes` with `Idempotency-Key: ext-<uuid>` | Create. 202 (pending/generating) or 200 (an existing version). Timeout 30 s |
| `GET /job-resumes/{id}/status` | Polling, every `poll_after_seconds` (clamped to 1–60 s) |
| `GET /job-resumes/{id}` | Metadata: files, file names, `flagged_claims`, deletion reason |
| `POST /job-resumes/{id}/regenerate` with a new key | *Create a new version*. 409 `generation_in_progress` → follows `details.resume_id` instead |
| `GET /job-resumes/{id}/files/{pdf\|docx}` | The file itself, owner-only, with the bearer token. Timeout 60 s |

Deliberately **not** used: `GET /job-resumes/{id}/download` and `GET /job-resume-files/{token}`
(the extension never holds a link that works without its token), `DELETE /job-resumes/{id}`
(deleting is done in GetCareer), and anything that changes an application.

### Create request

```jsonc
// POST /job-resumes   Idempotency-Key: ext-6f1c2a9e-…
{
  "application_id": "…",          // when the job is tracked; then title and company are null
  "job_title": "Senior Platform Engineer",
  "company": "Contoso",
  "job_description": "…",         // ≥ 40 characters, else job_description_required
  "posting_url": "https://jobs.example/…",
  "location": "Berlin",
  "seniority": "senior",          // from the title, or null
  "requirements": ["…"],          // required then preferred, deduplicated, ≤ 50
  "language": "en"                // posting language, else the form's, else the browser's
}
```

The extension checks the minimum itself first (`job_details_required` without a title and
company and no application; `job_description_required` under 40 characters) so the user can
fix it before anything is sent. The server checks everything again.

### Retries and idempotency

- The create and regenerate POSTs are marked `idempotent`: `http()` resends them **with the
  same key** after a network error, a timeout, 502 or 504. Never after 503
  (`generation_unavailable`: the server released the key, and a later *Try again* sends a new
  one).
- GETs keep the existing retry rules (network errors and 503).
- Polling: a transient error (network, timeout, 5xx) is retried up to three times;
  `rate_limited` slows polling to every 30 s; after 5 minutes the card says *Still being
  prepared* with *Check again*. GetCareer keeps working meanwhile.
- `Authorization` and `Cookie` can't be passed as extra headers (`http()` drops them).

## Duplicate prevention

GetCareer is the source of truth; the extension only avoids asking twice.

- **Per job, in the service worker:** `resumeCreate` keeps a synchronous in-memory entry per
  tab and job while a create is running. A second click, or the auto-start racing a click,
  gets the same promise.
- **Across panel openings:** after a create, the resume id is remembered in
  `chrome.storage.session` under hashed keys: `jr.<sha256(application id)>` and
  `jr.<sha256(posting URL + company + title + user id)>`. Only the id is stored. When the panel
  opens again on the same job, `resume.details` returns that resume (ready or in progress)
  instead of starting another one. Session storage is cleared when the browser closes.
- **Across devices and sessions:** for a tracked application, the extension asks
  `GET /job-resumes?application_id=…` first. The server also deduplicates creates on its
  side.
- **Explicit regeneration** is the only way to get a second version for the same job
  (*Create a new version*).
- A resume reported as deleted or expired is forgotten (every key pointing at it), and the
  card says why ("It was deleted automatically 30 days after it was created.").

## Extraction

`src/extraction/posting.ts` turns the page reading the extension already makes (JSON-LD,
adapters, the posting text) into a `JobPosting`: title, company, location, employment type,
seniority (from the title), URL, description, responsibilities, required and preferred
qualifications (English and German headings; "nice to have", "von Vorteil" and the like move
to preferred), and the language (English or German, by stopwords). HTML descriptions from
JSON-LD are turned into text with list items kept as `- ` lines. The details step shows the
result before anything is generated whenever it is incomplete or uncertain.

Restricted platforms are never read, so there is no tailored resume for them (the user can
create one in GetCareer).

## Attaching

The file goes through the same path as other AutoFill documents: the panel sends one
`autofill.fill` with a file value whose reference is `job-resume:<id>`. The service worker
fetches the file (`resume.file`), checks it, and passes it to the page script in that frame
only. The page script puts it into the field with a `DataTransfer` and fires `input` and
`change`. It never clicks, never submits, and checks the field's `accept` list first.

Checks on the file before it reaches the page or the downloads: the resume is `ready`, the
format is one the resume has, the MIME type is PDF or DOCX, the size is ≤ 10 MB, and the
first bytes are `%PDF-` or a ZIP header. Anything else is `bad_file` and is not used.

### Confirming an attachment

A file input accepting a file doesn't mean the form took it: many upload widgets hide the
input and show their own list, some empty the input after reading it, and some refuse the
file afterwards. For up to 3 seconds after attaching, the page script watches the field's
container and reports:

| Result | When | Card |
|---|---|---|
| `filled` | The file name appears in the field's container or elsewhere on the page, or the browser's own visible file control holds the file | *Resume successfully attached to the application.* |
| `file_rejected` | An upload error appears near the field ("not supported", "too large", "upload failed", German equivalents) | *…Please download it and attach it manually…* |
| `unconfirmed` | Neither | The same, and the field gets the dashed "check this" outline |

Both `filled` and `unconfirmed` can be undone like other attached files ("change it on the
page").

## Permissions

`downloads` is an **optional** permission. It is requested only when the user clicks a
download button for the first time (Chrome shows "Manage your downloads"). With it, the
extension saves through `chrome.downloads` and can say when the download finished or why it
failed. Without it (declined, or Edge policy), it falls back to a plain `<a download>` from the
side panel, and says the download has started. No other permission was added; the install
warning is unchanged.

## Privacy and security

- **No tokens, links or files are kept.** The file is fetched right before it is attached or
  saved, passed on once, and dropped. A blob URL for a download is revoked after 60 s. There
  is no secret download link anywhere: the file endpoint needs the bearer token, which stays
  in the service worker.
- **Storage:** only resume ids, in `chrome.storage.session`, under hashed keys. No job text,
  no names, no files. *Clear local data* in Options removes them too.
- **Logs:** codes and counts only (`resume.create failed: rate_limited`). Never titles,
  companies, descriptions, file names, ids of people, or tokens. The diagnostics log redacts
  them in any case.
- **Messages:** the six `resume.*` requests are accepted only from the extension's own pages
  and validated field by field (`validResumeInput`, length limits, UUIDs, `en|de`, `pdf|docx`).
  Pages can't reach them.
- **Origin checks:** `resume.create` refuses if the tab no longer shows the page the panel
  read; attaching refuses if the frame's origin changed, as with every AutoFill write.
- **Never submits**, never clicks, never replaces a file the user chose without asking.

## Settings

`autofill.tailoredResume` (settings version 4; the migration from 3 sets it to `true`).
Options → AutoFill → *Tailored resumes*. When it is off, nothing starts by itself: the card
offers *Create tailored resume* and the CV row offers the CVs uploaded to GetCareer as before.

## Code map

| File | Role |
|---|---|
| `src/extraction/posting.ts` | Page reading → `JobPosting` (sections, seniority, language) |
| `src/shared/resumes.ts` | Types, file name rule, file checks, error and deletion messages |
| `src/background/resumes.ts` | Feature check, details, create (deduplicated), progress, regenerate, file |
| `src/background/api.ts`, `http.ts` | The six calls; idempotent POST retries; header filtering |
| `src/background/autofill.ts` | `job-resume:` file references go through `resumeFile` |
| `src/autofill/executor.ts` | Attaching and confirming (`filled` / `unconfirmed` / `file_rejected`) |
| `src/ui/resume-view.tsx` | The card, the flow hook, the details form, downloads |
| `src/ui/autofill-view.tsx` | The CV row, auto-attach after *Fill*, the result |

## Tests

| Suite | What it covers |
|---|---|
| `test/unit/posting.test.ts` (21) | Every fixture page: sections in English and German, preferred items, seniority, language, HTML to text, limits |
| `test/unit/resumes-background.test.ts` (23) | Feature flag reasons; details and when to ask; create body, idempotency key, origin check, client-side minimums; one create for two clicks; reuse from session storage and from the application's list; forgetting deleted resumes; regenerate joining a running version; file checks (MIME, size, magic bytes, not ready, format); nothing but hashed ids stored; nothing personal logged |
| `test/unit/resume-panel.test.tsx` (13) | The progress states in order; the details step; ready → the CV row; attaching after *Fill* and when ready later; flagged claims; an occupied field; manual fallback messages; downloads (one per click, the permission asked in the click, the fallback); failure, retry and *Check again*; AutoFill still usable after a failure |
| `test/unit/autofill-widgets.test.ts` (+3) | Confirmation in jsdom: a widget listing the name, a silent hidden input, an upload error |
| `test/unit/http.test.ts` (+2) | Idempotent POST retried with the same key, never after 503; no credentials in extra headers |
| `test/e2e/attach.spec.ts` (14) | Real Chromium, no backend: the tailored resume attached to the CV field of 12 form fixtures (all supported ATS shapes) with name, type and size checked; Greenhouse's hidden input stays `unconfirmed`; the four upload widgets in `upload-widgets.html` (listed, cleared-but-listed, silent, refused). Nothing is submitted |

`test/e2e/extension.spec.ts` turns the setting off, so its AutoFill tests don't start real AI
generation on the test stack.

## Known limitations

- **Confirmation is a heuristic.** A widget that uploads in the background and shows the
  file only after more than 3 seconds is reported as `unconfirmed`, so the user is asked to
  check. It never claims an attachment it didn't see.
- **English and German** postings only, matching GetCareer's resume languages.
- **Polling needs the panel open.** If the panel is closed during generation, the next
  opening on the same job picks the resume up (ready or still running).
- **Restricted platforms** get no tailored resume from the extension.
