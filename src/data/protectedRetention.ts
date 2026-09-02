import { openMentorDatabase } from "./database";
import { initializeMentorData } from "./seed";
import { inspectBackupForRetention, isMentorEntityCandidate } from "./backup";
import { abortTransactionSafely, assertObservedTransactionCompleted, observeTransactionCompletion } from "./transactionSafety";
import { canonicalRetentionRow, canonicalRetentionValue, planProtectedRetention, retentionFirstEligibleOn, retentionReferenceStrings, RETENTION_STORES, type RetentionPlan, type RetentionState, type RetentionStore } from "../domain/protectedRetention";
import { todayInTimeZone } from "../domain/dates";
import type { DatasetRecord, ImportRecord, MentorEntity, OperationRecord, OutboxRecord, RevisionRecord } from "../domain/model";
import { RETENTION_TRANSPORT_CAPABILITY } from "./transportCapabilities";

const TABLES = ["app_meta", "datasets", "entities", "revisions", "operations", "outbox", "settings", "metrics_cache", "conflicts", "imports", "import_stage", "migration_snapshots", "sync_meta", "external_cache"] as const;
type TableName = typeof TABLES[number];
type Rows = Record<TableName, Array<Record<string, unknown>>>;
const LAST_KEY = "protected_retention_last:";
const PROOF_LIFETIME_MS = 5 * 60_000;
export interface RetentionReceipt { schema: "protected-retention-receipt-v1"; proofId: string; datasetId: string; completedAt: string; referenceDate: string; cutoff: string; counts: Record<RetentionStore, number>; fileChecksum: string; contentChecksum: string; closureChecksum: string; contextChecksum: string; contextEntities: number; beforeDataRevision: number; afterDataRevision: number; }
interface PreparedProof { id: string; createdAt: number; stateMaterial: string; plan: RetentionPlan; fileChecksum: string; contentChecksum: string; closureChecksum: string; contextChecksum: string; contextEntities: number; }
const proofs = new Map<string, PreparedProof>();
function proofIsFresh(proof: PreparedProof): boolean { const age = Date.now() - proof.createdAt; return age >= 0 && age <= PROOF_LIFETIME_MS && todayInTimeZone() === proof.plan.referenceDate; }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function isReceipt(value: unknown, datasetId: string): value is RetentionReceipt {
  if (!object(value) || value.schema !== "protected-retention-receipt-v1" || value.datasetId !== datasetId || typeof value.proofId !== "string" || !/^[a-f0-9-]{36}$/.test(value.proofId) || typeof value.completedAt !== "string" || !Number.isFinite(Date.parse(value.completedAt)) || typeof value.referenceDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.referenceDate) || typeof value.cutoff !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.cutoff)) return false;
  if (!object(value.counts) || !RETENTION_STORES.every((name) => Number.isSafeInteger((value.counts as Record<string, unknown>)[name]) && Number((value.counts as Record<string, unknown>)[name]) >= 1)) return false;
  return ["fileChecksum", "contentChecksum", "closureChecksum", "contextChecksum"].every((key) => typeof value[key] === "string" && /^[a-f0-9]{64}$/.test(value[key] as string)) && Number.isSafeInteger(value.contextEntities) && Number(value.contextEntities) >= 0 && Number.isSafeInteger(value.beforeDataRevision) && Number.isSafeInteger(value.afterDataRevision) && Number(value.afterDataRevision) === Number(value.beforeDataRevision) + 1;
}
function stateFrom(rows: Rows): RetentionState {
  const activeId = rows.app_meta.find((row) => row.key === "active_dataset_id")?.value;
  const dataset = rows.datasets.find((row) => row.id === activeId && row.status === "active") as unknown as DatasetRecord | undefined;
  if (!dataset) throw new Error("O conjunto ativo não está disponível; nada foi removido.");
  const receipt = rows.app_meta.find((row) => row.key === LAST_KEY + dataset.id)?.value;
  const validReceipt = isReceipt(receipt, dataset.id);
  const lastRunMonth = validReceipt ? receipt.referenceDate.slice(0, 7) : null;
  const knownMeta = new Set(["active_dataset_id", "schema_version", "data_seed_version", "retention_policy", "last_backup_created_at", "last_backup_checksum_sha256"]);
  const opaqueContext = (receipt !== undefined && !validReceipt) || rows.settings.some((row) => typeof row.key !== "string" || !["retention", "mentor.preferences.v1"].includes(row.key)) || rows.app_meta.some((row) => typeof row.key !== "string" || !knownMeta.has(row.key) && !row.key.startsWith(LAST_KEY));
  return { dataset, entities: rows.entities as unknown as MentorEntity[], revisions: rows.revisions as unknown as RevisionRecord[], operations: rows.operations as unknown as OperationRecord[], outbox: rows.outbox as unknown as OutboxRecord[], imports: rows.imports as unknown as ImportRecord[], guards: [...rows.conflicts, ...rows.import_stage, ...rows.migration_snapshots, ...rows.settings, ...rows.app_meta.filter((row) => typeof row.key === "string" && !row.key.startsWith(LAST_KEY))], syncMeta: rows.sync_meta, externalCache: rows.external_cache, lastRunMonth, opaqueContext };
}
function relevantMaterial(rows: Rows): string {
  // Cache é derivado e será invalidado; seu aquecimento não invalida um arquivo factual conferido.
  return canonicalRetentionValue(Object.fromEntries(TABLES.filter((name) => name !== "metrics_cache").map((name) => [name, [...rows[name]].sort((a, b) => String(a.id ?? a.key).localeCompare(String(b.id ?? b.key)))])));
}
async function readState() {
  await initializeMentorData(); const db = await openMentorDatabase();
  const tx = db.transaction([...TABLES], "readonly"); const done = observeTransactionCompletion(tx);
  const values = await Promise.all(TABLES.map((name) => tx.objectStore(name).getAll()));
  await assertObservedTransactionCompleted(done);
  const rows = Object.fromEntries(TABLES.map((name, index) => [name, values[index]])) as unknown as Rows;
  return { rows, state: stateFrom(rows) };
}
export async function getProtectedRetentionPreview() {
  const { state } = await readState(); return planProtectedRetention(state, todayInTimeZone(), RETENTION_TRANSPORT_CAPABILITY);
}
export async function getProtectedRetentionSchedule() {
  await initializeMentorData(); const db = await openMentorDatabase();
  const tx = db.transaction(["app_meta", "datasets"], "readonly");
  const active = await tx.objectStore("app_meta").get("active_dataset_id");
  const dataset = typeof active?.value === "string" ? await tx.objectStore("datasets").get(active.value) : undefined;
  if (!dataset) throw new Error("Conjunto ativo indisponível.");
  const last = await tx.objectStore("app_meta").get(LAST_KEY + dataset.id); await tx.done;
  const firstEligibleOn = retentionFirstEligibleOn(dataset.createdAt); const today = todayInTimeZone();
  if (last && !isReceipt(last.value, dataset.id)) throw new Error("O comprovante anterior não pôde ser confirmado.");
  const lastMonth = last && isReceipt(last.value, dataset.id) ? last.value.referenceDate.slice(0, 7) : null;
  return { firstEligibleOn, due: !!firstEligibleOn && today >= firstEligibleOn && lastMonth !== today.slice(0, 7) };
}
function closureRows(rows: Pick<Rows, RetentionStore>, plan: RetentionPlan) {
  const entities = new Set(plan.rowIds.entities);
  const revisions = rows.revisions.filter((row) => entities.has(String(row.entityId)));
  const operationIds = new Set(revisions.map((row) => row.operationId));
  const operations = rows.operations.filter((row) => entities.has(String(row.entityId)) || operationIds.has(row.id));
  const allOperations = new Set(operations.map((row) => row.id));
  return { entities: rows.entities.filter((row) => entities.has(String(row.id))), revisions, operations, outbox: rows.outbox.filter((row) => entities.has(String(row.entityId)) || allOperations.has(row.operationId)) };
}
function closureMaterial(rows: Pick<Rows, RetentionStore>, plan: RetentionPlan): string {
  const selected = closureRows(rows, plan);
  return JSON.stringify(RETENTION_STORES.map((name) => [name, selected[name].map((row) => [String(row.id), canonicalRetentionRow(name, row)]).sort((a, b) => a[0].localeCompare(b[0]))]));
}
function contextPlan(rows: Rows, plan: RetentionPlan): RetentionPlan {
  const allIds = new Set(rows.entities.map((row) => String(row.id))); const ids = new Set(plan.rowIds.entities); const pending = [...ids];
  for (let index = 0; index < pending.length; index++) {
    const owner = pending[index]; const related = [...rows.entities.filter((row) => row.id === owner), ...rows.revisions.filter((row) => row.entityId === owner)];
    for (const reference of retentionReferenceStrings(related)) if (allIds.has(reference) && !ids.has(reference)) { ids.add(reference); pending.push(reference); }
  }
  return { ...plan, rowIds: { ...plan.rowIds, entities: [...ids].sort() } };
}
async function checksum(value: string): Promise<string> { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
export async function prepareProtectedRetention(file: File, passphrase: string) {
  const inspected = await inspectBackupForRetention(file, passphrase);
  const { rows, state } = await readState(); const plan = planProtectedRetention(state, todayInTimeZone(), RETENTION_TRANSPORT_CAPABILITY);
  if (plan.blockers.length || !plan.candidates.length) throw new Error("Não há lote liberado para conferência neste mês. Atualize a prévia; nada foi removido.");
  if (inspected.datasetId !== state.dataset.id) throw new Error("O arquivo pertence a outro conjunto de dados.");
  if (plan.candidates.length > 2500) throw new Error("O lote excede a capacidade segura desta versão. Todos os dados foram preservados.");
  for (const id of plan.rowIds.entities) { const entity = rows.entities.find((item) => item.id === id); if (!isMentorEntityCandidate(entity, state.dataset.id)) throw new Error("Um registro candidato não atende ao contrato de recuperação."); }
  const local = closureMaterial(rows, plan); const archived = closureMaterial(inspected.stores as unknown as Pick<Rows, RetentionStore>, plan);
  if (local !== archived) throw new Error("O backup não contém exatamente todas as versões e filas deste lote. Crie e reabra uma cópia atual; nada foi removido.");
  const context = contextPlan(rows, plan); const localContext = closureMaterial(rows, context);
  if (localContext !== closureMaterial(inspected.stores as unknown as Pick<Rows, RetentionStore>, context)) throw new Error("O arquivo não preserva todo o contexto referenciado pelos fatos antigos. Nada foi removido.");
  const id = crypto.randomUUID(); const proof: PreparedProof = { id, createdAt: Date.now(), plan, stateMaterial: relevantMaterial(rows), fileChecksum: inspected.fileChecksum, contentChecksum: inspected.contentChecksum, closureChecksum: await checksum(local), contextChecksum: await checksum(localContext), contextEntities: context.rowIds.entities.length - plan.rowIds.entities.length };
  proofs.clear(); proofs.set(id, proof);
  globalThis.setTimeout(() => proofs.delete(id), PROOF_LIFETIME_MS);
  return { proofId: id, plan, fileChecksum: inspected.fileChecksum, fileBytes: inspected.fileBytes, verifiedAt: new Date().toISOString(), expiresInMinutes: 5 };
}
export function discardProtectedRetentionProof(proofId: string): void { proofs.delete(proofId); }

export async function applyProtectedRetention(proofId: string): Promise<{ status: "applied" | "already-applied"; receipt: RetentionReceipt }> {
  const proof = proofs.get(proofId); const db = await openMentorDatabase();
  if (!proof) {
    const active = await db.get("app_meta", "active_dataset_id"); const previous = typeof active?.value === "string" ? await db.get("app_meta", LAST_KEY + active.value) : undefined;
    if (typeof active?.value === "string" && isReceipt(previous?.value, active.value) && previous.value.proofId === proofId) return { status: "already-applied", receipt: previous.value };
    throw new Error("A conferência do arquivo não está disponível. Reabra o backup.");
  }
  if (!proofIsFresh(proof)) { proofs.delete(proofId); throw new Error("A conferência expirou. Reabra o arquivo antes de qualquer limpeza."); }
  const tx = db.transaction([...TABLES], "readwrite"); const done = observeTransactionCompletion(tx);
  try {
    const values = await Promise.all(TABLES.map((name) => tx.objectStore(name).getAll()));
    const rows = Object.fromEntries(TABLES.map((name, index) => [name, values[index]])) as unknown as Rows;
    const state = stateFrom(rows); const plan = planProtectedRetention(state, proof.plan.referenceDate, RETENTION_TRANSPORT_CAPABILITY);
    if (state.dataset.id !== proof.plan.datasetId || plan.blockers.length || relevantMaterial(rows) !== proof.stateMaterial || canonicalRetentionValue(plan.rowIds) !== canonicalRetentionValue(proof.plan.rowIds)) throw new Error("Os dados ou dependências mudaram após a conferência. Atualize a prévia e reabra o arquivo; nada foi removido.");
    if (!proofIsFresh(proof)) throw new Error("A conferência expirou durante a espera. Nada foi removido.");
    // Só requisições IndexedDB e comparação síncrona nesta transação; nunca aguardar WebCrypto.
    for (const name of RETENTION_STORES) for (const id of plan.rowIds[name]) await tx.objectStore(name).delete(id);
    for (const row of rows.metrics_cache) if (row.datasetId === state.dataset.id && typeof row.id === "string") await tx.objectStore("metrics_cache").delete(row.id);
    const completedAt = new Date().toISOString();
    const receipt: RetentionReceipt = { schema: "protected-retention-receipt-v1", proofId, datasetId: state.dataset.id, completedAt, referenceDate: plan.referenceDate, cutoff: plan.cutoff, counts: Object.fromEntries(RETENTION_STORES.map((name) => [name, plan.rowIds[name].length])) as Record<RetentionStore, number>, fileChecksum: proof.fileChecksum, contentChecksum: proof.contentChecksum, closureChecksum: proof.closureChecksum, contextChecksum: proof.contextChecksum, contextEntities: proof.contextEntities, beforeDataRevision: state.dataset.dataRevision, afterDataRevision: state.dataset.dataRevision + 1 };
    if (!proofIsFresh(proof)) throw new Error("A conferência expirou durante a operação; a transação será revertida.");
    await tx.objectStore("datasets").put({ ...state.dataset, dataRevision: receipt.afterDataRevision, updatedAt: completedAt });
    await tx.objectStore("app_meta").put({ key: LAST_KEY + state.dataset.id, value: receipt, updatedAt: completedAt });
    await assertObservedTransactionCompleted(done); proofs.delete(proofId); return { status: "applied", receipt };
  } catch (error) { await abortTransactionSafely(tx); throw error; }
}
