import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "pages.spec.ts",
  outputDir: "../work/pages-e2e-artifacts",
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:4191/mapa-da-vida-bauer/",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    command: "node tests/pages-server.mjs",
    url: "http://127.0.0.1:4191/mapa-da-vida-bauer/",
    reuseExistingServer: false,
  },
});
