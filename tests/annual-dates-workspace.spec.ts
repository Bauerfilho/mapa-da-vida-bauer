import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ viewport: { width: 390, height: 844 } });
// Só a data civil é fixa. ClockAPI também intercepta performance e, após reload,
// pode iniciar WAAPI no futuro em relação à timeline nativa do documento.
test.beforeEach(async ({ page }) => {
  await page.addInitScript((epoch) => {
    const NativeDate = Date;
    globalThis.Date = new Proxy(NativeDate, {
      construct(target, args) { return Reflect.construct(target, args.length ? args : [epoch]); },
      apply() { return new NativeDate(epoch).toString(); },
      get(target, key, receiver) { return key === "now" ? () => epoch : Reflect.get(target, key, receiver); },
    });
  }, Date.UTC(2026, 8, 2, 15));
  await page.goto("/?native=1");
});

test("cadastrar, recarregar e editar mantém uma data e revisões", async ({ page }) => {
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.getByRole("button", { name: "Adicionar data anual", exact: true }).click();
  await page.getByLabel("Nome da data anual", { exact: true }).fill("Aniversário sintético");
  await page.getByLabel("Dia da data anual", { exact: true }).fill("2");
  await page.getByLabel("Mês da data anual", { exact: true }).selectOption("9");
  await page.getByLabel("Dias de antecedência", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Guardar data anual", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".annual-row")).toContainText("hoje");
  await page.reload();
  await expect(page.locator(".annual-today-alert")).toContainText("Aniversário sintético");
  await page.locator(".annual-today-alert").click();
  await page.getByRole("button", { name: "Editar Aniversário sintético", exact: true }).click();
  await page.getByLabel("Dias de antecedência", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Salvar revisão da data", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".annual-row")).toContainText("Lembrar 3 dias antes");
  const saved = await page.evaluate(async () => { const data = await import("/src/data/index.ts"); return (await data.listEntities({ domain: "agenda" })).filter((entity) => entity.payload.schema === "agenda-annual-date-v1").map((entity) => ({ revision: entity.revision, label: entity.payload.label })); });
  expect(saved).toEqual([{ revision: 2, label: "Aniversário sintético" }]);
  await page.screenshot({ path: test.info().outputPath("agenda-anual-nativa.png"), fullPage: true });
});

test("duas datas e uma consulta no mesmo dia aparecem sem se substituir", async ({ page }) => {
  await page.evaluate(async () => {
    const data = await import("/src/data/index.ts"); const annual = await import("/src/domain/annualDates.ts");
    for (const label of ["Pessoa sintética A", "Pessoa sintética B"]) await data.recordGenericEvent({ domain: "agenda", payload: annual.createAnnualDate({ kind: "birthday", label, month: 9, day: 2 }), summary: "Teste de simultaneidade." });
    await data.createAgendaEvent({ title: "Consulta sintética", status: "confirmed", priority: "normal", plannedStartLocal: "2026-09-02T09:00", plannedEndLocal: "2026-09-02T10:00" });
  });
  await page.reload(); await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await expect(page.locator(".agenda-day-list li")).toHaveCount(3);
  for (const name of ["Pessoa sintética A", "Pessoa sintética B", "Consulta sintética"]) await expect(page.locator(".agenda-day-list")).toContainText(name);
});

test("data anual antiga mantém nome e regras no backup restaurado em outro perfil", async ({ page, browser }) => {
  test.setTimeout(40_000);
  const source = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts"); const annual = await import("/src/domain/annualDates.ts");
    const payload = annual.createAnnualDate({ kind: "birthday", label: "Bissexto de teste", month: 2, day: 29, nonLeapYearPolicy: "mar01", reminderLeadDays: 0 });
    const entry = await data.recordGenericEvent({ domain: "agenda", localDate: "2024-01-01", occurredAtUTC: "2024-01-01T12:00:00.000Z", payload, summary: "Teste de longevidade." });
    const workspace = await data.getMentorWorkspace("2026-09-02"); const backup = await data.exportEncryptedBackup("calendario-sintetico-seguro");
    return { serialized: await backup.blob.text(), id: entry.id, payload, retained: workspace.entities.some((entity) => entity.id === entry.id) };
  });
  expect(source.retained).toBe(true);
  const context = await browser.newContext(); const target = await context.newPage();
  try {
    await target.goto(page.url());
    const result = await target.evaluate(async ({ serialized, id }) => {
      const data = await import("/src/data/index.ts"); const annual = await import("/src/domain/annualDates.ts");
      const staged = await data.validateAndStageEncryptedBackup(serialized, "calendario-sintetico-seguro", "calendario.bauerlife");
      await data.applyStagedImport(staged.importId, { expectedPlanDigest: staged.preview.planDigest, mode: "safe-only" });
      const entry = await data.getEntity(id, "generic.event"); if (!entry) throw new Error("Data não restaurada.");
      return { payload: entry.payload, next: annual.projectAnnualDates([entry], "2027-01-01", "2027-12-31").occurrences[0].localDate };
    }, source);
    expect(result.payload).toEqual(source.payload); expect(result.next).toBe("2027-03-01");
  } finally { await context.close(); }
});

test("schema, envelope e edição fora dos limites falham sem corromper o registro", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts"); const annual = await import("/src/domain/annualDates.ts");
    const payload = annual.createAnnualDate({ kind: "birthday", label: "Nome sintético", month: 9, day: 2, note: "Nota preservada." });
    const entry = await data.recordGenericEvent({ domain: "agenda", payload, summary: "Fixture para editar." });
    const before = await data.getActiveDataset(); let invalidEdits = 0;
    for (const payloadPatch of [{ label: "a".repeat(121) }, { note: { value: "a".repeat(1001) } }, { month: 12 }]) {
      try { await data.updateEntityRevisionAware({ entityId: entry.id, expectedRevision: 1, payloadPatch, summary: "Teste negativo." }); } catch { invalidEdits++; }
    }
    const after = await data.getActiveDataset();
    const invalidCreates = await Promise.allSettled([{ domain: "sono", payload }, { domain: "agenda", payload: { ...payload, recurrenceStatus: ["active"] } }].map((input) => data.recordGenericEvent({ ...input, summary: "Teste negativo." })));
    return { invalidEdits, invalidCreates: invalidCreates.filter((result) => result.status === "rejected").length, unchanged: before.dataRevision === after.dataRevision, revision: (await data.getEntity(entry.id, "generic.event"))?.revision, valid: data.isMentorEntityCandidate(entry, entry.datasetId), wrongDomain: data.isMentorEntityCandidate({ ...entry, domain: "sono" }, entry.datasetId), extra: data.isMentorEntityCandidate({ ...entry, arbitraryExtra: "fora" }, entry.datasetId) };
  });
  expect(result).toEqual({ invalidEdits: 3, invalidCreates: 2, unchanged: true, revision: 1, valid: true, wrongDomain: false, extra: false });
});

test("exportação explícita baixa ICS e não afirma que notificações foram entregues", async ({ page }) => {
  await page.evaluate(async () => { const data = await import("/src/data/index.ts"); const annual = await import("/src/domain/annualDates.ts"); await data.recordGenericEvent({ domain: "agenda", payload: annual.createAnnualDate({ kind: "annual_commitment", label: "Evento anual sintético", month: 12, day: 31, reminderLeadDays: 1 }), summary: "Teste de exportação." }); });
  await page.reload(); await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.getByRole("button", { name: /Levar ao calendário do aparelho/ }).click();
  await expect(page.getByRole("button", { name: "Exportar arquivo de calendário", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Entendi que o calendário receberá nomes e datas." }).check();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar arquivo de calendário", exact: true }).click();
  const download = await downloadPromise; const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const content = await readFile(downloadedPath!, "utf8");
  expect(content).toContain("SUMMARY:Evento anual sintético"); expect(content).toContain("DTSTART;VALUE=DATE:20261231"); expect(content).toContain("TRANSP:TRANSPARENT");
  await expect(page.locator(".annual-notice")).toContainText("precisam ser conferidos");
});

test("exportação bloqueia 29 de fevereiro sem política para anos comuns", async ({ page }) => {
  await page.evaluate(async () => { const data = await import("/src/data/index.ts"); const annual = await import("/src/domain/annualDates.ts"); await data.recordGenericEvent({ domain: "agenda", payload: annual.createAnnualDate({ kind: "birthday", label: "Bissexto pendente", month: 2, day: 29 }), summary: "Teste de regra pendente." }); });
  await page.reload(); await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.getByRole("button", { name: /Levar ao calendário do aparelho/ }).click();
  await page.getByRole("checkbox", { name: "Entendi que o calendário receberá nomes e datas." }).check();
  await expect(page.getByRole("alert")).toContainText("29/02 pendente");
  await expect(page.getByRole("button", { name: "Exportar arquivo de calendário", exact: true })).toBeDisabled();
});
