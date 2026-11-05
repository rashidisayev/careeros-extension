# GetCareer Companion — Supported websites

The extension works on any public `https` (or `http`) job page that it is allowed to read,
except the platforms listed under *Restricted*. It reads a page only after you click the
toolbar icon, press `Alt+Shift+J`, use the context menu, or grant the site access in the side
panel. Code: `src/extraction`, `src/shared/policy.ts`.

## How a page is read, in order

| Priority | Source | Marked as | Code |
|---|---|---|---|
| 1 | schema.org `JobPosting` in JSON-LD (including `@graph`, `mainEntity`, `ItemList`) | From the posting | `structured.ts` |
| 2 | schema.org `JobPosting` as microdata | From the posting | `structured.ts` |
| 3 | Site adapter fields (see below); `explicit` for labelled elements, `inferred` for guesses | From the posting / Interpreted | `adapters/*.ts` |
| 4 | Generic reader: the main content area, its `h1`, labelled facts | Interpreted | `adapters/generic.ts` |
| 5 | Open Graph and meta tags, the document title, `<link rel=canonical>` | Interpreted | `meta.ts` |
| 6 | Your corrections in the review form | Edited | `ui/review.tsx` |

The extension sends these raw readings, not its conclusions. The GetCareer API repeats the
extraction with its own code (and AI, only with your consent) and decides the values and tags
you review. The extension's own reading is used only for the preview and the status lookup.

Size limits on what is read: at most 20 JSON-LD scripts of up to 1 MB each, 3 postings,
descriptions of up to 100,000 characters (60,000 for page text), other strings up to 5,000,
lists up to 25 items, nesting depth 6, about 200 KB of JSON-LD in total.

## Site adapters

| Site | Hosts | Reads | Fixture |
|---|---|---|---|
| Greenhouse | `*.greenhouse.io` (boards, job-boards) | Title, company ("at …"), location, posting id from `/jobs/<id>`, description area | `greenhouse.html` |
| Lever | `*.lever.co` | Title, location, commitment (employment type), workplace type, department or team, company from the logo's alt text, posting id | `lever.html` |
| Workday | `*.myworkdayjobs.com`, `*.myworkdaysite.com` | Title, location, time type (employment type), remote type, requisition id, description (`data-automation-id` attributes). Relative dates ("Posted 3 days ago") are not sent | `workday.html` |
| SmartRecruiters | `*.smartrecruiters.com` | Title, company, location, posting id, description | No dedicated fixture yet; its pages carry schema.org microdata (verified on a live Bosch posting during the job-import work), which ranks first |
| Any other site | — | JSON-LD, microdata, generic reader, meta tags | `jsonld-*.html`, `generic.html`, … |

Company career sites that embed one of these ATS through their own domain are read through
JSON-LD and the generic reader. Most ATS pages publish JSON-LD, which ranks above an adapter.

## Job page detection

Each page gets a confidence from its signals (`detect.ts`):

- **high**: exactly one JobPosting in structured data; or an adapter found a title and the page
  has a job section, an apply control or a job path.
- **medium**: an adapter title alone; or a page title plus at least 4 points.
- **low**: several postings (a listing page); or a page title plus 2–3 points.
- Points: a job-like path (`/jobs/…`, `/careers/…`, `/stellenangebote/…`, …), an apply control
  ("Apply", "Jetzt bewerben", …), `og:type` job, and up to three section headings
  (responsibilities, requirements, benefits, nice to have, how to apply; English and German).

High and medium show as a job posting, low as "This might be a job posting", and anything
else as "No job posting found" with *Save this page anyway*. A wrong guess costs nothing:
saving always goes through the review.

## Restricted: never read automatically

| Platform | Hosts |
|---|---|
| LinkedIn | `linkedin.com`, `lnkd.in` |
| Indeed | `indeed.*` |
| Glassdoor | `glassdoor.*` |
| XING | `xing.com` |
| StepStone | `stepstone.*` |
| Monster | `monster.*` |

Their terms of service forbid automated access, and GetCareer already refuses to fetch their
links (`docs/JOB-IMPORT.md` in the GetCareer repo). An extension reading the page counts as automated
access, so the same rule applies:

- The extractor is **never** injected into these pages, and no per-site access can be granted
  for them.
- For a posting address (for example `linkedin.com/jobs/view/<id>`, `indeed.com/viewjob?jk=…`),
  the extension looks up the URL in GetCareer and shows the status of the application you
  track. Feeds, profiles and searches are not looked up.
- **Save selected text**: you select the description on the page and click the button or
  the context menu. The extension reads only the selected text (`getSelection()`, the same as
  copying it), never the page, and sends it as pasted text with the link.
- **Paste the description** works as on the website.
- The API refuses a page capture from these hosts (`platform_restricted`), so an outdated or
  modified extension can't bypass the rule. The list is in `app/job_imports/urls.py`
  (`RESTRICTED`) and returned in `bootstrap.restricted_platforms`. The extension's copy in
  `src/shared/policy.ts` must match it; the live test (`pnpm test:live`) fails if they differ.

No profile data, no messages and nothing outside the posting is ever read on any site.

## Never readable

Browser pages (`chrome://`, `edge://`), extension stores (Chrome Web Store, Edge Add-ons),
other extensions and `file://` URLs. These show "This page can't
be read". Pages behind a login are read only as you see them, because the extension reads
your open tab and never signs in or fetches anything itself. CAPTCHAs, paywalls and access
controls are never bypassed.

## Adding an adapter

1. Save a representative page as a fixture in `test/fixtures/pages/` (remove personal data;
   no live pages in CI).
2. Add `src/extraction/adapters/<site>.ts` with `key`, `matches(url)` (host check with
   `hostIs`) and `read(doc, url)`, returning only `PAGE_FIELDS` keys. Mark values `explicit`
   only when an element labels them.
3. Register it in `adapters/index.ts` and add extraction tests: fields, detection confidence,
   and that JSON-LD still wins.
4. The API accepts the new `adapter` key without changes (it is a free-form slug).
