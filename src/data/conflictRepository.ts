import type { ConflictRecord } from "../domain";
import { openMentorDatabase } from "./database";
import { getActiveDataset, initializeMentorData } from "./seed";
import {
  abortTransactionSafely,
  assertObservedTransactionCompleted,
  observeTransactionCompletion,
} from "./transactionSafety";

export type RestoreConflictResolution = "kept_local";

type StoredRestoreConflict = ConflictRecord & {
  resolution?: RestoreConflictResolution;
  resolvedAt?: string;
  resolvedLocalSnapshot?: unknown;
};

export interface RestoreConflictView {
  id: string;
  importId: string | null;
  subjectKind: "entity" | "setting";
  key: string;
  reason: string;
  state: "open" | "resolved";
  createdAt: string;
  localRevision: number;
  incomingRevision: number;
  localSnapshot: unknown;
  incomingSnapshot: unknown;
  resolution: RestoreConflictResolution | null;
  resolvedAt: string | null;
  resolvedLocalSnapshot: unknown;
}

export interface ListRestoreConflictsOptions {
  state?: "open" | "resolved" | "all";
  importId?: string;
}

function asView(record: StoredRestoreConflict): RestoreConflictView {
  const subjectKind = record.subjectKind === "setting" ? "setting" : "entity";
  return {
    id: record.id,
    importId: record.importId ?? null,
    subjectKind,
    key: subjectKind === "setting"
      ? record.settingKey ?? record.entityId.replace(/^setting:/, "")
      : record.entityId,
    reason: record.reason ?? "different_existing_record",
    state: record.state,
    createdAt: record.createdAt,
    localRevision: record.localRevision,
    incomingRevision: record.remoteRevision,
    localSnapshot: record.localSnapshot,
    incomingSnapshot: record.incomingSnapshot,
    resolution: record.resolution ?? null,
    resolvedAt: record.resolvedAt ?? null,
    resolvedLocalSnapshot: record.resolvedLocalSnapshot,
  };
}

/** Reads the durable review queue written by safe backup merges. */
export async function listRestoreConflicts(
  options: ListRestoreConflictsOptions = {},
): Promise<RestoreConflictView[]> {
  await initializeMentorData();
  const dataset = await getActiveDataset();
  const database = await openMentorDatabase();
  const state = options.state ?? "all";
  return (await database.getAll("conflicts"))
    .filter((record) => record.datasetId === dataset.id)
    .filter((record) => state === "all" || record.state === state)
    .filter((record) => !options.importId || record.importId === options.importId)
    .map((record) => asView(record as StoredRestoreConflict))
    .sort((left, right) => {
      if (left.state !== right.state) return left.state === "open" ? -1 : 1;
      return right.createdAt.localeCompare(left.createdAt) || left.key.localeCompare(right.key);
    });
}

/**
 * Explicitly resolves a restore conflict by keeping the current local fact.
 * No entity or setting is overwritten; the snapshot present at review time is
 * retained as evidence of what "keep local" meant.
 */
export async function resolveRestoreConflictKeepingLocal(
  conflictId: string,
): Promise<RestoreConflictView> {
  await initializeMentorData();
  const dataset = await getActiveDataset();
  const database = await openMentorDatabase();
  const transaction = database.transaction(
    ["app_meta", "conflicts", "entities", "settings"],
    "readwrite",
  );
  const transactionCompletion = observeTransactionCompletion(transaction);
  const conflictStore = transaction.objectStore("conflicts");
  const record = await conflictStore.get(conflictId) as StoredRestoreConflict | undefined;
  const activeDatasetMeta = await transaction
    .objectStore("app_meta")
    .get("active_dataset_id");
  if (
    !record ||
    record.datasetId !== dataset.id ||
    activeDatasetMeta?.value !== dataset.id
  ) {
    await abortTransactionSafely(transaction);
    throw new Error("Conflito de restauração não encontrado.");
  }
  if (record.state === "resolved") {
    await assertObservedTransactionCompleted(transactionCompletion);
    return asView(record);
  }

  const subjectKind = record.subjectKind === "setting" ? "setting" : "entity";
  const currentLocalSnapshot = subjectKind === "setting"
    ? await transaction.objectStore("settings").get(
        `${dataset.id}:${record.settingKey ?? record.entityId.replace(/^setting:/, "")}`,
      )
    : await transaction.objectStore("entities").get(record.entityId);
  const resolvedAt = new Date().toISOString();
  const resolved: StoredRestoreConflict = {
    ...record,
    state: "resolved",
    resolution: "kept_local",
    resolvedAt,
    resolvedLocalSnapshot: currentLocalSnapshot,
  };
  await conflictStore.put(resolved);
  await assertObservedTransactionCompleted(transactionCompletion);
  return asView(resolved);
}

/** Creates a user-readable, private export of both sides of every conflict. */
export function createRestoreConflictReviewExport(
  conflicts: readonly RestoreConflictView[],
): Blob {
  const exportedAt = new Date().toISOString();
  const content = {
    format: "mentor-bauer-restore-conflict-review",
    formatVersion: 1,
    exportedAt,
    conflictCount: conflicts.length,
    note:
      "Relatório privado. Nenhum lado foi aplicado por esta exportação; local e recebido permanecem identificados separadamente.",
    conflicts: conflicts.map((conflict) => ({
      id: conflict.id,
      importId: conflict.importId,
      subjectKind: conflict.subjectKind,
      key: conflict.key,
      reason: conflict.reason,
      state: conflict.state,
      createdAt: conflict.createdAt,
      localRevision: conflict.localRevision,
      incomingRevision: conflict.incomingRevision,
      resolution: conflict.resolution,
      resolvedAt: conflict.resolvedAt,
      localSnapshotAtConflict: conflict.localSnapshot,
      incomingSnapshot: conflict.incomingSnapshot,
      localSnapshotAtResolution: conflict.resolvedLocalSnapshot,
    })),
  };
  return new Blob([JSON.stringify(content, null, 2)], {
    type: "application/json;charset=utf-8",
  });
}
