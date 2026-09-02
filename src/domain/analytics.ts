import {
  inclusiveDateWindow,
  isWithinInclusiveWindow,
  shiftLocalDate,
} from "./dates";
import {
  buildMedicationTrail,
  isCanonicalMedicationRegimen,
} from "./medication";
import { financeSubscriptionIsConfirmedActive } from "./finance";
import { isLaboratoryPanelPayload } from "./laboratory";
import type {
  Domain,
  InclusiveDateWindow,
  LocalDate,
  MentorEntity,
} from "./model";

/**
 * Deterministic, local-first analytics for Mentor Bauer.
 *
 * This module deliberately knows nothing about React, IndexedDB, or language
 * models. It receives immutable entity snapshots and returns reproducible
 * descriptive summaries. Missing data is never coerced to zero or absence.
 */

export const ANALYTICS_DOMAINS = [
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
] as const satisfies readonly Domain[];

export type AnalyticsDomain = (typeof ANALYTICS_DOMAINS)[number];
export type MetricState = "insufficient" | "emerging" | "preferred";
export type MetricUnit =
  | "count"
  | "milliliters"
  | "minutes"
  | "hours"
  | "percent"
  | "score"
  | "BRL_minor";

export interface CompletenessEvidence {
  known: number;
  confirmedAbsences: number;
  unknown: number;
  invalid: number;
  notApplicable: number;
  eligible: number;
  completeness: number | null;
}

export interface AnalyticsMetric {
  key: string;
  label: string;
  value: number | null;
  unit: MetricUnit;
  /** Number of explicit observations supporting the value. */
  n: number;
  /** Eligible observations whose value is unknown or invalid. */
  missing: number;
  /** Explicit absences included in n, never inferred from missing data. */
  confirmedAbsences: number;
  completeness: number | null;
  state: MetricState;
  description: string;
  interpretation: "descriptive_only";
}

export interface DomainAnalyticsSummary {
  domain: AnalyticsDomain;
  window: InclusiveDateWindow;
  n: number;
  observedDays: number;
  missingDays: number;
  confirmedAbsences: number;
  completeness: CompletenessEvidence;
  metrics: AnalyticsMetric[];
  caveat: "Dados descritivos; associações não estabelecem causalidade.";
}

export interface PeriodValueAggregate {
  key: string;
  start: LocalDate;
  end: LocalDate;
  n: number;
  sum: number;
  average: number;
  minimum: number;
  maximum: number;
}

export interface ActivityAggregate {
  key: string;
  start: LocalDate;
  end: LocalDate;
  n: number;
  observedDays: number;
  byDomain: Record<AnalyticsDomain, number>;
}

export interface NextActionCandidate {
  id: string;
  domain: AnalyticsDomain;
  priority: number;
  title: string;
  reason: string;
  evidence: {
    metricKey: string;
    window: InclusiveDateWindow;
    value: number | null;
    n: number;
    missing: number;
    confirmedAbsences: number;
    completeness: number | null;
    state: MetricState;
    /** Every interpretation introduced by the rule, kept inspectable. */
    inferences: string[];
    limits: "no_diagnosis_no_causality_no_medication_change";
  };
  reversible: true;
  optional: true;
}

export interface AnalyticsReport {
  window: InclusiveDateWindow;
  n: number;
  observedDays: number;
  missingDays: number;
  completeness: CompletenessEvidence;
  domains: Record<AnalyticsDomain, DomainAnalyticsSummary>;
  activity: {
    weekly: ActivityAggregate[];
    monthly: ActivityAggregate[];
  };
  nextActions: NextActionCandidate[];
  interpretationPolicy: "descriptive_only_no_causality";
}

export interface AnalyticsOptions {
  endLocalDate: LocalDate;
  days?: number;
  datasetId?: string;
}

type UnknownRecord = Record<string, unknown>;
type ReadingState =
  | "known"
  | "confirmed_absent"
  | "unknown"
  | "invalid"
  | "not_applicable";

interface Reading<T> {
  state: ReadingState;
  value?: T;
}

interface MetricInput {
  key: string;
  label: string;
  value: number | null;
  unit: MetricUnit;
  n: number;
  missing?: number;
  confirmedAbsences?: number;
  description: string;
}

const KNOWLEDGE_STATES = new Set<ReadingState>([
  "known",
  "confirmed_absent",
  "unknown",
  "invalid",
  "not_applicable",
]);

const CAUSALITY_CAVEAT =
  "Dados descritivos; associações não estabelecem causalidade." as const;

const MINUTE_MILLISECONDS = 60_000;
const DAY_MILLISECONDS = 86_400_000;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeState(value: unknown): Reading<unknown> {
  if (value === undefined || value === null) return { state: "unknown" };
  if (!isRecord(value) || !KNOWLEDGE_STATES.has(value.state as ReadingState)) {
    return { state: "known", value };
  }
  const state = value.state as ReadingState;
  if (state === "known") {
    return Object.hasOwn(value, "value")
      ? { state, value: value.value }
      : { state: "invalid" };
  }
  return { state };
}

function getPath(record: UnknownRecord, path: string): unknown {
  let current: unknown = record;
  for (const part of path.split(".")) {
    if (!isRecord(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function hasAnyPath(record: UnknownRecord, paths: readonly string[]): boolean {
  return paths.some((path) => getPath(record, path) !== undefined);
}

function readField<T>(
  record: UnknownRecord,
  paths: readonly string[],
  parser: (value: unknown) => T | null,
): Reading<T> {
  // O primeiro campo presente é a fonte escolhida; um alias não repara desconhecido ou inválido.
  for (const path of paths) {
    const raw = getPath(record, path);
    if (raw === undefined) continue;
    const normalized = normalizeState(raw);
    if (normalized.state !== "known") return { state: normalized.state };
    const parsed = parser(normalized.value);
    return parsed !== null ? { state: "known", value: parsed } : { state: "invalid" };
  }
  return { state: "unknown" };
}

function readNumber(record: UnknownRecord, paths: readonly string[]): Reading<number> {
  return readField(record, paths, finiteNumber);
}

function readBoundedNumber(
  record: UnknownRecord,
  paths: readonly string[],
  minimum: number,
  maximum: number,
): Reading<number> {
  const reading = readField(record, paths, (value) =>
    typeof value === "number" && Number.isFinite(value) ? value : null,
  );
  return reading.state === "known" &&
    (reading.value! < minimum || reading.value! > maximum)
    ? { state: "invalid" }
    : reading;
}

function readString(record: UnknownRecord, paths: readonly string[]): Reading<string> {
  return readField(record, paths, (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  });
}

function readEnumString<T extends string>(
  record: UnknownRecord,
  paths: readonly string[],
  allowed: readonly T[],
): Reading<T> {
  return readField(record, paths, (value) =>
    typeof value === "string" && allowed.includes(value as T)
      ? value as T
      : null
  );
}

function readBoolean(record: UnknownRecord, paths: readonly string[]): Reading<boolean> {
  return readField(record, paths, (value) => {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "sim", "present", "presente", "completed", "done"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "não", "nao", "absent", "ausente"].includes(normalized)) {
      return false;
    }
    return null;
  });
}

function readStringArray(
  record: UnknownRecord,
  paths: readonly string[],
): Reading<string[]> {
  return readField(record, paths, (value) => {
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) {
      return value.split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
    }
    return null;
  });
}

function readRecordArray(
  record: UnknownRecord,
  paths: readonly string[],
): Reading<UnknownRecord[]> {
  return readField(record, paths, (value) => {
    if (!Array.isArray(value) || !value.every(isRecord)) return null;
    return value;
  });
}

function eventPayload(entity: MentorEntity): UnknownRecord {
  return isRecord(entity.payload) ? entity.payload : {};
}

function eventKind(payload: UnknownRecord): string {
  const reading = readString(payload, ["eventKind", "kind", "eventType", "category"]);
  return reading.state === "known" ? reading.value!.toLowerCase() : "";
}

function isUnstructuredNote(payload: UnknownRecord): boolean {
  const kind = eventKind(payload);
  return kind === "domain-note" || kind === "note" || kind.endsWith("-note");
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function average(values: readonly number[]): number | null {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values: readonly number[]): number | null {
  const mean = average(values);
  if (mean === null) return null;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function metricState(n: number): MetricState {
  return n >= 30 ? "preferred" : n >= 14 ? "emerging" : "insufficient";
}

function makeMetric(input: MetricInput): AnalyticsMetric {
  const missing = Math.max(0, Math.trunc(input.missing ?? 0));
  const n = Math.max(0, Math.trunc(input.n));
  const confirmedAbsences = Math.max(
    0,
    Math.min(n, Math.trunc(input.confirmedAbsences ?? 0)),
  );
  const denominator = n + missing;
  return {
    key: input.key,
    label: input.label,
    value: input.value === null || !Number.isFinite(input.value)
      ? null
      : round(input.value),
    unit: input.unit,
    n,
    missing,
    confirmedAbsences,
    completeness: denominator ? round(n / denominator, 4) : null,
    state: metricState(n),
    description: input.description,
    interpretation: "descriptive_only",
  };
}

function emptyCompleteness(): CompletenessEvidence {
  return {
    known: 0,
    confirmedAbsences: 0,
    unknown: 0,
    invalid: 0,
    notApplicable: 0,
    eligible: 0,
    completeness: null,
  };
}

function scanCompleteness(value: unknown, result = emptyCompleteness()): CompletenessEvidence {
  if (value === undefined || value === null) {
    result.unknown += 1;
    return result;
  }
  if (isRecord(value) && KNOWLEDGE_STATES.has(value.state as ReadingState)) {
    const state = value.state as ReadingState;
    if (state === "known") {
      if (Object.hasOwn(value, "value")) result.known += 1;
      else result.invalid += 1;
    } else if (state === "confirmed_absent") result.confirmedAbsences += 1;
    else if (state === "unknown") result.unknown += 1;
    else if (state === "invalid") result.invalid += 1;
    else result.notApplicable += 1;
    return result;
  }
  if (Array.isArray(value)) {
    result.known += 1;
    return result;
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value).sort()) scanCompleteness(value[key], result);
    return result;
  }
  result.known += 1;
  return result;
}

function finalizeCompleteness(result: CompletenessEvidence): CompletenessEvidence {
  const eligible = result.known + result.confirmedAbsences + result.unknown + result.invalid;
  return {
    ...result,
    eligible,
    completeness: eligible
      ? round((result.known + result.confirmedAbsences) / eligible, 4)
      : null,
  };
}

function mergeCompleteness(items: readonly CompletenessEvidence[]): CompletenessEvidence {
  const merged = emptyCompleteness();
  for (const item of items) {
    merged.known += item.known;
    merged.confirmedAbsences += item.confirmedAbsences;
    merged.unknown += item.unknown;
    merged.invalid += item.invalid;
    merged.notApplicable += item.notApplicable;
  }
  return finalizeCompleteness(merged);
}

function semanticConfirmedAbsences(entities: readonly MentorEntity[]): number {
  let count = 0;
  for (const entity of entities) {
    const payload = eventPayload(entity);
    const payloadEvidence = finalizeCompleteness(scanCompleteness(payload));
    count += payloadEvidence.confirmedAbsences;
    const presence = readBoolean(payload, [
      "presence",
      "present",
      "symptomPresent",
      "headachePresent",
      "bruxismPresent",
    ]);
    if (presence.state === "known" && presence.value === false) count += 1;
    const attendance = readString(payload, ["attendance", "attendanceStatus"]);
    if (attendance.state === "known" && attendance.value === "absent_confirmed") count += 1;
  }
  return count;
}

function uniqueDays(entities: readonly MentorEntity[]): number {
  return new Set(entities.map((entity) => entity.localDate)).size;
}

function latestByLocalDate(entities: readonly MentorEntity[]): MentorEntity[] {
  const latest = new Map<LocalDate, MentorEntity>();
  for (const entity of entities) {
    const previous = latest.get(entity.localDate);
    if (!previous ||
      entity.occurredAtUTC > previous.occurredAtUTC ||
      (entity.occurredAtUTC === previous.occurredAtUTC && entity.revision > previous.revision) ||
      (entity.occurredAtUTC === previous.occurredAtUTC &&
        entity.revision === previous.revision && entity.id > previous.id)) {
      latest.set(entity.localDate, entity);
    }
  }
  return [...latest.values()].sort((left, right) =>
    left.localDate.localeCompare(right.localDate) || left.id.localeCompare(right.id),
  );
}

function makeDomainSummary(
  domain: AnalyticsDomain,
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
  metrics: AnalyticsMetric[],
): DomainAnalyticsSummary {
  const observedDays = uniqueDays(entities);
  const completeness = mergeCompleteness(
    entities.map((entity) => finalizeCompleteness(scanCompleteness(eventPayload(entity)))),
  );
  return {
    domain,
    window,
    n: entities.length,
    observedDays,
    missingDays: Math.max(0, window.days - observedDays),
    confirmedAbsences: semanticConfirmedAbsences(entities),
    completeness,
    metrics,
    caveat: CAUSALITY_CAVEAT,
  };
}

/** Parse a local clock without invoking Date or a device time zone. */
export function clockMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? "0");
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 60 + minutes + seconds / 60;
}

function civilMinute(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0"] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day ||
    candidate.getUTCHours() !== hour ||
    candidate.getUTCMinutes() !== minute ||
    candidate.getUTCSeconds() !== second
  ) return null;
  return candidate.getTime() / MINUTE_MILLISECONDS;
}

/**
 * Duration between clock-only or full local date-time values. Clock-only spans
 * may cross midnight; full date-times must be chronologically ordered.
 */
export function durationMinutes(start: string, end: string): number | null {
  const startCivil = civilMinute(start);
  const endCivil = civilMinute(end);
  if (startCivil !== null || endCivil !== null) {
    if (startCivil === null || endCivil === null || endCivil < startCivil) return null;
    return round(endCivil - startCivil);
  }
  const startClock = clockMinutes(start);
  const endClock = clockMinutes(end);
  if (startClock === null || endClock === null) return null;
  return round(endClock >= startClock ? endClock - startClock : endClock + 1_440 - startClock);
}

export function shiftDurationMinutes(startLocal: string, endLocal: string): number | null {
  return durationMinutes(startLocal, endLocal);
}

/** Signed shortest clock delta, useful for a medication or appointment time. */
export function clockDeltaMinutes(actual: string, scheduled: string): number | null {
  const actualMinutes = clockMinutes(actual);
  const scheduledMinutes = clockMinutes(scheduled);
  if (actualMinutes === null || scheduledMinutes === null) return null;
  let delta = actualMinutes - scheduledMinutes;
  if (delta > 720) delta -= 1_440;
  if (delta < -720) delta += 1_440;
  return round(delta);
}

export function signedDateTimeDeltaMinutes(actual: string, scheduled: string): number | null {
  const actualMinute = civilMinute(actual);
  const scheduledMinute = civilMinute(scheduled);
  return actualMinute === null || scheduledMinute === null
    ? null
    : round(actualMinute - scheduledMinute);
}

/** Minutes overlapping the conventional 22:00–05:00 night interval. */
export function nightOverlapMinutes(startLocal: string, endLocal: string): number | null {
  const start = civilMinute(startLocal);
  const end = civilMinute(endLocal);
  if (start === null || end === null || end < start) return null;
  const firstDay = Math.floor(start / 1_440) - 1;
  const lastDay = Math.floor(end / 1_440) + 1;
  let overlap = 0;
  for (let day = firstDay; day <= lastDay; day += 1) {
    const nightStart = day * 1_440 + 22 * 60;
    const nightEnd = (day + 1) * 1_440 + 5 * 60;
    overlap += Math.max(0, Math.min(end, nightEnd) - Math.max(start, nightStart));
  }
  return round(overlap);
}

/** Parse a user-entered BRL amount into integer centavos without float math. */
export function parseBRLToMinor(value: string): number | null {
  let normalized = value.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!normalized) return null;
  let sign = 1;
  if (normalized.startsWith("-")) {
    sign = -1;
    normalized = normalized.slice(1);
  } else if (normalized.startsWith("+")) {
    normalized = normalized.slice(1);
  }
  if (!normalized || !/^[\d.,]+$/.test(normalized)) return null;
  let integerPart: string;
  let fractionPart = "";
  if (normalized.includes(",")) {
    const parts = normalized.split(",");
    if (parts.length !== 2 || !/^\d{0,2}$/.test(parts[1])) return null;
    integerPart = parts[0].replace(/\./g, "");
    fractionPart = parts[1];
  } else {
    const dotParts = normalized.split(".");
    if (dotParts.length === 2 && dotParts[1].length <= 2) {
      integerPart = dotParts[0];
      fractionPart = dotParts[1];
    } else {
      integerPart = normalized.replace(/\./g, "");
    }
  }
  if (!/^\d+$/.test(integerPart || "0") || !/^\d{0,2}$/.test(fractionPart)) return null;
  const reais = Number(integerPart || "0");
  const centavos = Number(fractionPart.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(reais) || !Number.isSafeInteger(centavos)) return null;
  const amountMinor = reais * 100 + centavos;
  return Number.isSafeInteger(amountMinor) ? sign * amountMinor : null;
}

export function moneyToMinor(value: unknown): number | null {
  const normalized = normalizeState(value);
  if (normalized.state !== "known") return null;
  if (!isRecord(normalized.value)) return null;
  if (normalized.value.currency !== "BRL") return null;
  const amountMinor = normalized.value.amountMinor;
  return typeof amountMinor === "number" && Number.isSafeInteger(amountMinor)
    ? amountMinor
    : null;
}

export function sumBRLMinor(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) throw new Error("Valor em centavos BRL inválido.");
    sum += value;
    if (!Number.isSafeInteger(sum)) throw new Error("Soma BRL excedeu o limite seguro.");
  }
  return sum;
}

export function formatBRLMinor(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor)) throw new Error("Valor em centavos BRL inválido.");
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amountMinor / 100);
}

function localDateParts(localDate: LocalDate): [number, number, number] {
  const [year, month, day] = localDate.split("-").map(Number);
  return [year, month, day];
}

function weekStart(localDate: LocalDate): LocalDate {
  const [year, month, day] = localDateParts(localDate);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return shiftLocalDate(localDate, -daysSinceMonday);
}

function monthStart(localDate: LocalDate): LocalDate {
  return `${localDate.slice(0, 7)}-01` as LocalDate;
}

function monthEnd(localDate: LocalDate): LocalDate {
  const [year, month] = localDateParts(localDate);
  const end = new Date(Date.UTC(year, month, 0));
  return `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(end.getUTCDate()).padStart(2, "0")}` as LocalDate;
}

function aggregateDatedValues(
  items: readonly { localDate: LocalDate; value: number }[],
  period: "week" | "month",
): PeriodValueAggregate[] {
  const groups = new Map<string, { start: LocalDate; end: LocalDate; values: number[] }>();
  for (const item of items) {
    if (!Number.isFinite(item.value)) continue;
    const start = period === "week" ? weekStart(item.localDate) : monthStart(item.localDate);
    const end = period === "week" ? shiftLocalDate(start, 6) : monthEnd(item.localDate);
    const current = groups.get(start) ?? { start, end, values: [] };
    current.values.push(item.value);
    groups.set(start, current);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => ({
      key,
      start: group.start,
      end: group.end,
      n: group.values.length,
      sum: round(group.values.reduce((sum, value) => sum + value, 0)),
      average: round(average(group.values) ?? 0),
      minimum: Math.min(...group.values),
      maximum: Math.max(...group.values),
    }));
}

export function aggregateByWeek(
  items: readonly { localDate: LocalDate; value: number }[],
): PeriodValueAggregate[] {
  return aggregateDatedValues(items, "week");
}

export function aggregateByMonth(
  items: readonly { localDate: LocalDate; value: number }[],
): PeriodValueAggregate[] {
  return aggregateDatedValues(items, "month");
}

function knownValue<T>(reading: Reading<T>): T | null {
  return reading.state === "known" ? reading.value! : null;
}

function countMissing(readings: readonly Reading<unknown>[]): number {
  return readings.filter(({ state }) => state === "unknown" || state === "invalid").length;
}

function countKnown(readings: readonly Reading<unknown>[]): number {
  return readings.filter(({ state }) => state === "known" || state === "confirmed_absent").length;
}

function readMoney(record: UnknownRecord, paths: readonly string[]): Reading<number> {
  return readField(record, paths, (value) => {
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
    return moneyToMinor(value);
  });
}

function sumStringItems(readings: readonly Reading<string[]>[]): number {
  return readings.reduce(
    (sum, reading) => sum + (reading.state === "known" ? reading.value!.length : 0),
    0,
  );
}

function localDateDifference(start: LocalDate, end: LocalDate): number {
  const [startYear, startMonth, startDay] = localDateParts(start);
  const [endYear, endMonth, endDay] = localDateParts(end);
  return Math.trunc(
    (Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)) /
      DAY_MILLISECONDS,
  );
}

function readDurationFromPayload(
  payload: UnknownRecord,
  directPaths: readonly string[],
  startPaths: readonly string[],
  endPaths: readonly string[],
  allowZero = false,
  legacyUnknownClockPath?: string,
): Reading<number> {
  const direct = readNumber(payload, directPaths);
  if (direct.state === "known") {
    return direct.value! > 0 || (allowZero && direct.value === 0)
      ? direct
      : { state: "invalid" };
  }
  const firstDirectPath = directPaths.find((path) => getPath(payload, path) !== undefined);
  const firstDirectValue = firstDirectPath ? getPath(payload, firstDirectPath) : undefined;
  // Só o placeholder legado documentado pode derivar dos relógios. Campo canônico é terminal.
  const legacyClockDerivation = firstDirectPath === legacyUnknownClockPath && isRecord(firstDirectValue) && firstDirectValue.state === "unknown" && firstDirectValue.reason === "not_recorded";
  if (firstDirectPath && !legacyClockDerivation) return direct;
  const start = readString(payload, startPaths);
  const end = readString(payload, endPaths);
  if (start.state === "known" && end.state === "known") {
    const value = durationMinutes(start.value!, end.value!);
    return value === null || value < 0 || (!allowZero && value === 0)
      ? { state: "invalid" }
      : { state: "known", value };
  }
  if (start.state === "confirmed_absent" || end.state === "confirmed_absent") {
    return { state: "confirmed_absent" };
  }
  if (start.state === "not_applicable" || end.state === "not_applicable") {
    return { state: "not_applicable" };
  }
  return start.state === "invalid" || end.state === "invalid"
    ? { state: "invalid" }
    : { state: "unknown" };
}

function summarizeInternato(
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
): DomainAnalyticsSummary {
  const shifts = entities.filter((entity) => {
    const payload = eventPayload(entity);
    return entity.type === "internato.shift" || hasAnyPath(payload, [
      "scheduledStartLocal",
      "schedule.startLocal",
      "arrivalLocal",
      "actual.arrivalLocal",
    ]);
  });
  const attendanceReadings = shifts.map((entity) =>
    readString(eventPayload(entity), ["attendance", "attendanceStatus", "actual.attendance"]),
  );
  const absentStatuses = new Set(["absent_confirmed", "cancelled", "swapped", "excused"]);
  const confirmedAbsences = attendanceReadings.filter(
    (reading) => reading.state === "confirmed_absent" ||
      (reading.state === "known" && absentStatuses.has(reading.value!.toLowerCase())),
  ).length;
  const requiredShifts = shifts.filter((_, index) => {
    const attendance = attendanceReadings[index];
    return !(
      attendance.state === "confirmed_absent" ||
      (attendance.state === "known" && absentStatuses.has(attendance.value!.toLowerCase()))
    );
  });

  const arrivalDeltas: number[] = [];
  const departureDeltas: number[] = [];
  const workedMinutes: number[] = [];
  const nightMinutes: number[] = [];
  let arrivalMissing = 0;
  let departureMissing = 0;
  let workSpanMissing = 0;
  let nightSpanMissing = 0;

  for (const entity of requiredShifts) {
    const payload = eventPayload(entity);
    const scheduledStart = readString(payload, ["scheduledStartLocal", "schedule.startLocal"]);
    const scheduledEnd = readString(payload, ["scheduledEndLocal", "schedule.endLocal"]);
    const arrival = readString(payload, ["arrivalLocal", "actual.arrivalLocal", "arrival"]);
    const departure = readString(payload, ["departureLocal", "actual.departureLocal", "departure"]);
    if (scheduledStart.state === "known" && arrival.state === "known") {
      const delta = signedDateTimeDeltaMinutes(arrival.value!, scheduledStart.value!);
      if (delta !== null) arrivalDeltas.push(delta);
      else arrivalMissing += 1;
    } else arrivalMissing += 1;
    if (scheduledEnd.state === "known" && departure.state === "known") {
      const delta = signedDateTimeDeltaMinutes(departure.value!, scheduledEnd.value!);
      if (delta !== null) departureDeltas.push(delta);
      else departureMissing += 1;
    } else departureMissing += 1;

    if (arrival.state === "known" && departure.state === "known") {
      const gross = durationMinutes(arrival.value!, departure.value!);
      const breakStart = readString(payload, ["breakStartLocal", "break.startLocal"]);
      const breakEnd = readString(payload, ["breakEndLocal", "break.endLocal"]);
      const explicitNoBreak = [breakStart.state, breakEnd.state].every((state) =>
        state === "confirmed_absent" || state === "not_applicable"
      );
      const breakMinutes = breakStart.state === "known" && breakEnd.state === "known"
        ? durationMinutes(breakStart.value!, breakEnd.value!)
        : explicitNoBreak ? 0 : null;
      if (gross !== null) {
        const night = nightOverlapMinutes(arrival.value!, departure.value!);
        if (night !== null) nightMinutes.push(night);
        else nightSpanMissing += 1;
      } else nightSpanMissing += 1;
      if (gross !== null && breakMinutes !== null && breakMinutes <= gross) {
        workedMinutes.push(gross - breakMinutes);
      } else workSpanMissing += 1;
    } else {
      workSpanMissing += 1;
      nightSpanMissing += 1;
    }
  }

  const topicReadings = entities.map((entity) => readStringArray(eventPayload(entity), [
    "topicsSeen",
    "topics",
    "clinicalTopics",
    "exposures.topics",
    "contentSeen",
    "conteudos",
  ]));
  const lateCount = arrivalDeltas.filter((value) => value > 0).length;
  const earlyCount = arrivalDeltas.filter((value) => value < 0).length;
  return makeDomainSummary("internato", entities, window, [
    makeMetric({
      key: "scheduled_shifts",
      label: "Jornadas com escala",
      value: shifts.length,
      unit: "count",
      n: shifts.length,
      description: "Jornadas explicitamente previstas ou registradas na janela.",
    }),
    makeMetric({
      key: "actual_attendance_known",
      label: "Jornadas com resultado conhecido",
      value: countKnown(attendanceReadings) ? countKnown(attendanceReadings) : null,
      unit: "count",
      n: countKnown(attendanceReadings),
      missing: countMissing(attendanceReadings),
      confirmedAbsences,
      description: "Conta presença ou ausência explicitamente registrada; a escala planejada não preenche o realizado.",
    }),
    makeMetric({
      key: "attendance_confirmed_percent",
      label: "Presença/ausência confirmada",
      value: shifts.length ? (countKnown(attendanceReadings) / shifts.length) * 100 : null,
      unit: "percent",
      n: countKnown(attendanceReadings),
      missing: countMissing(attendanceReadings),
      confirmedAbsences,
      description: "Escala planejada não é convertida em presença. Ausências entram somente quando explícitas.",
    }),
    makeMetric({
      key: "arrival_delta_median_minutes",
      label: "Delta mediano de chegada",
      value: median(arrivalDeltas),
      unit: "minutes",
      n: arrivalDeltas.length,
      missing: arrivalMissing,
      description: "Negativo significa antecedência; positivo significa atraso.",
    }),
    makeMetric({
      key: "late_arrivals",
      label: "Chegadas após o horário",
      value: lateCount,
      unit: "count",
      n: arrivalDeltas.length,
      missing: arrivalMissing,
      description: "Conta apenas chegada real comparável com horário previsto.",
    }),
    makeMetric({
      key: "early_arrivals",
      label: "Chegadas antecipadas",
      value: earlyCount,
      unit: "count",
      n: arrivalDeltas.length,
      missing: arrivalMissing,
      description: "Antecedência explicitamente observada, sem classificar como melhor ou pior.",
    }),
    makeMetric({
      key: "departure_delta_median_minutes",
      label: "Delta mediano de saída",
      value: median(departureDeltas),
      unit: "minutes",
      n: departureDeltas.length,
      missing: departureMissing,
      description: "Compara saída real e prevista; plantões que cruzam meia-noite mantêm suas datas.",
    }),
    makeMetric({
      key: "worked_minutes",
      label: "Tempo líquido registrado",
      value: workedMinutes.length ? workedMinutes.reduce((sum, value) => sum + value, 0) : null,
      unit: "minutes",
      n: workedMinutes.length,
      missing: workSpanMissing,
      description: "Exige chegada e saída reais; intervalo só é descontado quando ambas as pontas existem.",
    }),
    makeMetric({
      key: "night_minutes",
      label: "Minutos noturnos registrados",
      value: nightMinutes.length ? nightMinutes.reduce((sum, value) => sum + value, 0) : null,
      unit: "minutes",
      n: nightMinutes.length,
      missing: nightSpanMissing,
      description: "Sobreposição descritiva com 22:00–05:00 em jornadas realizadas.",
    }),
    makeMetric({
      key: "clinical_topics",
      label: "Exposições temáticas registradas",
      value: sumStringItems(topicReadings),
      unit: "count",
      n: topicReadings.filter(({ state }) => state === "known").length,
      missing: 0,
      description: "Tópicos informados; notas sem lista de tópicos não viram lacuna clínica.",
    }),
  ]);
}

function isStudySession(payload: UnknownRecord): boolean {
  if (isUnstructuredNote(payload)) return false;
  const kind = eventKind(payload);
  return ["study-session", "study_session"].includes(kind) || hasAnyPath(payload, [
    "minutes",
    "actualDurationMinutes",
    "durationMinutes",
    "questionsAnswered",
    "questions.attempted",
    "correctAnswers",
    "completed",
  ]);
}

// Compartilhado pelo relatório e pelas curvas: o mesmo registro produz o mesmo valor.
function readingWasDerived(payload: UnknownRecord, directPaths: readonly string[], reading: Reading<number>): boolean {
  if (reading.state !== "known") return false;
  const path = directPaths.find((item) => getPath(payload, item) !== undefined);
  if (!path) return true;
  const raw = getPath(payload, path);
  return isRecord(raw) && (raw.state === "known" ? raw.source === "derived" : true);
}
export function readStudyDuration(payload: UnknownRecord): Reading<number> & { derived: boolean } {
  const directPaths = ["actualDurationMinutes", "minutes", "actualMinutes", "durationMinutes", "duration.actualMinutes"];
  const reading = readDurationFromPayload(payload, directPaths,
    ["startedAtLocal", "startLocal", "session.startLocal"],
    ["endedAtLocal", "endLocal", "session.endLocal"], true, "minutes");
  return { ...reading, derived: readingWasDerived(payload, directPaths, reading) };
}

function summarizeEstudos(
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
): DomainAnalyticsSummary {
  const sessions = entities.filter((entity) => isStudySession(eventPayload(entity)));
  const actualDurations = sessions.map((entity) => readStudyDuration(eventPayload(entity)));
  const plannedDurations = sessions.map((entity) => readNumber(eventPayload(entity), [
    "plannedDurationMinutes",
    "plannedMinutes",
    "duration.plannedMinutes",
  ]));
  const completion = sessions.map((entity) => readBoolean(eventPayload(entity), [
    "completed",
    "completion.completed",
    "status",
  ]));
  const questionPairs = sessions.map((entity) => {
    const payload = eventPayload(entity);
    return {
      answered: readNumber(payload, ["questions.attempted", "questionsAnswered", "questions.total", "questionCount"]),
      correct: readNumber(payload, ["questions.correct", "correctAnswers", "correctCount"]),
    };
  });
  const knownActual = actualDurations.flatMap((reading) =>
    reading.state === "known" && reading.value! >= 0 ? [reading.value!] : [],
  );
  const knownPlanned = plannedDurations.flatMap((reading) =>
    reading.state === "known" && reading.value! >= 0 ? [reading.value!] : [],
  );
  const comparableQuestionPairs = questionPairs.flatMap((pair) => {
    if (pair.answered.state !== "known" || pair.correct.state !== "known") return [];
    const answered = pair.answered.value!;
    const correct = pair.correct.value!;
    return answered >= 0 && correct >= 0 && correct <= answered
      ? [{ answered, correct }]
      : [];
  });
  const answered = comparableQuestionPairs.reduce((sum, pair) => sum + pair.answered, 0);
  const correct = comparableQuestionPairs.reduce((sum, pair) => sum + pair.correct, 0);
  const incomparableQuestionPairs = questionPairs.length - comparableQuestionPairs.length;
  const comparableEstimates = sessions.flatMap((_, index) => {
    const actual = actualDurations[index];
    const planned = plannedDurations[index];
    return actual.state === "known" && planned.state === "known"
      ? [actual.value! - planned.value!]
      : [];
  });
  const completedCount = completion.filter(
    (reading) => reading.state === "known" && reading.value === true,
  ).length;
  return makeDomainSummary("estudos", entities, window, [
    makeMetric({
      key: "focused_minutes",
      label: "Minutos de estudo registrados",
      value: knownActual.length ? knownActual.reduce((sum, value) => sum + value, 0) : null,
      unit: "minutes",
      n: knownActual.length,
      missing: countMissing(actualDurations),
      description: "Usa duração realizada; duração planejada nunca preenche a realizada.",
    }),
    makeMetric({
      key: "session_median_minutes",
      label: "Mediana por sessão",
      value: median(knownActual),
      unit: "minutes",
      n: knownActual.length,
      missing: countMissing(actualDurations),
      description: "Mediana das sessões com duração realizada.",
    }),
    makeMetric({
      key: "planned_minutes",
      label: "Minutos planejados",
      value: knownPlanned.length ? knownPlanned.reduce((sum, value) => sum + value, 0) : null,
      unit: "minutes",
      n: knownPlanned.length,
      missing: countMissing(plannedDurations),
      description: "Plano permanece separado do que foi realizado.",
    }),
    makeMetric({
      key: "estimate_delta_median_minutes",
      label: "Erro mediano de estimativa",
      value: median(comparableEstimates),
      unit: "minutes",
      n: comparableEstimates.length,
      missing: Math.max(0, sessions.length - comparableEstimates.length),
      description: "Real menos planejado em sessões com as duas durações.",
    }),
    makeMetric({
      key: "completed_sessions",
      label: "Sessões concluídas registradas",
      value: countKnown(completion) ? completedCount : null,
      unit: "count",
      n: countKnown(completion),
      missing: countMissing(completion),
      description: "Conta somente estados de conclusão explicitamente informados.",
    }),
    makeMetric({
      key: "completed_sessions_percent",
      label: "Sessões concluídas",
      value: countKnown(completion) ? (completedCount / countKnown(completion)) * 100 : null,
      unit: "percent",
      n: countKnown(completion),
      missing: countMissing(completion),
      description: "Base, Boa e Ouro podem ser metas válidas; conclusão não é um placar moral.",
    }),
    makeMetric({
      key: "question_accuracy_percent",
      label: "Acurácia em questões",
      value: answered > 0 ? (correct / answered) * 100 : null,
      unit: "percent",
      n: answered,
      missing: incomparableQuestionPairs,
      description: "Acertos divididos por questões respondidas somente em sessões com o par completo e válido; n é o número de questões comparáveis.",
    }),
  ]);
}

function normalizeMedicationConfirmation(value: string):
  | "on_time"
  | "late"
  | "taken"
  | "skipped"
  | "unknown" {
  const normalized = value.toLowerCase().replace(/[ -]/g, "_");
  if (normalized === "taken_on_time" || normalized === "on_time") return "on_time";
  if (normalized === "taken_late" || normalized === "late") return "late";
  if (normalized === "taken_time_recorded" || normalized === "taken_time_unknown" || normalized === "taken") return "taken";
  if (normalized === "skipped_confirmed" || normalized === "skipped") return "skipped";
  return "unknown";
}

function summarizeMedicamentos(
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
  allMedicationEntities: readonly MentorEntity[] = entities,
): DomainAnalyticsSummary {
  const doses = entities.filter((entity) => {
    const payload = eventPayload(entity);
    return !isUnstructuredNote(payload) && (entity.type === "medicamentos.confirmation" || [
      "dose-confirmation",
      "medication-confirmation",
      "medication-dose",
    ].includes(eventKind(payload)) || hasAnyPath(payload, ["confirmation"]));
  });
  const eventConfirmations = doses.map((entity) => {
    const reading = readString(eventPayload(entity), ["confirmation", "doseStatus", "status"]);
    return reading.state === "known"
      ? { state: "known" as const, value: normalizeMedicationConfirmation(reading.value!) }
      : reading;
  });
  const canonicalRegimens = allMedicationEntities.filter(isCanonicalMedicationRegimen);
  const canonicalDoseEvents = entities.filter(
    (entity): entity is MentorEntity<"medicamentos.confirmation"> =>
      entity.type === "medicamentos.confirmation",
  );
  const plannedSlots = [] as ReturnType<typeof buildMedicationTrail>["slots"];
  for (let localDate = window.start; localDate <= window.end; localDate = shiftLocalDate(localDate, 1)) {
    plannedSlots.push(...buildMedicationTrail(
      canonicalRegimens,
      canonicalDoseEvents,
      localDate,
    ).slots);
  }
  const plannedConfirmations = plannedSlots.map((slot): Reading<string> => {
    if (!slot.event) return { state: "unknown" };
    const normalized = normalizeMedicationConfirmation(slot.event.payload.confirmation);
    return normalized === "unknown"
      ? { state: "unknown" }
      : { state: "known", value: normalized };
  });
  // A canonical regimen gives the denominator: every planned slot is either
  // resolved or explicitly unknown. Legacy/unlinked events remain readable as
  // the fallback, but can never inflate a canonical adherence denominator.
  const confirmations = plannedSlots.length > 0
    ? plannedConfirmations
    : eventConfirmations;
  const knownConfirmations = confirmations.filter(
    (reading): reading is Reading<string> & { state: "known" } =>
      reading.state === "known" && reading.value !== "unknown",
  );
  const taken = knownConfirmations.filter(({ value }) => value !== "skipped");
  const skipped = knownConfirmations.filter(({ value }) => value === "skipped").length;
  const onTime = knownConfirmations.filter(({ value }) => value === "on_time").length;
  const explicitlyClassifiedTiming = knownConfirmations.filter(
    ({ value }) => value === "on_time" || value === "late",
  );
  const delays: number[] = [];
  let delayMissing = 0;
  for (const entity of doses) {
    const payload = eventPayload(entity);
    const scheduled = readString(payload, ["scheduledTimeLocal", "schedule.timeLocal", "scheduledTime"]);
    const actual = readString(payload, ["actualTimeLocal", "actual.timeLocal", "actualTime"]);
    const confirmation = readString(payload, ["confirmation", "doseStatus", "status"]);
    const normalized = confirmation.state === "known"
      ? normalizeMedicationConfirmation(confirmation.value!)
      : "unknown";
    if (normalized === "skipped") continue;
    if (scheduled.state === "known" && actual.state === "known") {
      const delta = clockDeltaMinutes(actual.value!, scheduled.value!);
      if (delta !== null) delays.push(delta);
      else delayMissing += 1;
    } else delayMissing += 1;
  }
  const stockDays = entities.map((entity) => readNumber(eventPayload(entity), [
    "stockDaysRemaining",
    "inventory.daysRemaining",
    "daysRemaining",
  ])).flatMap((reading) => reading.state === "known" && reading.value! >= 0 ? [reading.value!] : []);
  const stockEvents = entities.filter((entity) => {
    const payload = eventPayload(entity);
    return eventKind(payload) === "medication-stock" || hasAnyPath(payload, [
      "stock.quantity",
      "stock.refillAt",
    ]);
  });
  const stockQuantityReadings = stockEvents.map((entity) => readNumber(
    eventPayload(entity),
    ["stock.quantity", "stockQuantity", "inventory.quantity"],
  ));
  const stockQuantities = stockQuantityReadings.flatMap((reading) =>
    reading.state === "known" && reading.value! >= 0 ? [reading.value!] : [],
  );
  const refillThresholdReadings = stockEvents.map((entity) => readNumber(
    eventPayload(entity),
    ["stock.refillAt", "refillAt", "inventory.refillAt"],
  ));
  const refillThresholds = refillThresholdReadings.flatMap((reading) =>
    reading.state === "known" && reading.value! >= 0 ? [reading.value!] : [],
  );
  return makeDomainSummary("medicamentos", entities, window, [
    makeMetric({
      key: "planned_dose_slots",
      label: "Doses planejadas pelo regime informado",
      value: plannedSlots.length ? plannedSlots.length : null,
      unit: "count",
      n: plannedSlots.length,
      description: "Horários dos regimes ativos na janela; um slot sem registro continua desconhecido, nunca pulado.",
    }),
    makeMetric({
      key: "dose_confirmations",
      label: "Confirmações de dose",
      value: knownConfirmations.length ? knownConfirmations.length : null,
      unit: "count",
      n: knownConfirmations.length,
      missing: Math.max(0, confirmations.length - knownConfirmations.length),
      confirmedAbsences: skipped,
      description: "Estados explicitamente confirmados; notas e regimes não viram confirmações.",
    }),
    makeMetric({
      key: "dose_confirmation_percent",
      label: "Completude das doses registradas",
      value: confirmations.length
        ? (knownConfirmations.length / confirmations.length) * 100
        : null,
      unit: "percent",
      n: knownConfirmations.length,
      missing: Math.max(0, confirmations.length - knownConfirmations.length),
      confirmedAbsences: skipped,
      description: "Não registrado continua desconhecido; pulo entra somente quando confirmado.",
    }),
    makeMetric({
      key: "taken_doses",
      label: "Doses tomadas confirmadas",
      value: taken.length,
      unit: "count",
      n: knownConfirmations.length,
      missing: Math.max(0, confirmations.length - knownConfirmations.length),
      confirmedAbsences: skipped,
      description: "Tomadas explicitamente confirmadas, sem inferir adesão clínica.",
    }),
    makeMetric({
      key: "on_time_percent",
      label: "Tomadas no horário",
      value: explicitlyClassifiedTiming.length
        ? (onTime / explicitlyClassifiedTiming.length) * 100
        : null,
      unit: "percent",
      n: explicitlyClassifiedTiming.length,
      missing: Math.max(0, taken.length - explicitlyClassifiedTiming.length),
      description: "Só usa tomadas classificadas explicitamente como no horário ou atrasadas; ter relógio real não inventa uma janela terapêutica.",
    }),
    makeMetric({
      key: "delay_median_minutes",
      label: "Atraso mediano registrado",
      value: median(delays),
      unit: "minutes",
      n: delays.length,
      missing: delayMissing,
      description: "Delta entre horário real e previsto quando ambos existem; negativo indica antecedência.",
    }),
    makeMetric({
      key: "skipped_confirmed",
      label: "Doses puladas confirmadas",
      value: skipped,
      unit: "count",
      n: knownConfirmations.length,
      missing: Math.max(0, confirmations.length - knownConfirmations.length),
      confirmedAbsences: skipped,
      description: "Não registrado nunca é contado como dose pulada.",
    }),
    makeMetric({
      key: "stock_days_latest",
      label: "Estoque mais recente",
      value: stockDays.length ? stockDays.at(-1)! : null,
      unit: "count",
      n: stockDays.length,
      missing: Math.max(0, stockEvents.length - stockDays.length),
      description: "Somente dias de estoque explicitamente cadastrados; quantidade e limite de reposição nunca são convertidos em dias.",
    }),
    makeMetric({
      key: "stock_quantity_latest",
      label: "Quantidade de estoque mais recente",
      value: stockQuantities.length ? stockQuantities.at(-1)! : null,
      unit: "count",
      n: stockQuantities.length,
      missing: countMissing(stockQuantityReadings),
      description: "Contagem física informada, preservada na unidade cadastrada pelo usuário.",
    }),
    makeMetric({
      key: "stock_refill_threshold_latest",
      label: "Limite de reposição mais recente",
      value: refillThresholds.length ? refillThresholds.at(-1)! : null,
      unit: "count",
      n: refillThresholds.length,
      missing: countMissing(refillThresholdReadings),
      description: "Limite de quantidade escolhido pelo usuário; não é previsão automática de término.",
    }),
  ]);
}

function isSleepEpisode(payload: UnknownRecord): boolean {
  if (isUnstructuredNote(payload)) return false;
  return ["sleep-episode", "sleep-chronology", "sleep-nap", "nap", "cochilo"].includes(
    eventKind(payload),
  ) || hasAnyPath(payload, [
    "sleepStartLocal",
    "sleepEndLocal",
    "totalSleepMinutes",
    "bedtimeLocal",
    "wakeTimeLocal",
    "chronology.sleepOnsetLocal",
    "chronology.finalWakeLocal",
  ]);
}

function isNapEpisode(payload: UnknownRecord): boolean {
  return ["sleep-nap", "nap", "cochilo"].includes(eventKind(payload));
}

function isMainSleepEpisode(payload: UnknownRecord): boolean {
  return isSleepEpisode(payload) && !isNapEpisode(payload);
}

export interface SleepFacts {
  sleepPeriodMinutes: Reading<number>;
  totalSleepMinutes: Reading<number>;
  timeInBedMinutes: Reading<number>;
  latencyMinutes: Reading<number>;
  awakeMinutes: Reading<number>;
  efficiencyPercent: Reading<number>;
  derived: Record<"sleepPeriodMinutes" | "totalSleepMinutes" | "timeInBedMinutes" | "latencyMinutes" | "awakeMinutes" | "efficiencyPercent", boolean>;
}

function nonNegativeReading(reading: Reading<number>, maximum = Number.POSITIVE_INFINITY): Reading<number> {
  return reading.state === "known" && (reading.value! < 0 || reading.value! > maximum)
    ? { state: "invalid" }
    : reading;
}

/**
 * Derives the metrics that the current sleep chronology actually records.
 * Missing awake time deliberately keeps total sleep and efficiency unknown;
 * it is never silently converted to zero minutes awake.
 */
export function deriveSleepFacts(payload: UnknownRecord): SleepFacts {
  const periodPaths = ["sleepPeriodMinutes", "duration.sleepPeriodMinutes"];
  const bedPaths = ["timeInBedMinutes", "duration.timeInBedMinutes"];
  const latencyPaths = ["sleepLatencyMinutes", "latencyMinutes", "sleep.latencyMinutes"];
  const awakePaths = ["awakeMinutes", "wakeAfterSleepOnsetMinutes", "sleep.awakeMinutes"];
  const sleepPeriodMinutes = nonNegativeReading(readDurationFromPayload(
    payload,
    periodPaths,
    ["chronology.sleepOnsetLocal", "sleepStartLocal", "sleep.startLocal", "bedtimeLocal", "startLocal"],
    ["chronology.finalWakeLocal", "sleepEndLocal", "sleep.endLocal", "wakeTimeLocal", "endLocal"],
  ), 1_200);
  const timeInBedMinutes = nonNegativeReading(readDurationFromPayload(
    payload,
    bedPaths,
    ["chronology.wentToBedLocal", "wentToBedLocal"],
    ["chronology.leftBedLocal", "leftBedLocal"],
  ), 1_440);
  const latencyMinutes = nonNegativeReading(readDurationFromPayload(
    payload,
    latencyPaths,
    ["chronology.wentToBedLocal", "wentToBedLocal"],
    ["chronology.sleepOnsetLocal", "sleepOnsetLocal"],
    true,
  ), 720);
  const awakeMinutes = nonNegativeReading(readNumber(payload, awakePaths), 1_440);
  const totalPaths = [
    "totalSleepMinutes",
    "sleepMinutes",
    "durationMinutes",
    "duration.totalMinutes",
  ];
  const explicitTotal = nonNegativeReading(readNumber(payload, totalPaths), 1_440);

  let totalSleepMinutes: Reading<number>;
  if (hasAnyPath(payload, totalPaths)) {
    totalSleepMinutes = explicitTotal;
  } else if (eventKind(payload) === "sleep-chronology" || hasAnyPath(payload, ["awakeMinutes", "wakeAfterSleepOnsetMinutes", "sleep.awakeMinutes"])) {
    if (sleepPeriodMinutes.state === "known" && awakeMinutes.state === "known") {
      const total = sleepPeriodMinutes.value! - awakeMinutes.value!;
      totalSleepMinutes = total < 0 ? { state: "invalid" } : { state: "known", value: total };
    } else if (sleepPeriodMinutes.state === "invalid" || awakeMinutes.state === "invalid") {
      totalSleepMinutes = { state: "invalid" };
    } else {
      totalSleepMinutes = { state: "unknown" };
    }
  } else {
    totalSleepMinutes = sleepPeriodMinutes;
  }

  const efficiencyPaths = [
    "sleepEfficiencyPercent",
    "efficiencyPercent",
    "sleep.efficiencyPercent",
  ];
  const explicitEfficiency = nonNegativeReading(readNumber(payload, efficiencyPaths), 100);
  let efficiencyPercent: Reading<number>;
  if (hasAnyPath(payload, efficiencyPaths)) {
    efficiencyPercent = explicitEfficiency;
  } else if (totalSleepMinutes.state === "known" && timeInBedMinutes.state === "known") {
    efficiencyPercent = timeInBedMinutes.value! <= 0 || totalSleepMinutes.value! > timeInBedMinutes.value!
      ? { state: "invalid" }
      : { state: "known", value: round((totalSleepMinutes.value! / timeInBedMinutes.value!) * 100) };
  } else if (totalSleepMinutes.state === "invalid" || timeInBedMinutes.state === "invalid") {
    efficiencyPercent = { state: "invalid" };
  } else {
    efficiencyPercent = { state: "unknown" };
  }

  return {
    sleepPeriodMinutes,
    totalSleepMinutes,
    timeInBedMinutes,
    latencyMinutes,
    awakeMinutes,
    efficiencyPercent,
    derived: {
      sleepPeriodMinutes: readingWasDerived(payload, periodPaths, sleepPeriodMinutes),
      totalSleepMinutes: readingWasDerived(payload, totalPaths, totalSleepMinutes),
      timeInBedMinutes: readingWasDerived(payload, bedPaths, timeInBedMinutes),
      latencyMinutes: readingWasDerived(payload, latencyPaths, latencyMinutes),
      awakeMinutes: readingWasDerived(payload, awakePaths, awakeMinutes),
      efficiencyPercent: readingWasDerived(payload, efficiencyPaths, efficiencyPercent),
    },
  };
}

function shortSleepReading(payload: UnknownRecord): Reading<boolean> {
  const facts = deriveSleepFacts(payload);
  if (facts.totalSleepMinutes.state === "invalid") return { state: "invalid" };
  if (facts.totalSleepMinutes.state === "known") {
    return { state: "known", value: facts.totalSleepMinutes.value! < 360 };
  }
  // Even without awake minutes, a principal period below six hours proves the
  // total cannot reach six hours. A longer period remains unknown, not "normal".
  if (facts.sleepPeriodMinutes.state === "known" && facts.sleepPeriodMinutes.value! < 360) {
    return { state: "known", value: true };
  }
  if (facts.sleepPeriodMinutes.state === "invalid") {
    return { state: "invalid" };
  }
  return { state: "unknown" };
}

function qualityScore(value: string): number | null {
  const normalized = value.toLowerCase();
  if (["poor", "ruim"].includes(normalized)) return 1;
  if (["regular", "fair"].includes(normalized)) return 2;
  if (["good", "boa", "bom"].includes(normalized)) return 3;
  if (["very_good", "muito_boa", "muito_bom"].includes(normalized)) return 4;
  if (["excellent", "excelente", "ótima", "otima"].includes(normalized)) return 5;
  return finiteNumber(value);
}

function circularClockSpread(values: readonly number[]): number | null {
  if (!values.length) return null;
  const radians = values.map((value) => (value / 1_440) * Math.PI * 2);
  const x = average(radians.map(Math.cos)) ?? 0;
  const y = average(radians.map(Math.sin)) ?? 0;
  const center = ((Math.atan2(y, x) / (Math.PI * 2)) * 1_440 + 1_440) % 1_440;
  const signedDeviations = values.map((value) => {
    let delta = value - center;
    if (delta > 720) delta -= 1_440;
    if (delta < -720) delta += 1_440;
    return delta;
  });
  return standardDeviation(signedDeviations);
}

function summarizeSono(
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
): DomainAnalyticsSummary {
  const sleepEvents = entities.filter((entity) => isSleepEpisode(eventPayload(entity)));
  const episodes = sleepEvents.filter((entity) => isMainSleepEpisode(eventPayload(entity)));
  const napEvents = sleepEvents.filter((entity) => isNapEpisode(eventPayload(entity)));
  const sleepFacts = episodes.map((entity) => deriveSleepFacts(eventPayload(entity)));
  const durations = sleepFacts.map(({ totalSleepMinutes }) => totalSleepMinutes);
  const sleepPeriods = sleepFacts.map(({ sleepPeriodMinutes }) => sleepPeriodMinutes);
  const timeInBedReadings = sleepFacts.map(({ timeInBedMinutes }) => timeInBedMinutes);
  const awakeMinuteReadings = sleepFacts.map(({ awakeMinutes }) => awakeMinutes);
  const latencyReadings = sleepFacts.map(({ latencyMinutes }) => latencyMinutes);
  const efficiencyReadings = sleepFacts.map(({ efficiencyPercent }) => efficiencyPercent);
  const knownDurations = durations.flatMap((reading) =>
    reading.state === "known" && reading.value! >= 0 ? [reading.value!] : [],
  );
  const knownSleepPeriods = sleepPeriods.flatMap((reading) =>
    reading.state === "known" && reading.value! >= 0 ? [reading.value!] : [],
  );
  const timeInBedValues = timeInBedReadings.flatMap((reading) =>
    reading.state === "known" && reading.value! >= 0 ? [reading.value!] : [],
  );
  const awakeMinuteValues = awakeMinuteReadings.flatMap((reading) =>
    reading.state === "known" && reading.value! >= 0 ? [reading.value!] : [],
  );
  const qualityReadings = episodes.map((entity) => readField(
    eventPayload(entity),
    ["perceivedQuality", "quality", "sleep.quality"],
    (value) => typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5
      ? value
      : typeof value === "string" ? qualityScore(value) : null,
  ));
  const qualityValues = qualityReadings.flatMap((reading) =>
    reading.state === "known" ? [reading.value!] : [],
  );
  const bedtimes = episodes.flatMap((entity) => {
    const reading = readString(eventPayload(entity), [
      "chronology.wentToBedLocal",
      "sleepStartLocal",
      "sleep.startLocal",
      "bedtimeLocal",
      "startLocal",
    ]);
    if (reading.state !== "known") return [];
    const clock = clockMinutes(reading.value!.includes("T") ? reading.value!.slice(11) : reading.value!);
    return clock === null ? [] : [clock];
  });
  const latencyValues = latencyReadings.flatMap((reading) =>
    reading.state === "known" && reading.value! >= 0 ? [reading.value!] : [],
  );
  const efficiencyValues = efficiencyReadings.flatMap((reading) =>
    reading.state === "known" && reading.value! >= 0 ? [reading.value!] : [],
  );
  const awakeningReadings = episodes.map((entity) => nonNegativeReading(readNumber(
    eventPayload(entity),
    ["awakenings", "sleep.awakenings"],
  ), 100));
  const awakeningValues = awakeningReadings.flatMap((reading) =>
    reading.state === "known" ? [reading.value!] : [],
  );
  const restorativeReadings = episodes.map((entity) => readBoolean(eventPayload(entity), [
    "restorative",
    "sleep.restorative",
  ]));
  const restorativeKnown = countKnown(restorativeReadings);
  const restorativeCount = restorativeReadings.filter(
    (reading) => reading.state === "known" && reading.value === true,
  ).length;
  const chronologyNapMinutes = episodes.map((entity) => nonNegativeReading(readNumber(
    eventPayload(entity),
    ["napMinutes", "nap.minutes"],
  ), 1_440));
  const standaloneNapMinutes = napEvents.map((entity) => readDurationFromPayload(
    eventPayload(entity),
    ["napMinutes", "nap.minutes", "durationMinutes", "totalSleepMinutes"],
    ["sleepStartLocal", "startLocal", "nap.startLocal"],
    ["sleepEndLocal", "endLocal", "nap.endLocal"],
    true,
  ));
  const napMinuteReadings = [...chronologyNapMinutes, ...standaloneNapMinutes];
  const napMinuteValues = napMinuteReadings.flatMap((reading) =>
    reading.state === "known" && reading.value! >= 0 ? [reading.value!] : [],
  );
  const napKnown = countKnown(napMinuteReadings);
  const naps = napMinuteReadings.filter(
    (reading) => reading.state === "known" && reading.value! > 0,
  ).length;
  return makeDomainSummary("sono", entities, window, [
    makeMetric({
      key: "sleep_duration_average_minutes",
      label: "Sono total estimado médio",
      value: average(knownDurations),
      unit: "minutes",
      n: knownDurations.length,
      missing: countMissing(durations),
      description: "Período principal menos minutos acordado quando a cronologia atual é usada; dado ausente nunca vira zero.",
    }),
    makeMetric({
      key: "sleep_duration_median_minutes",
      label: "Duração mediana registrada",
      value: median(knownDurations),
      unit: "minutes",
      n: knownDurations.length,
      missing: countMissing(durations),
      description: "Mediana dos episódios completos, sem preencher noites ausentes.",
    }),
    makeMetric({
      key: "sleep_period_average_minutes",
      label: "Período principal médio",
      value: average(knownSleepPeriods),
      unit: "minutes",
      n: knownSleepPeriods.length,
      missing: countMissing(sleepPeriods),
      description: "Intervalo entre adormecer e o despertar final, antes de descontar o tempo acordado.",
    }),
    makeMetric({
      key: "time_in_bed_average_minutes",
      label: "Tempo médio na cama",
      value: average(timeInBedValues),
      unit: "minutes",
      n: timeInBedValues.length,
      missing: countMissing(timeInBedReadings),
      description: "Intervalo entre deitar e levantar quando os dois horários foram registrados.",
    }),
    makeMetric({
      key: "awake_minutes_average",
      label: "Tempo acordado médio",
      value: average(awakeMinuteValues),
      unit: "minutes",
      n: awakeMinuteValues.length,
      missing: countMissing(awakeMinuteReadings),
      description: "Minutos acordado explicitamente informados; vazio não significa zero.",
    }),
    makeMetric({
      key: "sleep_quality_average",
      label: "Qualidade percebida média",
      value: average(qualityValues),
      unit: "score",
      n: qualityValues.length,
      missing: countMissing(qualityReadings),
      description: "Escala subjetiva registrada, apresentada separadamente da duração.",
    }),
    makeMetric({
      key: "bedtime_variability_minutes",
      label: "Variabilidade do horário de dormir",
      value: circularClockSpread(bedtimes),
      unit: "minutes",
      n: bedtimes.length,
      missing: Math.max(0, episodes.length - bedtimes.length),
      description: "Dispersão circular do horário; 23:55 e 00:05 permanecem próximos.",
    }),
    makeMetric({
      key: "sleep_latency_average_minutes",
      label: "Deitar até adormecer · média",
      value: average(latencyValues),
      unit: "minutes",
      n: latencyValues.length,
      missing: countMissing(latencyReadings),
      description: "Intervalo informado entre deitar e adormecer; pode incluir tempo acordado antes de tentar dormir.",
    }),
    makeMetric({
      key: "sleep_efficiency_average_percent",
      label: "Eficiência média estimada",
      value: average(efficiencyValues),
      unit: "percent",
      n: efficiencyValues.length,
      missing: countMissing(efficiencyReadings),
      description: "Sono total estimado dividido pelo tempo na cama; exige os componentes completos e válidos.",
    }),
    makeMetric({
      key: "awakenings_average",
      label: "Despertares médios registrados",
      value: average(awakeningValues),
      unit: "count",
      n: awakeningValues.length,
      missing: countMissing(awakeningReadings),
      description: "Número lembrado de despertares, separado dos minutos acordado.",
    }),
    makeMetric({
      key: "restorative_sleep_percent",
      label: "Noites restauradoras registradas",
      value: restorativeKnown ? (restorativeCount / restorativeKnown) * 100 : null,
      unit: "percent",
      n: restorativeKnown,
      missing: countMissing(restorativeReadings),
      confirmedAbsences: restorativeReadings.filter(({ state }) => state === "confirmed_absent").length,
      description: "Percepção explícita ao acordar; não é inferida da duração.",
    }),
    makeMetric({
      key: "naps",
      label: "Cochilos registrados",
      value: napKnown ? naps : null,
      unit: "count",
      n: napKnown,
      missing: countMissing(napMinuteReadings),
      description: "Conta registros com minutos de cochilo positivos; zero explícito e desconhecido permanecem distintos.",
    }),
    makeMetric({
      key: "nap_minutes",
      label: "Minutos de cochilo registrados",
      value: napMinuteValues.length
        ? napMinuteValues.reduce((sum, value) => sum + value, 0)
        : null,
      unit: "minutes",
      n: napMinuteValues.length,
      missing: countMissing(napMinuteReadings),
      description: "Soma apenas os minutos de cochilo explicitamente informados na cronologia.",
    }),
  ]);
}

function summarizeAlimentacao(
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
): DomainAnalyticsSummary {
  const nutritionEvents = entities.filter((entity) => {
    const payload = eventPayload(entity);
    return !isUnstructuredNote(payload) && (
      ["nutrition-log", "meal-entry", "meal", "water-entry"].includes(eventKind(payload)) ||
      hasAnyPath(payload, [
        "meal.kind",
        "meal.presence",
        "mealType",
        "waterMl",
        "hydration.amountMl",
        "hydration.waterMl",
      ])
    );
  });
  const mealEvents = entities.filter((entity) => {
    const payload = eventPayload(entity);
    return !isUnstructuredNote(payload) &&
      (["nutrition-log", "meal-entry", "food-entry", "meal", "refeicao"].includes(
        eventKind(payload),
      ) || hasAnyPath(payload, ["meal.kind", "mealType", "meal.presence", "meal.present"]));
  });
  const mealPresence = mealEvents.map((entity): Reading<boolean> => {
    const payload = eventPayload(entity);
    const explicitPresence = readBoolean(payload, [
      "presence",
      "mealPresent",
      "meal.presence",
      "meal.present",
      "completed",
    ]);
    if (explicitPresence.state !== "unknown") return explicitPresence;
    const mealKind = readString(payload, ["meal.kind", "mealType"]);
    if (mealKind.state === "known") return { state: "known", value: true };
    if (eventKind(payload) === "meal-entry") return { state: "known", value: true };
    return mealKind.state === "invalid"
      ? { state: "invalid" }
      : { state: "unknown" };
  });
  const mealsKnownPresent = mealPresence.filter(
    (reading) => reading.state === "known" && reading.value === true,
  ).length;
  const mealsConfirmedOmitted = mealPresence.filter(
    (reading) => reading.state === "confirmed_absent" ||
      (reading.state === "known" && reading.value === false),
  ).length;
  const waterReadings = nutritionEvents.map((entity): Reading<number> => {
    const reading = readNumber(eventPayload(entity), [
      "hydration.amountMl",
      "waterMl",
      "hydrationMl",
      "hydration.waterMl",
    ]);
    return reading.state === "known" && reading.value! < 0
      ? { state: "invalid" }
      : reading;
  });
  const waterValues = waterReadings.flatMap((reading) =>
    reading.state === "known" && reading.value! >= 0 ? [reading.value!] : [],
  );
  const waterMeasurementReadings = nutritionEvents.map((entity) => readString(
    eventPayload(entity),
    ["hydration.measurement", "waterMeasurement"],
  ));
  const waterIncrementValues = waterReadings.flatMap((reading, index) =>
    reading.state === "known" && reading.value! >= 0 &&
      waterMeasurementReadings[index]?.state === "known" &&
      waterMeasurementReadings[index]?.value === "increment"
      ? [reading.value!]
      : [],
  );
  const ambiguousLegacyWaterEntries = waterReadings.filter((reading, index) =>
    reading.state === "known" && waterMeasurementReadings[index]?.state !== "known",
  ).length;
  const caffeineEvents = entities.filter((entity) => {
    const payload = eventPayload(entity);
    return !isUnstructuredNote(payload) &&
      (/caffeine|cafeina|café/.test(eventKind(payload)) || hasAnyPath(payload, [
      "caffeine.servings",
      "caffeine.lastUseLocal",
      "caffeineMg",
      "caffeine.timeLocal",
      ]));
  });
  let lateCaffeine = 0;
  let caffeineTimeKnown = 0;
  for (const entity of caffeineEvents) {
    const time = readString(eventPayload(entity), [
      "timeLocal",
      "caffeine.timeLocal",
      "caffeine.lastUseLocal",
      "consumedAtLocal",
    ]);
    if (time.state !== "known") continue;
    const clock = clockMinutes(time.value!.includes("T") ? time.value!.slice(11) : time.value!);
    if (clock === null) continue;
    caffeineTimeKnown += 1;
    if (clock >= 18 * 60) lateCaffeine += 1;
  }
  const mealTimes = mealEvents.flatMap((entity) => {
    const time = readString(eventPayload(entity), ["timeLocal", "meal.timeLocal", "occurredAtLocal"]);
    if (time.state !== "known") return [];
    const clock = clockMinutes(time.value!.includes("T") ? time.value!.slice(11) : time.value!);
    return clock === null ? [] : [{ localDate: entity.localDate, clock }];
  });
  let longestGap: number | null = null;
  const byDay = new Map<LocalDate, number[]>();
  for (const item of mealTimes) {
    const values = byDay.get(item.localDate) ?? [];
    values.push(item.clock);
    byDay.set(item.localDate, values);
  }
  for (const values of byDay.values()) {
    values.sort((left, right) => left - right);
    for (let index = 1; index < values.length; index += 1) {
      const gap = values[index] - values[index - 1];
      longestGap = longestGap === null ? gap : Math.max(longestGap, gap);
    }
  }
  return makeDomainSummary("alimentacao", entities, window, [
    makeMetric({
      key: "meals_recorded",
      label: "Refeições confirmadas",
      value: mealsKnownPresent,
      unit: "count",
      n: countKnown(mealPresence),
      missing: countMissing(mealPresence),
      confirmedAbsences: mealsConfirmedOmitted,
      description: "Uma nota alimentar não vira refeição confirmada sem estado explícito.",
    }),
    makeMetric({
      key: "meals_omitted_confirmed",
      label: "Refeições omitidas confirmadas",
      value: mealsConfirmedOmitted,
      unit: "count",
      n: countKnown(mealPresence),
      missing: countMissing(mealPresence),
      confirmedAbsences: mealsConfirmedOmitted,
      description: "Lacunas de registro não são interpretadas como refeição omitida.",
    }),
    makeMetric({
      key: "water_entries",
      label: "Registros de hidratação",
      value: countKnown(waterReadings) ? countKnown(waterReadings) : null,
      unit: "count",
      n: countKnown(waterReadings),
      missing: countMissing(waterReadings),
      description: "Conta registros com volume explícito; falta de registro não equivale a zero consumo.",
    }),
    makeMetric({
      key: "water_recorded_ml",
      label: "Hidratação registrada",
      value: waterValues.length ? waterValues.reduce((sum, value) => sum + value, 0) : null,
      unit: "milliliters",
      n: waterValues.length,
      missing: countMissing(waterReadings),
      description: "Soma dos volumes informados. Novos registros são incrementos explícitos; itens legados sem marcação permanecem identificados separadamente.",
    }),
    makeMetric({
      key: "water_increment_recorded_ml",
      label: "Água adicionada em incrementos explícitos",
      value: waterIncrementValues.length
        ? waterIncrementValues.reduce((sum, value) => sum + value, 0)
        : null,
      unit: "milliliters",
      n: waterIncrementValues.length,
      missing: Math.max(0, waterReadings.length - waterIncrementValues.length),
      description: "Soma apenas registros marcados como volume adicionado naquele momento; nunca interpreta um total diário repetido como incremento.",
    }),
    makeMetric({
      key: "water_legacy_ambiguous_entries",
      label: "Registros antigos de água sem semântica",
      value: ambiguousLegacyWaterEntries || null,
      unit: "count",
      n: ambiguousLegacyWaterEntries,
      description: "Quantidade de registros anteriores que não informam se o volume era incremento ou total; nenhum significado foi inventado.",
    }),
    makeMetric({
      key: "longest_meal_gap_minutes",
      label: "Maior intervalo observado",
      value: longestGap,
      unit: "minutes",
      n: mealTimes.length,
      missing: Math.max(0, mealEvents.length - mealTimes.length),
      description: "Intervalo entre refeições com horário no mesmo dia.",
    }),
    makeMetric({
      key: "late_caffeine_events",
      label: "Cafeína após 18h",
      value: lateCaffeine,
      unit: "count",
      n: caffeineTimeKnown,
      missing: Math.max(0, caffeineEvents.length - caffeineTimeKnown),
      description: "Marcador descritivo configurado em 18h; não prova efeito sobre sono ou cefaleia.",
    }),
  ]);
}

function numericReadings(
  entities: readonly MentorEntity[],
  paths: readonly string[],
): { readings: Reading<number>[]; values: number[] } {
  const readings = entities.map((entity) => readNumber(eventPayload(entity), paths));
  return {
    readings,
    values: readings.flatMap((reading) =>
      reading.state === "known" ? [reading.value!] : [],
    ),
  };
}

function boundedNumericReadings(
  entities: readonly MentorEntity[],
  paths: readonly string[],
  minimum: number,
  maximum: number,
): { readings: Reading<number>[]; values: number[] } {
  const readings = entities.map((entity) => readBoundedNumber(
    eventPayload(entity),
    paths,
    minimum,
    maximum,
  ));
  return {
    readings,
    values: readings.flatMap((reading) =>
      reading.state === "known" ? [reading.value!] : [],
    ),
  };
}

/** Leitura da escala declarada, sem conversão. Consumidores devem restringir a família antes de agregar. */
export function scaledReading(
  entity: MentorEntity,
  paths: readonly string[],
  minimum: number,
  maximum: number,
): Reading<number> {
  const payload = eventPayload(entity);
  const reading = readField(payload, paths, (value) =>
    typeof value === "number" && Number.isFinite(value) ? value : null,
  );
  if (reading.state !== "known") return reading;

  const kind = entity.type === "humor.energy-check-in"
    ? "energy-check-in"
    : eventKind(payload);
  const isFunctionalScale = kind === "mood-functional-check-in";
  const readsMood = paths.some((path) => path === "mood" || path.endsWith(".mood"));
  const readsEnergy = paths.some((path) => path === "energy" || path.endsWith(".energy"));
  const effectiveMinimum = isFunctionalScale && readsMood
    ? -2
    : isFunctionalScale && readsEnergy ? 0 : minimum;
  const effectiveMaximum = isFunctionalScale && (readsMood || readsEnergy)
    ? readsMood ? 2 : 4
    : maximum;
  if (reading.value! < effectiveMinimum || reading.value! > effectiveMaximum) {
    return { state: "invalid" };
  }

  const expectedScale = kind === "mood-check-in"
    ? "mood-1-5-v1"
    : kind === "energy-check-in"
      ? "energy-1-5-v1"
      : kind === "mood-functional-check-in"
        ? "mentor-functional-scales-v1"
        : null;
  if (!expectedScale) return reading;

  const scale = readString(payload, ["scaleVersion"]);
  if (scale.state !== "known") {
    return scale.state === "invalid" ? { state: "invalid" } : { state: "unknown" };
  }
  return scale.value === expectedScale ? reading : { state: "invalid" };
}

function scaledReadings(
  entities: readonly MentorEntity[],
  paths: readonly string[],
  minimum: number,
  maximum: number,
): { readings: Reading<number>[]; values: number[] } {
  const readings = entities.map((entity) =>
    scaledReading(entity, paths, minimum, maximum),
  );
  return {
    readings,
    values: readings.flatMap((reading) =>
      reading.state === "known" ? [reading.value!] : [],
    ),
  };
}

function summarizeHumor(
  entities: readonly MentorEntity[],
  allEntities: readonly MentorEntity[],
  window: InclusiveDateWindow,
): DomainAnalyticsSummary {
  const moodEvents = entities.filter((entity) => {
    const payload = eventPayload(entity);
    return !isUnstructuredNote(payload) &&
      (["mood-check-in", "mood-functional-check-in"].includes(eventKind(payload)) ||
      entity.type === "humor.energy-check-in" ||
      hasAnyPath(payload, ["mood", "energy", "anxiety", "irritability"]));
  });
  const allMoodCandidates = latestByLocalDate(moodEvents.filter((entity) =>
    hasAnyPath(eventPayload(entity), ["mood", "moodScore", "scores.mood"]),
  ));
  const allEnergyCandidates = latestByLocalDate(moodEvents.filter((entity) =>
    entity.type === "humor.energy-check-in" ||
    hasAnyPath(eventPayload(entity), ["energy", "energyScore", "scores.energy"]),
  ));
  const functionalMoodCandidates = allMoodCandidates.filter((entity) =>
    eventKind(eventPayload(entity)) === "mood-functional-check-in"
  );
  const functionalEnergyCandidates = allEnergyCandidates.filter((entity) =>
    eventKind(eventPayload(entity)) === "mood-functional-check-in"
  );
  const quickEnergyCandidates = latestByLocalDate(moodEvents.filter((entity) =>
    entity.type === "humor.energy-check-in" ||
      eventKind(eventPayload(entity)) === "energy-check-in"
  ));
  const legacyMoodCandidates = latestByLocalDate(allMoodCandidates.filter((entity) =>
    eventKind(eventPayload(entity)) !== "mood-functional-check-in"
  ));
  // Do not average incompatible legacy and current scales. Once the current
  // functional scale has a usable observation in the window, it becomes the
  // displayed series. A current check-in with the field left unknown must not
  // hide an older, explicit observation from the legacy scale.
  const hasUsableFunctionalMood = functionalMoodCandidates.some((entity) =>
    scaledReading(entity, ["mood", "moodScore", "scores.mood"], 1, 5).state === "known"
  );
  const hasUsableFunctionalEnergy = functionalEnergyCandidates.some((entity) =>
    scaledReading(entity, ["energy", "energyScore", "scores.energy"], 1, 5).state === "known"
  );
  const moodCandidates = hasUsableFunctionalMood
    ? functionalMoodCandidates
    : legacyMoodCandidates;
  const energyCandidates = hasUsableFunctionalEnergy
    ? functionalEnergyCandidates
    : quickEnergyCandidates;
  const mood = scaledReadings(moodCandidates, ["mood", "moodScore", "scores.mood"], 1, 5);
  const energy = scaledReadings(energyCandidates, ["energy", "energyScore", "scores.energy"], 1, 5);
  const functionalMood = scaledReadings(functionalMoodCandidates, ["mood", "moodScore", "scores.mood"], 1, 5);
  const legacyMood = scaledReadings(legacyMoodCandidates, ["mood", "moodScore", "scores.mood"], 1, 5);
  const functionalEnergy = scaledReadings(functionalEnergyCandidates, ["energy", "energyScore", "scores.energy"], 1, 5);
  const quickEnergy = scaledReadings(quickEnergyCandidates, ["energy", "energyScore", "scores.energy"], 1, 5);
  const usesFunctionalMoodScale = hasUsableFunctionalMood;
  const usesFunctionalEnergyScale = hasUsableFunctionalEnergy;
  const functionalEvents = moodEvents.filter((entity) =>
    eventKind(eventPayload(entity)) === "mood-functional-check-in"
  );
  const anxiety = boundedNumericReadings(functionalEvents, ["anxiety", "anxietyScore", "scores.anxiety"], 0, 4);
  const irritability = boundedNumericReadings(functionalEvents, ["irritability", "irritabilityScore", "scores.irritability"], 0, 4);
  const impulsivity = boundedNumericReadings(functionalEvents, ["impulsivity", "impulsivityScore", "scores.impulsivity"], 0, 4);
  const thoughtSpeed = boundedNumericReadings(functionalEvents, ["thoughtSpeed", "thoughtSpeedScore", "scores.thoughtSpeed"], -2, 2);
  const functioning = boundedNumericReadings(functionalEvents, [
    "functioning",
    "function",
    "functioningScore",
    "scores.functioning",
  ], 0, 4);
  const perceivedSleepNeed = functionalEvents.map((entity) => readEnumString(
    eventPayload(entity),
    ["perceivedSleepNeed"],
    ["less_than_usual", "usual", "more_than_usual"] as const,
  ));
  const perceivedBaselineChange = functionalEvents.map((entity) => readEnumString(
    eventPayload(entity),
    ["perceivedBaselineChange"],
    ["below_usual", "usual", "above_usual", "different_unclear"] as const,
  ));
  const protectiveFactors = functionalEvents.map((entity): Reading<string[]> => {
    const payload = eventPayload(entity);
    const listed = readStringArray(payload, ["protectiveFactors"]);
    const note = readString(payload, ["protectiveFactorsNote"]);
    if (listed.state === "known" || note.state === "known") {
      return {
        state: "known",
        value: [
          ...(listed.state === "known" ? listed.value! : []),
          ...(note.state === "known" ? [note.value!] : []),
        ],
      };
    }
    if (listed.state === "invalid" || note.state === "invalid") return { state: "invalid" };
    return { state: "unknown" };
  });
  const medicationChange = functionalEvents.map((entity) => readBoolean(
    eventPayload(entity),
    ["medicationChangeConfirmed"],
  ));
  const safeNow = functionalEvents.map((entity) => readBoolean(
    eventPayload(entity),
    ["safeNow"],
  ));
  const medicationChangeKnown = countKnown(medicationChange);
  const medicationChangeConfirmed = medicationChange.filter((reading) =>
    reading.state === "known" && reading.value === true
  ).length;
  const safeNowKnown = countKnown(safeNow);
  const safeNowUserReportedNo = safeNow.filter((reading) =>
    reading.state === "confirmed_absent" ||
      (reading.state === "known" && reading.value === false)
  ).length;

  const energyByDay = new Map<LocalDate, Reading<number>>(
    energyCandidates.map((entity) => [
      entity.localDate,
      scaledReading(entity, ["energy", "energyScore", "scores.energy"], 1, 5),
    ]),
  );
  const sleepByDay = new Map<LocalDate, Reading<boolean>>(
    latestByLocalDate(allEntities.filter((entity) =>
      entity.domain === "sono" && isMainSleepEpisode(eventPayload(entity)),
    )).map((entity) => [entity.localDate, shortSleepReading(eventPayload(entity))]),
  );
  let pairedDays = 0;
  let cooccurrenceDays = 0;
  for (const [date, energyReading] of energyByDay) {
    const shortSleep = sleepByDay.get(date);
    if (energyReading.state !== "known" || shortSleep?.state !== "known") continue;
    pairedDays += 1;
    if (energyReading.value! >= 4 && shortSleep.value === true) cooccurrenceDays += 1;
  }
  const associationReady = pairedDays >= 14;
  const pairedEnergyScale = usesFunctionalEnergyScale
    ? "funcional 0–4"
    : "rápida 1–5";
  return makeDomainSummary("humor", entities, window, [
    makeMetric({
      key: "mood_average",
      label: usesFunctionalMoodScale
        ? "Humor médio (−2 a +2)"
        : "Humor médio registrado",
      value: average(mood.values),
      unit: "score",
      n: mood.values.length,
      missing: countMissing(mood.readings),
      description: usesFunctionalMoodScale
        ? "Média na escala funcional −2 a +2; zero e valores negativos são observações válidas, não ausência."
        : "Média da escala registrada; não corresponde a diagnóstico.",
    }),
    makeMetric({
      key: "mood_variability",
      label: "Variabilidade do humor",
      value: standardDeviation(mood.values),
      unit: "score",
      n: mood.values.length,
      missing: countMissing(mood.readings),
      description: "Desvio descritivo das observações na mesma versão de escala.",
    }),
    makeMetric({
      key: "mood_functional_average_minus2_plus2",
      label: "Humor funcional médio (−2 a +2)",
      value: average(functionalMood.values),
      unit: "score",
      n: functionalMood.values.length,
      missing: countMissing(functionalMood.readings),
      description: "Série exclusiva da matriz funcional; nunca é combinada com registros antigos em escala 1–5.",
    }),
    makeMetric({
      key: "mood_legacy_average_1_5",
      label: "Humor anterior médio (1 a 5)",
      value: average(legacyMood.values),
      unit: "score",
      n: legacyMood.values.length,
      missing: countMissing(legacyMood.readings),
      description: "Série anterior preservada e nomeada separadamente; não é convertida para a escala funcional.",
    }),
    makeMetric({
      key: "energy_average",
      label: usesFunctionalEnergyScale
        ? "Energia média (0 a 4)"
        : "Energia rápida média (1 a 5)",
      value: average(energy.values),
      unit: "score",
      n: energy.values.length,
      missing: countMissing(energy.readings),
      description: usesFunctionalEnergyScale
        ? "Energia na escala funcional 0 a 4; zero é resposta válida e permanece diferente de campo vazio."
        : "Check-in rápido de Hoje na escala 1 a 5; não é convertido nem misturado com a matriz funcional.",
    }),
    makeMetric({
      key: "energy_functional_average_0_4",
      label: "Energia funcional média (0 a 4)",
      value: average(functionalEnergy.values),
      unit: "score",
      n: functionalEnergy.values.length,
      missing: countMissing(functionalEnergy.readings),
      description: "Série exclusiva da matriz de humor funcional, preservada na escala 0–4.",
    }),
    makeMetric({
      key: "energy_quick_average_1_5",
      label: "Energia rápida média (1 a 5)",
      value: average(quickEnergy.values),
      unit: "score",
      n: quickEnergy.values.length,
      missing: countMissing(quickEnergy.readings),
      description: "Série dos check-ins rápidos de Hoje, preservada na escala 1–5 e separada da matriz funcional.",
    }),
    makeMetric({
      key: "anxiety_average",
      label: "Ansiedade média registrada",
      value: average(anxiety.values),
      unit: "score",
      n: anxiety.values.length,
      missing: countMissing(anxiety.readings),
      description: "Apenas observações explicitamente preenchidas.",
    }),
    makeMetric({
      key: "irritability_average",
      label: "Irritabilidade média registrada",
      value: average(irritability.values),
      unit: "score",
      n: irritability.values.length,
      missing: countMissing(irritability.readings),
      description: "Dimensão funcional 0–4 explicitamente preenchida; não corresponde a diagnóstico.",
    }),
    makeMetric({
      key: "impulsivity_average",
      label: "Impulsividade média registrada",
      value: average(impulsivity.values),
      unit: "score",
      n: impulsivity.values.length,
      missing: countMissing(impulsivity.readings),
      description: "Dimensão funcional 0–4 explicitamente preenchida; não corresponde a diagnóstico.",
    }),
    makeMetric({
      key: "thought_speed_average",
      label: "Velocidade do pensamento média (−2 a +2)",
      value: average(thoughtSpeed.values),
      unit: "score",
      n: thoughtSpeed.values.length,
      missing: countMissing(thoughtSpeed.readings),
      description: "Dimensão funcional descritiva; valores negativos e zero são observações válidas.",
    }),
    makeMetric({
      key: "functioning_average",
      label: "Funcionamento médio registrado",
      value: average(functioning.values),
      unit: "score",
      n: functioning.values.length,
      missing: countMissing(functioning.readings),
      description: "Funcionamento informado para revisão pessoal ou profissional, sem rotulação automática.",
    }),
    makeMetric({
      key: "perceived_sleep_need_responses",
      label: "Necessidade percebida de sono — respostas",
      value: countKnown(perceivedSleepNeed) || null,
      unit: "count",
      n: countKnown(perceivedSleepNeed),
      missing: countMissing(perceivedSleepNeed),
      description: "Cobertura das comparações autorreferidas com o sono habitual; categorias não recebem score nem interpretação diagnóstica.",
    }),
    makeMetric({
      key: "perceived_baseline_change_responses",
      label: "Mudança percebida do basal — respostas",
      value: countKnown(perceivedBaselineChange) || null,
      unit: "count",
      n: countKnown(perceivedBaselineChange),
      missing: countMissing(perceivedBaselineChange),
      description: "Cobertura das comparações do usuário com o próprio padrão habitual, sem classificação automática.",
    }),
    makeMetric({
      key: "protective_factor_checkins",
      label: "Check-ins com apoio percebido registrado",
      value: countKnown(protectiveFactors) || null,
      unit: "count",
      n: countKnown(protectiveFactors),
      missing: countMissing(protectiveFactors),
      description: "Conta check-ins com ao menos um apoio ou fator protetor informado pelo usuário; ausência de resposta permanece desconhecida.",
    }),
    makeMetric({
      key: "protective_factors_recorded",
      label: "Apoios percebidos registrados",
      value: sumStringItems(protectiveFactors) || null,
      unit: "count",
      n: countKnown(protectiveFactors),
      missing: countMissing(protectiveFactors),
      description: "Itens e notas de apoio explicitamente registrados, sem ponderação, score ou inferência de segurança.",
    }),
    makeMetric({
      key: "medication_changes_confirmed_by_user",
      label: "Mudanças medicamentosas confirmadas pelo usuário",
      value: medicationChangeKnown ? medicationChangeConfirmed : null,
      unit: "count",
      n: medicationChangeKnown,
      missing: countMissing(medicationChange),
      description: "Reproduz somente a confirmação do usuário; não detecta, recomenda nem avalia mudanças de medicamento, dose ou horário.",
    }),
    makeMetric({
      key: "safe_now_user_reported_no",
      label: "Respostas ‘não’ à pergunta de segurança no momento",
      value: safeNowKnown ? safeNowUserReportedNo : null,
      unit: "count",
      n: safeNowKnown,
      missing: countMissing(safeNow),
      description: "Contagem factual de respostas ‘não’. Uma resposta ‘sim’ não prova ausência de risco; o app não monitora, não cria alerta automático e não calcula risco.",
    }),
    makeMetric({
      key: "short_sleep_high_energy_cooccurrence",
      label: `Pouco sono + energia elevada (${pairedEnergyScale})`,
      value: associationReady ? cooccurrenceDays : null,
      unit: "count",
      n: pairedDays,
      missing: Math.max(0, window.days - pairedDays),
      description: `Coocorrência no mesmo dia (sono <6h e energia ≥4 na escala ${pairedEnergyScale}), exibida somente após 14 dias com os dois fatos completos; as escalas nunca são combinadas e o recorte não indica causalidade nem diagnóstico.`,
    }),
  ]);
}

interface DailyPresence {
  presentDays: Set<LocalDate>;
  absentDays: Set<LocalDate>;
  unknownDays: Set<LocalDate>;
}

function dailyPresence(
  events: readonly MentorEntity[],
  paths: readonly string[],
): DailyPresence {
  const byDay = new Map<LocalDate, Reading<boolean>[]>();
  for (const entity of events) {
    const reading = readBoolean(eventPayload(entity), paths);
    const readings = byDay.get(entity.localDate) ?? [];
    readings.push(reading);
    byDay.set(entity.localDate, readings);
  }
  const result: DailyPresence = {
    presentDays: new Set(),
    absentDays: new Set(),
    unknownDays: new Set(),
  };
  for (const [date, readings] of byDay) {
    if (readings.some((reading) => reading.state === "known" && reading.value === true)) {
      result.presentDays.add(date);
    } else if (readings.some((reading) => reading.state === "confirmed_absent" ||
      (reading.state === "known" && reading.value === false))) {
      result.absentDays.add(date);
    } else {
      result.unknownDays.add(date);
    }
  }
  return result;
}

function isHeadacheEvent(payload: UnknownRecord): boolean {
  if (isUnstructuredNote(payload)) return false;
  return ["headache-check-in", "headache-crisis", "headache-day"].includes(
    eventKind(payload),
  ) || hasAnyPath(payload, [
    "headachePresent",
    "presence",
    "intensity",
    "headache.intensity",
  ]);
}

function summarizeCefaleia(
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
): DomainAnalyticsSummary {
  const events = entities.filter((entity) => isHeadacheEvent(eventPayload(entity)));
  const presence = dailyPresence(events, [
    "presence",
    "headachePresent",
    "present",
    "headache.presence",
  ]);
  const confirmedAbsenceCheckIns = events.filter((entity) => {
    const reading = readBoolean(eventPayload(entity), [
      "presence",
      "headachePresent",
      "present",
      "headache.presence",
    ]);
    return reading.state === "confirmed_absent" ||
      (reading.state === "known" && reading.value === false);
  });
  const confirmedAbsentDays = new Set(
    confirmedAbsenceCheckIns.flatMap((entity) => {
      const payload = eventPayload(entity);
      const scope = readString(payload, ["scope", "observationScope"]);
      const isWholeDay = eventKind(payload) === "headache-day" ||
        (scope.state === "known" && ["day", "daily", "full-day"].includes(scope.value!));
      return isWholeDay && !presence.presentDays.has(entity.localDate)
        ? [entity.localDate]
        : [];
    }),
  );
  const knownDays = presence.presentDays.size + confirmedAbsentDays.size;
  const presentEvents = events.filter((entity) => {
    const reading = readBoolean(eventPayload(entity), [
      "presence",
      "headachePresent",
      "present",
      "headache.presence",
    ]);
    return reading.state === "known" && reading.value === true;
  });
  const intensityReadings = presentEvents.map((entity) => readBoundedNumber(
    eventPayload(entity),
    ["intensityPeak", "intensityCurrent", "intensity", "painIntensity", "headache.intensity"],
    0,
    10,
  ));
  const intensity = {
    readings: intensityReadings,
    values: intensityReadings.flatMap((reading) =>
      reading.state === "known" ? [reading.value!] : [],
    ),
  };
  const durations = presentEvents.map((entity) => readDurationFromPayload(
    eventPayload(entity),
    ["durationMinutes", "headache.durationMinutes"],
    ["onsetLocal", "startLocal", "headache.startLocal"],
    ["endedLocal", "endLocal", "headache.endLocal"],
  ));
  const knownDurations = durations.flatMap((reading) =>
    reading.state === "known" ? [reading.value!] : [],
  );
  const disability = numericReadings(presentEvents, [
    "disabilityMinutes",
    "incapacityMinutes",
    "headache.disabilityMinutes",
  ]);
  const acuteMedicationReadings = presentEvents.map((entity) => readBoolean(
    eventPayload(entity),
    ["acuteMedicationUsed", "intervention.acuteMedicationUsed"],
  ));
  const acuteMedicationKnown = countKnown(acuteMedicationReadings);
  const acuteMedicationDays = new Set(
    presentEvents.flatMap((entity, index) => {
      const reading = acuteMedicationReadings[index];
      return reading.state === "known" && reading.value === true
        ? [entity.localDate]
        : [];
    }),
  ).size;
  return makeDomainSummary("cefaleia", entities, window, [
    makeMetric({
      key: "headache_days",
      label: "Dias com cefaleia confirmada",
      value: knownDays ? presence.presentDays.size : null,
      unit: "count",
      n: knownDays,
      missing: Math.max(0, window.days - knownDays),
      confirmedAbsences: confirmedAbsentDays.size,
      description: "Dia sem resposta permanece desconhecido; não é dia sem dor.",
    }),
    makeMetric({
      key: "headache_free_days_confirmed",
      label: "Dias sem cefaleia confirmados",
      value: knownDays ? confirmedAbsentDays.size : null,
      unit: "count",
      n: knownDays,
      missing: Math.max(0, window.days - knownDays),
      confirmedAbsences: confirmedAbsentDays.size,
      description: "Ausência explicitamente marcada com escopo de dia inteiro.",
    }),
    makeMetric({
      key: "headache_absence_checkins_confirmed",
      label: "Check-ins com ausência confirmada",
      value: confirmedAbsenceCheckIns.length ? confirmedAbsenceCheckIns.length : null,
      unit: "count",
      n: confirmedAbsenceCheckIns.length,
      confirmedAbsences: confirmedAbsenceCheckIns.length,
      description: "Ausência no momento do check-in; não prova um dia inteiro sem cefaleia.",
    }),
    makeMetric({
      key: "headache_episodes",
      label: "Crises registradas",
      value: presentEvents.length ? presentEvents.length : null,
      unit: "count",
      n: presentEvents.length,
      description: "Eventos de presença confirmada; múltiplas crises no mesmo dia permanecem distintas.",
    }),
    makeMetric({
      key: "headache_intensity_average",
      label: "Intensidade média das crises",
      value: average(intensity.values),
      unit: "score",
      n: intensity.values.length,
      missing: countMissing(intensity.readings),
      description: "Média somente entre crises presentes com intensidade informada.",
    }),
    makeMetric({
      key: "headache_duration_median_minutes",
      label: "Duração mediana das crises",
      value: median(knownDurations),
      unit: "minutes",
      n: knownDurations.length,
      missing: countMissing(durations),
      description: "Duração das crises completas, sem reconstruir horários ausentes.",
    }),
    makeMetric({
      key: "headache_disability_minutes",
      label: "Minutos de incapacidade registrados",
      value: disability.values.length
        ? disability.values.reduce((sum, value) => sum + value, 0)
        : null,
      unit: "minutes",
      n: disability.values.length,
      missing: countMissing(disability.readings),
      description: "Incapacidade autorreferida durante crises.",
    }),
    makeMetric({
      key: "acute_medication_days",
      label: "Dias de medicação aguda",
      value: acuteMedicationKnown ? acuteMedicationDays : null,
      unit: "count",
      n: acuteMedicationKnown,
      missing: countMissing(acuteMedicationReadings),
      confirmedAbsences: acuteMedicationReadings.filter((reading) =>
        reading.state === "confirmed_absent" ||
        (reading.state === "known" && reading.value === false)
      ).length,
      description: "Uso explicitamente informado; campo vazio permanece desconhecido e o dado não avalia nem recomenda tratamento.",
    }),
  ]);
}

function isBruxismEvent(payload: UnknownRecord): boolean {
  if (isUnstructuredNote(payload)) return false;
  return ["bruxism-am-pm", "bruxism-check-in", "bruxism-episode"].includes(
    eventKind(payload),
  ) || hasAnyPath(payload, [
    "bruxismPresent",
    "clenching",
    "grinding",
    "jawPainIntensity",
    "daytimeClenching",
    "grindingReported",
    "morning.jawPain",
    "evening.jawPain",
  ]);
}

function bruxismPresenceReading(payload: UnknownRecord): Reading<boolean> {
  const explicit = readBoolean(payload, ["presence", "bruxismPresent", "symptomPresent"]);
  if (explicit.state === "known" || explicit.state === "confirmed_absent") return explicit;

  const signals: Reading<number | boolean>[] = [
    readBoolean(payload, ["daytimeClenching", "clenching"]),
    readBoolean(payload, ["grindingReported", "grinding"]),
    ...[
      "morning.jawPain",
      "morning.templePain",
      "morning.stiffness",
      "morning.dentalSensitivity",
      "evening.jawPain",
      "evening.templePain",
      "evening.stiffness",
      "evening.dentalSensitivity",
    ].map((path) => readBoundedNumber(payload, [path], 0, 4)),
  ];
  if (signals.some((reading) =>
    reading.state === "known" &&
      (reading.value === true || (typeof reading.value === "number" && reading.value > 0)),
  )) return { state: "known", value: true };
  if (signals.every((reading) =>
    reading.state === "confirmed_absent" ||
      (reading.state === "known" && (reading.value === false || reading.value === 0)),
  )) return { state: "confirmed_absent" };
  if (signals.some((reading) => reading.state === "invalid")) return { state: "invalid" };
  return { state: "unknown" };
}

function summarizeBruxismo(
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
): DomainAnalyticsSummary {
  const events = entities.filter((entity) => isBruxismEvent(eventPayload(entity)));
  const episodeReadings = events.map((entity) =>
    bruxismPresenceReading(eventPayload(entity)),
  );
  const presentDays = new Set<LocalDate>();
  const absentDays = new Set<LocalDate>();
  events.forEach((entity, index) => {
    const reading = episodeReadings[index];
    if (reading.state === "known" && reading.value === true) {
      presentDays.add(entity.localDate);
      absentDays.delete(entity.localDate);
    } else if (!presentDays.has(entity.localDate) &&
      (reading.state === "confirmed_absent" ||
        (reading.state === "known" && reading.value === false))) {
      absentDays.add(entity.localDate);
    }
  });
  const presence: DailyPresence = {
    presentDays,
    absentDays,
    unknownDays: new Set(),
  };
  const knownDays = presence.presentDays.size + presence.absentDays.size;
  const morningPainReadings = events.map((entity) => readBoundedNumber(
    eventPayload(entity),
    ["morning.jawPain"],
    0,
    4,
  ));
  const eveningPainReadings = events.map((entity) => readBoundedNumber(
    eventPayload(entity),
    ["evening.jawPain"],
    0,
    4,
  ));
  const legacyPainReadings = events.flatMap((entity, index) => {
    if (morningPainReadings[index].state !== "unknown" ||
      eveningPainReadings[index].state !== "unknown") return [];
    return [readNumber(eventPayload(entity), [
      "painIntensity",
      "jawPainIntensity",
      "pain.intensity",
    ])];
  });
  let legacyPainIndex = 0;
  const painReadings = events.flatMap((_, index) => {
    if (morningPainReadings[index].state !== "unknown" ||
      eveningPainReadings[index].state !== "unknown") {
      return [morningPainReadings[index], eveningPainReadings[index]];
    }
    const legacy = legacyPainReadings[legacyPainIndex];
    legacyPainIndex += 1;
    return legacy ? [legacy] : [];
  });
  const painValues = painReadings.flatMap((reading) =>
    reading.state === "known" ? [reading.value!] : [],
  );
  const morningPainValues = morningPainReadings.flatMap((reading) =>
    reading.state === "known" ? [reading.value!] : [],
  );
  const eveningPainValues = eveningPainReadings.flatMap((reading) =>
    reading.state === "known" ? [reading.value!] : [],
  );
  const morningSymptoms = events.map((entity) => readBoolean(eventPayload(entity), [
    "morningSymptoms",
    "morning.stiffness",
    "wakeSymptomsPresent",
  ]));
  const splintUse = events.map((entity) => readBoolean(eventPayload(entity), [
    "guardUsed",
    "splintUsed",
    "nightGuardUsed",
    "intervention.splintUsed",
  ]));
  const limitation = events.map((entity) => readBoolean(eventPayload(entity), [
    "openingLimitation",
    "chewingLimitation",
    "function.limited",
  ]));
  const presentEpisodes = episodeReadings.filter(
    (reading) => reading.state === "known" && reading.value === true,
  ).length;
  return makeDomainSummary("bruxismo", entities, window, [
    makeMetric({
      key: "bruxism_episodes",
      label: "Episódios com sinais registrados",
      value: countKnown(episodeReadings) ? presentEpisodes : null,
      unit: "count",
      n: countKnown(episodeReadings),
      missing: countMissing(episodeReadings),
      confirmedAbsences: episodeReadings.filter(({ state }) => state === "confirmed_absent").length,
      description: "Conta somente eventos com sinal explícito; notas livres não viram episódios.",
    }),
    makeMetric({
      key: "bruxism_days",
      label: "Dias com sinais confirmados",
      value: knownDays ? presence.presentDays.size : null,
      unit: "count",
      n: knownDays,
      missing: Math.max(0, window.days - knownDays),
      confirmedAbsences: presence.absentDays.size,
      description: "Presença ou ausência explicitamente marcada; silêncio não é ausência.",
    }),
    makeMetric({
      key: "jaw_pain_average",
      label: "Dor mandibular média",
      value: average(painValues),
      unit: "score",
      n: painValues.length,
      missing: countMissing(painReadings),
      description: "Intensidade informada em check-ins; não diagnostica bruxismo ou DTM.",
    }),
    makeMetric({
      key: "jaw_pain_morning_average",
      label: "Dor mandibular média ao acordar",
      value: average(morningPainValues),
      unit: "score",
      n: morningPainValues.length,
      missing: countMissing(morningPainReadings),
      description: "Escala 0–4 do campo matinal atual; zero é resposta válida.",
    }),
    makeMetric({
      key: "jaw_pain_evening_average",
      label: "Dor mandibular média no fim do dia",
      value: average(eveningPainValues),
      unit: "score",
      n: eveningPainValues.length,
      missing: countMissing(eveningPainReadings),
      description: "Escala 0–4 do campo noturno atual; vazio permanece desconhecido.",
    }),
    makeMetric({
      key: "morning_symptom_events",
      label: "Check-ins matinais com sintomas",
      value: countKnown(morningSymptoms)
        ? morningSymptoms.filter((reading) => reading.state === "known" && reading.value === true).length
        : null,
      unit: "count",
      n: countKnown(morningSymptoms),
      missing: countMissing(morningSymptoms),
      confirmedAbsences: morningSymptoms.filter((reading) =>
        reading.state === "confirmed_absent" ||
        (reading.state === "known" && reading.value === false)
      ).length,
      description: "Sintomas ao despertar permanecem separados dos noturnos.",
    }),
    makeMetric({
      key: "functional_limitation_events",
      label: "Limitação funcional registrada",
      value: countKnown(limitation)
        ? limitation.filter((reading) => reading.state === "known" && reading.value === true).length
        : null,
      unit: "count",
      n: countKnown(limitation),
      missing: countMissing(limitation),
      description: "Abertura ou mastigação limitada quando explicitamente registrada.",
    }),
    makeMetric({
      key: "splint_use_events",
      label: "Uso de placa registrado",
      value: countKnown(splintUse)
        ? splintUse.filter((reading) => reading.state === "known" && reading.value === true).length
        : null,
      unit: "count",
      n: countKnown(splintUse),
      missing: countMissing(splintUse),
      confirmedAbsences: splintUse.filter((reading) =>
        reading.state === "confirmed_absent" ||
        (reading.state === "known" && reading.value === false)
      ).length,
      description: "Uso informado quando aplicável; não prescreve intervenção.",
    }),
  ]);
}

function normalizeMovementKind(value: string): string {
  const normalized = value.toLowerCase().replace(/[ -]/g, "_");
  if (["income", "receita", "entrada"].includes(normalized)) return "income";
  if (["expense", "despesa", "saida", "saída"].includes(normalized)) return "expense";
  if (["debt", "divida", "dívida"].includes(normalized)) return "debt";
  if (["bill", "obligation", "vencimento"].includes(normalized)) return "bill";
  if (["subscription", "assinatura"].includes(normalized)) return "subscription";
  if (["interest", "juros"].includes(normalized)) return "interest";
  return normalized;
}

function canonicalTransactionBelongsToFlow(
  entity: MentorEntity,
  payload: UnknownRecord,
): boolean {
  if (entity.type !== "financas.transaction") return true;
  const status = readString(payload, ["status"]);
  return status.state === "known" && status.value === "posted";
}

function canonicalObligationIsActive(
  entity: MentorEntity,
  payload: UnknownRecord,
): boolean {
  if (eventKind(payload) === "finance-subscription") {
    return financeSubscriptionIsConfirmedActive(payload);
  }
  const status = readString(payload, ["status"]);
  // Uma quitação/cancelamento explícito também vale para as obrigações do formato legado.
  if (["finance-bill", "finance-debt"].includes(eventKind(payload)) && status.state === "known" && ["paid", "cancelled", "closed", "finished_confirmed"].includes(status.value!)) return false;
  if (entity.type === "financas.bill") {
    return status.state === "known" && !["paid", "cancelled"].includes(status.value!);
  }
  if (entity.type === "financas.debt") {
    return status.state === "known" && status.value === "active";
  }
  if (entity.type === "financas.card") {
    return status.state === "known" && status.value === "active";
  }
  // Legacy finance payloads did not always have a canonical status. Preserve
  // their prior behavior instead of treating a missing legacy field as paid.
  return true;
}

function summarizeFinancas(
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
  obligationEntities: readonly MentorEntity[] = entities,
): DomainAnalyticsSummary {
  const movements = entities.filter((entity) => {
    const payload = eventPayload(entity);
    return canonicalTransactionBelongsToFlow(entity, payload) &&
      !isUnstructuredNote(payload) && ([
      "financial-movement",
      "finance-transaction",
      "finance-debt",
      "finance-bill",
      "finance-subscription",
      "finance-interest",
    ].includes(eventKind(payload)) ||
      ["financas.transaction", "financas.debt", "financas.bill"].includes(entity.type) ||
      hasAnyPath(payload, ["movementKind", "transaction.direction", "direction"]));
  });
  const movementValues = movements.map((entity) => {
    const payload = eventPayload(entity);
    const kindReading = readString(payload, [
      "movementKind",
      "transaction.direction",
      "transaction.kind",
      "direction",
    ]);
    const explicitKind = kindReading.state === "known"
      ? normalizeMovementKind(kindReading.value!)
      : null;
    const kindFromShape = eventKind(payload) === "finance-debt" || entity.type === "financas.debt"
      ? "debt"
      : eventKind(payload) === "finance-bill" || entity.type === "financas.bill" ||
          eventKind(payload) === "finance-subscription"
        ? "bill"
        : eventKind(payload) === "finance-interest"
          ? "interest"
          : null;
    const kind = explicitKind ?? kindFromShape;
    const amountPaths = kind === "debt"
      ? ["debt.outstanding", "outstandingBalance", "outstanding", "amount"]
      : kind === "bill"
        ? ["bill.amount", "subscription.price", "obligation.amount", "amount"]
        : kind === "interest"
          ? ["interestCharged", "debt.interestCharged", "bill.interestCharged", "amount"]
          : ["amount", "money", "transaction.amount", "amountMinor"];
    const amount = readMoney(payload, amountPaths);
    return {
      kind: kind === null
        ? kindReading
        : { state: "known" as const, value: kind },
      amount: amount.state === "known" && amount.value! < 0
        ? { state: "invalid" as const }
        : amount,
      entity,
    };
  });
  const incomes: number[] = [];
  const expenses: number[] = [];
  const debts: number[] = [];
  const bills: number[] = [];
  let flowMovementCount = 0;
  let comparableFlowMovements = 0;
  for (const movement of movementValues) {
    if (movement.kind.state !== "known") continue;
    const kind = normalizeMovementKind(movement.kind.value!);
    if (kind === "income" || kind === "expense") flowMovementCount += 1;
    if (movement.amount.state !== "known") continue;
    const amount = movement.amount.value!;
    if (kind === "income") {
      comparableFlowMovements += 1;
      incomes.push(amount);
    } else if (kind === "expense") {
      comparableFlowMovements += 1;
      expenses.push(amount);
    } else if (kind === "debt") debts.push(amount);
    else if (kind === "bill" || kind === "subscription") bills.push(amount);
  }
  const interestReadings = movements.flatMap((entity): Reading<number>[] => {
    const payload = eventPayload(entity);
    const kind = eventKind(payload);
    if (
      entity.type === "financas.bill" ||
      entity.type === "financas.debt" ||
      ["finance-bill", "finance-debt", "finance-interest"].includes(kind)
    ) {
      return [readMoney(payload, [
        "interestCharged",
        "debt.interestCharged",
        "bill.interestCharged",
        ...(kind === "finance-interest" ? ["amount"] : []),
      ])];
    }
    return [];
  });
  const interest = interestReadings.flatMap((reading) =>
    reading.state === "known" && reading.value! >= 0 ? [reading.value!] : [],
  );
  const accounts = entities.filter((entity) => entity.type === "financas.account" || hasAnyPath(eventPayload(entity), ["providerName", "balance"]));
  const balances = accounts.map((entity) => readMoney(eventPayload(entity), ["balance", "account.balance"]));
  const knownBalances = balances.flatMap((reading) =>
    reading.state === "known" ? [reading.value!] : [],
  );
  const allBalancesKnown = accounts.length > 0 && knownBalances.length === accounts.length;

  const obligations = obligationEntities.flatMap((entity) => {
    const payload = eventPayload(entity);
    if (!canonicalObligationIsActive(entity, payload)) return [];
    const subscription = eventKind(payload) === "finance-subscription";
    const dueDate = readString(payload, subscription ? ["subscription.renewalDate", "renewalDate", "dueDate"] : [
      "dueDate",
      "debt.dueDate",
      "bill.dueDate",
      "obligation.dueDate",
      "renewalDate",
      "subscription.renewalDate",
    ]);
    // Fatura e mínimo são obrigações distintas, não aliases. Preserva-se a escolha já contratada.
    const statement = entity.type === "financas.card" ? readMoney(payload, ["currentStatementAmount"]) : null;
    const minimum = entity.type === "financas.card" ? readMoney(payload, ["minimumPayment"]) : null;
    const amount = statement && minimum
      ? statement.state === "known" ? statement : minimum.state === "known" ? minimum : statement
      : readMoney(payload, subscription ? ["subscription.price", "price", "amount"] : [
          "amount",
          "bill.amount",
          "debt.minimumPayment",
          "minimumPayment",
          "subscription.price",
          "obligation.amount",
          "amountMinor",
        ]);
    const topLevel = dueDate.state === "known" && /^\d{4}-\d{2}-\d{2}$/.test(dueDate.value!)
      ? [{
          dueDate: dueDate.value! as LocalDate,
          distance: localDateDifference(window.end, dueDate.value! as LocalDate),
          amount: amount.state === "known" && amount.value! < 0
            ? { state: "invalid" as const }
            : amount,
        }]
      : [];

    if (entity.type !== "financas.card") return topLevel;

    const installments = readRecordArray(payload, ["installments"]);
    if (installments.state !== "known") return topLevel;
    const coveredDueDate = topLevel.length && topLevel[0].amount.state === "known"
      ? topLevel[0].dueDate
      : null;
    const installmentObligations = installments.value!.flatMap((installment) => {
      const remaining = readNumber(installment, ["remainingInstallments"]);
      if (remaining.state === "known" && remaining.value! <= 0) return [];
      const installmentDueDate = readString(installment, ["nextDueDate"]);
      if (
        installmentDueDate.state !== "known" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(installmentDueDate.value!) ||
        installmentDueDate.value === coveredDueDate
      ) return [];
      const installmentAmount = readMoney(installment, ["installmentAmount"]);
      return [{
        dueDate: installmentDueDate.value! as LocalDate,
        distance: localDateDifference(
          window.end,
          installmentDueDate.value! as LocalDate,
        ),
        amount: installmentAmount.state === "known" && installmentAmount.value! < 0
          ? { state: "invalid" as const }
          : installmentAmount,
      }];
    });
    return [...topLevel, ...installmentObligations];
  });
  const due7 = obligations.filter(({ distance }) => distance >= 0 && distance < 7);
  const due30 = obligations.filter(({ distance }) => distance >= 0 && distance <= 30);
  const sumKnown = (items: readonly { amount: Reading<number> }[]): number | null => {
    const values = items.flatMap(({ amount }) => amount.state === "known" ? [amount.value!] : []);
    return values.length ? sumBRLMinor(values) : null;
  };
  const incomeTotal = incomes.length ? sumBRLMinor(incomes) : null;
  const expenseTotal = expenses.length ? sumBRLMinor(expenses) : null;
  const hasCompleteFlow = incomeTotal !== null && expenseTotal !== null;
  const missingForKind = (target: string): number => movementValues.filter(({ kind, amount }) =>
    kind.state === "known" && normalizeMovementKind(kind.value!) === target &&
      amount.state !== "known",
  ).length;
  return makeDomainSummary("financas", entities, window, [
    makeMetric({
      key: "income_minor",
      label: "Entradas registradas",
      value: incomeTotal,
      unit: "BRL_minor",
      n: incomes.length,
      missing: missingForKind("income"),
      description: "Soma inteira em centavos; transações canônicas pendentes ou anuladas ficam fora do fluxo.",
    }),
    makeMetric({
      key: "expense_minor",
      label: "Saídas registradas",
      value: expenseTotal,
      unit: "BRL_minor",
      n: expenses.length,
      missing: missingForKind("expense"),
      description: "Somente saídas canônicas postadas e fatos legados explícitos; não executa transações.",
    }),
    makeMetric({
      key: "net_flow_minor",
      label: "Fluxo líquido registrado",
      value: hasCompleteFlow ? incomeTotal - expenseTotal : null,
      unit: "BRL_minor",
      n: comparableFlowMovements,
      missing: Math.max(0, flowMovementCount - comparableFlowMovements),
      description: "Entradas menos saídas somente quando ambos os lados possuem amostra; não é saldo bancário.",
    }),
    makeMetric({
      key: "consolidated_balance_minor",
      label: "Saldo consolidado informado",
      value: allBalancesKnown ? sumBRLMinor(knownBalances) : null,
      unit: "BRL_minor",
      n: knownBalances.length,
      missing: Math.max(0, accounts.length - knownBalances.length),
      description: "Só aparece quando todas as contas candidatas possuem saldo explicitamente informado.",
    }),
    makeMetric({
      key: "obligations_7d_minor",
      label: "Obrigações em 7 dias",
      value: sumKnown(due7),
      unit: "BRL_minor",
      n: due7.filter(({ amount }) => amount.state === "known").length,
      missing: due7.filter(({ amount }) => amount.state !== "known").length,
      description: "Valores ativos com vencimento datado nos próximos sete dias; pagos e cancelados ficam fora.",
    }),
    makeMetric({
      key: "obligations_30d_minor",
      label: "Obrigações em 30 dias",
      value: sumKnown(due30),
      unit: "BRL_minor",
      n: due30.filter(({ amount }) => amount.state === "known").length,
      missing: due30.filter(({ amount }) => amount.state !== "known").length,
      description: "Valores ativos com vencimento datado nos próximos trinta dias, inclusive registros canônicos futuros.",
    }),
    makeMetric({
      key: "debt_recorded_minor",
      label: "Dívida registrada",
      value: debts.length ? sumBRLMinor(debts) : null,
      unit: "BRL_minor",
      n: debts.length,
      missing: missingForKind("debt"),
      description: "Saldo ou movimento classificado como dívida, sem inferir juros ausentes.",
    }),
    makeMetric({
      key: "bill_recorded_minor",
      label: "Contas e assinaturas registradas",
      value: bills.length ? sumBRLMinor(bills) : null,
      unit: "BRL_minor",
      n: bills.length,
      missing: missingForKind("bill") + missingForKind("subscription"),
      description: "Obrigações explicitamente registradas; não são tratadas como despesa paga.",
    }),
    makeMetric({
      key: "interest_recorded_minor",
      label: "Juros registrados",
      value: interest.length ? sumBRLMinor(interest) : null,
      unit: "BRL_minor",
      n: interest.length,
      missing: countMissing(interestReadings),
      description: "Juros explicitamente cadastrados, sem estimar taxa desconhecida.",
    }),
  ]);
}

function summarizeRotina(
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
): DomainAnalyticsSummary {
  const blocks = entities.filter((entity) => {
    const payload = eventPayload(entity);
    return !isUnstructuredNote(payload) && (["routine-day-plan", "routine-block", "routine-anchor"].includes(
      eventKind(payload),
    ) || hasAnyPath(payload, [
      "plannedDurationMinutes",
      "actualDurationMinutes",
      "completed",
      "replanned",
      "anchors",
      "tasks",
    ]));
  });
  const routinePlans = blocks.filter((entity) =>
    eventKind(eventPayload(entity)) === "routine-day-plan" ||
    hasAnyPath(eventPayload(entity), ["anchors", "tasks", "closure.state"])
  );
  const scalarBlocks = blocks.filter((entity) => !routinePlans.includes(entity));
  const completion: Reading<boolean>[] = scalarBlocks.map((entity) => readBoolean(eventPayload(entity), [
    "completed",
    "completion.completed",
    "status",
  ]));
  const nestedTaskReadings: Reading<boolean>[] = [];
  let deferredTasks = 0;
  let nestedTaskCount = 0;
  for (const entity of routinePlans) {
    const tasks = readRecordArray(eventPayload(entity), ["tasks"]);
    if (tasks.state !== "known") {
      if (tasks.state !== "not_applicable") nestedTaskReadings.push({ state: tasks.state });
      continue;
    }
    for (const task of tasks.value!) {
      const title = readString(task, ["title"]);
      // Empty UI slots are not tasks. Historical payloads may contain the
      // three placeholders, so the reader defends this contract as well.
      if (title.state !== "known") continue;
      nestedTaskCount += 1;
      const status = readString(task, ["status"]);
      if (status.state !== "known") {
        nestedTaskReadings.push({ state: status.state });
        continue;
      }
      const normalized = status.value!.toLowerCase();
      if (["done", "completed"].includes(normalized)) {
        nestedTaskReadings.push({ state: "known", value: true });
      } else if (["planned", "deferred", "in_progress"].includes(normalized)) {
        nestedTaskReadings.push({ state: "known", value: false });
        if (normalized === "deferred") deferredTasks += 1;
      } else if (normalized === "cancelled") {
        nestedTaskReadings.push({ state: "not_applicable" });
      } else {
        nestedTaskReadings.push({ state: "invalid" });
      }
    }
  }
  completion.push(...nestedTaskReadings);

  const replanned = scalarBlocks.map((entity) => readBoolean(eventPayload(entity), [
    "replanned",
    "moved",
    "status.replanned",
  ]));
  const planned = scalarBlocks.map((entity) => readNumber(eventPayload(entity), [
    "plannedDurationMinutes",
    "plannedMinutes",
    "duration.plannedMinutes",
  ]));
  const actual = scalarBlocks.map((entity) => readNumber(eventPayload(entity), [
    "actualDurationMinutes",
    "actualMinutes",
    "duration.actualMinutes",
  ]));
  const estimateDeltas = scalarBlocks.flatMap((_, index) =>
    planned[index].state === "known" && actual[index].state === "known"
      ? [actual[index].value! - planned[index].value!]
      : [],
  );
  const completed = completion.filter(
    (reading) => reading.state === "known" && reading.value === true,
  ).length;
  const moved = replanned.filter(
    (reading) => reading.state === "known" && reading.value === true,
  ).length;
  const anchorEvents = scalarBlocks.filter((entity) => /anchor|ancora|âncora/.test(eventKind(eventPayload(entity))));
  const anchorCompletion = anchorEvents.map((entity) => readBoolean(eventPayload(entity), ["completed", "status"]));
  const anchorTimeReadings: Reading<string>[] = [];
  for (const entity of routinePlans) {
    const anchors = readRecordArray(eventPayload(entity), ["anchors"]);
    if (anchors.state !== "known") {
      if (anchors.state !== "not_applicable") anchorTimeReadings.push({ state: anchors.state });
      continue;
    }
    for (const anchor of anchors.value!) {
      anchorTimeReadings.push(readString(anchor, ["timeLocal"]));
    }
  }
  const scheduledAnchors = anchorTimeReadings.filter(({ state }) => state === "known").length;

  const typedClosureCount = entities.filter((entity) =>
    entity.type === "rotina.daily-closure" ||
    ["daily-closure", "day-close", "fechamento"].includes(eventKind(eventPayload(entity)))
  ).length;
  const closureStateReadings = routinePlans.map((entity) => readString(
    eventPayload(entity),
    ["closure.state"],
  ));
  const closedPlanCount = closureStateReadings.filter(
    (reading) => reading.state === "known" && reading.value!.toLowerCase() === "closed",
  ).length;
  const knownClosureStates = countKnown(closureStateReadings);
  return makeDomainSummary("rotina", entities, window, [
    makeMetric({
      key: "routine_records",
      label: "Registros de rotina",
      value: entities.length ? entities.length : null,
      unit: "count",
      n: entities.length,
      description: "Registros ativos na janela; dias sem registro permanecem desconhecidos.",
    }),
    makeMetric({
      key: "daily_closures",
      label: "Fechamentos diários",
      value: typedClosureCount + knownClosureStates
        ? typedClosureCount + closedPlanCount
        : null,
      unit: "count",
      n: typedClosureCount + knownClosureStates,
      missing: countMissing(closureStateReadings),
      description: "Conta fechamentos tipados e planos com closure.state=closed; parcial permanece conhecido, mas não fechado.",
    }),
    makeMetric({
      key: "completed_blocks_percent",
      label: "Blocos concluídos",
      value: countKnown(completion) ? (completed / countKnown(completion)) * 100 : null,
      unit: "percent",
      n: countKnown(completion),
      missing: countMissing(completion),
      description: "Conclusão explícita de blocos; replanejar continua sendo um resultado válido.",
    }),
    makeMetric({
      key: "replanned_blocks",
      label: "Blocos reposicionados",
      value: countKnown(replanned) ? moved : null,
      unit: "count",
      n: countKnown(replanned),
      missing: countMissing(replanned),
      description: "Reposicionamentos informados, sem tratar flexibilidade como falha.",
    }),
    makeMetric({
      key: "estimate_delta_median_minutes",
      label: "Erro mediano de estimativa",
      value: median(estimateDeltas),
      unit: "minutes",
      n: estimateDeltas.length,
      missing: Math.max(0, scalarBlocks.length - estimateDeltas.length),
      description: "Duração realizada menos planejada em blocos comparáveis.",
    }),
    makeMetric({
      key: "anchor_completion_percent",
      label: "Âncoras realizadas",
      value: countKnown(anchorCompletion)
        ? (anchorCompletion.filter((reading) => reading.state === "known" && reading.value === true).length /
          countKnown(anchorCompletion)) * 100
        : null,
      unit: "percent",
      n: countKnown(anchorCompletion),
      missing: countMissing(anchorCompletion),
      description: "Acordar, medicamento, estágio, alimentação, estudo ou fechamento apenas quando modelados como âncoras.",
    }),
    makeMetric({
      key: "routine_tasks",
      label: "Tarefas no trilho do dia",
      value: nestedTaskCount || null,
      unit: "count",
      n: nestedTaskCount,
      description: "Tarefas explicitamente presentes nos planos diários.",
    }),
    makeMetric({
      key: "deferred_tasks",
      label: "Tarefas adiadas confirmadas",
      value: countKnown(nestedTaskReadings) ? deferredTasks : null,
      unit: "count",
      n: countKnown(nestedTaskReadings),
      missing: countMissing(nestedTaskReadings),
      description: "Estado deferred explícito; tarefa desconhecida não é classificada como adiada.",
    }),
    makeMetric({
      key: "anchors_scheduled",
      label: "Âncoras com horário",
      value: countKnown(anchorTimeReadings) ? scheduledAnchors : null,
      unit: "count",
      n: scheduledAnchors,
      missing: countMissing(anchorTimeReadings),
      description: "Horários informados nas âncoras atuais; horário não significa realização.",
    }),
  ]);
}

interface TimedAgendaEvent {
  entity: MentorEntity;
  start: number;
  end: number;
  bufferBefore: Reading<number>;
  bufferAfter: Reading<number>;
}

function readAgendaBuffer(
  payload: UnknownRecord,
  path: "bufferBeforeMinutes" | "bufferAfterMinutes",
): Reading<number> {
  const raw = getPath(payload, path);
  if (raw === undefined) return { state: "unknown" };
  const normalized = normalizeState(raw);
  if (
    normalized.state === "not_applicable" ||
    normalized.state === "confirmed_absent"
  ) {
    // These states explicitly mean that no buffer was requested. This is not
    // the same thing as silently coercing an unknown buffer to zero.
    return { state: "known", value: 0 };
  }
  if (normalized.state !== "known") return { state: normalized.state };
  const value = finiteNumber(normalized.value);
  return value !== null && Number.isSafeInteger(value) && value >= 0
    ? { state: "known", value }
    : { state: "invalid" };
}

function agendaTaskCompletion(payload: UnknownRecord): Reading<boolean> {
  const explicit = readBoolean(payload, ["completed", "status.completed"]);
  if (explicit.state !== "unknown") return explicit;
  const status = readString(payload, ["status", "task.status"]);
  if (status.state !== "known") return { state: status.state };
  const normalized = status.value!.toLowerCase();
  if (["completed", "done"].includes(normalized)) return { state: "known", value: true };
  if (["captured", "planned", "in_progress", "deferred"].includes(normalized)) {
    return { state: "known", value: false };
  }
  return normalized === "cancelled"
    ? { state: "not_applicable" }
    : { state: "invalid" };
}

function readAgendaDateTime(
  payload: UnknownRecord,
  timePaths: readonly string[],
): Reading<string> {
  const time = readString(payload, timePaths);
  if (time.state !== "known") return { state: time.state };
  if (civilMinute(time.value!) !== null) return time;
  if (clockMinutes(time.value!) === null) return { state: "invalid" };
  const date = readString(payload, ["date", "event.date", "localDate"]);
  if (date.state !== "known") return { state: date.state };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value!)) return { state: "invalid" };
  const combined = `${date.value!}T${time.value!}`;
  return civilMinute(combined) === null
    ? { state: "invalid" }
    : { state: "known", value: combined };
}

function readAgendaDueDate(payload: UnknownRecord): Reading<LocalDate> {
  const due = readString(payload, [
    "dueLocalDate",
    "dueDate",
    "task.dueDate",
    "task.dueLocal",
  ]);
  if (due.state !== "known") return { state: due.state };
  if (/^\d{4}-\d{2}-\d{2}$/.test(due.value!)) {
    return { state: "known", value: due.value! as LocalDate };
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(due.value!) && civilMinute(due.value!) !== null) {
    return { state: "known", value: due.value!.slice(0, 10) as LocalDate };
  }
  if (clockMinutes(due.value!) !== null) {
    const date = readString(payload, ["date", "task.date", "localDate"]);
    return date.state === "known" && /^\d{4}-\d{2}-\d{2}$/.test(date.value!)
      ? { state: "known", value: date.value! as LocalDate }
      : { state: date.state === "known" ? "invalid" : date.state };
  }
  return { state: "invalid" };
}

function summarizeAgenda(
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
): DomainAnalyticsSummary {
  const commitments = entities.filter((entity) => {
    const payload = eventPayload(entity);
    if (isUnstructuredNote(payload)) return false;
    if (entity.type === "agenda.event") return true;
    if (entity.type === "agenda.task") return false;
    return (
      /(appointment|commitment|calendar|event)/.test(eventKind(payload)) || hasAnyPath(payload, [
      "plannedStartLocal",
      "startLocal",
      "scheduledStartLocal",
      "calendar.startLocal",
      "event.startLocal",
      ])
    );
  });
  const timed: TimedAgendaEvent[] = [];
  let timeMissing = 0;
  for (const entity of commitments) {
    const payload = eventPayload(entity);
    const status = readString(payload, ["status"]);
    if (status.state === "known" && status.value!.toLowerCase() === "cancelled") continue;
    const start = readAgendaDateTime(payload, [
      "plannedStartLocal",
      "startLocal",
      "scheduledStartLocal",
      "calendar.startLocal",
      "event.startLocal",
    ]);
    const end = readAgendaDateTime(payload, [
      "plannedEndLocal",
      "endLocal",
      "scheduledEndLocal",
      "calendar.endLocal",
      "event.endLocal",
    ]);
    if (start.state !== "known" || end.state !== "known") {
      timeMissing += 1;
      continue;
    }
    const startMinute = civilMinute(start.value!);
    const endMinute = civilMinute(end.value!);
    if (startMinute === null || endMinute === null || endMinute <= startMinute) {
      timeMissing += 1;
      continue;
    }
    timed.push({
      entity,
      start: startMinute,
      end: endMinute,
      bufferBefore: readAgendaBuffer(payload, "bufferBeforeMinutes"),
      bufferAfter: readAgendaBuffer(payload, "bufferAfterMinutes"),
    });
  }
  timed.sort((left, right) => left.start - right.start || left.entity.id.localeCompare(right.entity.id));
  let conflicts = 0;
  let bufferShortfalls = 0;
  let bufferComparisons = 0;
  let bufferMissing = 0;
  for (let firstIndex = 0; firstIndex < timed.length; firstIndex += 1) {
    const first = timed[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < timed.length; secondIndex += 1) {
      const second = timed[secondIndex];
      if (second.start < first.end) {
        conflicts += 1;
        continue;
      }
      if (first.bufferAfter.state !== "known" || second.bufferBefore.state !== "known") {
        bufferMissing += 1;
        continue;
      }
      bufferComparisons += 1;
      const requested = first.bufferAfter.value! + second.bufferBefore.value!;
      if (second.start - first.end < requested) bufferShortfalls += 1;
    }
  }
  const committedMinutes = timed.reduce((sum, item) => sum + item.end - item.start, 0);
  const tasks = entities.filter((entity) => {
    const payload = eventPayload(entity);
    return !isUnstructuredNote(payload) &&
      (entity.type === "agenda.task" || /(task|tarefa|todo)/.test(eventKind(payload)));
  });
  let overdue = 0;
  let overdueKnown = 0;
  let overdueMissing = 0;
  let nextActionKnown = 0;
  let nextActionAbsent = 0;
  let nextActionMissing = 0;
  for (const entity of tasks) {
    const payload = eventPayload(entity);
    const completed = agendaTaskCompletion(payload);
    const due = readAgendaDueDate(payload);
    if (due.state === "known") {
      if (completed.state === "known") {
        overdueKnown += 1;
        if (due.value! < window.end && completed.value === false) overdue += 1;
      } else if (completed.state !== "not_applicable") {
        overdueMissing += 1;
      }
    } else if (due.state !== "not_applicable" && completed.state !== "not_applicable") {
      overdueMissing += 1;
    }
    if (hasAnyPath(payload, ["nextAction", "task.nextAction"])) {
      const nextAction = readString(payload, ["nextAction", "task.nextAction"]);
      if (nextAction.state === "known") nextActionKnown += 1;
      else if (nextAction.state === "confirmed_absent") {
        nextActionKnown += 1;
        nextActionAbsent += 1;
      } else if (nextAction.state !== "not_applicable") nextActionMissing += 1;
    }
  }
  return makeDomainSummary("agenda", entities, window, [
    makeMetric({
      key: "commitments",
      label: "Compromissos registrados",
      value: commitments.length,
      unit: "count",
      n: commitments.length,
      description: "Compromissos com hora permanecem distintos de tarefas.",
    }),
    makeMetric({
      key: "committed_minutes",
      label: "Tempo comprometido",
      value: timed.length ? committedMinutes : null,
      unit: "minutes",
      n: timed.length,
      missing: timeMissing,
      description: "Soma dos intervalos com início e fim válidos; sobreposições não são removidas silenciosamente.",
    }),
    makeMetric({
      key: "schedule_conflicts",
      label: "Conflitos de horário",
      value: conflicts,
      unit: "count",
      n: timed.length,
      missing: timeMissing,
      description: "Sobreposições determinísticas entre compromissos com horário completo.",
    }),
    makeMetric({
      key: "buffer_shortfalls",
      label: "Buffers solicitados não atendidos",
      value: bufferComparisons ? bufferShortfalls : null,
      unit: "count",
      n: bufferComparisons,
      missing: bufferMissing + timeMissing,
      description: "Compara apenas buffers explicitamente solicitados; buffer desconhecido não vira zero.",
    }),
    makeMetric({
      key: "overdue_tasks",
      label: "Tarefas vencidas registradas",
      value: overdueKnown ? overdue : null,
      unit: "count",
      n: overdueKnown,
      missing: overdueMissing,
      description: "Data vencida e estado explicitamente não concluído; conclusão desconhecida não vira pendência.",
    }),
    makeMetric({
      key: "tasks_without_next_action",
      label: "Tarefas com ausência confirmada de próxima ação",
      value: nextActionKnown ? nextActionAbsent : null,
      unit: "count",
      n: nextActionKnown,
      missing: nextActionMissing,
      confirmedAbsences: nextActionAbsent,
      description: "Conta somente ausência explícita; campo não modelado ou desconhecido não é ausência.",
    }),
  ]);
}

function summarizeIA(
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
): DomainAnalyticsSummary {
  const tools = entities.filter((entity) => {
    const payload = eventPayload(entity);
    return /(tool|subscription|ai|ia)/.test(eventKind(payload)) || hasAnyPath(payload, [
      "toolName",
      "monthlyCost",
      "renewalDate",
      "subscription.price",
      "subscription.renewalDate",
    ]);
  });
  const costs = tools.map((entity): Reading<number> => {
    const payload = eventPayload(entity);
    const amount = readMoney(payload, [
      "monthlyCost",
      "cost",
      "subscription.price",
      "subscription.amount",
      "amountMinor",
    ]);
    if (amount.state !== "known") return amount;
    if (hasAnyPath(payload, ["monthlyCost"])) return amount;
    const cadence = readString(payload, ["subscription.cadence", "cadence"]);
    if (cadence.state !== "known") return { state: cadence.state };
    const normalized = cadence.value!.toLowerCase();
    if (["monthly", "mensal", "month"].includes(normalized)) return amount;
    if (["yearly", "annual", "anual", "year"].includes(normalized)) {
      return { state: "known", value: Math.round(amount.value! / 12) };
    }
    return { state: "unknown" };
  });
  const knownCosts = costs.flatMap((reading) => reading.state === "known" ? [reading.value!] : []);
  const deliveries = tools.map((entity) => readNumber(eventPayload(entity), [
    "deliveries",
    "outputsCount",
    "project.deliveries",
  ]));
  const deliveryCount = deliveries.reduce(
    (sum, reading) => sum + (reading.state === "known" ? Math.max(0, reading.value!) : 0),
    0,
  );
  const renewals = tools.flatMap((entity) => {
    const reading = readString(eventPayload(entity), ["renewalDate", "subscription.renewalDate"]);
    if (reading.state !== "known" || !/^\d{4}-\d{2}-\d{2}$/.test(reading.value!)) return [];
    return [localDateDifference(window.end, reading.value! as LocalDate)];
  });
  const renewal7 = renewals.filter((distance) => distance >= 0 && distance <= 7).length;
  const renewal30 = renewals.filter((distance) => distance >= 0 && distance <= 30).length;
  const useReadings = tools.map((entity) => readNumber(eventPayload(entity), [
    "useCount",
    "usage.count",
    "activeDays",
  ]));
  const noUse = useReadings.filter(
    (reading) => reading.state === "known" && reading.value === 0,
  ).length;
  const totalCost = knownCosts.length ? sumBRLMinor(knownCosts) : null;
  return makeDomainSummary("ia", entities, window, [
    makeMetric({
      key: "monthly_cost_minor",
      label: "Custo mensal cadastrado",
      value: totalCost,
      unit: "BRL_minor",
      n: knownCosts.length,
      missing: countMissing(costs),
      description: "Custos mensais em centavos; valores anuais são divididos por 12 e periodicidade desconhecida não é presumida.",
    }),
    makeMetric({
      key: "deliveries",
      label: "Entregas vinculadas",
      value: countKnown(deliveries) ? deliveryCount : null,
      unit: "count",
      n: deliveries.filter(({ state }) => state === "known").length,
      missing: countMissing(deliveries),
      description: "Entregas explicitamente relacionadas a uma ferramenta ou projeto.",
    }),
    makeMetric({
      key: "cost_per_delivery_minor",
      label: "Custo por entrega",
      value: totalCost !== null && deliveryCount > 0 ? Math.round(totalCost / deliveryCount) : null,
      unit: "BRL_minor",
      n: deliveryCount,
      missing: totalCost === null ? 1 : 0,
      description: "Custo cadastrado dividido por entregas; não mede qualidade nem valor subjetivo.",
    }),
    makeMetric({
      key: "renewals_7d",
      label: "Renovações em 7 dias",
      value: renewals.length ? renewal7 : null,
      unit: "count",
      n: renewals.length,
      missing: Math.max(0, tools.length - renewals.length),
      description: "Renovações datadas nos próximos sete dias.",
    }),
    makeMetric({
      key: "renewals_30d",
      label: "Renovações em 30 dias",
      value: renewals.length ? renewal30 : null,
      unit: "count",
      n: renewals.length,
      missing: Math.max(0, tools.length - renewals.length),
      description: "Renovações datadas nos próximos trinta dias.",
    }),
    makeMetric({
      key: "tools_with_confirmed_no_use",
      label: "Ferramentas sem uso confirmado",
      value: countKnown(useReadings) ? noUse : null,
      unit: "count",
      n: useReadings.filter(({ state }) => state === "known").length,
      missing: countMissing(useReadings),
      confirmedAbsences: noUse,
      description: "Zero uso precisa estar explicitamente registrado; falta de registro não sugere cancelamento.",
    }),
  ]);
}

function summarizeConhecimento(
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
): DomainAnalyticsSummary {
  const notes = entities.filter((entity) => {
    const payload = eventPayload(entity);
    return /(note|knowledge|pearl|insight|tip|aprend)/.test(eventKind(payload)) || hasAnyPath(payload, [
      "note",
      "content",
      "reviewDueDate",
      "nextReviewDate",
      "convertedToQuestion",
    ]);
  });
  const reviews = notes.map((entity) => readBoolean(eventPayload(entity), [
    "reviewed",
    "review.completed",
    "status.reviewed",
  ]));
  const conversions = notes.map((entity) => readBoolean(eventPayload(entity), [
    "convertedToQuestion",
    "convertedToAction",
    "conversion.completed",
  ]));
  let dueReviews = 0;
  let dueKnown = 0;
  let reachedReviewDates = 0;
  let reachedDatesWithReviewState = 0;
  notes.forEach((entity, index) => {
    const due = readString(eventPayload(entity), [
      "nextReviewDate",
      "reviewDueDate",
      "review.dueDate",
    ]);
    if (due.state !== "known" || !/^\d{4}-\d{2}-\d{2}$/.test(due.value!)) return;
    dueKnown += 1;
    if (due.value! > window.end) return;
    reachedReviewDates += 1;
    const reviewed = reviews[index];
    if (reviewed.state === "known") {
      reachedDatesWithReviewState += 1;
      if (reviewed.value === false) dueReviews += 1;
    } else if (reviewed.state === "confirmed_absent") {
      reachedDatesWithReviewState += 1;
      dueReviews += 1;
    }
  });
  const reviewedCount = reviews.filter(
    (reading) => reading.state === "known" && reading.value === true,
  ).length;
  const convertedCount = conversions.filter(
    (reading) => reading.state === "known" && reading.value === true,
  ).length;
  return makeDomainSummary("conhecimento", entities, window, [
    makeMetric({
      key: "notes_captured",
      label: "Aprendizados capturados",
      value: notes.length,
      unit: "count",
      n: notes.length,
      description: "Pérolas, dicas ou notas recuperáveis; contagem de palavras não é usada.",
    }),
    makeMetric({
      key: "notes_reviewed",
      label: "Notas revisadas",
      value: countKnown(reviews) ? reviewedCount : null,
      unit: "count",
      n: countKnown(reviews),
      missing: countMissing(reviews),
      description: "Revisão explicitamente confirmada.",
    }),
    makeMetric({
      key: "reviews_due",
      label: "Revisões vencidas",
      value: reachedDatesWithReviewState ? dueReviews : null,
      unit: "count",
      n: reachedDatesWithReviewState,
      missing: Math.max(0, reachedReviewDates - reachedDatesWithReviewState),
      description: "Exige data alcançada e estado de revisão explicitamente não concluído; estado desconhecido não vira atraso.",
    }),
    makeMetric({
      key: "review_dates_reached",
      label: "Datas de revisão alcançadas",
      value: dueKnown ? reachedReviewDates : null,
      unit: "count",
      n: dueKnown,
      missing: Math.max(0, notes.length - dueKnown),
      description: "Datas nextReviewDate/reviewDueDate alcançadas, sem presumir se a revisão foi feita.",
    }),
    makeMetric({
      key: "notes_converted",
      label: "Notas convertidas em questão/ação",
      value: countKnown(conversions) ? convertedCount : null,
      unit: "count",
      n: countKnown(conversions),
      missing: countMissing(conversions),
      description: "Conversões explícitas em recuperação ativa ou próximo gesto.",
    }),
  ]);
}

function metricByKey(summary: DomainAnalyticsSummary, key: string): AnalyticsMetric | null {
  return summary.metrics.find((metric) => metric.key === key) ?? null;
}

function domainActionCandidates(summary: DomainAnalyticsSummary): NextActionCandidate[] {
  const candidates: NextActionCandidate[] = [];
  const add = (
    metricKey: string,
    priority: number,
    title: string,
    reason: (metric: AnalyticsMetric) => string,
    condition: (metric: AnalyticsMetric) => boolean,
    inferences: readonly string[] = [
      "A ação usa somente a leitura descritiva da métrica e não infere causa, diagnóstico ou necessidade de alterar medicação.",
    ],
  ) => {
    const metric = metricByKey(summary, metricKey);
    if (!metric || !condition(metric)) return;
    candidates.push({
      id: `${summary.domain}:${metricKey}`,
      domain: summary.domain,
      priority,
      title,
      reason: reason(metric),
      evidence: {
        metricKey,
        window: summary.window,
        value: metric.value,
        n: metric.n,
        missing: metric.missing,
        confirmedAbsences: metric.confirmedAbsences,
        completeness: metric.completeness,
        state: metric.state,
        inferences: [...inferences],
        limits: "no_diagnosis_no_causality_no_medication_change",
      },
      reversible: true,
      optional: true,
    });
  };

  if (summary.domain === "internato") add(
    "worked_minutes",
    95,
    "Completar uma jornada incompleta",
    (metric) => `${metric.missing} jornada(s) ainda não têm chegada e saída reais comparáveis.`,
    (metric) => metric.missing > 0,
  );
  if (summary.domain === "medicamentos") add(
    "dose_confirmation_percent",
    100,
    "Confirmar o estado da próxima dose",
    (metric) => `${metric.missing} registro(s) de dose permanecem desconhecidos; nenhum foi chamado de pulo.`,
    (metric) => metric.missing > 0,
  );
  if (summary.domain === "sono") add(
    "sleep_duration_average_minutes",
    90,
    "Fechar um episódio de sono",
    (metric) => `${metric.missing} episódio(s) têm duração incompleta; basta registrar o que você souber.`,
    (metric) => metric.missing > 0,
  );
  if (summary.domain === "agenda") add(
    "schedule_conflicts",
    85,
    "Revisar um conflito de agenda",
    (metric) => `${metric.value ?? 0} sobreposição(ões) foi(ram) calculada(s) em ${metric.n} compromissos completos.`,
    (metric) => (metric.value ?? 0) > 0,
  );
  if (summary.domain === "financas") add(
    "obligations_7d_minor",
    88,
    "Revisar os próximos vencimentos",
    (metric) => `${metric.n} obrigação(ões) com valor e vencimento entra(m) na janela de sete dias.`,
    (metric) => metric.n > 0,
  );
  if (summary.domain === "estudos") add(
    "question_accuracy_percent",
    55,
    "Escolher uma revisão pequena",
    (metric) => `${metric.n} questão(ões) sustenta(m) a amostra atual; escolha no máximo uma lacuna.`,
    (metric) => metric.n > 0 && metric.n < 14,
  );
  if (summary.domain === "conhecimento") add(
    "reviews_due",
    60,
    "Recuperar uma nota vencida",
    (metric) => `${metric.value ?? 0} nota(s) chegou(aram) à data de revisão.`,
    (metric) => (metric.value ?? 0) > 0,
  );

  if (summary.domain === "alimentacao") {
    add(
      "late_caffeine_events",
      74,
      "Revisar os horários de cafeína",
      (metric) =>
        `${metric.value} de ${metric.n} registro(s) com horário ocorreram após 18h; ${metric.missing} horário(s) seguem faltantes. Marque no planejador um horário-limite pessoal para observar por sete dias. Limite de inferência: este recorte não atribui efeito ao sono, ao humor ou à cefaleia.`,
      (metric) => metric.n >= 3 && metric.value !== null && metric.value >= 2,
      [
        "18h é um limiar operacional configurado para organizar a revisão, não um limite clínico individual.",
        "A coexistência temporal não implica efeito sobre sono, humor ou cefaleia.",
      ],
    );
    add(
      "longest_meal_gap_minutes",
      61,
      "Planejar uma refeição-âncora",
      (metric) =>
        `O maior intervalo observado foi ${metric.value} min entre ${metric.n} refeições com horário; ${metric.missing} horário(s) seguem faltantes. Escolha um único ponto desse intervalo para deixar visível na rotina. Limite de inferência: o registro descreve horários e não avalia adequação nutricional.`,
      (metric) => metric.n >= 6 && metric.value !== null && metric.value >= 360,
      [
        "O limiar de seis horas é um gatilho de planejamento, não uma prescrição nutricional.",
        "A métrica não informa quantidade, qualidade ou necessidade alimentar.",
      ],
    );
  }

  if (summary.domain === "humor") add(
    "short_sleep_high_energy_cooccurrence",
    82,
    "Separar os dias pareados para revisão",
    (metric) =>
      `${metric.value} coocorrência(s) apareceram em ${metric.n} dias com sono e energia completos; ${metric.missing} dia(s) não formaram par. Exporte esse recorte para revisar com contexto pessoal ou profissional. Limite de inferência: coocorrência não é diagnóstico, causalidade nem indica ajuste de medicação.`,
    (metric) => metric.n >= 14 && metric.value !== null && metric.value >= 2,
    [
      "O recorte exige pelo menos 14 dias pareados e conta apenas coexistência no mesmo dia.",
      "Não há inferência de causalidade, diagnóstico ou necessidade de alterar medicação.",
    ],
  );

  if (summary.domain === "cefaleia") {
    add(
      "headache_episodes",
      79,
      "Preparar um resumo das crises",
      (metric) =>
        `${metric.value} crise(s) com presença confirmada sustentam este recorte de ${summary.window.days} dias (n=${metric.n}; ${metric.missing} faltante(s) nesta métrica). Reúna datas e os campos já conhecidos para levar à revisão profissional. Limite de inferência: o resumo não determina causa, diagnóstico ou tratamento.`,
      (metric) => metric.n >= 3 && metric.value !== null && metric.value >= 3,
      [
        "Três crises confirmadas são um limiar operacional para preparar um resumo, não um limiar diagnóstico.",
        "Nenhuma conduta clínica ou alteração de medicação é inferida.",
      ],
    );
    add(
      "headache_duration_median_minutes",
      66,
      "Fechar a duração da próxima crise",
      (metric) =>
        `${metric.missing} de ${metric.n + metric.missing} crise(s) elegível(is) ficaram sem duração completa. No próximo registro, anote início e fim quando souber. Limite de inferência: esta ação melhora o dado e não interpreta gravidade ou tratamento.`,
      (metric) => metric.n + metric.missing >= 3 && metric.missing >= 2,
      [
        "A sugestão responde somente à incompletude de duração.",
        "Duração ausente permanece desconhecida e não é tratada como zero.",
      ],
    );
  }

  if (summary.domain === "bruxismo") add(
    "bruxism_days",
    71,
    "Montar um recorte manhã × noite",
    (metric) =>
      `${metric.value} dia(s) com sinais foram confirmados entre ${metric.n} dias conhecidos; ${metric.missing} dia(s) seguem desconhecidos. Use o próximo check-in para completar um par manhã/noite e comparar o contexto. Limite de inferência: sinais autorreferidos não estabelecem bruxismo, DTM ou causa.`,
    (metric) => metric.n >= 7 && metric.value !== null && metric.value >= 3,
    [
      "Sete dias conhecidos e três dias com sinais são um gatilho de organização do diário, não um critério diagnóstico.",
      "A comparação manhã/noite permanece descritiva e não atribui causa.",
    ],
  );

  if (summary.domain === "rotina") add(
    "deferred_tasks",
    76,
    "Converter um adiamento em próximo gesto",
    (metric) =>
      `${metric.value} de ${metric.n} tarefa(s) com estado conhecido foram adiadas; ${metric.missing} estado(s) seguem faltantes. Escolha uma delas e escreva somente o próximo gesto executável. Limite de inferência: adiamento é um estado de planejamento, não uma avaliação de disciplina ou saúde.`,
    (metric) => metric.n >= 5 && metric.value !== null && metric.value >= 2,
    [
      "Cinco tarefas conhecidas e dois adiamentos são um gatilho operacional de replanejamento.",
      "O padrão não infere capacidade, diagnóstico ou falha pessoal.",
    ],
  );

  if (summary.domain === "ia") {
    add(
      "renewals_7d",
      84,
      "Revisar a renovação mais próxima",
      (metric) =>
        `${metric.value} renovação(ões) datada(s) entra(m) nos próximos sete dias entre ${metric.n} data(s) válida(s); ${metric.missing} data(s) seguem faltantes. Confirme manter, pausar ou revisar antes do vencimento. Limite de inferência: nenhuma assinatura é cancelada ou julgada automaticamente.`,
      (metric) => metric.n >= 1 && metric.value !== null && metric.value > 0,
      [
        "Uma data de renovação válida é evidência suficiente apenas para um lembrete operacional.",
        "O sistema não infere valor, utilidade ou decisão de cancelamento.",
      ],
    );
    add(
      "tools_with_confirmed_no_use",
      64,
      "Revisar uma ferramenta sem uso confirmado",
      (metric) =>
        `${metric.value} de ${metric.n} ferramenta(s) com uso conhecido tiveram zero uso explícito; ${metric.missing} seguem sem dado. Decida se quer testar, manter ou pausar, sem ação automática. Limite de inferência: zero uso não mede qualidade nem valor futuro.`,
      (metric) => metric.n >= 3 && metric.value !== null && metric.value >= 1,
      [
        "Zero uso é aceito somente quando explicitamente registrado; desconhecido nunca é convertido em zero.",
        "Uso passado não determina valor futuro nem recomenda cancelamento.",
      ],
    );
  }
  return candidates;
}

function emptyDomainMetrics(
  domain: AnalyticsDomain,
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
): DomainAnalyticsSummary {
  return makeDomainSummary(domain, entities, window, [
    makeMetric({
      key: "recorded_events",
      label: "Registros na janela",
      value: entities.length,
      unit: "count",
      n: entities.length,
      description: "Eventos ativos explicitamente registrados neste domínio.",
    }),
  ]);
}

/** Summarize one domain from an already selected analytics window. */
export function summarizeDomain(
  domain: AnalyticsDomain,
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
  allWindowEntities: readonly MentorEntity[] = entities,
): DomainAnalyticsSummary {
  switch (domain) {
    case "internato": return summarizeInternato(entities, window);
    case "estudos": return summarizeEstudos(entities, window);
    case "medicamentos": return summarizeMedicamentos(entities, window);
    case "sono": return summarizeSono(entities, window);
    case "alimentacao": return summarizeAlimentacao(entities, window);
    case "humor": return summarizeHumor(entities, allWindowEntities, window);
    case "cefaleia": return summarizeCefaleia(entities, window);
    case "bruxismo": return summarizeBruxismo(entities, window);
    case "financas": return summarizeFinancas(entities, window);
    case "rotina": return summarizeRotina(entities, window);
    case "agenda": return summarizeAgenda(entities, window);
    case "ia": return summarizeIA(entities, window);
    case "conhecimento": return summarizeConhecimento(entities, window);
    case "exames": {
      const panels = entities.map((entity) => entity.payload).filter(isLaboratoryPanelPayload);
      const results = panels.flatMap((panel) => panel.results);
      const numeric = results.filter((result) => result.value.state === "known" && result.value.value.kind === "numeric");
      return makeDomainSummary(domain, entities, window, [
        makeMetric({ key: "lab_panels", label: "Painéis laboratoriais guardados", value: panels.length || null, unit: "count", n: panels.length, description: "Coletas explicitamente registradas; um exame solicitado não é um resultado." }),
        makeMetric({ key: "lab_results", label: "Resultados transcritos", value: results.length || null, unit: "count", n: results.length, missing: results.filter((result) => result.value.state !== "known").length, description: "Analitos separados, sem somar valores de exames ou unidades diferentes." }),
        makeMetric({ key: "lab_attachments", label: "Laudos anexados", value: panels.reduce((sum, panel) => sum + panel.attachments.length, 0), unit: "count", n: panels.length, description: "Arquivos locais com tamanho e integridade verificados no backup." }),
        makeMetric({ key: "lab_numeric_with_unit", label: "Valores numéricos com unidade", value: numeric.filter((result) => result.unit.state === "known").length, unit: "count", n: numeric.length, missing: numeric.filter((result) => result.unit.state !== "known").length, description: "A unidade informada é necessária para construir uma comparação. Nenhuma conversão é presumida." }),
      ]);
    }
    default: return emptyDomainMetrics(domain, entities, window);
  }
}

function selectCurrentEntityVersions(
  entities: readonly MentorEntity[],
  datasetId?: string,
): MentorEntity[] {
  const latest = new Map<string, MentorEntity>();
  for (const entity of entities) {
    if (datasetId && entity.datasetId !== datasetId) continue;
    const key = `${entity.datasetId}\u0000${entity.id}`;
    const previous = latest.get(key);
    if (!previous ||
      entity.revision > previous.revision ||
      (entity.revision === previous.revision && entity.updatedAt > previous.updatedAt)) {
      latest.set(key, entity);
    }
  }
  return [...latest.values()]
    .filter((entity) => entity.status === "active")
    .sort((left, right) =>
      left.localDate.localeCompare(right.localDate) ||
      left.occurredAtUTC.localeCompare(right.occurredAtUTC) ||
      left.domain.localeCompare(right.domain) ||
      left.id.localeCompare(right.id),
    );
}

function selectCurrentEntities(
  entities: readonly MentorEntity[],
  window: InclusiveDateWindow,
  datasetId?: string,
): MentorEntity[] {
  return selectCurrentEntityVersions(entities, datasetId).filter((entity) =>
    isWithinInclusiveWindow(entity.localDate, window),
  );
}

function blankDomainCounts(): Record<AnalyticsDomain, number> {
  return Object.fromEntries(ANALYTICS_DOMAINS.map((domain) => [domain, 0])) as Record<
    AnalyticsDomain,
    number
  >;
}

function aggregateActivity(
  entities: readonly MentorEntity[],
  period: "week" | "month",
): ActivityAggregate[] {
  const groups = new Map<string, { start: LocalDate; end: LocalDate; entities: MentorEntity[] }>();
  for (const entity of entities) {
    const start = period === "week" ? weekStart(entity.localDate) : monthStart(entity.localDate);
    const end = period === "week" ? shiftLocalDate(start, 6) : monthEnd(entity.localDate);
    const group = groups.get(start) ?? { start, end, entities: [] };
    group.entities.push(entity);
    groups.set(start, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => {
      const byDomain = blankDomainCounts();
      for (const entity of group.entities) byDomain[entity.domain] += 1;
      return {
        key,
        start: group.start,
        end: group.end,
        n: group.entities.length,
        observedDays: uniqueDays(group.entities),
        byDomain,
      };
    });
}

/**
 * Build all 13 domain summaries. The same input and options always produce the
 * same JSON value; no current clock, random value, network, or AI is consulted.
 */
export function buildAnalyticsReport(
  entities: readonly MentorEntity[],
  options: AnalyticsOptions,
): AnalyticsReport {
  const window = inclusiveDateWindow(options.endLocalDate, options.days ?? 60);
  const selected = selectCurrentEntities(entities, window, options.datasetId);
  const allCurrentEntities = selectCurrentEntityVersions(entities, options.datasetId);
  const currentFinanceEntities = allCurrentEntities.filter(
    (entity) => entity.domain === "financas",
  );
  const currentMedicationEntities = allCurrentEntities.filter(
    (entity) => entity.domain === "medicamentos",
  );
  const domains = Object.fromEntries(
    ANALYTICS_DOMAINS.map((domain) => {
      const domainEntities = selected.filter((entity) => entity.domain === domain);
      return [
        domain,
        domain === "medicamentos"
          ? summarizeMedicamentos(domainEntities, window, currentMedicationEntities)
          : domain === "financas"
          ? summarizeFinancas(domainEntities, window, currentFinanceEntities)
          : summarizeDomain(domain, domainEntities, window, selected),
      ];
    }),
  ) as Record<AnalyticsDomain, DomainAnalyticsSummary>;
  const observedDays = uniqueDays(selected);
  const completeness = mergeCompleteness(
    selected.map((entity) => finalizeCompleteness(scanCompleteness(eventPayload(entity)))),
  );
  const nextActions = ANALYTICS_DOMAINS
    .flatMap((domain) => domainActionCandidates(domains[domain]))
    .sort((left, right) =>
      right.priority - left.priority ||
      ANALYTICS_DOMAINS.indexOf(left.domain) - ANALYTICS_DOMAINS.indexOf(right.domain) ||
      left.id.localeCompare(right.id),
    )
    .slice(0, 3);
  return {
    window,
    n: selected.length,
    observedDays,
    missingDays: Math.max(0, window.days - observedDays),
    completeness,
    domains,
    activity: {
      weekly: aggregateActivity(selected, "week"),
      monthly: aggregateActivity(selected, "month"),
    },
    nextActions,
    interpretationPolicy: "descriptive_only_no_causality",
  };
}

export const calculateAnalytics = buildAnalyticsReport;
