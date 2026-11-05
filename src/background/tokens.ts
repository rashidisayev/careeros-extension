import type { ExtensionTokens, UserOut } from "../shared/api-types";
import { vault } from "./vault";

export type StoredSession = {
  sessionId: string;
  refreshToken: string;
  refreshExpiresAt: string;
  user: UserOut;
};
type Access = { token: string; expiresAt: number };

const SESSION_KEY = "session";
const ACCESS_KEY = "auth.access";
// Refresh a minute early so a request never leaves with a token about to expire.
const EARLY_MS = 60_000;

export const tokenStore = {
  async save(t: ExtensionTokens): Promise<void> {
    const session: StoredSession = {
      sessionId: t.session_id,
      refreshToken: t.refresh_token,
      refreshExpiresAt: t.refresh_token_expires_at,
      user: t.user,
    };
    await vault.set(SESSION_KEY, session);
    const access: Access = { token: t.access_token, expiresAt: Date.parse(t.access_token_expires_at) };
    await chrome.storage.session.set({ [ACCESS_KEY]: access });
  },

  async session(): Promise<StoredSession | null> {
    const s = await vault.get<StoredSession>(SESSION_KEY);
    if (!s || !s.refreshToken) return null;
    if (Date.parse(s.refreshExpiresAt) <= Date.now()) {
      await this.clear();
      return null;
    }
    return s;
  },

  /** A usable access token, or null when it is missing or about to expire. */
  async access(): Promise<string | null> {
    const got = await chrome.storage.session.get(ACCESS_KEY);
    const a = got[ACCESS_KEY] as Access | undefined;
    return a && a.expiresAt - EARLY_MS > Date.now() ? a.token : null;
  },

  async setUser(user: UserOut): Promise<void> {
    const s = await vault.get<StoredSession>(SESSION_KEY);
    if (s) await vault.set(SESSION_KEY, { ...s, user });
  },

  async clear(): Promise<void> {
    await vault.delete(SESSION_KEY);
    await chrome.storage.session.remove(ACCESS_KEY);
  },
};
