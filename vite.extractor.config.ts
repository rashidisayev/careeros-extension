import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { defines } from "./vite.shared.ts";

/**
 * Page scripts: each one self-contained (no imports) for chrome.scripting.executeScript.
 * EXT_PAGE_SCRIPT picks which: "extractor" (the page reader, default) or "autofill".
 */
const SCRIPTS = {
  extractor: { entry: "./src/content/extractor.ts", name: "CareerOSExtractor" },
  autofill: { entry: "./src/content/autofill.ts", name: "CareerOSAutofill" },
} as const;
const script = (process.env.EXT_PAGE_SCRIPT as keyof typeof SCRIPTS | undefined) ?? "extractor";
const { entry, name } = SCRIPTS[script];

export default defineConfig(({ mode }) => ({
  publicDir: false,
  define: defines(mode),
  build: {
    outDir: process.env.EXT_OUT_DIR ?? fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: false,
    target: "chrome116",
    sourcemap: false,
    minify: mode === "production",
    lib: {
      entry: fileURLToPath(new URL(entry, import.meta.url)),
      formats: ["iife"],
      name,
      fileName: () => `${script}.js`,
    },
  },
}));
