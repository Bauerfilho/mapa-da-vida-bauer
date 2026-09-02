import {
  known,
  notApplicable,
  unknown,
  type AttendanceStatus,
  type CreateManualShiftInput,
  type ISOInstant,
  type Knowledge,
  type LocalDate,
  type LocalDateTime,
  type LocalTime,
  type MentorEntity,
  type ShiftPayload,
  type ShiftScheduleState,
  type ShiftTimeUpdateValue,
  type UpdateShiftInput,
} from "./model";
import {
  assertLocalDate,
  combineLocalDateAndTime,
  compareLocalDateTimes,
  shiftLocalDate,
} from "./dates";

export type ShiftAttendanceDraft = "unknown" | AttendanceStatus;
export type ShiftBreakDraftMode = "unknown" | "timed" | "none_confirmed";

export interface ShiftActualDraft {
  attendance: ShiftAttendanceDraft;
  arrival: string;
  departure: string;
  breakMode: ShiftBreakDraftMode;
  breakStart: string;
  breakEnd: string;
}

export type ShiftUpdatePatch = Omit<UpdateShiftInput, "shiftId" | "occurredAtUTC">;

export interface ShiftUpdatePlan {
  patch: ShiftUpdatePatch;
  changedFields: Array<keyof ShiftUpdatePatch>;
  errors: string[];
}

const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface ManualShiftDraft {
  localDate: string;
  startTimeLocal: string;
  endTimeLocal: string;
  endsNextDay: boolean;
  scheduleState: ShiftScheduleState;
  assignment: string;
  location: string;
}

export interface ManualShiftCreationPlan {
  input: CreateManualShiftInput | null;
  errors: string[];
}

export function emptyManualShiftDraft(localDate: LocalDate): ManualShiftDraft {
  return {
    localDate,
    startTimeLocal: "",
    endTimeLocal: "",
    endsNextDay: false,
    scheduleState: "confirmed_planned",
    assignment: "",
    location: "",
  };
}

/**
 * Validates the manual planning form without coercing omitted information.
 * Checking "termina no dia seguinte" changes only the civil date of the end;
 * it never infers that choice from an end clock earlier than the start clock.
 */
export function planManualShiftCreation(
  draft: ManualShiftDraft,
): ManualShiftCreationPlan {
  const errors: string[] = [];
  let localDate: LocalDate | null = null;

  try {
    assertLocalDate(draft.localDate);
    localDate = draft.localDate;
  } catch {
    errors.push("Informe uma data válida para a jornada.");
  }
  if (!CLOCK_PATTERN.test(draft.startTimeLocal)) {
    errors.push("Início: use HH:mm.");
  }
  if (!CLOCK_PATTERN.test(draft.endTimeLocal)) {
    errors.push("Fim: use HH:mm.");
  }
  if (
    draft.scheduleState !== "confirmed_planned" &&
    draft.scheduleState !== "tentative"
  ) {
    errors.push("Selecione se a jornada está confirmada ou é tentativa.");
  }

  if (localDate && errors.length === 0) {
    const start = combineLocalDateAndTime(
      localDate,
      draft.startTimeLocal as LocalTime,
    );
    const endDate = draft.endsNextDay ? shiftLocalDate(localDate, 1) : localDate;
    const end = combineLocalDateAndTime(
      endDate,
      draft.endTimeLocal as LocalTime,
    );
    if (compareLocalDateTimes(end, start) <= 0) {
      errors.push("O fim da jornada precisa ser posterior ao início.");
    }
  }

  if (!localDate || errors.length > 0) return { input: null, errors };

  const assignment = draft.assignment.trim();
  const location = draft.location.trim();
  return {
    input: {
      localDate,
      startTimeLocal: draft.startTimeLocal as LocalTime,
      endTimeLocal: draft.endTimeLocal as LocalTime,
      endsNextDay: draft.endsNextDay,
      scheduleState: draft.scheduleState,
      ...(assignment ? { assignment } : {}),
      ...(location ? { location } : {}),
    },
    errors: [],
  };
}

/**
 * Builds the same canonical payload used by seeded shifts. All actual fields
 * begin unknown, and optional planning labels remain unknown when omitted.
 */
export function buildManualShiftPayload(
  input: CreateManualShiftInput,
  recordedAt: ISOInstant,
): ShiftPayload {
  assertLocalDate(input.localDate);
  if (!CLOCK_PATTERN.test(input.startTimeLocal)) {
    throw new Error("Horário inicial inválido: use HH:mm.");
  }
  if (!CLOCK_PATTERN.test(input.endTimeLocal)) {
    throw new Error("Horário final inválido: use HH:mm.");
  }
  if (
    input.scheduleState !== "confirmed_planned" &&
    input.scheduleState !== "tentative"
  ) {
    throw new Error("Estado do planejamento da jornada inválido.");
  }

  const scheduledStartLocal = combineLocalDateAndTime(
    input.localDate,
    input.startTimeLocal,
  );
  const endDate = input.endsNextDay
    ? shiftLocalDate(input.localDate, 1)
    : input.localDate;
  const scheduledEndLocal = combineLocalDateAndTime(endDate, input.endTimeLocal);
  if (compareLocalDateTimes(scheduledEndLocal, scheduledStartLocal) <= 0) {
    throw new Error("O fim da jornada precisa ser posterior ao início.");
  }

  const assignment = input.assignment?.trim();
  const location = input.location?.trim();
  return {
    scheduleState: input.scheduleState,
    scheduledStartLocal,
    scheduledEndLocal,
    assignment: assignment
      ? known(assignment, "user", recordedAt)
      : unknown("not_recorded"),
    location: location
      ? known(location, "user", recordedAt)
      : unknown("not_recorded"),
    attendance: unknown("not_recorded"),
    arrivalLocal: unknown("not_recorded"),
    departureLocal: unknown("not_recorded"),
    breakStartLocal: unknown("not_recorded"),
    breakEndLocal: unknown("not_recorded"),
  };
}

function clockFromKnowledge(value: Knowledge<LocalDateTime>): string {
  return value.state === "known" ? value.value.slice(11, 16) : "";
}

function sameClock(value: Knowledge<LocalDateTime>, clock: string): boolean {
  return value.state === "known" && value.value.slice(11, 16) === clock;
}

function knowledgeStateIsUnknown(value: Knowledge<unknown>): boolean {
  return value.state === "unknown";
}

function timeUpdateForDraft(
  original: Knowledge<LocalDateTime>,
  clock: string,
): ShiftTimeUpdateValue | undefined {
  if (clock) {
    return sameClock(original, clock) ? undefined : clock as LocalTime;
  }
  return knowledgeStateIsUnknown(original) ? undefined : unknown("not_recorded");
}

function appendTimePatch(
  patch: ShiftUpdatePlan["patch"],
  field: "arrivalLocal" | "departureLocal" | "breakStartLocal" | "breakEndLocal",
  original: Knowledge<LocalDateTime>,
  clock: string,
): void {
  const value = timeUpdateForDraft(original, clock);
  if (value !== undefined) patch[field] = value;
}

function allActualsNotApplicable(
  shift: MentorEntity<"internato.shift">,
  reasonCode: string,
): ShiftUpdatePatch {
  const result: ShiftUpdatePatch = {};
  const fields = [
    "arrivalLocal",
    "departureLocal",
    "breakStartLocal",
    "breakEndLocal",
  ] as const;
  for (const field of fields) {
    const original = shift.payload[field];
    if (original.state !== "not_applicable" || original.reasonCode !== reasonCode) {
      result[field] = notApplicable(reasonCode);
    }
  }
  return result;
}

export function draftFromShift(
  shift: MentorEntity<"internato.shift">,
): ShiftActualDraft {
  const { payload } = shift;
  const breakMode: ShiftBreakDraftMode =
    payload.breakStartLocal.state === "not_applicable" &&
    payload.breakEndLocal.state === "not_applicable"
      ? "none_confirmed"
      : payload.breakStartLocal.state === "known" || payload.breakEndLocal.state === "known"
        ? "timed"
        : "unknown";
  return {
    attendance:
      payload.attendance.state === "known" ? payload.attendance.value : "unknown",
    arrival: clockFromKnowledge(payload.arrivalLocal),
    departure: clockFromKnowledge(payload.departureLocal),
    breakMode,
    breakStart: clockFromKnowledge(payload.breakStartLocal),
    breakEnd: clockFromKnowledge(payload.breakEndLocal),
  };
}

/**
 * Translates the explicit form state into a canonical patch without inventing
 * actuals. An untouched blank remains unknown; an explicitly confirmed
 * absence/cancellation makes actual clock fields not applicable, never zero.
 */
export function planShiftUpdate(
  shift: MentorEntity<"internato.shift">,
  draft: ShiftActualDraft,
): ShiftUpdatePlan {
  const errors: string[] = [];
  const clockFields = [
    ["Chegada", draft.arrival],
    ["Saída", draft.departure],
    ["Início do intervalo", draft.breakStart],
    ["Fim do intervalo", draft.breakEnd],
  ] as const;
  for (const [label, value] of clockFields) {
    if (value && !CLOCK_PATTERN.test(value)) errors.push(`${label}: use HH:mm.`);
  }

  const patch: ShiftUpdatePatch = {};
  const originalAttendance = shift.payload.attendance;
  if (draft.attendance === "unknown") {
    if (originalAttendance.state !== "unknown") {
      patch.attendance = unknown("not_confirmed");
    }
  } else if (
    originalAttendance.state !== "known" ||
    originalAttendance.value !== draft.attendance
  ) {
    patch.attendance = draft.attendance;
  }

  if (draft.attendance !== "unknown" && draft.attendance !== "present") {
    const reason = `attendance_${draft.attendance}`;
    Object.assign(patch, allActualsNotApplicable(shift, reason));
  } else {
    appendTimePatch(patch, "arrivalLocal", shift.payload.arrivalLocal, draft.arrival);
    appendTimePatch(patch, "departureLocal", shift.payload.departureLocal, draft.departure);

    if (draft.breakMode === "none_confirmed") {
      if (
        shift.payload.breakStartLocal.state !== "not_applicable" ||
        shift.payload.breakStartLocal.reasonCode !== "no_break_confirmed"
      ) {
        patch.breakStartLocal = notApplicable("no_break_confirmed");
      }
      if (
        shift.payload.breakEndLocal.state !== "not_applicable" ||
        shift.payload.breakEndLocal.reasonCode !== "no_break_confirmed"
      ) {
        patch.breakEndLocal = notApplicable("no_break_confirmed");
      }
    } else if (draft.breakMode === "unknown") {
      if (shift.payload.breakStartLocal.state !== "unknown") {
        patch.breakStartLocal = unknown("not_recorded");
      }
      if (shift.payload.breakEndLocal.state !== "unknown") {
        patch.breakEndLocal = unknown("not_recorded");
      }
    } else {
      appendTimePatch(
        patch,
        "breakStartLocal",
        shift.payload.breakStartLocal,
        draft.breakStart,
      );
      appendTimePatch(
        patch,
        "breakEndLocal",
        shift.payload.breakEndLocal,
        draft.breakEnd,
      );
    }
  }

  return {
    patch,
    changedFields: Object.keys(patch) as Array<keyof ShiftUpdatePatch>,
    errors,
  };
}

export function shiftSpansLocalDate(
  shift: MentorEntity<"internato.shift">,
  date: LocalDate,
): boolean {
  const start = shift.payload.scheduledStartLocal.slice(0, 10);
  const end = shift.payload.scheduledEndLocal.slice(0, 10);
  return start <= date && end >= date;
}

export function selectDefaultShiftId(
  shifts: Array<MentorEntity<"internato.shift">>,
  referenceDate: LocalDate,
  preferredId?: string | null,
): string | null {
  if (preferredId && shifts.some((shift) => shift.id === preferredId)) return preferredId;
  const ordered = [...shifts].sort((left, right) =>
    left.payload.scheduledStartLocal.localeCompare(right.payload.scheduledStartLocal),
  );
  const spanning = ordered.find((shift) => shiftSpansLocalDate(shift, referenceDate));
  if (spanning) return spanning.id;
  const next = ordered.find(
    (shift) => shift.payload.scheduledStartLocal.slice(0, 10) > referenceDate,
  );
  return next?.id ?? ordered.at(-1)?.id ?? null;
}

export function markAttendancePresent(
  draft: ShiftActualDraft,
): ShiftActualDraft {
  return draft.attendance === "present" ? draft : { ...draft, attendance: "present" };
}
