import { expect, test } from "@playwright/test";

// Estes cenários usam um perfil descartável e dados sintéticos, nunca o banco pessoal.
test.beforeEach(async ({ page }) => { await page.goto("/"); });

test("regime anterior a 365 dias continua presente e não inventa tomadas", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const domain = await import("/src/domain/index.ts");
    const regimen = await data.createMedicationRegimen({
      medicationName: "Registro sintético A", doseLabel: "conforme receita de teste",
      scheduledTimesLocal: ["08:00"], activeFromLocalDate: "2024-01-01",
      occurredAtUTC: "2024-01-01T12:00:00.000Z",
    });
    const workspace = await data.getMentorWorkspace("2026-09-02");
    const report = domain.buildAnalyticsReport(workspace.entities, { days: 60, endLocalDate: "2026-09-02" });
    const metrics = report.domains.medicamentos.metrics;
    return {
      retained: workspace.entities.some((entity) => entity.id === regimen.id),
      planned: metrics.find((metric) => metric.key === "planned_dose_slots")?.value,
      taken: metrics.find((metric) => metric.key === "taken_doses")?.value,
      missing: metrics.find((metric) => metric.key === "taken_doses")?.missing,
      records: (await data.listEntities({ type: "medicamentos.confirmation" })).length,
    };
  });
  expect(result.retained).toBe(true);
  expect(result.planned).toBe(60);
  expect(result.records).toBe(0);
  expect(result.taken).toBe(0);
  expect(result.missing).toBe(60);
});

test("painel de 60 dias lê um regime iniciado antes da janela", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    await data.createMedicationRegimen({
      medicationName: "Registro sintético B", doseLabel: "conforme receita de teste",
      scheduledTimesLocal: ["08:00"], activeFromLocalDate: "2026-01-01",
      occurredAtUTC: "2026-01-01T12:00:00.000Z",
    });
    const snapshot = await data.getDashboardSnapshot({ days: 60, endLocalDate: "2026-09-02" });
    return snapshot.domains.medicamentos.metrics.find((metric) => metric.key === "planned_dose_slots")?.value;
  });
  expect(result).toBe(60);
});

test("confirmações simultâneas do mesmo horário não criam dose duplicada", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const regimen = await data.createMedicationRegimen({
      medicationName: "Registro sintético C", doseLabel: "conforme receita de teste",
      scheduledTimesLocal: ["08:00"], activeFromLocalDate: "2026-09-01",
    });
    const input = { regimenId: regimen.id, localDate: "2026-09-02", scheduledTimeLocal: "08:00", confirmation: "taken_time_unknown" } as const;
    const attempts = await Promise.allSettled([data.recordMedicationDose(input), data.recordMedicationDose(input)]);
    const entities = await data.listEntities({ type: "medicamentos.confirmation" });
    return {
      saved: attempts.filter((attempt) => attempt.status === "fulfilled").length,
      rejected: attempts.filter((attempt) => attempt.status === "rejected").length,
      stored: entities.length,
    };
  });
  expect(result).toEqual({ saved: 1, rejected: 1, stored: 1 });
});

test("restaurar uma dose não duplica o horário nem incrementa a auditoria quando há conflito", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const regimen = await data.createMedicationRegimen({ medicationName: "Registro sintético D", doseLabel: "teste", scheduledTimesLocal: ["08:00"], activeFromLocalDate: "2026-09-01" });
    const input = { regimenId: regimen.id, localDate: "2026-09-02", scheduledTimeLocal: "08:00", confirmation: "taken_time_unknown" } as const;
    const first = await data.recordMedicationDose(input);
    const deleted = await data.deleteEntity({ entityId: first.id, expectedRevision: first.revision });
    const replacement = await data.recordMedicationDose(input);
    const before = await data.getActiveDataset();
    let error = "";
    try { await data.restoreEntity({ entityId: first.id, expectedRevision: deleted.revision }); } catch (reason) { error = String(reason); }
    const after = await data.getActiveDataset();
    const events = await data.listEntities({ type: "medicamentos.confirmation", includeDeleted: true });
    return { error, revisionBefore: before.dataRevision, revisionAfter: after.dataRevision, sequenceBefore: before.nextOperationSequence, sequenceAfter: after.nextOperationSequence, oldStatus: events.find((event) => event.id === first.id)?.status, activeIds: events.filter((event) => event.status === "active").map((event) => event.id), replacementId: replacement.id };
  });
  expect(result.error).toContain("já possui");
  expect(result.revisionAfter).toBe(result.revisionBefore);
  expect(result.sequenceAfter).toBe(result.sequenceBefore);
  expect(result.oldStatus).toBe("deleted");
  expect(result.activeIds).toEqual([result.replacementId]);
});

test("horários equivalentes conflitam mas regimes distintos mantêm seus próprios registros", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const a = await data.createMedicationRegimen({ medicationName: "Registro sintético E", doseLabel: "teste", scheduledTimesLocal: ["08:00"], activeFromLocalDate: "2026-09-01" });
    const b = await data.createMedicationRegimen({ medicationName: "Registro sintético F", doseLabel: "teste", scheduledTimesLocal: ["08:00"], activeFromLocalDate: "2026-09-01" });
    const input = { localDate: "2026-09-02", confirmation: "taken_time_unknown" } as const;
    await data.confirmMedication({ ...input, regimenId: a.id, scheduledTimeLocal: "08:00" });
    let rejected = false;
    try { await data.confirmMedication({ ...input, regimenId: a.id, scheduledTimeLocal: "08:00:00" }); } catch { rejected = true; }
    await data.confirmMedication({ ...input, regimenId: b.id, scheduledTimeLocal: "08:00" });
    return { rejected, stored: (await data.listEntities({ type: "medicamentos.confirmation" })).length };
  });
  expect(result).toEqual({ rejected: true, stored: 2 });
});
