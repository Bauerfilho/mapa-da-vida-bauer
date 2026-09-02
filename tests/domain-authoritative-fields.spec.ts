import { expect, test } from "@playwright/test";
import { buildAnalyticsReport } from "../src/domain/analytics";
import { known, unknown, confirmedAbsent, notApplicable, type Domain, type GenericPayload, type MentorEntity } from "../src/domain/model";

function entry(domain: Domain, payload: GenericPayload): MentorEntity<"generic.event"> {
  return { id: "truth-test", datasetId: "truth-dataset", type: "generic.event", domain, localDate: "2026-09-02", occurredAtUTC: "2026-09-02T12:00:00.000Z", timezone: "America/Sao_Paulo", schemaVersion: 1, revision: 1, source: "manual", status: "active", createdAt: "2026-09-02T12:00:00.000Z", updatedAt: "2026-09-02T12:00:00.000Z", payload };
}
function metric(domain: Domain, payload: GenericPayload, key: string) {
  const found = buildAnalyticsReport([entry(domain, payload)], { endLocalDate: "2026-09-02", days: 60, datasetId: "truth-dataset" }).domains[domain].metrics.find((item) => item.key === key);
  if (!found) throw new Error(`Métrica não encontrada: ${key}`); return found;
}
function sleep(): GenericPayload { return { schema: "sleep-chronology-v1", eventKind: "sleep-chronology", chronology: { wentToBedLocal: known("23:00"), sleepOnsetLocal: known("23:30"), finalWakeLocal: known("07:00"), leftBedLocal: known("07:15") }, awakeMinutes: known(30), perceivedQuality: known(4) }; }

test("duração canônica de estudo vence alias contraditório, inclusive zero", () => {
  for (const value of [20, 0]) expect(metric("estudos", { eventKind: "study-session", actualDurationMinutes: known(value), minutes: known(99) }, "focused_minutes")).toMatchObject({ value, n: 1 });
});
for (const [name, state] of [["desconhecido", unknown()], ["inválido", { state: "invalid", issueCodes: ["test"] }], ["ausente", confirmedAbsent()], ["não aplicável", notApplicable("test")], ["nulo", null]] as const) {
  test(`campo canônico ${name} não é preenchido por alias ou relógio`, () => {
    expect(metric("estudos", { eventKind: "study-session", actualDurationMinutes: state, minutes: known(99), startedAtLocal: known("23:30"), endedAtLocal: known("00:15") }, "focused_minutes")).toMatchObject({ value: null, n: 0 });
  });
}
test("placeholder de minutos legado preserva derivação já contratada", () => {
  expect(metric("estudos", { eventKind: "study-session", minutes: unknown("not_recorded"), startedAtLocal: known("23:30"), endedAtLocal: known("00:15") }, "focused_minutes")).toMatchObject({ value: 45, n: 1 });
  expect(metric("estudos", { eventKind: "study-session", minutes: { state: "invalid", issueCodes: ["test"] }, startedAtLocal: known("23:30"), endedAtLocal: known("00:15") }, "focused_minutes")).toMatchObject({ value: null, n: 0 });
});
test("par canônico de questões vence aliases e não é completado por eles", () => {
  const payload = { eventKind: "study-session", questions: { attempted: known(10), correct: known(8) }, questionsAnswered: known(100), correctAnswers: known(20) };
  expect(metric("estudos", payload, "question_accuracy_percent")).toMatchObject({ value: 80, n: 10 });
  expect(metric("estudos", { ...payload, questions: { attempted: unknown(), correct: unknown() } }, "question_accuracy_percent")).toMatchObject({ value: null, n: 0 });
});
test("cronologia de sono canônica vence horários antigos e mantém a fórmula", () => {
  const payload = { ...sleep(), sleepStartLocal: known("01:00"), sleepEndLocal: known("04:00") };
  expect(metric("sono", payload, "sleep_period_average_minutes")).toMatchObject({ value: 450, n: 1 });
  expect(metric("sono", payload, "sleep_duration_average_minutes")).toMatchObject({ value: 420, n: 1 });
  expect(metric("sono", payload, "time_in_bed_average_minutes")).toMatchObject({ value: 495, n: 1 });
  expect(metric("sono", payload, "sleep_efficiency_average_percent")).toMatchObject({ value: 84.85, n: 1 });
});
for (const value of [known(1500), unknown(), { state: "invalid", issueCodes: ["test"] }]) {
  test(`total explícito ${JSON.stringify(value)} não é reparado pela cronologia`, () => expect(metric("sono", { ...sleep(), totalSleepMinutes: value }, "sleep_duration_average_minutes")).toMatchObject({ value: null, n: 0 }));
}
for (const value of [known(101), unknown(), { state: "invalid", issueCodes: ["test"] }]) {
  test(`eficiência explícita ${JSON.stringify(value)} não é recalculada`, () => expect(metric("sono", { ...sleep(), sleepEfficiencyPercent: value }, "sleep_efficiency_average_percent")).toMatchObject({ value: null, n: 0 }));
}
test("sono novo deriva componentes ausentes e sono legado mantém o período", () => {
  expect(metric("sono", sleep(), "sleep_duration_average_minutes")).toMatchObject({ value: 420, n: 1 });
  expect(metric("sono", { eventKind: "sleep-episode", sleepStartLocal: known("23:00"), sleepEndLocal: known("07:00") }, "sleep_duration_average_minutes")).toMatchObject({ value: 480, n: 1 });
});
test("vigília desconhecida não vira zero nem é restaurada por alias", () => {
  expect(metric("sono", { ...sleep(), awakeMinutes: unknown(), wakeAfterSleepOnsetMinutes: known(0) }, "sleep_duration_average_minutes")).toMatchObject({ value: null, n: 0 });
  expect(metric("sono", { eventKind: "sleep-episode", sleepStartLocal: known("23:00"), sleepEndLocal: known("07:00"), wakeAfterSleepOnsetMinutes: known(20) }, "sleep_duration_average_minutes")).toMatchObject({ value: 460, n: 1 });
});
test("planejamento e qualidade inválidos não são substituídos por aliases", () => {
  expect(metric("estudos", { eventKind: "study-session", plannedDurationMinutes: unknown(), plannedMinutes: known(60) }, "planned_minutes")).toMatchObject({ value: null, n: 0 });
  expect(metric("sono", { ...sleep(), perceivedQuality: { state: "invalid", issueCodes: ["test"] }, quality: "excellent" }, "sleep_quality_average")).toMatchObject({ value: null, n: 0 });
});
