import { expect, test, type Page } from "@playwright/test";

// Os perfis são descartáveis; nomes e senha pertencem apenas à fixture sintética.
const testPassphrase = "fixture-dose-nao-pessoal";

async function canonicalState(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    await data.initializeMentorData();
    const db = await data.openMentorDatabase();
    const stores = ["datasets", "entities", "revisions", "operations", "outbox", "settings"] as const;
    const rows = await Promise.all(stores.map(async (store) => [store, await db.getAll(store)]));
    return JSON.stringify(rows);
  });
}

async function doseArchive(page: Page, history = false) {
  return page.evaluate(async ({ password, history }) => {
    const data = await import("/src/data/index.ts");
    const regimen = await data.createMedicationRegimen({ medicationName: "Sintético D", doseLabel: "teste", scheduledTimesLocal: ["08:00"], activeFromLocalDate: "2026-09-01" });
    const base = await (await data.exportEncryptedBackup(password)).blob.text();
    const input = { regimenId: regimen.id, localDate: "2026-09-02", scheduledTimeLocal: "08:00", confirmation: "taken_time_unknown" } as const;
    let dose = await data.recordMedicationDose(input);
    if (history) {
      await data.deleteEntity({ entityId: dose.id, expectedRevision: dose.revision });
      dose = await data.recordMedicationDose(input);
      await data.confirmMedication({ localDate: "2026-09-02", scheduledTimeLocal: "08:00", medicationName: "Sintético legado", confirmation: "taken_time_unknown" });
      await data.confirmMedication({ localDate: "2026-09-02", scheduledTimeLocal: "08:00", medicationName: "Sintético legado", confirmation: "taken_time_unknown" });
    }
    await data.recordEnergy({ localDate: "2026-09-02", value: 3 });
    return { base, serialized: await (await data.exportEncryptedBackup(password)).blob.text(), regimenId: regimen.id, dose };
  }, { password: testPassphrase, history });
}

async function stageWithRegimen(page: Page, archive: Awaited<ReturnType<typeof doseArchive>>) {
  return page.evaluate(async ({ archive, password }) => {
    const data = await import("/src/data/index.ts");
    const base = await data.validateAndStageEncryptedBackup(archive.base, password, "base-sintetica.bauerlife");
    await data.applyStagedImport(base.importId, { expectedPlanDigest: base.preview.planDigest });
    return data.validateAndStageEncryptedBackup(archive.serialized, password, "dose-sintetica.bauerlife");
  }, { archive, password: testPassphrase });
}

test.beforeEach(async ({ page }) => { await page.goto("/"); });

test("desfazer exclusão não reocupa um horário já registrado nem altera auditoria", async ({ page }) => {
  const fixture = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const regimen = await data.createMedicationRegimen({ medicationName: "Sintético A", doseLabel: "teste", scheduledTimesLocal: ["08:00"], activeFromLocalDate: "2026-09-01" });
    const input = { regimenId: regimen.id, localDate: "2026-09-02", scheduledTimeLocal: "08:00", confirmation: "taken_time_unknown" } as const;
    const first = await data.recordMedicationDose(input);
    const deleted = await data.deleteEntity({ entityId: first.id, expectedRevision: first.revision });
    const session = await data.getEntityEditSession(first.id);
    const replacement = await data.recordMedicationDose(input);
    return { id: first.id, revision: deleted.revision, operationId: session.latestOperation?.id, replacementId: replacement.id };
  });
  const before = await canonicalState(page);
  const error = await page.evaluate(async (fixture) => {
    const data = await import("/src/data/index.ts");
    try { await data.undoEntityMutation({ entityId: fixture.id, expectedRevision: fixture.revision, operationId: fixture.operationId }); return ""; }
    catch (reason) { return String(reason); }
  }, fixture);
  expect(error).toContain("Esta dose já possui um registro");
  expect(await canonicalState(page)).toBe(before);
});

test("backup de outro conjunto não duplica o horário de uma dose local", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const base = await page.evaluate(async (password) => {
    const data = await import("/src/data/index.ts");
    const regimen = await data.createMedicationRegimen({ medicationName: "Sintético B", doseLabel: "teste", scheduledTimesLocal: ["08:00"], activeFromLocalDate: "2026-09-01" });
    const archive = await data.exportEncryptedBackup(password);
    return { regimenId: regimen.id, sourceDatasetId: (await data.getActiveDataset()).id, serialized: await archive.blob.text() };
  }, testPassphrase);
  const targetContext = await browser.newContext();
  const target = await targetContext.newPage();
  await target.goto(page.url());
  try {
    await target.evaluate(async () => {
      const data = await import("/src/data/index.ts");
      // Perfis novos compartilham um ID padrão; a fixture precisa provar um ID realmente diferente.
      const original = await data.getActiveDataset();
      const db = await data.openMentorDatabase();
      const targetId = "fixture-conjunto-destino";
      const tx = db.transaction(["datasets", "entities", "revisions", "operations", "outbox", "settings", "app_meta"], "readwrite");
      await tx.objectStore("datasets").delete(original.id);
      await tx.objectStore("datasets").put({ ...original, id: targetId });
      for (const name of ["entities", "revisions", "operations", "outbox", "settings"] as const) {
        const store = tx.objectStore(name);
        for (const row of await store.getAll()) {
          const moved = { ...row, datasetId: targetId };
          if (name === "revisions") moved.snapshot = { ...row.snapshot, datasetId: targetId };
          if (name === "settings") { await store.delete(row.id); moved.id = `${targetId}:${row.key}`; }
          await store.put(moved);
        }
      }
      await tx.objectStore("app_meta").put({ key: "active_dataset_id", value: targetId, updatedAt: new Date().toISOString() });
      await tx.done;
    });
    // A inicialização fixa o conjunto da sessão; reabrir representa a seleção anterior ao boot.
    await target.reload();
    const targetDatasetId = await target.evaluate(async ({ base, password }) => {
      const data = await import("/src/data/index.ts");
      const staged = await data.validateAndStageEncryptedBackup(base.serialized, password, "regime-sintetico.bauerlife");
      await data.applyStagedImport(staged.importId, { expectedPlanDigest: staged.preview.planDigest });
      await data.recordMedicationDose({ regimenId: base.regimenId, localDate: "2026-09-02", scheduledTimeLocal: "08:00", confirmation: "taken_time_unknown" });
      return (await data.getActiveDataset()).id;
    }, { base, password: testPassphrase });
    expect(targetDatasetId).not.toBe(base.sourceDatasetId);
    const incoming = await page.evaluate(async ({ regimenId, password }) => {
      const data = await import("/src/data/index.ts");
      await data.recordMedicationDose({ regimenId, localDate: "2026-09-02", scheduledTimeLocal: "08:00", confirmation: "taken_time_unknown" });
      const archive = await data.exportEncryptedBackup(password);
      return archive.blob.text();
    }, { regimenId: base.regimenId, password: testPassphrase });
    const before = await canonicalState(target);
    const error = await target.evaluate(async ({ serialized, password }) => {
      const data = await import("/src/data/index.ts");
      try {
        const staged = await data.validateAndStageEncryptedBackup(serialized, password, "dose-sintetica.bauerlife");
        await data.applyStagedImport(staged.importId, { expectedPlanDigest: staged.preview.planDigest });
        return "";
      } catch (reason) { return String(reason); }
    }, { serialized: incoming, password: testPassphrase });
    expect(error).toContain("Esta dose já possui um registro");
    expect(await canonicalState(target)).toBe(before);
  } finally { await targetContext.close(); }
});

test("duas doses distintas no arquivo bloqueiam o lote inteiro inclusive fatos seguros", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const serialized = await page.evaluate(async (password) => {
    const data = await import("/src/data/index.ts");
    const regimen = await data.createMedicationRegimen({ medicationName: "Sintético C", doseLabel: "teste", scheduledTimesLocal: ["08:00", "08:01"], activeFromLocalDate: "2026-09-01" });
    await data.recordMedicationDose({ regimenId: regimen.id, localDate: "2026-09-02", scheduledTimeLocal: "08:00", confirmation: "taken_time_unknown" });
    const second = await data.recordMedicationDose({ regimenId: regimen.id, localDate: "2026-09-02", scheduledTimeLocal: "08:01", confirmation: "taken_time_unknown" });
    const db = await data.openMentorDatabase();
    // Simula um legado com dois IDs e histórico completo, mas colisão lógica de minuto.
    const duplicate = { ...second, payload: { ...second.payload, scheduledTimeLocal: { ...second.payload.scheduledTimeLocal, state: "known", value: "08:00:59" } } };
    await db.put("entities", duplicate);
    for (const revision of await db.getAll("revisions")) {
      if (revision.entityId === second.id) await db.put("revisions", { ...revision, snapshot: duplicate });
    }
    await data.recordEnergy({ localDate: "2026-09-02", value: 3 });
    return (await data.exportEncryptedBackup(password)).blob.text();
  }, testPassphrase);
  const context = await browser.newContext();
  const target = await context.newPage();
  await target.goto(page.url());
  try {
    const before = await canonicalState(target);
    const error = await target.evaluate(async ({ serialized, password }) => {
      const data = await import("/src/data/index.ts");
      try {
        const staged = await data.validateAndStageEncryptedBackup(serialized, password, "legado-com-duplicata.bauerlife");
        await data.applyStagedImport(staged.importId, { expectedPlanDigest: staged.preview.planDigest });
        return "";
      } catch (reason) { return String(reason); }
    }, { serialized, password: testPassphrase });
    expect(error).toContain("Esta dose já possui um registro");
    expect(await canonicalState(target)).toBe(before);
  } finally { await context.close(); }
});

test("restauração legítima mantém histórico excluído e dois legados sem vínculo", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const archive = await doseArchive(page, true);
  const context = await browser.newContext(); const target = await context.newPage(); await target.goto(page.url());
  try {
    const staged = await stageWithRegimen(target, archive);
    const result = await target.evaluate(async (staged) => {
      const data = await import("/src/data/index.ts");
      await data.applyStagedImport(staged.importId, { expectedPlanDigest: staged.preview.planDigest });
      const doses = await data.listEntities({ type: "medicamentos.confirmation", includeDeleted: true });
      return { active: doses.filter((dose) => dose.status === "active").length, deleted: doses.filter((dose) => dose.status === "deleted").length, legacy: doses.filter((dose) => dose.payload.regimenId?.state !== "known").length };
    }, staged);
    expect(result).toEqual({ active: 3, deleted: 1, legacy: 2 });
  } finally { await context.close(); }
});

test("novo ocupante depois da prévia impede qualquer importação parcial", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const archive = await doseArchive(page);
  const context = await browser.newContext(); const target = await context.newPage(); await target.goto(page.url());
  try {
    const staged = await stageWithRegimen(target, archive);
    await target.evaluate(async (regimenId) => {
      const data = await import("/src/data/index.ts");
      await data.recordMedicationDose({ regimenId, localDate: "2026-09-02", scheduledTimeLocal: "08:00", confirmation: "taken_time_unknown" });
    }, archive.regimenId);
    const before = await canonicalState(target);
    const error = await target.evaluate(async (staged) => {
      const data = await import("/src/data/index.ts");
      try { await data.applyStagedImport(staged.importId, { expectedPlanDigest: staged.preview.planDigest }); return ""; }
      catch (reason) { return String(reason); }
    }, staged);
    expect(error).toContain("Esta dose já possui um registro");
    expect(await canonicalState(target)).toBe(before);
  } finally { await context.close(); }
});

test("conflito dentro da transação reverte fato e auditoria já enfileirados", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const archive = await doseArchive(page);
  const context = await browser.newContext(); const target = await context.newPage(); await target.goto(page.url());
  try {
    const staged = await stageWithRegimen(target, archive);
    const before = await canonicalState(target);
    const result = await target.evaluate(async ({ staged, dose }) => {
      const data = await import("/src/data/index.ts");
      const db = await data.openMentorDatabase();
      const stageBefore = await db.getAllFromIndex("import_stage", "by_import", staged.importId);
      const originalAdd = IDBObjectStore.prototype.add;
      let injected = false; let error = "";
      IDBObjectStore.prototype.add = function (value, key) {
        const request = originalAdd.call(this, value, key);
        if (!injected && this.name === "entities" && value?.type === "humor.energy-check-in") {
          injected = true;
          // A energia e o ocupante são enfileirados antes da leitura final de dose na mesma transação.
          originalAdd.call(this, { ...dose, datasetId: value.datasetId, id: "fixture-ocupante-transacional" });
        }
        return request;
      };
      try { await data.applyStagedImport(staged.importId, { expectedPlanDigest: staged.preview.planDigest }); }
      catch (reason) { error = String(reason); }
      finally { IDBObjectStore.prototype.add = originalAdd; }
      return { injected, error, status: (await db.get("imports", staged.importId))?.status, stageUnchanged: JSON.stringify(await db.getAllFromIndex("import_stage", "by_import", staged.importId)) === JSON.stringify(stageBefore) };
    }, { staged, dose: archive.dose });
    expect(result).toEqual({ injected: true, error: expect.stringContaining("Esta dose já possui um registro"), status: "validated", stageUnchanged: true });
    expect(await canonicalState(target)).toBe(before);
  } finally { await context.close(); }
});

test("staging adulterado é recusado antes de criar dose ou fatos do lote", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const archive = await doseArchive(page);
  const context = await browser.newContext(); const target = await context.newPage(); await target.goto(page.url());
  try {
    const staged = await stageWithRegimen(target, archive);
    await target.evaluate(async (id) => {
      const data = await import("/src/data/index.ts"); const db = await data.openMentorDatabase();
      const row = (await db.getAllFromIndex("import_stage", "by_import", id)).find((row) => row.storeName === "entities" && row.value?.type === "medicamentos.confirmation");
      if (!row) throw new Error("Fixture sem dose no staging.");
      await db.put("import_stage", { ...row, value: { ...row.value, payload: { ...row.value.payload, scheduledTimeLocal: { state: "known", value: "08:00:60" } } } });
    }, staged.importId);
    const before = await canonicalState(target);
    const error = await target.evaluate(async (staged) => {
      const data = await import("/src/data/index.ts");
      try { await data.applyStagedImport(staged.importId, { expectedPlanDigest: staged.preview.planDigest }); return ""; }
      catch (reason) { return String(reason); }
    }, staged);
    expect(error).toContain("cópia preparada mudou");
    expect(await canonicalState(target)).toBe(before);
  } finally { await context.close(); }
});
