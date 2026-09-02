import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["domain-agenda.spec.ts", "domain-finance.spec.ts"],
  reporter: "line",
});
