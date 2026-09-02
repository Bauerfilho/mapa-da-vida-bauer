import {
  assertLocalDateTime,
  compareLocalDateTimes,
  shiftLocalDate,
} from "./dates";
import type {
  InclusiveDateWindow,
  ISOInstant,
  Knowledge,
  LocalDate,
  LocalDateTime,
  LocalTime,
} from "./model";

export type AgendaPriority = "low" | "normal" | "high" | "urgent";
export type AgendaGoalTier = "minimum" | "good" | "gold";

export type AgendaTaskStatus =
  | "captured"
  | "planned"
  | "in_progress"
  | "completed"
  | "deferred"
  | "cancelled";

export type AgendaEventStatus =
  | "tentative"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled";

export type AgendaItemStatus = AgendaTaskStatus | AgendaEventStatus;

/** Planned and actual timestamps are kept separately so a plan is never
 * overwritten by what actually happened. */
export interface AgendaTemporalTruth {
  plannedStartLocal: Knowledge<LocalDateTime>;
  plannedEndLocal: Knowledge<LocalDateTime>;
  actualStartLocal: Knowledge<LocalDateTime>;
  actualEndLocal: Knowledge<LocalDateTime>;
}

export interface AgendaDueTruth {
  dueLocalDate: Knowledge<LocalDate>;
  dueLocalTime: Knowledge<LocalTime>;
}

export interface AgendaBufferTruth {
  bufferBeforeMinutes: Knowledge<number>;
  bufferAfterMinutes: Knowledge<number>;
}

export interface AgendaTaskPayload
  extends AgendaTemporalTruth,
    AgendaDueTruth,
    AgendaBufferTruth {
  title: string;
  status: AgendaTaskStatus;
  priority: AgendaPriority;
  goalTier: Knowledge<AgendaGoalTier>;
  note: Knowledge<string>;
}

export interface AgendaEventPayload
  extends AgendaTemporalTruth,
    AgendaDueTruth,
    AgendaBufferTruth {
  title: string;
  status: AgendaEventStatus;
  priority: AgendaPriority;
  note: Knowledge<string>;
}

/** A textual outcome for each tier preserves the user's own definition of a
 * minimum, good, or gold day without inventing a numeric target. */
export interface AgendaGoalSetPayload {
  appliesToLocalDate: LocalDate;
  minimum: string;
  good: string;
  gold: string;
  note: Knowledge<string>;
}

interface AgendaItemInputBase {
  title: string;
  priority: AgendaPriority;
  dueLocalDate?: LocalDate;
  dueLocalTime?: LocalTime;
  plannedStartLocal?: LocalDateTime;
  plannedEndLocal?: LocalDateTime;
  actualStartLocal?: LocalDateTime;
  actualEndLocal?: LocalDateTime;
  /** undefined = unknown; null = explicitly no buffer requested. */
  bufferBeforeMinutes?: number | null;
  /** undefined = unknown; null = explicitly no buffer requested. */
  bufferAfterMinutes?: number | null;
  note?: string;
  occurredAtUTC?: ISOInstant;
}

export interface CreateAgendaTaskInput extends AgendaItemInputBase {
  status: AgendaTaskStatus;
  goalTier?: AgendaGoalTier;
}

export interface CreateAgendaEventInput extends AgendaItemInputBase {
  status: AgendaEventStatus;
  plannedStartLocal: LocalDateTime;
  plannedEndLocal: LocalDateTime;
}

export type QuickCaptureAgendaInput =
  | {
      kind: "task";
      title: string;
      priority?: AgendaPriority;
      note?: string;
      occurredAtUTC?: ISOInstant;
    }
  | {
      kind: "event";
      title: string;
      plannedStartLocal: LocalDateTime;
      plannedEndLocal: LocalDateTime;
      priority?: AgendaPriority;
      note?: string;
      occurredAtUTC?: ISOInstant;
    };

export interface CreateAgendaGoalSetInput {
  appliesToLocalDate: LocalDate;
  minimum: string;
  good: string;
  gold: string;
  note?: string;
  occurredAtUTC?: ISOInstant;
}

export type UpdateAgendaItemInput =
  | {
      type: "agenda.task";
      entityId: string;
      expectedRevision: number;
      patch: Partial<AgendaTaskPayload>;
      occurredAtUTC?: ISOInstant;
    }
  | {
      type: "agenda.event";
      entityId: string;
      expectedRevision: number;
      patch: Partial<AgendaEventPayload>;
      occurredAtUTC?: ISOInstant;
    };

export type AgendaWindowDays = 7 | 30;

export interface AgendaWindowQuery {
  startLocalDate: LocalDate;
  days: AgendaWindowDays;
  includeUnscheduled?: boolean;
}

export function forwardAgendaWindow(
  start: LocalDate,
  days: AgendaWindowDays,
): InclusiveDateWindow {
  if (days !== 7 && days !== 30) {
    throw new Error("A janela da agenda precisa ser de 7 ou 30 dias.");
  }
  return { start, end: shiftLocalDate(start, days - 1), days };
}

export interface AgendaPlannedInterval {
  id: string;
  plannedStartLocal: LocalDateTime;
  plannedEndLocal: LocalDateTime;
  /** undefined = explicitly not requested; null = unknown/invalid. */
  bufferBeforeMinutes?: number | null;
  /** undefined = explicitly not requested; null = unknown/invalid. */
  bufferAfterMinutes?: number | null;
  status?: AgendaItemStatus;
}

export interface AgendaConflict {
  firstId: string;
  secondId: string;
  kind: "planned_overlap" | "buffer_shortfall";
  overlapMinutes: number;
  availableGapMinutes: number;
  requiredBufferMinutes: number | null;
  shortfallMinutes: number | null;
}

function civilMinute(value: LocalDateTime): number {
  assertLocalDateTime(value);
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second) / 60_000;
}

function assertBuffer(value: number | null | undefined): void {
  if (
    value !== undefined &&
    value !== null &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error("O buffer precisa ser informado em minutos inteiros não negativos.");
  }
}

function normalizeInterval(interval: AgendaPlannedInterval) {
  assertLocalDateTime(interval.plannedStartLocal);
  assertLocalDateTime(interval.plannedEndLocal);
  if (
    compareLocalDateTimes(
      interval.plannedEndLocal,
      interval.plannedStartLocal,
    ) <= 0
  ) {
    throw new Error("O fim planejado precisa ser posterior ao início planejado.");
  }
  assertBuffer(interval.bufferBeforeMinutes);
  assertBuffer(interval.bufferAfterMinutes);
  return {
    ...interval,
    startMinute: civilMinute(interval.plannedStartLocal),
    endMinute: civilMinute(interval.plannedEndLocal),
  };
}

/**
 * Finds pairwise overlaps and missing requested buffers using only planned
 * intervals. Actual timestamps intentionally do not rewrite planning truth.
 */
export function calculateAgendaConflicts(
  intervals: readonly AgendaPlannedInterval[],
): AgendaConflict[] {
  const active = intervals
    .filter((interval) => interval.status !== "cancelled")
    .map(normalizeInterval)
    .sort((left, right) =>
      left.startMinute === right.startMinute
        ? left.id.localeCompare(right.id)
        : left.startMinute - right.startMinute,
    );
  const conflicts: AgendaConflict[] = [];

  for (let firstIndex = 0; firstIndex < active.length; firstIndex += 1) {
    const first = active[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < active.length; secondIndex += 1) {
      const second = active[secondIndex];
      const overlapMinutes = Math.max(
        0,
        Math.min(first.endMinute, second.endMinute) -
          Math.max(first.startMinute, second.startMinute),
      );
      const availableGapMinutes = Math.max(0, second.startMinute - first.endMinute);
      const bufferIsKnown =
        first.bufferAfterMinutes !== null &&
        second.bufferBeforeMinutes !== null;
      const requiredBufferMinutes = bufferIsKnown
        ? (first.bufferAfterMinutes ?? 0) + (second.bufferBeforeMinutes ?? 0)
        : null;

      if (overlapMinutes > 0) {
        conflicts.push({
          firstId: first.id,
          secondId: second.id,
          kind: "planned_overlap",
          overlapMinutes,
          availableGapMinutes,
          requiredBufferMinutes,
          // How far the later-starting interval must move to begin after the
          // earlier interval plus both requested buffers. For nested events,
          // this is intentionally larger than the overlap duration.
          shortfallMinutes:
            requiredBufferMinutes === null
              ? null
              : first.endMinute + requiredBufferMinutes - second.startMinute,
        });
      } else if (
        requiredBufferMinutes !== null &&
        requiredBufferMinutes > availableGapMinutes
      ) {
        conflicts.push({
          firstId: first.id,
          secondId: second.id,
          kind: "buffer_shortfall",
          overlapMinutes,
          availableGapMinutes,
          requiredBufferMinutes,
          shortfallMinutes: requiredBufferMinutes - availableGapMinutes,
        });
      }
    }
  }

  return conflicts;
}
