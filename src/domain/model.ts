import type {
  AgendaEventPayload,
  AgendaGoalSetPayload,
  AgendaTaskPayload,
} from "./agenda";
import type {
  FinanceBillPayload,
  FinanceBudgetPayload,
  FinanceCardPayload,
  FinanceDebtPayload,
  FinanceGoalPayload,
  FinanceTransactionPayload,
} from "./finance";

export const APP_TIME_ZONE = "America/Sao_Paulo" as const;

export const RETENTION_POLICY = {
  rawHistoryDays: 365,
  minimumRecoverableDays: 60,
  defaultAnalyticsDays: 60,
  supportedWindows: [7, 30, 60, 180, 365] as const,
} as const;

export type LocalDate = `${number}-${number}-${number}`;
export type LocalTime = `${number}:${number}` | `${number}:${number}:${number}`;
export type LocalDateTime = `${LocalDate}T${string}`;
export type ISOInstant = string;

export type Domain =
  | "internato"
  | "estudos"
  | "medicamentos"
  | "sono"
  | "alimentacao"
  | "humor"
  | "cefaleia"
  | "bruxismo"
  | "financas"
  | "rotina"
  | "agenda"
  | "ia"
  | "conhecimento"
  | "exames";

export type EntitySource = "manual" | "seed" | "imported" | "derived";
export type EntityStatus = "active" | "superseded" | "deleted";

export type UnknownReason =
  | "not_recorded"
  | "not_confirmed"
  | "not_provided"
  | "legacy_ambiguous"
  | "withheld"
  | "conflict";

/**
 * Every field that could be missing uses an explicit knowledge state. This
 * prevents the UI and metrics from treating an unanswered field as zero,
 * absence, non-adherence, or failure.
 */
export type Knowledge<T> =
  | {
      state: "known";
      value: T;
      source: "user" | "confirmed_schedule" | "imported" | "derived";
      recordedAt?: ISOInstant;
    }
  | {
      state: "unknown";
      reason: UnknownReason;
    }
  | {
      state: "confirmed_absent";
      reasonCode?: string;
    }
  | {
      state: "not_applicable";
      reasonCode: string;
    }
  | {
      state: "invalid";
      issueCodes: string[];
    };

export function known<T>(
  value: T,
  source: Extract<Knowledge<T>, { state: "known" }>['source'] = "user",
  recordedAt?: ISOInstant,
): Knowledge<T> {
  return recordedAt
    ? { state: "known", value, source, recordedAt }
    : { state: "known", value, source };
}

export function unknown<T>(reason: UnknownReason = "not_recorded"): Knowledge<T> {
  return { state: "unknown", reason };
}

export function confirmedAbsent<T>(reasonCode?: string): Knowledge<T> {
  return reasonCode
    ? { state: "confirmed_absent", reasonCode }
    : { state: "confirmed_absent" };
}

export function notApplicable<T>(reasonCode: string): Knowledge<T> {
  return { state: "not_applicable", reasonCode };
}

export function invalidKnowledge<T>(...issueCodes: string[]): Knowledge<T> {
  return { state: "invalid", issueCodes };
}

export interface Money {
  amountMinor: number;
  currency: "BRL" | string;
}

export type AttendanceStatus =
  | "present"
  | "absent_confirmed"
  | "cancelled"
  | "swapped"
  | "excused";

export type ShiftScheduleState = "confirmed_planned" | "tentative";

export interface ShiftPayload {
  scheduleState: ShiftScheduleState;
  scheduledStartLocal: LocalDateTime;
  scheduledEndLocal: LocalDateTime;
  assignment: Knowledge<string>;
  location: Knowledge<string>;
  attendance: Knowledge<AttendanceStatus>;
  arrivalLocal: Knowledge<LocalDateTime>;
  departureLocal: Knowledge<LocalDateTime>;
  breakStartLocal: Knowledge<LocalDateTime>;
  breakEndLocal: Knowledge<LocalDateTime>;
}

export interface EnergyCheckInPayload {
  energy: 1 | 2 | 3 | 4 | 5;
  scaleVersion: "energy-1-5-v1";
  note: Knowledge<string>;
}

export type MedicationConfirmationState =
  | "taken_time_recorded"
  | "taken_time_unknown"
  | "taken_on_time"
  | "taken_late"
  | "skipped_confirmed";

export interface MedicationEventPayload {
  /** Canonical regimen linkage. Missing on legacy confirmations. */
  regimenId?: Knowledge<string>;
  medicationName: Knowledge<string>;
  /** Exact label transcribed by the user; never interpreted as a recommendation. */
  doseLabel?: Knowledge<string>;
  scheduledTimeLocal: Knowledge<LocalTime>;
  actualTimeLocal: Knowledge<LocalTime>;
  confirmation: MedicationConfirmationState;
  note: Knowledge<string>;
}

export interface FinanceAccountPayload {
  providerName: "Mercado Pago" | "Banco do Brasil" | "PicPay";
  accountKind: Knowledge<"checking" | "wallet" | "credit" | "other">;
  balance: Knowledge<Money>;
  dueDate: Knowledge<LocalDate>;
  lastFourDigits: Knowledge<string>;
}

export interface DailyClosurePayload {
  summary: Knowledge<string>;
  completedAtLocal: LocalDateTime;
}

export interface GenericPayload {
  [key: string]: unknown;
}

export interface EntityPayloadByType {
  "internato.shift": ShiftPayload;
  "humor.energy-check-in": EnergyCheckInPayload;
  "medicamentos.confirmation": MedicationEventPayload;
  "financas.account": FinanceAccountPayload;
  "financas.transaction": FinanceTransactionPayload;
  "financas.bill": FinanceBillPayload;
  "financas.debt": FinanceDebtPayload;
  "financas.budget": FinanceBudgetPayload;
  "financas.goal": FinanceGoalPayload;
  "financas.card": FinanceCardPayload;
  "agenda.task": AgendaTaskPayload;
  "agenda.event": AgendaEventPayload;
  "agenda.goal-set": AgendaGoalSetPayload;
  "rotina.daily-closure": DailyClosurePayload;
  "generic.event": GenericPayload;
}

export type EntityType = keyof EntityPayloadByType;

export interface MentorEntity<TType extends EntityType = EntityType> {
  id: string;
  datasetId: string;
  domain: Domain;
  type: TType;
  localDate: LocalDate;
  occurredAtUTC: ISOInstant;
  timezone: string;
  schemaVersion: number;
  revision: number;
  source: EntitySource;
  status: EntityStatus;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
  payload: EntityPayloadByType[TType];
}

export interface DatasetRecord {
  id: string;
  name: string;
  status: "active" | "archived";
  ownerIdentity: {
    displayName: "Bauer Vieira";
    studentNumber: 7;
    institution: "UNIFIMES";
  };
  dataSchemaVersion: number;
  nextOperationSequence: number;
  dataRevision: number;
  settingsRevision: number;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}

export interface AppMetaRecord<T = unknown> {
  key: string;
  value: T;
  updatedAt: ISOInstant;
}

export interface RevisionRecord {
  id: string;
  datasetId: string;
  entityId: string;
  revision: number;
  operationId: string;
  reason: string;
  snapshot: MentorEntity;
  createdAt: ISOInstant;
  importId?: string;
  sourceDatasetId?: string;
  sourceRevision?: number;
}

export interface OperationRecord {
  id: string;
  datasetId: string;
  entityId?: string;
  sequence: number;
  kind: "create" | "update" | "delete" | "restore" | "import" | "settings";
  status: "committed" | "pending" | "failed";
  baseRevision?: number;
  nextRevision?: number;
  summary: string;
  createdAt: ISOInstant;
  importId?: string;
  sourceDatasetId?: string;
  sourceRevision?: number;
}

export interface SettingRecord<T = unknown> {
  id: string;
  datasetId: string;
  key: string;
  value: T;
  updatedAt: ISOInstant;
}

export interface MetricCacheRecord<T = unknown> {
  id: string;
  datasetId: string;
  metricKey: string;
  windowStart: LocalDate;
  windowEnd: LocalDate;
  generatedAt: ISOInstant;
  sourceRevision: number;
  value: T;
}

export interface ImportRecord {
  id: string;
  datasetId: string;
  sourceDatasetId?: string;
  sourceExportedAt?: ISOInstant;
  format: "bauerlife" | "legacy-obstetricia" | "legacy-cefaleia";
  status: "staged" | "validated" | "applied" | "rejected" | "rolled_back";
  sourceName: string;
  payloadChecksum: string;
  storeCounts: Record<string, number>;
  createdAt: ISOInstant;
  validatedAt?: ISOInstant;
  appliedAt?: ISOInstant;
  baseDataRevision?: number;
  baseSettingsRevision?: number;
  stagedChecksumSHA256?: string;
  planDigest?: string;
  planCounts?: Record<string, number>;
  appliedCounts?: Record<string, number>;
  applyMode?: "safe-only" | "abort-on-conflict";
}

export interface ImportStageRecord {
  id: string;
  importId: string;
  datasetId: string;
  storeName: string;
  sourceKey: string;
  value: unknown;
}

export interface MigrationSnapshotRecord {
  id: string;
  datasetId: string;
  importId?: string;
  label: string;
  entityCount: number;
  checksum: string;
  createdAt: ISOInstant;
}

export interface VaultMetaRecord {
  id: string;
  datasetId: string;
  scope: "health" | "mental-health" | "finance" | "general";
  keyVersion: number;
  algorithm: "AES-GCM";
  updatedAt: ISOInstant;
}

export interface OutboxRecord {
  id: string;
  datasetId: string;
  operationId: string;
  entityId?: string;
  state: "pending" | "synced" | "failed";
  createdAt: ISOInstant;
}

export interface ConflictRecord {
  id: string;
  datasetId: string;
  entityId: string;
  localRevision: number;
  remoteRevision: number;
  state: "open" | "resolved";
  createdAt: ISOInstant;
  importId?: string;
  subjectKind?: "entity" | "setting";
  settingKey?: string;
  reason?: string;
  localSnapshot?: unknown;
  incomingSnapshot?: unknown;
}

export interface SyncMetaRecord {
  key: string;
  value: unknown;
  updatedAt: ISOInstant;
}

export interface ExternalCacheRecord {
  id: string;
  datasetId: string;
  provider: "google-calendar" | "outlook-calendar" | "todo" | string;
  expiresAt: ISOInstant;
  value: unknown;
}

export interface InclusiveDateWindow {
  start: LocalDate;
  end: LocalDate;
  days: number;
}

export interface EnergyMetricSummary {
  window: InclusiveDateWindow;
  observationCount: number;
  missingDays: number;
  average: number | null;
  state: "insufficient" | "emerging" | "preferred";
  values: Array<{ localDate: LocalDate; value: 1 | 2 | 3 | 4 | 5 }>;
}

export interface StorageDurabilityStatus {
  persisted: boolean | null;
  quotaBytes: number | null;
  usageBytes: number | null;
}

export interface TodaySnapshot {
  localDate: LocalDate;
  dataset: DatasetRecord;
  currentShift: MentorEntity<"internato.shift"> | null;
  nextShift: MentorEntity<"internato.shift"> | null;
  latestEnergy: MentorEntity<"humor.energy-check-in"> | null;
  medicationEvents: Array<MentorEntity<"medicamentos.confirmation">>;
  financeAccounts: Array<MentorEntity<"financas.account">>;
  energyMetric60Days: EnergyMetricSummary;
  retention: typeof RETENTION_POLICY;
  storage: StorageDurabilityStatus;
  lastBackupCreatedAt: ISOInstant | null;
}

/**
 * Canonical data made available to the application shell. `historyWindow`
 * describes the guaranteed raw-history window; future planned entities are
 * also included in `entities` so Agenda does not lose upcoming shifts.
 */
export interface MentorWorkspace {
  referenceLocalDate: LocalDate;
  historyWindow: InclusiveDateWindow;
  dataset: DatasetRecord;
  entities: MentorEntity[];
  deletedEntities: MentorEntity[];
  settings: SettingRecord[];
  retention: typeof RETENTION_POLICY;
  storage: StorageDurabilityStatus;
}

export interface MentorDataRefreshResult {
  snapshot: TodaySnapshot;
  workspace: MentorWorkspace;
}

export interface StoragePersistenceResult {
  requestResult: boolean | null;
  storage: StorageDurabilityStatus;
}

export interface EntityQuery {
  datasetId?: string;
  domain?: Domain;
  type?: EntityType;
  startLocalDate?: LocalDate;
  endLocalDate?: LocalDate;
  includeDeleted?: boolean;
}

export interface RecordEnergyInput {
  value: 1 | 2 | 3 | 4 | 5;
  localDate?: LocalDate;
  occurredAtUTC?: ISOInstant;
  note?: string;
}

export interface ConfirmMedicationInput {
  localDate?: LocalDate;
  regimenId?: string;
  scheduledTimeLocal?: LocalTime;
  actualTimeLocal?: LocalTime;
  medicationName?: string;
  doseLabel?: string;
  confirmation: MedicationConfirmationState;
  note?: string;
  occurredAtUTC?: ISOInstant;
}

export interface RecordGenericEventInput<
  TPayload extends GenericPayload = GenericPayload,
> {
  domain: Domain;
  payload: TPayload;
  summary: string;
  localDate?: LocalDate;
  occurredAtUTC?: ISOInstant;
}

export interface RecordShiftTimeInput {
  shiftId: string;
  localDateTime: LocalDateTime;
  occurredAtUTC?: ISOInstant;
}

/**
 * Creates a planned Internato shift without inventing any actual outcome.
 * Optional text omitted by the user is persisted as explicit unknown data.
 */
export interface CreateManualShiftInput {
  localDate: LocalDate;
  startTimeLocal: LocalTime;
  endTimeLocal: LocalTime;
  endsNextDay: boolean;
  scheduleState: ShiftScheduleState;
  assignment?: string;
  location?: string;
  occurredAtUTC?: ISOInstant;
}

export type ShiftTimeField =
  | "arrivalLocal"
  | "departureLocal"
  | "breakStartLocal"
  | "breakEndLocal";

/**
 * A clock-only value is resolved against the scheduled span of the shift.
 * This is the preferred input for overnight shifts because `06:45` can then
 * be placed on the correct civil date. A Knowledge value is required when a
 * caller intentionally changes a field back to unknown/absent/invalid.
 */
export type ShiftTimeUpdateValue =
  | LocalTime
  | LocalDateTime
  | Knowledge<LocalDateTime>;

export interface UpdateShiftInput {
  shiftId: string;
  arrivalLocal?: ShiftTimeUpdateValue;
  departureLocal?: ShiftTimeUpdateValue;
  breakStartLocal?: ShiftTimeUpdateValue;
  breakEndLocal?: ShiftTimeUpdateValue;
  attendance?: AttendanceStatus | Knowledge<AttendanceStatus>;
  occurredAtUTC?: ISOInstant;
}

export interface EntityStatusMutationInput {
  entityId: string;
  expectedRevision?: number;
  occurredAtUTC?: ISOInstant;
}
