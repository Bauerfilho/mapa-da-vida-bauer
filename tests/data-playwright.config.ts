import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["data-recovery.spec.ts", "data-revision-editing.spec.ts"],
  timeout: 40_000,
  use: {
    baseURL: "http://127.0.0.1:4178",
    viewport: { width: 1100, height: 1100 },
  },
});
