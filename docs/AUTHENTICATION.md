# CareerOS Companion — Authentication

The extension signs in through the CareerOS website and receives its own session in the
existing session system. There is no second identity system and no client secret in the
extension. Passwords and Google sign-in happen only on the CareerOS website.

## Flow

```
Extension (service worker)              Browser window                    CareerOS
──────────────────────────              ──────────────                    ────────
verifier = random(48 bytes, base64url)
challenge = base64url(SHA-256(verifier))
state = random(24 bytes)
launchWebAuthFlow(interactive) ───────▶ /connect/extension?redirect_uri=
                                          https://<id>.chromiumapp.org/careeros
                                          &code_challenge=…&code_challenge_method=S256
                                          &state=…&client=CareerOS Companion 0.1.0 · Chrome
                                        not signed in → /login?next=… (password or Google)
                                        "Connect CareerOS Companion?"  [Connect] [Cancel]
                                        POST /auth/extension/authorize ──────▶ cookie session + CSRF
                                                                               checks redirect URI and
                                                                               extension id, stores
                                                                               SHA-256(code) in Redis
                                                                               for 120 s, bound to
                                                                               user, challenge, URI
                                        ◀── {redirect_to: …chromiumapp.org/careeros?code=…&state=…}
◀──── browser intercepts chromiumapp.org, hands the URL to this extension only
check origin + path, state, code format
POST /auth/extension/token {code, code_verifier, redirect_uri} ───────────────▶ GETDEL code (single use),
                                                                               compare URI and
                                                                               SHA-256(verifier),
                                                                               start_session(client=
                                                                               "extension")
◀──── {user, session_id, access_token (15 min), refresh_token (30 days), expiries}
refresh token → IndexedDB vault
access token  → chrome.storage.session
```

Code: `src/background/auth.ts`, `pkce.ts`, `tokens.ts`, `vault.ts`; API
`app/auth/extension.py`, `app/auth/extension_router.py`; web
`app/(auth)/connect/extension/page.tsx`, `features/extension/*`.

## What each check prevents

| Check | Where | Prevents |
|---|---|---|
| PKCE S256, verifier never leaves the service worker | Extension, `/token` | A stolen code being redeemed by anyone else |
| Code stored hashed, single use (`GETDEL`), 120 s TTL | API, Redis | Replay; reading codes from Redis |
| Code bound to the redirect URI and challenge, compared in constant time | API | Code injection across extensions |
| Redirect URI must be `https://<32 a–p>.chromiumapp.org/<path>` | API, web | Codes sent to any web origin (open redirect) |
| Extension id allowlist (`EXTENSION_ALLOWED_IDS`); empty in production refuses all | API | Look-alike extensions connecting to CareerOS |
| `state` generated per attempt and compared on return | Extension | Login CSRF (a code from someone else's attempt) |
| Explicit **Connect** click on the website, which names the extension and browser | Web | Silent connection |
| Authorize needs the cookie session and the CSRF header | API | Cross-site requests minting codes |
| Rate limits: authorize 20/h per user, token 30/min per IP, refresh 60/min per IP | API | Brute force |

## Tokens

- **Access token:** the existing JWT (15 minutes, bound to the session id), sent as
  `Authorization: Bearer`. Bearer requests are exempt from CSRF because they don't use
  cookies. The extension sends no cookies (`credentials: "omit"`).
- **Refresh token:** opaque, rotated on every use by the existing `rotate_session`. The old
  token is still accepted for 60 seconds (a refresh that raced). Reuse after that revokes
  the session (`auth.refresh_reuse_detected`). An extension refresh token only refreshes an
  extension session, and a website token can't be used at `/auth/extension/refresh`.
- Refreshes are de-duplicated in the service worker: concurrent API calls wait for one
  refresh. A 401 from refresh clears all tokens and shows the connect screen.
- The access token is renewed 60 s before it expires. A 401 from any API call triggers one
  refresh and one retry.

## Storage

| Secret | Store | Readable by |
|---|---|---|
| Refresh token | IndexedDB `careeros-vault` in the extension origin | Extension pages and the service worker. Not content scripts, not web pages |
| Access token | `chrome.storage.session` (memory, cleared when the browser closes) | Trusted extension contexts only (Chrome's default access level) |

Neither token is ever in `chrome.storage.local` or `sync`, in a URL, in page context or in
the extractor, and neither is logged: the logger redacts any field whose name matches token,
secret, verifier, code and similar. The refresh token is not encrypted at rest beyond the
browser profile's own protection; see [SECURITY.md](SECURITY.md).

## Disconnecting

- **In the extension** (Options → Disconnect, after a confirm): `POST /auth/logout` with the
  Bearer token revokes only this session, then the vault and `storage.session` are cleared.
  If the server can't be reached, local tokens are still cleared.
- **On the website** (Settings → Browser extension): lists connected extensions (name,
  browser, connected, last used) and disconnects any of them
  (`DELETE /auth/extension/sessions/{id}`). That extension's next call gets 401, and it
  shows the connect screen.
- **Password change and account deletion** revoke extension sessions like any other.
- Audit events: `auth.extension_authorized`, `auth.extension_connected`,
  `auth.extension_disconnected`, plus the existing session events.

## Error handling

Messages are in `src/shared/errors.ts`.

| Case | Code | User sees |
|---|---|---|
| User closes the window or clicks Cancel | `connect_cancelled` | A neutral note: "Connecting was cancelled. You can try again whenever you like." |
| `access_denied`, a wrong `state`, a malformed code, or `invalid_grant` (expired, reused or mismatched code) | `connect_failed` | "Connecting didn't work. Try again." |
| Extension id not on the allowlist | `extension_not_allowed` | The connect page: "This browser extension isn't allowed to connect to CareerOS." |
| Refresh token revoked or expired | `invalid_session` | "Your connection to CareerOS ended. Connect again to continue." and the connect screen |
| Server unreachable / offline / slow | `network_error` / `offline` / `timeout` | The matching message with a retry button |
| Extension older than `EXTENSION_MIN_VERSION` | `update_required` | "This version of the extension is too old for CareerOS. Update it to continue." No further calls |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `EXTENSION_ALLOWED_IDS` | empty | Comma-separated extension ids allowed to connect. Empty: any id in development, **none in production** |
| `EXTENSION_AUTH_CODE_TTL_SECONDS` | 120 | Lifetime of a one-time code |
| `EXTENSION_MIN_VERSION` | 0.1.0 | Oldest extension version the API serves |
| `ACCESS_TOKEN_TTL_MINUTES`, `REFRESH_TOKEN_TTL_DAYS` | 15, 30 | Shared with website sessions |

For production, `EXTENSION_ALLOWED_IDS` must list the Chrome Web Store id and the Edge
Add-ons id once both are known (see [CHROME_WEB_STORE_RELEASE.md](CHROME_WEB_STORE_RELEASE.md)).
