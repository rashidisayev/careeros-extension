/**
 * Which tabs and frames the extension may work in, for AutoFill and tailored resumes: ordinary
 * websites only, never restricted platforms or GetCareer itself.
 */
import { CAREEROS_ORIGIN } from "../shared/config";
import { ExtensionError, messageFor } from "../shared/errors";
import { pageKind, restrictedPlatformFor } from "../shared/policy";

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** The tab's address, after checking AutoFill may work there at all. */
export async function allowedTab(tabId: number): Promise<string> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new ExtensionError("tab_closed", "This tab is no longer open.");
  }
  const url = tab.url ?? null;
  if (!url) throw new ExtensionError("no_access", messageFor("no_access"));
  if (pageKind(url, CAREEROS_ORIGIN) !== "web") throw new ExtensionError("autofill_unsupported", "AutoFill works on job application forms on other websites.");
  const restricted = restrictedPlatformFor(url);
  if (restricted) {
    throw new ExtensionError(
      "platform_restricted",
      `${restricted.name} doesn't allow other services to read or fill its pages, so GetCareer AutoFill doesn't work there.`,
    );
  }
  return url;
}

/** A frame may be read only if it is an ordinary site (not a restricted platform, not GetCareer). */
export function frameAllowed(frameUrl: string): boolean {
  return pageKind(frameUrl, CAREEROS_ORIGIN) === "web" && !restrictedPlatformFor(frameUrl);
}

export function base64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < view.length; i += 0x8000) out += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(out);
}
