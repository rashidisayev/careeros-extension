/**
 * Zips a production build for the Chrome Web Store or Microsoft Edge Add-ons:
 *   release/getcareer-companion-<version>-<target>.zip
 * Refuses development builds (they carry the dev key and localhost access).
 *
 *   node scripts/package.mjs [--target chrome|edge]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const { values } = parseArgs({ options: { target: { type: "string", default: "chrome" } } });
const target = values.target === "edge" ? "edge" : "chrome";
const dist = `${root}/dist${target === "edge" ? "-edge" : ""}`;
const manifest = JSON.parse(readFileSync(`${dist}/manifest.json`, "utf8"));

const problems = [];
if (manifest.key) problems.push("manifest has a development key");
if (manifest.name.includes("(dev)")) problems.push("development build");
if ((manifest.host_permissions ?? []).some((h) => !h.startsWith("https://"))) problems.push("non-https host permission");
if (problems.length) throw new Error(`Not packaging ${dist}: ${problems.join(", ")}. Run the production build first.`);

mkdirSync(`${root}/release`, { recursive: true });
const out = `${root}/release/getcareer-companion-${manifest.version}-${target}.zip`;
if (existsSync(out)) rmSync(out);
// Source maps stay out of store packages.
execFileSync("zip", ["-r", "-X", "-q", out, ".", "-x", "*.map", "-x", ".*"], { cwd: dist, stdio: "inherit" });
console.log(`Packaged ${out}`);
