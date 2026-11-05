# CareerOS Companion — Roadmap

Phase 1 (MVP) is implemented and verified ([FEATURES.md](FEATURES.md)). The later phases
build on it one at a time, each reviewed and released separately. Every phase keeps the
rules from Phase 1:

- the API stays authoritative for data, matching and feature access;
- nothing is saved, sent to AI or submitted without an explicit user action;
- existing applications are never overwritten;
- restricted platforms are never read automatically.

## Before the first public release

These release tasks come before new features. Details are in
[CHROME_WEB_STORE_RELEASE.md](CHROME_WEB_STORE_RELEASE.md).

- Store accounts, listing and privacy form; the Datenschutz paragraph and its legal review.
- `EXTENSION_ALLOWED_IDS` with the store ids, and the backend deployed (migrations
  `7c2e5a91b4d0` and `4f8d2b6e1a37`).
- A trusted-tester release against production, and the manual checklist in
  [TESTING.md](TESTING.md), including Edge.
- **Owner decision:** confirm the restricted-platform rule (below).

## Phase 2 — Act on a tracked job

- Change an application's stage from the popup or side panel (the existing stage-change
  endpoint, with the same event and calendar side effects as the website).
- Add a note, and set a follow-up reminder through the Career Calendar.
- Show upcoming interviews for the tracked job.
- Open the CV tailoring and cover-letter flows on the website for this job (deep links; the
  AI runs on the website).

## Phase 3 — Better reading, more sites

- More ATS adapters: Ashby, Personio, Recruitee, Teamtailor, SAP SuccessFactors, iCIMS. Each
  needs a fixture page and tests.
- Listing pages: pick one posting from a list instead of "This might be a job posting".
- Detect when a posting the user tracks has closed or changed (on demand, when the user opens
  it, never in the background).
- A German UI, with the strings extracted for localisation.

## Phase 4 — Match insights in context

- The full match explanation (strengths, gaps, must-haves) for postings saved from a page,
  not only catalog jobs. This needs a match endpoint for private jobs, or the import's
  match preview made persistent.
- Salary context from Salary Intelligence for the posting's role and location, labelled as
  market statistics and never as the employer's offer.

## Phase 5 — Application assistance (AutoFill)

AutoFill Phases 1, 2 and 3 are implemented (2026-11-05); Phase 1 is deployed. Details,
including the product decision on suggested answers, are in [AUTOFILL.md](AUTOFILL.md).
Still open:

- Check the ATS adapters on live postings for the vendors you rely on (by hand; the tests
  use fixtures only). Greenhouse was checked live in Phase 1.
- Location search fields (Greenhouse "Location (City)") and adding entries with "Add
  another" are left to the user.
- An analytics view of the AutoFill usage counts in the CareerOS admin dashboard.
- More languages for labels and suggested answers than English and German.

## Later

- Firefox (MV3 with `browser.identity`; the side panel becomes a sidebar) and Safari (Web
  Extension converter).
- Entitlements: when CareerOS gets plans, `features_for()` in `app/extension/service.py`
  reads them; the extension already follows `bootstrap.features`.
- Encrypting the refresh token at rest with a non-extractable WebCrypto key, a hardening
  step that doesn't change the threat model much, since the browser profile already
  protects it.

## Open owner decision: restricted platforms

The original brief lists LinkedIn, Indeed, XING and StepStone among the sites to support.
Their terms of service forbid automated reading of their pages, and CareerOS already refuses
to fetch their links. The extension therefore:

- never reads these pages automatically, and the API refuses captures from them;
- recognises posting addresses there and shows the status of jobs the user tracks;
- saves the description when the user **selects** it and clicks *Save selected text* (the
  extension reads only the selection, like a copy), or pastes it.

Reading these pages automatically would be the single largest improvement in convenience,
but it would also put CareerOS's store listing and accounts at risk. It should only be
reconsidered with written permission from a platform, or through an official partner API
for that platform.
