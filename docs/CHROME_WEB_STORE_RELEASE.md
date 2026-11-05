# GetCareer Companion — Chrome Web Store and Edge Add-ons release

Not published yet. This is the checklist for the first release and every update after it.

## 1. Before the first release (one-time)

- [ ] **Developer accounts:** Chrome Web Store (one-time fee, 2-step verification) and Microsoft
      Partner Center for Edge Add-ons. Publish under the operator named in the website's
      Impressum.
- [ ] **Privacy policy:** add the extension section below to the website's Datenschutz page
      (`apps/web/lib/legal`). The listing links to it.
- [ ] **Upload a first draft** to get the store ids (Chrome assigns the id on the first
      upload; Edge has its own id).
- [ ] **Allow the ids on the server:** set
      `EXTENSION_ALLOWED_IDS=<chrome-store-id>,<edge-store-id>` in the NAS `.env`, then run
      `docker compose up -d api`. With the list empty, production refuses every extension.
- [ ] **Deploy the backend:** migration `7c2e5a91b4d0` and the API, worker and web changes.
      Check that `/connect/extension` loads on `https://getcareer.io`.
- [ ] **Smoke test with the store build:** load `dist` unpacked, then connect, save a job,
      check its status, and disconnect, against production with a test account. Note that an
      unpacked production build has a different id from the store's; allow that id
      temporarily, or test with a draft published to trusted testers.

## 2. Build

```sh
cd careeros-extension
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test
# bump "version" in package.json (major.minor.patch); the manifest takes it from there
pnpm package          # → release/getcareer-companion-<version>-chrome.zip
pnpm package:edge     # → release/getcareer-companion-<version>-edge.zip
```

`scripts/package.mjs` refuses development builds: a manifest `key`, a "(dev)" name or a
non-https host permission stops it. Source maps are not included. Check the result:

```sh
unzip -p release/getcareer-companion-<version>-chrome.zip manifest.json   # no "key", host = getcareer.io
unzip -l release/getcareer-companion-<version>-chrome.zip                 # no .map files
```

## 3. Listing

| Field | Value |
|---|---|
| Name | GetCareer Companion |
| Summary (≤ 132 chars) | Save job postings to GetCareer, see what you already track, and review every detail before it's saved. |
| Category | Productivity (Chrome) / Productivity (Edge) |
| Language | English |
| Icon | `icons/128.png` (from `scripts/getcareer-mark-512.png`) |
| Screenshots (1280×800) | Popup on a job page; side panel review with source tags; duplicate notice; saved state; options. Take them from `test-results/screens` after `pnpm test:e2e`, or retake at 1280×800, with fixture data only |
| Homepage | `https://getcareer.io` |
| Support | The support address from the Impressum |
| Privacy policy URL | The Datenschutz page anchor for the extension |

Description (draft):

> GetCareer Companion connects your browser to your GetCareer account.
>
> - **Save a job in one click:** GetCareer reads the posting you're on and fills in the
>   details. You check every field, see where each value came from, and save.
> - **Know what you already track:** open a posting you saved before and see its stage and
>   match right away.
> - **No accidental duplicates:** if you already track the job, GetCareer tells you, and
>   it never changes your existing application.
> - **Private by design:** the extension reads a page only when you ask, sends only the job
>   posting, and never reads LinkedIn, Indeed and similar sites automatically (their terms
>   don't allow it). Select the description there and save the selection instead.
>
> Requires a GetCareer account.

## 4. Privacy practices form (Chrome) and the Edge equivalent

**Single purpose:** "Save job postings the user is viewing to their GetCareer account and
show the status of jobs they already track."

**Permission justifications:**

| Permission | Justification |
|---|---|
| `activeTab` | Read the job posting on the tab where the user clicks the extension, only after that click |
| `scripting` | Run the extension's packaged page reader on that tab to extract the job posting |
| `storage` | Store settings and the session for the user's GetCareer connection |
| `sidePanel` | Show the review form for a job posting next to the page |
| `identity` | Sign in to GetCareer through the GetCareer website (`launchWebAuthFlow`) |
| `contextMenus` | "Save this job to GetCareer" and "Save selected text as a job description" in the right-click menu |
| Host `https://getcareer.io/*` | Send the job posting to the user's GetCareer account and read their application status |
| Optional host `https://*/*` | Requested for one site at a time, only when the user chooses to let the extension read job postings there without clicking each time |
| Remote code | **No.** All code is in the package |

**Data usage disclosure:**

| Data type | Collected | Purpose |
|---|---|---|
| Personally identifiable information | Yes: the account email and name, shown in the extension | Account (app functionality) |
| Authentication information | Yes: the GetCareer session tokens | Account (app functionality) |
| Website content | Yes: the job posting the user chooses to save, and the address of a job posting page the extension is opened on | App functionality |
| Web history, user activity, location, financial, health, personal communications | No | — |

Certify: data isn't sold, isn't used or transferred for purposes unrelated to the single
purpose, and isn't used to determine creditworthiness.

### Datenschutz paragraph (to add to the website)

> **Browser extension (GetCareer Companion).** If you install the extension and connect it to
> your account, it sends to GetCareer (a) the address of a job posting page when you open the
> extension on that page, to show whether you already track that job, and (b) the content of
> the job posting (structured job data, page title and the text of the posting) when you
> choose to save it. The extension reads a page only after you open it on that page or allow
> it for that site. It reads no other pages, no browsing history and no data from LinkedIn,
> Indeed, Glassdoor, XING, StepStone or Monster pages, except the text you select there
> yourself. Saved postings are processed like job postings you import on the website
> (including optional AI processing with your consent). The extension stores its session and
> your settings in your browser. Disconnecting it, in the extension or in the account
> settings, ends the session. Legal basis: Art. 6(1)(b) GDPR (providing the service you
> request).

Have this reviewed together with the other open legal items (PROJECT_STATUS.md, "Next
recommended actions").

## 5. Review and rollout

- Chrome review usually takes days. Broad optional host permissions can lengthen it; the
  justification above explains the per-site use.
- Publish to **trusted testers** first, test against production, then publish publicly.
- Edge: submit the Edge zip in Partner Center. The listing text and justifications are the
  same.

## 6. Updates

1. Bump `version` in `package.json`. The store requires a higher version
   than the published one.
2. If the API changes in a way older versions can't handle, deploy the API first (keep it
   backward compatible), publish the extension, and raise `EXTENSION_MIN_VERSION` only after
   most users have updated. Older versions then ask the user to update.
3. Permission changes trigger a new warning and can disable the extension until the user
   accepts. Avoid adding required permissions; prefer optional ones.
4. Rebuild, package, upload, and fill in the "What's new" text.

## 7. Rollback

The stores have no one-click rollback. Re-upload the previous version's zip with a
**higher** version number (for example 0.1.2 carrying 0.1.0's code). Keep the release zips of
published versions (they are git-ignored; store them with the release notes).
