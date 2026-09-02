import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
test.beforeEach(async ({ page }) => { await page.clock.install({ time: new Date("2026-09-02T15:00:00.000Z") }); await page.goto("/?native=1"); });
async function seedSignals(page: Page) {
  await page.evaluate(async () => {
    const data = await import("/src/data/index.ts"); const { known, unknown } = await import("/src/domain/model.ts");
    const nights = [["2026-01-12", "23:00", "06:00", 30], ["2026-08-27", "23:00", "05:30", 20], ["2026-08-28", "23:30", "06:30", 30], ["2026-08-29", "23:15", "07:00", 20], ["2026-08-31", "00:00", "07:00", 30], ["2026-09-01", "23:15", "06:45", 30], ["2026-09-02", "23:30", "07:00", 20]] as const;
    for (const [date, onset, wake, awake] of nights) await data.recordGenericEvent({ domain: "sono", localDate: date, occurredAtUTC: `${date}T12:00:00.000Z`, payload: { schema: "sleep-chronology-v1", eventKind: "sleep-chronology", chronology: { wentToBedLocal: known("22:30"), sleepOnsetLocal: known(onset), finalWakeLocal: known(wake), leftBedLocal: known("07:30") }, awakeMinutes: known(awake), note: unknown() }, summary: "Cronologia sintética para provar curvas." });
    for (const [date, minutes] of [["2026-08-31", 20], ["2026-09-02", 40]] as const) await data.recordGenericEvent({ domain: "estudos", localDate: date, occurredAtUTC: `${date}T12:00:00.000Z`, payload: { schema: "study-session-v1", eventKind: "study-session", subject: known("Tema de teste"), actualDurationMinutes: known(minutes), minutes: known(minutes) }, summary: "Estudo sintético para provar lacunas." });
  });
  await page.reload();
}
test("curva mostra valores e lacunas, com navegação por teclado e tabela", async ({ page }) => {
  await seedSignals(page); await page.getByRole("button", { name: "Mentor", exact: true }).click();
  await expect(page.getByTestId("metric-trends")).toBeVisible();
  await expect(page.getByTestId("metric-last-value")).toHaveText("7h10");
  await page.getByTestId("mentor-window-switch").getByRole("button", { name: "7 dias", exact: true }).click();
  await expect(page.getByTestId("metric-trends").locator(".mt-period")).toContainText("7 dias");
  await page.getByRole("button", { name: "Dia anterior da curva", exact: true }).click();
  await expect(page.getByTestId("metric-point-detail")).toContainText("7h");
  await page.getByLabel("O que observar · sinal da curva", { exact: true }).selectOption("study-minutes");
  await expect(page.getByTestId("metric-last-value")).toHaveText("40 min");
  const slider = page.getByRole("slider", { name: "Dia da curva", exact: true });
  await slider.focus(); await slider.press("ArrowLeft");
  await expect(page.getByTestId("metric-point-detail")).toContainText("Sem registro neste dia");
  await page.getByRole("button", { name: "Ver valores", exact: true }).click();
  await expect(page.getByTestId("metric-trends").getByRole("table")).toContainText("20 min");
  await expect(page.getByTestId("metric-trends").getByRole("table")).toContainText("40 min");
});
test("365 dias continua selecionado ao entrar numa área e voltar", async ({ page }) => {
  await seedSignals(page); await page.getByRole("button", { name: "Mentor", exact: true }).click();
  await page.getByTestId("mentor-window-switch").getByRole("button", { name: "365 dias", exact: true }).click();
  await expect(page.getByTestId("metric-trends").locator(".mt-period")).toContainText("365 dias");
  await page.getByTestId("metric-trends").getByRole("button", { name: "Abrir Sono", exact: true }).click();
  await expect(page.locator(".domain-screen")).toContainText("365 dias");
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(page.getByTestId("mentor-window-switch").getByRole("button", { name: "365 dias", exact: true })).toHaveAttribute("aria-pressed", "true");
});
test("curva vazia não desenha dado fictício e oferece o registro correto", async ({ page }) => {
  await page.getByRole("button", { name: "Mentor", exact: true }).click();
  await expect(page.getByTestId("metric-trends")).toContainText("A curva começa com um registro");
  await expect(page.getByTestId("metric-trends").locator(".recharts-line-curve")).toHaveCount(0);
  await page.getByRole("button", { name: "Registrar sono", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sono", exact: true })).toBeVisible();
});
test("screenshot nativo mantém o gráfico legível e sem overflow", async ({ page }) => {
  // Captura estática no modo reduzido; o ensaio independente também cobre animação real.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedSignals(page); await page.getByRole("button", { name: "Mentor", exact: true }).click();
  await page.getByTestId("mentor-window-switch").getByRole("button", { name: "7 dias", exact: true }).click();
  await expect(page.getByTestId("metric-last-value")).toHaveText("7h10");
  await expect(page.getByTestId("metric-trends").locator(".recharts-line-curve")).toBeVisible();
  const geometry = await page.getByTestId("metric-trends").evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
  await page.locator(".mt-plot-card").scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("curva-sono-nativa.png") });
  await page.setViewportSize({ width: 320, height: 800 });
  // Medir só scrollWidth seria cego a um componente inteiro fora da tela.
  await expect.poll(async () => page.getByTestId("metric-trends").evaluate((element) => element.getBoundingClientRect().right - innerWidth)).toBeLessThanOrEqual(1);
  await expect.poll(async () => page.getByTestId("metric-trends").evaluate((element) => element.getBoundingClientRect().left)).toBeGreaterThanOrEqual(0);
  const narrow = await page.getByTestId("metric-trends").evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(narrow.scroll).toBeLessThanOrEqual(narrow.client + 1);
  await page.locator(".mt-plot-card").scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("curva-sono-320.png") });
});
test("primeiro toque no ponto seleciona o mesmo dia mostrado na dica", async ({ page }) => {
  await seedSignals(page); await page.getByRole("button", { name: "Mentor", exact: true }).click();
  await page.getByTestId("mentor-window-switch").getByRole("button", { name: "7 dias", exact: true }).click();
  await page.getByRole("button", { name: "Dia anterior da curva", exact: true }).click();
  await page.locator(".mt-plot-card").scrollIntoViewIfNeeded();
  const circle = page.locator(".recharts-line-dots circle").first();
  const bounds = await circle.boundingBox(); if (!bounds) throw new Error("Ponto não foi renderizado.");
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByTestId("metric-point-detail").getByRole("heading")).toHaveText(/27.*ago/);
  await expect(page.getByTestId("metric-point-detail")).toContainText("6h10");
});
test("ciclo bimestral muda a janela sem apagar dados e janela móvel continua disponível", async ({ page }) => {
  await seedSignals(page); await page.getByRole("button", { name: "Mentor", exact: true }).click();
  await expect(page.getByTestId("review-cycle-strip")).toContainText("set–out 2026");
  await expect(page.getByTestId("metric-trends").locator(".mt-period")).toContainText("2 dias");
  await page.getByLabel("Escolher bimestre", { exact: true }).selectOption("2026-07");
  await expect(page.getByTestId("metric-trends").locator(".mt-period")).toContainText("62 dias");
  await page.getByTestId("mentor-window-switch").getByRole("button", { name: "365 dias", exact: true }).click();
  await expect(page.getByTestId("metric-trends").locator(".mt-period")).toContainText("365 dias");
  const count = await page.evaluate(async () => { const data = await import("/src/data/index.ts"); return (await data.listEntities({ domain: "sono" })).length; });
  expect(count).toBe(7);
  await page.getByRole("button", { name: "Ver ciclo atual", exact: true }).click();
  await expect(page.getByTestId("metric-trends").locator(".mt-period")).toContainText("2 dias");
});
