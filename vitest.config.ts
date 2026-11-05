import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { defines } from "./vite.shared.ts";

export default defineConfig({
  plugins: [react()],
  define: defines("test"),
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    // The live suite talks to a running GetCareer (npm run test:live); unit tests never do.
    include: (process.env.GETCAREER_LIVE || process.env.CAREEROS_LIVE) ? ["test/live/**/*.test.ts"] : ["test/unit/**/*.test.{ts,tsx}"],
    testTimeout: (process.env.GETCAREER_LIVE || process.env.CAREEROS_LIVE) ? 90_000 : 5_000,
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
  },
});
