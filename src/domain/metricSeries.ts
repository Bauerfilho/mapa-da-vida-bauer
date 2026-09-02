import { assertLocalDate, inclusiveDateWindow, shiftLocalDate } from "./dates";
import { deriveSleepFacts, readStudyDuration, signedDateTimeDeltaMinutes } from "./analytics";
import { APP_TIME_ZONE, type Domain, type InclusiveDateWindow, type LocalDate, type MentorEntity } from "./model";

export type MetricSignalId = "sleep-duration" | "time-in-bed" | "sleep-latency" | "sleep-awake" | "sleep-efficiency" | "energy" | "study-minutes" | "arrival-offset" | "hydration";
type ValueState = "known" | "unknown" | "invalid" | "not_applicable" | "confirmed_absent";
export interface SignalDefinition { id: MetricSignalId; domain: Domain; title: string; group: string; unit: "duration" | "minutes" | "percent" | "energy" | "offset" | "milliliters"; aggregation: "latest" | "sum" | "maximum"; central: "average" | "median"; explanation: string; }
export const METRIC_SIGNALS: readonly SignalDefinition[] = [
  { id: "sleep-duration", domain: "sono", title: "Sono estimado", group: "Sono", unit: "duration", aggregation: "latest", central: "average", explanation: "Período entre adormecer e acordar, menos os minutos acordado informados. Sem esse dado, a duração permanece em aberto." },
  { id: "time-in-bed", domain: "sono", title: "Tempo na cama", group: "Sono", unit: "duration", aggregation: "latest", central: "average", explanation: "Intervalo entre ir para a cama e levantar. Tempo na cama não é o mesmo que tempo dormindo." },
  { id: "sleep-latency", domain: "sono", title: "Deitar até dormir", group: "Sono", unit: "minutes", aggregation: "latest", central: "average", explanation: "Intervalo informado entre deitar e adormecer; inclui eventual tempo acordado antes de tentar dormir." },
  { id: "sleep-awake", domain: "sono", title: "Acordado durante a noite", group: "Sono", unit: "minutes", aggregation: "latest", central: "average", explanation: "Minutos acordado lembrados e registrados. Não responder nunca equivale a zero minutos." },
  { id: "sleep-efficiency", domain: "sono", title: "Proporção de sono na cama", group: "Sono", unit: "percent", aggregation: "latest", central: "average", explanation: "Sono estimado dividido pelo tempo na cama. Exige os componentes completos; não avalia diagnóstico nem eficácia de medicamentos." },
  { id: "energy", domain: "humor", title: "Energia do check-in", group: "Energia", unit: "energy", aggregation: "latest", central: "median", explanation: "Somente a escala de 1 a 5 do check-in rápido. A escala funcional de humor é outra medida e não é misturada aqui." },
  { id: "study-minutes", domain: "estudos", title: "Tempo estudado", group: "Estudos", unit: "duration", aggregation: "sum", central: "average", explanation: "Soma das durações realizadas registradas. Sessões sem duração não são preenchidas com o tempo planejado." },
  { id: "arrival-offset", domain: "internato", title: "Horário de chegada", group: "Internato", unit: "offset", aggregation: "maximum", central: "median", explanation: "Chegada real menos início da escala confirmada. Negativo é antes; positivo é depois. Havendo mais de uma jornada, o gráfico usa o maior desvio e mostra todas no detalhe." },
  { id: "hydration", domain: "alimentacao", title: "Água registrada", group: "Alimentação", unit: "milliliters", aggregation: "sum", central: "average", explanation: "Soma de incrementos explícitos em mililitros. É a quantidade registrada, não uma estimativa de tudo que foi ingerido." },
];
export interface SignalObservation { entityId: string; revision: number; value: number | null; state: ValueState; occurredAtUTC: string; title: string; derived: boolean; }
export interface SignalPoint { localDate: LocalDate; value: number | null; state: ValueState | "unrecorded"; partial: boolean; observations: SignalObservation[]; }
export interface MetricSeries { signal: SignalDefinition; window: InclusiveDateWindow; points: SignalPoint[]; summary: { knownDays: number; recordedDays: number; unrecordedDays: number; openDays: number; excludedDays: number; partialDays: number; observations: number; central: number | null; minimum: number | null; maximum: number | null; total: number | null; last: SignalPoint | null; rejectedRecords: number; }; }
type Reading = { state: ValueState; value?: number };
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function rawValue(value: unknown): unknown { return object(value) && value.state === "known" ? value.value : value; }
function textValue(value: unknown): string | null { const raw = rawValue(value); return typeof raw === "string" && raw.trim() ? raw.trim() : null; }
function textReading(value: unknown): { state: ValueState; value?: string } {
  if (value == null) return { state: "unknown" };
  if (object(value) && value.state !== "known") return typeof value.state === "string" && ["unknown", "invalid", "not_applicable", "confirmed_absent"].includes(value.state) ? { state: value.state as ValueState } : { state: "invalid" };
  const raw = rawValue(value); return typeof raw === "string" && raw.trim() ? { state: "known", value: raw.trim() } : { state: "invalid" };
}
function numberReading(value: unknown, minimum: number, maximum: number): Reading {
  if (value == null) return { state: "unknown" };
  if (object(value) && value.state !== "known") return typeof value.state === "string" && ["unknown", "invalid", "not_applicable", "confirmed_absent"].includes(value.state) ? { state: value.state as ValueState } : { state: "invalid" };
  const raw = rawValue(value);
  return typeof raw === "number" && Number.isFinite(raw) && raw >= minimum && raw <= maximum ? { state: "known", value: raw } : { state: "invalid" };
}
function eligibleReading(entity: MentorEntity, signal: SignalDefinition): { reading: Reading; title: string; derived: boolean } | null {
  if (entity.domain !== signal.domain) return null;
  const payload = entity.payload as Record<string, unknown>; const kind = textValue(payload.eventKind);
  if (signal.domain === "sono") {
    if (entity.type !== "generic.event" || payload.schema !== "sleep-chronology-v1") return null;
    const facts = deriveSleepFacts(payload);
    const factKey = signal.id === "sleep-duration" ? "totalSleepMinutes" : signal.id === "time-in-bed" ? "timeInBedMinutes" : signal.id === "sleep-latency" ? "latencyMinutes" : signal.id === "sleep-awake" ? "awakeMinutes" : "efficiencyPercent";
    return { reading: facts[factKey], title: "Relato de sono", derived: facts.derived[factKey] };
  }
  if (signal.id === "energy") {
    if (entity.type !== "humor.energy-check-in" || payload.scaleVersion !== "energy-1-5-v1") return null;
    return { reading: typeof payload.energy === "number" && Number.isInteger(payload.energy) ? numberReading(payload.energy, 1, 5) : { state: "invalid" }, title: "Check-in de energia", derived: false };
  }
  if (signal.id === "study-minutes") {
    if (entity.type !== "generic.event" || !["study-session", "study_session"].includes(kind ?? "")) return null;
    const reading = readStudyDuration(payload);
    return { reading: reading.state === "known" && (reading.value! < 0 || reading.value! > 1440) ? { state: "invalid" } : reading, title: textValue(payload.subject) ?? textValue(payload.topic) ?? "Sessão de estudo", derived: reading.derived };
  }
  if (signal.id === "arrival-offset") {
    if (entity.type !== "internato.shift" || payload.scheduleState !== "confirmed_planned") return null;
    const attendance = textValue(payload.attendance);
    if (["absent_confirmed", "cancelled", "swapped", "excused"].includes(attendance ?? "") || object(payload.attendance) && payload.attendance.state === "confirmed_absent") return null;
    const arrival = textReading(payload.arrivalLocal); const scheduled = textReading(payload.scheduledStartLocal);
    const title = textValue(payload.assignment) ?? "Jornada de internato";
    if (arrival.state === "invalid" || scheduled.state === "invalid") return { reading: { state: "invalid" }, title, derived: false };
    if (arrival.state !== "known") return { reading: { state: arrival.state }, title, derived: false };
    if (scheduled.state !== "known") return { reading: { state: scheduled.state }, title, derived: false };
    const delta = signedDateTimeDeltaMinutes(arrival.value!, scheduled.value!);
    return { reading: delta === null ? { state: "invalid" } : { state: "known", value: delta }, title, derived: delta !== null };
  }
  if (signal.id === "hydration") {
    if (entity.type !== "generic.event" || payload.schema !== "nutrition-log-v1" || !object(payload.hydration)) return null;
    const hydration = payload.hydration;
    const reading = hydration.measurement !== "increment" ? { state: "invalid" as const } : numberReading(hydration.amountMl, 0, 20_000);
    // Campo vazio de uma refeição não é uma tentativa de medir água. Zero explícito, sim.
    if (payload.recordMode !== "hydration" && reading.state === "unknown") return null;
    return { reading, title: payload.recordMode === "meal" ? "Água junto à refeição" : "Registro de água", derived: false };
  }
  return null;
}
function round(value: number): number { return Math.round(value * 100) / 100; }
function centralValue(values: number[], kind: SignalDefinition["central"]): number | null {
  if (!values.length) return null;
  if (kind === "average") return round(values.reduce((sum, item) => sum + item, 0) / values.length);
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

// Projeção pura: preserva fonte, revisões, zeros e lacunas. Nenhum registro é gravado ou interpolado.
export function buildMetricSeries(entities: readonly MentorEntity[], signalId: MetricSignalId, options: { endLocalDate: LocalDate; days: number; datasetId: string }): MetricSeries {
  const window = inclusiveDateWindow(options.endLocalDate, options.days);
  const signal = METRIC_SIGNALS.find((item) => item.id === signalId); if (!signal) throw new Error("Sinal de métrica desconhecido.");
  const latest = new Map<string, MentorEntity>(); let rejectedRecords = 0;
  for (const entity of entities) {
    if (entity.datasetId !== options.datasetId) continue;
    if (!Number.isSafeInteger(entity.revision) || entity.revision < 1) { if (entity.domain === signal.domain) rejectedRecords++; continue; }
    const key = JSON.stringify([entity.datasetId, entity.id]); const previous = latest.get(key);
    if (!previous || entity.revision > previous.revision || entity.revision === previous.revision && entity.updatedAt > previous.updatedAt) latest.set(key, entity);
  }
  const byDay = new Map<LocalDate, SignalObservation[]>();
  for (const entity of latest.values()) {
    if (entity.status !== "active" || entity.domain !== signal.domain) continue;
    try { assertLocalDate(entity.localDate); } catch { rejectedRecords++; continue; }
    if (entity.localDate < window.start || entity.localDate > window.end) continue;
    const extracted = eligibleReading(entity, signal); if (!extracted) continue;
    if (!Number.isSafeInteger(entity.revision) || entity.revision < 1 || !Number.isFinite(Date.parse(entity.occurredAtUTC))) { rejectedRecords++; continue; }
    const observations = byDay.get(entity.localDate) ?? [];
    observations.push({ entityId: entity.id, revision: entity.revision, value: extracted.reading.state === "known" ? extracted.reading.value! : null, state: extracted.reading.state, occurredAtUTC: entity.occurredAtUTC, title: extracted.title, derived: extracted.derived });
    byDay.set(entity.localDate, observations);
  }
  const points: SignalPoint[] = Array.from({ length: window.days }, (_, index) => {
    const localDate = shiftLocalDate(window.start, index);
    const observations = [...(byDay.get(localDate) ?? [])].sort((a, b) => Date.parse(a.occurredAtUTC) - Date.parse(b.occurredAtUTC) || a.entityId.localeCompare(b.entityId));
    if (!observations.length) return { localDate, value: null, state: "unrecorded", partial: false, observations };
    if (signal.aggregation === "latest") { const last = observations.at(-1)!; return { localDate, value: last.value, state: last.state, partial: false, observations }; }
    const values = observations.flatMap((item) => item.state === "known" && item.value !== null ? [item.value] : []);
    if (!values.length) { const state = (["invalid", "unknown", "confirmed_absent", "not_applicable"] as const).find((state) => observations.some((item) => item.state === state)) ?? "unknown"; return { localDate, value: null, state, partial: false, observations }; }
    const value = signal.aggregation === "sum" ? round(values.reduce((sum, item) => sum + item, 0)) : Math.max(...values);
    return { localDate, value, state: "known", partial: observations.some((item) => item.state === "unknown" || item.state === "invalid"), observations };
  });
  const values = points.flatMap((point) => point.value === null ? [] : [point.value]); const recordedDays = points.filter((point) => point.observations.length).length;
  return { signal, window, points, summary: { knownDays: values.length, recordedDays, unrecordedDays: window.days - recordedDays, openDays: points.filter((point) => point.state === "unknown" || point.state === "invalid").length, excludedDays: points.filter((point) => point.state === "not_applicable" || point.state === "confirmed_absent").length, partialDays: points.filter((point) => point.partial).length, observations: points.reduce((sum, point) => sum + point.observations.length, 0), central: centralValue(values, signal.central), minimum: values.length ? Math.min(...values) : null, maximum: values.length ? Math.max(...values) : null, total: values.length && signal.aggregation === "sum" ? round(values.reduce((sum, item) => sum + item, 0)) : null, last: [...points].reverse().find((point) => point.value !== null) ?? null, rejectedRecords } };
}
const numberFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
export function formatSignalValue(signalId: MetricSignalId, value: number | null, compact = false): string {
  if (value === null) return "Sem valor";
  const signal = METRIC_SIGNALS.find((item) => item.id === signalId)!;
  if (signal.unit === "duration") { const rounded = Math.round(value); const hours = Math.floor(rounded / 60); const minutes = rounded % 60; return hours ? `${hours}h${minutes ? String(minutes).padStart(2, "0") : ""}` : `${numberFormatter.format(value)} min`; }
  if (signal.unit === "percent") return `${numberFormatter.format(value)}%`;
  if (signal.unit === "energy") return `${numberFormatter.format(value)}${compact ? "" : "/5"}`;
  if (signal.unit === "milliliters") return value >= 1000 ? `${numberFormatter.format(value / 1000)} L` : `${numberFormatter.format(value)} ml`;
  if (signal.unit === "offset") return value === 0 ? "No horário" : compact ? `${value > 0 ? "+" : ""}${numberFormatter.format(value)}` : `${numberFormatter.format(Math.abs(value))} min ${value < 0 ? "antes" : "depois"}`;
  return `${numberFormatter.format(value)} min`;
}
export function formatSignalDate(date: LocalDate): string { return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)).replace(/\./g, ""); }
export function observationTime(instant: string): string { return new Intl.DateTimeFormat("pt-BR", { timeZone: APP_TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date(instant)); }
