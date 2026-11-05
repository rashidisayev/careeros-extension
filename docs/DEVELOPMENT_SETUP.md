# CareerOS Companion — Development setup

## Prerequisites

- Node.js 20+ and pnpm (as for `apps/web`).
- The CareerOS stack running locally (`make up` in `~/Desktop/careeros`), so the website is at
  `http://localhost:3000` and proxies `/api/v1` to the API. Run `make migrate` once for the
  extension migration (`7c2e5a91b4d0`).
- Chrome 116+ or Edge 116+.

The extension is a standalone project in `~/Desktop/careeros-extension`, separate from the
CareerOS repo (`~/Desktop/careeros`). It has its own `package.json` and lockfile.

```sh
cd careeros-extension
pnpm install
```

## Build and load in Chrome

```sh
pnpm build:dev            # development build into dist
# or
pnpm dev                  # the same, rebuilding on every change
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → choose `careeros-extension/dist`.
3. The id must be `ajbdeolccbgjinhdmllogiefhmcogpma`. The development manifest carries a
   fixed public key (`scripts/dev-public-key.txt`), so every developer gets the same id and
   the API accepts its sign-in redirect. With `EXTENSION_ALLOWED_IDS` empty, any id is
   accepted in development.
4. Pin *CareerOS Companion (dev)* and click it on a job page. **Connect to CareerOS** opens
   the local website.

After `pnpm dev` rebuilds, click the reload icon on the extension's card (or reopen the
popup for UI-only changes). The service worker's console is under **Inspect views: service
worker**.

## Use it with production (career.isayev.app) without the store

```sh
pnpm build:sideload       # production build into dist, with the fixed id
```

Load `dist` unpacked as above. It talks to `https://career.isayev.app` and keeps the id
`ajbdeolccbgjinhdmllogiefhmcogpma`, which production allows (`EXTENSION_ALLOWED_IDS` in the
NAS `.env`). `pnpm build`, `pnpm package` and `pnpm build:dev` overwrite `dist`; run
`pnpm build:sideload` again afterwards. `package.mjs` refuses to zip a sideload build.

## Edge

```sh
pnpm build:edge           # production build for Edge into dist-edge
```

For local development in Edge, load `dist` (the development build) in `edge://extensions`
with **Developer mode** on. It has the same id as in Chrome. The Edge build only changes the
client name the extension reports ("· Edge").

## Pointing at another CareerOS

The CareerOS URL is fixed at build time, so tokens can only go to that origin:

| Build | Default | Override |
|---|---|---|
| `pnpm build:dev`, `pnpm dev` | `http://localhost:3000` | `CAREEROS_URL=https://staging.example pnpm build:dev` |
| `pnpm build`, `pnpm build:edge`, `pnpm package` | `https://career.isayev.app` | `CAREEROS_URL=… pnpm build` |

The URL sets the API base, `host_permissions` and the CSP `connect-src` together. For a
server other than localhost, add the extension's id to that server's
`EXTENSION_ALLOWED_IDS`.

## Backend configuration

| Variable | Development | Production |
|---|---|---|
| `EXTENSION_ALLOWED_IDS` | Empty (any id) or `ajbdeolccbgjinhdmllogiefhmcogpma` | Chrome Web Store id and Edge Add-ons id, comma-separated. **Required**: empty refuses every extension |
| `EXTENSION_AUTH_CODE_TTL_SECONDS` | 120 | 120 |
| `EXTENSION_MIN_VERSION` | 0.1.0 | Raise to retire old versions |
| `EXTENSION_LOOKUPS_PER_HOUR` | 600 | 600 |

Restart the API after changes (`docker compose up -d api`). The worker runs the imports;
restart it after backend code changes too (`docker compose restart worker`).

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | Development build with watch |
| `pnpm build:dev` | Development build (`dist`) |
| `pnpm build` | Production build (`dist`) |
| `pnpm build:sideload` | Production build with the fixed id, for loading unpacked against career.isayev.app |
| `pnpm build:edge` | Production build for Edge (`dist-edge`) |
| `pnpm package` / `pnpm package:edge` | Production build and zip into `release/` |
| `pnpm typecheck` | TypeScript |
| `pnpm test` | Unit tests |
| `pnpm test:live` | Tests against the running API |
| `pnpm test:e2e` | Builds `dist-e2e` and runs the Chromium tests |

The first `pnpm test:e2e` needs Playwright's Chromium: `pnpm exec playwright install chromium`.

## Project layout

```
careeros-extension/
  docs/           these documents
  scripts/        build.mjs, manifest.mjs (generated manifest), package.mjs, dev-public-key.txt
  public/         static assets copied as is
  src/
    background/   service worker: auth, API client, tabs, imports, menus, router
    content/      extractor entry (injected on demand)
    extraction/   page reading: structured data, meta, adapters, detection, text
    pages/        popup.html, sidepanel.html, options.html, styles.css (design tokens)
    popup/ sidepanel/ options/   React entry points
    shared/       message contract, API types, policy, settings, logger, config
    ui/           components, hooks and views
  test/
    fixtures/pages/   local job pages
    unit/ live/ e2e/
```

## Conventions

- Only the service worker calls the API. UI pages use `send()` from `src/ui/client.ts`, and
  every new message type goes into `src/shared/messages.ts` with validation in
  `parseRequest`.
- New API fields: add them to `src/shared/api-types.ts` by hand from the API schemas, and to
  the live test if the extension depends on them.
- Styling: the CareerOS tokens in `src/pages/styles.css` (copied from
  `apps/web/app/globals.css`; keep them in sync) and `DESIGN.md`. Captions are at least
  12 px, controls 36 px, with one focus ring.
- Settings shape changes: bump `SETTINGS_VERSION` and add a migration step.
- Permissions: changing the manifest's permissions means updating
  [SECURITY.md](SECURITY.md) and the store listing's justifications.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "This browser extension isn't allowed to connect to CareerOS." | The id isn't in `EXTENSION_ALLOWED_IDS` (or the API runs with `ENVIRONMENT=production` and the list is empty) |
| The connect window asks you to sign in | Expected when this browser profile isn't signed in to CareerOS: the window uses the profile's cookies. Sign in on the same origin as the build (`localhost`, not `127.0.0.1`) to skip it next time |
| "CareerOS can't be reached" | The stack isn't running, or the build points at another URL (Options → Account shows the CareerOS host the build uses) |
| The side panel says "Click the CareerOS icon to read this page" | Expected after switching tabs with the panel open (`activeTab` is per click); click the icon or allow the site |
| Imports stay at "Reading the posting" | The Celery worker isn't running or runs old code: `docker compose restart worker` |
| Styles missing after adding a new folder | Tailwind scans from `src/pages`; `@source "../"` in `styles.css` covers `src/**` |
