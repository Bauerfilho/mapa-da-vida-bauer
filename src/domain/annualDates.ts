import { assertLocalDate, calendarDayCount, shiftLocalDate } from "./dates";
import { known, notApplicable, unknown as unknownKnowledge, type GenericPayload, type ISOInstant, type Knowledge, type LocalDate, type MentorEntity } from "./model";

export const ANNUAL_DATE_SCHEMA = "agenda-annual-date-v1";
export type AnnualDateKind = "birthday" | "annual_commitment";
export type NonLeapYearPolicy = "feb28" | "mar01";
export interface AnnualDateInput {
  kind: AnnualDateKind;
  label: string;
  month: number;
  day: number;
  nonLeapYearPolicy?: NonLeapYearPolicy;
  // Vazio é desconhecido; null significa que a pessoa desativou o aviso.
  reminderLeadDays?: number | null;
  recurrenceStatus?: "active" | "paused";
  note?: string;
}
export interface AnnualDatePayload extends GenericPayload {
  schema: typeof ANNUAL_DATE_SCHEMA;
  eventKind: "agenda-annual-date";
  kind: AnnualDateKind;
  label: string;
  month: number;
  day: number;
  recurrence: "yearly";
  nonLeapYearPolicy: Knowledge<NonLeapYearPolicy>;
  reminderLeadDays: Knowledge<number>;
  recurrenceStatus: "active" | "paused";
  note: Knowledge<string>;
}
export interface AnnualOccurrence {
  key: string;
  entityId: string;
  datasetId: string;
  sourceRevision: number;
  updatedAt: ISOInstant;
  year: number;
  kind: AnnualDateKind;
  title: string;
  localDate: LocalDate;
  noticeDate: LocalDate | null;
  reminderState: "scheduled" | "unknown" | "off";
  leapAdjusted: boolean;
  allDay: true;
  blocksTime: false;
}
export interface PendingAnnualDate { entityId: string; title: string; year: number; reason: "leap_policy_required" }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function optionalValue<T>(value: unknown, check: (candidate: unknown) => candidate is T): value is Knowledge<T> {
  if (!record(value)) return false;
  if (value.state === "known") return onlyKeys(value, ["state", "value", "source", "recordedAt"]) && typeof value.source === "string" && ["user", "imported", "derived", "confirmed_schedule"].includes(value.source) && check(value.value) && (value.recordedAt === undefined || typeof value.recordedAt === "string" && Number.isFinite(Date.parse(value.recordedAt)));
  if (value.state === "unknown") return onlyKeys(value, ["state", "reason"]) && typeof value.reason === "string" && ["not_recorded", "not_confirmed", "not_provided", "legacy_ambiguous", "withheld", "conflict"].includes(value.reason);
  return value.state === "not_applicable" && onlyKeys(value, ["state", "reasonCode"]) && typeof value.reasonCode === "string" && value.reasonCode.length > 0 && value.reasonCode.length <= 80;
}
function monthDayValid(month: unknown, day: unknown): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  try { assertLocalDate(`2000-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`); return true; } catch { return false; }
}
export function isAnnualDatePayload(value: unknown): value is AnnualDatePayload {
  if (!record(value) || !onlyKeys(value, ["schema", "eventKind", "kind", "label", "month", "day", "recurrence", "nonLeapYearPolicy", "reminderLeadDays", "recurrenceStatus", "note"])) return false;
  if (value.schema !== ANNUAL_DATE_SCHEMA || value.eventKind !== "agenda-annual-date" || typeof value.kind !== "string" || !["birthday", "annual_commitment"].includes(value.kind) || value.recurrence !== "yearly" || typeof value.recurrenceStatus !== "string" || !["active", "paused"].includes(value.recurrenceStatus)) return false;
  if (typeof value.label !== "string" || !value.label.trim() || value.label.length > 120 || value.label !== value.label.trim() || !monthDayValid(value.month, value.day)) return false;
  if (!optionalValue(value.reminderLeadDays, (item): item is number => typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 365)) return false;
  if (!optionalValue(value.note, (item): item is string => typeof item === "string" && item.length <= 1000)) return false;
  if (!optionalValue(value.nonLeapYearPolicy, (item): item is NonLeapYearPolicy => item === "feb28" || item === "mar01")) return false;
  return value.month === 2 && value.day === 29 ? value.nonLeapYearPolicy.state !== "not_applicable" : value.nonLeapYearPolicy.state === "not_applicable";
}
export function createAnnualDate(input: AnnualDateInput): AnnualDatePayload {
  const label = input.label.trim(); const note = input.note?.trim();
  const payload: AnnualDatePayload = {
    schema: ANNUAL_DATE_SCHEMA, eventKind: "agenda-annual-date", kind: input.kind,
    label, month: input.month, day: input.day, recurrence: "yearly",
    nonLeapYearPolicy: input.month === 2 && input.day === 29 ? input.nonLeapYearPolicy === undefined ? unknownKnowledge("not_provided") : known(input.nonLeapYearPolicy) : notApplicable("not_february_29"),
    reminderLeadDays: input.reminderLeadDays === undefined ? unknownKnowledge("not_provided") : input.reminderLeadDays === null ? notApplicable("reminder_disabled") : known(input.reminderLeadDays),
    recurrenceStatus: input.recurrenceStatus ?? "active", note: note ? known(note) : unknownKnowledge("not_provided"),
  };
  if (!isAnnualDatePayload(payload)) throw new Error("Confira o nome, dia e mês válidos e a antecedência de 0 a 365 dias.");
  return payload;
}
export function isAnnualDateEntity(entity: MentorEntity): entity is MentorEntity<"generic.event"> & { payload: AnnualDatePayload } {
  return entity.type === "generic.event" && entity.domain === "agenda" && isAnnualDatePayload(entity.payload);
}

// A revisão mais nova é escolhida ANTES do filtro: pausa ou exclusão não ressuscitam o passado.
export function annualDateDefinitions(entities: readonly MentorEntity[]): Array<MentorEntity<"generic.event"> & { payload: AnnualDatePayload }> {
  const latest = new Map<string, MentorEntity>();
  for (const entity of entities) { const key = JSON.stringify([entity.datasetId, entity.id]); const previous = latest.get(key); if (!previous || entity.revision > previous.revision || entity.revision === previous.revision && entity.updatedAt > previous.updatedAt) latest.set(key, entity); }
  return [...latest.values()].filter((entity): entity is MentorEntity<"generic.event"> & { payload: AnnualDatePayload } => entity.status === "active" && isAnnualDateEntity(entity)).sort((a, b) => a.payload.label.localeCompare(b.payload.label, "pt-BR") || a.id.localeCompare(b.id));
}
function isLeapYear(year: number): boolean { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }

// Recorrência é projeção de leitura: não grava um novo evento nem ocupa um horário da agenda.
export function projectAnnualDates(entities: readonly MentorEntity[], start: LocalDate, end: LocalDate): { occurrences: AnnualOccurrence[]; pending: PendingAnnualDate[] } {
  assertLocalDate(start); assertLocalDate(end);
  const days = calendarDayCount(start, end);
  if (days < 1 || days > 1096) throw new Error("Projete uma janela válida de até três anos.");
  const occurrences: AnnualOccurrence[] = []; const pending: PendingAnnualDate[] = [];
  for (const entity of annualDateDefinitions(entities)) {
    const payload = entity.payload; if (payload.recurrenceStatus !== "active") continue;
    for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
      const leapAdjusted = payload.month === 2 && payload.day === 29 && !isLeapYear(year);
      if (leapAdjusted && payload.nonLeapYearPolicy.state !== "known") {
        if (start <= `${year}-03-01` && end >= `${year}-02-28`) pending.push({ entityId: entity.id, title: payload.label, year, reason: "leap_policy_required" });
        continue;
      }
      const monthDay = leapAdjusted ? payload.nonLeapYearPolicy.state === "known" && payload.nonLeapYearPolicy.value === "feb28" ? "02-28" : "03-01" : `${String(payload.month).padStart(2, "0")}-${String(payload.day).padStart(2, "0")}`;
      const localDate = `${year}-${monthDay}` as LocalDate;
      if (localDate < start || localDate > end) continue;
      const noticeDate = payload.reminderLeadDays.state === "known" ? shiftLocalDate(localDate, -payload.reminderLeadDays.value) : null;
      occurrences.push({ key: JSON.stringify([entity.datasetId, entity.id, year]), entityId: entity.id, datasetId: entity.datasetId, sourceRevision: entity.revision, updatedAt: entity.updatedAt, year, kind: payload.kind, title: payload.label, localDate, noticeDate, reminderState: noticeDate ? "scheduled" : payload.reminderLeadDays.state === "not_applicable" ? "off" : "unknown", leapAdjusted, allDay: true, blocksTime: false });
    }
  }
  occurrences.sort((a, b) => a.localDate.localeCompare(b.localDate) || a.title.localeCompare(b.title, "pt-BR") || a.key.localeCompare(b.key));
  return { occurrences, pending };
}
export function annualDateAlerts(entities: readonly MentorEntity[], today: LocalDate): AnnualOccurrence[] {
  return projectAnnualDates(entities, today, shiftLocalDate(today, 365)).occurrences.filter((item) => item.noticeDate !== null && item.noticeDate <= today);
}
