import {
  assertLocalDate,
  assertLocalDateTime,
  type Domain,
  type DatasetRecord,
  type EntityType,
  type ImportStageRecord,
  type LocalDate,
  type MentorEntity,
  type OperationRecord,
  type RevisionRecord,
  type SettingRecord,
} from "../domain";
import { DATABASE_NAME, DATABASE_VERSION, openMentorDatabase } from "./database";
import { LABORATORY_SCHEMA, isLaboratoryPanelEntity, isLaboratoryPanelPayload, verifyLaboratoryAttachments } from "../domain/laboratory";
import { isPersonalReferencePayload } from "../domain/clinicalReference";
import { ANNUAL_DATE_SCHEMA, isAnnualDatePayload } from "../domain/annualDates";
import { canonicalRetentionRow, RETENTION_STORES } from "../domain/protectedRetention";
import { assertMedicationSlotsAvailable, MedicationSlotConflictError } from "../domain/medicationUniqueness";
import { assertMedicationSlotInTransaction } from "./medicationUniqueness";
import { canonicalFinanceAccountProvider } from "./financeAccounts";
import { isSupportedBackupSettingValue } from "./preferenceBackup";
import { getActiveDataset, initializeMentorData } from "./seed";
import {
  abortTransactionSafely,
  assertObservedTransactionCompleted,
  observeTransactionCompletion,
} from "./transactionSafety";

const BACKUP_FORMAT = "bauerlife" as const;
const BACKUP_FORMAT_VERSION = 1;
const PBKDF2_ITERATIONS = 250_000;
const MAX_PENDING_DELIVERY_RECEIPTS_PER_DATASET = 8;
const pendingDeliveryReceipts = new Map<string, BackupDeliveryReceipt>();
const EXPORTED_APP_META_KEYS = new Set([
  "schema_version",
  "data_seed_version",
  "retention_policy",
]);
const BACKUP_STORE_NAMES = [
  "app_meta",
  "datasets",
  "entities",
  "revisions",
  "operations",
  "settings",
  "metrics_cache",
  "migration_snapshots",
  "vault_meta",
  "outbox",
  "conflicts",
  "sync_meta",
  "external_cache",
] as const;

export type BackupStoreName = (typeof BACKUP_STORE_NAMES)[number];
type BackupStores = Record<BackupStoreName, unknown[]>;

interface BackupContent {
  manifest: {
    databaseName: typeof DATABASE_NAME;
    databaseVersion: number;
    formatVersion: number;
    datasetId: string;
    exportedAt: string;
    retentionDays: 365;
    storeCounts: Record<BackupStoreName, number>;
  };
  stores: BackupStores;
}

interface BackupPlaintext extends BackupContent {
  checksumSHA256: string;
}

interface EncryptedBackupEnvelope {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  encryptedAt: string;
  encryption: {
    algorithm: "AES-GCM";
    keyDerivation: "PBKDF2-SHA-256";
    iterations: number;
    saltBase64: string;
    ivBase64: string;
  };
  ciphertextBase64: string;
}

export interface EncryptedBackupResult {
  blob: Blob;
  fileName: string;
  exportedAt: string;
  checksumSHA256: string;
  storeCounts: Record<BackupStoreName, number>;
  /** Pass this to `confirmEncryptedBackupDelivery` only after share/download succeeds. */
  deliveryReceipt: BackupDeliveryReceipt;
}

export interface BackupDeliveryReceipt {
  datasetId: string;
  exportedAt: string;
  checksumSHA256: string;
}

export interface BackupDeliveryConfirmation {
  status: "recorded" | "older-than-current";
  deliveredAt: string;
  checksumSHA256: string;
}

export function rememberPendingDeliveryReceipt(
  receipts: Map<string, BackupDeliveryReceipt>,
  receipt: BackupDeliveryReceipt,
  maxPerDataset = MAX_PENDING_DELIVERY_RECEIPTS_PER_DATASET,
): void {
  if (!Number.isInteger(maxPerDataset) || maxPerDataset < 1) {
    throw new Error("O limite de comprovantes pendentes precisa ser um inteiro positivo.");
  }
  receipts.set(receipt.checksumSHA256, receipt);
  const sameDataset = Array.from(receipts.values())
    .filter((candidate) => candidate.datasetId === receipt.datasetId)
    .sort(
      (left, right) =>
        right.exportedAt.localeCompare(left.exportedAt) ||
        right.checksumSHA256.localeCompare(left.checksumSHA256),
    );
  for (const stale of sameDataset.slice(maxPerDataset)) {
    receipts.delete(stale.checksumSHA256);
  }
}

export interface ValidatedBackup {
  exportedAt: string;
  datasetId: string;
  checksumSHA256: string;
  storeCounts: Record<string, number>;
  databaseVersion: number;
}

export interface StagedImportResult extends ValidatedBackup {
  importId: string;
  stagedRecordCount: number;
  preview: BackupImportPreview;
}

export interface BackupImportConflictPreview {
  subjectKind: "entity" | "setting";
  key: string;
  reason:
    | "different_existing_record"
    | "invalid_staged_record"
    | "protected_setting";
  localRevision?: number;
  incomingRevision?: number;
}

export interface BackupImportPreview {
  importId: string;
  sourceDatasetId: string;
  targetDatasetId: string;
  baseDataRevision: number;
  baseSettingsRevision: number;
  planDigest: string;
  stagedChecksumSHA256: string;
  entityCreateIds: string[];
  /** Existing revision-1 seed records that the validated backup can safely recover. */
  entitySeedRestoreIds: string[];
  entityIdenticalIds: string[];
  settingAddKeys: string[];
  settingIdenticalKeys: string[];
  conflicts: BackupImportConflictPreview[];
  /** Compatible audit rows that will accompany the safe entity facts. */
  auditRevisionImportCount: number;
  auditOperationImportCount: number;
  /** Internal rows that were validated but will not become active facts/history. */
  ignoredStoreCounts: Partial<Record<BackupStoreName, number>>;
}

export interface ApplyStagedImportOptions {
  expectedPlanDigest: string;
  mode?: "safe-only" | "abort-on-conflict";
}

export interface AppliedBackupMergeResult {
  importId: string;
  status: "applied" | "applied_with_conflicts" | "nothing_to_apply";
  mode: "safe-only" | "abort-on-conflict";
  appliedAt: string;
  targetDatasetId: string;
  createdEntityIds: string[];
  restoredSeedEntityIds: string[];
  addedSettingKeys: string[];
  skippedIdenticalEntityIds: string[];
  skippedIdenticalSettingKeys: string[];
  conflicts: BackupImportConflictPreview[];
  importedRevisionCount: number;
  importedOperationCount: number;
}

export interface DiscardStagedImportResult {
  importId: string;
  status: "discarded" | "already-finalized";
  removedRecordCount: number;
}

function requireWebCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Este navegador não oferece a criptografia necessária para o backup.");
  }
  return globalThis.crypto;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  return result;
}

async function sha256(value: string): Promise<string> {
  const crypto = requireWebCrypto();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const CURRENT_ENTITY_SCHEMA_VERSION = 1;
const SUPPORTED_DOMAINS = new Set<Domain>([
  "internato",
  "estudos",
  "medicamentos",
  "sono",
  "alimentacao",
  "humor",
  "cefaleia",
  "bruxismo",
  "financas",
  "rotina",
  "agenda",
  "ia",
  "conhecimento",
  "exames",
]);
const ENTITY_DOMAIN_BY_TYPE: Partial<Record<EntityType, Domain>> = {
  "internato.shift": "internato",
  "humor.energy-check-in": "humor",
  "medicamentos.confirmation": "medicamentos",
  "financas.account": "financas",
  "financas.transaction": "financas",
  "financas.bill": "financas",
  "financas.debt": "financas",
  "financas.budget": "financas",
  "financas.goal": "financas",
  "financas.card": "financas",
  "agenda.task": "agenda",
  "agenda.event": "agenda",
  "agenda.goal-set": "agenda",
  "rotina.daily-closure": "rotina",
};
const SUPPORTED_ENTITY_TYPES = new Set<EntityType>([
  ...Object.keys(ENTITY_DOMAIN_BY_TYPE) as EntityType[],
  "generic.event",
]);

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isISOInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isLocalDateValue(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false;
  try {
    assertLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

function isLocalDateTimeValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    assertLocalDateTime(value);
    return true;
  } catch {
    return false;
  }
}

function isLocalTimeValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  return Boolean(
    match &&
      Number(match[1]) <= 23 &&
      Number(match[2]) <= 59 &&
      Number(match[3] ?? 0) <= 59,
  );
}

function isKnowledge(
  value: unknown,
  validateKnown: (knownValue: unknown) => boolean,
): boolean {
  if (!isRecord(value) || typeof value.state !== "string") return false;
  switch (value.state) {
    case "known":
      return (
        hasOnlyKeys(value, ["state", "value", "source", "recordedAt"]) &&
        validateKnown(value.value) &&
        isOneOf(value.source, ["user", "confirmed_schedule", "imported", "derived"]) &&
        (value.recordedAt === undefined || isISOInstant(value.recordedAt))
      );
    case "unknown":
      return (
        hasOnlyKeys(value, ["state", "reason"]) &&
        isOneOf(value.reason, [
          "not_recorded",
          "not_confirmed",
          "not_provided",
          "legacy_ambiguous",
          "withheld",
          "conflict",
        ])
      );
    case "confirmed_absent":
      return (
        hasOnlyKeys(value, ["state", "reasonCode"]) &&
        (value.reasonCode === undefined || typeof value.reasonCode === "string")
      );
    case "not_applicable":
      return (
        hasOnlyKeys(value, ["state", "reasonCode"]) &&
        typeof value.reasonCode === "string" &&
        value.reasonCode.length > 0
      );
    case "invalid":
      return (
        hasOnlyKeys(value, ["state", "issueCodes"]) &&
        Array.isArray(value.issueCodes) &&
        value.issueCodes.length > 0 &&
        isDenseArray(value.issueCodes) &&
        value.issueCodes.every((issue) => typeof issue === "string" && issue.length > 0)
      );
    default:
      return false;
  }
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isDenseArray(value: readonly unknown[]): boolean {
  try {
    if (Object.keys(value).length !== value.length) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function knownKnowledgeValue(value: unknown): unknown {
  return isRecord(value) && value.state === "known" ? value.value : undefined;
}

function isBRLMoney(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["amountMinor", "currency"]) &&
    value.currency === "BRL" &&
    isNonNegativeInteger(value.amountMinor)
  );
}

function isBRLAccountBalance(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["amountMinor", "currency"]) &&
    value.currency === "BRL" &&
    Number.isSafeInteger(value.amountMinor)
  );
}

function isLastFourDigits(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}$/.test(value);
}

function isFinanceProvider(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["kind", "name"]) ||
    typeof value.name !== "string"
  ) return false;
  if (value.kind === "listed") {
    return ["Mercado Pago", "Banco do Brasil", "PicPay"].includes(value.name);
  }
  return (
    value.kind === "other" &&
    value.name === value.name.trim() &&
    value.name.trim().length > 0 &&
    !["Mercado Pago", "Banco do Brasil", "PicPay"].includes(value.name.trim())
  );
}

function hasAgendaTemporalTruth(payload: Record<string, unknown>): boolean {
  return (
    isKnowledge(payload.plannedStartLocal, isLocalDateTimeValue) &&
    isKnowledge(payload.plannedEndLocal, isLocalDateTimeValue) &&
    isKnowledge(payload.actualStartLocal, isLocalDateTimeValue) &&
    isKnowledge(payload.actualEndLocal, isLocalDateTimeValue) &&
    isKnowledge(payload.dueLocalDate, isLocalDateValue) &&
    isKnowledge(payload.dueLocalTime, isLocalTimeValue) &&
    isKnowledge(payload.bufferBeforeMinutes, isNonNegativeInteger) &&
    isKnowledge(payload.bufferAfterMinutes, isNonNegativeInteger)
  );
}

/** @internal Exported for schema-regression tests; it performs no database access. */
export function isBackupEntityPayloadCandidate(
  type: EntityType,
  payload: unknown,
): boolean {
  if (!isRecord(payload)) return false;
  switch (type) {
    case "internato.shift":
      return (
        isOneOf(payload.scheduleState, ["confirmed_planned", "tentative"]) &&
        isLocalDateTimeValue(payload.scheduledStartLocal) &&
        isLocalDateTimeValue(payload.scheduledEndLocal) &&
        isKnowledge(payload.assignment, isString) &&
        isKnowledge(payload.location, isString) &&
        isKnowledge(payload.attendance, (value) =>
          isOneOf(value, ["present", "absent_confirmed", "cancelled", "swapped", "excused"]),
        ) &&
        isKnowledge(payload.arrivalLocal, isLocalDateTimeValue) &&
        isKnowledge(payload.departureLocal, isLocalDateTimeValue) &&
        isKnowledge(payload.breakStartLocal, isLocalDateTimeValue) &&
        isKnowledge(payload.breakEndLocal, isLocalDateTimeValue)
      );
    case "humor.energy-check-in":
      return (
        Number.isInteger(payload.energy) &&
        Number(payload.energy) >= 1 &&
        Number(payload.energy) <= 5 &&
        payload.scaleVersion === "energy-1-5-v1" &&
        isKnowledge(payload.note, isString)
      );
    case "medicamentos.confirmation":
      return (
        (payload.regimenId === undefined || isKnowledge(payload.regimenId, isString)) &&
        isKnowledge(payload.medicationName, isString) &&
        (payload.doseLabel === undefined || isKnowledge(payload.doseLabel, isString)) &&
        isKnowledge(payload.scheduledTimeLocal, isLocalTimeValue) &&
        isKnowledge(payload.actualTimeLocal, isLocalTimeValue) &&
        isOneOf(payload.confirmation, [
          "taken_time_recorded",
          "taken_time_unknown",
          "taken_on_time",
          "taken_late",
          "skipped_confirmed",
        ]) &&
        isKnowledge(payload.note, isString)
      );
    case "financas.account":
      return (
        hasOnlyKeys(payload, [
          "providerName",
          "accountKind",
          "balance",
          "dueDate",
          "lastFourDigits",
        ]) &&
        isOneOf(payload.providerName, ["Mercado Pago", "Banco do Brasil", "PicPay"]) &&
        isKnowledge(payload.accountKind, (value) =>
          isOneOf(value, ["checking", "wallet", "credit", "other"]),
        ) &&
        isKnowledge(payload.balance, isBRLAccountBalance) &&
        isKnowledge(payload.dueDate, isLocalDateValue) &&
        isKnowledge(payload.lastFourDigits, isLastFourDigits)
      );
    case "financas.transaction":
      return (
        hasOnlyKeys(payload, [
          "provider",
          "direction",
          "amount",
          "transactionDate",
          "settledDate",
          "status",
          "category",
          "description",
        ]) &&
        isFinanceProvider(payload.provider) &&
        isOneOf(payload.direction, ["income", "expense"]) &&
        isBRLMoney(payload.amount) &&
        isLocalDateValue(payload.transactionDate) &&
        isKnowledge(payload.settledDate, isLocalDateValue) &&
        isOneOf(payload.status, ["pending", "posted", "voided"]) &&
        isKnowledge(payload.category, isString) &&
        isKnowledge(payload.description, isString)
      );
    case "financas.bill":
      return (
        hasOnlyKeys(payload, [
          "provider",
          "label",
          "amount",
          "dueDate",
          "paidDate",
          "interestCharged",
          "status",
          "note",
        ]) &&
        isFinanceProvider(payload.provider) &&
        isNonEmptyString(payload.label) &&
        isKnowledge(payload.amount, isBRLMoney) &&
        isKnowledge(payload.dueDate, isLocalDateValue) &&
        isKnowledge(payload.paidDate, isLocalDateValue) &&
        isKnowledge(payload.interestCharged, isBRLMoney) &&
        isOneOf(payload.status, ["scheduled", "due", "paid", "overdue", "cancelled"]) &&
        isKnowledge(payload.note, isString)
      );
    case "financas.debt":
      return (
        hasOnlyKeys(payload, [
          "provider",
          "label",
          "originalPrincipal",
          "outstandingBalance",
          "annualPercentageRateBps",
          "interestCharged",
          "balanceAsOfLocalDate",
          "dueDate",
          "status",
          "note",
        ]) &&
        isFinanceProvider(payload.provider) &&
        isNonEmptyString(payload.label) &&
        isKnowledge(payload.originalPrincipal, isBRLMoney) &&
        isKnowledge(payload.outstandingBalance, isBRLMoney) &&
        isKnowledge(payload.annualPercentageRateBps, isNonNegativeInteger) &&
        isKnowledge(payload.interestCharged, isBRLMoney) &&
        isKnowledge(payload.balanceAsOfLocalDate, isLocalDateValue) &&
        isKnowledge(payload.dueDate, isLocalDateValue) &&
        isOneOf(payload.status, ["active", "paid", "paused", "defaulted", "disputed"]) &&
        isKnowledge(payload.note, isString)
      );
    case "financas.budget":
      if (
        !hasOnlyKeys(payload, [
          "provider",
          "label",
          "limit",
          "spentAmount",
          "periodStartLocalDate",
          "periodEndLocalDate",
          "status",
          "note",
        ]) ||
        !isFinanceProvider(payload.provider) ||
        !isNonEmptyString(payload.label) ||
        !isBRLMoney(payload.limit) ||
        !isKnowledge(payload.spentAmount, isBRLMoney) ||
        !isLocalDateValue(payload.periodStartLocalDate) ||
        !isLocalDateValue(payload.periodEndLocalDate) ||
        !isOneOf(payload.status, ["active", "paused", "closed"]) ||
        !isKnowledge(payload.note, isString)
      ) return false;
      return payload.periodEndLocalDate >= payload.periodStartLocalDate;
    case "financas.goal":
      return (
        hasOnlyKeys(payload, [
          "provider",
          "label",
          "targetAmount",
          "accumulatedAmount",
          "targetDate",
          "status",
          "note",
        ]) &&
        isFinanceProvider(payload.provider) &&
        isNonEmptyString(payload.label) &&
        isBRLMoney(payload.targetAmount) &&
        isKnowledge(payload.accumulatedAmount, isBRLMoney) &&
        isKnowledge(payload.targetDate, isLocalDateValue) &&
        isOneOf(payload.status, ["active", "achieved", "paused", "cancelled"]) &&
        isKnowledge(payload.note, isString)
      );
    case "financas.card": {
      if (
        !hasOnlyKeys(payload, [
          "provider",
          "label",
          "closingDate",
          "dueDate",
          "statedCreditLimit",
          "currentBalance",
          "currentStatementAmount",
          "minimumPayment",
          "annualPercentageRateBps",
          "balanceAsOfLocalDate",
          "installments",
          "status",
          "note",
        ]) ||
        !isFinanceProvider(payload.provider) ||
        !isNonEmptyString(payload.label) ||
        !isKnowledge(payload.closingDate, isLocalDateValue) ||
        !isKnowledge(payload.dueDate, isLocalDateValue) ||
        !isKnowledge(payload.statedCreditLimit, isBRLMoney) ||
        !isKnowledge(payload.currentBalance, isBRLMoney) ||
        !isKnowledge(payload.currentStatementAmount, isBRLMoney) ||
        !isKnowledge(payload.minimumPayment, isBRLMoney) ||
        !isKnowledge(payload.annualPercentageRateBps, isNonNegativeInteger) ||
        !isKnowledge(payload.balanceAsOfLocalDate, isLocalDateValue) ||
        !Array.isArray(payload.installments) ||
        payload.installments.length > 120 ||
        !isDenseArray(payload.installments) ||
        !isOneOf(payload.status, ["active", "paused", "closed"]) ||
        !isKnowledge(payload.note, isString)
      ) return false;

      const installmentIds = new Set<string>();
      for (const installment of payload.installments) {
        if (
          !isRecord(installment) ||
          !hasOnlyKeys(installment, [
            "id",
            "label",
            "purchaseTotal",
            "installmentAmount",
            "totalInstallments",
            "remainingInstallments",
            "nextDueDate",
            "finalDueDate",
          ]) ||
          !isNonEmptyString(installment.id) ||
          !isNonEmptyString(installment.label) ||
          !isKnowledge(installment.purchaseTotal, isBRLMoney) ||
          !isKnowledge(installment.installmentAmount, isBRLMoney) ||
          !isKnowledge(installment.totalInstallments, isNonNegativeInteger) ||
          !isKnowledge(installment.remainingInstallments, isNonNegativeInteger) ||
          !isKnowledge(installment.nextDueDate, isLocalDateValue) ||
          !isKnowledge(installment.finalDueDate, isLocalDateValue) ||
          installmentIds.has(installment.id)
        ) return false;
        installmentIds.add(installment.id);

        const total = knownKnowledgeValue(installment.totalInstallments);
        const remaining = knownKnowledgeValue(installment.remainingInstallments);
        if (
          (typeof total === "number" && total < 1) ||
          (typeof total === "number" && typeof remaining === "number" && remaining > total)
        ) return false;

        const nextDueDate = knownKnowledgeValue(installment.nextDueDate);
        const finalDueDate = knownKnowledgeValue(installment.finalDueDate);
        if (
          typeof nextDueDate === "string" &&
          typeof finalDueDate === "string" &&
          finalDueDate < nextDueDate
        ) return false;
      }

      const closingDate = knownKnowledgeValue(payload.closingDate);
      const dueDate = knownKnowledgeValue(payload.dueDate);
      return !(
        typeof closingDate === "string" &&
        typeof dueDate === "string" &&
        dueDate < closingDate
      );
    }
    case "agenda.task":
      return (
        hasAgendaTemporalTruth(payload) &&
        isNonEmptyString(payload.title) &&
        isOneOf(payload.status, ["captured", "planned", "in_progress", "completed", "deferred", "cancelled"]) &&
        isOneOf(payload.priority, ["low", "normal", "high", "urgent"]) &&
        isKnowledge(payload.goalTier, (value) => isOneOf(value, ["minimum", "good", "gold"])) &&
        isKnowledge(payload.note, isString)
      );
    case "agenda.event":
      return (
        hasAgendaTemporalTruth(payload) &&
        isNonEmptyString(payload.title) &&
        isOneOf(payload.status, ["tentative", "confirmed", "in_progress", "completed", "cancelled"]) &&
        isOneOf(payload.priority, ["low", "normal", "high", "urgent"]) &&
        isKnowledge(payload.note, isString)
      );
    case "agenda.goal-set":
      return (
        isLocalDateValue(payload.appliesToLocalDate) &&
        isString(payload.minimum) &&
        isString(payload.good) &&
        isString(payload.gold) &&
        isKnowledge(payload.note, isString)
      );
    case "rotina.daily-closure":
      return (
        isKnowledge(payload.summary, isString) &&
        isLocalDateTimeValue(payload.completedAtLocal)
      );
    case "generic.event":
      return payload.schema === LABORATORY_SCHEMA || payload.eventKind === "laboratory-panel"
        ? isLaboratoryPanelPayload(payload)
        : payload.schema === "clinical-reference-personal-v1" || payload.eventKind === "clinical-reference-personal"
        ? isPersonalReferencePayload(payload)
        : payload.schema === ANNUAL_DATE_SCHEMA || payload.eventKind === "agenda-annual-date"
        ? isAnnualDatePayload(payload)
        : true;
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stagedRecordsMaterial(records: readonly ImportStageRecord[]): string {
  return stableSerialize(
    [...records]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, importId, datasetId, storeName, sourceKey, value }) => ({
        id,
        importId,
        datasetId,
        storeName,
        sourceKey,
        value,
      })),
  );
}

function belongsToDataset(value: unknown, datasetId: string): boolean {
  return isRecord(value) && value.datasetId === datasetId;
}

async function deriveBackupKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const crypto = requireWebCrypto();
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

async function readBackupStores(datasetId: string): Promise<BackupStores> {
  const database = await openMentorDatabase();
  const transaction = database.transaction([...BACKUP_STORE_NAMES], "readonly");
  const transactionCompletion = observeTransactionCompletion(transaction);
  const [
    appMeta,
    datasets,
    entities,
    revisions,
    operations,
    settings,
    metricsCache,
    migrationSnapshots,
    vaultMeta,
    outbox,
    conflicts,
    syncMeta,
    externalCache,
  ] = await Promise.all([
    transaction.objectStore("app_meta").getAll(),
    transaction.objectStore("datasets").getAll(),
    transaction.objectStore("entities").getAll(),
    transaction.objectStore("revisions").getAll(),
    transaction.objectStore("operations").getAll(),
    transaction.objectStore("settings").getAll(),
    transaction.objectStore("metrics_cache").getAll(),
    transaction.objectStore("migration_snapshots").getAll(),
    transaction.objectStore("vault_meta").getAll(),
    transaction.objectStore("outbox").getAll(),
    transaction.objectStore("conflicts").getAll(),
    transaction.objectStore("sync_meta").getAll(),
    transaction.objectStore("external_cache").getAll(),
  ]);
  await assertObservedTransactionCompleted(transactionCompletion);

  return {
    app_meta: appMeta.filter((record) => EXPORTED_APP_META_KEYS.has(record.key)),
    datasets: datasets.filter((record) => record.id === datasetId),
    entities: entities.filter((record) => record.datasetId === datasetId),
    revisions: revisions.filter((record) => record.datasetId === datasetId),
    operations: operations.filter((record) => record.datasetId === datasetId),
    settings: settings.filter((record) => record.datasetId === datasetId),
    metrics_cache: metricsCache.filter((record) => record.datasetId === datasetId),
    migration_snapshots: migrationSnapshots.filter(
      (record) => record.datasetId === datasetId,
    ),
    vault_meta: vaultMeta.filter((record) => record.datasetId === datasetId),
    outbox: outbox.filter((record) => record.datasetId === datasetId),
    conflicts: conflicts.filter((record) => record.datasetId === datasetId),
    // Synchronization state is device/session scoped and is never needed to
    // restore the user's canonical records.
    sync_meta: syncMeta.filter(() => false),
    external_cache: externalCache.filter((record) => record.datasetId === datasetId),
  };
}

function makeStoreCounts(stores: BackupStores): Record<BackupStoreName, number> {
  return Object.fromEntries(
    BACKUP_STORE_NAMES.map((name) => [name, stores[name].length]),
  ) as Record<BackupStoreName, number>;
}

const DATASET_SCOPED_STORES = [
  "entities",
  "revisions",
  "operations",
  "settings",
  "metrics_cache",
  "migration_snapshots",
  "vault_meta",
  "outbox",
  "conflicts",
  "external_cache",
] as const satisfies readonly BackupStoreName[];

function sourceRecordKey(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.id === "string" && value.id) return value.id;
  if (typeof value.key === "string" && value.key) return value.key;
  return null;
}

const MENTOR_ENTITY_KEYS = [
  "id",
  "datasetId",
  "domain",
  "type",
  "localDate",
  "occurredAtUTC",
  "timezone",
  "schemaVersion",
  "revision",
  "source",
  "status",
  "createdAt",
  "updatedAt",
  "payload",
] as const;

const FORBIDDEN_FINANCE_DATA_KEYS = new Set([
  "accountnumber",
  "accesstoken",
  "cardnumber",
  "credential",
  "credentials",
  "cvc",
  "cvv",
  "fullcardnumber",
  "pan",
  "passcode",
  "password",
  "pin",
  "refreshtoken",
  "token",
]);

function containsForbiddenFinanceData(value: unknown): boolean {
  const seen = new Set<object>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0;

  while (stack.length) {
    const current = stack.pop();
    if (!current || current.value === null || typeof current.value !== "object") continue;
    visited += 1;
    if (visited > 10_000 || current.depth > 32 || seen.has(current.value)) return true;
    seen.add(current.value);

    if (Array.isArray(current.value)) {
      if (!isDenseArray(current.value)) return true;
      for (const child of current.value) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }

    for (const [key, child] of Object.entries(current.value)) {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (FORBIDDEN_FINANCE_DATA_KEYS.has(normalizedKey)) return true;
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }

  return false;
}

/** @internal Shared by backup validation and revision Undo defense-in-depth. */
export function isMentorEntityCandidate(
  value: unknown,
  sourceDatasetId: string,
): value is MentorEntity {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.datasetId !== sourceDatasetId ||
    !SUPPORTED_DOMAINS.has(value.domain as Domain) ||
    !SUPPORTED_ENTITY_TYPES.has(value.type as EntityType) ||
    typeof value.localDate !== "string" ||
    typeof value.occurredAtUTC !== "string" ||
    typeof value.timezone !== "string" ||
    value.schemaVersion !== CURRENT_ENTITY_SCHEMA_VERSION ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    !["manual", "seed", "imported", "derived"].includes(String(value.source)) ||
    !["active", "superseded", "deleted"].includes(String(value.status)) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !isRecord(value.payload)
  ) {
    return false;
  }
  if (
    value.domain === "financas" &&
    (!hasOnlyKeys(value, MENTOR_ENTITY_KEYS) || containsForbiddenFinanceData(value.payload))
  ) {
    return false;
  }
  if (value.domain === "exames" && !hasOnlyKeys(value, MENTOR_ENTITY_KEYS)) return false;
  try {
    assertLocalDate(value.localDate);
  } catch {
    return false;
  }
  const entityType = value.type as EntityType;
  const expectedDomain = ENTITY_DOMAIN_BY_TYPE[entityType];
  if (expectedDomain && value.domain !== expectedDomain) return false;
  // A validação é bidirecional: mudar o domínio não pode contornar o contrato do laboratório.
  const declaresLaboratory = value.payload.schema === LABORATORY_SCHEMA || value.payload.eventKind === "laboratory-panel";
  if ((value.domain === "exames") !== declaresLaboratory) return false;
  if (declaresLaboratory && (entityType !== "generic.event" || value.localDate !== value.payload.collectedOn)) return false;
  const declaresPersonalReference = value.payload.schema === "clinical-reference-personal-v1" || value.payload.eventKind === "clinical-reference-personal";
  if (declaresPersonalReference && (value.domain !== "conhecimento" || entityType !== "generic.event" || !hasOnlyKeys(value, MENTOR_ENTITY_KEYS))) return false;
  const declaresAnnualDate = value.payload.schema === ANNUAL_DATE_SCHEMA || value.payload.eventKind === "agenda-annual-date";
  if (declaresAnnualDate && (value.domain !== "agenda" || entityType !== "generic.event" || !hasOnlyKeys(value, MENTOR_ENTITY_KEYS))) return false;
  if (entityType === "financas.account") {
    const expectedProvider = canonicalFinanceAccountProvider(value.id);
    if (!expectedProvider || value.payload.providerName !== expectedProvider) return false;
  }
  if (!isISOInstant(value.occurredAtUTC) || !isISOInstant(value.createdAt) || !isISOInstant(value.updatedAt)) {
    return false;
  }
  return isBackupEntityPayloadCandidate(entityType, value.payload);
}

function isSettingCandidate(
  value: unknown,
  sourceDatasetId: string,
): value is SettingRecord {
  return Boolean(
    isRecord(value) &&
      typeof value.id === "string" &&
      value.datasetId === sourceDatasetId &&
      typeof value.key === "string" &&
      value.key.trim().length > 0 &&
      value.key === value.key.trim() &&
      "value" in value &&
      isISOInstant(value.updatedAt) &&
      isSupportedBackupSettingValue(value.key, value.value),
  );
}

interface CompatibleAuditEntry {
  revision: RevisionRecord;
  operation: OperationRecord;
}

type CompatibleAuditByEntity = Map<string, CompatibleAuditEntry[]>;

function isRevisionSnapshotCandidate(
  value: unknown,
  sourceDatasetId: string,
): value is MentorEntity {
  return isMentorEntityCandidate(value, sourceDatasetId);
}

function isRevisionRecordCandidate(
  value: unknown,
  sourceDatasetId: string,
): value is RevisionRecord {
  return Boolean(
    isRecord(value) &&
      typeof value.id === "string" &&
      value.id.length > 0 &&
      value.datasetId === sourceDatasetId &&
      typeof value.entityId === "string" &&
      value.entityId.length > 0 &&
      Number.isSafeInteger(value.revision) &&
      Number(value.revision) >= 1 &&
      typeof value.operationId === "string" &&
      value.operationId.length > 0 &&
      typeof value.reason === "string" &&
      value.reason.length > 0 &&
      isRevisionSnapshotCandidate(value.snapshot, sourceDatasetId) &&
      isISOInstant(value.createdAt) &&
      (value.importId === undefined || typeof value.importId === "string") &&
      (value.sourceDatasetId === undefined || typeof value.sourceDatasetId === "string") &&
      (value.sourceRevision === undefined ||
        (Number.isSafeInteger(value.sourceRevision) && Number(value.sourceRevision) >= 1)),
  );
}

function isOperationRecordCandidate(
  value: unknown,
  sourceDatasetId: string,
): value is OperationRecord {
  return Boolean(
    isRecord(value) &&
      typeof value.id === "string" &&
      value.id.length > 0 &&
      value.datasetId === sourceDatasetId &&
      (value.entityId === undefined ||
        (typeof value.entityId === "string" && value.entityId.length > 0)) &&
      Number.isSafeInteger(value.sequence) &&
      Number(value.sequence) >= 1 &&
      isOneOf(value.kind, ["create", "update", "delete", "restore", "import", "settings"]) &&
      isOneOf(value.status, ["committed", "pending", "failed"]) &&
      (value.baseRevision === undefined ||
        (Number.isSafeInteger(value.baseRevision) && Number(value.baseRevision) >= 1)) &&
      (value.nextRevision === undefined ||
        (Number.isSafeInteger(value.nextRevision) && Number(value.nextRevision) >= 1)) &&
      typeof value.summary === "string" &&
      isISOInstant(value.createdAt) &&
      (value.importId === undefined || typeof value.importId === "string") &&
      (value.sourceDatasetId === undefined || typeof value.sourceDatasetId === "string") &&
      (value.sourceRevision === undefined ||
        (Number.isSafeInteger(value.sourceRevision) && Number(value.sourceRevision) >= 1)),
  );
}

/**
 * Returns only audit rows that are cryptographically covered, structurally
 * valid and linked one-to-one. Gaps from older backups are retained as gaps;
 * they are never filled with invented revisions.
 */
function buildCompatibleAuditByEntity(
  revisions: readonly unknown[],
  operations: readonly unknown[],
  sourceDatasetId: string,
  entities: readonly MentorEntity[],
  sourceNextOperationSequence?: number,
): CompatibleAuditByEntity {
  if (revisions.some((value) => !isRevisionRecordCandidate(value, sourceDatasetId))) {
    throw new Error("O histórico de revisões do backup contém registros inválidos.");
  }
  if (operations.some((value) => !isOperationRecordCandidate(value, sourceDatasetId))) {
    throw new Error("O histórico de operações do backup contém registros inválidos.");
  }

  const typedRevisions = revisions as RevisionRecord[];
  const typedOperations = operations as OperationRecord[];
  const operationById = new Map(typedOperations.map((operation) => [operation.id, operation]));
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const revisionKeys = new Set<string>();
  const linkedOperationIds = new Set<string>();
  const sequenceKeys = new Set<number>();
  const result: CompatibleAuditByEntity = new Map();

  for (const operation of typedOperations) {
    if (sequenceKeys.has(operation.sequence)) {
      throw new Error("O histórico de operações do backup contém sequência duplicada.");
    }
    sequenceKeys.add(operation.sequence);
    if (
      sourceNextOperationSequence !== undefined &&
      operation.sequence > sourceNextOperationSequence
    ) {
      throw new Error("O histórico de operações excede a sequência declarada pelo backup.");
    }
  }

  for (const revision of typedRevisions) {
    const entity = entityById.get(revision.entityId);
    const snapshot = revision.snapshot;
    const logicalKey = `${revision.entityId}:${revision.revision}`;
    if (revisionKeys.has(logicalKey)) {
      throw new Error("O histórico do backup contém revisão lógica duplicada.");
    }
    revisionKeys.add(logicalKey);
    if (
      !entity ||
      revision.revision > entity.revision ||
      snapshot.id !== revision.entityId ||
      snapshot.revision !== revision.revision ||
      snapshot.type !== entity.type ||
      snapshot.domain !== entity.domain
    ) {
      throw new Error(`O histórico do registro ${revision.entityId} não está ligado ao registro atual.`);
    }
    const operation = operationById.get(revision.operationId);
    if (
      !operation ||
      operation.status !== "committed" ||
      operation.kind === "settings" ||
      operation.entityId !== revision.entityId ||
      operation.nextRevision !== revision.revision ||
      (operation.baseRevision !== undefined && operation.baseRevision >= revision.revision) ||
      linkedOperationIds.has(operation.id)
    ) {
      throw new Error(`A operação da revisão ${logicalKey} não é compatível.`);
    }
    linkedOperationIds.add(operation.id);
    const audit = result.get(revision.entityId) ?? [];
    audit.push({ revision, operation });
    result.set(revision.entityId, audit);
  }

  for (const entity of entities) {
    const audit = result.get(entity.id) ?? [];
    audit.sort((left, right) => left.revision.revision - right.revision.revision);
    const current = audit.find((entry) => entry.revision.revision === entity.revision);
    if (!current || stableSerialize(current.revision.snapshot) !== stableSerialize(entity)) {
      throw new Error(`O histórico atual do registro ${entity.id} está incompleto.`);
    }
  }
  return result;
}

function validateBackupContent(content: BackupContent): void {
  if (
    !isRecord(content) ||
    !isRecord(content.manifest) ||
    !isRecord(content.stores) ||
    content.manifest.databaseName !== DATABASE_NAME ||
    content.manifest.formatVersion !== BACKUP_FORMAT_VERSION ||
    typeof content.manifest.datasetId !== "string" ||
    typeof content.manifest.exportedAt !== "string" ||
    !Number.isInteger(content.manifest.databaseVersion) ||
    content.manifest.databaseVersion < 1 ||
    content.manifest.databaseVersion > DATABASE_VERSION ||
    !isRecord(content.manifest.storeCounts)
  ) {
    throw new Error("O backup não corresponde a uma versão compatível do Mentor Bauer.");
  }

  for (const storeName of BACKUP_STORE_NAMES) {
    const values = content.stores[storeName];
    if (!Array.isArray(values)) {
      throw new Error(`A seção ${storeName} do backup está ausente ou corrompida.`);
    }
    if (content.manifest.storeCounts[storeName] !== values.length) {
      throw new Error(`A contagem declarada da seção ${storeName} não confere.`);
    }
    const keys = new Set<string>();
    for (const value of values) {
      const key = sourceRecordKey(value);
      if (!key || keys.has(key)) {
        throw new Error(`A seção ${storeName} contém chave ausente ou duplicada.`);
      }
      keys.add(key);
    }
  }

  const logicalSettingKeys = new Set<string>();
  for (const value of content.stores.settings) {
    const key = isRecord(value) && typeof value.key === "string" ? value.key.trim() : "";
    if (!key || logicalSettingKeys.has(key)) {
      throw new Error("A seção settings contém chave lógica ausente ou duplicada.");
    }
    logicalSettingKeys.add(key);
  }

  const sourceDatasetId = content.manifest.datasetId;
  const sourceDatasets = content.stores.datasets.filter(
    (value): value is DatasetRecord =>
      isRecord(value) && value.id === sourceDatasetId,
  );
  if (sourceDatasets.length !== 1 || content.stores.datasets.length !== 1) {
    throw new Error("O backup precisa conter exatamente o conjunto de dados declarado.");
  }
  const sourceDataset = sourceDatasets[0];
  if (
    sourceDataset.dataSchemaVersion !== CURRENT_ENTITY_SCHEMA_VERSION ||
    !Number.isSafeInteger(sourceDataset.nextOperationSequence) ||
    sourceDataset.nextOperationSequence < 0 ||
    !Number.isSafeInteger(sourceDataset.dataRevision) ||
    sourceDataset.dataRevision < 0 ||
    !Number.isSafeInteger(sourceDataset.settingsRevision) ||
    sourceDataset.settingsRevision < 0 ||
    !isISOInstant(sourceDataset.createdAt) ||
    !isISOInstant(sourceDataset.updatedAt)
  ) {
    throw new Error("O conjunto de dados do backup usa uma versão ou revisão inválida.");
  }
  const identity = sourceDataset.ownerIdentity;
  if (
    !isRecord(identity) ||
    identity.displayName !== "Bauer Vieira" ||
    identity.studentNumber !== 7 ||
    identity.institution !== "UNIFIMES"
  ) {
    throw new Error("A identidade do conjunto de dados do backup não confere.");
  }
  for (const storeName of DATASET_SCOPED_STORES) {
    if (
      content.stores[storeName].some(
        (value) => !belongsToDataset(value, sourceDatasetId),
      )
    ) {
      throw new Error(`A seção ${storeName} contém dados de outro conjunto.`);
    }
  }
  if (
    content.stores.entities.some(
      (value) => !isMentorEntityCandidate(value, sourceDatasetId),
    ) ||
    content.stores.settings.some(
      (value) => !isSettingCandidate(value, sourceDatasetId),
    )
  ) {
    throw new Error("O backup contém entidades ou configurações inválidas.");
  }

  buildCompatibleAuditByEntity(
    content.stores.revisions,
    content.stores.operations,
    sourceDatasetId,
    content.stores.entities as MentorEntity[],
    sourceDataset.nextOperationSequence,
  );
}

async function decryptBackup(
  source: Blob | string,
  passphrase: string,
): Promise<BackupPlaintext> {
  const serialized = typeof source === "string" ? source : await source.text();
  let envelope: EncryptedBackupEnvelope;
  try {
    envelope = JSON.parse(serialized) as EncryptedBackupEnvelope;
  } catch {
    throw new Error("O arquivo não é um backup .bauerlife válido.");
  }
  if (
    envelope.format !== BACKUP_FORMAT ||
    envelope.formatVersion !== BACKUP_FORMAT_VERSION ||
    envelope.encryption?.algorithm !== "AES-GCM" ||
    envelope.encryption?.keyDerivation !== "PBKDF2-SHA-256" ||
    envelope.encryption?.iterations !== PBKDF2_ITERATIONS
  ) {
    throw new Error("Formato ou versão de backup incompatível.");
  }

  const crypto = requireWebCrypto();
  let salt: Uint8Array<ArrayBuffer>;
  let iv: Uint8Array<ArrayBuffer>;
  try {
    salt = base64ToBytes(envelope.encryption.saltBase64);
    iv = base64ToBytes(envelope.encryption.ivBase64);
  } catch {
    throw new Error("Os parâmetros criptográficos do backup estão corrompidos.");
  }
  if (salt.byteLength !== 16 || iv.byteLength !== 12) {
    throw new Error("Os parâmetros criptográficos do backup são inválidos.");
  }
  const key = await deriveBackupKey(passphrase, salt, ["decrypt"]);
  let plaintextBytes: ArrayBuffer;
  try {
    plaintextBytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      base64ToBytes(envelope.ciphertextBase64),
    );
  } catch {
    throw new Error("Não foi possível abrir o backup. Confira a senha e o arquivo.");
  }

  let parsedPlaintext: unknown;
  try {
    parsedPlaintext = JSON.parse(new TextDecoder().decode(plaintextBytes));
  } catch {
    throw new Error("O conteúdo descriptografado do backup está corrompido.");
  }
  if (!isRecord(parsedPlaintext) || typeof parsedPlaintext.checksumSHA256 !== "string") {
    throw new Error("O conteúdo descriptografado do backup está incompleto.");
  }

  const { checksumSHA256, ...rawContent } = parsedPlaintext;
  const actualChecksum = await sha256(JSON.stringify(rawContent));
  if (!checksumSHA256 || actualChecksum !== checksumSHA256) {
    throw new Error("O checksum do backup não confere; nenhuma informação foi importada.");
  }
  const content = rawContent as unknown as BackupContent;
  validateBackupContent(content);
  // Entidades e revisões precisam preservar os bytes, não apenas o JSON do envelope.
  for (const snapshot of [...content.stores.entities, ...content.stores.revisions.map((revision) => (revision as RevisionRecord).snapshot)]) {
    if (isLaboratoryPanelEntity(snapshot as MentorEntity)) await verifyLaboratoryAttachments((snapshot as MentorEntity<"generic.event">).payload as import("../domain/laboratory").LaboratoryPanelPayload);
  }
  return { ...content, checksumSHA256 };
}

export async function exportEncryptedBackup(
  passphrase: string,
): Promise<EncryptedBackupResult> {
  if (passphrase.length < 10) {
    throw new Error("Use uma senha de backup com pelo menos 10 caracteres.");
  }
  await initializeMentorData();
  const dataset = await getActiveDataset();
  const stores = await readBackupStores(dataset.id);
  const exportedAt = new Date().toISOString();
  const storeCounts = makeStoreCounts(stores);
  const content: BackupContent = {
    manifest: {
      databaseName: DATABASE_NAME,
      databaseVersion: DATABASE_VERSION,
      formatVersion: BACKUP_FORMAT_VERSION,
      datasetId: dataset.id,
      exportedAt,
      retentionDays: 365,
      storeCounts,
    },
    stores,
  };
  const checksumSHA256 = await sha256(JSON.stringify(content));
  const plaintext: BackupPlaintext = { ...content, checksumSHA256 };

  const crypto = requireWebCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(passphrase, salt, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(plaintext)),
  );
  const envelope: EncryptedBackupEnvelope = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    encryptedAt: exportedAt,
    encryption: {
      algorithm: "AES-GCM",
      keyDerivation: "PBKDF2-SHA-256",
      iterations: PBKDF2_ITERATIONS,
      saltBase64: bytesToBase64(salt),
      ivBase64: bytesToBase64(iv),
    },
    ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext)),
  };
  const blob = new Blob([JSON.stringify(envelope)], {
    type: "application/vnd.bauerlife+json",
  });

  // A backup is not reported as successful until the exact encrypted blob can
  // be opened again with the supplied passphrase and its checksum validates.
  const roundTrip = await decryptBackup(blob, passphrase);
  if (
    roundTrip.checksumSHA256 !== checksumSHA256 ||
    roundTrip.manifest.datasetId !== dataset.id ||
    stableSerialize(roundTrip.manifest.storeCounts) !== stableSerialize(storeCounts)
  ) {
    throw new Error("O backup gerado não passou na validação de recuperação.");
  }
  // Quantidades iguais não bastam: provar o conteúdo das quatro tabelas canônicas.
  for (const name of RETENTION_STORES) {
    const material = (rows: unknown[]) => rows.map((row) => canonicalRetentionRow(name, row)).sort();
    if (JSON.stringify(material(stores[name])) !== JSON.stringify(material(roundTrip.stores[name]))) throw new Error("Um campo não foi preservado integralmente pelo formato do backup. Os dados originais permanecem intactos; nenhuma cópia foi declarada pronta.");
  }
  const deliveryReceipt: BackupDeliveryReceipt = {
    datasetId: dataset.id,
    exportedAt,
    checksumSHA256,
  };
  // Delivery confirmations may return out of order. Keep a small bounded set
  // per dataset so a late confirmation can be classified as older-than-current
  // instead of becoming an invalid receipt merely because a retry was created.
  rememberPendingDeliveryReceipt(pendingDeliveryReceipts, deliveryReceipt);

  return {
    blob,
    fileName: `Mentor_Bauer_${exportedAt.slice(0, 10)}.bauerlife`,
    exportedAt,
    checksumSHA256,
    storeCounts,
    deliveryReceipt,
  };
}

/**
 * Records backup success only after the UI confirms that share/download
 * completed. Exporting or cancelling the share sheet never advances the
 * recoverability timestamp.
 */
export async function confirmEncryptedBackupDelivery(
  receipt: BackupDeliveryReceipt,
): Promise<BackupDeliveryConfirmation> {
  const pending = pendingDeliveryReceipts.get(receipt.checksumSHA256);
  if (!pending || stableSerialize(pending) !== stableSerialize(receipt)) {
    throw new Error("O comprovante de entrega do backup não está mais válido.");
  }
  const dataset = await getActiveDataset();
  if (
    dataset.id !== receipt.datasetId ||
    !isISOInstant(receipt.exportedAt) ||
    !/^[a-f0-9]{64}$/.test(receipt.checksumSHA256)
  ) {
    throw new Error("O backup entregue não pertence ao conjunto de dados ativo.");
  }
  const database = await openMentorDatabase();
  const transaction = database.transaction("app_meta", "readwrite");
  const current = await transaction.objectStore("app_meta").get("last_backup_created_at");
  if (
    typeof current?.value === "string" &&
    isISOInstant(current.value) &&
    current.value >= receipt.exportedAt
  ) {
    await transaction.done;
    pendingDeliveryReceipts.delete(receipt.checksumSHA256);
    return {
      status: "older-than-current",
      deliveredAt: current.value,
      checksumSHA256: receipt.checksumSHA256,
    };
  }
  const confirmedAt = new Date().toISOString();
  await transaction.objectStore("app_meta").put({
    key: "last_backup_created_at",
    value: receipt.exportedAt,
    updatedAt: confirmedAt,
  });
  await transaction.objectStore("app_meta").put({
    key: "last_backup_checksum_sha256",
    value: receipt.checksumSHA256,
    updatedAt: confirmedAt,
  });
  await transaction.done;
  pendingDeliveryReceipts.delete(receipt.checksumSHA256);
  return {
    status: "recorded",
    deliveredAt: receipt.exportedAt,
    checksumSHA256: receipt.checksumSHA256,
  };
}

export async function validateEncryptedBackup(
  source: Blob | string,
  passphrase: string,
): Promise<ValidatedBackup> {
  const backup = await decryptBackup(source, passphrase);
  return {
    exportedAt: backup.manifest.exportedAt,
    datasetId: backup.manifest.datasetId,
    checksumSHA256: backup.checksumSHA256,
    storeCounts: backup.manifest.storeCounts,
    databaseVersion: backup.manifest.databaseVersion,
  };
}

// Inspeção sem staging: somente um arquivo reaberto pela interface, nunca o Blob de exportação.
export async function inspectBackupForRetention(file: File, passphrase: string) {
  if (!(file instanceof File) || !file.name || file.size === 0 || file.size > 80 * 1024 * 1024) throw new Error("Selecione um arquivo .bauerlife reaberto, de até 80 MB. Nada foi removido.");
  const backup = await decryptBackup(file, passphrase);
  const digest = await requireWebCrypto().subtle.digest("SHA-256", await file.arrayBuffer());
  return { datasetId: backup.manifest.datasetId, exportedAt: backup.manifest.exportedAt, contentChecksum: backup.checksumSHA256, fileChecksum: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""), fileBytes: file.size, stores: backup.stores };
}

interface ImportPlan {
  preview: BackupImportPreview;
  entitiesToCreate: MentorEntity[];
  seedEntitiesToRestore: MentorEntity[];
  settingsToAdd: SettingRecord[];
  auditEntriesToImportByEntity: CompatibleAuditByEntity;
}

function comparableEntity(entity: MentorEntity): unknown {
  return {
    id: entity.id,
    domain: entity.domain,
    type: entity.type,
    localDate: entity.localDate,
    occurredAtUTC: entity.occurredAtUTC,
    timezone: entity.timezone,
    schemaVersion: entity.schemaVersion,
    revision: entity.revision,
    status: entity.status,
    payload: entity.payload,
  };
}

async function buildImportPlan(
  importId: string,
  sourceDatasetId: string,
  targetDataset: DatasetRecord,
  stagedRecords: ImportStageRecord[],
  localEntities: MentorEntity[],
  localSettings: SettingRecord[],
  storeCounts: Record<string, number>,
): Promise<ImportPlan> {
  const localEntityById = new Map(localEntities.map((entity) => [entity.id, entity]));
  const localSettingByKey = new Map(localSettings.map((setting) => [setting.key, setting]));
  const entitiesToCreate: MentorEntity[] = [];
  const seedEntitiesToRestore: MentorEntity[] = [];
  const settingsToAdd: SettingRecord[] = [];
  const entityIdenticalIds: string[] = [];
  const settingIdenticalKeys: string[] = [];
  const conflicts: BackupImportConflictPreview[] = [];
  const stagedSourceEntities = stagedRecords
    .filter((record) => record.storeName === "entities")
    .map((record) => record.value)
    .filter((value): value is MentorEntity =>
      isMentorEntityCandidate(value, sourceDatasetId),
    );
  const compatibleAuditByEntity = buildCompatibleAuditByEntity(
    stagedRecords
      .filter((record) => record.storeName === "revisions")
      .map((record) => record.value),
    stagedRecords
      .filter((record) => record.storeName === "operations")
      .map((record) => record.value),
    sourceDatasetId,
    stagedSourceEntities,
  );

  for (const staged of stagedRecords.filter((record) => record.storeName === "entities")) {
    if (!isMentorEntityCandidate(staged.value, sourceDatasetId)) {
      conflicts.push({
        subjectKind: "entity",
        key: staged.sourceKey,
        reason: "invalid_staged_record",
      });
      continue;
    }
    const local = localEntityById.get(staged.value.id);
    if (!local) {
      entitiesToCreate.push(staged.value);
      continue;
    }
    if (stableSerialize(comparableEntity(local)) === stableSerialize(comparableEntity(staged.value))) {
      entityIdenticalIds.push(staged.value.id);
      continue;
    }
    // A revision-1 seed has never been changed by the user. Recovering the
    // corresponding record from a validated backup is safe and is essential
    // on a freshly installed app, where initialization necessarily creates the
    // deterministic seed IDs before the import flow can open IndexedDB.
    if (
      local.source === "seed" &&
      local.revision === 1 &&
      local.status === "active" &&
      staged.value.revision > 1 &&
      staged.value.type === local.type &&
      staged.value.domain === local.domain
    ) {
      const sourceBase = compatibleAuditByEntity
        .get(staged.value.id)
        ?.find((entry) => entry.revision.revision === 1)
        ?.revision.snapshot;
      if (
        !sourceBase ||
        stableSerialize(comparableEntity(sourceBase)) !==
          stableSerialize(comparableEntity(local))
      ) {
        conflicts.push({
          subjectKind: "entity",
          key: staged.value.id,
          reason: "invalid_staged_record",
          localRevision: local.revision,
          incomingRevision: staged.value.revision,
        });
        continue;
      }
      seedEntitiesToRestore.push(staged.value);
      continue;
    }
    conflicts.push({
      subjectKind: "entity",
      key: staged.value.id,
      reason: "different_existing_record",
      localRevision: local.revision,
      incomingRevision: staged.value.revision,
    });
  }

  for (const staged of stagedRecords.filter((record) => record.storeName === "settings")) {
    if (!isSettingCandidate(staged.value, sourceDatasetId)) {
      conflicts.push({
        subjectKind: "setting",
        key: staged.sourceKey,
        reason: "invalid_staged_record",
      });
      continue;
    }
    const local = localSettingByKey.get(staged.value.key);
    if (local && stableSerialize(local.value) === stableSerialize(staged.value.value)) {
      settingIdenticalKeys.push(staged.value.key);
      continue;
    }
    if (staged.value.key === "retention") {
      conflicts.push({
        subjectKind: "setting",
        key: staged.value.key,
        reason: "protected_setting",
      });
      continue;
    }
    if (!local) {
      settingsToAdd.push(staged.value);
      continue;
    }
    conflicts.push({
      subjectKind: "setting",
      key: staged.value.key,
      reason: "different_existing_record",
    });
  }

  // O conjunto de destino é soberano; IDs diferentes não tornam o mesmo horário duas doses.
  const replacedIds = new Set(seedEntitiesToRestore.map((entity) => entity.id));
  assertMedicationSlotsAvailable(
    [...entitiesToCreate, ...seedEntitiesToRestore].map((entity) => ({ ...entity, datasetId: targetDataset.id })),
    localEntities.filter((entity) => !replacedIds.has(entity.id)),
  );
  entitiesToCreate.sort((left, right) => left.id.localeCompare(right.id));
  seedEntitiesToRestore.sort((left, right) => left.id.localeCompare(right.id));
  settingsToAdd.sort((left, right) => left.key.localeCompare(right.key));
  entityIdenticalIds.sort();
  settingIdenticalKeys.sort();
  conflicts.sort((left, right) =>
    left.subjectKind === right.subjectKind
      ? left.key.localeCompare(right.key)
      : left.subjectKind.localeCompare(right.subjectKind),
  );
  const auditEntriesToImportByEntity: CompatibleAuditByEntity = new Map();
  for (const entity of entitiesToCreate) {
    auditEntriesToImportByEntity.set(
      entity.id,
      [...(compatibleAuditByEntity.get(entity.id) ?? [])],
    );
  }
  for (const entity of seedEntitiesToRestore) {
    auditEntriesToImportByEntity.set(
      entity.id,
      (compatibleAuditByEntity.get(entity.id) ?? []).filter(
        (entry) => entry.revision.revision > 1,
      ),
    );
  }
  const auditRevisionImportCount = [...auditEntriesToImportByEntity.values()]
    .reduce((total, entries) => total + entries.length, 0);
  const auditOperationImportCount = auditRevisionImportCount;
  const ignoredStoreCounts = Object.fromEntries(
    BACKUP_STORE_NAMES.flatMap((name) => {
      if (name === "entities" || name === "settings") return [];
      const sourceCount = storeCounts[name] ?? 0;
      const ignoredCount = name === "revisions"
        ? Math.max(0, sourceCount - auditRevisionImportCount)
        : name === "operations"
          ? Math.max(0, sourceCount - auditOperationImportCount)
          : sourceCount;
      return ignoredCount > 0 ? [[name, ignoredCount] as const] : [];
    }),
  ) as Partial<Record<BackupStoreName, number>>;
  const stagedChecksumSHA256 = await sha256(stagedRecordsMaterial(stagedRecords));
  const planMaterial = {
    importId,
    sourceDatasetId,
    targetDatasetId: targetDataset.id,
    stagedChecksumSHA256,
    actions: {
      entityCreates: entitiesToCreate.map(comparableEntity),
      seedEntityRestores: seedEntitiesToRestore.map(comparableEntity),
      entityIdenticalIds,
      settingsToAdd: settingsToAdd.map((setting) => ({ key: setting.key, value: setting.value })),
      settingIdenticalKeys,
      conflicts,
      auditImports: [...auditEntriesToImportByEntity.entries()].map(
        ([entityId, entries]) => ({
          entityId,
          revisions: entries.map((entry) => entry.revision.revision),
          operationKinds: entries.map((entry) => entry.operation.kind),
        }),
      ),
    },
    baseDataRevision: targetDataset.dataRevision,
    baseSettingsRevision: targetDataset.settingsRevision,
  };
  const planDigest = await sha256(stableSerialize(planMaterial));
  const preview: BackupImportPreview = {
    importId,
    sourceDatasetId,
    targetDatasetId: targetDataset.id,
    baseDataRevision: targetDataset.dataRevision,
    baseSettingsRevision: targetDataset.settingsRevision,
    planDigest,
    stagedChecksumSHA256,
    entityCreateIds: entitiesToCreate.map((entity) => entity.id),
    entitySeedRestoreIds: seedEntitiesToRestore.map((entity) => entity.id),
    entityIdenticalIds,
    settingAddKeys: settingsToAdd.map((setting) => setting.key),
    settingIdenticalKeys,
    conflicts,
    auditRevisionImportCount,
    auditOperationImportCount,
    ignoredStoreCounts,
  };
  return {
    preview,
    entitiesToCreate,
    seedEntitiesToRestore,
    settingsToAdd,
    auditEntriesToImportByEntity,
  };
}

export async function previewStagedImport(importId: string): Promise<BackupImportPreview> {
  await initializeMentorData();
  const database = await openMentorDatabase();
  const importRecord = await database.get("imports", importId);
  if (!importRecord || importRecord.status !== "validated") {
    throw new Error("A importação não existe ou não está pronta para prévia.");
  }
  if (!importRecord.sourceDatasetId) {
    throw new Error("A importação não registra o conjunto de dados de origem.");
  }
  const targetDataset = await database.get("datasets", importRecord.datasetId);
  const activeDataset = await getActiveDataset();
  if (
    !targetDataset ||
    targetDataset.status !== "active" ||
    targetDataset.id !== activeDataset.id
  ) {
    throw new Error("O conjunto de dados de destino não está ativo.");
  }
  const [stagedRecords, localEntities, localSettings] = await Promise.all([
    database.getAllFromIndex("import_stage", "by_import", importId),
    database.getAllFromIndex("entities", "by_dataset", targetDataset.id),
    database.getAllFromIndex("settings", "by_dataset", targetDataset.id),
  ]);
  const stagedChecksumSHA256 = await sha256(stagedRecordsMaterial(stagedRecords));
  if (
    !importRecord.stagedChecksumSHA256 ||
    importRecord.stagedChecksumSHA256 !== stagedChecksumSHA256
  ) {
    throw new Error("A cópia preparada mudou depois da validação; prepare o backup novamente.");
  }
  const plan = await buildImportPlan(
    importId,
    importRecord.sourceDatasetId,
    targetDataset,
    stagedRecords,
    localEntities,
    localSettings,
    importRecord.storeCounts,
  );

  const updateTransaction = database.transaction("imports", "readwrite");
  const latestImportRecord = await updateTransaction.objectStore("imports").get(importId);
  if (!latestImportRecord || latestImportRecord.status !== "validated") {
    await abortTransactionSafely(updateTransaction);
    throw new Error("A importação mudou enquanto a prévia era preparada.");
  }
  if (latestImportRecord.stagedChecksumSHA256 !== plan.preview.stagedChecksumSHA256) {
    await abortTransactionSafely(updateTransaction);
    throw new Error("A cópia preparada mudou enquanto a prévia era calculada.");
  }
  await updateTransaction.objectStore("imports").put({
    ...latestImportRecord,
    baseDataRevision: plan.preview.baseDataRevision,
    baseSettingsRevision: plan.preview.baseSettingsRevision,
    planDigest: plan.preview.planDigest,
    planCounts: {
      entityCreates: plan.entitiesToCreate.length,
      seedEntityRestores: plan.seedEntitiesToRestore.length,
      entityIdentical: plan.preview.entityIdenticalIds.length,
      settingAdds: plan.settingsToAdd.length,
      settingIdentical: plan.preview.settingIdenticalKeys.length,
      conflicts: plan.preview.conflicts.length,
      auditRevisions: plan.preview.auditRevisionImportCount,
      auditOperations: plan.preview.auditOperationImportCount,
    },
  });
  await updateTransaction.done;
  return plan.preview;
}

/**
 * Decrypts and validates a backup into an isolated staging store. It does not
 * overwrite canonical data. Applying or reconciling a staged import is a
 * separate, explicit operation so failed imports are reversible.
 */
export async function stageEncryptedBackup(
  source: Blob | string,
  passphrase: string,
  sourceName = "backup.bauerlife",
): Promise<StagedImportResult> {
  const backup = await decryptBackup(source, passphrase);
  const dataset = await getActiveDataset();
  const database = await openMentorDatabase();
  const importId = `import-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
  const createdAt = new Date().toISOString();
  const stagedEntries: Array<{
    storeName: string;
    sourceKey: string;
    value: unknown;
  }> = [];

  for (const storeName of BACKUP_STORE_NAMES) {
    backup.stores[storeName].forEach((value, index) => {
      const candidate = value as { id?: unknown; key?: unknown };
      const sourceKey =
        typeof candidate?.id === "string"
          ? candidate.id
          : typeof candidate?.key === "string"
            ? candidate.key
            : String(index);
      stagedEntries.push({ storeName, sourceKey, value });
    });
  }
  const stagedRecords: ImportStageRecord[] = stagedEntries.map((entry, index) => ({
    id: `${importId}:${index.toString().padStart(8, "0")}`,
    importId,
    datasetId: dataset.id,
    ...entry,
  }));
  const stagedChecksumSHA256 = await sha256(stagedRecordsMaterial(stagedRecords));

  const transaction = database.transaction(["imports", "import_stage"], "readwrite");
  await transaction.objectStore("imports").add({
    id: importId,
    datasetId: dataset.id,
    sourceDatasetId: backup.manifest.datasetId,
    sourceExportedAt: backup.manifest.exportedAt,
    format: "bauerlife",
    status: "validated",
    sourceName,
    payloadChecksum: backup.checksumSHA256,
    stagedChecksumSHA256,
    storeCounts: backup.manifest.storeCounts,
    createdAt,
    validatedAt: createdAt,
  });
  const stageStore = transaction.objectStore("import_stage");
  for (const stagedRecord of stagedRecords) {
    await stageStore.add(stagedRecord);
  }
  await transaction.done;

  let preview: BackupImportPreview;
  try {
    preview = await previewStagedImport(importId);
  } catch (error) {
    // Uma colisão preserva a cópia isolada para revisão; não toca o banco ativo nem escolhe uma dose.
    if (!(error instanceof MedicationSlotConflictError)) await discardStagedImport(importId).catch(() => undefined);
    throw error;
  }

  return {
    importId,
    stagedRecordCount: stagedEntries.length,
    exportedAt: backup.manifest.exportedAt,
    datasetId: backup.manifest.datasetId,
    checksumSHA256: backup.checksumSHA256,
    storeCounts: backup.manifest.storeCounts,
    databaseVersion: backup.manifest.databaseVersion,
    preview,
  };
}

/** Validation is part of staging; this helper is the single-call UI path. */
export function validateAndStageEncryptedBackup(
  source: Blob | string,
  passphrase: string,
  sourceName = "backup.bauerlife",
): Promise<StagedImportResult> {
  return stageEncryptedBackup(source, passphrase, sourceName);
}

export async function applyStagedImport(
  importId: string,
  options: ApplyStagedImportOptions,
): Promise<AppliedBackupMergeResult> {
  const mode = options.mode ?? "safe-only";
  const database = await openMentorDatabase();
  const importRecord = await database.get("imports", importId);
  if (!importRecord || importRecord.status !== "validated") {
    throw new Error("A importação não existe ou já foi encerrada.");
  }
  if (
    !importRecord.sourceDatasetId ||
    !importRecord.stagedChecksumSHA256 ||
    !importRecord.planDigest ||
    importRecord.planDigest !== options.expectedPlanDigest
  ) {
    throw new Error("A prévia da importação não confere. Prepare uma nova prévia.");
  }
  const targetDataset = await database.get("datasets", importRecord.datasetId);
  const activeDataset = await getActiveDataset();
  if (
    !targetDataset ||
    targetDataset.status !== "active" ||
    targetDataset.id !== activeDataset.id
  ) {
    throw new Error("O conjunto de dados de destino não está selecionado.");
  }
  const [stagedRecords, localEntities, localSettings] = await Promise.all([
    database.getAllFromIndex("import_stage", "by_import", importId),
    database.getAllFromIndex("entities", "by_dataset", targetDataset.id),
    database.getAllFromIndex("settings", "by_dataset", targetDataset.id),
  ]);
  const preflightStagedMaterial = stagedRecordsMaterial(stagedRecords);
  const preflightStagedChecksum = await sha256(preflightStagedMaterial);
  if (preflightStagedChecksum !== importRecord.stagedChecksumSHA256) {
    throw new Error("A cópia preparada mudou depois da prévia; nenhuma mesclagem foi aplicada.");
  }
  const plan = await buildImportPlan(
    importId,
    importRecord.sourceDatasetId,
    targetDataset,
    stagedRecords,
    localEntities,
    localSettings,
    importRecord.storeCounts,
  );
  if (plan.preview.planDigest !== importRecord.planDigest) {
    throw new Error("Os dados ativos ou a cópia preparada mudaram desde a prévia; nenhuma mesclagem foi aplicada.");
  }
  if (mode === "abort-on-conflict" && plan.preview.conflicts.length > 0) {
    throw new Error("A mesclagem foi cancelada porque a prévia contém conflitos.");
  }

  const beforeChecksum = await sha256(
    stableSerialize(localEntities.map(comparableEntity).sort((left, right) =>
      stableSerialize(left).localeCompare(stableSerialize(right)),
    )),
  );
  const appliedAt = new Date().toISOString();
  const transaction = database.transaction(
    [
      "imports",
      "import_stage",
      "app_meta",
      "datasets",
      "entities",
      "revisions",
      "operations",
      "settings",
      "metrics_cache",
      "migration_snapshots",
      "conflicts",
    ],
    "readwrite",
  );
  const transactionCompletion = observeTransactionCompletion(transaction);
  const transactionImport = await transaction.objectStore("imports").get(importId);
  const activeDatasetMeta = await transaction
    .objectStore("app_meta")
    .get("active_dataset_id");
  const transactionDataset = await transaction
    .objectStore("datasets")
    .get(targetDataset.id);
  const transactionStagedRecords = await transaction
    .objectStore("import_stage")
    .index("by_import")
    .getAll(importId);
  if (
    !transactionImport ||
    transactionImport.status !== "validated" ||
    transactionImport.planDigest !== options.expectedPlanDigest ||
    !transactionDataset ||
    transactionDataset.status !== "active" ||
    activeDatasetMeta?.value !== transactionDataset.id ||
    transactionDataset.dataRevision !== importRecord.baseDataRevision ||
    transactionDataset.settingsRevision !== importRecord.baseSettingsRevision ||
    stagedRecordsMaterial(transactionStagedRecords) !== preflightStagedMaterial
  ) {
    await abortTransactionSafely(transaction);
    throw new Error("A prévia ficou desatualizada; nenhuma mesclagem foi aplicada.");
  }

  let nextSequence = transactionDataset.nextOperationSequence;
  let dataRevision = transactionDataset.dataRevision;
  let settingsRevision = transactionDataset.settingsRevision;
  const createdEntityIds: string[] = [];
  const restoredSeedEntityIds: string[] = [];
  const addedSettingKeys: string[] = [];
  let importedRevisionCount = 0;
  let importedOperationCount = 0;
  const makeUniqueAuditId = async (
    storeName: "operations" | "revisions",
    prefix: "operation" | "revision",
  ): Promise<string> => {
    const store = transaction.objectStore(storeName);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const suffix = globalThis.crypto?.randomUUID?.() ??
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const candidate = `${prefix}-${importId}-${suffix}`;
      if (!(await store.get(candidate))) return candidate;
    }
    await abortTransactionSafely(transaction);
    throw new Error("Não foi possível reservar chaves locais para o histórico restaurado.");
  };
  const importAuditHistory = async (entity: MentorEntity): Promise<void> => {
    const auditEntries = plan.auditEntriesToImportByEntity.get(entity.id) ?? [];
    for (const entry of auditEntries) {
      const operationId = await makeUniqueAuditId("operations", "operation");
      const revisionId = await makeUniqueAuditId("revisions", "revision");
      nextSequence += 1;
      const snapshot: MentorEntity = {
        ...entry.revision.snapshot,
        datasetId: transactionDataset.id,
      };
      await transaction.objectStore("operations").add({
        ...entry.operation,
        id: operationId,
        datasetId: transactionDataset.id,
        entityId: entity.id,
        sequence: nextSequence,
        status: "committed",
        importId,
        sourceDatasetId: importRecord.sourceDatasetId,
        sourceRevision: entry.revision.revision,
      });
      await transaction.objectStore("revisions").add({
        ...entry.revision,
        id: revisionId,
        datasetId: transactionDataset.id,
        entityId: entity.id,
        operationId,
        snapshot,
        importId,
        sourceDatasetId: importRecord.sourceDatasetId,
        sourceRevision: entry.revision.revision,
      });
      importedOperationCount += 1;
      importedRevisionCount += 1;
    }
  };
  for (const sourceEntity of plan.entitiesToCreate) {
    const entity: MentorEntity = {
      ...sourceEntity,
      datasetId: transactionDataset.id,
    };
    dataRevision += 1;
    await assertMedicationSlotInTransaction(transaction, entity);
    await transaction.objectStore("entities").add(entity);
    await importAuditHistory(entity);
    createdEntityIds.push(entity.id);
  }

  const localEntityById = new Map(localEntities.map((entity) => [entity.id, entity]));
  for (const sourceEntity of plan.seedEntitiesToRestore) {
    const local = localEntityById.get(sourceEntity.id);
    if (!local || local.source !== "seed" || local.revision !== 1 || local.status !== "active") {
      await abortTransactionSafely(transaction);
      throw new Error("Um registro inicial mudou durante a restauração; nenhuma mesclagem foi aplicada.");
    }
    const entity: MentorEntity = {
      ...sourceEntity,
      datasetId: transactionDataset.id,
    };
    dataRevision += 1;
    await assertMedicationSlotInTransaction(transaction, entity);
    await transaction.objectStore("entities").put(entity);
    await importAuditHistory(entity);
    restoredSeedEntityIds.push(entity.id);
  }

  for (const sourceSetting of plan.settingsToAdd) {
    const setting: SettingRecord = {
      ...sourceSetting,
      id: `${transactionDataset.id}:${sourceSetting.key}`,
      datasetId: transactionDataset.id,
      updatedAt: appliedAt,
    };
    const operationId = `operation-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    nextSequence += 1;
    settingsRevision += 1;
    await transaction.objectStore("settings").add(setting);
    await transaction.objectStore("operations").add({
      id: operationId,
      datasetId: transactionDataset.id,
      sequence: nextSequence,
      kind: "import",
      status: "committed",
      summary: `Non-conflicting setting ${setting.key} added from a validated backup.`,
      createdAt: appliedAt,
      importId,
      sourceDatasetId: importRecord.sourceDatasetId,
    });
    addedSettingKeys.push(setting.key);
  }

  const localSettingByKey = new Map(localSettings.map((setting) => [setting.key, setting]));
  for (const conflict of plan.preview.conflicts) {
    const incoming = stagedRecords.find(
      (record) =>
        record.storeName === (conflict.subjectKind === "entity" ? "entities" : "settings") &&
        (conflict.subjectKind === "entity"
          ? record.sourceKey === conflict.key
          : isRecord(record.value) && record.value.key === conflict.key),
    )?.value;
    const local =
      conflict.subjectKind === "entity"
        ? localEntityById.get(conflict.key)
        : localSettingByKey.get(conflict.key);
    await transaction.objectStore("conflicts").put({
      id: `${importId}:conflict:${conflict.subjectKind}:${conflict.key}`,
      datasetId: transactionDataset.id,
      entityId:
        conflict.subjectKind === "entity" ? conflict.key : `setting:${conflict.key}`,
      localRevision:
        conflict.subjectKind === "entity" && local && "revision" in local
          ? local.revision
          : transactionDataset.settingsRevision,
      remoteRevision: conflict.incomingRevision ?? 0,
      state: "open",
      createdAt: appliedAt,
      importId,
      subjectKind: conflict.subjectKind,
      ...(conflict.subjectKind === "setting" ? { settingKey: conflict.key } : {}),
      reason: conflict.reason,
      localSnapshot: local,
      incomingSnapshot: incoming,
    });
  }

  let metricCursor = await transaction
    .objectStore("metrics_cache")
    .index("by_dataset")
    .openCursor(IDBKeyRange.only(transactionDataset.id));
  while (metricCursor) {
    await metricCursor.delete();
    metricCursor = await metricCursor.continue();
  }
  await transaction.objectStore("migration_snapshots").add({
    id: `snapshot-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    datasetId: transactionDataset.id,
    importId,
    label: "Before non-destructive backup merge",
    entityCount: localEntities.length,
    checksum: beforeChecksum,
    createdAt: appliedAt,
  });
  await transaction.objectStore("datasets").put({
    ...transactionDataset,
    nextOperationSequence: nextSequence,
    dataRevision,
    settingsRevision,
    updatedAt: appliedAt,
  });
  let stageCursor = await transaction
    .objectStore("import_stage")
    .index("by_import")
    .openCursor(importId);
  while (stageCursor) {
    await stageCursor.delete();
    stageCursor = await stageCursor.continue();
  }
  await transaction.objectStore("imports").put({
    ...transactionImport,
    status: "applied",
    appliedAt,
    applyMode: mode,
    appliedCounts: {
      entities: createdEntityIds.length,
      restoredSeedEntities: restoredSeedEntityIds.length,
      settings: addedSettingKeys.length,
      conflicts: plan.preview.conflicts.length,
      auditRevisions: importedRevisionCount,
      auditOperations: importedOperationCount,
    },
  });
  await assertObservedTransactionCompleted(transactionCompletion);

  const appliedCount =
    createdEntityIds.length + restoredSeedEntityIds.length + addedSettingKeys.length;
  return {
    importId,
    status:
      plan.preview.conflicts.length > 0
        ? "applied_with_conflicts"
        : appliedCount > 0
          ? "applied"
          : "nothing_to_apply",
    mode,
    appliedAt,
    targetDatasetId: transactionDataset.id,
    createdEntityIds,
    restoredSeedEntityIds,
    addedSettingKeys,
    skippedIdenticalEntityIds: plan.preview.entityIdenticalIds,
    skippedIdenticalSettingKeys: plan.preview.settingIdenticalKeys,
    conflicts: plan.preview.conflicts,
    importedRevisionCount,
    importedOperationCount,
  };
}

export async function discardStagedImport(
  importId: string,
): Promise<DiscardStagedImportResult> {
  const database = await openMentorDatabase();
  const transaction = database.transaction(["imports", "import_stage"], "readwrite");
  const importRecord = await transaction.objectStore("imports").get(importId);
  if (!importRecord) {
    await abortTransactionSafely(transaction);
    throw new Error("Importação não encontrada.");
  }
  let removedRecordCount = 0;
  let cursor = await transaction
    .objectStore("import_stage")
    .index("by_import")
    .openCursor(IDBKeyRange.only(importId));
  while (cursor) {
    await cursor.delete();
    removedRecordCount += 1;
    cursor = await cursor.continue();
  }
  if (importRecord.status === "validated" || importRecord.status === "staged") {
    await transaction.objectStore("imports").put({
      ...importRecord,
      status: "rejected",
    });
  }
  await transaction.done;
  return {
    importId,
    status:
      importRecord.status === "validated" || importRecord.status === "staged"
        ? "discarded"
        : "already-finalized",
    removedRecordCount,
  };
}

export function isLocalDateInBackupRange(value: string): value is LocalDate {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
