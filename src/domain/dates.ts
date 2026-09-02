import {
  APP_TIME_ZONE,
  type InclusiveDateWindow,
  type LocalDate,
  type LocalDateTime,
  type LocalTime,
} from "./model";

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

function dateParts(localDate: LocalDate): [number, number, number] {
  if (!LOCAL_DATE_PATTERN.test(localDate)) {
    throw new Error(`Data local inválida: ${localDate}`);
  }

  const [year, month, day] = localDate.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new Error(`Data local inexistente: ${localDate}`);
  }

  return [year, month, day];
}

export function assertLocalDate(value: string): asserts value is LocalDate {
  dateParts(value as LocalDate);
}

export function assertLocalDateTime(value: string): asserts value is LocalDateTime {
  if (!LOCAL_DATE_TIME_PATTERN.test(value)) {
    throw new Error(`Data e hora local inválidas: ${value}`);
  }
  assertLocalDate(value.slice(0, 10));
  const [hours, minutes, seconds = "0"] = value.slice(11).split(":");
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) {
    throw new Error(`Data e hora local inexistentes: ${value}`);
  }
}

export function todayInTimeZone(
  timeZone: string = APP_TIME_ZONE,
  instant = new Date(),
): LocalDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}` as LocalDate;
}

export function localTimeInTimeZone(
  timeZone = APP_TIME_ZONE,
  instant = new Date(),
): `${number}:${number}` {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("hour")}:${values.get("minute")}` as `${number}:${number}`;
}

export function shiftLocalDate(localDate: LocalDate, deltaDays: number): LocalDate {
  const [year, month, day] = dateParts(localDate);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return [
    shifted.getUTCFullYear().toString().padStart(4, "0"),
    (shifted.getUTCMonth() + 1).toString().padStart(2, "0"),
    shifted.getUTCDate().toString().padStart(2, "0"),
  ].join("-") as LocalDate;
}

export function inclusiveDateWindow(
  end: LocalDate,
  days = 60,
): InclusiveDateWindow {
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("A janela precisa ter entre 1 e 365 dias civis inclusivos.");
  }
  return { start: shiftLocalDate(end, -(days - 1)), end, days };
}

export function isWithinInclusiveWindow(
  localDate: LocalDate,
  window: InclusiveDateWindow,
): boolean {
  return localDate >= window.start && localDate <= window.end;
}

export function calendarDayCount(start: LocalDate, end: LocalDate): number {
  const [startYear, startMonth, startDay] = dateParts(start);
  const [endYear, endMonth, endDay] = dateParts(end);
  const milliseconds =
    Date.UTC(endYear, endMonth - 1, endDay) -
    Date.UTC(startYear, startMonth - 1, startDay);
  return Math.floor(milliseconds / 86_400_000) + 1;
}

export function compareLocalDateTimes(left: LocalDateTime, right: LocalDateTime): number {
  assertLocalDateTime(left);
  assertLocalDateTime(right);
  const normalizedLeft = left.length === 16 ? `${left}:00` : left;
  const normalizedRight = right.length === 16 ? `${right}:00` : right;
  return normalizedLeft.localeCompare(normalizedRight);
}

export function localDateFromDateTime(value: LocalDateTime): LocalDate {
  assertLocalDateTime(value);
  return value.slice(0, 10) as LocalDate;
}

export function combineLocalDateAndTime(
  localDate: LocalDate,
  localTime: LocalTime,
): LocalDateTime {
  assertLocalDate(localDate);
  const value = `${localDate}T${localTime}` as LocalDateTime;
  assertLocalDateTime(value);
  return value;
}

function civilMilliseconds(value: LocalDateTime): number {
  assertLocalDateTime(value);
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hours = 0, minutes = 0, seconds = 0] = time.split(":").map(Number);
  return Date.UTC(year, month - 1, day, hours, minutes, seconds);
}

/**
 * Resolves a clock-only departure against the confirmed span of its shift.
 *
 * An overnight shift has two plausible calendar dates for a clock such as
 * 06:45. Prefer a candidate inside the scheduled interval; otherwise choose
 * the candidate closest to the scheduled end. This keeps an early 23:00 exit
 * on the start date while placing a normal morning exit on the end date.
 */
export function resolveShiftDepartureLocalDateTime(
  scheduledStartLocal: LocalDateTime,
  scheduledEndLocal: LocalDateTime,
  departureTimeLocal: LocalTime,
): LocalDateTime {
  assertLocalDateTime(scheduledStartLocal);
  assertLocalDateTime(scheduledEndLocal);
  const startMilliseconds = civilMilliseconds(scheduledStartLocal);
  const endMilliseconds = civilMilliseconds(scheduledEndLocal);
  if (endMilliseconds < startMilliseconds) {
    throw new Error("O fim previsto da jornada não pode anteceder o início.");
  }

  const startDate = localDateFromDateTime(scheduledStartLocal);
  const endDate = localDateFromDateTime(scheduledEndLocal);
  const candidateDates = startDate === endDate ? [startDate] : [startDate, endDate];
  const candidates = candidateDates.map((localDate) => {
    const value = combineLocalDateAndTime(localDate, departureTimeLocal);
    return { value, milliseconds: civilMilliseconds(value) };
  });
  const candidatesInsideShift = candidates.filter(
    ({ milliseconds }) =>
      milliseconds >= startMilliseconds && milliseconds <= endMilliseconds,
  );
  const rankedCandidates = (
    candidatesInsideShift.length > 0 ? candidatesInsideShift : candidates
  ).sort((left, right) => {
    const leftDistance = Math.abs(endMilliseconds - left.milliseconds);
    const rightDistance = Math.abs(endMilliseconds - right.milliseconds);
    return leftDistance === rightDistance
      ? right.milliseconds - left.milliseconds
      : leftDistance - rightDistance;
  });

  return rankedCandidates[0].value;
}
