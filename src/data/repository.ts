import {
  APP_TIME_ZONE,
  RETENTION_POLICY,
  assertLocalDate,
  assertLocalDateTime,
  buildManualShiftPayload,
  combineLocalDateAndTime,
  compareLocalDateTimes,
  inclusiveDateWindow,
  known,
  localDateFromDateTime,
  resolveShiftDepartureLocalDateTime,
  summarizeEnergy,
  todayInTimeZone,
  unknown,
  type AttendanceStatus,
  type ConfirmMedicationInput,
  type CreateManualShiftInput,
  type EntityStatusMutationInput,
  type EntityPayloadByType,
  type EntityQuery,
  type EntityType,
  type GenericPayload,
  type Knowledge,
  type LocalDate,
  type LocalDateTime,
  type LocalTime,
  type MentorWorkspace,
  type MentorEntity,
  type RecordEnergyInput,
  type RecordGenericEventInput,
  type RecordShiftTimeInput,
  type SettingRecord,
  type ShiftTimeField,
  type ShiftTimeUpdateValue,
  type StoragePersistenceResult,
  type TodaySnapshot,
  type UpdateShiftInput,
} from "../domain";
import {
  asAnnualPercentageRateBps,
  asBRLMinorUnits,
  assertFinanceStatusTransition,
  assertFinanceProvider,
  brlMoney,
  calculateAgendaConflicts,
  isFinanceSubscriptionPayload,
  isFinanceSubscriptionStatus,
  forwardAgendaWindow,
  notApplicable,
  summarizeFinanceTransactions,
  type AgendaBufferTruth,
  type AgendaConflict,
  type AgendaDueTruth,
  type AgendaTemporalTruth,
  type AgendaWindowQuery,
  type BRLMinorUnits,
  type CreateAgendaEventInput,
  type CreateAgendaGoalSetInput,
  type CreateAgendaTaskInput,
  type CreateFinanceBillInput,
  type CreateFinanceBudgetInput,
  type CreateFinanceCardInput,
  type CreateFinanceDebtInput,
  type CreateFinanceGoalInput,
  type CreateFinanceTransactionInput,
  type FinanceEntityType,
  type FinanceStatusByEntityType,
  type FinanceSubscriptionPayloadCandidate,
  type FinanceTransactionSummary,
  type FinanceWindowQuery,
  type InclusiveDateWindow,
  type QuickCaptureAgendaInput,
  type UpdateAgendaItemInput,
  type UpdateFinanceAccountInput,
  type UpdateFinanceSubscriptionStatusInput,
  type UpdateFinanceRecordInput,
} from "../domain";
import {
  getStorageDurabilityStatus,
  openMentorDatabase,
  requestPersistentStorage,
} from "./database";
import { isBackupEntityPayloadCandidate } from "./backup";
import { selectOperationalWindow } from "../domain/operationalState";
import { assertMedicationSlotInTransaction } from "./medicationUniqueness";
import { LABORATORY_SCHEMA, isLaboratoryPanelPayload, verifyLaboratoryAttachments, type LaboratoryPanelPayload } from "../domain/laboratory";
import { isPersonalReferencePayload } from "../domain/clinicalReference";
import { ANNUAL_DATE_SCHEMA, isAnnualDatePayload, type AnnualDatePayload } from "../domain/annualDates";
import {
  CANONICAL_FINANCE_ACCOUNT_PROVIDER_BY_ID,
  canonicalFinanceAccountProvider,
} from "./financeAccounts";
import { getActiveDataset, initializeMentorData } from "./seed";
import {
  abortTransactionSafely,
  assertObservedTransactionCompleted,
  observeTransactionCompletion,
} from "./transactionSafety";

function nowISO(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function assertEnergy(value: number): asserts value is 1 | 2 | 3 | 4 | 5 {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("Energia precisa ser registrada em uma escala de 1 a 5.");
  }
}

function assertLocalTime(value: string): void {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (
    !match ||
    Number(match[1]) > 23 ||
    Number(match[2]) > 59 ||
    Number(match[3] ?? 0) > 59
  ) {
    throw new Error(`Horário local inválido: ${value}`);
  }
}

function assertMedicationTiming(input: ConfirmMedicationInput): void {
  switch (input.confirmation) {
    case "taken_time_recorded":
      if (!input.actualTimeLocal) {
        throw new Error("A tomada com horário registrado precisa do horário real.");
      }
      return;
    case "taken_time_unknown":
      if (input.actualTimeLocal) {
        throw new Error("Uma tomada com horário desconhecido não pode conter horário real.");
      }
      return;
    case "taken_on_time":
    case "taken_late":
      if (!input.scheduledTimeLocal || !input.actualTimeLocal) {
        throw new Error(
          "A classificação de pontualidade exige os horários agendado e real.",
        );
      }
      return;
    case "skipped_confirmed":
      if (input.actualTimeLocal) {
        throw new Error("Uma dose não tomada não pode conter horário real de tomada.");
      }
      return;
  }
}

async function commitEntity<TEntity extends MentorEntity>(
  entity: TEntity,
  options: {
    kind: "create" | "update" | "delete" | "restore";
    reason: string;
    summary: string;
    baseRevision?: number;
  },
): Promise<TEntity> {
  const database = await openMentorDatabase();
  const operationId = makeId("operation");
  const transaction = database.transaction(
    ["app_meta", "datasets", "entities", "revisions", "operations", "outbox"],
    "readwrite",
  );
  const transactionCompletion = observeTransactionCompletion(transaction);
  const entityStore = transaction.objectStore("entities");
  const datasetStore = transaction.objectStore("datasets");
  const dataset = await datasetStore.get(entity.datasetId);
  const activeDatasetMeta = await transaction
    .objectStore("app_meta")
    .get("active_dataset_id");
  if (!dataset || dataset.status !== "active" || activeDatasetMeta?.value !== dataset.id) {
    await abortTransactionSafely(transaction);
    throw new Error("O conjunto de dados ativo não foi encontrado.");
  }
  const existing = await entityStore.get(entity.id);

  if (options.kind === "create" && existing) {
    await abortTransactionSafely(transaction);
    throw new Error("Este registro já existe.");
  }
  if (
    options.kind !== "create" &&
    (!existing || existing.revision !== options.baseRevision)
  ) {
    await abortTransactionSafely(transaction);
    throw new Error("O registro mudou em outra operação. Atualize a tela antes de tentar de novo.");
  }

  await assertMedicationSlotInTransaction(transaction, entity);

  await entityStore.put(entity);
  const sequence = dataset.nextOperationSequence + 1;
  await datasetStore.put({
    ...dataset,
    nextOperationSequence: sequence,
    dataRevision: dataset.dataRevision + 1,
    updatedAt: entity.updatedAt,
  });
  await transaction.objectStore("revisions").add({
    id: makeId("revision"),
    datasetId: entity.datasetId,
    entityId: entity.id,
    revision: entity.revision,
    operationId,
    reason: options.reason,
    snapshot: entity,
    createdAt: entity.updatedAt,
  });
  await transaction.objectStore("operations").add({
    id: operationId,
    datasetId: entity.datasetId,
    entityId: entity.id,
    sequence,
    kind: options.kind,
    status: "committed",
    ...(options.baseRevision === undefined
      ? {}
      : { baseRevision: options.baseRevision }),
    nextRevision: entity.revision,
    summary: options.summary,
    createdAt: entity.updatedAt,
  });
  await transaction.objectStore("outbox").add({
    id: makeId("outbox"),
    datasetId: entity.datasetId,
    operationId,
    entityId: entity.id,
    state: "pending",
    createdAt: entity.updatedAt,
  });
  await assertObservedTransactionCompleted(transactionCompletion);
  return entity;
}

export async function listEntities<TType extends EntityType = EntityType>(
  query: EntityQuery & { type?: TType } = {},
): Promise<Array<MentorEntity<TType>>> {
  await initializeMentorData();
  const database = await openMentorDatabase();
  const datasetId = query.datasetId ?? (await getActiveDataset()).id;

  let entities: MentorEntity[];
  if (query.startLocalDate || query.endLocalDate) {
    const start = query.startLocalDate ?? ("0000-01-01" as LocalDate);
    const end = query.endLocalDate ?? ("9999-12-31" as LocalDate);
    assertLocalDate(start);
    assertLocalDate(end);
    if (start > end) {
      throw new Error("A data inicial não pode ser posterior à data final.");
    }
    entities = await database.getAllFromIndex(
      "entities",
      "by_dataset_date",
      IDBKeyRange.bound([datasetId, start], [datasetId, end]),
    );
  } else if (query.domain) {
    entities = await database.getAllFromIndex(
      "entities",
      "by_dataset_domain",
      [datasetId, query.domain],
    );
  } else {
    entities = await database.getAllFromIndex("entities", "by_dataset", datasetId);
  }

  return entities
    .filter((entity) => (query.domain ? entity.domain === query.domain : true))
    .filter((entity) => (query.type ? entity.type === query.type : true))
    .filter((entity) => (query.includeDeleted ? true : entity.status === "active"))
    .sort((left, right) =>
      left.occurredAtUTC === right.occurredAtUTC
        ? left.id.localeCompare(right.id)
        : left.occurredAtUTC.localeCompare(right.occurredAtUTC),
    ) as Array<MentorEntity<TType>>;
}

export async function getEntity<TType extends EntityType>(
  id: string,
  expectedType?: TType,
): Promise<MentorEntity<TType> | null> {
  await initializeMentorData();
  const entity = await (await openMentorDatabase()).get("entities", id);
  if (!entity || entity.status === "deleted") {
    return null;
  }
  if (expectedType && entity.type !== expectedType) {
    throw new Error(`O registro ${id} não é do tipo ${expectedType}.`);
  }
  return entity as MentorEntity<TType>;
}

export async function getEntityIncludingDeleted<TType extends EntityType>(
  id: string,
  expectedType?: TType,
): Promise<MentorEntity<TType> | null> {
  await initializeMentorData();
  const entity = await (await openMentorDatabase()).get("entities", id);
  if (!entity) return null;
  if (expectedType && entity.type !== expectedType) {
    throw new Error(`O registro ${id} não é do tipo ${expectedType}.`);
  }
  return entity as MentorEntity<TType>;
}

async function changeEntityStatus<TType extends EntityType>(
  input: EntityStatusMutationInput,
  targetStatus: "active" | "deleted",
): Promise<MentorEntity<TType>> {
  const current = await getEntityIncludingDeleted<TType>(input.entityId);
  if (!current) {
    throw new Error("Registro não encontrado.");
  }
  const activeDataset = await getActiveDataset();
  if (current.datasetId !== activeDataset.id) {
    throw new Error("O registro não pertence ao conjunto de dados ativo.");
  }
  if (
    input.expectedRevision !== undefined &&
    current.revision !== input.expectedRevision
  ) {
    throw new Error("O registro mudou em outra operação. Atualize a tela antes de tentar de novo.");
  }
  if (current.status === targetStatus) {
    return current;
  }
  if (targetStatus === "deleted" && current.status !== "active") {
    throw new Error("Somente um registro ativo pode ser excluído.");
  }
  if (targetStatus === "active" && current.status !== "deleted") {
    throw new Error("Somente um registro excluído pode ser restaurado.");
  }

  const timestamp = input.occurredAtUTC ?? nowISO();
  const updated: MentorEntity<TType> = {
    ...current,
    status: targetStatus,
    revision: current.revision + 1,
    updatedAt: timestamp,
  };
  const restoring = targetStatus === "active";
  return commitEntity(updated, {
    kind: restoring ? "restore" : "delete",
    baseRevision: current.revision,
    reason: restoring ? "entity_restored" : "entity_deleted",
    summary: restoring
      ? "Deleted record explicitly restored by the user."
      : "Record explicitly deleted by the user.",
  });
}

export function deleteEntity<TType extends EntityType = EntityType>(
  input: EntityStatusMutationInput,
): Promise<MentorEntity<TType>> {
  return changeEntityStatus<TType>(input, "deleted");
}

export function restoreEntity<TType extends EntityType = EntityType>(
  input: EntityStatusMutationInput,
): Promise<MentorEntity<TType>> {
  return changeEntityStatus<TType>(input, "active");
}

export async function recordEnergy(
  input: RecordEnergyInput,
): Promise<MentorEntity<"humor.energy-check-in">> {
  assertEnergy(input.value);
  const dataset = await getActiveDataset();
  const timestamp = input.occurredAtUTC ?? nowISO();
  const localDate = input.localDate ?? todayInTimeZone(APP_TIME_ZONE, new Date(timestamp));
  assertLocalDate(localDate);
  const entity: MentorEntity<"humor.energy-check-in"> = {
    id: makeId("energy"),
    datasetId: dataset.id,
    domain: "humor",
    type: "humor.energy-check-in",
    localDate,
    occurredAtUTC: timestamp,
    timezone: APP_TIME_ZONE,
    schemaVersion: 1,
    revision: 1,
    source: "manual",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    payload: {
      energy: input.value,
      scaleVersion: "energy-1-5-v1",
      note: input.note?.trim()
        ? known(input.note.trim(), "user", timestamp)
        : unknown("not_recorded"),
    },
  };
  return commitEntity(entity, {
    kind: "create",
    reason: "energy_recorded",
    summary: "Energy check-in explicitly recorded by the user.",
  });
}

export async function confirmMedication(
  input: ConfirmMedicationInput,
): Promise<MentorEntity<"medicamentos.confirmation">> {
  const dataset = await getActiveDataset();
  const timestamp = input.occurredAtUTC ?? nowISO();
  const localDate = input.localDate ?? todayInTimeZone(APP_TIME_ZONE, new Date(timestamp));
  assertLocalDate(localDate);
  if (input.scheduledTimeLocal) assertLocalTime(input.scheduledTimeLocal);
  if (input.actualTimeLocal) assertLocalTime(input.actualTimeLocal);
  assertMedicationTiming(input);

  const entity: MentorEntity<"medicamentos.confirmation"> = {
    id: makeId("medication"),
    datasetId: dataset.id,
    domain: "medicamentos",
    type: "medicamentos.confirmation",
    localDate,
    occurredAtUTC: timestamp,
    timezone: APP_TIME_ZONE,
    schemaVersion: 1,
    revision: 1,
    source: "manual",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    payload: {
      ...(input.regimenId?.trim()
        ? { regimenId: known(input.regimenId.trim(), "user", timestamp) }
        : {}),
      medicationName: input.medicationName?.trim()
        ? known(input.medicationName.trim(), "user", timestamp)
        : unknown("not_provided"),
      ...(input.doseLabel?.trim()
        ? { doseLabel: known(input.doseLabel.trim(), "user", timestamp) }
        : {}),
      scheduledTimeLocal: input.scheduledTimeLocal
        ? known(input.scheduledTimeLocal, "user", timestamp)
        : unknown("not_provided"),
      actualTimeLocal: input.actualTimeLocal
        ? known(input.actualTimeLocal, "user", timestamp)
        : unknown("not_recorded"),
      confirmation: input.confirmation,
      note: input.note?.trim()
        ? known(input.note.trim(), "user", timestamp)
        : unknown("not_recorded"),
    },
  };
  return commitEntity(entity, {
    kind: "create",
    reason: "medication_explicitly_confirmed",
    summary: `Medication status explicitly recorded as ${input.confirmation}.`,
  });
}

export async function recordGenericEvent<TPayload extends GenericPayload>(
  input: RecordGenericEventInput<TPayload>,
): Promise<MentorEntity<"generic.event">> {
  const declaresLaboratory = input.payload?.schema === LABORATORY_SCHEMA || input.payload?.eventKind === "laboratory-panel";
  const declaresPersonalReference = input.payload?.schema === "clinical-reference-personal-v1" || input.payload?.eventKind === "clinical-reference-personal";
  const declaresAnnualDate = input.payload?.schema === ANNUAL_DATE_SCHEMA || input.payload?.eventKind === "agenda-annual-date";
  if (declaresAnnualDate && (input.domain !== "agenda" || !isAnnualDatePayload(input.payload))) throw new Error("A data anual precisa de dia, mês e regras válidas no calendário.");
  if (declaresPersonalReference && (input.domain !== "conhecimento" || !isPersonalReferencePayload(input.payload))) throw new Error("A referência pessoal não atende aos limites de nome, observação ou fonte.");
  if (input.domain === "exames" || declaresLaboratory) {
    if (input.domain !== "exames" || !isLaboratoryPanelPayload(input.payload) || input.localDate !== input.payload.collectedOn) throw new Error("O exame precisa de painel válido e data de coleta explícita.");
    await verifyLaboratoryAttachments(input.payload);
  }
  const summary = input.summary.trim();
  if (!summary) {
    throw new Error("O registro precisa de um resumo para o histórico de alterações.");
  }
  if (
    input.payload === null ||
    typeof input.payload !== "object" ||
    Array.isArray(input.payload)
  ) {
    throw new Error("Os dados do registro precisam ser um objeto.");
  }

  const dataset = await getActiveDataset();
  const timestamp = input.occurredAtUTC ?? nowISO();
  const localDate = input.localDate ?? todayInTimeZone(APP_TIME_ZONE, new Date(timestamp));
  assertLocalDate(localDate);
  const entity: MentorEntity<"generic.event"> = {
    id: makeId("event"),
    datasetId: dataset.id,
    domain: input.domain,
    type: "generic.event",
    localDate,
    occurredAtUTC: timestamp,
    timezone: APP_TIME_ZONE,
    schemaVersion: 1,
    revision: 1,
    source: "manual",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    payload: { ...input.payload },
  };
  return commitEntity(entity, {
    kind: "create",
    reason: `${input.domain}_event_recorded`,
    summary,
  });
}

// Editor especializado: muda o mesmo painel e registra a revisão, sem burlar o editor genérico.
export async function updateLaboratoryPanel(input: { entityId: string; expectedRevision: number; payload: LaboratoryPanelPayload }): Promise<MentorEntity<"generic.event">> {
  if (!isLaboratoryPanelPayload(input.payload)) throw new Error("Painel laboratorial inválido.");
  await verifyLaboratoryAttachments(input.payload);
  const current = await getEntity(input.entityId, "generic.event");
  if (!current || current.domain !== "exames" || current.status !== "active" || !isLaboratoryPanelPayload(current.payload)) throw new Error("O painel não está disponível para edição.");
  const updated: MentorEntity<"generic.event"> = { ...current, payload: input.payload, localDate: input.payload.collectedOn, revision: current.revision + 1, updatedAt: nowISO() };
  return commitEntity(updated, { kind: "update", baseRevision: input.expectedRevision, reason: "laboratory_panel_corrected", summary: "Painel laboratorial corrigido pelo usuário; versão anterior preservada." });
}

// A recorrência muda por revisão, sem trocar a data de criação nem multiplicar eventos anuais.
export async function updateAnnualDate(input: { entityId: string; expectedRevision: number; payload: AnnualDatePayload }): Promise<MentorEntity<"generic.event">> {
  if (!isAnnualDatePayload(input.payload)) throw new Error("Data anual inválida.");
  const current = await getEntity(input.entityId, "generic.event");
  if (!current || current.domain !== "agenda" || current.status !== "active" || !isAnnualDatePayload(current.payload)) throw new Error("A data anual não está disponível para edição.");
  const updated: MentorEntity<"generic.event"> = { ...current, payload: input.payload, revision: current.revision + 1, updatedAt: nowISO() };
  return commitEntity(updated, { kind: "update", baseRevision: input.expectedRevision, reason: "annual_date_updated", summary: "Data anual atualizada pelo usuário; versão anterior preservada." });
}

function isKnowledge<T>(value: unknown): value is Knowledge<T> {
  return Boolean(
    value &&
      typeof value === "object" &&
      "state" in value &&
      typeof (value as { state?: unknown }).state === "string",
  );
}

function civilMilliseconds(value: LocalDateTime): number {
  assertLocalDateTime(value);
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes, seconds = 0] = time.split(":").map(Number);
  return Date.UTC(year, month - 1, day, hours, minutes, seconds);
}

function resolveClockForShift(
  shift: MentorEntity<"internato.shift">,
  field: ShiftTimeField,
  localTime: LocalTime,
): LocalDateTime {
  assertLocalTime(localTime);
  const { scheduledStartLocal, scheduledEndLocal } = shift.payload;
  assertLocalDateTime(scheduledStartLocal);
  assertLocalDateTime(scheduledEndLocal);
  if (field === "departureLocal") {
    return resolveShiftDepartureLocalDateTime(
      scheduledStartLocal,
      scheduledEndLocal,
      localTime,
    );
  }
  const startMilliseconds = civilMilliseconds(scheduledStartLocal);
  const endMilliseconds = civilMilliseconds(scheduledEndLocal);
  if (endMilliseconds < startMilliseconds) {
    throw new Error("O fim previsto da jornada não pode anteceder o início.");
  }

  const startDate = localDateFromDateTime(scheduledStartLocal);
  const endDate = localDateFromDateTime(scheduledEndLocal);
  const dates = [...new Set([startDate, endDate])];
  const anchor =
    field === "arrivalLocal"
      ? startMilliseconds
      : startMilliseconds + (endMilliseconds - startMilliseconds) / 2;
  const candidates = dates.map((date) => {
    const value = combineLocalDateAndTime(date, localTime);
    const milliseconds = civilMilliseconds(value);
    const outsideDistance =
      milliseconds < startMilliseconds
        ? startMilliseconds - milliseconds
        : milliseconds > endMilliseconds
          ? milliseconds - endMilliseconds
          : 0;
    return {
      value,
      outsideDistance,
      anchorDistance: Math.abs(milliseconds - anchor),
    };
  });

  candidates.sort((left, right) =>
    left.outsideDistance === right.outsideDistance
      ? left.anchorDistance - right.anchorDistance
      : left.outsideDistance - right.outsideDistance,
  );
  return candidates[0].value;
}

function normalizeShiftTimeUpdate(
  shift: MentorEntity<"internato.shift">,
  field: ShiftTimeField,
  value: ShiftTimeUpdateValue,
  timestamp: string,
): Knowledge<LocalDateTime> {
  if (isKnowledge<LocalDateTime>(value)) {
    if (value.state === "known") assertLocalDateTime(value.value);
    return value;
  }
  if (value.includes("T")) {
    assertLocalDateTime(value);
    return known(value, "user", timestamp);
  }
  return known(
    resolveClockForShift(shift, field, value as LocalTime),
    "user",
    timestamp,
  );
}

function assertShiftTimeline(payload: EntityPayloadByType["internato.shift"]): void {
  const knownValue = (value: Knowledge<LocalDateTime>): LocalDateTime | null =>
    value.state === "known" ? value.value : null;
  const arrival = knownValue(payload.arrivalLocal);
  const departure = knownValue(payload.departureLocal);
  const breakStart = knownValue(payload.breakStartLocal);
  const breakEnd = knownValue(payload.breakEndLocal);

  for (const value of [arrival, departure, breakStart, breakEnd]) {
    if (value) assertLocalDateTime(value);
  }
  if (arrival && departure && departure < arrival) {
    throw new Error("A saída não pode anteceder a chegada.");
  }
  if (
    departure &&
    compareLocalDateTimes(departure, payload.scheduledStartLocal) < 0
  ) {
    throw new Error("A saída não pode anteceder o início previsto da jornada.");
  }
  if (breakStart && breakEnd && breakEnd < breakStart) {
    throw new Error("O fim do intervalo não pode anteceder o início.");
  }
  if (arrival && breakStart && breakStart < arrival) {
    throw new Error("O intervalo não pode começar antes da chegada.");
  }
  if (departure && breakEnd && breakEnd > departure) {
    throw new Error("O intervalo não pode terminar depois da saída.");
  }
  if (departure && breakStart && breakStart > departure) {
    throw new Error("O intervalo não pode começar depois da saída.");
  }

  const hasRecordedTime = Boolean(arrival || departure || breakStart || breakEnd);
  if (
    hasRecordedTime &&
    payload.attendance.state === "known" &&
    payload.attendance.value !== "present"
  ) {
    throw new Error("Uma jornada com horários realizados precisa estar marcada como presente.");
  }
}

export async function createManualShift(
  input: CreateManualShiftInput,
): Promise<MentorEntity<"internato.shift">> {
  const timestamp = input.occurredAtUTC ?? nowISO();
  const payload = buildManualShiftPayload(input, timestamp);
  const dataset = await getActiveDataset();
  const entity: MentorEntity<"internato.shift"> = {
    id: makeId("shift"),
    datasetId: dataset.id,
    domain: "internato",
    type: "internato.shift",
    localDate: input.localDate,
    occurredAtUTC: timestamp,
    timezone: APP_TIME_ZONE,
    schemaVersion: 1,
    revision: 1,
    source: "manual",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    payload,
  };
  return commitEntity(entity, {
    kind: "create",
    reason: "manual_shift_created",
    summary: "Internato shift explicitly planned by the user.",
  });
}

export async function updateShift(
  input: UpdateShiftInput,
): Promise<MentorEntity<"internato.shift">> {
  const current = await getEntity(input.shiftId, "internato.shift");
  if (!current) {
    throw new Error("Jornada não encontrada.");
  }
  const timestamp = input.occurredAtUTC ?? nowISO();
  const timeFields: ShiftTimeField[] = [
    "arrivalLocal",
    "departureLocal",
    "breakStartLocal",
    "breakEndLocal",
  ];
  const changedTimeFields = timeFields.filter((field) => input[field] !== undefined);
  if (changedTimeFields.length === 0 && input.attendance === undefined) {
    throw new Error("Nenhuma alteração da jornada foi informada.");
  }

  const payload: EntityPayloadByType["internato.shift"] = { ...current.payload };
  for (const field of changedTimeFields) {
    payload[field] = normalizeShiftTimeUpdate(
      current,
      field,
      input[field] as ShiftTimeUpdateValue,
      timestamp,
    );
  }
  if (input.attendance !== undefined) {
    payload.attendance = isKnowledge<AttendanceStatus>(input.attendance)
      ? input.attendance
      : known(input.attendance, "user", timestamp);
  } else if (changedTimeFields.some((field) => payload[field].state === "known")) {
    payload.attendance = known("present", "user", timestamp);
  }
  assertShiftTimeline(payload);

  const updated: MentorEntity<"internato.shift"> = {
    ...current,
    source: "manual",
    revision: current.revision + 1,
    updatedAt: timestamp,
    payload,
  };
  const changedFields = [
    ...changedTimeFields,
    ...(input.attendance === undefined ? [] : ["attendance"]),
  ];
  return commitEntity(updated, {
    kind: "update",
    baseRevision: current.revision,
    reason: "shift_actuals_updated",
    summary: `Shift fields explicitly updated: ${changedFields.join(", ")}.`,
  });
}

export function recordArrival(
  input: RecordShiftTimeInput,
): Promise<MentorEntity<"internato.shift">> {
  assertLocalDateTime(input.localDateTime);
  return updateShift({
    shiftId: input.shiftId,
    arrivalLocal: input.localDateTime,
    ...(input.occurredAtUTC ? { occurredAtUTC: input.occurredAtUTC } : {}),
  });
}

export function recordDeparture(
  input: RecordShiftTimeInput,
): Promise<MentorEntity<"internato.shift">> {
  assertLocalDateTime(input.localDateTime);
  return updateShift({
    shiftId: input.shiftId,
    departureLocal: input.localDateTime,
    ...(input.occurredAtUTC ? { occurredAtUTC: input.occurredAtUTC } : {}),
  });
}

export function recordBreakStart(
  input: RecordShiftTimeInput,
): Promise<MentorEntity<"internato.shift">> {
  assertLocalDateTime(input.localDateTime);
  return updateShift({
    shiftId: input.shiftId,
    breakStartLocal: input.localDateTime.slice(11) as LocalTime,
    ...(input.occurredAtUTC ? { occurredAtUTC: input.occurredAtUTC } : {}),
  });
}

export function recordBreakEnd(
  input: RecordShiftTimeInput,
): Promise<MentorEntity<"internato.shift">> {
  assertLocalDateTime(input.localDateTime);
  return updateShift({
    shiftId: input.shiftId,
    breakEndLocal: input.localDateTime.slice(11) as LocalTime,
    ...(input.occurredAtUTC ? { occurredAtUTC: input.occurredAtUTC } : {}),
  });
}

export async function saveSetting<T>(key: string, value: T): Promise<SettingRecord<T>> {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    throw new Error("A configuração precisa ter uma chave.");
  }
  const dataset = await getActiveDataset();
  const timestamp = nowISO();
  const setting: SettingRecord<T> = {
    id: `${dataset.id}:${normalizedKey}`,
    datasetId: dataset.id,
    key: normalizedKey,
    value,
    updatedAt: timestamp,
  };
  const database = await openMentorDatabase();
  const transaction = database.transaction(
    ["app_meta", "datasets", "settings", "operations", "outbox"],
    "readwrite",
  );
  const transactionCompletion = observeTransactionCompletion(transaction);
  const storedDataset = await transaction.objectStore("datasets").get(dataset.id);
  const activeDatasetMeta = await transaction
    .objectStore("app_meta")
    .get("active_dataset_id");
  if (
    !storedDataset ||
    storedDataset.status !== "active" ||
    activeDatasetMeta?.value !== storedDataset.id
  ) {
    await abortTransactionSafely(transaction);
    throw new Error("O conjunto de dados ativo não foi encontrado.");
  }
  const sequence = storedDataset.nextOperationSequence + 1;
  await transaction.objectStore("settings").put(setting as SettingRecord);
  await transaction.objectStore("datasets").put({
    ...storedDataset,
    nextOperationSequence: sequence,
    settingsRevision: storedDataset.settingsRevision + 1,
    updatedAt: timestamp,
  });
  const operationId = makeId("operation");
  await transaction.objectStore("operations").add({
    id: operationId,
    datasetId: dataset.id,
    sequence,
    kind: "settings",
    status: "committed",
    summary: `Setting ${normalizedKey} updated.`,
    createdAt: timestamp,
  });
  await transaction.objectStore("outbox").add({
    id: makeId("outbox"),
    datasetId: dataset.id,
    operationId,
    state: "pending",
    createdAt: timestamp,
  });
  await assertObservedTransactionCompleted(transactionCompletion);
  return setting;
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const dataset = await getActiveDataset();
  const setting = await (await openMentorDatabase()).get(
    "settings",
    `${dataset.id}:${key}`,
  );
  return (setting?.value as T | undefined) ?? null;
}

export async function getAllSettings(): Promise<SettingRecord[]> {
  const dataset = await getActiveDataset();
  const settings = await (await openMentorDatabase()).getAllFromIndex(
    "settings",
    "by_dataset",
    dataset.id,
  );
  return settings.sort((left, right) => left.key.localeCompare(right.key));
}

export async function requestStoragePersistence(): Promise<StoragePersistenceResult> {
  await initializeMentorData();
  const requestResult = await requestPersistentStorage();
  return {
    requestResult,
    storage: await getStorageDurabilityStatus(),
  };
}

function deletionLocalDate(entity: MentorEntity): LocalDate | null {
  const instant = new Date(entity.updatedAt);
  if (Number.isNaN(instant.getTime())) return null;
  try {
    return todayInTimeZone(entity.timezone || APP_TIME_ZONE, instant);
  } catch {
    return todayInTimeZone(APP_TIME_ZONE, instant);
  }
}

function retainedDeletedEntity(
  entity: MentorEntity,
  historyWindow: InclusiveDateWindow,
  recoveryWindow: InclusiveDateWindow,
): boolean {
  if (entity.status !== "deleted") return false;
  const originalDateRetained =
    entity.localDate >= historyWindow.start && entity.localDate <= historyWindow.end;
  if (originalDateRetained) return true;
  const deletedOn = deletionLocalDate(entity);
  return Boolean(
    deletedOn && deletedOn >= recoveryWindow.start && deletedOn <= recoveryWindow.end,
  );
}

export async function getMentorWorkspace(
  requestedReferenceLocalDate?: LocalDate,
): Promise<MentorWorkspace> {
  await initializeMentorData();
  const dataset = await getActiveDataset();
  const referenceLocalDate = requestedReferenceLocalDate ?? todayInTimeZone();
  assertLocalDate(referenceLocalDate);
  const historyWindow = inclusiveDateWindow(
    referenceLocalDate,
    RETENTION_POLICY.rawHistoryDays,
  );
  const recoveryWindow = inclusiveDateWindow(
    referenceLocalDate,
    RETENTION_POLICY.minimumRecoverableDays,
  );
  const [statusCandidates, settings, storage] = await Promise.all([
    // Tombstones must remain recoverable for at least 60 civil days from the
    // deletion itself, even when their original event date has aged out of the
    // raw-history window (or belongs to a future plan).
    listEntities({ includeDeleted: true }),
    getAllSettings(),
    getStorageDurabilityStatus(),
  ]);

  return {
    referenceLocalDate,
    historyWindow,
    dataset,
    // Inclui planos futuros e definições antigas sem alargar a janela dos fatos observados.
    entities: selectOperationalWindow(statusCandidates, historyWindow.start),
    deletedEntities: statusCandidates.filter((entity) =>
      retainedDeletedEntity(entity, historyWindow, recoveryWindow),
    ),
    settings,
    retention: RETENTION_POLICY,
    storage,
  };
}

export async function getTodaySnapshot(
  requestedLocalDate?: LocalDate,
): Promise<TodaySnapshot> {
  await initializeMentorData();
  const activeDataset = await getActiveDataset();
  const localDate = requestedLocalDate ?? todayInTimeZone();
  assertLocalDate(localDate);
  const energyWindow = inclusiveDateWindow(localDate, RETENTION_POLICY.defaultAnalyticsDays);

  const [shifts, energyEvents, medicationEvents, financeAccounts, storage, lastBackup] =
    await Promise.all([
      listEntities({ type: "internato.shift", domain: "internato" }),
      listEntities({
        type: "humor.energy-check-in",
        domain: "humor",
        startLocalDate: energyWindow.start,
        endLocalDate: energyWindow.end,
      }),
      listEntities({
        type: "medicamentos.confirmation",
        domain: "medicamentos",
        startLocalDate: localDate,
        endLocalDate: localDate,
      }),
      listEntities({ type: "financas.account", domain: "financas" }),
      getStorageDurabilityStatus(),
      (await openMentorDatabase()).get("app_meta", "last_backup_created_at"),
    ]);

  const dayStart = `${localDate}T00:00:00`;
  const dayEnd = `${localDate}T23:59:59`;
  const sortedShifts = shifts.sort((left, right) =>
    left.payload.scheduledStartLocal.localeCompare(right.payload.scheduledStartLocal),
  );
  const currentShift =
    sortedShifts.find(
      (shift) =>
        shift.payload.scheduledStartLocal <= dayEnd &&
        shift.payload.scheduledEndLocal >= dayStart,
    ) ?? null;
  const nextShift =
    sortedShifts.find((shift) => {
      if (currentShift && shift.id === currentShift.id) return false;
      return shift.payload.scheduledStartLocal > dayEnd;
    }) ?? null;

  const latestEnergy =
    energyEvents
      .filter((entity) => entity.localDate === localDate)
      .sort((left, right) => right.occurredAtUTC.localeCompare(left.occurredAtUTC))[0] ??
    null;

  return {
    localDate,
    dataset: activeDataset,
    currentShift,
    nextShift,
    latestEnergy,
    medicationEvents,
    financeAccounts,
    energyMetric60Days: summarizeEnergy(energyEvents, localDate, 60),
    retention: RETENTION_POLICY,
    storage,
    lastBackupCreatedAt:
      typeof lastBackup?.value === "string" ? lastBackup.value : null,
  };
}

async function createCanonicalEntity<TType extends EntityType>(options: {
  idPrefix: string;
  domain: "agenda" | "financas";
  type: TType;
  localDate: LocalDate;
  timestamp: string;
  payload: EntityPayloadByType[TType];
  reason: string;
  summary: string;
}): Promise<MentorEntity<TType>> {
  assertLocalDate(options.localDate);
  const dataset = await getActiveDataset();
  const entity: MentorEntity<TType> = {
    id: makeId(options.idPrefix),
    datasetId: dataset.id,
    domain: options.domain,
    type: options.type,
    localDate: options.localDate,
    occurredAtUTC: options.timestamp,
    timezone: APP_TIME_ZONE,
    schemaVersion: 1,
    revision: 1,
    source: "manual",
    status: "active",
    createdAt: options.timestamp,
    updatedAt: options.timestamp,
    payload: options.payload,
  };
  return commitEntity(entity, {
    kind: "create",
    reason: options.reason,
    summary: options.summary,
  });
}

function optionalKnowledge<T>(
  value: T | undefined,
  timestamp: string,
  reason: "not_recorded" | "not_provided" = "not_provided",
): Knowledge<T> {
  return value === undefined
    ? unknown(reason)
    : known(value, "user", timestamp);
}

function optionalTextKnowledge(
  value: string | undefined,
  timestamp: string,
): Knowledge<string> {
  const normalized = value?.trim();
  return normalized
    ? known(normalized, "user", timestamp)
    : unknown("not_recorded");
}

function requireText(value: string, fieldLabel: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldLabel} precisa ser informado.`);
  }
  return normalized;
}

function explicitBufferKnowledge(
  value: number | null | undefined,
  timestamp: string,
): Knowledge<number> {
  if (value === undefined) return unknown("not_provided");
  if (value === null) return notApplicable("no_buffer_requested");
  assertBufferMinutes(value);
  return known(value, "user", timestamp);
}

function assertBufferMinutes(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("O buffer precisa ser informado em minutos inteiros não negativos.");
  }
}

interface AgendaTemporalInput {
  dueLocalDate?: LocalDate;
  dueLocalTime?: LocalTime;
  plannedStartLocal?: LocalDateTime;
  plannedEndLocal?: LocalDateTime;
  actualStartLocal?: LocalDateTime;
  actualEndLocal?: LocalDateTime;
  bufferBeforeMinutes?: number | null;
  bufferAfterMinutes?: number | null;
}

function assertAgendaTemporalInput(
  input: AgendaTemporalInput,
  requirePlannedInterval: boolean,
): void {
  if (input.dueLocalDate !== undefined) assertLocalDate(input.dueLocalDate);
  if (input.dueLocalTime !== undefined) {
    assertLocalTime(input.dueLocalTime);
    if (input.dueLocalDate === undefined) {
      throw new Error("Um horário de vencimento exige a data local correspondente.");
    }
  }
  for (const value of [
    input.plannedStartLocal,
    input.plannedEndLocal,
    input.actualStartLocal,
    input.actualEndLocal,
  ]) {
    if (value !== undefined) assertLocalDateTime(value);
  }
  if (
    requirePlannedInterval &&
    (input.plannedStartLocal === undefined || input.plannedEndLocal === undefined)
  ) {
    throw new Error("Um evento exige início e fim planejados explícitos.");
  }
  if (
    (input.plannedStartLocal === undefined) !==
    (input.plannedEndLocal === undefined)
  ) {
    throw new Error("O bloco planejado exige início e fim.");
  }
  if (
    input.plannedStartLocal !== undefined &&
    input.plannedEndLocal !== undefined &&
    compareLocalDateTimes(input.plannedEndLocal, input.plannedStartLocal) <= 0
  ) {
    throw new Error("O fim planejado precisa ser posterior ao início planejado.");
  }
  if (
    input.actualStartLocal !== undefined &&
    input.actualEndLocal !== undefined &&
    compareLocalDateTimes(input.actualEndLocal, input.actualStartLocal) < 0
  ) {
    throw new Error("O fim realizado não pode anteceder o início realizado.");
  }
  if (
    input.bufferBeforeMinutes !== undefined &&
    input.bufferBeforeMinutes !== null
  ) {
    assertBufferMinutes(input.bufferBeforeMinutes);
  }
  if (
    input.bufferAfterMinutes !== undefined &&
    input.bufferAfterMinutes !== null
  ) {
    assertBufferMinutes(input.bufferAfterMinutes);
  }
}

function agendaTruth(
  input: AgendaTemporalInput,
  timestamp: string,
): AgendaTemporalTruth & AgendaDueTruth & AgendaBufferTruth {
  return {
    dueLocalDate: optionalKnowledge(input.dueLocalDate, timestamp),
    dueLocalTime: optionalKnowledge(input.dueLocalTime, timestamp),
    plannedStartLocal: optionalKnowledge(input.plannedStartLocal, timestamp),
    plannedEndLocal: optionalKnowledge(input.plannedEndLocal, timestamp),
    actualStartLocal: optionalKnowledge(
      input.actualStartLocal,
      timestamp,
      "not_recorded",
    ),
    actualEndLocal: optionalKnowledge(
      input.actualEndLocal,
      timestamp,
      "not_recorded",
    ),
    bufferBeforeMinutes: explicitBufferKnowledge(
      input.bufferBeforeMinutes,
      timestamp,
    ),
    bufferAfterMinutes: explicitBufferKnowledge(
      input.bufferAfterMinutes,
      timestamp,
    ),
  };
}

function knownKnowledgeValue<T>(value: Knowledge<T>): T | undefined {
  return value.state === "known" ? value.value : undefined;
}

function assertOnlyKeys(
  value: object,
  allowedKeys: readonly string[],
  objectLabel: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new Error(`${objectLabel} contém campos não permitidos.`);
  }
}

function agendaBufferForCalculation(
  value: Knowledge<number>,
): number | null | undefined {
  if (value.state === "known") return value.value;
  if (value.state === "not_applicable" || value.state === "confirmed_absent") {
    return undefined;
  }
  return null;
}

function assertAgendaPayload(
  payload:
    | EntityPayloadByType["agenda.task"]
    | EntityPayloadByType["agenda.event"],
  type: "agenda.task" | "agenda.event",
): void {
  assertOnlyKeys(
    payload,
    [
      "title",
      "status",
      "priority",
      "dueLocalDate",
      "dueLocalTime",
      "plannedStartLocal",
      "plannedEndLocal",
      "actualStartLocal",
      "actualEndLocal",
      "bufferBeforeMinutes",
      "bufferAfterMinutes",
      "note",
      ...(type === "agenda.task" ? ["goalTier"] : []),
    ],
    "O item de agenda",
  );
  requireText(payload.title, "O título");
  if (!["low", "normal", "high", "urgent"].includes(payload.priority)) {
    throw new Error("Prioridade de agenda inválida.");
  }
  if (
    type === "agenda.task" &&
    ![
      "captured",
      "planned",
      "in_progress",
      "completed",
      "deferred",
      "cancelled",
    ].includes(payload.status)
  ) {
    throw new Error("Status de tarefa inválido.");
  }
  if (
    type === "agenda.event" &&
    ![
      "tentative",
      "confirmed",
      "in_progress",
      "completed",
      "cancelled",
    ].includes(payload.status)
  ) {
    throw new Error("Status de evento inválido.");
  }
  const dueLocalDate = knownKnowledgeValue(payload.dueLocalDate);
  const dueLocalTime = knownKnowledgeValue(payload.dueLocalTime);
  if (dueLocalDate !== undefined) assertLocalDate(dueLocalDate);
  if (dueLocalTime !== undefined) {
    assertLocalTime(dueLocalTime);
    if (dueLocalDate === undefined) {
      throw new Error("Um horário de vencimento exige a data local correspondente.");
    }
  }
  const plannedStart = knownKnowledgeValue(payload.plannedStartLocal);
  const plannedEnd = knownKnowledgeValue(payload.plannedEndLocal);
  const actualStart = knownKnowledgeValue(payload.actualStartLocal);
  const actualEnd = knownKnowledgeValue(payload.actualEndLocal);
  for (const value of [plannedStart, plannedEnd, actualStart, actualEnd]) {
    if (value !== undefined) assertLocalDateTime(value);
  }
  if (
    type === "agenda.event" &&
    (plannedStart === undefined || plannedEnd === undefined)
  ) {
    throw new Error("Um evento exige início e fim planejados explícitos.");
  }
  if ((plannedStart === undefined) !== (plannedEnd === undefined)) {
    throw new Error("O bloco planejado exige início e fim.");
  }
  if (
    plannedStart !== undefined &&
    plannedEnd !== undefined &&
    compareLocalDateTimes(plannedEnd, plannedStart) <= 0
  ) {
    throw new Error("O fim planejado precisa ser posterior ao início planejado.");
  }
  if (
    actualStart !== undefined &&
    actualEnd !== undefined &&
    compareLocalDateTimes(actualEnd, actualStart) < 0
  ) {
    throw new Error("O fim realizado não pode anteceder o início realizado.");
  }
  for (const buffer of [
    knownKnowledgeValue(payload.bufferBeforeMinutes),
    knownKnowledgeValue(payload.bufferAfterMinutes),
  ]) {
    if (buffer !== undefined) assertBufferMinutes(buffer);
  }
  if (type === "agenda.task") {
    const tier = knownKnowledgeValue(
      (payload as EntityPayloadByType["agenda.task"]).goalTier,
    );
    if (tier !== undefined && !["minimum", "good", "gold"].includes(tier)) {
      throw new Error("Nível de meta de agenda inválido.");
    }
  }
}

function agendaReferenceDate(
  payload:
    | EntityPayloadByType["agenda.task"]
    | EntityPayloadByType["agenda.event"],
  fallback: LocalDate,
  type: "agenda.task" | "agenda.event" = "agenda.task",
): LocalDate {
  const dueDate = knownKnowledgeValue(payload.dueLocalDate);
  const plannedDate = knownKnowledgeValue(payload.plannedStartLocal)?.slice(
    0,
    10,
  ) as LocalDate | undefined;
  return type === "agenda.event"
    ? plannedDate ?? dueDate ?? fallback
    : dueDate ?? plannedDate ?? fallback;
}

export async function createAgendaTask(
  input: CreateAgendaTaskInput,
): Promise<MentorEntity<"agenda.task">> {
  assertAgendaTemporalInput(input, false);
  const timestamp = input.occurredAtUTC ?? nowISO();
  const fallbackDate = todayInTimeZone(APP_TIME_ZONE, new Date(timestamp));
  const payload: EntityPayloadByType["agenda.task"] = {
    title: requireText(input.title, "O título"),
    status: input.status,
    priority: input.priority,
    goalTier: optionalKnowledge(input.goalTier, timestamp),
    note: optionalTextKnowledge(input.note, timestamp),
    ...agendaTruth(input, timestamp),
  };
  assertAgendaPayload(payload, "agenda.task");
  return createCanonicalEntity({
    idPrefix: "agenda-task",
    domain: "agenda",
    type: "agenda.task",
    localDate: agendaReferenceDate(payload, fallbackDate),
    timestamp,
    payload,
    reason: "agenda_task_created",
    summary: "Agenda task explicitly created by the user.",
  });
}

export async function createAgendaEvent(
  input: CreateAgendaEventInput,
): Promise<MentorEntity<"agenda.event">> {
  assertAgendaTemporalInput(input, true);
  const timestamp = input.occurredAtUTC ?? nowISO();
  const payload: EntityPayloadByType["agenda.event"] = {
    title: requireText(input.title, "O título"),
    status: input.status,
    priority: input.priority,
    note: optionalTextKnowledge(input.note, timestamp),
    ...agendaTruth(input, timestamp),
  };
  assertAgendaPayload(payload, "agenda.event");
  return createCanonicalEntity({
    idPrefix: "agenda-event",
    domain: "agenda",
    type: "agenda.event",
    localDate: localDateFromDateTime(input.plannedStartLocal),
    timestamp,
    payload,
    reason: "agenda_event_created",
    summary: "Agenda event explicitly created by the user.",
  });
}

export function quickCaptureAgenda(
  input: QuickCaptureAgendaInput,
): Promise<MentorEntity<"agenda.task"> | MentorEntity<"agenda.event">> {
  if (input.kind === "event") {
    return createAgendaEvent({
      title: input.title,
      priority: input.priority ?? "normal",
      status: "tentative",
      plannedStartLocal: input.plannedStartLocal,
      plannedEndLocal: input.plannedEndLocal,
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.occurredAtUTC === undefined
        ? {}
        : { occurredAtUTC: input.occurredAtUTC }),
    });
  }
  return createAgendaTask({
    title: input.title,
    priority: input.priority ?? "normal",
    status: "captured",
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.occurredAtUTC === undefined
      ? {}
      : { occurredAtUTC: input.occurredAtUTC }),
  });
}

export async function createAgendaGoalSet(
  input: CreateAgendaGoalSetInput,
): Promise<MentorEntity<"agenda.goal-set">> {
  assertLocalDate(input.appliesToLocalDate);
  const timestamp = input.occurredAtUTC ?? nowISO();
  const payload: EntityPayloadByType["agenda.goal-set"] = {
    appliesToLocalDate: input.appliesToLocalDate,
    minimum: requireText(input.minimum, "A meta mínima"),
    good: requireText(input.good, "A meta boa"),
    gold: requireText(input.gold, "A meta ouro"),
    note: optionalTextKnowledge(input.note, timestamp),
  };
  return createCanonicalEntity({
    idPrefix: "agenda-goals",
    domain: "agenda",
    type: "agenda.goal-set",
    localDate: input.appliesToLocalDate,
    timestamp,
    payload,
    reason: "agenda_goal_set_created",
    summary: "Agenda minimum, good, and gold goals explicitly created by the user.",
  });
}

async function updateAgendaEntity<
  TType extends "agenda.task" | "agenda.event",
>(options: {
  type: TType;
  entityId: string;
  expectedRevision: number;
  patch: Partial<EntityPayloadByType[TType]>;
  occurredAtUTC?: string;
}): Promise<MentorEntity<TType>> {
  if (Object.keys(options.patch).length === 0) {
    throw new Error("Nenhuma alteração da agenda foi informada.");
  }
  const current = await getEntity(options.entityId, options.type);
  if (!current) throw new Error("Item de agenda não encontrado.");
  const activeDataset = await getActiveDataset();
  if (current.datasetId !== activeDataset.id) {
    throw new Error("O item de agenda não pertence ao conjunto de dados ativo.");
  }
  if (current.revision !== options.expectedRevision) {
    throw new Error("O item mudou em outra operação. Atualize a tela antes de tentar de novo.");
  }
  const timestamp = options.occurredAtUTC ?? nowISO();
  const createdLocalDate = todayInTimeZone(
    APP_TIME_ZONE,
    new Date(current.createdAt),
  );
  const payload = {
    ...current.payload,
    ...options.patch,
  } as EntityPayloadByType[TType];
  assertAgendaPayload(
    payload as
      | EntityPayloadByType["agenda.task"]
      | EntityPayloadByType["agenda.event"],
    options.type,
  );
  const updated: MentorEntity<TType> = {
    ...current,
    localDate: agendaReferenceDate(
      payload as
        | EntityPayloadByType["agenda.task"]
        | EntityPayloadByType["agenda.event"],
      createdLocalDate,
      options.type,
    ),
    revision: current.revision + 1,
    source: "manual",
    updatedAt: timestamp,
    payload,
  };
  return commitEntity(updated, {
    kind: "update",
    baseRevision: current.revision,
    reason: "agenda_item_updated",
    summary: "Agenda item explicitly updated by the user.",
  });
}

export function updateAgendaItem(
  input: UpdateAgendaItemInput,
): Promise<MentorEntity<"agenda.task"> | MentorEntity<"agenda.event">> {
  if (input.type === "agenda.task") {
    return updateAgendaEntity({
      type: input.type,
      entityId: input.entityId,
      expectedRevision: input.expectedRevision,
      patch: input.patch,
      ...(input.occurredAtUTC === undefined
        ? {}
        : { occurredAtUTC: input.occurredAtUTC }),
    });
  }
  return updateAgendaEntity({
    type: input.type,
    entityId: input.entityId,
    expectedRevision: input.expectedRevision,
    patch: input.patch,
    ...(input.occurredAtUTC === undefined
      ? {}
      : { occurredAtUTC: input.occurredAtUTC }),
  });
}

export type AgendaItemEntity =
  | MentorEntity<"agenda.task">
  | MentorEntity<"agenda.event">;

export interface AgendaWindowResult {
  window: InclusiveDateWindow;
  items: AgendaItemEntity[];
  goalSets: Array<MentorEntity<"agenda.goal-set">>;
  blockingShifts: Array<MentorEntity<"internato.shift">>;
  conflicts: AgendaConflict[];
}

function isAgendaItemEntity(entity: MentorEntity): entity is AgendaItemEntity {
  return entity.type === "agenda.task" || entity.type === "agenda.event";
}

function agendaItemInWindow(
  entity: AgendaItemEntity,
  window: InclusiveDateWindow,
  includeUnscheduled: boolean,
): boolean {
  const dueDate = knownKnowledgeValue(entity.payload.dueLocalDate);
  const plannedStart = knownKnowledgeValue(entity.payload.plannedStartLocal);
  const plannedEnd = knownKnowledgeValue(entity.payload.plannedEndLocal);
  if (dueDate && dueDate >= window.start && dueDate <= window.end) return true;
  if (plannedStart && plannedEnd) {
    const windowStart = `${window.start}T00:00:00`;
    const windowEnd = `${window.end}T23:59:59`;
    if (plannedStart <= windowEnd && plannedEnd >= windowStart) return true;
  }
  return includeUnscheduled && !dueDate && !plannedStart;
}

function agendaItemSortKey(entity: AgendaItemEntity): string {
  const plannedStart = knownKnowledgeValue(entity.payload.plannedStartLocal);
  const dueDate = knownKnowledgeValue(entity.payload.dueLocalDate);
  const dueTime = knownKnowledgeValue(entity.payload.dueLocalTime);
  const candidates = [
    plannedStart,
    // `~` is only a stable sort marker. It does not manufacture a due time.
    dueDate ? `${dueDate}T${dueTime ?? "~"}` : undefined,
  ].filter((value): value is string => value !== undefined);
  return candidates.sort()[0] ?? `${entity.localDate}T~`;
}

export async function listAgendaWindow(
  query: AgendaWindowQuery,
): Promise<AgendaWindowResult> {
  assertLocalDate(query.startLocalDate);
  const window = forwardAgendaWindow(query.startLocalDate, query.days);
  const [allAgendaEntities, allShifts] = await Promise.all([
    listEntities({ domain: "agenda" }),
    listEntities({ domain: "internato", type: "internato.shift" }),
  ]);
  const items = allAgendaEntities
    .filter(isAgendaItemEntity)
    .filter((entity) =>
      agendaItemInWindow(entity, window, query.includeUnscheduled ?? false),
    )
    .sort((left, right) => {
      const comparison = agendaItemSortKey(left).localeCompare(agendaItemSortKey(right));
      return comparison === 0 ? left.id.localeCompare(right.id) : comparison;
    });
  const goalSetCandidates = allAgendaEntities
    .filter(
      (entity): entity is MentorEntity<"agenda.goal-set"> =>
        entity.type === "agenda.goal-set",
    )
    .filter(
      (entity) =>
        entity.payload.appliesToLocalDate >= window.start &&
        entity.payload.appliesToLocalDate <= window.end,
    );
  const latestGoalSetByDate = new Map<LocalDate, MentorEntity<"agenda.goal-set">>();
  for (const candidate of goalSetCandidates) {
    const date = candidate.payload.appliesToLocalDate;
    const current = latestGoalSetByDate.get(date);
    if (
      !current ||
      candidate.updatedAt > current.updatedAt ||
      (candidate.updatedAt === current.updatedAt && candidate.id > current.id)
    ) {
      latestGoalSetByDate.set(date, candidate);
    }
  }
  const goalSets = [...latestGoalSetByDate.values()].sort((left, right) =>
    left.payload.appliesToLocalDate.localeCompare(right.payload.appliesToLocalDate),
  );
  const windowStartLocal = `${window.start}T00:00:00`;
  const windowEndLocal = `${window.end}T23:59:59`;
  const blockingShifts = allShifts.filter(
    (shift) => {
      const attendance = knownKnowledgeValue(shift.payload.attendance);
      const explicitlyNotAttending =
        attendance !== undefined && attendance !== "present";
      return (
        !explicitlyNotAttending &&
        shift.payload.scheduledStartLocal <= windowEndLocal &&
        shift.payload.scheduledEndLocal >= windowStartLocal
      );
    },
  );
  const agendaIntervals = items.flatMap((entity) => {
    const plannedStartLocal = knownKnowledgeValue(entity.payload.plannedStartLocal);
    const plannedEndLocal = knownKnowledgeValue(entity.payload.plannedEndLocal);
    if (!plannedStartLocal || !plannedEndLocal) return [];
    if (
      plannedStartLocal > windowEndLocal ||
      plannedEndLocal < windowStartLocal
    ) {
      return [];
    }
    const bufferBeforeMinutes = agendaBufferForCalculation(
      entity.payload.bufferBeforeMinutes,
    );
    const bufferAfterMinutes = agendaBufferForCalculation(
      entity.payload.bufferAfterMinutes,
    );
    return [{
      id: entity.id,
      plannedStartLocal,
      plannedEndLocal,
      ...(bufferBeforeMinutes === undefined ? {} : { bufferBeforeMinutes }),
      ...(bufferAfterMinutes === undefined ? {} : { bufferAfterMinutes }),
      status: entity.payload.status,
    }];
  });
  const shiftIntervals = blockingShifts.map((shift) => ({
    id: shift.id,
    plannedStartLocal: shift.payload.scheduledStartLocal,
    plannedEndLocal: shift.payload.scheduledEndLocal,
    // Shift buffers are not present in the shift schema, so they remain
    // unknown rather than being treated as zero.
    bufferBeforeMinutes: null,
    bufferAfterMinutes: null,
  }));

  return {
    window,
    items,
    goalSets,
    blockingShifts,
    conflicts: calculateAgendaConflicts([
      ...agendaIntervals,
      ...shiftIntervals,
    ]),
  };
}

function assertBRLMoneyValue(
  value: { amountMinor: number; currency: string },
  fieldLabel: string,
): void {
  assertOnlyKeys(value, ["amountMinor", "currency"], fieldLabel);
  if (value.currency !== "BRL") {
    throw new Error(`${fieldLabel} precisa usar a moeda BRL.`);
  }
  asBRLMinorUnits(value.amountMinor);
  if (value.amountMinor < 0) {
    throw new Error(`${fieldLabel} não pode ser negativo.`);
  }
}

function financeMoneyKnowledge(
  value: BRLMinorUnits | undefined,
  timestamp: string,
): Knowledge<ReturnType<typeof brlMoney>> {
  if (value === undefined) return unknown("not_provided");
  asBRLMinorUnits(value);
  if (value < 0) throw new Error("O valor financeiro informado não pode ser negativo.");
  return known(brlMoney(value), "user", timestamp);
}

function financeAccountBalanceKnowledge(
  value: BRLMinorUnits | null,
  timestamp: string,
): Knowledge<ReturnType<typeof brlMoney>> {
  if (value === null) return unknown("not_provided");
  asBRLMinorUnits(value);
  return known(brlMoney(value), "user", timestamp);
}

function assertKnownDate(
  value: Knowledge<LocalDate>,
  fieldLabel: string,
): void {
  const date = knownKnowledgeValue(value);
  if (date === undefined) return;
  try {
    assertLocalDate(date);
  } catch {
    throw new Error(`${fieldLabel} contém uma data local inválida.`);
  }
}

function assertKnownMoney(
  value: Knowledge<ReturnType<typeof brlMoney>>,
  fieldLabel: string,
): void {
  const money = knownKnowledgeValue(value);
  if (money !== undefined) assertBRLMoneyValue(money, fieldLabel);
}

function assertKnownNonNegativeInteger(
  value: Knowledge<number>,
  fieldLabel: string,
): void {
  const integer = knownKnowledgeValue(value);
  if (integer === undefined) return;
  if (!Number.isSafeInteger(integer) || integer < 0) {
    throw new Error(`${fieldLabel} precisa ser um inteiro não negativo.`);
  }
}

function assertFinancePayload<TType extends FinanceEntityType>(
  type: TType,
  payload: EntityPayloadByType[TType],
): void {
  if (!isBackupEntityPayloadCandidate(type, payload)) {
    throw new Error(
      "O registro financeiro contém campos ou estados fora do contrato seguro.",
    );
  }
  assertFinanceProvider(payload.provider);
  switch (type) {
    case "financas.transaction": {
      const transaction = payload as EntityPayloadByType["financas.transaction"];
      assertOnlyKeys(transaction, [
        "provider",
        "direction",
        "amount",
        "transactionDate",
        "settledDate",
        "status",
        "category",
        "description",
      ], "A transação");
      assertBRLMoneyValue(transaction.amount, "O valor da transação");
      assertLocalDate(transaction.transactionDate);
      assertKnownDate(transaction.settledDate, "A data de liquidação");
      if (!["income", "expense"].includes(transaction.direction)) {
        throw new Error("A transação precisa ser uma entrada ou saída.");
      }
      if (!["pending", "posted", "voided"].includes(transaction.status)) {
        throw new Error("Status de transação inválido.");
      }
      return;
    }
    case "financas.bill": {
      const bill = payload as EntityPayloadByType["financas.bill"];
      assertOnlyKeys(bill, [
        "provider",
        "label",
        "amount",
        "dueDate",
        "paidDate",
        "interestCharged",
        "status",
        "note",
      ], "A conta");
      requireText(bill.label, "A descrição da conta");
      assertKnownMoney(bill.amount, "O valor da conta");
      assertKnownDate(bill.dueDate, "A data de vencimento");
      assertKnownDate(bill.paidDate, "A data de pagamento");
      assertKnownMoney(bill.interestCharged, "Os juros cobrados");
      if (!["scheduled", "due", "paid", "overdue", "cancelled"].includes(bill.status)) {
        throw new Error("Status de conta inválido.");
      }
      return;
    }
    case "financas.debt": {
      const debt = payload as EntityPayloadByType["financas.debt"];
      assertOnlyKeys(debt, [
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
      ], "A dívida");
      requireText(debt.label, "A descrição da dívida");
      assertKnownMoney(debt.originalPrincipal, "O principal original");
      assertKnownMoney(debt.outstandingBalance, "O saldo devedor");
      assertKnownMoney(debt.interestCharged, "Os juros cobrados");
      assertKnownDate(debt.balanceAsOfLocalDate, "A data do saldo devedor");
      assertKnownDate(debt.dueDate, "A data de vencimento");
      const apr = knownKnowledgeValue(debt.annualPercentageRateBps);
      if (apr !== undefined) asAnnualPercentageRateBps(apr);
      if (!["active", "paid", "paused", "defaulted", "disputed"].includes(debt.status)) {
        throw new Error("Status de dívida inválido.");
      }
      return;
    }
    case "financas.budget": {
      const budget = payload as EntityPayloadByType["financas.budget"];
      assertOnlyKeys(budget, [
        "provider",
        "label",
        "limit",
        "spentAmount",
        "periodStartLocalDate",
        "periodEndLocalDate",
        "status",
        "note",
      ], "O orçamento");
      requireText(budget.label, "A descrição do orçamento");
      assertBRLMoneyValue(budget.limit, "O limite do orçamento");
      assertKnownMoney(budget.spentAmount, "O valor gasto");
      assertLocalDate(budget.periodStartLocalDate);
      assertLocalDate(budget.periodEndLocalDate);
      if (budget.periodEndLocalDate < budget.periodStartLocalDate) {
        throw new Error("O fim do orçamento não pode anteceder o início.");
      }
      if (!["active", "paused", "closed"].includes(budget.status)) {
        throw new Error("Status de orçamento inválido.");
      }
      return;
    }
    case "financas.goal": {
      const goal = payload as EntityPayloadByType["financas.goal"];
      assertOnlyKeys(goal, [
        "provider",
        "label",
        "targetAmount",
        "accumulatedAmount",
        "targetDate",
        "status",
        "note",
      ], "A meta financeira");
      requireText(goal.label, "A descrição da meta financeira");
      assertBRLMoneyValue(goal.targetAmount, "O valor-alvo");
      assertKnownMoney(goal.accumulatedAmount, "O valor acumulado");
      assertKnownDate(goal.targetDate, "A data-alvo");
      if (!["active", "achieved", "paused", "cancelled"].includes(goal.status)) {
        throw new Error("Status de meta financeira inválido.");
      }
      return;
    }
    case "financas.card": {
      const card = payload as EntityPayloadByType["financas.card"];
      assertOnlyKeys(card, [
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
      ], "O cartão");
      requireText(card.label, "O apelido do cartão");
      assertKnownDate(card.closingDate, "A data de fechamento");
      assertKnownDate(card.dueDate, "A data de vencimento");
      assertKnownMoney(card.statedCreditLimit, "O limite informado");
      assertKnownMoney(card.currentBalance, "O saldo atual do cartão");
      assertKnownMoney(card.currentStatementAmount, "A fatura atual");
      assertKnownMoney(card.minimumPayment, "O pagamento mínimo");
      assertKnownDate(card.balanceAsOfLocalDate, "A data do retrato do cartão");
      const apr = knownKnowledgeValue(card.annualPercentageRateBps);
      if (apr !== undefined) asAnnualPercentageRateBps(apr);
      if (!Array.isArray(card.installments) || card.installments.length > 120) {
        throw new Error("O cartão aceita no máximo 120 compras parceladas por retrato.");
      }
      const ids = new Set<string>();
      for (const installment of card.installments) {
        assertOnlyKeys(installment, [
          "id",
          "label",
          "purchaseTotal",
          "installmentAmount",
          "totalInstallments",
          "remainingInstallments",
          "nextDueDate",
          "finalDueDate",
        ], "A compra parcelada");
        requireText(installment.id, "O identificador da compra parcelada");
        requireText(installment.label, "A descrição da compra parcelada");
        if (ids.has(installment.id)) {
          throw new Error("Compras parceladas não podem repetir identificadores.");
        }
        ids.add(installment.id);
        assertKnownMoney(installment.purchaseTotal, "O valor total da compra");
        assertKnownMoney(installment.installmentAmount, "O valor da parcela");
        assertKnownNonNegativeInteger(installment.totalInstallments, "O total de parcelas");
        assertKnownNonNegativeInteger(installment.remainingInstallments, "As parcelas restantes");
        const total = knownKnowledgeValue(installment.totalInstallments);
        const remaining = knownKnowledgeValue(installment.remainingInstallments);
        if (total !== undefined && total < 1) {
          throw new Error("O total de parcelas precisa ser pelo menos 1.");
        }
        if (total !== undefined && remaining !== undefined && remaining > total) {
          throw new Error("As parcelas restantes não podem superar o total de parcelas.");
        }
        assertKnownDate(installment.nextDueDate, "O próximo vencimento da parcela");
        assertKnownDate(installment.finalDueDate, "O último vencimento da parcela");
        const nextDue = knownKnowledgeValue(installment.nextDueDate);
        const finalDue = knownKnowledgeValue(installment.finalDueDate);
        if (nextDue !== undefined && finalDue !== undefined && finalDue < nextDue) {
          throw new Error("O último vencimento não pode anteceder o próximo.");
        }
      }
      const closingDate = knownKnowledgeValue(card.closingDate);
      const dueDate = knownKnowledgeValue(card.dueDate);
      if (closingDate !== undefined && dueDate !== undefined && dueDate < closingDate) {
        throw new Error("O vencimento não pode anteceder o fechamento informado.");
      }
      if (!["active", "paused", "closed"].includes(card.status)) {
        throw new Error("Status de cartão inválido.");
      }
      return;
    }
  }
}

function financeReferenceDate<TType extends FinanceEntityType>(
  type: TType,
  payload: EntityPayloadByType[TType],
  fallback: LocalDate,
): LocalDate {
  switch (type) {
    case "financas.transaction":
      return (payload as EntityPayloadByType["financas.transaction"])
        .transactionDate;
    case "financas.bill": {
      const bill = payload as EntityPayloadByType["financas.bill"];
      return (
        knownKnowledgeValue(bill.dueDate) ??
        knownKnowledgeValue(bill.paidDate) ??
        fallback
      );
    }
    case "financas.debt": {
      const debt = payload as EntityPayloadByType["financas.debt"];
      return (
        knownKnowledgeValue(debt.balanceAsOfLocalDate) ??
        knownKnowledgeValue(debt.dueDate) ??
        fallback
      );
    }
    case "financas.budget":
      return (payload as EntityPayloadByType["financas.budget"])
        .periodStartLocalDate;
    case "financas.goal":
      return (
        knownKnowledgeValue(
          (payload as EntityPayloadByType["financas.goal"]).targetDate,
        ) ?? fallback
      );
    case "financas.card": {
      const card = payload as EntityPayloadByType["financas.card"];
      return (
        knownKnowledgeValue(card.dueDate) ??
        knownKnowledgeValue(card.closingDate) ??
        knownKnowledgeValue(card.balanceAsOfLocalDate) ??
        fallback
      );
    }
  }
}

export async function createFinanceTransaction(
  input: CreateFinanceTransactionInput,
): Promise<MentorEntity<"financas.transaction">> {
  assertFinanceProvider(input.provider);
  assertLocalDate(input.transactionDate);
  if (input.settledDate !== undefined) assertLocalDate(input.settledDate);
  asBRLMinorUnits(input.amountMinor);
  if (input.amountMinor < 0) throw new Error("O valor da transação não pode ser negativo.");
  const timestamp = input.occurredAtUTC ?? nowISO();
  const payload: EntityPayloadByType["financas.transaction"] = {
    provider: input.provider,
    direction: input.direction,
    amount: brlMoney(input.amountMinor),
    transactionDate: input.transactionDate,
    settledDate: optionalKnowledge(input.settledDate, timestamp, "not_recorded"),
    status: input.status,
    category: optionalTextKnowledge(input.category, timestamp),
    description: optionalTextKnowledge(input.description, timestamp),
  };
  assertFinancePayload("financas.transaction", payload);
  return createCanonicalEntity({
    idPrefix: "finance-transaction",
    domain: "financas",
    type: "financas.transaction",
    localDate: input.transactionDate,
    timestamp,
    payload,
    reason: "finance_transaction_created",
    summary: "Finance transaction explicitly recorded by the user.",
  });
}

export async function createFinanceBill(
  input: CreateFinanceBillInput,
): Promise<MentorEntity<"financas.bill">> {
  assertFinanceProvider(input.provider);
  if (input.dueDate !== undefined) assertLocalDate(input.dueDate);
  if (input.paidDate !== undefined) assertLocalDate(input.paidDate);
  const timestamp = input.occurredAtUTC ?? nowISO();
  const fallback = todayInTimeZone(APP_TIME_ZONE, new Date(timestamp));
  const payload: EntityPayloadByType["financas.bill"] = {
    provider: input.provider,
    label: requireText(input.label, "A descrição da conta"),
    amount: financeMoneyKnowledge(input.amountMinor, timestamp),
    dueDate: optionalKnowledge(input.dueDate, timestamp),
    paidDate: optionalKnowledge(input.paidDate, timestamp, "not_recorded"),
    interestCharged: financeMoneyKnowledge(
      input.interestChargedMinor,
      timestamp,
    ),
    status: input.status,
    note: optionalTextKnowledge(input.note, timestamp),
  };
  assertFinancePayload("financas.bill", payload);
  return createCanonicalEntity({
    idPrefix: "finance-bill",
    domain: "financas",
    type: "financas.bill",
    localDate: financeReferenceDate("financas.bill", payload, fallback),
    timestamp,
    payload,
    reason: "finance_bill_created",
    summary: "Finance bill explicitly recorded by the user.",
  });
}

export async function createFinanceDebt(
  input: CreateFinanceDebtInput,
): Promise<MentorEntity<"financas.debt">> {
  assertFinanceProvider(input.provider);
  if (input.balanceAsOfLocalDate !== undefined) {
    assertLocalDate(input.balanceAsOfLocalDate);
  }
  if (input.dueDate !== undefined) assertLocalDate(input.dueDate);
  if (input.annualPercentageRateBps !== undefined) {
    asAnnualPercentageRateBps(input.annualPercentageRateBps);
  }
  const timestamp = input.occurredAtUTC ?? nowISO();
  const fallback = todayInTimeZone(APP_TIME_ZONE, new Date(timestamp));
  const payload: EntityPayloadByType["financas.debt"] = {
    provider: input.provider,
    label: requireText(input.label, "A descrição da dívida"),
    originalPrincipal: financeMoneyKnowledge(
      input.originalPrincipalMinor,
      timestamp,
    ),
    outstandingBalance: financeMoneyKnowledge(
      input.outstandingBalanceMinor,
      timestamp,
    ),
    annualPercentageRateBps: optionalKnowledge(
      input.annualPercentageRateBps,
      timestamp,
    ),
    interestCharged: financeMoneyKnowledge(
      input.interestChargedMinor,
      timestamp,
    ),
    balanceAsOfLocalDate: optionalKnowledge(
      input.balanceAsOfLocalDate,
      timestamp,
    ),
    dueDate: optionalKnowledge(input.dueDate, timestamp),
    status: input.status,
    note: optionalTextKnowledge(input.note, timestamp),
  };
  assertFinancePayload("financas.debt", payload);
  return createCanonicalEntity({
    idPrefix: "finance-debt",
    domain: "financas",
    type: "financas.debt",
    localDate: financeReferenceDate("financas.debt", payload, fallback),
    timestamp,
    payload,
    reason: "finance_debt_created",
    summary: "Finance debt explicitly recorded by the user.",
  });
}

export async function createFinanceCard(
  input: CreateFinanceCardInput,
): Promise<MentorEntity<"financas.card">> {
  assertFinanceProvider(input.provider);
  for (const date of [
    input.closingDate,
    input.dueDate,
    input.balanceAsOfLocalDate,
  ]) {
    if (date !== undefined) assertLocalDate(date);
  }
  if (input.annualPercentageRateBps !== undefined) {
    asAnnualPercentageRateBps(input.annualPercentageRateBps);
  }
  const timestamp = input.occurredAtUTC ?? nowISO();
  const fallback = todayInTimeZone(APP_TIME_ZONE, new Date(timestamp));
  const installments = (input.installments ?? []).map((installment) => {
    if (installment.nextDueDate !== undefined) assertLocalDate(installment.nextDueDate);
    if (installment.finalDueDate !== undefined) assertLocalDate(installment.finalDueDate);
    return {
      id: installment.id?.trim() || makeId("card-installment"),
      label: requireText(installment.label, "A descrição da compra parcelada"),
      purchaseTotal: financeMoneyKnowledge(installment.purchaseTotalMinor, timestamp),
      installmentAmount: financeMoneyKnowledge(installment.installmentAmountMinor, timestamp),
      totalInstallments: optionalKnowledge(installment.totalInstallments, timestamp),
      remainingInstallments: optionalKnowledge(installment.remainingInstallments, timestamp),
      nextDueDate: optionalKnowledge(installment.nextDueDate, timestamp),
      finalDueDate: optionalKnowledge(installment.finalDueDate, timestamp),
    };
  });
  const payload: EntityPayloadByType["financas.card"] = {
    provider: input.provider,
    label: requireText(input.label, "O apelido do cartão"),
    closingDate: optionalKnowledge(input.closingDate, timestamp),
    dueDate: optionalKnowledge(input.dueDate, timestamp),
    statedCreditLimit: financeMoneyKnowledge(input.statedCreditLimitMinor, timestamp),
    currentBalance: financeMoneyKnowledge(input.currentBalanceMinor, timestamp),
    currentStatementAmount: financeMoneyKnowledge(input.currentStatementAmountMinor, timestamp),
    minimumPayment: financeMoneyKnowledge(input.minimumPaymentMinor, timestamp),
    annualPercentageRateBps: optionalKnowledge(input.annualPercentageRateBps, timestamp),
    balanceAsOfLocalDate: optionalKnowledge(input.balanceAsOfLocalDate, timestamp),
    installments,
    status: input.status,
    note: optionalTextKnowledge(input.note, timestamp),
  };
  assertFinancePayload("financas.card", payload);
  return createCanonicalEntity({
    idPrefix: "finance-card",
    domain: "financas",
    type: "financas.card",
    localDate: financeReferenceDate("financas.card", payload, fallback),
    timestamp,
    payload,
    reason: "finance_card_created",
    summary: "Credit card snapshot explicitly recorded by the user without credentials.",
  });
}

export async function createFinanceBudget(
  input: CreateFinanceBudgetInput,
): Promise<MentorEntity<"financas.budget">> {
  assertFinanceProvider(input.provider);
  assertLocalDate(input.periodStartLocalDate);
  assertLocalDate(input.periodEndLocalDate);
  asBRLMinorUnits(input.limitMinor);
  if (input.limitMinor < 0) throw new Error("O limite do orçamento não pode ser negativo.");
  const timestamp = input.occurredAtUTC ?? nowISO();
  const payload: EntityPayloadByType["financas.budget"] = {
    provider: input.provider,
    label: requireText(input.label, "A descrição do orçamento"),
    limit: brlMoney(input.limitMinor),
    spentAmount: financeMoneyKnowledge(input.spentAmountMinor, timestamp),
    periodStartLocalDate: input.periodStartLocalDate,
    periodEndLocalDate: input.periodEndLocalDate,
    status: input.status,
    note: optionalTextKnowledge(input.note, timestamp),
  };
  assertFinancePayload("financas.budget", payload);
  return createCanonicalEntity({
    idPrefix: "finance-budget",
    domain: "financas",
    type: "financas.budget",
    localDate: input.periodStartLocalDate,
    timestamp,
    payload,
    reason: "finance_budget_created",
    summary: "Finance budget explicitly recorded by the user.",
  });
}

export async function createFinanceGoal(
  input: CreateFinanceGoalInput,
): Promise<MentorEntity<"financas.goal">> {
  assertFinanceProvider(input.provider);
  if (input.targetDate !== undefined) assertLocalDate(input.targetDate);
  asBRLMinorUnits(input.targetAmountMinor);
  if (input.targetAmountMinor < 0) throw new Error("O valor-alvo não pode ser negativo.");
  const timestamp = input.occurredAtUTC ?? nowISO();
  const fallback = todayInTimeZone(APP_TIME_ZONE, new Date(timestamp));
  const payload: EntityPayloadByType["financas.goal"] = {
    provider: input.provider,
    label: requireText(input.label, "A descrição da meta financeira"),
    targetAmount: brlMoney(input.targetAmountMinor),
    accumulatedAmount: financeMoneyKnowledge(
      input.accumulatedAmountMinor,
      timestamp,
    ),
    targetDate: optionalKnowledge(input.targetDate, timestamp),
    status: input.status,
    note: optionalTextKnowledge(input.note, timestamp),
  };
  assertFinancePayload("financas.goal", payload);
  return createCanonicalEntity({
    idPrefix: "finance-goal",
    domain: "financas",
    type: "financas.goal",
    localDate: financeReferenceDate("financas.goal", payload, fallback),
    timestamp,
    payload,
    reason: "finance_goal_created",
    summary: "Finance goal explicitly recorded by the user.",
  });
}

/**
 * Updates the deterministic provider account in place. The public input has
 * no credential, PAN, token or account-number field, and the persisted shape
 * is reconstructed from an allowlist so an update cannot carry unknown keys
 * forward.
 */
export async function updateFinanceAccount(
  input: UpdateFinanceAccountInput,
): Promise<MentorEntity<"financas.account">> {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new Error("A revisão esperada da conta precisa ser um inteiro positivo.");
  }
  if (input.dueDate !== null) assertLocalDate(input.dueDate);
  if (
    input.accountKind !== null &&
    !["checking", "wallet", "credit", "other"].includes(input.accountKind)
  ) {
    throw new Error("O tipo da conta financeira é inválido.");
  }
  if (input.balanceMinor !== null) {
    asBRLMinorUnits(input.balanceMinor);
  }

  const current = await getEntity(input.entityId, "financas.account");
  if (!current) throw new Error("Conta financeira não encontrada.");
  const canonicalProvider = canonicalFinanceAccountProvider(current.id);
  if (!canonicalProvider || current.payload.providerName !== canonicalProvider) {
    throw new Error("A conta financeira não corresponde a uma das três instituições canônicas.");
  }
  const activeDataset = await getActiveDataset();
  if (current.datasetId !== activeDataset.id) {
    throw new Error("A conta financeira não pertence ao conjunto de dados ativo.");
  }
  if (current.revision !== input.expectedRevision) {
    throw new Error("A conta mudou em outra operação. Atualize a tela antes de tentar de novo.");
  }

  const timestamp = input.occurredAtUTC ?? nowISO();
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error("O instante da atualização financeira é inválido.");
  }
  const localDate = todayInTimeZone(APP_TIME_ZONE, new Date(timestamp));
  const payload: EntityPayloadByType["financas.account"] = {
    providerName: current.payload.providerName,
    accountKind: input.accountKind === null
      ? unknown("not_provided")
      : known(input.accountKind, "user", timestamp),
    balance: financeAccountBalanceKnowledge(input.balanceMinor, timestamp),
    dueDate: input.dueDate === null
      ? unknown("not_provided")
      : known(input.dueDate, "user", timestamp),
    // This editor intentionally has no account-number input. Preserve only
    // the pre-existing, typed field; every other unrecognized key is dropped.
    lastFourDigits: current.payload.lastFourDigits,
  };
  if (!isBackupEntityPayloadCandidate("financas.account", payload)) {
    throw new Error("A atualização da conta não corresponde ao contrato financeiro seguro.");
  }
  const updated: MentorEntity<"financas.account"> = {
    ...current,
    localDate,
    revision: current.revision + 1,
    source: "manual",
    updatedAt: timestamp,
    payload,
  };
  return commitEntity(updated, {
    kind: "update",
    baseRevision: current.revision,
    reason: "finance_account_snapshot_updated",
    summary: "Finance account snapshot explicitly updated without credentials.",
  });
}

async function updateFinanceEntity<TType extends FinanceEntityType>(options: {
  type: TType;
  entityId: string;
  expectedRevision: number;
  expectedStatus?: FinanceStatusByEntityType[TType];
  patch: Partial<EntityPayloadByType[TType]>;
  occurredAtUTC?: string;
}): Promise<MentorEntity<TType>> {
  if (Object.keys(options.patch).length === 0) {
    throw new Error("Nenhuma alteração financeira foi informada.");
  }
  const current = await getEntity(options.entityId, options.type);
  if (!current) throw new Error("Registro financeiro não encontrado.");
  const activeDataset = await getActiveDataset();
  if (current.datasetId !== activeDataset.id) {
    throw new Error("O registro financeiro não pertence ao conjunto de dados ativo.");
  }
  if (current.revision !== options.expectedRevision) {
    throw new Error("O registro mudou em outra operação. Atualize a tela antes de tentar de novo.");
  }
  const statusWasPatched = Object.prototype.hasOwnProperty.call(
    options.patch,
    "status",
  );
  if (!statusWasPatched && options.expectedStatus !== undefined) {
    throw new Error("Um status esperado só pode acompanhar uma transição de status.");
  }
  if (statusWasPatched) {
    if (options.expectedStatus === undefined) {
      throw new Error(
        "A transição financeira exige o status atual esperado. Atualize a tela e tente novamente.",
      );
    }
    const currentStatus = (current.payload as unknown as { status: FinanceStatusByEntityType[TType] })
      .status;
    const nextStatus = (options.patch as { status?: FinanceStatusByEntityType[TType] })
      .status;
    if (currentStatus !== options.expectedStatus) {
      throw new Error(
        "A situação financeira mudou em outra operação. Atualize a tela antes de tentar de novo.",
      );
    }
    if (nextStatus === undefined) {
      throw new Error("O novo status financeiro precisa ser informado.");
    }
    assertFinanceStatusTransition(options.type, currentStatus, nextStatus);
  }
  const timestamp = options.occurredAtUTC ?? nowISO();
  const createdLocalDate = todayInTimeZone(
    APP_TIME_ZONE,
    new Date(current.createdAt),
  );
  const payload = {
    ...current.payload,
    ...options.patch,
  } as EntityPayloadByType[TType];
  assertFinancePayload(options.type, payload);
  const updated: MentorEntity<TType> = {
    ...current,
    localDate: financeReferenceDate(options.type, payload, createdLocalDate),
    revision: current.revision + 1,
    source: "manual",
    updatedAt: timestamp,
    payload,
  };
  return commitEntity(updated, {
    kind: "update",
    baseRevision: current.revision,
    reason: "finance_record_updated",
    summary: "Finance record explicitly updated by the user.",
  });
}

export function updateFinanceRecord(
  input: UpdateFinanceRecordInput,
): Promise<FinanceRecordEntity> {
  switch (input.type) {
    case "financas.transaction":
      return updateFinanceEntity({
        type: input.type,
        entityId: input.entityId,
        expectedRevision: input.expectedRevision,
        ...(input.expectedStatus === undefined
          ? {}
          : { expectedStatus: input.expectedStatus }),
        patch: input.patch,
        ...(input.occurredAtUTC === undefined
          ? {}
          : { occurredAtUTC: input.occurredAtUTC }),
      });
    case "financas.bill":
      return updateFinanceEntity({
        type: input.type,
        entityId: input.entityId,
        expectedRevision: input.expectedRevision,
        ...(input.expectedStatus === undefined
          ? {}
          : { expectedStatus: input.expectedStatus }),
        patch: input.patch,
        ...(input.occurredAtUTC === undefined
          ? {}
          : { occurredAtUTC: input.occurredAtUTC }),
      });
    case "financas.debt":
      return updateFinanceEntity({
        type: input.type,
        entityId: input.entityId,
        expectedRevision: input.expectedRevision,
        ...(input.expectedStatus === undefined
          ? {}
          : { expectedStatus: input.expectedStatus }),
        patch: input.patch,
        ...(input.occurredAtUTC === undefined
          ? {}
          : { occurredAtUTC: input.occurredAtUTC }),
      });
    case "financas.budget":
      return updateFinanceEntity({
        type: input.type,
        entityId: input.entityId,
        expectedRevision: input.expectedRevision,
        ...(input.expectedStatus === undefined
          ? {}
          : { expectedStatus: input.expectedStatus }),
        patch: input.patch,
        ...(input.occurredAtUTC === undefined
          ? {}
          : { occurredAtUTC: input.occurredAtUTC }),
      });
    case "financas.goal":
      return updateFinanceEntity({
        type: input.type,
        entityId: input.entityId,
        expectedRevision: input.expectedRevision,
        ...(input.expectedStatus === undefined
          ? {}
          : { expectedStatus: input.expectedStatus }),
        patch: input.patch,
        ...(input.occurredAtUTC === undefined
          ? {}
          : { occurredAtUTC: input.occurredAtUTC }),
      });
    case "financas.card":
      return updateFinanceEntity({
        type: input.type,
        entityId: input.entityId,
        expectedRevision: input.expectedRevision,
        ...(input.expectedStatus === undefined
          ? {}
          : { expectedStatus: input.expectedStatus }),
        patch: input.patch,
        ...(input.occurredAtUTC === undefined
          ? {}
          : { occurredAtUTC: input.occurredAtUTC }),
      });
  }
}

export async function updateFinanceSubscriptionStatus(
  input: UpdateFinanceSubscriptionStatusInput,
): Promise<FinanceSubscriptionEntity> {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new Error("A revisão esperada da assinatura precisa ser um inteiro positivo.");
  }
  if (!isFinanceSubscriptionStatus(input.status)) {
    throw new Error("A situação informada para a assinatura é inválida.");
  }
  if (typeof input.justification !== "string") {
    throw new Error("Informe por que a situação da assinatura está sendo atualizada.");
  }
  const justification = input.justification.trim();
  if (!justification) {
    throw new Error("Informe por que a situação da assinatura está sendo atualizada.");
  }

  const current = await getEntity(input.entityId, "generic.event");
  if (!current || !isFinanceSubscriptionEntity(current)) {
    throw new Error("Assinatura financeira não encontrada.");
  }
  if (current.status !== "active") {
    throw new Error("Restaure a assinatura antes de atualizar sua situação.");
  }
  const activeDataset = await getActiveDataset();
  if (current.datasetId !== activeDataset.id) {
    throw new Error("A assinatura não pertence ao conjunto de dados ativo.");
  }
  if (current.revision !== input.expectedRevision) {
    throw new Error("A assinatura mudou em outra operação. Atualize a tela antes de tentar de novo.");
  }

  const existingStatus = current.payload.subscription.status;
  if (
    isKnowledge<string>(existingStatus) &&
    existingStatus.state === "known" &&
    existingStatus.value === input.status
  ) {
    throw new Error("A assinatura já está nessa situação; nenhum dado foi alterado.");
  }

  const timestamp = input.occurredAtUTC ?? nowISO();
  const updated: FinanceSubscriptionEntity = {
    ...current,
    revision: current.revision + 1,
    source: "manual",
    updatedAt: timestamp,
    payload: {
      ...current.payload,
      subscription: {
        ...current.payload.subscription,
        status: known(input.status, "user", timestamp),
      },
    },
  };
  return commitEntity(updated, {
    kind: "update",
    baseRevision: current.revision,
    reason: "finance_subscription_status_updated",
    summary: `Situação da assinatura atualizada para ${input.status}. Justificativa: ${justification}`,
  }) as Promise<FinanceSubscriptionEntity>;
}

export type FinanceRecordEntity = {
  [TType in FinanceEntityType]: MentorEntity<TType>;
}[FinanceEntityType];

export type FinanceAccountEntity = MentorEntity<"financas.account">;

export type FinanceSubscriptionEntity = MentorEntity<"generic.event"> & {
  payload: FinanceSubscriptionPayloadCandidate;
};

export function isFinanceSubscriptionEntity(
  entity: MentorEntity,
): entity is FinanceSubscriptionEntity {
  return entity.domain === "financas" &&
    entity.type === "generic.event" &&
    isFinanceSubscriptionPayload(entity.payload);
}

function isFinanceRecordEntity(
  entity: MentorEntity,
): entity is FinanceRecordEntity {
  return [
    "financas.transaction",
    "financas.bill",
    "financas.debt",
    "financas.budget",
    "financas.goal",
    "financas.card",
  ].includes(entity.type);
}

function financeRecordInWindow(
  entity: FinanceRecordEntity,
  query: FinanceWindowQuery,
): boolean {
  const start = query.startLocalDate ?? ("0000-01-01" as LocalDate);
  const end = query.endLocalDate ?? ("9999-12-31" as LocalDate);
  const contains = (date: LocalDate): boolean => date >= start && date <= end;

  switch (entity.type) {
    case "financas.transaction":
      return contains(entity.payload.transactionDate);
    case "financas.bill": {
      const dates = [
        knownKnowledgeValue(entity.payload.dueDate),
        knownKnowledgeValue(entity.payload.paidDate),
      ].filter((date): date is LocalDate => date !== undefined);
      return dates.length ? dates.some(contains) : contains(entity.localDate);
    }
    case "financas.debt": {
      const dates = [
        knownKnowledgeValue(entity.payload.balanceAsOfLocalDate),
        knownKnowledgeValue(entity.payload.dueDate),
      ].filter((date): date is LocalDate => date !== undefined);
      return dates.length ? dates.some(contains) : contains(entity.localDate);
    }
    case "financas.budget":
      return (
        entity.payload.periodStartLocalDate <= end &&
        entity.payload.periodEndLocalDate >= start
      );
    case "financas.goal": {
      const targetDate = knownKnowledgeValue(entity.payload.targetDate);
      return contains(targetDate ?? entity.localDate);
    }
    case "financas.card": {
      const dates = [
        knownKnowledgeValue(entity.payload.closingDate),
        knownKnowledgeValue(entity.payload.dueDate),
        knownKnowledgeValue(entity.payload.balanceAsOfLocalDate),
        ...entity.payload.installments.flatMap((installment) => [
          knownKnowledgeValue(installment.nextDueDate),
          knownKnowledgeValue(installment.finalDueDate),
        ]),
      ].filter((date): date is LocalDate => date !== undefined);
      return dates.length ? dates.some(contains) : contains(entity.localDate);
    }
  }
}

function financeRecordWindowSortDate(
  entity: FinanceRecordEntity,
  query: FinanceWindowQuery,
): LocalDate {
  const start = query.startLocalDate ?? ("0000-01-01" as LocalDate);
  const end = query.endLocalDate ?? ("9999-12-31" as LocalDate);
  const inWindow = (date: LocalDate): boolean => date >= start && date <= end;
  let dates: LocalDate[];
  switch (entity.type) {
    case "financas.transaction":
      dates = [entity.payload.transactionDate];
      break;
    case "financas.bill":
      dates = [
        knownKnowledgeValue(entity.payload.dueDate),
        knownKnowledgeValue(entity.payload.paidDate),
      ].filter((date): date is LocalDate => date !== undefined);
      break;
    case "financas.debt":
      dates = [
        knownKnowledgeValue(entity.payload.dueDate),
        knownKnowledgeValue(entity.payload.balanceAsOfLocalDate),
      ].filter((date): date is LocalDate => date !== undefined);
      break;
    case "financas.budget":
      return entity.payload.periodStartLocalDate < start
        ? start
        : entity.payload.periodStartLocalDate;
    case "financas.goal":
      dates = [knownKnowledgeValue(entity.payload.targetDate)].filter(
        (date): date is LocalDate => date !== undefined,
      );
      break;
    case "financas.card":
      dates = [
        knownKnowledgeValue(entity.payload.closingDate),
        knownKnowledgeValue(entity.payload.dueDate),
        knownKnowledgeValue(entity.payload.balanceAsOfLocalDate),
        ...entity.payload.installments.flatMap((installment) => [
          knownKnowledgeValue(installment.nextDueDate),
          knownKnowledgeValue(installment.finalDueDate),
        ]),
      ].filter((date): date is LocalDate => date !== undefined);
      break;
  }
  return dates.filter(inWindow).sort()[0] ?? entity.localDate;
}

export async function listFinanceRecords(
  query: FinanceWindowQuery = {},
): Promise<FinanceRecordEntity[]> {
  if (query.startLocalDate) assertLocalDate(query.startLocalDate);
  if (query.endLocalDate) assertLocalDate(query.endLocalDate);
  if (
    query.startLocalDate &&
    query.endLocalDate &&
    query.startLocalDate > query.endLocalDate
  ) {
    throw new Error("A data inicial não pode ser posterior à data final.");
  }
  const requestedTypes = query.types ? new Set<FinanceEntityType>(query.types) : null;
  const records = (await listEntities({ domain: "financas" }))
    .filter(isFinanceRecordEntity)
    .filter((entity) => (requestedTypes ? requestedTypes.has(entity.type) : true))
    .filter((entity) => financeRecordInWindow(entity, query));
  return records.sort((left, right) => {
    const leftDate = financeRecordWindowSortDate(left, query);
    const rightDate = financeRecordWindowSortDate(right, query);
    return leftDate === rightDate
      ? left.id.localeCompare(right.id)
      : leftDate.localeCompare(rightDate);
  });
}

/** The three canonical accounts always retain stable seed IDs. */
export async function listFinanceAccounts(): Promise<FinanceAccountEntity[]> {
  const accounts = await listEntities({
    domain: "financas",
    type: "financas.account",
  });
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  return Object.entries(CANONICAL_FINANCE_ACCOUNT_PROVIDER_BY_ID).flatMap(
    ([entityId, providerName]) => {
      const account = accountById.get(entityId);
      return account?.payload.providerName === providerName ? [account] : [];
    },
  );
}

/**
 * Compatibility read for subscriptions stored by the original generic-event
 * form. Keeping this query explicit prevents unrelated finance notes from
 * leaking into the structured workspace.
 */
export async function listFinanceSubscriptions(): Promise<FinanceSubscriptionEntity[]> {
  const records = (await listEntities({
    domain: "financas",
    type: "generic.event",
  })).filter(isFinanceSubscriptionEntity);
  return records.sort((left, right) =>
    left.localDate === right.localDate
      ? left.updatedAt.localeCompare(right.updatedAt)
      : left.localDate.localeCompare(right.localDate),
  );
}

export async function getFinanceTransactionSummary(
  query: Omit<FinanceWindowQuery, "types"> = {},
): Promise<FinanceTransactionSummary> {
  const transactions = await listFinanceRecords({
    ...query,
    types: ["financas.transaction"],
  });
  return summarizeFinanceTransactions(
    transactions
      .filter(
        (entity): entity is MentorEntity<"financas.transaction"> =>
          entity.type === "financas.transaction",
      )
      .map((entity) => entity.payload),
  );
}

export { localDateFromDateTime };
