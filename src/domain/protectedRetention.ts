import { assertLocalDate, inclusiveDateWindow, shiftLocalDate, todayInTimeZone } from "./dates";
import { APP_TIME_ZONE, type DatasetRecord, type ImportRecord, type LocalDate, type MentorEntity, type OperationRecord, type OutboxRecord, type RevisionRecord } from "./model";
import { isOperationalDefinition } from "./operationalState";

export const RETENTION_STORES = ["entities", "revisions", "operations", "outbox"] as const;
export type RetentionStore = typeof RETENTION_STORES[number];
export interface RetentionState { dataset: DatasetRecord; entities: MentorEntity[]; revisions: RevisionRecord[]; operations: OperationRecord[]; outbox: OutboxRecord[]; imports: ImportRecord[]; guards: unknown[]; syncMeta: unknown[]; externalCache: unknown[]; lastRunMonth: string | null; opaqueContext?: boolean; }
export type RetentionReason = "within_retention" | "recent_activity" | "operational_definition" | "seed" | "unsupported_fact" | "unfinished_commitment" | "retained_payload_date" | "imported" | "broken_chain" | "outbox_state" | "referenced" | "invalid_data";
export interface RetentionCandidate { entityId: string; domain: string; type: string; localDate: LocalDate; revision: number; }
export interface RetentionPlan { datasetId: string; referenceDate: LocalDate; cutoff: LocalDate; protectedSince: LocalDate; firstEligibleOn: LocalDate | null; blockers: string[]; candidates: RetentionCandidate[]; protected: Array<RetentionCandidate & { reason: RetentionReason }>; rowIds: Record<RetentionStore, string[]>; }
export const RETENTION_REASON_LABELS: Record<RetentionReason, string> = { within_retention: "Dentro dos 365 dias", recent_activity: "Alterado ou criado nos últimos 60 dias", operational_definition: "Configuração ou compromisso duradouro", seed: "Registro estrutural do aplicativo", unsupported_fact: "Formato fora da limpeza automática", unfinished_commitment: "Compromisso ainda não encerrado", retained_payload_date: "Contém data recente ou futura", imported: "Rastreabilidade de importação", broken_chain: "Histórico precisa de conferência", outbox_state: "Fila com responsabilidade não comprovada", referenced: "Outro registro depende deste", invalid_data: "Estrutura ou data não verificável" };

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
// Codificação sem perdas, inclusive para distinguir undefined de um campo ausente.
export function canonicalRetentionValue(value: unknown): string {
  const seen = new Set<object>();
  const visit = (current: unknown): unknown => {
    if (current === undefined) return ["undefined"];
    if (current === null) return ["null"];
    if (typeof current === "string" || typeof current === "boolean") return [typeof current, current];
    if (typeof current === "number" && Number.isFinite(current)) return ["number", Object.is(current, -0) ? "-0" : String(current)];
    if (typeof current !== "object" || !current || seen.has(current) || Object.getOwnPropertySymbols(current).length) throw new Error("Estrutura não comparável sem perda.");
    seen.add(current);
    let result: unknown;
    if (Array.isArray(current)) {
      if (Object.getOwnPropertyNames(current).some((key) => key !== "length" && (!/^(0|[1-9]\d*)$/.test(key) || String(Number(key)) !== key || Number(key) >= current.length || !Object.getOwnPropertyDescriptor(current, key)?.enumerable || Object.getOwnPropertyDescriptor(current, key)?.get || Object.getOwnPropertyDescriptor(current, key)?.set))) throw new Error("Array com campos fora do contrato.");
      result = ["array", Array.from({ length: current.length }, (_, index) => Object.hasOwn(current, index) ? visit(current[index]) : ["hole"])];
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(current))) throw new Error("Objeto fora do formato recuperável.");
      result = ["object", Object.getOwnPropertyNames(current).sort().map((key) => { const descriptor = Object.getOwnPropertyDescriptor(current, key)!; if (descriptor.get || descriptor.set || !descriptor.enumerable) throw new Error("Propriedade oculta ou acessor não é dado recuperável."); return [key, visit(descriptor.value)]; })];
    }
    seen.delete(current); return result;
  };
  return JSON.stringify(visit(value));
}
export function canonicalRetentionRow(store: RetentionStore, row: unknown): string {
  if (!object(row)) throw new Error("Linha inválida.");
  if (Object.getOwnPropertySymbols(row).length || Object.getOwnPropertyNames(row).some((key) => { const descriptor = Object.getOwnPropertyDescriptor(row, key)!; return !descriptor.enumerable || descriptor.get || descriptor.set; })) throw new Error("Linha com propriedade não recuperável.");
  const copy = { ...row };
  const optional = store === "operations" ? ["entityId", "baseRevision", "nextRevision", "importId", "sourceDatasetId", "sourceRevision"] : store === "revisions" ? ["importId", "sourceDatasetId", "sourceRevision"] : store === "outbox" ? ["entityId"] : [];
  for (const key of optional) if (copy[key] === undefined) delete copy[key];
  return canonicalRetentionValue(copy);
}
function instantDate(value: unknown): LocalDate | null {
  if (typeof value !== "string") return null; const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) return null;
  return todayInTimeZone(APP_TIME_ZONE, parsed);
}
export function retentionFirstEligibleOn(createdAt: string): LocalDate | null {
  const date = instantDate(createdAt); if (!date) return null;
  const [year, month, day] = date.split("-").map(Number); const finalDay = new Date(Date.UTC(year + 1, month, 0)).getUTCDate();
  const result = `${year + 1}-${String(month).padStart(2, "0")}-${String(Math.min(day, finalDay)).padStart(2, "0")}` as LocalDate;
  try { assertLocalDate(result); return result; } catch { return null; }
}
export function retentionReferenceStrings(value: unknown): string[] {
  const found: string[] = []; const seen = new Set<object>();
  const visit = (item: unknown) => { if (typeof item === "string") { found.push(item); return; } if (!item || typeof item !== "object" || seen.has(item)) return; seen.add(item); for (const [key, nested] of Object.entries(item)) { found.push(key); visit(nested); } };
  visit(value); return found;
}
const historicalSchemas: Record<string, { domain: string; kind: string }> = { "internship-debrief-v1": { domain: "internato", kind: "internship-debrief" }, "study-session-v1": { domain: "estudos", kind: "study-session" }, "sleep-chronology-v1": { domain: "sono", kind: "sleep-chronology" }, "nutrition-log-v1": { domain: "alimentacao", kind: "nutrition-log" }, "headache-crisis-v1": { domain: "cefaleia", kind: "headache-crisis" }, "bruxism-am-pm-v1": { domain: "bruxismo", kind: "bruxism-am-pm" }, "laboratory-panel-v1": { domain: "exames", kind: "laboratory-panel" } };
function factReason(entity: MentorEntity): RetentionReason | null {
  if (isOperationalDefinition(entity)) return "operational_definition";
  if (entity.source === "seed" || entity.id.startsWith("seed-")) return "seed";
  if (entity.source === "imported") return "imported";
  if (!["active", "deleted"].includes(entity.status)) return "unsupported_fact";
  const payload = entity.payload as Record<string, unknown>;
  if (entity.type === "financas.transaction") return typeof payload.status === "string" && ["posted", "voided"].includes(payload.status) ? null : "unfinished_commitment";
  if (entity.type === "agenda.event") return typeof payload.status === "string" && ["completed", "cancelled"].includes(payload.status) ? null : "unfinished_commitment";
  if (["internato.shift", "humor.energy-check-in", "medicamentos.confirmation", "rotina.daily-closure"].includes(entity.type)) return null;
  const schema = typeof payload.schema === "string" ? historicalSchemas[payload.schema] : undefined;
  return entity.type === "generic.event" && schema && schema.domain === entity.domain && schema.kind === payload.eventKind ? null : "unsupported_fact";
}
function identity(entity: MentorEntity): RetentionCandidate { return { entityId: entity.id, domain: entity.domain, type: entity.type, localDate: entity.localDate, revision: entity.revision }; }

export function planProtectedRetention(state: RetentionState, referenceDate: LocalDate, capability: { schema: string; consumers: readonly string[] }): RetentionPlan {
  assertLocalDate(referenceDate); const retained = inclusiveDateWindow(referenceDate, 365); const recent = inclusiveDateWindow(referenceDate, 60);
  const plan: RetentionPlan = { datasetId: state.dataset.id, referenceDate, cutoff: shiftLocalDate(referenceDate, -365), protectedSince: recent.start, firstEligibleOn: retentionFirstEligibleOn(state.dataset.createdAt), blockers: [], candidates: [], protected: [], rowIds: { entities: [], revisions: [], operations: [], outbox: [] } };
  if (!plan.firstEligibleOn) plan.blockers.push("dataset_date_unknown"); else if (referenceDate < plan.firstEligibleOn) plan.blockers.push("first_year");
  if (state.lastRunMonth === referenceDate.slice(0, 7)) plan.blockers.push("month_done");
  if (capability.schema !== "local-only-retention-v1" || capability.consumers.length) plan.blockers.push("transport_present");
  if (state.syncMeta.length) plan.blockers.push("sync_state_present");
  if (state.externalCache.length) plan.blockers.push("external_state_present");
  if (state.opaqueContext) plan.blockers.push("opaque_context");
  try { state.guards.forEach(canonicalRetentionValue); } catch { plan.blockers.push("opaque_context"); }
  if (state.imports.some((item) => item.datasetId === state.dataset.id && ["staged", "validated"].includes(item.status))) plan.blockers.push("import_in_progress");
  if (state.imports.some((item) => { const audit = (item as unknown as Record<string, unknown>).legacyAudit; return item.datasetId === state.dataset.id && item.status === "applied" && item.format !== "bauerlife" && object(audit) && audit.postApplyDataRevision === state.dataset.dataRevision && audit.postApplySettingsRevision === state.dataset.settingsRevision && audit.postApplyOperationSequence === state.dataset.nextOperationSequence; })) plan.blockers.push("rollback_available");
  const closures = new Map<string, { revisions: RevisionRecord[]; operations: OperationRecord[]; outbox: OutboxRecord[] }>();
  for (const entity of state.entities.filter((item) => item.datasetId === state.dataset.id)) {
    let reason = factReason(entity); const meta = identity(entity);
    if (!reason) {
      try { assertLocalDate(entity.localDate); canonicalRetentionRow("entities", entity); } catch { reason = "invalid_data"; }
    }
    if (!reason && entity.localDate >= plan.cutoff) reason = "within_retention";
    const revisions = state.revisions.filter((item) => item.entityId === entity.id);
    const operationIds = new Set(revisions.map((item) => item.operationId));
    const operations = state.operations.filter((item) => item.entityId === entity.id || operationIds.has(item.id));
    const allOperationIds = new Set(operations.map((item) => item.id));
    const outbox = state.outbox.filter((item) => item.entityId === entity.id || allOperationIds.has(item.operationId));
    if (!reason && (revisions.some((item) => item.importId || item.sourceDatasetId || item.snapshot.source === "imported") || operations.some((item) => item.importId || item.sourceDatasetId || item.kind === "import"))) reason = "imported";
    if (!reason && revisions.some((item) => item.snapshot.source === "seed")) reason = "seed";
    if (!reason) {
      const activity = [entity.createdAt, entity.updatedAt, ...revisions.flatMap((item) => [item.createdAt, item.snapshot.createdAt, item.snapshot.updatedAt]), ...operations.map((item) => item.createdAt), ...outbox.map((item) => item.createdAt)].map(instantDate);
      if (activity.some((date) => date === null)) reason = "invalid_data"; else if (activity.some((date) => date! >= recent.start)) reason = "recent_activity";
    }
    if (!reason && retentionReferenceStrings(entity.payload).some((value) => /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?Z?)?)?$/.test(value) && value.slice(0, 10) >= plan.cutoff)) reason = "retained_payload_date";
    if (!reason) {
      const current = revisions.find((item) => item.revision === entity.revision);
      const revisionIds = new Set(revisions.map((item) => item.id));
      const coherent = current && canonicalRetentionRow("entities", current.snapshot) === canonicalRetentionRow("entities", entity) && revisions.every((item) => item.datasetId === entity.datasetId && item.snapshot.id === entity.id && operations.some((operation) => operation.id === item.operationId && operation.nextRevision === item.revision)) && operations.every((item) => item.datasetId === entity.datasetId && item.entityId === entity.id && item.status === "committed" && ["create", "update", "delete", "restore"].includes(item.kind) && operationIds.has(item.id) && Number.isSafeInteger(item.sequence)) && state.revisions.every((item) => !allOperationIds.has(item.operationId) || revisionIds.has(item.id)) && outbox.every((item) => item.datasetId === entity.datasetId && allOperationIds.has(item.operationId) && (!item.entityId || item.entityId === entity.id)) && operations.every((item) => outbox.filter((row) => row.operationId === item.id).length === 1);
      if (!coherent) reason = "broken_chain";
    }
    if (!reason && outbox.some((item) => item.state !== "pending")) reason = "outbox_state";
    if (!reason) { try { revisions.forEach((row) => canonicalRetentionRow("revisions", row)); operations.forEach((row) => canonicalRetentionRow("operations", row)); outbox.forEach((row) => canonicalRetentionRow("outbox", row)); } catch { reason = "invalid_data"; } }
    if (reason) plan.protected.push({ ...meta, reason }); else { plan.candidates.push(meta); closures.set(entity.id, { revisions, operations, outbox }); }
  }
  // Referências de sobreviventes e de suas versões propagam proteção até estabilizar.
  const candidates = new Set(plan.candidates.map((item) => item.entityId));
  const protectReferenced = (values: unknown[]) => { let changed = false; for (const value of values) for (const id of retentionReferenceStrings(value)) if (candidates.delete(id)) changed = true; return changed; };
  protectReferenced(state.guards);
  let changed = true;
  while (changed) {
    const surviving = state.entities.filter((item) => !candidates.has(item.id));
    const survivingIds = new Set(surviving.map((item) => item.id));
    changed = protectReferenced([...surviving, ...state.revisions.filter((item) => survivingIds.has(item.entityId))]);
  }
  const removedByReferences = plan.candidates.filter((item) => !candidates.has(item.entityId)); plan.protected.push(...removedByReferences.map((item) => ({ ...item, reason: "referenced" as const })));
  plan.candidates = plan.candidates.filter((item) => candidates.has(item.entityId)).sort((a, b) => a.localDate.localeCompare(b.localDate) || a.entityId.localeCompare(b.entityId));
  for (const item of plan.candidates) { const closure = closures.get(item.entityId)!; plan.rowIds.entities.push(item.entityId); for (const store of ["revisions", "operations", "outbox"] as const) plan.rowIds[store].push(...closure[store].map((row) => row.id)); }
  for (const store of RETENTION_STORES) plan.rowIds[store] = [...new Set(plan.rowIds[store])].sort();
  return plan;
}
