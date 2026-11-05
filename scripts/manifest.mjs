/**
 * The extension manifest, generated per build so the GetCareer origin, the version and the
 * development key come from one place. Permissions are explained in
 * docs/SECURITY.md; keep that list in sync when changing them.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export function manifest({ version, careerosUrl, mode, target, e2e = false, sideload = false }) {
  const origin = new URL(careerosUrl).origin;
  const dev = mode !== "production";
  const m = {
    manifest_version: 3,
    name: dev ? "GetCareer Companion (dev)" : "GetCareer Companion",
    short_name: "GetCareer",
    version,
    description: "Save job postings to GetCareer, see what you already track, and review every detail before it's saved.",
    minimum_chrome_version: "116",
    icons: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" },
    action: {
      default_title: "GetCareer Companion",
      default_popup: "popup.html",
      default_icon: { 16: "icons/16.png", 32: "icons/32.png" },
    },
    side_panel: { default_path: "sidepanel.html" },
    options_page: "options.html",
    background: { service_worker: "background.js", type: "module" },
    permissions: ["activeTab", "scripting", "storage", "sidePanel", "identity", "contextMenus"],
    host_permissions: [`${origin}/*`],
    optional_host_permissions: ["https://*/*"],
    commands: {
      _execute_action: {
        suggested_key: { default: "Alt+Shift+J" },
        description: "Open GetCareer Companion on this page",
      },
    },
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; connect-src ${origin}; img-src 'self' data:; style-src 'self'; font-src 'self'; default-src 'self'`,
    },
  };
  // A fixed key gives unpacked development builds a stable id (the redirect address the API
  // allows). Store builds get their id from the store and must not carry a key.
  // Sideload builds (production, loaded unpacked) keep it too; package.mjs refuses any key.
  if (dev || sideload) m.key = readFileSync(here("./dev-public-key.txt"), "utf8").trim();
  // Browser tests serve fixture pages from 127.0.0.1; only test builds may read them unasked.
  if (e2e) m.host_permissions.push("http://127.0.0.1/*");
  return m;
}
