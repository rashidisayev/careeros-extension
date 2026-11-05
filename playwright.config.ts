import { defineConfig } from "@playwright/test";

/**
 * Browser tests: the unpacked extension (dist-e2e, built by `pnpm test:e2e`) in Playwright's
 * Chromium, fixture pages from a local server, and a running GetCareer at localhost:3000.
 */
export default defineConfig({
  testDir: "test/e2e",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results",
});
