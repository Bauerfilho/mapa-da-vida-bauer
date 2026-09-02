import {
  APP_TIME_ZONE,
  assertLocalDate,
  buildMedicationTrail,
  isCanonicalMedicationRegimen,
  known,
  medicationRegimenAppliesOnDate,
  notApplicable,
  unknown,
  type CanonicalMedicationRegimenEntity,
  type CanonicalMedicationRegimenPayload,
  type CreateMedicationRegimenInput,
  type LocalDate,
  type LocalTime,
  type MedicationTrail,
  type MentorEntity,
  type RecordMedicationDoseInput,
} from "../domain";
import {
  confirmMedication,
  getEntity,
  listEntities,
  recordGenericEvent,
} from "./repository";

function assertLocalTime(value: string): asserts value is LocalTime {
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

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} precisa ser informado.`);
  return normalized;
}

function normalizeTimes(values: readonly LocalTime[]): LocalTime[] {
  const unique = [...new Set(values.map((value) => value.slice(0, 5) as LocalTime))];
  unique.forEach(assertLocalTime);
  if (unique.length === 0) {
    throw new Error("Informe ao menos um horário exatamente como foi orientado.");
  }
  return unique.sort((left, right) => left.localeCompare(right));
}

export interface MedicationWorkspaceSnapshot {
  localDate: LocalDate;
  regimens: CanonicalMedicationRegimenEntity[];
  trail: MedicationTrail;
}

export async function createMedicationRegimen(
  input: CreateMedicationRegimenInput,
): Promise<CanonicalMedicationRegimenEntity> {
  assertLocalDate(input.activeFromLocalDate);
  if (input.activeThroughLocalDate) {
    assertLocalDate(input.activeThroughLocalDate);
    if (input.activeThroughLocalDate < input.activeFromLocalDate) {
      throw new Error("O fim informado não pode anteceder o início do regime.");
    }
  }
  const medicationName = requiredText(input.medicationName, "O nome do medicamento");
  const doseLabel = requiredText(input.doseLabel, "A dose escrita");
  const scheduledTimesLocal = normalizeTimes(input.scheduledTimesLocal);
  const timestamp = input.occurredAtUTC ?? new Date().toISOString();
  const payload: CanonicalMedicationRegimenPayload = {
    schema: "medication-regimen-v2",
    eventKind: "medication-regimen",
    medicationName: known(medicationName, "user", timestamp),
    doseLabel: known(doseLabel, "user", timestamp),
    scheduledTimesLocal: known(scheduledTimesLocal, "user", timestamp),
    status: "active_confirmed",
    activeFromLocalDate: known(input.activeFromLocalDate, "user", timestamp),
    activeThroughLocalDate: input.activeThroughLocalDate
      ? known(input.activeThroughLocalDate, "user", timestamp)
      : unknown("not_provided"),
    note: input.note?.trim()
      ? known(input.note.trim(), "user", timestamp)
      : unknown("not_recorded"),
    /** Explicit guard for exports/readers: this record never encodes a recommendation. */
    clinicalRecommendation: notApplicable<string>("user_transcription_only"),
  };
  const entity = await recordGenericEvent({
    domain: "medicamentos",
    payload,
    summary: "Regime informado pelo usuário salvo sem interpretação clínica.",
    localDate: input.activeFromLocalDate,
    occurredAtUTC: timestamp,
  });
  if (!isCanonicalMedicationRegimen(entity)) {
    throw new Error("O regime foi salvo, mas não pôde ser reaberto no formato esperado.");
  }
  return entity;
}

export async function listMedicationRegimens(): Promise<CanonicalMedicationRegimenEntity[]> {
  const entities = await listEntities({ domain: "medicamentos" });
  return entities
    .filter(isCanonicalMedicationRegimen)
    .sort((left, right) => {
      const leftName = left.payload.medicationName.state === "known"
        ? left.payload.medicationName.value
        : left.id;
      const rightName = right.payload.medicationName.state === "known"
        ? right.payload.medicationName.value
        : right.id;
      return leftName.localeCompare(rightName, "pt-BR");
    });
}

async function linkedDoseAlreadyExists(
  regimenId: string,
  localDate: LocalDate,
  scheduledTimeLocal: LocalTime,
): Promise<boolean> {
  const events = await listEntities({
    domain: "medicamentos",
    type: "medicamentos.confirmation",
    startLocalDate: localDate,
    endLocalDate: localDate,
  });
  return events.some((event) =>
    event.payload.regimenId?.state === "known" &&
    event.payload.regimenId.value === regimenId &&
    event.payload.scheduledTimeLocal.state === "known" &&
    event.payload.scheduledTimeLocal.value === scheduledTimeLocal,
  );
}

export async function recordMedicationDose(
  input: RecordMedicationDoseInput,
): Promise<MentorEntity<"medicamentos.confirmation">> {
  assertLocalDate(input.localDate);
  assertLocalTime(input.scheduledTimeLocal);
  if (input.actualTimeLocal) assertLocalTime(input.actualTimeLocal);

  const entity = await getEntity(input.regimenId, "generic.event");
  if (!entity || !isCanonicalMedicationRegimen(entity)) {
    throw new Error("O regime vinculado não foi encontrado.");
  }
  if (!medicationRegimenAppliesOnDate(entity, input.localDate)) {
    throw new Error("Este regime não está ativo na data escolhida.");
  }
  if (
    entity.payload.scheduledTimesLocal.state !== "known" ||
    !entity.payload.scheduledTimesLocal.value.includes(input.scheduledTimeLocal)
  ) {
    throw new Error("O horário não pertence ao regime informado.");
  }
  if (
    await linkedDoseAlreadyExists(
      entity.id,
      input.localDate,
      input.scheduledTimeLocal,
    )
  ) {
    throw new Error("Esta dose já possui um registro. Abra o histórico para corrigi-lo.");
  }

  const medicationName = entity.payload.medicationName.state === "known"
    ? entity.payload.medicationName.value
    : undefined;
  const doseLabel = entity.payload.doseLabel.state === "known"
    ? entity.payload.doseLabel.value
    : undefined;
  return confirmMedication({
    localDate: input.localDate,
    regimenId: entity.id,
    medicationName,
    doseLabel,
    scheduledTimeLocal: input.scheduledTimeLocal,
    confirmation: input.confirmation,
    ...(input.actualTimeLocal ? { actualTimeLocal: input.actualTimeLocal } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.occurredAtUTC ? { occurredAtUTC: input.occurredAtUTC } : {}),
  });
}

export async function getMedicationWorkspaceSnapshot(
  localDate: LocalDate,
): Promise<MedicationWorkspaceSnapshot> {
  assertLocalDate(localDate);
  const [regimens, doseEvents] = await Promise.all([
    listMedicationRegimens(),
    listEntities({
      domain: "medicamentos",
      type: "medicamentos.confirmation",
      startLocalDate: localDate,
      endLocalDate: localDate,
    }),
  ]);
  return {
    localDate,
    regimens,
    trail: buildMedicationTrail(regimens, doseEvents, localDate),
  };
}

export function localTimeInAppZone(date = new Date()): LocalTime {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}` as LocalTime;
}
