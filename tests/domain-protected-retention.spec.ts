import { expect, test } from "@playwright/test";
import { canonicalRetentionRow, planProtectedRetention, type RetentionState } from "../src/domain/protectedRetention";
import type { MentorEntity } from "../src/domain/model";

function fixture(date = "2024-01-02"): RetentionState {
  const stamp = `${date}T12:00:00.000Z`;
  const entity: MentorEntity = { id: "old-fact", datasetId: "retention-test", type: "generic.event", domain: "sono", localDate: date as MentorEntity["localDate"], occurredAtUTC: stamp, createdAt: stamp, updatedAt: stamp, timezone: "America/Sao_Paulo", schemaVersion: 1, revision: 1, status: "active", source: "manual", payload: { schema: "sleep-chronology-v1", eventKind: "sleep-chronology" } };
  return { dataset: { id: "retention-test", name: "Teste", status: "active", ownerIdentity: { displayName: "Bauer Vieira", institution: "UNIFIMES", studentNumber: 7 }, createdAt: "2024-01-01T12:00:00.000Z", updatedAt: stamp, dataSchemaVersion: 1, dataRevision: 1, settingsRevision: 0, nextOperationSequence: 1 }, entities: [entity], revisions: [{ id: "rev", entityId: entity.id, datasetId: entity.datasetId, revision: 1, operationId: "op", createdAt: stamp, reason: "test", snapshot: structuredClone(entity) }], operations: [{ id: "op", entityId: entity.id, datasetId: entity.datasetId, kind: "create", status: "committed", sequence: 1, nextRevision: 1, baseRevision: undefined, summary: "Teste", createdAt: stamp }], outbox: [{ id: "out", entityId: entity.id, datasetId: entity.datasetId, operationId: "op", state: "pending", createdAt: stamp }], imports: [], guards: [], syncMeta: [], externalCache: [], lastRunMonth: null };
}
const plan = (state: RetentionState) => planProtectedRetention(state, "2026-09-02", { schema: "local-only-retention-v1", consumers: [] });

test("fato antigo reúne entidade, revisão, operação e fila numa cadeia única", () => {
  const result = plan(fixture()); expect(result.blockers).toEqual([]); expect(result.candidates).toHaveLength(1);
  expect(result.rowIds).toEqual({ entities: ["old-fact"], revisions: ["rev"], operations: ["op"], outbox: ["out"] });
});
test("primeiro ano e mês já concluído bloqueiam sem candidatos executáveis", () => {
  const early = fixture(); early.dataset.createdAt = "2026-09-01T12:00:00.000Z";
  expect(plan(early).blockers).toContain("first_year");
  const repeated = fixture(); repeated.lastRunMonth = "2026-09"; expect(plan(repeated).blockers).toContain("month_done");
});
test("fronteira de 365 dias permanece e atualização nos últimos 60 também", () => {
  expect(plan(fixture("2025-09-03")).candidates).toEqual([]);
  expect(plan(fixture("2025-09-02")).candidates).toHaveLength(0);
  expect(plan(fixture("2025-09-01")).candidates).toHaveLength(1);
  const updated = fixture(); updated.entities[0].updatedAt = "2026-07-05T12:00:00.000Z"; updated.revisions[0].snapshot.updatedAt = updated.entities[0].updatedAt;
  expect(plan(updated).protected[0].reason).toBe("recent_activity");
});
test("definições, seeds e formatos desconhecidos ficam protegidos", () => {
  const definition = fixture(); definition.entities[0].type = "agenda.task"; definition.entities[0].domain = "agenda";
  expect(plan(definition).protected[0].reason).toBe("operational_definition");
  const seed = fixture(); seed.entities[0].source = "seed"; expect(plan(seed).protected[0].reason).toBe("seed");
  const unknown = fixture(); (unknown.entities[0].payload as Record<string, unknown>).schema = "future-schema"; expect(plan(unknown).protected[0].reason).toBe("unsupported_fact");
});
test("transporte, estado de sync ou cache externo impedem modo local-only", () => {
  expect(planProtectedRetention(fixture(), "2026-09-02", { schema: "local-only-retention-v1", consumers: ["future"] }).blockers).toContain("transport_present");
  const sync = fixture(); sync.syncMeta.push({ key: "unknown", value: {} }); expect(plan(sync).blockers).toContain("sync_state_present");
  const external = fixture(); external.externalCache.push({ key: "unknown" }); expect(plan(external).blockers).toContain("external_state_present");
});
test("referência entrante de sobrevivente ou snapshot protege o alvo", () => {
  const current = fixture(); current.guards.push({ nested: { entityId: "old-fact" } }); expect(plan(current).protected[0].reason).toBe("referenced");
  const survivor = fixture(); survivor.entities.push({ ...structuredClone(survivor.entities[0]), id: "new-fact", localDate: "2026-09-01", payload: { schema: "study-session-v1", internatoLink: { entityId: { state: "known", value: "old-fact", source: "user" } } } });
  expect(plan(survivor).candidates).toEqual([]); expect(plan(survivor).protected.some((item) => item.entityId === "old-fact" && item.reason === "referenced")).toBe(true);
});
test("fila e operações incoerentes não recebem conversão silenciosa", () => {
  for (const state of ["failed", "synced"] as const) { const data = fixture(); data.outbox[0].state = state; expect(plan(data).candidates).toEqual([]); }
  const wrong = fixture(); wrong.outbox[0].operationId = "different"; expect(plan(wrong).protected[0].reason).toBe("broken_chain");
  const missing = fixture(); missing.revisions = []; expect(plan(missing).candidates).toEqual([]);
});
test("importação em andamento e rollback ainda elegível bloqueiam o lote", () => {
  const data = fixture(); data.imports.push({ id: "import", datasetId: data.dataset.id, format: "bauerlife", status: "validated", sourceName: "Teste", payloadChecksum: "test", storeCounts: {}, createdAt: "2026-09-01T12:00:00.000Z" }); expect(plan(data).blockers).toContain("import_in_progress");
  const rollback = fixture(); rollback.imports.push({ id: "legacy", datasetId: rollback.dataset.id, format: "legacy-cefaleia", status: "applied", sourceName: "Teste", payloadChecksum: "test", storeCounts: {}, createdAt: "2024-01-02T12:00:00.000Z", legacyAudit: { postApplyDataRevision: 1, postApplySettingsRevision: 0, postApplyOperationSequence: 1 } } as never); expect(plan(rollback).blockers).toContain("rollback_available");
});
test("compromisso futuro e transação pendente não viram fato arquivável", () => {
  const future = fixture(); future.entities[0].domain = "estudos"; future.entities[0].payload = { schema: "study-session-v1", eventKind: "study-session", nextDate: { state: "known", value: "2027-01-01", source: "user" } }; expect(plan(future).protected[0].reason).toBe("retained_payload_date");
  const finance = fixture(); finance.entities[0] = { ...finance.entities[0], domain: "financas", type: "financas.transaction", payload: { status: "pending" } } as MentorEntity; expect(plan(finance).protected[0].reason).toBe("unfinished_commitment");
});
test("comparação canônica admite metadado opcional ausente, mas não apaga undefined do conteúdo", () => {
  expect(canonicalRetentionRow("operations", { id: "a", baseRevision: undefined })).toBe(canonicalRetentionRow("operations", { id: "a" }));
  expect(canonicalRetentionRow("entities", { payload: { field: undefined } })).not.toBe(canonicalRetentionRow("entities", { payload: {} }));
  expect(() => canonicalRetentionRow("entities", { payload: new Date() })).toThrow();
});
test("IDs em chaves de mapas sobreviventes também protegem o registro", () => {
  const data = fixture(); data.guards.push({ byEntityId: { "old-fact": true } });
  expect(plan(data).candidates).toHaveLength(0); expect(plan(data).protected[0].reason).toBe("referenced");
});
test("arrays com propriedades não canônicas não podem passar como sem perdas", () => {
  const array = ["valor visível"] as string[] & { "00"?: string }; array["00"] = "valor que o JSON perderia";
  expect(() => canonicalRetentionRow("entities", { payload: { list: array } })).toThrow();
  const hidden = { id: "a" }; Object.defineProperty(hidden, "secret", { value: "perdido", enumerable: false });
  expect(() => canonicalRetentionRow("entities", hidden)).toThrow();
});
