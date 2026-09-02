import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }) => { await page.clock.install({ time: new Date("2026-09-02T15:00:00.000Z") }); await page.goto("/?native=1"); });
test("primeiro ano mostra proteção e não oferece retirada", async ({ page }) => {
  await page.getByRole("button", { name: "Arquivo", exact: true }).click();
  await expect(page.getByTestId("protected-retention")).toContainText("O primeiro ano ainda está sendo preservado");
  await expect(page.getByRole("button", { name: "Arquivar lote conferido", exact: true })).toHaveCount(0);
});
test("backup baixado e reaberto autoriza lote; laudo recupera bytes em outro perfil", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const seeded = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts"); const lab = await import("/src/domain/laboratory.ts"); const dataset = await data.getActiveDataset(); const db = await data.openMentorDatabase(); await db.put("datasets", { ...dataset, createdAt: "2024-01-01T12:00:00.000Z" });
    const attachment = await lab.createLaboratoryAttachment(new File(["%PDF-1.4\nLaudo totalmente sintetico\n%%EOF"], "laudo-historico-sintetico.pdf", { type: "application/pdf" }));
    const payload = lab.buildLaboratoryPanel({ title: "Coleta histórica de teste", collectedOn: "2024-01-02", referenceDate: "2026-09-02", results: [{ analyte: "Analito de teste", kind: "numeric", value: "12,3", unit: "u" }], attachments: [attachment] });
    const saved = await data.recordGenericEvent({ domain: "exames", localDate: payload.collectedOn, occurredAtUTC: "2024-01-02T12:00:00.000Z", payload, summary: "Teste de recuperação de documento antigo." }); return { id: saved.id, payload };
  });
  await page.reload(); await expect(page.getByRole("button", { name: /Revisar o arquivo deste mês/ })).toBeVisible();
  await page.getByRole("button", { name: "Arquivo", exact: true }).click();
  await page.getByRole("button", { name: "Criar backup antes de revisar", exact: true }).click();
  await page.getByLabel("Senha do backup", { exact: true }).fill("teste-retencao-nao-pessoal");
  const downloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "Gerar .bauerlife", exact: true }).click();
  const download = await downloadEvent; const savedPath = test.info().outputPath("backup-sintetico-reaberto.bauerlife"); await download.saveAs(savedPath);
  await page.getByRole("button", { name: "Vi o arquivo em Arquivos/Downloads", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByLabel("Backup para conferência de retenção", { exact: true }).setInputFiles(savedPath);
  await page.getByLabel("Senha do backup para retenção", { exact: true }).fill("teste-retencao-nao-pessoal");
  await page.getByRole("button", { name: "Conferir conteúdo e recuperação", exact: true }).click();
  await expect(page.locator(".pr-proof")).toContainText("Arquivo e contexto conferidos");
  await expect(page.getByRole("button", { name: "Arquivar lote conferido", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: /Guardei esse arquivo em local seguro/ }).check();
  await page.getByRole("button", { name: "Arquivar lote conferido", exact: true }).click();
  await expect(page.locator(".pr-success")).toContainText("1 registro arquivado");
  const exists = await page.evaluate(async (id) => !!(await (await import("/src/data/index.ts")).getEntity(id, "generic.event")), seeded.id); expect(exists).toBe(false);
  await page.locator(".pr-success").scrollIntoViewIfNeeded(); await page.screenshot({ path: test.info().outputPath("retencao-confirmada.png") });
  const context = await browser.newContext(); const target = await context.newPage();
  try {
    await target.goto(page.url()); const serialized = await readFile(savedPath, "utf8");
    const recovered = await target.evaluate(async ({ serialized, id }) => { const data = await import("/src/data/index.ts"); const lab = await import("/src/domain/laboratory.ts"); const staged = await data.validateAndStageEncryptedBackup(serialized, "teste-retencao-nao-pessoal", "arquivo-reaberto.bauerlife"); await data.applyStagedImport(staged.importId, { expectedPlanDigest: staged.preview.planDigest, mode: "safe-only" }); const entity = await data.getEntity(id, "generic.event"); if (!entity) throw new Error("Laudo não recuperado."); await lab.verifyLaboratoryAttachments(entity.payload); return entity.payload; }, { serialized, id: seeded.id });
    expect(recovered).toEqual(seeded.payload);
  } finally { await context.close(); }
});
