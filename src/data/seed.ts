import {
  APP_TIME_ZONE,
  RETENTION_POLICY,
  known,
  unknown,
  type DatasetRecord,
  type FinanceAccountPayload,
  type ISOInstant,
  type LocalDate,
  type LocalDateTime,
  type MentorEntity,
  type ShiftPayload,
} from "../domain/model";
import { DATABASE_VERSION, openMentorDatabase, type MentorDatabase } from "./database";
import { cleanupImportStagingIfDue } from "./stagingCleanup";
import {
  abortTransactionSafely,
  assertObservedTransactionCompleted,
  observeTransactionCompletion,
} from "./transactionSafety";

export const DEFAULT_DATASET_ID = "bauer-personal-primary";
export const DATA_SEED_VERSION = 2;

export interface InitializationResult {
  dataset: DatasetRecord;
  databaseVersion: number;
  dataSeedVersion: number;
}

let initializationPromise: Promise<InitializationResult> | null = null;

function nowISO(): string {
  return new Date().toISOString();
}

async function normalizeDatasetRecord(
  database: MentorDatabase,
  dataset: DatasetRecord,
): Promise<DatasetRecord> {
  const legacy = dataset as DatasetRecord & {
    dataSchemaVersion?: number;
    nextOperationSequence?: number;
    dataRevision?: number;
    settingsRevision?: number;
  };
  const normalized: DatasetRecord = {
    ...dataset,
    dataSchemaVersion: Number.isInteger(legacy.dataSchemaVersion)
      ? legacy.dataSchemaVersion
      : 1,
    nextOperationSequence: Number.isInteger(legacy.nextOperationSequence)
      ? legacy.nextOperationSequence
      : 0,
    dataRevision: Number.isInteger(legacy.dataRevision) ? legacy.dataRevision : 0,
    settingsRevision: Number.isInteger(legacy.settingsRevision)
      ? legacy.settingsRevision
      : 0,
  };
  if (
    normalized.dataSchemaVersion !== legacy.dataSchemaVersion ||
    normalized.nextOperationSequence !== legacy.nextOperationSequence ||
    normalized.dataRevision !== legacy.dataRevision ||
    normalized.settingsRevision !== legacy.settingsRevision
  ) {
    await database.put("datasets", normalized);
  }
  return normalized;
}

async function ensureActiveDataset(database: MentorDatabase): Promise<DatasetRecord> {
  const activeDatasetMeta = await database.get("app_meta", "active_dataset_id");
  if (typeof activeDatasetMeta?.value === "string") {
    const referencedDataset = await database.get("datasets", activeDatasetMeta.value);
    if (referencedDataset?.status === "active") {
      return normalizeDatasetRecord(database, referencedDataset);
    }
  }

  const activeDatasets = await database.getAllFromIndex("datasets", "by_status", "active");
  if (activeDatasets.length > 0) {
    const existing = activeDatasets[0];
    await database.put("app_meta", {
      key: "active_dataset_id",
      value: existing.id,
      updatedAt: nowISO(),
    });
    return normalizeDatasetRecord(database, existing);
  }

  const timestamp = nowISO();
  const dataset: DatasetRecord = {
    id: DEFAULT_DATASET_ID,
    name: "Mentor Bauer — dados pessoais",
    status: "active",
    ownerIdentity: {
      displayName: "Bauer Vieira",
      studentNumber: 7,
      institution: "UNIFIMES",
    },
    dataSchemaVersion: 1,
    nextOperationSequence: 0,
    dataRevision: 0,
    settingsRevision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const transaction = database.transaction(["datasets", "app_meta"], "readwrite");
  await Promise.all([
    transaction.objectStore("datasets").put(dataset),
    transaction.objectStore("app_meta").put({
      key: "active_dataset_id",
      value: dataset.id,
      updatedAt: timestamp,
    }),
    transaction.done,
  ]);
  return dataset;
}

function makeSeedEntity<TType extends MentorEntity["type"]>(
  entity: MentorEntity<TType>,
): MentorEntity<TType> {
  return entity;
}

type SeedShift = {
  date: LocalDate;
  startTime: "07:00" | "19:00";
  occurredAtUTC: ISOInstant;
  scheduledStartLocal: LocalDateTime;
  scheduledEndLocal: LocalDateTime;
  assignment?: "Enfermaria obstétrica";
};

/**
 * Confirmed personal September schedule from the Master Plan §3.5.  Dates are
 * deliberately explicit: in particular, night shifts retain their next-day
 * end date instead of deriving it from a clock-time comparison.
 */
const SEPTEMBER_2026_SHIFTS = [
  { date: "2026-09-01", startTime: "07:00", occurredAtUTC: "2026-09-01T10:00:00.000Z", scheduledStartLocal: "2026-09-01T07:00:00", scheduledEndLocal: "2026-09-01T19:00:00" },
  { date: "2026-09-03", startTime: "19:00", occurredAtUTC: "2026-09-03T22:00:00.000Z", scheduledStartLocal: "2026-09-03T19:00:00", scheduledEndLocal: "2026-09-04T07:00:00" },
  { date: "2026-09-05", startTime: "19:00", occurredAtUTC: "2026-09-05T22:00:00.000Z", scheduledStartLocal: "2026-09-05T19:00:00", scheduledEndLocal: "2026-09-06T07:00:00" },
  { date: "2026-09-07", startTime: "19:00", occurredAtUTC: "2026-09-07T22:00:00.000Z", scheduledStartLocal: "2026-09-07T19:00:00", scheduledEndLocal: "2026-09-08T07:00:00" },
  { date: "2026-09-10", startTime: "19:00", occurredAtUTC: "2026-09-10T22:00:00.000Z", scheduledStartLocal: "2026-09-10T19:00:00", scheduledEndLocal: "2026-09-11T07:00:00" },
  { date: "2026-09-12", startTime: "19:00", occurredAtUTC: "2026-09-12T22:00:00.000Z", scheduledStartLocal: "2026-09-12T19:00:00", scheduledEndLocal: "2026-09-13T07:00:00" },
  { date: "2026-09-14", startTime: "07:00", occurredAtUTC: "2026-09-14T10:00:00.000Z", scheduledStartLocal: "2026-09-14T07:00:00", scheduledEndLocal: "2026-09-14T13:00:00", assignment: "Enfermaria obstétrica" },
  { date: "2026-09-15", startTime: "07:00", occurredAtUTC: "2026-09-15T10:00:00.000Z", scheduledStartLocal: "2026-09-15T07:00:00", scheduledEndLocal: "2026-09-15T13:00:00", assignment: "Enfermaria obstétrica" },
  { date: "2026-09-16", startTime: "07:00", occurredAtUTC: "2026-09-16T10:00:00.000Z", scheduledStartLocal: "2026-09-16T07:00:00", scheduledEndLocal: "2026-09-16T13:00:00", assignment: "Enfermaria obstétrica" },
  { date: "2026-09-17", startTime: "07:00", occurredAtUTC: "2026-09-17T10:00:00.000Z", scheduledStartLocal: "2026-09-17T07:00:00", scheduledEndLocal: "2026-09-17T13:00:00", assignment: "Enfermaria obstétrica" },
  { date: "2026-09-18", startTime: "07:00", occurredAtUTC: "2026-09-18T10:00:00.000Z", scheduledStartLocal: "2026-09-18T07:00:00", scheduledEndLocal: "2026-09-18T13:00:00", assignment: "Enfermaria obstétrica" },
  { date: "2026-09-19", startTime: "07:00", occurredAtUTC: "2026-09-19T10:00:00.000Z", scheduledStartLocal: "2026-09-19T07:00:00", scheduledEndLocal: "2026-09-19T13:00:00", assignment: "Enfermaria obstétrica" },
  { date: "2026-09-20", startTime: "07:00", occurredAtUTC: "2026-09-20T10:00:00.000Z", scheduledStartLocal: "2026-09-20T07:00:00", scheduledEndLocal: "2026-09-20T13:00:00", assignment: "Enfermaria obstétrica" },
  { date: "2026-09-21", startTime: "07:00", occurredAtUTC: "2026-09-21T10:00:00.000Z", scheduledStartLocal: "2026-09-21T07:00:00", scheduledEndLocal: "2026-09-21T19:00:00" },
  { date: "2026-09-22", startTime: "07:00", occurredAtUTC: "2026-09-22T10:00:00.000Z", scheduledStartLocal: "2026-09-22T07:00:00", scheduledEndLocal: "2026-09-22T19:00:00" },
  { date: "2026-09-23", startTime: "07:00", occurredAtUTC: "2026-09-23T10:00:00.000Z", scheduledStartLocal: "2026-09-23T07:00:00", scheduledEndLocal: "2026-09-23T19:00:00" },
] satisfies readonly SeedShift[];

function seedEntities(datasetId: string, timestamp: string): MentorEntity[] {
  const common = {
    datasetId,
    timezone: APP_TIME_ZONE,
    schemaVersion: 1,
    revision: 1,
    source: "seed" as const,
    status: "active" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const shifts: Array<MentorEntity<"internato.shift">> = SEPTEMBER_2026_SHIFTS.map(
    ({ date, startTime, occurredAtUTC, scheduledStartLocal, scheduledEndLocal, assignment }) =>
      makeSeedEntity({
        ...common,
        id: `seed-shift-${date}-${startTime.replace(":", "")}`,
        domain: "internato",
        type: "internato.shift",
        localDate: date,
        occurredAtUTC,
        payload: {
          scheduleState: "confirmed_planned",
          scheduledStartLocal,
          scheduledEndLocal,
          assignment: assignment
            ? known(assignment, "confirmed_schedule")
            : unknown("not_confirmed"),
          location: unknown("not_confirmed"),
          attendance: unknown("not_recorded"),
          arrivalLocal: unknown("not_recorded"),
          departureLocal: unknown("not_recorded"),
          breakStartLocal: unknown("not_recorded"),
          breakEndLocal: unknown("not_recorded"),
        } satisfies ShiftPayload,
      }),
  );

  const financeProviders: FinanceAccountPayload["providerName"][] = [
    "Mercado Pago",
    "Banco do Brasil",
    "PicPay",
  ];
  const providerIds: Record<FinanceAccountPayload["providerName"], string> = {
    "Mercado Pago": "mercado-pago",
    "Banco do Brasil": "banco-do-brasil",
    PicPay: "picpay",
  };
  const accounts: Array<MentorEntity<"financas.account">> = financeProviders.map(
    (providerName) =>
      makeSeedEntity({
        ...common,
        id: `seed-finance-${providerIds[providerName]}`,
        domain: "financas",
        type: "financas.account",
        localDate: "2026-09-01",
        occurredAtUTC: "2026-09-01T00:00:00.000Z",
        payload: {
          providerName,
          accountKind: unknown("not_confirmed"),
          balance: unknown("not_provided"),
          dueDate: unknown("not_provided"),
          lastFourDigits: unknown("not_provided"),
        } satisfies FinanceAccountPayload,
      }),
  );

  return [...shifts, ...accounts];
}

async function ensureSeedData(database: MentorDatabase, dataset: DatasetRecord): Promise<void> {
  const timestamp = nowISO();
  const entities = seedEntities(dataset.id, timestamp);
  const transaction = database.transaction(
    ["app_meta", "datasets", "entities", "revisions", "operations", "settings"],
    "readwrite",
  );
  const transactionCompletion = observeTransactionCompletion(transaction);
  const entityStore = transaction.objectStore("entities");
  const revisionStore = transaction.objectStore("revisions");
  const operationStore = transaction.objectStore("operations");
  const storedDataset = await transaction.objectStore("datasets").get(dataset.id);
  if (!storedDataset) {
    await abortTransactionSafely(transaction);
    throw new Error("O conjunto de dados ativo não foi encontrado durante a inicialização.");
  }
  let nextOperationSequence = storedDataset.nextOperationSequence;
  let dataRevision = storedDataset.dataRevision;

  for (const entity of entities) {
    const existing = await entityStore.get(entity.id);
    if (existing) {
      continue;
    }
    const operationId = `seed-operation-${entity.id}-v1`;
    nextOperationSequence += 1;
    dataRevision += 1;
    await entityStore.add(entity);
    await revisionStore.add({
      id: `seed-revision-${entity.id}-v1`,
      datasetId: dataset.id,
      entityId: entity.id,
      revision: 1,
      operationId,
      reason: "initial_confirmed_seed",
      snapshot: entity,
      createdAt: timestamp,
    });
    await operationStore.add({
      id: operationId,
      datasetId: dataset.id,
      entityId: entity.id,
      sequence: nextOperationSequence,
      kind: "create",
      status: "committed",
      nextRevision: 1,
      summary: "Confirmed structure added without inferred personal values.",
      createdAt: timestamp,
    });
  }

  if (
    nextOperationSequence !== storedDataset.nextOperationSequence ||
    dataRevision !== storedDataset.dataRevision
  ) {
    await transaction.objectStore("datasets").put({
      ...storedDataset,
      nextOperationSequence,
      dataRevision,
      updatedAt: timestamp,
    });
  }

  // Inicializar preenche ausências; não regrava uma configuração que já existe.
  // Mudanças futuras de política exigem migração própria, não uma abertura do app.
  const settings = transaction.objectStore("settings");
  const retentionId = `${dataset.id}:retention`;
  if (!(await settings.get(retentionId))) {
    await settings.add({ id: retentionId, datasetId: dataset.id, key: "retention", value: RETENTION_POLICY, updatedAt: timestamp });
  }
  const metadata = transaction.objectStore("app_meta");
  for (const [key, value] of [["schema_version", DATABASE_VERSION], ["data_seed_version", DATA_SEED_VERSION]] as const) {
    const existing = await metadata.get(key);
    if (!existing || existing.value !== value) {
      await metadata.put({ ...existing, key, value, updatedAt: timestamp });
    }
  }
  if (!(await metadata.get("retention_policy"))) {
    await metadata.add({ key: "retention_policy", value: RETENTION_POLICY, updatedAt: timestamp });
  }
  await assertObservedTransactionCompleted(transactionCompletion);
}

export function initializeMentorData(): Promise<InitializationResult> {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const database = await openMentorDatabase();
      const dataset = await ensureActiveDataset(database);
      await ensureSeedData(database, dataset);
      // Staging hygiene is important but optional: a transient cleanup failure
      // must never make the canonical app data unavailable at bootstrap.
      await cleanupImportStagingIfDue({ database });
      const initializedDataset = (await database.get("datasets", dataset.id)) ?? dataset;
      return {
        dataset: initializedDataset,
        databaseVersion: DATABASE_VERSION,
        dataSeedVersion: DATA_SEED_VERSION,
      };
    })().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }
  return initializationPromise;
}

export async function getActiveDataset(): Promise<DatasetRecord> {
  const initialized = await initializeMentorData();
  return (await (await openMentorDatabase()).get("datasets", initialized.dataset.id)) ??
    initialized.dataset;
}
