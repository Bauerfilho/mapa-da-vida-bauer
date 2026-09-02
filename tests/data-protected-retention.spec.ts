import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => { await page.clock.install({ time: new Date("2026-09-02T15:00:00.000Z") }); await page.goto("/?native=1"); });
async function oldFact(page: Page) {
  return page.evaluate(async () => {
    const data = await import("/src/data/index.ts"); const domain = await import("/src/domain/model.ts");
    const dataset = await data.getActiveDataset(); const db = await data.openMentorDatabase();
    await db.put("datasets", { ...dataset, createdAt: "2024-01-01T12:00:00.000Z" });
    const entity = await data.recordGenericEvent({ domain: "sono", localDate: "2024-01-02", occurredAtUTC: "2024-01-02T12:00:00.000Z", payload: { schema: "sleep-chronology-v1", eventKind: "sleep-chronology", chronology: { wentToBedLocal: domain.known("22:00"), sleepOnsetLocal: domain.known("23:00"), finalWakeLocal: domain.known("06:00"), leftBedLocal: domain.known("06:30") }, awakeMinutes: domain.known(20), note: domain.unknown() }, summary: "Fato inteiramente sintético para retenção." });
    return entity.id;
  });
}

test("arquivo conferido permite retirar somente a cadeia antiga; backup posterior continua válido", async ({ page, browser }) => {
  test.setTimeout(45_000); const id = await oldFact(page);
  const result = await page.evaluate(async (id) => {
    const data = await import("/src/data/index.ts"); const pass = "teste-retencao-nao-pessoal";
    const original = await data.getEntity(id, "generic.event"); const backup = await data.exportEncryptedBackup(pass);
    const file = new File([backup.blob], "backup-reaberto.bauerlife", { type: backup.blob.type });
    const before = await data.getActiveDataset(); const prepared = await data.prepareProtectedRetention(file, pass);
    const applied = await data.applyProtectedRetention(prepared.proofId); const repeated = await data.applyProtectedRetention(prepared.proofId);
    const after = await data.getActiveDataset(); const missing = (await data.getEntity(id, "generic.event")) == null;
    const db = await data.openMentorDatabase(); const queues = (await db.getAll("outbox")).filter((row) => row.entityId === id);
    const inspected = await data.inspectBackupForRetention(file, pass);
    const nextBackup = await data.exportEncryptedBackup(pass); await data.validateEncryptedBackup(nextBackup.blob, pass);
    return { applied, repeatedStatus: repeated.status, before, after, missing, queues: queues.length, archivedQueues: inspected.stores.outbox.filter((row) => row.entityId === id), serialized: await file.text(), original: original?.payload };
  }, id);
  expect(result.applied.status).toBe("applied"); expect(result.applied.receipt.counts).toEqual({ entities: 1, revisions: 1, operations: 1, outbox: 1 });
  expect(result.missing).toBe(true); expect(result.queues).toBe(0); expect(result.archivedQueues[0].state).toBe("pending");
  expect(result.after.dataRevision).toBe(result.before.dataRevision + 1); expect(result.after.nextOperationSequence).toBe(result.before.nextOperationSequence); expect(result.after.settingsRevision).toBe(result.before.settingsRevision); expect(result.repeatedStatus).toBe("already-applied");
  const context = await browser.newContext(); const target = await context.newPage();
  try {
    await target.goto(page.url());
    const restored = await target.evaluate(async ({ serialized, id }) => { const data = await import("/src/data/index.ts"); const staged = await data.validateAndStageEncryptedBackup(serialized, "teste-retencao-nao-pessoal", "recuperacao.bauerlife"); await data.applyStagedImport(staged.importId, { expectedPlanDigest: staged.preview.planDigest, mode: "safe-only" }); return (await data.getEntity(id, "generic.event"))?.payload; }, { serialized: result.serialized, id });
    expect(restored).toEqual(result.original);
  } finally { await context.close(); }
});
test("arquivo sem a fila, outro conteúdo ou senha errada não autoriza remoção", async ({ page }) => {
  test.setTimeout(45_000); const id = await oldFact(page);
  const result = await page.evaluate(async (id) => {
    const data = await import("/src/data/index.ts"); const db = await data.openMentorDatabase(); const pass = "teste-retencao-nao-pessoal";
    const queue = (await db.getAll("outbox")).find((row) => row.entityId === id)!;
    await db.delete("outbox", queue.id); const incomplete = await data.exportEncryptedBackup(pass); await db.put("outbox", queue);
    const before = await data.getActiveDataset(); let missingQueueRejected = false; let wrongPassRejected = false; let blobRejected = false;
    try { await data.prepareProtectedRetention(new File([incomplete.blob], "incompleto.bauerlife"), pass); } catch { missingQueueRejected = true; }
    const complete = await data.exportEncryptedBackup(pass);
    try { await data.prepareProtectedRetention(new File([complete.blob], "arquivo.bauerlife"), "senha-sintetica-errada"); } catch { wrongPassRejected = true; }
    try { await data.prepareProtectedRetention(complete.blob, pass); } catch { blobRejected = true; }
    let forgedRejected = false; try { await data.applyProtectedRetention("forjado"); } catch { forgedRejected = true; }
    return { missingQueueRejected, wrongPassRejected, blobRejected, forgedRejected, before, after: await data.getActiveDataset(), exists: !!(await data.getEntity(id, "generic.event")) };
  }, id);
  expect(result).toMatchObject({ missingQueueRejected: true, wrongPassRejected: true, blobRejected: true, forgedRejected: true, exists: true }); expect(result.after).toEqual(result.before);
});
test("mudança sem dataRevision em conflito invalida a conferência antes do primeiro delete", async ({ page }) => {
  const id = await oldFact(page);
  const result = await page.evaluate(async (id) => {
    const data = await import("/src/data/index.ts"); const db = await data.openMentorDatabase(); const backup = await data.exportEncryptedBackup("teste-retencao-nao-pessoal");
    const proof = await data.prepareProtectedRetention(new File([backup.blob], "backup.bauerlife"), "teste-retencao-nao-pessoal");
    const dataset = await data.getActiveDataset(); await db.put("conflicts", { id: "conflict-synthetic", datasetId: dataset.id, entityId: id, localRevision: 1, remoteRevision: 2, state: "open", createdAt: "2026-09-02T15:00:00.000Z" });
    let rejected = false; try { await data.applyProtectedRetention(proof.proofId); } catch { rejected = true; }
    return { rejected, sameRevision: dataset.dataRevision === (await data.getActiveDataset()).dataRevision, exists: !!(await data.getEntity(id, "generic.event")) };
  }, id);
  expect(result).toEqual({ rejected: true, sameRevision: true, exists: true });
});
test("falha em cada posição de exclusão reverte os quatro stores e o recibo", async ({ page }) => {
  test.setTimeout(60_000); const id = await oldFact(page);
  const result = await page.evaluate(async (id) => {
    const data = await import("/src/data/index.ts"); const domain = await import("/src/domain/protectedRetention.ts"); const db = await data.openMentorDatabase(); const pass = "teste-retencao-nao-pessoal";
    const backup = await data.exportEncryptedBackup(pass); const file = new File([backup.blob], "backup.bauerlife");
    const snapshot = async () => domain.canonicalRetentionValue(await Promise.all(["app_meta", "datasets", "entities", "revisions", "operations", "outbox", "settings", "metrics_cache"].map((store) => db.getAll(store))));
    const checks = [];
    for (let failureAt = 1; failureAt <= 4; failureAt++) {
      const proof = await data.prepareProtectedRetention(file, pass); const before = await snapshot();
      const originalDelete = IDBObjectStore.prototype.delete; let calls = 0; let rejected = false;
      IDBObjectStore.prototype.delete = function(key) { if (["entities", "revisions", "operations", "outbox"].includes(this.name) && ++calls === failureAt) throw new Error("Falha sintética de transação"); return originalDelete.call(this, key); };
      try { await data.applyProtectedRetention(proof.proofId); } catch { rejected = true; } finally { IDBObjectStore.prototype.delete = originalDelete; }
      checks.push({ rejected, identical: before === await snapshot() }); data.discardProtectedRetentionProof(proof.proofId);
    }
    return { checks, exists: !!(await data.getEntity(id, "generic.event")) };
  }, id);
  expect(result.exists).toBe(true); expect(result.checks).toHaveLength(4); expect(result.checks.every((check) => check.rejected && check.identical)).toBe(true);
});
test("sync local bloqueia e preparar nunca cria staging", async ({ page }) => {
  const id = await oldFact(page);
  const result = await page.evaluate(async (id) => {
    const data = await import("/src/data/index.ts"); const db = await data.openMentorDatabase(); const pass = "teste-retencao-nao-pessoal"; const backup = await data.exportEncryptedBackup(pass); const file = new File([backup.blob], "backup.bauerlife");
    const beforeStage = (await db.getAll("import_stage")).length; const proof = await data.prepareProtectedRetention(file, pass);
    await db.put("sync_meta", { key: "transport-synthetic", value: { enabled: true }, updatedAt: "2026-09-02T15:00:00.000Z" });
    let rejected = false; try { await data.applyProtectedRetention(proof.proofId); } catch { rejected = true; }
    return { rejected, beforeStage, afterStage: (await db.getAll("import_stage")).length, exists: !!(await data.getEntity(id, "generic.event")) };
  }, id);
  expect(result.rejected).toBe(true); expect(result.exists).toBe(true); expect(result.afterStage).toBe(result.beforeStage);
});
test("contexto referenciado ausente no arquivo impede retirar o fato dependente", async ({ page }) => {
  const id = await oldFact(page);
  const result = await page.evaluate(async (id) => {
    const data = await import("/src/data/index.ts"); const db = await data.openMentorDatabase(); const pass = "teste-retencao-nao-pessoal";
    const regimen = await data.createMedicationRegimen({ medicationName: "Contexto sintético", doseLabel: "Conforme documento de teste", scheduledTimesLocal: ["08:00"], activeFromLocalDate: "2024-01-01", occurredAtUTC: "2024-01-01T12:00:00.000Z" });
    const fact = (await data.getEntity(id, "generic.event"))!; const linked = { ...fact, payload: { ...fact.payload, contextRef: regimen.id } }; await db.put("entities", linked);
    const factRevision = (await db.getAll("revisions")).find((row) => row.entityId === id)!; await db.put("revisions", { ...factRevision, snapshot: linked });
    const revisions = (await db.getAll("revisions")).filter((row) => row.entityId === regimen.id); const operations = (await db.getAll("operations")).filter((row) => row.entityId === regimen.id); const outbox = (await db.getAll("outbox")).filter((row) => row.entityId === regimen.id);
    // Constrói arquivo autenticado porém semanticamente incompleto, apenas no perfil sintético.
    await db.delete("entities", regimen.id); for (const row of revisions) await db.delete("revisions", row.id); for (const row of operations) await db.delete("operations", row.id); for (const row of outbox) await db.delete("outbox", row.id);
    const backup = await data.exportEncryptedBackup(pass);
    await db.put("entities", regimen); for (const row of revisions) await db.put("revisions", row); for (const row of operations) await db.put("operations", row); for (const row of outbox) await db.put("outbox", row);
    let rejected = false; try { await data.prepareProtectedRetention(new File([backup.blob], "sem-contexto.bauerlife"), pass); } catch { rejected = true; }
    return { rejected, fact: !!(await data.getEntity(id, "generic.event")), context: !!(await data.getEntity(regimen.id, "generic.event")) };
  }, id);
  expect(result).toEqual({ rejected: true, fact: true, context: true });
});
test("exportação não declara íntegro um array cujo campo adicional seria perdido", async ({ page }) => {
  const id = await oldFact(page);
  const result = await page.evaluate(async (id) => {
    const data = await import("/src/data/index.ts"); const db = await data.openMentorDatabase(); const current = (await data.getEntity(id, "generic.event"))!;
    const array = ["visível"]; array["00"] = "precisa permanecer";
    const changed = { ...current, payload: { ...current.payload, example: array } }; await db.put("entities", changed);
    const revision = (await db.getAll("revisions")).find((row) => row.entityId === id)!; await db.put("revisions", { ...revision, snapshot: changed });
    const preservedInDatabase = (await data.getEntity(id, "generic.event"))?.payload.example["00"];
    let rejected = false; try { await data.exportEncryptedBackup("teste-retencao-nao-pessoal"); } catch { rejected = true; }
    return { rejected, preservedInDatabase };
  }, id);
  expect(result).toEqual({ rejected: true, preservedInDatabase: "precisa permanecer" });
});
test("validade é reconferida após a leitura transacional, antes de excluir", async ({ page }) => {
  const id = await oldFact(page);
  const result = await page.evaluate(async (id) => {
    const data = await import("/src/data/index.ts"); const db = await data.openMentorDatabase(); const pass = "teste-retencao-nao-pessoal";
    const backup = await data.exportEncryptedBackup(pass); const prepared = await data.prepareProtectedRetention(new File([backup.blob], "backup.bauerlife"), pass);
    const originalGetAll = IDBObjectStore.prototype.getAll; const originalNow = Date.now; let reads = 0; let deletes = 0; const originalDelete = IDBObjectStore.prototype.delete; const before = await data.getActiveDataset();
    IDBObjectStore.prototype.getAll = function(...args) { const request = originalGetAll.apply(this, args); if (++reads === 1) Date.now = () => originalNow() + 301_000; return request; };
    IDBObjectStore.prototype.delete = function(key) { deletes++; return originalDelete.call(this, key); };
    let message = ""; try { await data.applyProtectedRetention(prepared.proofId); } catch (error) { message = String(error); } finally { IDBObjectStore.prototype.getAll = originalGetAll; IDBObjectStore.prototype.delete = originalDelete; Date.now = originalNow; }
    return { message, deletes, sameRevision: before.dataRevision === (await data.getActiveDataset()).dataRevision, exists: !!(await data.getEntity(id, "generic.event")) };
  }, id);
  expect(result.message).toContain("expirou durante a espera"); expect(result.deletes).toBe(0); expect(result.sameRevision).toBe(true); expect(result.exists).toBe(true);
});
test("comprovante malformado não fabrica sucesso nem mês concluído", async ({ page }) => {
  await oldFact(page);
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts"); const db = await data.openMentorDatabase(); const dataset = await data.getActiveDataset();
    await db.put("app_meta", { key: `protected_retention_last:${dataset.id}`, value: { proofId: "forjado", referenceDate: "2026-09-02" }, updatedAt: "2026-09-02T15:00:00.000Z" });
    let rejected = false; try { await data.applyProtectedRetention("forjado"); } catch { rejected = true; }
    const preview = await data.getProtectedRetentionPreview(); return { rejected, blocked: preview.blockers.includes("opaque_context"), falselyDone: preview.blockers.includes("month_done") };
  });
  expect(result).toEqual({ rejected: true, blocked: true, falselyDone: false });
});
test("relógio retrocedendo durante as exclusões reverte a transação", async ({ page }) => {
  const id = await oldFact(page);
  const result = await page.evaluate(async (id) => {
    const data = await import("/src/data/index.ts"); const pass = "teste-retencao-nao-pessoal"; const backup = await data.exportEncryptedBackup(pass); const proof = await data.prepareProtectedRetention(new File([backup.blob], "arquivo.bauerlife"), pass);
    const before = await data.getActiveDataset(); const originalDelete = IDBObjectStore.prototype.delete; const originalNow = Date.now; let changed = false;
    IDBObjectStore.prototype.delete = function(key) { const result = originalDelete.call(this, key); if (!changed) { changed = true; Date.now = () => originalNow() - 60_000; } return result; };
    let rejected = false; try { await data.applyProtectedRetention(proof.proofId); } catch { rejected = true; } finally { IDBObjectStore.prototype.delete = originalDelete; Date.now = originalNow; }
    return { rejected, existed: !!(await data.getEntity(id, "generic.event")), sameRevision: before.dataRevision === (await data.getActiveDataset()).dataRevision };
  }, id);
  expect(result).toEqual({ rejected: true, existed: true, sameRevision: true });
});
