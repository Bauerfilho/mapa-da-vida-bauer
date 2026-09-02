import { expect, test } from "@playwright/test";
import type { ImportRecord, ImportStageRecord } from "../src/domain/model";
import {
  cleanupExpiredImportStaging,
  createImportStageCleanupRunner,
  IMPORT_STAGE_CLEANUP_THROTTLE_MS,
  IMPORT_STAGE_TTL_MS,
  planImportStageCleanup,
} from "../src/data/stagingCleanup";
import {
  createRetryableAsyncSingleton,
  type MentorDatabase,
} from "../src/data/database";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");

function importRecord(
  id: string,
  status: ImportRecord["status"],
  createdAt: string,
  validatedAt?: string,
): ImportRecord {
  return {
    id,
    datasetId: "bauer-personal-primary",
    format: "bauerlife",
    status,
    sourceName: `${id}.bauerlife`,
    payloadChecksum: id.padEnd(64, "0").slice(0, 64),
    storeCounts: {},
    createdAt,
    ...(validatedAt ? { validatedAt } : {}),
  };
}

function stageRow(id: string, importId: string): ImportStageRecord {
  return {
    id,
    importId,
    datasetId: "bauer-personal-primary",
    storeName: "entities",
    sourceKey: id,
    value: { private: "temporary plaintext" },
  };
}

test("keeps fresh pending staging and expires it exactly at the 24-hour TTL", () => {
  const fresh = importRecord(
    "fresh",
    "validated",
    new Date(NOW - IMPORT_STAGE_TTL_MS + 1).toISOString(),
  );
  const boundary = importRecord(
    "boundary",
    "staged",
    new Date(NOW - IMPORT_STAGE_TTL_MS).toISOString(),
  );
  const plan = planImportStageCleanup(
    [fresh, boundary],
    [stageRow("row-fresh", fresh.id), stageRow("row-boundary", boundary.id)],
    NOW,
  );

  expect(plan.stalePendingImportIds).toEqual(["boundary"]);
  expect(plan.stageRowIdsToDelete).toEqual(["row-boundary"]);
});

test("uses validation time as the latest staging activity", () => {
  const record = importRecord(
    "recently-validated",
    "validated",
    new Date(NOW - IMPORT_STAGE_TTL_MS * 2).toISOString(),
    new Date(NOW - 60_000).toISOString(),
  );
  const plan = planImportStageCleanup(
    [record],
    [stageRow("row-recent", record.id)],
    NOW,
  );

  expect(plan.stalePendingImportIds).toEqual([]);
  expect(plan.stageRowIdsToDelete).toEqual([]);
});

test("removes orphan and finalized staging immediately without rejecting final imports", () => {
  const applied = importRecord("applied", "applied", new Date(NOW).toISOString());
  const rejected = importRecord("rejected", "rejected", new Date(NOW).toISOString());
  const plan = planImportStageCleanup(
    [applied, rejected],
    [
      stageRow("row-applied", applied.id),
      stageRow("row-rejected", rejected.id),
      stageRow("row-orphan", "missing-import"),
    ],
    NOW,
  );

  expect(plan.stalePendingImportIds).toEqual([]);
  expect(plan.orphanStageRowIds).toEqual(["row-orphan"]);
  expect(plan.finalizedStageRowIds).toEqual(["row-applied", "row-rejected"]);
  expect(plan.stageRowIdsToDelete).toEqual([
    "row-applied",
    "row-orphan",
    "row-rejected",
  ]);
});

test("malformed pending timestamps cannot retain decrypted staging indefinitely", () => {
  const malformed = importRecord("malformed", "validated", "not-a-date");
  const plan = planImportStageCleanup(
    [malformed],
    [stageRow("row-malformed", malformed.id)],
    NOW,
  );

  expect(plan.stalePendingImportIds).toEqual(["malformed"]);
  expect(plan.stageRowIdsToDelete).toEqual(["row-malformed"]);
});

test("future pending timestamps are anomalous and cannot retain plaintext", () => {
  const future = importRecord(
    "future-clock",
    "validated",
    new Date(NOW + IMPORT_STAGE_TTL_MS * 30).toISOString(),
  );
  const plan = planImportStageCleanup(
    [future],
    [stageRow("row-future", future.id)],
    NOW,
  );

  expect(plan.stalePendingImportIds).toEqual(["future-clock"]);
  expect(plan.stageRowIdsToDelete).toEqual(["row-future"]);
});

test("rejects an invalid cleanup clock instead of making a destructive guess", () => {
  expect(() => planImportStageCleanup([], [], Number.NaN)).toThrow(
    "instante da limpeza de staging precisa ser válido",
  );
});

test("runtime cleanup transacts only imports and staging while canonical facts stay untouched", async () => {
  const expired = importRecord(
    "expired-runtime",
    "validated",
    new Date(NOW - IMPORT_STAGE_TTL_MS).toISOString(),
  );
  const imports = new Map([[expired.id, expired]]);
  const stageRows = new Map([["row-runtime", stageRow("row-runtime", expired.id)]]);
  const canonicalFacts = new Map([["fact-1", { value: "must survive" }]]);
  const transactionRequests: Array<{ stores: string[]; mode: string }> = [];

  const fakeDatabase = {
    transaction(storeNames: string[], mode: string) {
      transactionRequests.push({ stores: [...storeNames], mode });
      return {
        objectStore(name: "imports" | "import_stage") {
          if (name === "imports") {
            return {
              getAll: async () => [...imports.values()],
              get: async (id: string) => imports.get(id),
              put: async (record: ImportRecord) => { imports.set(record.id, record); },
            };
          }
          return {
            getAll: async () => [...stageRows.values()],
            delete: async (id: string) => { stageRows.delete(id); },
          };
        },
        done: Promise.resolve(),
      };
    },
  } as unknown as MentorDatabase;

  const result = await cleanupExpiredImportStaging(fakeDatabase, new Date(NOW));

  expect(transactionRequests).toEqual([
    { stores: ["imports", "import_stage"], mode: "readwrite" },
  ]);
  expect(result).toMatchObject({ rejectedImportCount: 1, removedStageRowCount: 1 });
  expect(result).toMatchObject({
    executedAtISO: new Date(NOW).toISOString(),
    rejectionReason: "expired_or_anomalous_staging",
  });
  expect(imports.get(expired.id)?.status).toBe("rejected");
  expect(stageRows.size).toBe(0);
  expect(canonicalFacts.get("fact-1")).toEqual({ value: "must survive" });
});

test("throttled cleanup can run again during a long-lived session", async () => {
  let calls = 0;
  const cleanupResult = {
    stalePendingImportIds: [],
    stageRowIdsToDelete: [],
    orphanStageRowIds: [],
    finalizedStageRowIds: [],
    cutoffISO: new Date(NOW - IMPORT_STAGE_TTL_MS).toISOString(),
    executedAtISO: new Date(NOW).toISOString(),
    rejectionReason: "expired_or_anomalous_staging" as const,
    rejectedImportCount: 0,
    removedStageRowCount: 0,
  };
  const runner = createImportStageCleanupRunner(async () => {
    calls += 1;
    return cleanupResult;
  });

  const first = await runner({ now: new Date(NOW) });
  const throttled = await runner({
    now: new Date(NOW + IMPORT_STAGE_CLEANUP_THROTTLE_MS - 1),
  });
  const repeated = await runner({
    now: new Date(NOW + IMPORT_STAGE_CLEANUP_THROTTLE_MS),
  });

  expect(first.status).toBe("completed");
  expect(throttled.status).toBe("throttled");
  expect(repeated.status).toBe("completed");
  expect(calls).toBe(2);
});

test("cleanup failure is reported without touching canonical stores or rejecting callers", async () => {
  const canonicalFacts = new Map([["fact-1", { value: "must survive" }]]);
  const transactionRequests: Array<{ stores: string[]; mode: string }> = [];
  const failingDatabase = {
    transaction(storeNames: string[], mode: string) {
      transactionRequests.push({ stores: [...storeNames], mode });
      throw new Error("simulated staging transaction failure");
    },
  } as unknown as MentorDatabase;
  const runner = createImportStageCleanupRunner();

  const result = await runner({ database: failingDatabase, now: new Date(NOW) });

  expect(result.status).toBe("failed");
  if (result.status === "failed") {
    expect(result.error.message).toContain("simulated staging transaction failure");
  }
  expect(transactionRequests).toEqual([
    { stores: ["imports", "import_stage"], mode: "readwrite" },
  ]);
  expect(canonicalFacts.get("fact-1")).toEqual({ value: "must survive" });
});

test("retryable async singleton shares one attempt and retries after rejection", async () => {
  let attempts = 0;
  const singleton = createRetryableAsyncSingleton(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("first open failed");
    return `connection-${attempts}`;
  });

  const first = singleton.get();
  const sameAttempt = singleton.get();
  expect(sameAttempt).toBe(first);
  await expect(first).rejects.toThrow("first open failed");

  await expect(singleton.get()).resolves.toBe("connection-2");
  expect(attempts).toBe(2);
});
