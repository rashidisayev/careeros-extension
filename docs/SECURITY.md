# GetCareer Companion — Security and privacy

Threat model in short: job pages are untrusted and may be hostile, other extensions and web
pages may try to talk to ours, tokens are valuable, and the GetCareer API must stay
authoritative. Authentication details are in [AUTHENTICATION.md](AUTHENTICATION.md).

## Permissions

| Permission | Why it is needed | What it does not allow |
|---|---|---|
| `activeTab` | Read the tab you clicked the icon on (or pressed `Alt+Shift+J`, or used the context menu) | Reading any other tab, or the same tab after you navigate away |
| `scripting` | Inject the bundled extractor, or the AutoFill script, into that tab, only when you open the extension on it | Running code from the page or the network; both are packaged files |
| `storage` | Settings (`local`), access token and per-tab state (`session`) | Sync to other devices: nothing uses `storage.sync` |
| `sidePanel` | The side panel with the review form | — |
| `identity` | `launchWebAuthFlow` for connecting to GetCareer | Reading your Google or browser account; the extension doesn't use `getAuthToken` |
| `contextMenus` | "Save this job to GetCareer" and "Save selected text as a job description" | — |
| Host: the GetCareer origin only (`https://getcareer.io/*`) | Call the GetCareer API from the service worker | Any other site |
| Optional host: `https://*/*` | Requested **per site** when you choose *Read this site automatically* in the side panel, so the panel can read postings there without a click per page. Revocable in the panel, in Options or in the browser | All sites at once: only the one origin you approved is granted |

Not requested: `tabs` (URLs come from `activeTab` and granted sites), `history`, `cookies`,
`webRequest`, `<all_urls>`, `downloads`, `notifications`, `clipboardRead`. There are no
`content_scripts`, no `web_accessible_resources` (pages can't detect or load the extension)
and no `externally_connectable` (web pages can't message it).

Install-time warning in Chrome: "Read and change your data on getcareer.io" (the
GetCareer host only). The optional permission prompt appears per site, when the user asks
for it.

## Untrusted page content

| Risk | Control |
|---|---|
| Hostile page scripts | The extractor runs in Chrome's isolated world. It returns plain JSON (`structuredClone`-able), and no page objects or functions cross over |
| Reading what isn't the posting | Only the posting area is read. Navigation, header, footer, forms, inputs (including password fields), buttons, iframes, hidden elements and `aria-hidden` content are skipped. The JSON-LD sent is only JobPosting nodes pruned to known properties |
| Oversized or deeply nested data | Hard limits on scripts, characters, items and depth in the extractor ([SUPPORTED_WEBSITES.md](SUPPORTED_WEBSITES.md)); the API enforces its own limits again (`PageCapture`) |
| Prototype pollution (`__proto__` keys in JSON-LD) | Pruning copies only allow-listed keys into new objects; covered by the `malicious.html` fixture |
| XSS in the extension's pages | React renders every value as text; there is no `innerHTML`, `dangerouslySetInnerHTML`, `eval` or `new Function` in the source. CSP: `script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` |
| Links from page data | The extension opens only GetCareer paths (`appUrl` rejects anything that isn't a plain path) and the browser's shortcut settings. URLs read from pages are only sent to the API, and never opened or rendered as links; `javascript:` and other schemes are dropped |
| Prompt injection in posting text | The extension never calls AI. The API sends the text to AI only with the user's consent, as data in the job-posting prompt; every quoted value is checked against the text, and the user reviews every field before saving (`docs/AI.md` in the GetCareer repo) |
| Hidden text aimed at AI ("ignore previous instructions") | Hidden elements aren't read; anything visible still goes through the review |
| Messages from pages or other extensions | The service worker accepts messages only from this extension's own pages (`isTrustedSender`), validates each request's shape (`parseRequest`) and ignores everything else |

## Tokens and the network

- The refresh token lives only in the service worker's IndexedDB, and the access token in
  `chrome.storage.session`. Neither is reachable from pages or the extractor.
- Requests go only to the GetCareer origin, enforced three times: the API base is fixed at
  build time, `host_permissions` holds only that origin, and the CSP `connect-src` allows
  only that origin.
- `credentials: "omit"` (the website's cookies are never sent), `redirect: "error"` (a
  token can't follow a redirect), 15 s timeouts.
- No remote code: fonts, icons and scripts are bundled. The production bundle contains no
  URL other than GetCareer (checked with `grep` at release; React and SVG namespace strings
  aside).
- No secrets in the source: the extension has no client secret, and the development
  manifest key is a public key.

## Server-side enforcement

The extension is a client; the API doesn't trust it.

- Every endpoint requires the user's token and scopes data to that user (existing tenant
  isolation). `tests/test_extension.py` checks that lookups, imports and extension sessions
  are private to each user.
- `PageCapture` validation: unknown fields rejected, strings cleaned of control characters,
  meta and adapter keys allow-listed, JSON-LD size and depth limited.
- Restricted platforms are refused server-side (`platform_restricted`), whatever the
  extension sends.
- The import never fetches the captured page. The URL is parsed with the same SSRF rules as
  a link import (public http(s) hosts only) and is used only for duplicate detection and
  the application's link.
- Feature access comes from `bootstrap.features`; the extension has no plan logic. Usage
  limits are API rate limits.
- Extension ids are allow-listed in production (`EXTENSION_ALLOWED_IDS`).

## Privacy

- **What is sent to GetCareer, and when:** the posting you chose to save (or its address, to
  show its status), after you opened the extension on that tab. Nothing is sent for pages
  you don't open it on, and there is no background monitoring of tabs or history.
- **What is stored in the browser:** settings, tokens (above), and per-tab readings in
  session storage, which are dropped when the tab navigates or closes.
- **AutoFill:** the Career Profile is fetched when you open AutoFill on a form and kept in
  memory for that review only. Nothing typed into the form is sent to GetCareer. Values are
  written only after you press *Fill*, only into the page (and frame origin) you reviewed,
  and the form is never submitted. Sensitive and legal questions (work authorisation, visa,
  citizenship, nationality, date of birth, gender, disability, ethnicity, criminal record,
  current salary, notice period, start date) and consent boxes are never filled from the
  profile; only an answer you saved yourself is offered, unticked. Logs hold counts only.
- **AutoFill documents:** a CV or cover letter is downloaded from GetCareer only when you fill
  a file field you ticked, handed to that page once and not stored. The page script accepts
  only a file the field's `accept` list allows.
- **AutoFill answers and history:** GetCareer receives the question texts you ask it to draft
  (with the job) and the answers you tick *Remember* for. Drafts are made on the server,
  only with your AI consent, never for salary, legal or personal questions, and are never
  ticked for you. The optional history (on by default, Options → AutoFill) keeps the site,
  job, field counts and the names of attached files, never form values; you can delete it
  there. Usage counts carry numbers and the ATS name only and follow your GetCareer analytics
  setting. Details in [AUTOFILL.md](AUTOFILL.md).
- **Clear local data** (Options → Privacy) removes page readings and cached details and
  resets settings, without disconnecting.
- **AI:** only server-side, only with the user's AI consent in GetCareer, and only the
  posting text.
- **Data minimisation:** when a page's JSON-LD already holds a full description, the page
  text isn't sent at all.
- **Diagnostics:** off by default. The in-memory log keeps 100 entries and redacts tokens,
  auth codes and PKCE values, email addresses, names, titles, companies, text and bodies; URLs are cut to their
  origin. "Copy diagnostics" in Options copies only that.
- **Disconnect** removes all tokens and session data from the browser and revokes the
  session server-side. Deleting the GetCareer account revokes extension sessions too.

The privacy policy text for the store listing is drafted in
[CHROME_WEB_STORE_RELEASE.md](CHROME_WEB_STORE_RELEASE.md) and must be added to the
website's Datenschutz page before publishing.

## Known limitations

- **Refresh token at rest:** not encrypted beyond the browser profile's protection. A
  malicious extension with `debugger` access, or malware on the device, could read it.
  Mitigations: 30-day expiry, rotation with reuse detection, disconnect from the website.
- **Service worker stopped mid-refresh:** if Chrome stops the worker after the server
  rotated the refresh token but before the new one was stored, the next refresh uses the
  old token. Within 60 s that is accepted; after that, reuse detection revokes the session
  and the user connects again. Rare, and it fails safe.
- **Per-site grants persist** until the user revokes them. The side panel shows the state
  and offers *Stop*.
