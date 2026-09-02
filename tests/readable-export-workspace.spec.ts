import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ viewport: { width: 390, height: 844 } });

test("relatório baixado é idêntico à prévia e mantém as escalas separadas", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") posts.push(request.url()); });
  await page.goto("/?native=1");
  await page.evaluate(async () => {
    const data = await import("/src/data/index.ts"); const domain = await import("/src/domain/index.ts"); const date = domain.todayInTimeZone(domain.APP_TIME_ZONE);
    await data.recordEnergy({ value: 4, localDate: date }); await data.recordEnergy({ value: 5, localDate: date });
    await data.recordGenericEvent({ domain: "humor", localDate: date, summary: "Escala funcional sintética.", payload: { eventKind: "mood-functional-check-in", scaleVersion: "mentor-functional-scales-v1", energy: domain.known(2) } });
    await data.recordGenericEvent({ domain: "financas", localDate: date, summary: "Não selecionado no relatório.", payload: { eventKind: "finance-note", note: domain.known("FORA_DO_RELATORIO_SINTETICO") } });
  });
  await page.reload();
  await page.getByRole("button", { name: "Arquivo", exact: true }).click();
  await page.getByRole("button", { name: /^Relatório para consulta/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: "Revisar geração", exact: true })).toBeDisabled();
  await sheet.getByRole("button", { name: "Humor e energia", exact: true }).click();
  const preview = sheet.locator("pre");
  await expect(preview).toContainText("Energia rápida: 4,5 (1 a 5) (n=2)");
  await expect(preview).toContainText("Energia funcional: 2,0 (0 a 4) (n=1)");
  await expect(preview).not.toContainText("FORA_DO_RELATORIO_SINTETICO");
  const expectedText = await preview.textContent();
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("previa-escalas-separadas.png") });
  await sheet.getByRole("button", { name: "Revisar geração", exact: true }).click();
  const generate = sheet.getByRole("button", { name: "Confirmar e gerar arquivo", exact: true });
  await expect(generate).toBeDisabled();
  await sheet.getByRole("checkbox", { name: /^Revisei o conteúdo/ }).check();
  const downloading = page.waitForEvent("download"); await generate.click(); const download = await downloading;
  const savedPath = test.info().outputPath("relatorio-sintetico.txt"); await download.saveAs(savedPath);
  const content = await readFile(savedPath, "utf8");
  expect(content).toBe(expectedText);
  expect(content).toContain("energia rápida 5/5");
  expect(content).toContain("texto sem criptografia");
  expect(posts).toEqual([]);
});

test("JSON e CSV saem pelos botões reais com campos preservados e aviso visível", async ({ page }) => {
  await page.goto("/?native=1");
  await page.evaluate(async () => {
    const data = await import("/src/data/index.ts"); const domain = await import("/src/domain/index.ts");
    await data.recordGenericEvent({ domain: "conhecimento", localDate: domain.todayInTimeZone(domain.APP_TIME_ZONE), summary: "Fixture de exportação legível.", payload: { eventKind: "knowledge-note", state: "known", value: "=1+1", summary: domain.known("MARCADOR_EXPORTACAO_SINTETICO") } });
  });
  await page.reload(); await page.getByRole("button", { name: "Arquivo", exact: true }).click();
  await expect(page.getByText(/JSON e CSV são arquivos sem criptografia/)).toBeVisible();
  const jsonDownloading = page.waitForEvent("download"); await page.getByRole("button", { name: /^JSON/ }).click(); const jsonDownload = await jsonDownloading;
  const jsonPath = test.info().outputPath("exportacao-sintetica.json"); await jsonDownload.saveAs(jsonPath);
  const envelope = JSON.parse(await readFile(jsonPath, "utf8"));
  const record = envelope.records.find((item) => item.values.summary === "MARCADOR_EXPORTACAO_SINTETICO");
  expect(record.values).toEqual({ eventKind: "knowledge-note", state: "known", value: "=1+1", summary: "MARCADOR_EXPORTACAO_SINTETICO" });
  expect(envelope.note).toContain("sem criptografia");
  const csvDownloading = page.waitForEvent("download"); await page.getByRole("button", { name: /^CSV/ }).click(); const csvDownload = await csvDownloading;
  const csvPath = test.info().outputPath("exportacao-sintetica.csv"); await csvDownload.saveAs(csvPath);
  const csv = await readFile(csvPath, "utf8");
  expect(csv).toContain('""eventKind"":""knowledge-note""');
  expect(csv).toContain('""value"":""=1+1""');
  expect(csv).not.toMatch(/,"=1\+1"(?:\r?\n|$)/);
});

test("bloqueio de campo ambíguo é visível e não baixa arquivo parcial", async ({ page }) => {
  const errors: string[] = []; const downloads: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await page.goto("/?native=1");
  const id = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts"); const domain = await import("/src/domain/index.ts");
    const record = await data.recordGenericEvent({ domain: "humor", localDate: domain.todayInTimeZone(domain.APP_TIME_ZONE), summary: "Fixture de bloqueio legível.", payload: { eventKind: "mood-functional-check-in", context: { state: "unknown", reason: "withheld", value: "RESIDUAL_SINTETICO", futureMetadata: "ambígua" } } });
    return record.id;
  });
  await page.reload(); await page.getByRole("button", { name: "Arquivo", exact: true }).click();
  await page.getByRole("button", { name: /^JSON/ }).click();
  await expect(page.getByText(/Um campo ambíguo contém valor antigo/)).toBeVisible();
  await page.getByRole("button", { name: /^CSV/ }).click();
  await expect(page.getByText(/Um campo ambíguo contém valor antigo/)).toBeVisible();
  expect(downloads).toEqual([]); expect(errors).toEqual([]);
  const stored = await page.evaluate(async (id) => { const data = await import("/src/data/index.ts"); return (await data.getEntity(id, "generic.event"))?.payload; }, id);
  expect(stored.context.value).toBe("RESIDUAL_SINTETICO");
});
