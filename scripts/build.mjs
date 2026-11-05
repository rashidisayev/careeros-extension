/**
 * Builds the extension into dist/:
 *   popup.html, sidepanel.html, options.html  (React pages)
 *   background.js                             (service worker, ES module)
 *   extractor.js                              (page reader, one self-contained IIFE)
 *   autofill.js                               (AutoFill page side, one self-contained IIFE)
 *   manifest.json, icons/
 *
 *   node scripts/build.mjs --mode production|development [--target chrome|edge] [--watch] [--e2e] [--sideload]
 *   --sideload: a production build that keeps the fixed development key, for loading unpacked
 *   (stable id ajbdeolccbgjinhdmllogiefhmcogpma, allowed by the server). Never for the stores.
 *   CAREEROS_URL=https://staging.example node scripts/build.mjs --mode production
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "vite";
import { manifest } from "./manifest.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "production" },
    target: { type: "string", default: "chrome" },
    watch: { type: "boolean", default: false },
    e2e: { type: "boolean", default: false },
    sideload: { type: "boolean", default: false },
  },
});
const mode = values.mode === "development" ? "development" : "production";
const target = values.target === "edge" ? "edge" : "chrome";
const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
const careerosUrl = process.env.CAREEROS_URL || (mode === "production" ? "https://career.isayev.app" : "http://localhost:3000");
const e2e = values.e2e;
const sideload = values.sideload;
if (e2e && mode === "production") throw new Error("--e2e is for development builds only");
const outDir = `${root}/dist${e2e ? "-e2e" : target === "edge" ? "-edge" : ""}`;

if (mode === "production" && !careerosUrl.startsWith("https://")) {
  throw new Error("Production builds must talk to CareerOS over https");
}

process.env.EXT_MODE = mode;
process.env.EXT_TARGET = target;
process.env.EXT_CAREEROS_URL = careerosUrl;
process.env.EXT_OUT_DIR = outDir;

rmSync(outDir, { recursive: true, force: true });

const watch = values.watch ? {} : null;
await build({ configFile: `${root}/vite.config.ts`, mode, build: { watch } });
for (const script of ["extractor", "autofill"]) {
  process.env.EXT_PAGE_SCRIPT = script;
  await build({ configFile: `${root}/vite.extractor.config.ts`, mode, build: { watch } });
}

// Icons: PNGs rendered from the CareerOS mark (scripts/careeros-mark-512.png, a copy of
// apps/web/public/brand/careeros-mark-512.png in the CareerOS repo) when missing.
const icons = `${root}/public/icons`;
mkdirSync(icons, { recursive: true });
const source = `${root}/scripts/careeros-mark-512.png`;
for (const size of [16, 32, 48, 128]) {
  const file = `${icons}/${size}.png`;
  if (!existsSync(file)) {
    if (process.platform !== "darwin") throw new Error(`Missing ${file}; render it from ${source}`);
    execFileSync("sips", ["-z", String(size), String(size), source, "--out", file], { stdio: "ignore" });
  }
}
cpSync(icons, `${outDir}/icons`, { recursive: true });

writeFileSync(`${outDir}/manifest.json`, `${JSON.stringify(manifest({ version: pkg.version, careerosUrl, mode, target, e2e, sideload }), null, 2)}\n`);
console.log(`CareerOS Companion ${pkg.version} (${mode}, ${target}) -> ${outDir}  [CareerOS: ${careerosUrl}]`);
