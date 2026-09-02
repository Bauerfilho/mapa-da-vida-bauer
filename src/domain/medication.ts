import type {
  GenericPayload,
  ISOInstant,
  Knowledge,
  LocalDate,
  LocalTime,
  MentorEntity,
  MedicationConfirmationState,
} from "./model";

export const MEDICATION_REGIMEN_SCHEMA = "medication-regimen-v2" as const;

export type MedicationRegimenStatus =
  | "active_confirmed"
  | "paused_confirmed"
  | "finished_confirmed";

/**
 * A regimen is a transcription of what Bauer explicitly informed. It is not a
 * prescription engine and must never be used to infer, change, or recommend a
 * dose. Generic-event storage keeps older medication-detail records readable
 * while this stricter schema powers the dose trail.
 */
export interface CanonicalMedicationRegimenPayload extends GenericPayload {
  schema: typeof MEDICATION_REGIMEN_SCHEMA;
  eventKind: "medication-regimen";
  medicationName: Knowledge<string>;
  doseLabel: Knowledge<string>;
  scheduledTimesLocal: Knowledge<LocalTime[]>;
  status: MedicationRegimenStatus;
  activeFromLocalDate: Knowledge<LocalDate>;
  activeThroughLocalDate: Knowledge<LocalDate>;
  note: Knowledge<string>;
}

export type CanonicalMedicationRegimenEntity = MentorEntity<"generic.event"> & {
  payload: CanonicalMedicationRegimenPayload;
};

export interface CreateMedicationRegimenInput {
  medicationName: string;
  doseLabel: string;
  scheduledTimesLocal: LocalTime[];
  activeFromLocalDate: LocalDate;
  activeThroughLocalDate?: LocalDate;
  note?: string;
  occurredAtUTC?: ISOInstant;
}

export type RecordableMedicationDoseState = Extract<
  MedicationConfirmationState,
  "taken_time_recorded" | "taken_time_unknown" | "skipped_confirmed"
>;

export interface RecordMedicationDoseInput {
  regimenId: string;
  localDate: LocalDate;
  scheduledTimeLocal: LocalTime;
  confirmation: RecordableMedicationDoseState;
  actualTimeLocal?: LocalTime;
  note?: string;
  occurredAtUTC?: ISOInstant;
}

export type MedicationTimingFact =
  | { state: "unavailable"; reason: "planned_missing" | "actual_missing" }
  | {
      state: "known";
      deltaMinutes: number;
      relation: "early" | "exact" | "late";
    };

export interface MedicationTrailSlot {
  id: string;
  regimen: CanonicalMedicationRegimenEntity;
  localDate: LocalDate;
  scheduledTimeLocal: LocalTime;
  event: MentorEntity<"medicamentos.confirmation"> | null;
  state: "not_recorded" | RecordableMedicationDoseState | "legacy_timing_state";
  timing: MedicationTimingFact;
}

export interface MedicationTrail {
  localDate: LocalDate;
  slots: MedicationTrailSlot[];
  /** Dose confirmations that could not be matched to a canonical regimen slot. */
  unlinkedDoseEvents: Array<MentorEntity<"medicamentos.confirmation">>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isKnownString(value: unknown): value is Extract<Knowledge<string>, { state: "known" }> {
  return Boolean(
    isRecord(value) &&
      value.state === "known" &&
      typeof value.value === "string" &&
      value.value.trim(),
  );
}

function isKnownLocalDate(value: unknown): value is Extract<Knowledge<LocalDate>, { state: "known" }> {
  return Boolean(
    isRecord(value) &&
      value.state === "known" &&
      typeof value.value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.value),
  );
}

function isLocalTime(value: unknown): value is LocalTime {
  if (typeof value !== "string") return false;
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  return Boolean(
    match &&
      Number(match[1]) <= 23 &&
      Number(match[2]) <= 59 &&
      Number(match[3] ?? 0) <= 59,
  );
}

function isKnownLocalTimes(
  value: unknown,
): value is Extract<Knowledge<LocalTime[]>, { state: "known" }> {
  return Boolean(
    isRecord(value) &&
      value.state === "known" &&
      Array.isArray(value.value) &&
      value.value.length > 0 &&
      value.value.every(isLocalTime),
  );
}

export function isCanonicalMedicationRegimen(
  entity: MentorEntity,
): entity is CanonicalMedicationRegimenEntity {
  if (
    entity.domain !== "medicamentos" ||
    entity.type !== "generic.event" ||
    !isRecord(entity.payload)
  ) {
    return false;
  }
  const payload = entity.payload;
  return Boolean(
    payload.schema === MEDICATION_REGIMEN_SCHEMA &&
      payload.eventKind === "medication-regimen" &&
      isKnownString(payload.medicationName) &&
      isKnownString(payload.doseLabel) &&
      isKnownLocalTimes(payload.scheduledTimesLocal) &&
      ["active_confirmed", "paused_confirmed", "finished_confirmed"].includes(
        String(payload.status),
      ) &&
      isKnownLocalDate(payload.activeFromLocalDate),
  );
}

export function medicationRegimenAppliesOnDate(
  regimen: CanonicalMedicationRegimenEntity,
  localDate: LocalDate,
): boolean {
  if (regimen.payload.status !== "active_confirmed") return false;
  const from = regimen.payload.activeFromLocalDate;
  if (from.state !== "known" || from.value > localDate) return false;
  const through = regimen.payload.activeThroughLocalDate;
  return through.state !== "known" || through.value >= localDate;
}

function clockMinutes(value: LocalTime): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Delay/earliness exists only when both planned and actual clock times are
 * present. The shortest signed clock delta handles a dose around midnight.
 */
export function calculateMedicationTiming(
  scheduledTimeLocal: LocalTime | null | undefined,
  actualTimeLocal: LocalTime | null | undefined,
): MedicationTimingFact {
  if (!scheduledTimeLocal) return { state: "unavailable", reason: "planned_missing" };
  if (!actualTimeLocal) return { state: "unavailable", reason: "actual_missing" };

  let deltaMinutes = clockMinutes(actualTimeLocal) - clockMinutes(scheduledTimeLocal);
  if (deltaMinutes > 720) deltaMinutes -= 1_440;
  if (deltaMinutes < -720) deltaMinutes += 1_440;
  return {
    state: "known",
    deltaMinutes,
    relation: deltaMinutes > 0 ? "late" : deltaMinutes < 0 ? "early" : "exact",
  };
}

function knownStringValue(value: Knowledge<string> | undefined): string | null {
  return value?.state === "known" ? value.value : null;
}

function knownTimeValue(value: Knowledge<LocalTime>): LocalTime | null {
  return value.state === "known" ? value.value : null;
}

function trailState(
  event: MentorEntity<"medicamentos.confirmation"> | null,
): MedicationTrailSlot["state"] {
  if (!event) return "not_recorded";
  if (
    event.payload.confirmation === "taken_time_recorded" ||
    event.payload.confirmation === "taken_time_unknown" ||
    event.payload.confirmation === "skipped_confirmed"
  ) {
    return event.payload.confirmation;
  }
  return "legacy_timing_state";
}

export function buildMedicationTrail(
  regimens: readonly CanonicalMedicationRegimenEntity[],
  doseEvents: readonly MentorEntity<"medicamentos.confirmation">[],
  localDate: LocalDate,
): MedicationTrail {
  const candidates = doseEvents
    .filter((event) => event.status === "active" && event.localDate === localDate)
    .sort((left, right) => right.occurredAtUTC.localeCompare(left.occurredAtUTC));
  const usedEventIds = new Set<string>();
  const slots: MedicationTrailSlot[] = [];

  for (const regimen of regimens.filter((item) =>
    medicationRegimenAppliesOnDate(item, localDate),
  )) {
    if (regimen.payload.scheduledTimesLocal.state !== "known") continue;
    for (const scheduledTimeLocal of regimen.payload.scheduledTimesLocal.value) {
      const event = candidates.find((candidate) =>
        !usedEventIds.has(candidate.id) &&
        knownStringValue(candidate.payload.regimenId) === regimen.id &&
        knownTimeValue(candidate.payload.scheduledTimeLocal) === scheduledTimeLocal,
      ) ?? null;
      if (event) usedEventIds.add(event.id);
      const actual = event ? knownTimeValue(event.payload.actualTimeLocal) : null;
      slots.push({
        id: `${regimen.id}:${localDate}:${scheduledTimeLocal}`,
        regimen,
        localDate,
        scheduledTimeLocal,
        event,
        state: trailState(event),
        timing: calculateMedicationTiming(scheduledTimeLocal, actual),
      });
    }
  }

  slots.sort((left, right) =>
    left.scheduledTimeLocal === right.scheduledTimeLocal
      ? left.regimen.id.localeCompare(right.regimen.id)
      : left.scheduledTimeLocal.localeCompare(right.scheduledTimeLocal),
  );
  return {
    localDate,
    slots,
    unlinkedDoseEvents: candidates.filter((event) => !usedEventIds.has(event.id)),
  };
}
