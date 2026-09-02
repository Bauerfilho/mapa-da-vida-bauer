import type { ImportRecord, ImportStageRecord } from "../domain/model";
import { openMentorDatabase, type MentorDatabase } from "./database";

/**
 * Decrypted import staging is intentionally short-lived. A prepared restore is
 * only resumable by the currently open flow, so keeping abandoned plaintext
 * longer than one day adds privacy risk without adding useful recoverability.
 */
export const IMPORT_STAGE_TTL_MS = 24 * 60 * 60 * 1_000;
export const IMPORT_STAGE_CLEANUP_THROTTLE_MS = 15 * 60 * 1_000;

const PENDING_IMPORT_STATUSES = new Set<ImportRecord["status"]>([
  "staged",
  "validated",
]);

export interface ImportStageCleanupPlan {
  stalePendingImportIds: string[];
  stageRowIdsToDelete: string[];
  orphanStageRowIds: string[];
  finalizedStageRowIds: string[];
}

export interface ImportStageCleanupResult extends ImportStageCleanupPlan {
  cutoffISO: string;
  executedAtISO: string;
  rejectionReason: "expired_or_anomalous_staging";
  rejectedImportCount: number;
  removedStageRowCount: number;
}

export type ImportStageCleanupRunResult =
  | {
      status: "completed";
      attemptedAtISO: string;
      cleanup: ImportStageCleanupResult;
    }
  | {
      status: "throttled";
      attemptedAtISO: string;
      nextEligibleAtISO: string;
    }
  | {
      status: "failed";
      attemptedAtISO: string | null;
      error: Error;
    };

export interface ImportStageCleanupRunOptions {
  database?: MentorDatabase;
  now?: Date;
  force?: boolean;
}

type ImportStageCleanupExecutor = (
  database?: MentorDatabase,
  now?: Date,
) => Promise<ImportStageCleanupResult>;

function stageTimestamp(importRecord: ImportRecord): number | null {
  const parsed = Date.parse(importRecord.validatedAt ?? importRecord.createdAt);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pure, deterministic planner used both by startup cleanup and unit tests. */
export function planImportStageCleanup(
  imports: readonly ImportRecord[],
  stageRows: readonly ImportStageRecord[],
  nowMilliseconds: number,
): ImportStageCleanupPlan {
  if (!Number.isFinite(nowMilliseconds)) {
    throw new Error("O instante da limpeza de staging precisa ser válido.");
  }

  const importsById = new Map(imports.map((record) => [record.id, record]));
  const stalePendingImportIds = imports
    .filter((record) => {
      if (!PENDING_IMPORT_STATUSES.has(record.status)) return false;
      const timestamp = stageTimestamp(record);
      // Staging timestamps are written by this device. A value in the future
      // therefore indicates clock rollback or corrupted metadata. Treat it as
      // disposable instead of allowing decrypted plaintext to survive until a
      // distant wall-clock date.
      return timestamp === null ||
        timestamp > nowMilliseconds ||
        nowMilliseconds - timestamp >= IMPORT_STAGE_TTL_MS;
    })
    .map((record) => record.id)
    .sort();
  const stalePending = new Set(stalePendingImportIds);
  const orphanStageRowIds: string[] = [];
  const finalizedStageRowIds: string[] = [];
  const stageRowIdsToDelete: string[] = [];

  for (const row of stageRows) {
    const importRecord = importsById.get(row.importId);
    if (!importRecord) {
      orphanStageRowIds.push(row.id);
      stageRowIdsToDelete.push(row.id);
      continue;
    }
    if (!PENDING_IMPORT_STATUSES.has(importRecord.status)) {
      finalizedStageRowIds.push(row.id);
      stageRowIdsToDelete.push(row.id);
      continue;
    }
    if (stalePending.has(importRecord.id)) stageRowIdsToDelete.push(row.id);
  }

  return {
    stalePendingImportIds,
    stageRowIdsToDelete: [...new Set(stageRowIdsToDelete)].sort(),
    orphanStageRowIds: orphanStageRowIds.sort(),
    finalizedStageRowIds: finalizedStageRowIds.sort(),
  };
}

/**
 * Removes only disposable restore staging. Canonical entities, settings,
 * revisions, operations and every other store are outside this transaction.
 */
export async function cleanupExpiredImportStaging(
  database?: MentorDatabase,
  now = new Date(),
): Promise<ImportStageCleanupResult> {
  const nowMilliseconds = now.getTime();
  if (!Number.isFinite(nowMilliseconds)) {
    throw new Error("O instante da limpeza de staging precisa ser válido.");
  }

  const resolvedDatabase = database ?? await openMentorDatabase();
  const transaction = resolvedDatabase.transaction(
    ["imports", "import_stage"],
    "readwrite",
  );
  const importStore = transaction.objectStore("imports");
  const stageStore = transaction.objectStore("import_stage");
  const [imports, stageRows] = await Promise.all([
    importStore.getAll(),
    stageStore.getAll(),
  ]);
  const plan = planImportStageCleanup(imports, stageRows, nowMilliseconds);
  const importsById = new Map(imports.map((record) => [record.id, record]));
  const writes: Array<Promise<unknown>> = [];

  for (const importId of plan.stalePendingImportIds) {
    const current = importsById.get(importId);
    if (current && PENDING_IMPORT_STATUSES.has(current.status)) {
      writes.push(importStore.put({ ...current, status: "rejected" }));
    }
  }
  for (const stageRowId of plan.stageRowIdsToDelete) {
    writes.push(stageStore.delete(stageRowId));
  }
  await Promise.all(writes);
  await transaction.done;

  return {
    ...plan,
    cutoffISO: new Date(nowMilliseconds - IMPORT_STAGE_TTL_MS).toISOString(),
    executedAtISO: new Date(nowMilliseconds).toISOString(),
    // ImportRecord has no rejection timestamp/reason fields. Persisting new
    // metadata would require a model and backup-format review, so this cleanup
    // deliberately records only the existing `rejected` status and exposes the
    // reason in its runtime result.
    rejectionReason: "expired_or_anomalous_staging",
    rejectedImportCount: plan.stalePendingImportIds.length,
    removedStageRowCount: plan.stageRowIdsToDelete.length,
  };
}

/**
 * Creates a concurrency-safe, throttled cleanup trigger. Failures are returned
 * as data so optional hygiene can run during bootstrap/focus without making the
 * application unavailable. Direct callers that need strict failure semantics
 * can continue to use `cleanupExpiredImportStaging`.
 */
export function createImportStageCleanupRunner(
  cleanup: ImportStageCleanupExecutor = cleanupExpiredImportStaging,
  throttleMilliseconds = IMPORT_STAGE_CLEANUP_THROTTLE_MS,
): (options?: ImportStageCleanupRunOptions) => Promise<ImportStageCleanupRunResult> {
  if (!Number.isFinite(throttleMilliseconds) || throttleMilliseconds < 0) {
    throw new Error("O intervalo da limpeza de staging precisa ser válido.");
  }

  let lastAttemptMilliseconds: number | null = null;
  let inFlight: Promise<ImportStageCleanupRunResult> | null = null;

  return (options = {}) => {
    if (inFlight) return inFlight;

    const now = options.now ?? new Date();
    const nowMilliseconds = now.getTime();
    if (!Number.isFinite(nowMilliseconds)) {
      return Promise.resolve({
        status: "failed",
        attemptedAtISO: null,
        error: new Error("O instante da limpeza de staging precisa ser válido."),
      });
    }

    if (!options.force && lastAttemptMilliseconds !== null) {
      const elapsed = nowMilliseconds - lastAttemptMilliseconds;
      if (elapsed >= 0 && elapsed < throttleMilliseconds) {
        return Promise.resolve({
          status: "throttled",
          attemptedAtISO: new Date(lastAttemptMilliseconds).toISOString(),
          nextEligibleAtISO: new Date(
            lastAttemptMilliseconds + throttleMilliseconds,
          ).toISOString(),
        });
      }
    }

    lastAttemptMilliseconds = nowMilliseconds;
    const attemptedAtISO = now.toISOString();
    const attempt = cleanup(options.database, now)
      .then<ImportStageCleanupRunResult>((result) => ({
        status: "completed",
        attemptedAtISO,
        cleanup: result,
      }))
      .catch<ImportStageCleanupRunResult>((cause: unknown) => ({
        status: "failed",
        attemptedAtISO,
        error: cause instanceof Error ? cause : new Error(String(cause)),
      }))
      .finally(() => {
        if (inFlight === attempt) inFlight = null;
      });
    inFlight = attempt;
    return attempt;
  };
}

export const cleanupImportStagingIfDue = createImportStageCleanupRunner();
