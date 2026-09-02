import { expect, test } from "@playwright/test";

test("Today and workspace advance together across the Sao Paulo civil midnight", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-02T02:59:50.000Z") });
  await page.goto("/tests/mentor-data-lifecycle.html");
  await expect(page.getByTestId("snapshot-date")).toHaveText("2026-09-01");
  await expect(page.getByTestId("workspace-date")).toHaveText("2026-09-01");

  await page.clock.runFor(40_000);

  await expect(page.getByTestId("snapshot-date")).toHaveText("2026-09-02");
  await expect(page.getByTestId("workspace-date")).toHaveText("2026-09-02");
});

test("pageshow and visible visibilitychange refresh external IndexedDB changes", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-01T15:00:00.000Z") });
  await page.goto("/tests/mentor-data-lifecycle.html");
  await expect(page.getByTestId("workspace-count")).not.toHaveText("loading");
  const initialCount = Number(await page.getByTestId("workspace-count").textContent());

  await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    await data.recordEnergy({ value: 2, occurredAtUTC: "2026-09-01T15:01:00.000Z" });
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(page.getByTestId("workspace-count")).toHaveText(String(initialCount + 1));

  await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    await data.recordEnergy({ value: 3, occurredAtUTC: "2026-09-01T15:02:00.000Z" });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("workspace-count")).toHaveText(String(initialCount + 2));
});
