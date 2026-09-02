import { expect, test } from "@playwright/test";

test("uma única observação aparece como um registro, no singular", async ({ page }) => {
  await page.goto("/?native=1");
  await page.evaluate(async () => {
    const data = await import("/src/data/index.ts"); const domain = await import("/src/domain/index.ts");
    await data.recordEnergy({ value: 3, localDate: domain.todayInTimeZone(domain.APP_TIME_ZONE) });
  });
  await page.reload();
  await page.getByRole("button", { name: "Mentor", exact: true }).click();
  await expect(page.locator(".mt-select > span")).toHaveText("O que observar");
  await page.getByLabel("O que observar · sinal da curva", { exact: true }).selectOption("energy");
  await expect(page.locator(".mt-footer > span")).toHaveText(/ · 1 registro$/);
});
