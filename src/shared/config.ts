/**
 * Build-time configuration. The GetCareer server is fixed per build (production:
 * https://getcareer.io, development: http://localhost:3000) so tokens can only ever be
 * sent to the origin the manifest grants access to. See docs/DEVELOPMENT_SETUP.md.
 */
export const CAREEROS_URL = __CAREEROS_URL__.replace(/\/+$/, "");
export const CAREEROS_ORIGIN = new URL(CAREEROS_URL).origin;
export const API_BASE = `${CAREEROS_URL}/api/v1`;
export const EXTENSION_VERSION = __EXTENSION_VERSION__;
export const BUILD_MODE = __BUILD_MODE__;
export const BUILD_TARGET = __BUILD_TARGET__;
export const IS_PRODUCTION = BUILD_MODE === "production";

/** Path inside the GetCareer web app; anything else is refused (no open redirects). */
export function appUrl(path: string): string {
  if (!/^\/[A-Za-z0-9/_\-?=&.%]*$/.test(path) || path.startsWith("//")) {
    throw new Error("Not a GetCareer path");
  }
  return `${CAREEROS_URL}${path}`;
}

/** Major.minor.patch comparison for the server's minimum supported extension version. */
export function isVersionAtLeast(version: string, minimum: string): boolean {
  const a = version.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = minimum.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
