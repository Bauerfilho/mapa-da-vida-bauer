import { expect, test, type Page } from "@playwright/test";

async function prepare(page: Page, unknownCadence = false) {
  await page.goto("/?native=1");
  await page.evaluate(async (unknownCadence) => {
    const data = await import("/src/data/index.ts"); const domain = await import("/src/domain/index.ts");
    const date = domain.todayInTimeZone(domain.APP_TIME_ZONE);
    const rows = unknownCadence
      ? [{ service: "Sem período sintética", price: 0, cadence: null }]
      : [{ service: "Mensal sintética", price: 1990, cadence: "monthly" }, { service: "Anual sintética", price: 23990, cadence: "yearly" }, { service: "Outro período sintético", price: 3200, cadence: "other" }];
    for (const row of rows) {
      await data.recordGenericEvent({ domain: "financas", localDate: date, summary: "Fixture de leitura de assinatura.", payload: {
        schema: "finance-record-v1", eventKind: "finance-subscription", recordMode: "subscription", institution: domain.known("Banco do Brasil"),
        subscription: { service: domain.known(row.service), price: domain.known({ amountMinor: row.price, currency: "BRL" }), cadence: row.cadence ? domain.known(row.cadence) : domain.unknown("not_confirmed"), renewalDate: domain.known(date), status: domain.known("active_confirmed") },
      } });
    }
  }, unknownCadence);
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await page.getByRole("button", { name: /^Finanças/ }).click();
  await page.getByRole("heading", { name: "Histórico financeiro", exact: true }).waitFor();
}

test("período conhecido fora do catálogo é mostrado literalmente, sem conversão", async ({ page }) => {
  await page.goto("/?native=1");
  await page.evaluate(async () => {
    const data = await import("/src/data/index.ts"); const domain = await import("/src/domain/index.ts"); const date = domain.todayInTimeZone(domain.APP_TIME_ZONE);
    await data.recordGenericEvent({ domain: "financas", localDate: date, summary: "Fixture de periodicidade legada.", payload: {
      eventKind: "finance-subscription", institution: domain.known("Banco do Brasil"),
      subscription: { service: domain.known("Legado sintético"), price: domain.known({ amountMinor: 7500, currency: "BRL" }), cadence: domain.known("constructor"), renewalDate: domain.known(date), status: domain.known("active_confirmed") },
    } });
  });
  await page.getByRole("button", { name: "Registrar", exact: true }).click(); await page.getByRole("button", { name: /^Finanças/ }).click();
  const amount = page.locator(".fw-record-list article").filter({ hasText: "Legado sintético" }).locator("em");
  await expect(amount).toContainText("75,00");
  await expect(amount).toContainText("Periodicidade informada: constructor");
  await expect(amount).not.toContainText("Mensal");
});

async function canonical(page: Page) {
  return page.evaluate(async () => {
    const data = await import("/src/data/index.ts"); const db = await data.openMentorDatabase();
    return JSON.stringify(await Promise.all(["datasets", "entities", "revisions", "operations", "outbox"].map((name) => db.getAll(name))));
  });
}

for (const width of [320, 390]) {
  test(`preço e periodicidade são legíveis nas três superfícies em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await prepare(page);
    const before = await canonical(page);
    for (const [service, cadence, price] of [["Mensal sintética", "Mensal", "19,90"], ["Anual sintética", "Anual", "239,90"], ["Outro período sintético", "Outra periodicidade", "32,00"]]) {
      const history = page.locator(".fw-record-list article").filter({ hasText: service });
      const deadline = page.locator(".fw-deadline-list article").filter({ hasText: service });
      await expect(history.locator("em")).toContainText(cadence);
      await expect(history.locator("em")).toContainText(price);
      await expect(deadline.locator("div > span").first()).toContainText(cadence);
      await history.getByRole("button", { name: "Atualizar situação", exact: true }).click();
      await expect(history.locator(".fw-subscription-charge")).toContainText(cadence);
      await expect(history.locator(".fw-subscription-charge")).toContainText(price);
      await history.getByRole("button", { name: "Manter como está", exact: true }).click();
    }
    const measured = await page.locator(".fw-record-list").evaluate((element) => [...element.querySelectorAll("em")].map((node) => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, overflow: node.scrollWidth > node.clientWidth + 1 }; }));
    for (const item of measured) { expect(item.left).toBeGreaterThanOrEqual(0); expect(item.right).toBeLessThanOrEqual(width); expect(item.overflow).toBe(false); }
    expect(await canonical(page)).toBe(before);
    await page.locator(".fw-record-list").scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`assinaturas-${width}.png`) });
  });

  test(`valor zero é preservado e período desconhecido não vira mensal em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 }); await prepare(page, true);
    const history = page.locator(".fw-record-list article").filter({ hasText: "Sem período sintética" });
    await expect(history.locator("em")).toContainText("0,00");
    await expect(history.locator("em")).toContainText("Periodicidade não informada");
    await expect(page.locator(".fw-deadline-list")).toContainText("Periodicidade não informada");
    await history.getByRole("button", { name: "Atualizar situação", exact: true }).click();
    await expect(history.locator(".fw-subscription-charge")).toContainText("Periodicidade não informada");
    await expect(history.locator("em")).not.toContainText("Mensal");
  });
}
