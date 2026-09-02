import { expect, test } from "@playwright/test";
import { buildMetricSeries, formatSignalValue } from "../src/domain/metricSeries";
import { known, unknown, type Domain, type GenericPayload, type MentorEntity } from "../src/domain/model";

const options = { endLocalDate: "2026-09-02", days: 7, datasetId: "series-test" } as const;
function generic(id: string, domain: Domain, payload: GenericPayload, date = "2026-09-02", minute = "00"): MentorEntity<"generic.event"> {
  return { id, domain, type: "generic.event", datasetId: "series-test", localDate: date as MentorEntity["localDate"], occurredAtUTC: `${date}T12:${minute}:00.000Z`, updatedAt: `${date}T12:${minute}:00.000Z`, createdAt: `${date}T12:${minute}:00.000Z`, timezone: "America/Sao_Paulo", schemaVersion: 1, revision: 1, source: "manual", status: "active", payload };
}
const sleepPayload = (awake = known(30)): GenericPayload => ({ schema: "sleep-chronology-v1", eventKind: "sleep-chronology", chronology: { wentToBedLocal: known("23:00"), sleepOnsetLocal: known("23:30"), finalWakeLocal: known("07:00"), leftBedLocal: known("07:15") }, awakeMinutes: awake });
function energy(id: string, value: number, minute = "00"): MentorEntity { return { ...generic(id, "humor", {}, "2026-09-02", minute), type: "humor.energy-check-in", payload: { energy: value as 1, scaleVersion: "energy-1-5-v1", note: unknown() } }; }

test("365 dias sem dados são lacunas, nunca pontos zero", () => {
  const result = buildMetricSeries([], "sleep-duration", { ...options, days: 365 });
  expect(result.points).toHaveLength(365); expect(result.points.every((point) => point.value === null && point.state === "unrecorded")).toBe(true);
  expect(result.summary).toMatchObject({ knownDays: 0, unrecordedDays: 365, central: null, minimum: null, maximum: null });
});
test("sono usa a mesma fórmula do relatório e exige vigília conhecida", () => {
  const entry = generic("sleep", "sono", sleepPayload());
  expect(buildMetricSeries([entry], "sleep-duration", options).points.at(-1)?.value).toBe(420);
  expect(buildMetricSeries([entry], "time-in-bed", options).points.at(-1)?.value).toBe(495);
  expect(buildMetricSeries([entry], "sleep-latency", options).points.at(-1)?.value).toBe(30);
  expect(buildMetricSeries([entry], "sleep-efficiency", options).points.at(-1)?.value).toBe(84.85);
  entry.payload = sleepPayload(unknown());
  expect(buildMetricSeries([entry], "sleep-duration", options).points.at(-1)).toMatchObject({ value: null, state: "unknown" });
});
test("registro de sono mais recente incompleto não ressuscita valor anterior", () => {
  const first = generic("a", "sono", sleepPayload(), "2026-09-02", "00"); const latest = generic("b", "sono", sleepPayload(unknown()), "2026-09-02", "10");
  const point = buildMetricSeries([latest, first], "sleep-duration", options).points.at(-1)!;
  expect(point.value).toBeNull(); expect(point.observations.map((item) => item.entityId)).toEqual(["a", "b"]);
});
test("energia não mistura escalas funcionais nem apresenta soma de respostas", () => {
  const functional = generic("functional", "humor", { eventKind: "mood-functional-check-in", scaleVersion: "mentor-functional-scales-v1", energy: known(0) });
  const point = buildMetricSeries([energy("first", 2), energy("last", 4, "10"), functional], "energy", options).points.at(-1)!;
  expect(point.value).toBe(4); expect(point.observations).toHaveLength(2); expect(point.observations.map((item) => item.value)).toEqual([2, 4]);
});
test("estudo soma somente durações válidas e marca dia parcial", () => {
  const rows = [generic("a", "estudos", { eventKind: "study-session", actualDurationMinutes: known(20), minutes: known(90) }), generic("b", "estudos", { eventKind: "study-session", actualDurationMinutes: known(25) }), generic("c", "estudos", { eventKind: "study-session", actualDurationMinutes: unknown(), minutes: known(80) })];
  const result = buildMetricSeries(rows, "study-minutes", options); const point = result.points.at(-1)!;
  expect(point).toMatchObject({ value: 45, partial: true }); expect(point.observations).toHaveLength(3);
  expect(result.summary).toMatchObject({ knownDays: 1, partialDays: 1, total: 45 });
});
test("duração zero explicitamente registrada continua zero", () => {
  const row = generic("zero", "estudos", { eventKind: "study-session", actualDurationMinutes: known(0) });
  expect(buildMetricSeries([row], "study-minutes", options).points.at(-1)).toMatchObject({ value: 0, state: "known" });
});
test("hidratação soma incrementos e rejeita acumulado como se fosse incremento", () => {
  const water = (id: string, amount: number, measurement = "increment") => generic(id, "alimentacao", { schema: "nutrition-log-v1", eventKind: "nutrition-log", recordMode: "hydration", hydration: { amountMl: known(amount), measurement } });
  const point = buildMetricSeries([water("a", 250), water("b", 300), water("wrong", 1000, "daily_total")], "hydration", options).points.at(-1)!;
  expect(point.value).toBe(550); expect(point.partial).toBe(true); expect(point.observations.at(-1)?.state).toBe("invalid");
});
test("refeição sem água não simula uma medição de hidratação faltante", () => {
  const meal = generic("meal", "alimentacao", { schema: "nutrition-log-v1", eventKind: "nutrition-log", recordMode: "meal", hydration: { amountMl: unknown(), measurement: "increment" } });
  expect(buildMetricSeries([meal], "hydration", options).points.at(-1)).toMatchObject({ state: "unrecorded", observations: [] });
});
test("hora de chegada mantém sinal e turnos simultâneos no detalhe", () => {
  const shift = (id: string, arrival: string): MentorEntity => ({ ...generic(id, "internato", {}), type: "internato.shift", payload: { scheduleState: "confirmed_planned", scheduledStartLocal: "2026-09-02T07:00", scheduledEndLocal: "2026-09-02T12:00", assignment: known("Jornada sintética"), location: unknown(), attendance: known("present"), arrivalLocal: known(arrival), departureLocal: unknown(), breakStartLocal: unknown(), breakEndLocal: unknown() } });
  const result = buildMetricSeries([shift("a", "2026-09-02T06:52"), shift("b", "2026-09-02T07:12")], "arrival-offset", options);
  expect(result.points.at(-1)?.value).toBe(12); expect(result.points.at(-1)?.observations.map((item) => item.value)).toEqual([-8, 12]);
  const absent = shift("absent", "2026-09-02T07:50"); (absent.payload as Record<string, unknown>).attendance = known("absent_confirmed");
  expect(buildMetricSeries([absent], "arrival-offset", options).points.at(-1)?.state).toBe("unrecorded");
});
test("revisão excluída vence registro antigo, outro dataset e futuro ficam fora", () => {
  const first = energy("same", 2); const deleted = { ...first, revision: 2, status: "deleted" as const };
  const other = { ...energy("other", 5), datasetId: "other" }; const future = { ...energy("future", 5), localDate: "2026-09-03" as const };
  expect(buildMetricSeries([deleted, first, other, future], "energy", options).summary.knownDays).toBe(0);
});
test("duas observações separadas mantêm o dia intermediário como lacuna", () => {
  const rows = [generic("a", "estudos", { eventKind: "study-session", minutes: known(20) }, "2026-08-31"), generic("b", "estudos", { eventKind: "study-session", minutes: known(30) }, "2026-09-02")];
  const series = buildMetricSeries(rows, "study-minutes", options);
  expect(series.points.slice(-3).map((point) => point.value)).toEqual([20, null, 30]);
  expect(series.summary).toMatchObject({ central: 25, knownDays: 2, minimum: 20, maximum: 30 });
});
test("consulta é determinística, sem alterar fonte ou interpolar vazios", () => {
  const rows = [generic("a", "sono", sleepPayload())]; const before = JSON.stringify(rows);
  expect(buildMetricSeries(rows, "sleep-duration", options)).toEqual(buildMetricSeries(rows, "sleep-duration", options)); expect(JSON.stringify(rows)).toBe(before);
  expect(formatSignalValue("arrival-offset", -8)).toContain("8 min antes"); expect(formatSignalValue("arrival-offset", 12)).toContain("12 min depois"); expect(formatSignalValue("sleep-duration", 420)).toBe("7h");
});
test("estado em array não passa por estado escalar e duração nunca mostra 60 minutos residuais", () => {
  const malformed = generic("bad-state", "alimentacao", { schema: "nutrition-log-v1", eventKind: "nutrition-log", recordMode: "hydration", hydration: { amountMl: { state: ["unknown"] }, measurement: "increment" } });
  expect(buildMetricSeries([malformed], "hydration", options).points.at(-1)?.state).toBe("invalid");
  expect(formatSignalValue("sleep-duration", 719.99)).toBe("12h");
});
test("procedência acompanha o campo escolhido, não o alias descartado", () => {
  const check = (actual: unknown, legacy: unknown) => buildMetricSeries([generic("origin", "estudos", { eventKind: "study-session", actualDurationMinutes: actual, minutes: legacy })], "study-minutes", options).points.at(-1)!.observations[0];
  expect(check(known(20), known(90, "derived"))).toMatchObject({ value: 20, derived: false });
  expect(check(known(20, "derived"), known(90))).toMatchObject({ value: 20, derived: true });
  const legacy = generic("clock", "estudos", { eventKind: "study-session", minutes: unknown(), startedAtLocal: known("23:30"), endedAtLocal: known("00:15") });
  expect(buildMetricSeries([legacy], "study-minutes", options).points.at(-1)!.observations[0]).toMatchObject({ value: 45, derived: true });
  const explicitSleep = generic("explicit-sleep", "sono", { ...sleepPayload(), totalSleepMinutes: known(400) });
  expect(buildMetricSeries([explicitSleep], "sleep-duration", options).points.at(-1)!.observations[0]).toMatchObject({ value: 400, derived: false });
});
test("exclusões explícitas ficam separadas de pendências e não criam parcialidade", () => {
  const na = generic("na", "estudos", { eventKind: "study-session", actualDurationMinutes: { state: "not_applicable", reasonCode: "test" } });
  const absent = generic("absent", "estudos", { eventKind: "study-session", actualDurationMinutes: { state: "confirmed_absent" } });
  const value = generic("value", "estudos", { eventKind: "study-session", actualDurationMinutes: known(20) });
  const unknownRow = generic("unknown", "estudos", { eventKind: "study-session", actualDurationMinutes: unknown() });
  const one = buildMetricSeries([na], "study-minutes", options);
  expect(one.points.at(-1)).toMatchObject({ state: "not_applicable", value: null }); expect(one.summary).toMatchObject({ excludedDays: 1, openDays: 0 });
  expect(buildMetricSeries([absent], "study-minutes", options).points.at(-1)?.state).toBe("confirmed_absent");
  expect(buildMetricSeries([value, na], "study-minutes", options).points.at(-1)).toMatchObject({ value: 20, partial: false });
  expect(buildMetricSeries([value, unknownRow], "study-minutes", options).points.at(-1)).toMatchObject({ value: 20, partial: true });
});
test("chegada inválida não perde seu estado", () => {
  const shift: MentorEntity = { ...generic("bad-arrival", "internato", {}), type: "internato.shift", payload: { scheduleState: "confirmed_planned", scheduledStartLocal: "2026-09-02T07:00", scheduledEndLocal: "2026-09-02T12:00", assignment: unknown(), location: unknown(), attendance: known("present"), arrivalLocal: { state: "invalid", issueCodes: ["test"] }, departureLocal: unknown(), breakStartLocal: unknown(), breakEndLocal: unknown() } };
  expect(buildMetricSeries([shift], "arrival-offset", options).points.at(-1)).toMatchObject({ state: "invalid", value: null });
});
test("revisão malformada é rejeitada antes da eleição, em qualquer ordem", () => {
  const valid = energy("same", 3); const bad = { ...valid, revision: "bad" } as unknown as MentorEntity;
  for (const rows of [[bad, valid], [valid, bad]]) expect(buildMetricSeries(rows, "energy", options).summary).toMatchObject({ knownDays: 1, rejectedRecords: 1 });
});
test("escala canônica de energia aceita somente inteiros de 1 a 5", () => {
  for (const value of [0, 6, 2.5]) expect(buildMetricSeries([energy("bad-energy", value)], "energy", options).points.at(-1)?.state).toBe("invalid");
});
