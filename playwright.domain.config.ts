import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["domain-*.spec.ts", "dashboard-metrics.spec.ts"],
  // The 365-day performance budget is itself a release assertion. Running
  // other CPU-bound suites beside it makes the measured time reflect worker
  // contention instead of Mentor analytics, so keep this pure-domain gate
  // deterministic and serial.
  workers: 1,
});
