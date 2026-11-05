/**
 * Connecting the extension to a CareerOS account: an OAuth 2.0 authorization-code flow with
 * PKCE (S256). The user approves on the CareerOS website (/connect/extension), signed in the
 * way they always are, in a window the browser opens for chrome.identity. The website hands
 * back a one-time code to https://<extension-id>.chromiumapp.org/careeros, which only this
 * extension receives; the code is useless without the verifier, which never leaves here.
 * The result is a separate session (client "extension") the user can revoke in Settings.
 */
import type { ExtensionTokens } from "../shared/api-types";
import { BUILD_TARGET, CAREEROS_URL, EXTENSION_VERSION } from "../shared/config";
import { ExtensionError, messageFor } from "../shared/errors";
import { log } from "../shared/log";
import { http } from "./http";
import { codeChallenge, randomString } from "./pkce";
import { tokenStore } from "./tokens";

export const REDIRECT_PATH = "careeros";

export function clientName(): string {
  const browser = BUILD_TARGET === "edge" ? "Edge" : "Chrome";
  return `CareerOS Companion ${EXTENSION_VERSION} · ${browser}`;
}

export function connectUrl(redirectUri: string, challenge: string, state: string): string {
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    client: clientName(),
  });
  return `${CAREEROS_URL}/connect/extension?${params.toString()}`;
}

/** The code from the redirect, after checking it is ours and answers our request. */
export function parseRedirect(responseUrl: string, redirectUri: string, state: string): string {
  let url: URL;
  try {
    url = new URL(responseUrl);
  } catch {
    throw new ExtensionError("connect_failed", messageFor("connect_failed"));
  }
  if (`${url.origin}${url.pathname}` !== redirectUri.replace(/\?.*$/, "")) {
    throw new ExtensionError("connect_failed", messageFor("connect_failed"));
  }
  if (url.searchParams.get("state") !== state) {
    throw new ExtensionError("connect_failed", messageFor("connect_failed"));
  }
  if (url.searchParams.get("error") === "access_denied") {
    throw new ExtensionError("connect_cancelled", messageFor("connect_cancelled"));
  }
  const code = url.searchParams.get("code");
  if (!code || !/^[A-Za-z0-9_-]{20,200}$/.test(code)) {
    throw new ExtensionError("connect_failed", messageFor("connect_failed"));
  }
  return code;
}

export async function connect(): Promise<ExtensionTokens> {
  const redirectUri = chrome.identity.getRedirectURL(REDIRECT_PATH);
  const verifier = randomString(48);
  const state = randomString(24);
  const challenge = await codeChallenge(verifier);
  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: connectUrl(redirectUri, challenge, state), interactive: true });
  } catch (err) {
    // Closing the window is reported as an error ("The user did not approve access.").
    log.info("auth.connect_closed", { reason: err instanceof Error ? err.message.slice(0, 60) : "unknown" });
    throw new ExtensionError("connect_cancelled", messageFor("connect_cancelled"));
  }
  if (!responseUrl) throw new ExtensionError("connect_cancelled", messageFor("connect_cancelled"));
  const code = parseRedirect(responseUrl, redirectUri, state);
  const tokens = await http<ExtensionTokens>("/auth/extension/token", {
    method: "POST",
    body: { code, code_verifier: verifier, redirect_uri: redirectUri },
  });
  await tokenStore.save(tokens);
  log.info("auth.connected", { session_id: tokens.session_id });
  return tokens;
}

let refreshing: Promise<string> | null = null;

/** A new access token from the refresh token; one refresh at a time. */
export function refresh(): Promise<string> {
  refreshing ??= (async () => {
    try {
      const session = await tokenStore.session();
      if (!session) throw new ExtensionError("not_connected", messageFor("not_connected"), 401);
      try {
        const tokens = await http<ExtensionTokens>("/auth/extension/refresh", {
          method: "POST",
          body: { refresh_token: session.refreshToken },
        });
        await tokenStore.save(tokens);
        return tokens.access_token;
      } catch (err) {
        const e = err as ExtensionError;
        if (e.status === 401) {
          // Revoked, expired, or replayed: this connection is over.
          log.info("auth.session_ended", { code: e.code });
          await tokenStore.clear();
          throw new ExtensionError("invalid_session", messageFor("invalid_session"), 401);
        }
        throw err;
      }
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function accessToken(): Promise<string> {
  return (await tokenStore.access()) ?? refresh();
}

/** Ends this extension session on the server (best effort) and forgets it here. */
export async function disconnect(): Promise<void> {
  const token = await tokenStore.access().catch(() => null);
  try {
    const t = token ?? (await refresh().catch(() => null));
    if (t) await http("/auth/logout", { method: "POST", token: t, timeoutMs: 8_000 });
  } catch (err) {
    log.warn("auth.logout_failed", { code: (err as ExtensionError).code });
  } finally {
    await tokenStore.clear();
  }
}
