import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  AppMetaRecord,
  ConflictRecord,
  DatasetRecord,
  ExternalCacheRecord,
  ImportRecord,
  ImportStageRecord,
  MentorEntity,
  MetricCacheRecord,
  MigrationSnapshotRecord,
  OperationRecord,
  OutboxRecord,
  RevisionRecord,
  SettingRecord,
  StorageDurabilityStatus,
  SyncMetaRecord,
  VaultMetaRecord,
} from "../domain/model";

export const DATABASE_NAME = "bauer-life-mentor";
export const DATABASE_VERSION = 2;

export interface MentorDatabaseSchema extends DBSchema {
  app_meta: {
    key: string;
    value: AppMetaRecord;
  };
  datasets: {
    key: string;
    value: DatasetRecord;
    indexes: {
      by_status: DatasetRecord["status"];
    };
  };
  entities: {
    key: string;
    value: MentorEntity;
    indexes: {
      by_dataset: string;
      by_dataset_domain: [string, string];
      by_dataset_date: [string, string];
      by_dataset_domain_date: [string, string, string];
      by_dataset_type_date: [string, string, string];
      by_updated_at: string;
    };
  };
  revisions: {
    key: string;
    value: RevisionRecord;
    indexes: {
      by_entity_revision: [string, number];
      by_dataset_created: [string, string];
    };
  };
  operations: {
    key: string;
    value: OperationRecord;
    indexes: {
      by_dataset_created: [string, string];
      by_status: OperationRecord["status"];
    };
  };
  settings: {
    key: string;
    value: SettingRecord;
    indexes: {
      by_dataset: string;
    };
  };
  metrics_cache: {
    key: string;
    value: MetricCacheRecord;
    indexes: {
      by_dataset: string;
      by_dataset_metric: [string, string];
    };
  };
  imports: {
    key: string;
    value: ImportRecord;
    indexes: {
      by_dataset_created: [string, string];
      by_status: ImportRecord["status"];
    };
  };
  import_stage: {
    key: string;
    value: ImportStageRecord;
    indexes: {
      by_import: string;
      by_import_store: [string, string];
    };
  };
  migration_snapshots: {
    key: string;
    value: MigrationSnapshotRecord;
    indexes: {
      by_dataset_created: [string, string];
    };
  };
  vault_meta: {
    key: string;
    value: VaultMetaRecord;
    indexes: {
      by_dataset: string;
    };
  };
  outbox: {
    key: string;
    value: OutboxRecord;
    indexes: {
      by_dataset_state: [string, OutboxRecord["state"]];
      by_operation: string;
    };
  };
  conflicts: {
    key: string;
    value: ConflictRecord;
    indexes: {
      by_dataset_state: [string, ConflictRecord["state"]];
      by_entity: string;
    };
  };
  sync_meta: {
    key: string;
    value: SyncMetaRecord;
  };
  external_cache: {
    key: string;
    value: ExternalCacheRecord;
    indexes: {
      by_dataset: string;
      by_provider: string;
    };
  };
}

export type MentorDatabase = IDBPDatabase<MentorDatabaseSchema>;

export interface RetryableAsyncSingleton<T> {
  get: () => Promise<T>;
  peek: () => Promise<T> | null;
  reset: (expected?: Promise<T>) => void;
}

/**
 * Shares one in-flight/resolved attempt while ensuring a rejected attempt is
 * never cached forever. The identity check prevents an older rejection from
 * clearing a newer retry.
 */
export function createRetryableAsyncSingleton<T>(
  factory: () => Promise<T>,
): RetryableAsyncSingleton<T> {
  let cached: Promise<T> | null = null;
  return {
    get() {
      if (cached) return cached;
      let attempt!: Promise<T>;
      attempt = Promise.resolve()
        .then(factory)
        .catch((error: unknown) => {
          if (cached === attempt) cached = null;
          throw error;
        });
      cached = attempt;
      return attempt;
    },
    peek: () => cached,
    reset(expected) {
      if (expected === undefined || cached === expected) cached = null;
    },
  };
}

function createVersionOneStores(
  database: IDBPDatabase<MentorDatabaseSchema>,
): void {
  database.createObjectStore("app_meta", { keyPath: "key" });

  const datasets = database.createObjectStore("datasets", { keyPath: "id" });
  datasets.createIndex("by_status", "status");

  const entities = database.createObjectStore("entities", { keyPath: "id" });
  entities.createIndex("by_dataset", "datasetId");
  entities.createIndex("by_dataset_domain", ["datasetId", "domain"]);
  entities.createIndex("by_dataset_date", ["datasetId", "localDate"]);
  entities.createIndex("by_dataset_domain_date", ["datasetId", "domain", "localDate"]);
  entities.createIndex("by_dataset_type_date", ["datasetId", "type", "localDate"]);
  entities.createIndex("by_updated_at", "updatedAt");

  const revisions = database.createObjectStore("revisions", { keyPath: "id" });
  revisions.createIndex("by_entity_revision", ["entityId", "revision"], {
    unique: true,
  });
  revisions.createIndex("by_dataset_created", ["datasetId", "createdAt"]);

  const operations = database.createObjectStore("operations", { keyPath: "id" });
  operations.createIndex("by_dataset_created", ["datasetId", "createdAt"]);
  operations.createIndex("by_status", "status");

  const settings = database.createObjectStore("settings", { keyPath: "id" });
  settings.createIndex("by_dataset", "datasetId");

  const metrics = database.createObjectStore("metrics_cache", { keyPath: "id" });
  metrics.createIndex("by_dataset", "datasetId");
  metrics.createIndex("by_dataset_metric", ["datasetId", "metricKey"]);

  const imports = database.createObjectStore("imports", { keyPath: "id" });
  imports.createIndex("by_dataset_created", ["datasetId", "createdAt"]);
  imports.createIndex("by_status", "status");

  const importStage = database.createObjectStore("import_stage", { keyPath: "id" });
  importStage.createIndex("by_import", "importId");
  importStage.createIndex("by_import_store", ["importId", "storeName"]);

  const snapshots = database.createObjectStore("migration_snapshots", {
    keyPath: "id",
  });
  snapshots.createIndex("by_dataset_created", ["datasetId", "createdAt"]);

  const vault = database.createObjectStore("vault_meta", { keyPath: "id" });
  vault.createIndex("by_dataset", "datasetId");
}

function createVersionTwoStores(
  database: IDBPDatabase<MentorDatabaseSchema>,
): void {
  const outbox = database.createObjectStore("outbox", { keyPath: "id" });
  outbox.createIndex("by_dataset_state", ["datasetId", "state"]);
  outbox.createIndex("by_operation", "operationId", { unique: true });

  const conflicts = database.createObjectStore("conflicts", { keyPath: "id" });
  conflicts.createIndex("by_dataset_state", ["datasetId", "state"]);
  conflicts.createIndex("by_entity", "entityId");

  database.createObjectStore("sync_meta", { keyPath: "key" });

  const externalCache = database.createObjectStore("external_cache", {
    keyPath: "id",
  });
  externalCache.createIndex("by_dataset", "datasetId");
  externalCache.createIndex("by_provider", "provider");
}

const databaseConnection = createRetryableAsyncSingleton<MentorDatabase>(() =>
  openDB<MentorDatabaseSchema>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        createVersionOneStores(database);
      }
      if (oldVersion < 2) {
        createVersionTwoStores(database);
      }
    },
    blocked() {
      // A previous tab may still have the database open. The app remains
      // usable with its current connection and can retry after that tab closes.
    },
    blocking() {
      const current = databaseConnection.peek();
      current?.then((database) => database.close()).catch(() => undefined);
      if (current) databaseConnection.reset(current);
    },
    terminated() {
      const current = databaseConnection.peek();
      if (current) databaseConnection.reset(current);
    },
  }),
);

export function openMentorDatabase(): Promise<MentorDatabase> {
  return databaseConnection.get();
}

export async function getStorageDurabilityStatus(): Promise<StorageDurabilityStatus> {
  if (typeof navigator === "undefined" || !navigator.storage) {
    return { persisted: null, quotaBytes: null, usageBytes: null };
  }

  const estimatePromise: Promise<StorageEstimate> =
    navigator.storage.estimate?.().catch(() => ({})) ?? Promise.resolve({});
  const [persisted, estimate] = await Promise.all([
    navigator.storage.persisted?.().catch(() => null) ?? Promise.resolve(null),
    estimatePromise,
  ]);

  return {
    persisted,
    quotaBytes: typeof estimate.quota === "number" ? estimate.quota : null,
    usageBytes: typeof estimate.usage === "number" ? estimate.usage : null,
  };
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return null;
  }
  try {
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
