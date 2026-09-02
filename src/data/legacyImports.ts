import type {
  ConflictRecord,
  DatasetRecord,
  ImportRecord,
  ImportStageRecord,
  MentorEntity,
  MigrationSnapshotRecord,
  OperationRecord,
  OutboxRecord,
  RevisionRecord,
  SettingRecord,
} from "../domain/model";
import {
  buildLegacyImportPlan,
  normalizeLegacyImport,
  sha256Hex,
  stableSerialize,
  type LegacyImportAction,
  type LegacyImportConflict,
  type LegacyImportFamily,
  type LegacyImportPlan,
  type LegacyImportSourceFormat,
  type LegacyImportWarning,
  type NormalizedLegacyImport,
} from "../domain/legacyImport";
import { openMentorDatabase } from "./database";
import { getActiveDataset, initializeMentorData } from "./seed";
import {
  abortTransactionSafely,
  assertObservedTransactionCompleted,
  observeTransactionCompletion,
} from "./transactionSafety";

const LEGACY_STAGE_SCHEMA = "mentor-legacy-stage-v1" as const;
const LEGACY_SNAPSHOT_SCHEMA = "mentor-legacy-rollback-v1" as const;

function nowISO(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function sanitizeSourceName(sourceName: string): string {
  const normalized = sourceName.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return (normalized || "arquivo-legado.json").slice(0, 180);
}

interface LegacyStageEnvelope {
  schema: typeof LEGACY_STAGE_SCHEMA;
  normalized: NormalizedLegacyImport;
  plan: LegacyImportPlan;
}

interface LegacySnapshotImpact<T> {
  id: string;
  before: T | null;
  after: T;
}

interface LegacyMigrationSnapshot extends MigrationSnapshotRecord {
  schema: typeof LEGACY_SNAPSHOT_SCHEMA;
  source: {
    family: LegacyImportFamily;
    format: LegacyImportSourceFormat;
    checksumSHA256: string;
    raw: unknown;
  };
  before: {
    dataset: DatasetRecord;
    entities: Array<LegacySnapshotImpact<MentorEntity>>;
    settings: Array<LegacySnapshotImpact<SettingRecord>>;
  };
  after: {
    dataRevision: number;
    settingsRevision: number;
    nextOperationSequence: number;
  };
}

interface LegacyImportAudit {
  snapshotId: string;
  postApplyDataRevision: number;
  postApplySettingsRevision: number;
  postApplyOperationSequence: number;
  warningAcknowledgements: string[];
}

type LegacyImportRecord = ImportRecord & {
  legacyAudit?: LegacyImportAudit;
};

export interface LegacyImportPreview {
  importId: string;
  family: LegacyImportFamily;
  sourceFormat: LegacyImportSourceFormat;
  sourceName: string;
  sourceChecksumSHA256: string;
  stagedChecksumSHA256: string;
  planDigestSHA256: string;
  baseDataRevision: number;
  baseSettingsRevision: number;
  sourceCounts: Record<string, number>;
  counts: LegacyImportPlan["counts"];
  identicalKeys: string[];
  warnings: LegacyImportWarning[];
  conflicts: LegacyImportConflict[];
}

export interface StagedLegacyImportResult extends LegacyImportPreview {
  stagedRecordCount: number;
}

export interface ApplyStagedLegacyImportOptions {
  expectedPlanDigest: string;
  mode?: "safe-only" | "abort-on-conflict";
  acknowledgedWarningCodes?: string[];
}

export interface AppliedLegacyImportResult {
  importId: string;
  status: "applied" | "applied_with_conflicts" | "nothing_to_apply";
  mode: "safe-only" | "abort-on-conflict";
  snapshotId: string;
  createdEntityIds: string[];
  updatedEntityIds: string[];
  settingKeys: string[];
  identicalKeys: string[];
  conflicts: LegacyImportConflict[];
}

export interface RolledBackLegacyImportResult {
  importId: string;
  status: "rolled_back";
  restoredEntityIds: string[];
  removedCreatedEntityIds: string[];
  restoredSettingKeys: string[];
  removedCreatedSettingKeys: string[];
}

export interface DiscardedLegacyImportResult {
  importId: string;
  status: "discarded" | "already-finalized";
  removedStageRows: number;
}

function stageMaterial(envelope: LegacyStageEnvelope): string {
  return stableSerialize({
    schema: envelope.schema,
    normalized: envelope.normalized,
    plan: envelope.plan,
  });
}

function previewFrom(
  record: ImportRecord,
  envelope: LegacyStageEnvelope,
): LegacyImportPreview {
  if (!record.stagedChecksumSHA256 || !record.planDigest) {
    throw new Error("O staging legado não possui os selos de integridade necessários.");
  }
  return {
    importId: record.id,
    family: envelope.normalized.family,
    sourceFormat: envelope.normalized.sourceFormat,
    sourceName: record.sourceName,
    sourceChecksumSHA256: envelope.plan.sourceChecksumSHA256,
    stagedChecksumSHA256: record.stagedChecksumSHA256,
    planDigestSHA256: envelope.plan.planDigestSHA256,
    baseDataRevision: record.baseDataRevision ?? -1,
    baseSettingsRevision: record.baseSettingsRevision ?? -1,
    sourceCounts: envelope.plan.sourceCounts,
    counts: envelope.plan.counts,
    identicalKeys: envelope.plan.identicalKeys,
    warnings: envelope.plan.warnings,
    conflicts: envelope.plan.conflicts,
  };
}

function isLegacyStageEnvelope(value: unknown): value is LegacyStageEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schema === LEGACY_STAGE_SCHEMA &&
    Boolean(record.normalized && typeof record.normalized === "object") &&
    Boolean(record.plan && typeof record.plan === "object");
}

async function loadVerifiedStage(importId: string): Promise<{
  record: ImportRecord;
  envelope: LegacyStageEnvelope;
  stageRows: ImportStageRecord[];
}> {
  await initializeMentorData();
  const database = await openMentorDatabase();
  const record = await database.get("imports", importId);
  if (!record || (record.format !== "legacy-obstetricia" && record.format !== "legacy-cefaleia")) {
    throw new Error("Importação legada não encontrada.");
  }
  if (record.status !== "validated" && record.status !== "staged") {
    throw new Error("Esta importação legada não está mais em staging.");
  }
  const stageRows = await database.getAllFromIndex("import_stage", "by_import", importId);
  if (stageRows.length !== 1 || !isLegacyStageEnvelope(stageRows[0].value)) {
    throw new Error("O staging legado está incompleto ou possui formato inesperado.");
  }
  const envelope = stageRows[0].value;
  const checksum = await sha256Hex(stageMaterial(envelope));
  if (!record.stagedChecksumSHA256 || checksum !== record.stagedChecksumSHA256) {
    throw new Error("A integridade do staging legado não pôde ser confirmada.");
  }
  if (!record.planDigest || envelope.plan.planDigestSHA256 !== record.planDigest) {
    throw new Error("O plano legado mudou depois da validação.");
  }
  const sourceChecksum = await sha256Hex(stableSerialize(envelope.normalized.rawSource));
  if (
    sourceChecksum !== record.payloadChecksum ||
    sourceChecksum !== envelope.plan.sourceChecksumSHA256
  ) {
    throw new Error("O conteúdo de origem legado não corresponde ao checksum validado.");
  }
  if (envelope.normalized.family !== record.format) {
    throw new Error("A família do staging não corresponde ao registro de importação.");
  }
  return { record, envelope, stageRows };
}

/**
 * Parses, explicitly detects and normalizes a legacy JSON, then writes only a
 * sealed staging row. Canonical entities are not touched until `apply` is
 * called with the exact plan digest shown in the preview.
 */
export async function validateAndStageLegacyImport(
  source: string | unknown,
  sourceName = "arquivo-legado.json",
): Promise<StagedLegacyImportResult> {
  const normalized = normalizeLegacyImport(source);
  await initializeMentorData();
  const database = await openMentorDatabase();
  const dataset = await getActiveDataset();
  const [existingEntities, existingSettings] = await Promise.all([
    database.getAllFromIndex("entities", "by_dataset", dataset.id),
    database.getAllFromIndex("settings", "by_dataset", dataset.id),
  ]);
  const importedAt = nowISO();
  const plan = await buildLegacyImportPlan(normalized, {
    dataset,
    existingEntities,
    existingSettings,
    importedAt,
  });
  const envelope: LegacyStageEnvelope = {
    schema: LEGACY_STAGE_SCHEMA,
    normalized,
    plan,
  };
  const stagedChecksumSHA256 = await sha256Hex(stageMaterial(envelope));
  const importId = makeId("legacy-import");
  const stageRecord: ImportStageRecord = {
    id: `${importId}:sealed-plan`,
    importId,
    datasetId: dataset.id,
    storeName: "legacy.sealed-plan",
    sourceKey: "sealed-plan",
    value: envelope,
  };
  const record: ImportRecord = {
    id: importId,
    datasetId: dataset.id,
    ...(normalized.sourceExportedAt
      ? { sourceExportedAt: normalized.sourceExportedAt }
      : {}),
    format: normalized.family,
    status: "validated",
    sourceName: sanitizeSourceName(sourceName),
    payloadChecksum: plan.sourceChecksumSHA256,
    storeCounts: {
      entities: normalized.entities.length,
      shifts: normalized.shifts.length,
      settings: normalized.settings.length,
      sourceRecords: Object.values(normalized.sourceCounts).reduce(
        (total, count) => total + count,
        0,
      ),
    },
    createdAt: importedAt,
    validatedAt: importedAt,
    baseDataRevision: dataset.dataRevision,
    baseSettingsRevision: dataset.settingsRevision,
    stagedChecksumSHA256,
    planDigest: plan.planDigestSHA256,
    planCounts: { ...plan.counts },
  };
  const transaction = database.transaction(["imports", "import_stage"], "readwrite");
  const transactionCompletion = observeTransactionCompletion(transaction);
  await transaction.objectStore("imports").add(record);
  await transaction.objectStore("import_stage").add(stageRecord);
  await assertObservedTransactionCompleted(transactionCompletion);
  return {
    ...previewFrom(record, envelope),
    stagedRecordCount: 1,
  };
}

export async function previewStagedLegacyImport(
  importId: string,
): Promise<LegacyImportPreview> {
  const { record, envelope } = await loadVerifiedStage(importId);
  const dataset = await getActiveDataset();
  if (
    dataset.id !== record.datasetId ||
    dataset.dataRevision !== record.baseDataRevision ||
    dataset.settingsRevision !== record.baseSettingsRevision
  ) {
    throw new Error(
      "Os dados mudaram depois do preview. Descarte este staging e valide o arquivo novamente.",
    );
  }
  return previewFrom(record, envelope);
}

function requiredAcknowledgements(warnings: readonly LegacyImportWarning[]): string[] {
  return [...new Set(
    warnings.filter((warning) => warning.requiresAcknowledgement).map((warning) => warning.code),
  )];
}

function snapshotMaterial(snapshot: LegacyMigrationSnapshot): unknown {
  return {
    schema: snapshot.schema,
    source: snapshot.source,
    before: snapshot.before,
    after: snapshot.after,
  };
}

function actionEntityImpacts(
  actions: readonly LegacyImportAction[],
): Array<LegacySnapshotImpact<MentorEntity>> {
  return actions.flatMap((action) => {
    if (action.kind === "put-setting") return [];
    return [{
      id: action.entity.id,
      before: action.kind === "update-entity" ? action.before : null,
      after: action.entity,
    }];
  });
}

function actionSettingImpacts(
  actions: readonly LegacyImportAction[],
): Array<LegacySnapshotImpact<SettingRecord>> {
  return actions.flatMap((action) =>
    action.kind === "put-setting"
      ? [{ id: action.setting.id, before: action.before, after: action.setting }]
      : [],
  );
}

function operationForAction(
  action: LegacyImportAction,
  datasetId: string,
  sequence: number,
  importId: string,
  createdAt: string,
): OperationRecord {
  return {
    id: makeId("legacy-operation"),
    datasetId,
    ...(action.kind === "put-setting" ? {} : { entityId: action.entity.id }),
    sequence,
    kind: "import",
    status: "committed",
    ...(action.kind === "update-entity"
      ? { baseRevision: action.before.revision, nextRevision: action.entity.revision }
      : action.kind === "create-entity"
        ? { nextRevision: action.entity.revision }
        : {}),
    summary: `Legacy import applied: ${action.sourceKey}.`,
    createdAt,
    importId,
  };
}

function conflictRecord(
  conflict: LegacyImportConflict,
  datasetId: string,
  importId: string,
  createdAt: string,
): ConflictRecord {
  return {
    id: makeId("legacy-conflict"),
    datasetId,
    entityId: conflict.subjectKind === "setting" ? `setting:${conflict.key}` : conflict.key,
    localRevision: conflict.existingRevision ?? 0,
    remoteRevision: 1,
    state: "open",
    createdAt,
    importId,
    subjectKind: conflict.subjectKind === "setting" ? "setting" : "entity",
    ...(conflict.subjectKind === "setting" ? { settingKey: conflict.key } : {}),
    reason: conflict.reason,
    incomingSnapshot: { sourceKey: conflict.sourceKey },
  };
}

export async function applyStagedLegacyImport(
  importId: string,
  options: ApplyStagedLegacyImportOptions,
): Promise<AppliedLegacyImportResult> {
  const mode = options.mode ?? "safe-only";
  const { record, envelope } = await loadVerifiedStage(importId);
  if (options.expectedPlanDigest !== envelope.plan.planDigestSHA256) {
    throw new Error("O plano mostrado não corresponde ao plano que seria aplicado.");
  }
  if (mode === "abort-on-conflict" && envelope.plan.conflicts.length) {
    throw new Error("A importação foi interrompida porque o preview contém conflitos.");
  }
  const acknowledged = new Set(options.acknowledgedWarningCodes ?? []);
  const missingAcknowledgements = requiredAcknowledgements(envelope.plan.warnings)
    .filter((code) => !acknowledged.has(code));
  if (missingAcknowledgements.length) {
    throw new Error(
      `Confirme os avisos obrigatórios antes de aplicar: ${missingAcknowledgements.join(", ")}.`,
    );
  }

  const database = await openMentorDatabase();
  const actionCount = envelope.plan.actions.length;
  const entityActionCount = envelope.plan.actions.filter(
    (action) => action.kind !== "put-setting",
  ).length;
  const settingActionCount = envelope.plan.actions.filter(
    (action) => action.kind === "put-setting",
  ).length;
  const snapshotId = `legacy-snapshot-${importId}`;
  const preflightDataset = await database.get("datasets", record.datasetId);
  if (
    !preflightDataset ||
    preflightDataset.dataRevision !== record.baseDataRevision ||
    preflightDataset.settingsRevision !== record.baseSettingsRevision
  ) {
    throw new Error("Os dados mudaram antes da aplicação; gere um novo preview.");
  }
  const afterDataset = {
    dataRevision: (record.baseDataRevision ?? -1) + entityActionCount,
    settingsRevision: (record.baseSettingsRevision ?? -1) + settingActionCount,
    nextOperationSequence: preflightDataset.nextOperationSequence + actionCount,
  };
  const createdAt = nowISO();
  const snapshot: LegacyMigrationSnapshot = {
    id: snapshotId,
    datasetId: preflightDataset.id,
    importId,
    label: `Rollback integral de ${record.sourceName}`,
    entityCount: entityActionCount,
    checksum: "pending",
    createdAt,
    schema: LEGACY_SNAPSHOT_SCHEMA,
    source: {
      family: envelope.normalized.family,
      format: envelope.normalized.sourceFormat,
      checksumSHA256: envelope.plan.sourceChecksumSHA256,
      raw: envelope.normalized.rawSource,
    },
    before: {
      dataset: preflightDataset,
      entities: actionEntityImpacts(envelope.plan.actions),
      settings: actionSettingImpacts(envelope.plan.actions),
    },
    after: afterDataset,
  };
  snapshot.checksum = await sha256Hex(stableSerialize(snapshotMaterial(snapshot)));
  const transaction = database.transaction(
    [
      "datasets",
      "entities",
      "revisions",
      "operations",
      "outbox",
      "settings",
      "imports",
      "import_stage",
      "migration_snapshots",
      "conflicts",
    ],
    "readwrite",
  );
  const transactionCompletion = observeTransactionCompletion(transaction);
  const dataset = await transaction.objectStore("datasets").get(record.datasetId);
  const transactionImport = await transaction.objectStore("imports").get(importId);
  if (
    !dataset ||
    !transactionImport ||
    transactionImport.status !== "validated" ||
    dataset.dataRevision !== record.baseDataRevision ||
    dataset.settingsRevision !== record.baseSettingsRevision ||
    stableSerialize(dataset) !== stableSerialize(preflightDataset)
  ) {
    await abortTransactionSafely(transaction);
    throw new Error("Os dados mudaram antes da aplicação; gere um novo preview.");
  }
  const entityStore = transaction.objectStore("entities");
  const settingStore = transaction.objectStore("settings");
  for (const action of envelope.plan.actions) {
    if (action.kind === "create-entity") {
      if (await entityStore.get(action.entity.id)) {
        await abortTransactionSafely(transaction);
        throw new Error("Um registro apareceu depois do preview; a importação foi cancelada.");
      }
    } else if (action.kind === "update-entity") {
      const current = await entityStore.get(action.entity.id);
      if (!current || stableSerialize(current) !== stableSerialize(action.before)) {
        await abortTransactionSafely(transaction);
        throw new Error("Uma jornada mudou depois do preview; a importação foi cancelada.");
      }
    } else {
      const current = await settingStore.get(action.setting.id);
      if (
        (action.before === null && current) ||
        (action.before !== null && stableSerialize(current) !== stableSerialize(action.before))
      ) {
        await abortTransactionSafely(transaction);
        throw new Error("Uma configuração mudou depois do preview; a importação foi cancelada.");
      }
    }
  }

  await transaction.objectStore("migration_snapshots").add(snapshot);

  let sequence = dataset.nextOperationSequence;
  for (const action of envelope.plan.actions) {
    sequence += 1;
    const operation = operationForAction(action, dataset.id, sequence, importId, createdAt);
    if (action.kind === "put-setting") {
      await settingStore.put(action.setting);
    } else {
      await entityStore.put(action.entity);
      const revision: RevisionRecord = {
        id: makeId("legacy-revision"),
        datasetId: dataset.id,
        entityId: action.entity.id,
        revision: action.entity.revision,
        operationId: operation.id,
        reason: "legacy_import_applied",
        snapshot: action.entity,
        createdAt,
        importId,
      };
      await transaction.objectStore("revisions").add(revision);
    }
    await transaction.objectStore("operations").add(operation);
    const outbox: OutboxRecord = {
      id: makeId("legacy-outbox"),
      datasetId: dataset.id,
      operationId: operation.id,
      ...(action.kind === "put-setting" ? {} : { entityId: action.entity.id }),
      state: "pending",
      createdAt,
    };
    await transaction.objectStore("outbox").add(outbox);
  }
  for (const conflict of envelope.plan.conflicts) {
    await transaction.objectStore("conflicts").add(
      conflictRecord(conflict, dataset.id, importId, createdAt),
    );
  }
  await transaction.objectStore("datasets").put({
    ...dataset,
    nextOperationSequence: afterDataset.nextOperationSequence,
    dataRevision: afterDataset.dataRevision,
    settingsRevision: afterDataset.settingsRevision,
    updatedAt: createdAt,
  });
  const stageStore = transaction.objectStore("import_stage");
  const stageKeys = await stageStore.index("by_import").getAllKeys(importId);
  for (const key of stageKeys) await stageStore.delete(key);
  const audit: LegacyImportAudit = {
    snapshotId,
    postApplyDataRevision: afterDataset.dataRevision,
    postApplySettingsRevision: afterDataset.settingsRevision,
    postApplyOperationSequence: afterDataset.nextOperationSequence,
    warningAcknowledgements: [...acknowledged].sort(),
  };
  const updatedImport: LegacyImportRecord = {
    ...transactionImport,
    status: "applied",
    appliedAt: createdAt,
    applyMode: mode,
    appliedCounts: {
      entitiesCreated: envelope.plan.counts.creates,
      entitiesUpdated: envelope.plan.counts.updates,
      settings: envelope.plan.counts.settings,
      conflicts: envelope.plan.counts.conflicts,
    },
    legacyAudit: audit,
  };
  await transaction.objectStore("imports").put(updatedImport);
  await assertObservedTransactionCompleted(transactionCompletion);

  const createdEntityIds = envelope.plan.actions.flatMap((action) =>
    action.kind === "create-entity" ? [action.entity.id] : [],
  );
  const updatedEntityIds = envelope.plan.actions.flatMap((action) =>
    action.kind === "update-entity" ? [action.entity.id] : [],
  );
  const settingKeys = envelope.plan.actions.flatMap((action) =>
    action.kind === "put-setting" ? [action.setting.key] : [],
  );
  return {
    importId,
    status: actionCount === 0
      ? "nothing_to_apply"
      : envelope.plan.conflicts.length
        ? "applied_with_conflicts"
        : "applied",
    mode,
    snapshotId,
    createdEntityIds,
    updatedEntityIds,
    settingKeys,
    identicalKeys: envelope.plan.identicalKeys,
    conflicts: envelope.plan.conflicts,
  };
}

function isLegacySnapshot(value: MigrationSnapshotRecord): value is LegacyMigrationSnapshot {
  const candidate = value as Partial<LegacyMigrationSnapshot>;
  return candidate.schema === LEGACY_SNAPSHOT_SCHEMA &&
    Boolean(candidate.source) && Boolean(candidate.before) && Boolean(candidate.after);
}

/**
 * Restores the exact pre-import values and removes only audit rows created by
 * this import. Rollback is refused after any later data/settings mutation so
 * it can never erase newer user work.
 */
export async function rollbackLegacyImport(
  importId: string,
): Promise<RolledBackLegacyImportResult> {
  await initializeMentorData();
  const database = await openMentorDatabase();
  const importRecord = await database.get("imports", importId) as LegacyImportRecord | undefined;
  if (!importRecord || importRecord.status !== "applied" || !importRecord.legacyAudit) {
    throw new Error("Esta importação não está aplicada ou não possui rollback disponível.");
  }
  const snapshotBase = await database.get(
    "migration_snapshots",
    importRecord.legacyAudit.snapshotId,
  );
  if (!snapshotBase || !isLegacySnapshot(snapshotBase)) {
    throw new Error("O snapshot integral de rollback não foi encontrado.");
  }
  const expectedChecksum = await sha256Hex(stableSerialize(snapshotMaterial(snapshotBase)));
  if (snapshotBase.checksum !== expectedChecksum) {
    throw new Error("A integridade do snapshot de rollback não pôde ser confirmada.");
  }

  const transaction = database.transaction(
    [
      "datasets",
      "entities",
      "settings",
      "revisions",
      "operations",
      "outbox",
      "conflicts",
      "imports",
    ],
    "readwrite",
  );
  const transactionCompletion = observeTransactionCompletion(transaction);
  const dataset = await transaction.objectStore("datasets").get(importRecord.datasetId);
  if (
    !dataset ||
    dataset.dataRevision !== importRecord.legacyAudit.postApplyDataRevision ||
    dataset.settingsRevision !== importRecord.legacyAudit.postApplySettingsRevision ||
    dataset.nextOperationSequence !== importRecord.legacyAudit.postApplyOperationSequence
  ) {
    await abortTransactionSafely(transaction);
    throw new Error(
      "Há alterações posteriores à importação. Faça backup e reconcilie antes de tentar rollback.",
    );
  }

  const entityStore = transaction.objectStore("entities");
  const restoredEntityIds: string[] = [];
  const removedCreatedEntityIds: string[] = [];
  for (const impact of snapshotBase.before.entities) {
    const current = await entityStore.get(impact.id);
    if (!current || stableSerialize(current) !== stableSerialize(impact.after)) {
      await abortTransactionSafely(transaction);
      throw new Error("Um registro importado mudou e não pode ser revertido automaticamente.");
    }
    if (impact.before) {
      await entityStore.put(impact.before);
      restoredEntityIds.push(impact.id);
    } else {
      await entityStore.delete(impact.id);
      removedCreatedEntityIds.push(impact.id);
    }
  }
  const settingStore = transaction.objectStore("settings");
  const restoredSettingKeys: string[] = [];
  const removedCreatedSettingKeys: string[] = [];
  for (const impact of snapshotBase.before.settings) {
    const current = await settingStore.get(impact.id);
    if (!current || stableSerialize(current) !== stableSerialize(impact.after)) {
      await abortTransactionSafely(transaction);
      throw new Error("Uma configuração importada mudou e não pode ser revertida automaticamente.");
    }
    if (impact.before) {
      await settingStore.put(impact.before);
      restoredSettingKeys.push(impact.before.key);
    } else {
      await settingStore.delete(impact.id);
      removedCreatedSettingKeys.push(impact.after.key);
    }
  }

  const operationStore = transaction.objectStore("operations");
  const operations = (await operationStore.getAll()).filter(
    (operation) => operation.importId === importId,
  );
  const operationIds = new Set(operations.map((operation) => operation.id));
  for (const operation of operations) await operationStore.delete(operation.id);
  const revisionStore = transaction.objectStore("revisions");
  const revisions = (await revisionStore.getAll()).filter(
    (revision) => revision.importId === importId,
  );
  for (const revision of revisions) await revisionStore.delete(revision.id);
  const outboxStore = transaction.objectStore("outbox");
  const outboxRows = (await outboxStore.getAll()).filter(
    (row) => operationIds.has(row.operationId),
  );
  for (const row of outboxRows) await outboxStore.delete(row.id);
  const conflictStore = transaction.objectStore("conflicts");
  const conflicts = (await conflictStore.getAll()).filter(
    (conflict) => conflict.importId === importId,
  );
  for (const conflict of conflicts) await conflictStore.delete(conflict.id);

  await transaction.objectStore("datasets").put(snapshotBase.before.dataset);
  await transaction.objectStore("imports").put({
    ...importRecord,
    status: "rolled_back",
  });
  await assertObservedTransactionCompleted(transactionCompletion);
  return {
    importId,
    status: "rolled_back",
    restoredEntityIds,
    removedCreatedEntityIds,
    restoredSettingKeys,
    removedCreatedSettingKeys,
  };
}

export async function discardStagedLegacyImport(
  importId: string,
): Promise<DiscardedLegacyImportResult> {
  await initializeMentorData();
  const database = await openMentorDatabase();
  const transaction = database.transaction(["imports", "import_stage"], "readwrite");
  const transactionCompletion = observeTransactionCompletion(transaction);
  const record = await transaction.objectStore("imports").get(importId);
  if (!record || (record.format !== "legacy-obstetricia" && record.format !== "legacy-cefaleia")) {
    await abortTransactionSafely(transaction);
    throw new Error("Importação legada não encontrada.");
  }
  const store = transaction.objectStore("import_stage");
  const keys = await store.index("by_import").getAllKeys(importId);
  if (record.status !== "validated" && record.status !== "staged") {
    await assertObservedTransactionCompleted(transactionCompletion);
    return { importId, status: "already-finalized", removedStageRows: 0 };
  }
  for (const key of keys) await store.delete(key);
  await transaction.objectStore("imports").put({
    ...record,
    status: "rejected",
  });
  await assertObservedTransactionCompleted(transactionCompletion);
  return { importId, status: "discarded", removedStageRows: keys.length };
}
