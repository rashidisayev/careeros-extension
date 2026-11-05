import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { defines } from "./vite.shared.ts";

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

/** Extension pages and the service worker. The page reader has its own build. */
export default defineConfig(({ mode }) => ({
  root: src("pages"),
  base: "./",
  publicDir: false,
  plugins: [react(), tailwindcss()],
  define: defines(mode),
  resolve: { alias: { "@": src("") } },
  build: {
    outDir: process.env.EXT_OUT_DIR ?? fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: false,
    target: "chrome116",
    modulePreload: false,
    sourcemap: mode !== "production",
    minify: mode === "production",
    assetsInlineLimit: 0,
    rolldownOptions: {
      input: {
        popup: src("pages/popup.html"),
        sidepanel: src("pages/sidepanel.html"),
        options: src("pages/options.html"),
        background: src("background/index.ts"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
}));
