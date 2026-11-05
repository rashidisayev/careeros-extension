/**
 * The connected account and what CareerOS allows for it. `bootstrap` comes from the API
 * (GET /extension/bootstrap) and is the only source of feature access: the extension never
 * decides plans or limits itself. Cached for a few minutes in chrome.storage.session.
 */
import type { Bootstrap } from "../shared/api-types";
import { EXTENSION_VERSION, isVersionAtLeast } from "../shared/config";
import { toErrorInfo, type ExtensionError } from "../shared/errors";
import type { SessionInfo } from "../shared/types";
import { api } from "./api";
import { connect, disconnect } from "./auth";
import { broadcastSession } from "./broadcast";
import { tokenStore } from "./tokens";

const BOOT_KEY = "bootstrap";
const BOOT_TTL_MS = 5 * 60_000;

type CachedBoot = { at: number; data: Bootstrap };

async function cachedBootstrap(): Promise<Bootstrap | null> {
  const got = await chrome.storage.session.get(BOOT_KEY);
  const c = got[BOOT_KEY] as CachedBoot | undefined;
  return c && Date.now() - c.at < BOOT_TTL_MS ? c.data : null;
}

export async function sessionInfo(refresh = false): Promise<SessionInfo> {
  const stored = await tokenStore.session();
  if (!stored) return { connected: false, reason: "never" };
  let bootstrap = refresh ? null : await cachedBootstrap();
  let bootstrapError = null;
  if (!bootstrap) {
    try {
      bootstrap = await api.bootstrap();
      await chrome.storage.session.set({ [BOOT_KEY]: { at: Date.now(), data: bootstrap } satisfies CachedBoot });
      await tokenStore.setUser(bootstrap.user);
    } catch (err) {
      const e = err as ExtensionError;
      if (e.code === "invalid_session" || e.code === "not_connected") {
        await chrome.storage.session.remove(BOOT_KEY);
        return { connected: false, reason: "expired" };
      }
      bootstrapError = toErrorInfo(err);
    }
  }
  return {
    connected: true,
    user: bootstrap?.user ?? stored.user,
    bootstrap,
    bootstrapError,
    updateRequired: !!bootstrap && !isVersionAtLeast(EXTENSION_VERSION, bootstrap.min_extension_version),
  };
}

export async function connectAccount(): Promise<SessionInfo> {
  await connect();
  await chrome.storage.session.remove(BOOT_KEY);
  const info = await sessionInfo(true);
  broadcastSession();
  return info;
}

export async function disconnectAccount(): Promise<SessionInfo> {
  await disconnect();
  // Forget everything tied to the account: cached lookups, imports, bootstrap.
  const all = await chrome.storage.session.get(null);
  await chrome.storage.session.remove(Object.keys(all));
  broadcastSession();
  return { connected: false, reason: "signed_out" };
}
