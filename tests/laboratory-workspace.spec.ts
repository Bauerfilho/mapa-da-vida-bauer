import { expect, test } from "@playwright/test";

test("Meus exames abre a linha do tempo antes do formulário", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await page.getByRole("button", { name: /^Meus exames / }).click();
  await expect(page.getByTestId("laboratory-workspace")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Meus exames", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Adicionar exame ou laudo/ })).toBeVisible();
});

test("painel com laudo mantém campos e bytes após backup e restauração em outro perfil", async ({ page, browser }) => {
  test.setTimeout(40_000);
  await page.goto("/");
  const source = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const lab = await import("/src/domain/laboratory.ts");
    const attachment = await lab.createLaboratoryAttachment(new File(["%PDF-1.4\nLaudo sintetico sem paciente\n%%EOF"], "laudo-sintetico.pdf", { type: "application/pdf" }));
    const payload = lab.buildLaboratoryPanel({ title: "Coleta sintética", collectedOn: "2026-09-01", referenceDate: "2026-09-02", note: "Somente dados de teste.", attachments: [attachment], results: [
      { analyte: "Hemoglobina", kind: "numeric", value: "12,8", unit: "g/dL", referenceLow: "12", referenceHigh: "16" },
      { analyte: "Cultura", kind: "text", value: "Sem crescimento. Amostra sintética." },
    ] });
    const saved = await data.recordGenericEvent({ domain: "exames", localDate: payload.collectedOn, payload, summary: "Teste do contrato de laudo." });
    const backup = await data.exportEncryptedBackup("somente-cenario-sintetico");
    return { serialized: await backup.blob.text(), id: saved.id, payload };
  });
  const context = await browser.newContext();
  const target = await context.newPage();
  try {
    await target.goto(page.url());
    const recovered = await target.evaluate(async ({ serialized, id }) => {
      const data = await import("/src/data/index.ts");
      const lab = await import("/src/domain/laboratory.ts");
      const staged = await data.validateAndStageEncryptedBackup(serialized, "somente-cenario-sintetico", "laboratorio.bauerlife");
      await data.applyStagedImport(staged.importId, { expectedPlanDigest: staged.preview.planDigest, mode: "safe-only" });
      const entity = await data.getEntity(id, "generic.event");
      if (!entity || !lab.isLaboratoryPanelEntity(entity)) throw new Error("Painel não foi restaurado.");
      await lab.verifyLaboratoryAttachments(entity.payload);
      return { domain: entity.domain, localDate: entity.localDate, payload: entity.payload };
    }, source);
    expect(recovered.domain).toBe("exames");
    expect(recovered.localDate).toBe("2026-09-01");
    expect(recovered.payload).toEqual(source.payload);
    expect(recovered.payload.attachments[0].dataBase64).toBe(source.payload.attachments[0].dataBase64);
    expect(recovered.payload.attachments[0].sha256).toBe(source.payload.attachments[0].sha256);
  } finally { await context.close(); }
});

test("domínio trocado, hash adulterado e data incoerente são rejeitados sem gravar", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const lab = await import("/src/domain/laboratory.ts");
    const attachment = await lab.createLaboratoryAttachment(new File(["%PDF-1.4\nTeste\n%%EOF"], "teste.pdf", { type: "application/pdf" }));
    const payload = lab.buildLaboratoryPanel({ title: "Teste de rejeição", collectedOn: "2026-09-01", referenceDate: "2026-09-02", attachments: [attachment], results: [{ analyte: "Analito sintético", kind: "numeric", value: "3", unit: "u" }] });
    const before = (await data.listEntities({})).length;
    const variants = [
      { domain: "conhecimento", localDate: payload.collectedOn, payload },
      { domain: "exames", localDate: "2026-08-31", payload },
      { domain: "exames", localDate: payload.collectedOn, payload: { ...payload, attachments: [{ ...attachment, sha256: "0".repeat(64) }] } },
    ];
    const attempts = await Promise.allSettled(variants.map((input) => data.recordGenericEvent({ ...input, summary: "Teste negativo." })));
    return { rejected: attempts.filter((attempt) => attempt.status === "rejected").length, before, after: (await data.listEntities({})).length };
  });
  expect(result.rejected).toBe(3);
  expect(result.after).toBe(result.before);
});

test("edição especializada preserva texto, anexo e revisão anterior", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const lab = await import("/src/domain/laboratory.ts");
    const payload = lab.buildLaboratoryPanel({ title: "Coleta para editar", collectedOn: "2026-09-01", referenceDate: "2026-09-02", results: [{ analyte: "Resultado textual", kind: "text", value: "Sem crescimento. Preservar pontuação." }] });
    const entity = await data.recordGenericEvent({ domain: "exames", localDate: payload.collectedOn, payload, summary: "Teste inicial." });
    const updatedPayload = lab.buildLaboratoryPanel({ title: "Coleta revisada", collectedOn: "2026-09-01", referenceDate: "2026-09-02", results: [{ analyte: "Resultado textual", kind: "text", value: "Sem crescimento. Preservar pontuação." }] });
    const updated = await data.updateLaboratoryPanel({ entityId: entity.id, expectedRevision: entity.revision, payload: updatedPayload });
    let staleRejected = false;
    try { await data.updateLaboratoryPanel({ entityId: entity.id, expectedRevision: entity.revision, payload }); } catch { staleRejected = true; }
    const db = await data.openMentorDatabase();
    const revisions = (await db.getAll("revisions")).filter((revision) => revision.entityId === entity.id);
    return { idSame: updated.id === entity.id, revision: updated.revision, text: updated.payload.results[0].value, history: revisions.length, staleRejected };
  });
  expect(result.idSame).toBe(true); expect(result.revision).toBe(2); expect(result.history).toBe(2); expect(result.staleRejected).toBe(true);
  expect(result.text).toMatchObject({ state: "known", value: { kind: "text", value: "Sem crescimento. Preservar pontuação." } });
});

test("metadados extras fora do payload não contornam o envelope do laboratório", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const lab = await import("/src/domain/laboratory.ts");
    const payload = lab.buildLaboratoryPanel({ title: "Envelope sintético", collectedOn: "2026-09-01", referenceDate: "2026-09-02", results: [{ analyte: "A", kind: "numeric", value: "1", unit: "u" }] });
    const entity = await data.recordGenericEvent({ domain: "exames", localDate: payload.collectedOn, payload, summary: "Fixture sintética." });
    return { valid: data.isMentorEntityCandidate(entity, entity.datasetId), extra: data.isMentorEntityCandidate({ ...entity, attachmentExtra: "conteúdo fora do contrato" }, entity.datasetId) };
  });
  expect(result).toEqual({ valid: true, extra: false });
});

test("captura e edição pela interface preservam número pequeno, referência e laudo", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await page.getByRole("button", { name: /^Meus exames / }).click();
  await page.getByRole("button", { name: "Adicionar exame ou laudo", exact: true }).click();
  await page.getByLabel("Título do painel", { exact: true }).fill("Coleta visual sintética");
  await page.getByLabel("Data da coleta", { exact: true }).fill("2026-09-01");
  await page.getByLabel("Nome do exame 1", { exact: true }).fill("Analito de precisão");
  await page.getByLabel("Unidade 1", { exact: true }).fill("mIU/L");
  await page.getByLabel(/^Valor 1/).fill("0,0000004");
  await page.locator("summary").filter({ hasText: "Referência do laudo" }).click();
  await page.getByLabel("Limite superior 1", { exact: true }).fill("0,000001");
  await page.getByLabel("Anexar laudo", { exact: true }).setInputFiles({ name: "laudo-sintetico.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nLaudo de teste\n%%EOF") });
  await expect(page.locator(".lab-file")).toContainText("laudo-sintetico.pdf");
  await page.getByRole("button", { name: "Guardar meu exame", exact: true }).click();
  await expect(page.locator(".lab-panel-card")).toContainText("0,0000004");
  await expect(page.locator(".lab-panel-card")).toContainText("Limite superior informado: 0,000001");
  await page.getByRole("button", { name: "Editar Coleta visual sintética", exact: true }).click();
  await expect(page.getByLabel(/^Valor 1/)).toHaveValue("0,0000004");
  await page.getByLabel("Observação pessoal (opcional)", { exact: true }).fill("Pontuação. Mantida.");
  await page.getByRole("button", { name: "Salvar nova revisão", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".lab-panel-card")).toContainText("Pontuação. Mantida.");
  await expect(page.locator(".lab-download")).toContainText("laudo-sintetico.pdf");
  const stored = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const panels = await data.listEntities({ domain: "exames" });
    return panels.map((panel) => ({ revision: panel.revision, payload: panel.payload }));
  });
  expect(stored).toHaveLength(1);
  expect(stored[0].revision).toBe(2);
  expect(stored[0].payload.note).toMatchObject({ state: "known", value: "Pontuação. Mantida." });
  expect(stored[0].payload.results[0].value).toMatchObject({ value: { value: 0.0000004 } });
  await page.screenshot({ path: test.info().outputPath("laboratorio-preenchido.png"), fullPage: true });
});
