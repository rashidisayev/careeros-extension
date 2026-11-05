import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/** Build-time constants (declared in src/env.d.ts). */
export function defines(mode = process.env.EXT_MODE ?? "development") {
  return {
    __CAREEROS_URL__: JSON.stringify(process.env.EXT_CAREEROS_URL ?? "http://localhost:3000"),
    __EXTENSION_VERSION__: JSON.stringify(pkg.version),
    __BUILD_MODE__: JSON.stringify(mode),
    __BUILD_TARGET__: JSON.stringify(process.env.EXT_TARGET ?? "chrome"),
  };
}
