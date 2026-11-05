# GetCareer Companion — API integration

The extension calls the GetCareer API at `<GETCAREER_URL>/api/v1` (production:
`https://getcareer.io/api/v1`). Only the service worker calls it
(`src/background/http.ts`, `api.ts`). The endpoints the extension uses are listed below;
everything else is the existing API in `docs/API.md` in the GetCareer repo.

## Request conventions

| Aspect | Value |
|---|---|
| Auth | `Authorization: Bearer <access token>`; no cookies (`credentials: "omit"`) |
| Redirects | Refused (`redirect: "error"`), so a token is never forwarded elsewhere |
| Headers | `X-Request-ID` (32 hex, also in API logs), `X-CareerOS-Client: extension/<version> (<chrome\|edge>)`, `Content-Type: application/json` |
| Timeout | 15 s (save: 30 s) |
| Retries | GET only: 2 retries with back-off on network errors, timeouts, 502, 503 and 504. POSTs are never retried automatically, so nothing is created twice |
| 401 | One refresh, then one retry; a failed refresh shows the connect screen |
| 429 | The API's message ("Too many requests. Please wait a moment and try again.") is shown; no automatic retry |
| Errors | The API's envelope `{error: {code, message, details}}` is shown as is; network errors get the extension's own messages |
| De-duplication | Identical GETs in flight share one request |

## Endpoints added for the extension

### `POST /auth/extension/authorize`

Called by the website's connect page with the cookie session and CSRF header, never by the
extension. Body `{redirect_uri, code_challenge, code_challenge_method: "S256", state,
client_name}`. Returns `{redirect_to, expires_in}`. Errors: 400 `invalid_redirect_uri`, 403
`extension_not_allowed`, 429. Limit: 20 per hour per user.

### `POST /auth/extension/token`

Body `{code, code_verifier, redirect_uri}`. Returns `ExtensionTokens`: `{user, session_id,
access_token, access_token_expires_at, refresh_token, refresh_token_expires_at}`. Errors: 400
`invalid_grant`. Limit: 30 per minute per IP.

### `POST /auth/extension/refresh`

Body `{refresh_token}`. Returns `ExtensionTokens` with a new refresh token. Errors: 401.
Limit: 60 per minute per IP.

### `GET /auth/extension/sessions`, `DELETE /auth/extension/sessions/{id}`

Connected extensions of the current user (`{id, client_name, created_at, last_used_at,
expires_at, current}`) and disconnecting one (204). Used by the website's settings page.

### `GET /extension/bootstrap`

Everything the extension needs after connecting, cached for 5 minutes:

```json
{
  "api_version": 1,
  "min_extension_version": "0.1.0",
  "app_url": "https://getcareer.io",
  "user": { "id": "…", "email": "…", "full_name": "…" },
  "capabilities": {
    "ai_available": true, "ai_consent": true,
    "has_career_direction": true,
    "primary_direction": { "id": "…", "name": "Platform Engineering" }
  },
  "features": {
    "save_job": { "enabled": true },
    "application_status": { "enabled": true },
    "job_match": { "enabled": true },
    "ai_extraction": { "enabled": false, "reason": "consent_required" },
    "autofill": { "enabled": true },
    "autofill_documents": { "enabled": true },
    "autofill_answers": { "enabled": false, "reason": "consent_required" },
    "autofill_saved_answers": { "enabled": true },
    "autofill_history": { "enabled": true }
  },
  "entitlements": { "plan": "free", "source": "none" },
  "restricted_platforms": [ { "key": "glassdoor", "name": "Glassdoor" }, … ]
}
```

`features` is the only source of feature access. The extension shows a feature only when it
is enabled, and shows the reason when it isn't (no career direction → "Set up a career direction
in GetCareer to see how well jobs fit."). `features_for()` in `app/extension/service.py` is the single place where
a future entitlement service plugs in. Today every implemented feature is on, and only
prerequisites switch one off. The extension contains no plan names, limits or prices.

### `GET /extension/autofill-profile`

The Career Profile as flat values for AutoFill. It is read-only and never creates a profile.
It is rate-limited per user (`extension_autofill_per_hour`, default 600) and returned with
`Cache-Control: no-store`. A user without a profile gets `values` with email and name only.

```json
{
  "profile_version": 7,
  "updated_at": "2026-11-05T09:12:00Z",
  "language": "en",
  "values": {
    "email": { "value": "erika@example.com", "basis": "explicit" },
    "first_name": { "value": "Erika", "basis": "explicit" },
    "city": { "value": "Berlin", "basis": "derived" },
    "years_of_experience": { "value": 12, "basis": "explicit" },
    "management_experience": { "value": true, "basis": "explicit" }
  }
}
```

`basis: "derived"` means GetCareer worked the value out (first and last name split from a
two-part full name, the city from "Berlin, Germany", the current employer when several
positions are current). AutoFill only suggests derived values; it never fills them without
the user ticking them. Keys: `email`, `full_name`, `first_name`, `last_name`,
`preferred_name`, `phone`, `street_address`, `postal_code`, `city`, `country`, `location`,
`headline`, `summary`, `years_of_experience`, `seniority`, `industry`,
`management_experience`, `leadership_experience`, `current_company`, `current_title`,
`linkedin_url`, `github_url`, `portfolio_url`, `website_url`. Sensitive data is not part of
the response.

Since AutoFill Phase 2 the response also has (older extensions ignore them):
`experiences` (newest first: `company`, `title`, `location`, `start` and `end` as `YYYY-MM`,
`current`, `description`, `achievements`), `education` (`institution`, `degree`,
`field_of_study`, `start_year`, `graduation_year`), `skills`, `languages` (`language`,
`proficiency`, `cefr`), `certifications` (`name`, `issuer`, `year`), `preferences`
(`willing_to_relocate`, `remote`, `employment_types`, `preferred_locations`, `salary_min`,
`salary_target`, `salary_currency`, or null) and `saved_answers` (`id`, `field_key`,
`question`, `answer`, `updated_at`).

### AutoFill: documents, answers, history, usage (`/extension/autofill/*`)

Each group has its feature flag in bootstrap; the extension calls an endpoint only when its
flag is on. All are per user and owner-checked.

| Endpoint | Body or query | Returns |
|---|---|---|
| `POST /extension/autofill/documents` | `{url, application_id?}` | `{application, documents}`: the tracked application for the URL (or the given one), and the documents to attach. Each document: `ref` (`resume:<id>` or `generated:<id>`), `kind` (`cv`, `cover_letter`), `name`, `formats`, `size`, `updated_at`, `recommended`, `note` |
| `GET /extension/autofill/documents/{resume\|generated}/{id}/file?format=pdf\|docx` | | The file's bytes with `Content-Disposition` (ASCII fallback plus `filename*`) and `Cache-Control: private, no-store`. 413 `document_too_large` over `extension_document_max_bytes` (10 MB). Audited |
| `POST /extension/autofill/answers` | `{url, application_id?, job_title?, company?, job_text? (≤ 8000), questions: [{id: "frameId:fieldId", text, max_length?}] (1–10), language: en\|de, length: short\|medium\|long, tone: professional\|concise\|warm\|executive}` | `{context: application\|page\|title_only, answers: [{id, status: drafted\|needs_input\|declined, answer, missing, issues}]}`. Salary, legal and personal questions come back `declined` and are never sent to the model. Rate limit `extension_answers_per_hour` (30). 403 `ai_consent_required`, 503 `ai_unavailable` or `ai_failed`, 400 `profile_empty` |
| `GET /extension/autofill/saved-answers` | | The user's saved answers |
| `POST /extension/autofill/saved-answers` | `{field_key? (a reusable key), question (≤ 500), answer (≤ 5000)}` | 201 with the saved answer. A second save for the same key, or the same question, updates it. 400 `too_many_saved_answers` over 200 |
| `DELETE /extension/autofill/saved-answers/{id}` | | 204 |
| `GET /extension/autofill/history?limit=` | | Entries, newest first |
| `POST /extension/autofill/history` | `{site, ats?, company?, job_title?, application_id?, fields_filled, fields_confirmed, fields_asked, documents (≤ 5 file names)}` | 201 with the entry. An `application_id` the user doesn't own is dropped. At most 500 entries are kept |
| `PUT /extension/autofill/history/{id}` | The same body | The updated entry (a later step of the same application) |
| `DELETE /extension/autofill/history`, `DELETE /extension/autofill/history/{id}` | | 204 |
| `POST /extension/autofill/events` | `{event: form_detected\|filled\|no_form\|document_attached, ats, fields_detected, fields_filled, fields_confirmed, fields_asked, steps}` | 204. Counts only, no values or sites. Skipped when the user opted out of analytics |

### `POST /extension/lookup`

Body `{url, title?, company?, city?}` (title, company and city help find the same role saved
from another link). Returns:

```json
{
  "url": { "canonical_url": "…", "platform": "greenhouse", "platform_name": "Greenhouse",
           "posting_id": "4567890", "restricted": false },
  "applications": [ { "application_id": "…", "company_name": "Acme", "position_title": "Senior SRE",
                      "location": "Berlin", "status": "interview", "match_score": 82,
                      "created_at": "…", "updated_at": "…",
                      "reasons": ["same_link"], "app_url": "…/applications/…" } ],
  "job": { "job_id": "…", "title": "…", "company_name": "…", "location": "…",
           "match": { "score": 82, "category": "strong", "eligibility": "eligible",
                      "exclusion_reasons": [], "direction_id": "…", "direction_name": "…" },
           "app_url": "…" },
  "pending_import": { "import_id": "…", "status": "ready", "updated_at": "…" }
}
```

`applications` is ordered strongest signal first: `same_link` (canonical URL), then
`same_posting` (platform posting id), then `same_role` (company and title, optionally the
city). It uses the same `find_duplicates` as the import. Nothing is fetched: the URL is only
parsed. Errors: 400 `invalid_url` / `unsafe_url`, 429 above `EXTENSION_LOOKUPS_PER_HOUR`
(default 600 per user).

## Existing endpoints, extended

### `POST /job-imports` with `capture`

`{capture: PageCapture}`, as an alternative to `{url}` or `{text}`. Sending both a capture
and text is a 422 error. The capture:

| Field | Limit | Notes |
|---|---|---|
| `url` | ≤ 2000 | The page address; parsed with the same rules as an import link (no private IPs, http(s) only) |
| `canonical_url` | ≤ 2000 | `<link rel=canonical>` |
| `document_title` | ≤ 500 | |
| `meta` | Known keys only, values ≤ 1000 | `og:title`, `og:site_name`, `og:description`, `og:url`, `og:type`, `twitter:title`, `description` |
| `json_ld` | ≤ 8 objects, ≤ 250 KB, depth ≤ 10 | The extension sends only JobPosting nodes, pruned; the server picks the JobPosting nodes again itself |
| `page_fields` | Known keys only; `{value (1–500), basis: explicit\|inferred}` | `title`, `company_name`, `location`, `employment_type`, `remote_policy`, `department`, `date_posted`, `deadline`, `posting_id` |
| `description_text` | ≤ 60,000 | Readable text of the posting area; omitted when JSON-LD already has the description |
| `adapter` | `^[a-z0-9_-]{1,40}$` | `generic`, `greenhouse`, `lever`, `workday`, `smartrecruiters` |
| `extension_version` | `1.2.3` form | For logs and support |

Unknown fields are rejected (`extra="forbid"`). Every string is stripped of control
characters. A capture from a restricted platform is refused with 400 `platform_restricted`.
The import gets `method = "extension"`, and the same page captured again within 15 minutes
returns the same import (double-click safe).

The worker (`_from_capture` in `app/job_imports/service.py`) never fetches the page. It
uses the catalog job if GetCareer already lists the posting; otherwise JSON-LD (stated
facts), adapter fields (`explicit` → stated, `inferred` → interpreted), meta tags and the
page text. AI reads only this text, and only with the user's AI consent. Fewer than 150
characters of description and no JobPosting gives `needs_text` with `no_content`, and the
extension offers the paste form.

### Other import endpoints the extension uses unchanged

| Endpoint | Used for |
|---|---|
| `POST /job-imports {text}` | Selected text (context menu, side panel) and pasted text |
| `GET /job-imports/{id}` | Polling every 1.2 s; "This is taking longer than usual" after 60 s |
| `POST /job-imports/{id}/text` | Pasting the description after `needs_text` |
| `POST /job-imports/{id}/retry` | "Try again" after a temporary failure |
| `POST /job-imports/{id}/save` | Saving the reviewed fields; 409 `possible_duplicate` unless `allow_duplicate` |
| `GET /applications/{id}` | The saved state |

`POST /job-imports/{id}/apply-to/{application_id}` (update an existing application) is
deliberately not used. The extension never changes an existing application.

## Error codes the extension handles specially

| Code or status | Behaviour |
|---|---|
| `platform_restricted` | Restricted pages are recognised before any call and explain the platform's rule; the side panel offers saving selected text. If the server refuses a capture, its message (which points to selecting the text) is shown |
| `possible_duplicate` (409 on save) | Duplicate panel: *Open the existing application* or *Save as a separate application* |
| Import `needs_text` (any reason: `no_content`, `blocked_by_robots`, …) | "GetCareer couldn't read this posting" with the server's message and the paste form |
| Import `failed` | The same, plus *Try again* (`/retry`) |
| `invalid_session` (401 after one refresh) | Connect screen |
| `update_required` (from `min_extension_version`) | Update notice instead of the UI |
| `ai_consent_required` (suggested answers) | "Allow AI processing in your GetCareer settings to get suggested answers." with a link to the settings |
| 404 on `PUT /extension/autofill/history/{id}` | The entry was deleted meanwhile: a new one is started |
| Anything else | The API's message as is, or the extension's message for network errors |

## Versioning

`bootstrap.api_version` is the contract version (1). The API refuses nothing by version
today. `min_extension_version` lets the server retire an old extension: the extension
compares versions and shows "Update" instead of calling further. The extension sends its
version in `X-CareerOS-Client` and in the capture. The `X-Request-ID` of failed calls is
kept in the diagnostics log (Options → Copy diagnostics) for support.

Type definitions: `src/shared/api-types.ts`, hand-written from the API
schemas (`app/extension/schemas.py`, `app/auth/schemas.py`, `app/job_imports/schemas.py`).
The live tests (`pnpm test:live`) check them against the running API.
