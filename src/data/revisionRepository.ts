import type { IDBPTransaction } from "idb";
import {
  ENTITY_USER_EDIT_REASON,
  EntityEditValidationError,
  EntityRevisionConflictError,
  EntityUndoUnavailableError,
  MAX_ENTITY_REVISION_SUMMARY_LENGTH,
  mergePreservingUnknown,
  validateRevisionPayloadPatch,
  type EntityEditSession,
  type EntityPayloadByType,
  type EntityType,
  type MentorEntity,
  type OperationRecord,
  type RevisionAwareEntityPatch,
  type RevisionMutationResult,
  type RevisionRecord,
  type UndoEntityMutationInput,
  type UndoEntityMutationResult,
} from "../domain";
import {
  openMentorDatabase,
  type MentorDatabaseSchema,
} from "./database";
import { isMentorEntityCandidate } from "./backup";
import { assertMedicationSlotInTransaction } from "./medicationUniqueness";
import { getActiveDataset, initializeMentorData } from "./seed";
import {
  abortTransactionSafely,
  assertObservedTransactionCompleted,
  observeTransactionCompletion,
} from "./transactionSafety";

type RevisionWriteStores = [
  "app_meta",
  "datasets",
  "entities",
  "revisions",
  "operations",
  "outbox",
];

type RevisionWriteTransaction = IDBPTransaction<
  MentorDatabaseSchema,
  RevisionWriteStores,
  "readwrite"
>;

type EntityMutationKind = Extract<
  OperationRecord["kind"],
  "update" | "delete" | "restore"
>;

const UNDOABLE_OPERATION_KINDS = new Set<OperationRecord["kind"]>([
  "create",
  "update",
  "delete",
  "restore",
]);

/** @internal Pure compatibility gate used by Undo and adversarial tests. */
export function isUndoSnapshotCandidate<TType extends EntityType>(
  previous: unknown,
  current: MentorEntity<TType>,
): previous is MentorEntity<TType> {
  if (!isMentorEntityCandidate(previous, current.datasetId)) return false;
  const preservesSource = previous.source === current.source;
  const restoresFirstSeedSnapshot =
    previous.source === "seed" &&
    previous.revision === 1 &&
    current.source === "manual" &&
    current.revision === 2;
  return (
    previous.id === current.id &&
    previous.type === current.type &&
    previous.domain === current.domain &&
    previous.timezone === current.timezone &&
    previous.schemaVersion === current.schemaVersion &&
    (preservesSource || restoresFirstSeedSnapshot) &&
    previous.createdAt === current.createdAt &&
    previous.revision === current.revision - 1 &&
    (previous.status === "active" || previous.status === "deleted")
  );
}

function nowISO(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function assertRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new EntityEditValidationError("A revisão esperada precisa ser um inteiro positivo.");
  }
}

function assertInstant(value: string, label: string): void {
  if (!value.trim() || Number.isNaN(Date.parse(value))) {
    throw new EntityEditValidationError(`${label} precisa ser um instante válido.`);
  }
}

function assertPayloadPatch(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EntityEditValidationError("A alteração dos dados precisa ser um objeto.");
  }
}

async function loadCurrentForWrite<TType extends EntityType>(
  transaction: RevisionWriteTransaction,
  entityId: string,
  expectedRevision: number,
): Promise<MentorEntity<TType>> {
  const current = await transaction.objectStore("entities").get(entityId);
  if (!current) {
    await abortTransactionSafely(transaction);
    throw new EntityEditValidationError("Registro não encontrado.");
  }
  if (current.revision !== expectedRevision) {
    await abortTransactionSafely(transaction);
    throw new EntityRevisionConflictError(
      entityId,
      expectedRevision,
      current.revision,
      current as MentorEntity<TType>,
    );
  }
  return current as MentorEntity<TType>;
}

async function persistRevisionMutation<TType extends EntityType>(
  transaction: RevisionWriteTransaction,
  current: MentorEntity<TType>,
  updated: MentorEntity<TType>,
  options: {
    kind: EntityMutationKind;
    reason: string;
    summary: string;
    timestamp: string;
  },
): Promise<RevisionMutationResult<TType>> {
  const datasetStore = transaction.objectStore("datasets");
  const dataset = await datasetStore.get(current.datasetId);
  if (!dataset) {
    await abortTransactionSafely(transaction);
    throw new EntityEditValidationError("O conjunto de dados do registro não foi encontrado.");
  }

  if (dataset.status !== "active") {
    await abortTransactionSafely(transaction);
    throw new EntityEditValidationError(
      "O registro não pertence ao conjunto de dados ativo.",
    );
  }
  const activeDatasetMeta = await transaction
    .objectStore("app_meta")
    .get("active_dataset_id");
  if (activeDatasetMeta?.value !== current.datasetId) {
    await abortTransactionSafely(transaction);
    throw new EntityEditValidationError(
      "O registro não pertence ao conjunto de dados selecionado.",
    );
  }

  // Re-read inside the same write transaction immediately before the put.
  // IndexedDB serializes read-write transactions, and this is the final CAS
  // guard that prevents a stale editor from silently overwriting a newer edit.
  const latest = await transaction.objectStore("entities").get(current.id);
  if (!latest || latest.revision !== current.revision) {
    await abortTransactionSafely(transaction);
    if (!latest) {
      throw new EntityEditValidationError("O registro deixou de existir.");
    }
    throw new EntityRevisionConflictError(
      current.id,
      current.revision,
      latest.revision,
      latest as MentorEntity<TType>,
    );
  }

  await assertMedicationSlotInTransaction(transaction, updated);
  const operationId = makeId("operation");
  const sequence = dataset.nextOperationSequence + 1;
  const operation: OperationRecord = {
    id: operationId,
    datasetId: current.datasetId,
    entityId: current.id,
    sequence,
    kind: options.kind,
    status: "committed",
    baseRevision: current.revision,
    nextRevision: updated.revision,
    summary: options.summary,
    createdAt: options.timestamp,
  };
  const revision: RevisionRecord = {
    id: makeId("revision"),
    datasetId: current.datasetId,
    entityId: current.id,
    revision: updated.revision,
    operationId,
    reason: options.reason,
    snapshot: updated,
    createdAt: options.timestamp,
  };

  await transaction.objectStore("entities").put(updated);
  await datasetStore.put({
    ...dataset,
    nextOperationSequence: sequence,
    dataRevision: dataset.dataRevision + 1,
    updatedAt: options.timestamp,
  });
  await transaction.objectStore("revisions").add(revision);
  await transaction.objectStore("operations").add(operation);
  await transaction.objectStore("outbox").add({
    id: makeId("outbox"),
    datasetId: current.datasetId,
    operationId,
    entityId: current.id,
    state: "pending",
    createdAt: options.timestamp,
  });

  return { entity: updated, operation, revision };
}

export async function getEntityEditSession<TType extends EntityType = EntityType>(
  entityId: string,
  expectedType?: TType,
): Promise<EntityEditSession<TType>> {
  await initializeMentorData();
  const activeDataset = await getActiveDataset();
  const database = await openMentorDatabase();
  const entity = await database.get("entities", entityId);
  if (!entity) {
    throw new EntityEditValidationError("Registro não encontrado.");
  }
  if (entity.datasetId !== activeDataset.id) {
    throw new EntityEditValidationError(
      "O registro não pertence ao conjunto de dados selecionado.",
    );
  }
  if (expectedType && entity.type !== expectedType) {
    throw new EntityEditValidationError(
      `O registro não é do tipo esperado (${expectedType}).`,
    );
  }

  const revisions = await database.getAllFromIndex(
    "revisions",
    "by_entity_revision",
    IDBKeyRange.bound([entityId, 0], [entityId, Number.MAX_SAFE_INTEGER]),
  );
  const operationIds = new Set(revisions.map((revision) => revision.operationId));
  const operations = (await database.getAll("operations")).filter((operation) =>
    operationIds.has(operation.id),
  );
  const operationById = new Map(operations.map((operation) => [operation.id, operation]));
  const history = revisions
    .map((revision) => ({
      revision,
      operation: operationById.get(revision.operationId) ?? null,
    }))
    .sort((left, right) => right.revision.revision - left.revision.revision);
  const latestOperation = history[0]?.operation ?? null;

  return {
    entity: entity as MentorEntity<TType>,
    history,
    latestOperation,
    canUndo: Boolean(
      latestOperation &&
        latestOperation.status === "committed" &&
        UNDOABLE_OPERATION_KINDS.has(latestOperation.kind) &&
        (entity.status === "active" || entity.status === "deleted"),
    ),
  };
}

/**
 * Compare-and-swap entity edit. Only the explicitly patched fields change;
 * all unknown payload and top-level fields remain intact.
 */
export async function updateEntityRevisionAware<TType extends EntityType>(
  input: RevisionAwareEntityPatch<TType>,
): Promise<RevisionMutationResult<TType>> {
  assertRevision(input.expectedRevision);
  if (typeof input.summary !== "string") {
    throw new EntityEditValidationError("Explique brevemente o que foi alterado.");
  }
  const summary = input.summary.trim();
  if (!summary) {
    throw new EntityEditValidationError("Explique brevemente o que foi alterado.");
  }
  if (summary.length > MAX_ENTITY_REVISION_SUMMARY_LENGTH) {
    throw new EntityEditValidationError(
      `O motivo pode ter no máximo ${MAX_ENTITY_REVISION_SUMMARY_LENGTH} caracteres.`,
    );
  }
  if (input.localDate !== undefined) {
    throw new EntityEditValidationError(
      "A data do registro exige o editor específico do domínio.",
    );
  }
  if (input.occurredAtUTC !== undefined) {
    throw new EntityEditValidationError(
      "O editor genérico não altera o instante original do registro.",
    );
  }
  const timestamp = input.committedAtUTC ?? nowISO();
  assertInstant(timestamp, "A data/hora da alteração");
  assertPayloadPatch(input.payloadPatch);
  if (input.payloadPatch === undefined) {
    throw new EntityEditValidationError("Nenhuma alteração foi informada.");
  }

  await initializeMentorData();
  const database = await openMentorDatabase();
  const transaction = database.transaction(
    ["app_meta", "datasets", "entities", "revisions", "operations", "outbox"],
    "readwrite",
  );
  const transactionCompletion = observeTransactionCompletion(transaction);
  const current = await loadCurrentForWrite<TType>(
    transaction,
    input.entityId,
    input.expectedRevision,
  );
  if (current.status !== "active") {
    await abortTransactionSafely(transaction);
    throw new EntityEditValidationError(
      "Restaure o registro antes de editar seus dados.",
    );
  }

  let payloadChanged = false;
  if (input.payloadPatch !== undefined) {
    const patchValidation = validateRevisionPayloadPatch(
      current.type,
      current.payload,
      input.payloadPatch,
    );
    if (!patchValidation.valid) {
      await abortTransactionSafely(transaction);
      throw new EntityEditValidationError(
        patchValidation.error ?? "Esta alteração exige o editor específico do domínio.",
      );
    }
    payloadChanged = patchValidation.changed;
  }
  if (!payloadChanged) {
    await abortTransactionSafely(transaction);
    throw new EntityEditValidationError("Nenhuma alteração segura foi informada.");
  }

  const payload = input.payloadPatch === undefined
    ? current.payload
    : mergePreservingUnknown(
        current.payload,
        input.payloadPatch,
      ) as EntityPayloadByType[TType];
  const updated: MentorEntity<TType> = {
    ...current,
    payload,
    revision: current.revision + 1,
    updatedAt: timestamp,
  };

  // Mesmo uma edição apenas textual deve preservar o contrato completo do painel.
  if ((current.domain === "exames" || ("schema" in current.payload && ["clinical-reference-personal-v1", "agenda-annual-date-v1"].includes(String(current.payload.schema)))) && !isMentorEntityCandidate(updated, current.datasetId)) {
    await abortTransactionSafely(transaction);
    throw new EntityEditValidationError("A revisão ultrapassa os limites ou altera a estrutura do registro; nenhum dado foi alterado.");
  }

  const result = await persistRevisionMutation(transaction, current, updated, {
    kind: "update",
    reason: ENTITY_USER_EDIT_REASON,
    summary,
    timestamp,
  });
  await assertObservedTransactionCompleted(transactionCompletion);
  return result;
}

/**
 * Applies the exact inverse of the operation that produced the current
 * revision. Older/non-latest operations are rejected instead of rebasing or
 * overwriting intervening work.
 */
export async function undoEntityMutation<TType extends EntityType = EntityType>(
  input: UndoEntityMutationInput,
): Promise<UndoEntityMutationResult<TType>> {
  assertRevision(input.expectedRevision);
  const timestamp = input.committedAtUTC ?? nowISO();
  assertInstant(timestamp, "A data/hora do desfazer");

  await initializeMentorData();
  const database = await openMentorDatabase();
  const transaction = database.transaction(
    ["app_meta", "datasets", "entities", "revisions", "operations", "outbox"],
    "readwrite",
  );
  const transactionCompletion = observeTransactionCompletion(transaction);
  const current = await loadCurrentForWrite<TType>(
    transaction,
    input.entityId,
    input.expectedRevision,
  );
  const revisionStore = transaction.objectStore("revisions");
  const currentRevision = await revisionStore
    .index("by_entity_revision")
    .get([current.id, current.revision]);
  if (!currentRevision) {
    await abortTransactionSafely(transaction);
    throw new EntityUndoUnavailableError(
      "O histórico desta revisão não foi encontrado; nada foi alterado.",
    );
  }
  const operation = await transaction
    .objectStore("operations")
    .get(currentRevision.operationId);
  if (!operation || operation.status !== "committed") {
    await abortTransactionSafely(transaction);
    throw new EntityUndoUnavailableError(
      "A operação atual não está disponível para desfazer.",
    );
  }
  if (input.operationId && input.operationId !== operation.id) {
    await abortTransactionSafely(transaction);
    throw new EntityUndoUnavailableError(
      "Essa operação já não é a alteração mais recente. Nada foi sobrescrito.",
    );
  }
  if (!UNDOABLE_OPERATION_KINDS.has(operation.kind)) {
    await abortTransactionSafely(transaction);
    throw new EntityUndoUnavailableError(
      "Esta alteração exige um fluxo de reversão específico.",
    );
  }

  const previousRevision = current.revision > 1
    ? await revisionStore
        .index("by_entity_revision")
        .get([current.id, current.revision - 1])
    : undefined;

  let updated: MentorEntity<TType>;
  let inverseKind: EntityMutationKind;
  if (!previousRevision) {
    if (operation.kind !== "create" || current.status !== "active") {
      await abortTransactionSafely(transaction);
      throw new EntityUndoUnavailableError(
        "Não existe uma versão anterior íntegra para restaurar.",
      );
    }
    updated = {
      ...current,
      status: "deleted",
      revision: current.revision + 1,
      updatedAt: timestamp,
    };
    inverseKind = "delete";
  } else {
    const previous = previousRevision.snapshot;
    if (!isUndoSnapshotCandidate(previous, current)) {
      await abortTransactionSafely(transaction);
      throw new EntityUndoUnavailableError(
        "A versão anterior não é compatível; nada foi alterado.",
      );
    }
    updated = {
      ...previous,
      id: current.id,
      datasetId: current.datasetId,
      createdAt: current.createdAt,
      revision: current.revision + 1,
      updatedAt: timestamp,
    };
    inverseKind = current.status === "deleted" && updated.status === "active"
      ? "restore"
      : current.status === "active" && updated.status === "deleted"
        ? "delete"
        : "update";
  }

  const result = await persistRevisionMutation(transaction, current, updated, {
    kind: inverseKind,
    reason: `undo_operation:${operation.id}`,
    summary: `Desfeita com segurança: ${operation.summary}`.slice(
      0,
      MAX_ENTITY_REVISION_SUMMARY_LENGTH,
    ),
    timestamp,
  });
  await assertObservedTransactionCompleted(transactionCompletion);
  return { ...result, undoneOperation: operation };
}
