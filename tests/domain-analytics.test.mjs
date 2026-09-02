import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, "..");
const outputDirectory = mkdtempSync(join(tmpdir(), "mentor-domain-analytics-"));

execFileSync(join(projectRoot, "node_modules", ".bin", "tsc"), [
  "--ignoreConfig",
  "--target", "ES2022",
  "--module", "commonjs",
  "--strict",
  "--skipLibCheck",
  "--outDir", outputDirectory,
  join(projectRoot, "src", "domain", "model.ts"),
  join(projectRoot, "src", "domain", "dates.ts"),
  join(projectRoot, "src", "domain", "analytics.ts"),
], { cwd: projectRoot, stdio: "pipe" });

const require = createRequire(import.meta.url);
const analytics = require(join(outputDirectory, "analytics.js"));

test.after(() => rmSync(outputDirectory, { recursive: true, force: true }));

const known = (value) => ({ state: "known", value, source: "user" });
const unknown = (reason = "not_recorded") => ({ state: "unknown", reason });
const absent = (reasonCode) => reasonCode
  ? { state: "confirmed_absent", reasonCode }
  : { state: "confirmed_absent" };

let sequence = 0;
function entity({
  id = `entity-${++sequence}`,
  domain,
  type = "generic.event",
  localDate = "2026-09-01",
  occurredAtUTC = `${localDate}T12:00:00.000Z`,
  payload = {},
  status = "active",
  revision = 1,
  updatedAt = occurredAtUTC,
}) {
  return {
    id,
    datasetId: "bauer-personal-primary",
    domain,
    type,
    localDate,
    occurredAtUTC,
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision,
    source: "manual",
    status,
    createdAt: occurredAtUTC,
    updatedAt,
    payload,
  };
}

function metric(report, domain, key) {
  const found = report.domains[domain].metrics.find((item) => item.key === key);
  assert.ok(found, `metric ${domain}.${key} should exist`);
  return found;
}

test("time helpers preserve overnight shifts and use signed clock deltas", () => {
  assert.equal(analytics.clockMinutes("23:30"), 1_410);
  assert.equal(analytics.clockMinutes("24:00"), null);
  assert.equal(analytics.durationMinutes("23:00", "07:00"), 480);
  assert.equal(
    analytics.shiftDurationMinutes("2026-09-03T19:00:00", "2026-09-04T07:00:00"),
    720,
  );
  assert.equal(
    analytics.nightOverlapMinutes("2026-09-03T19:00:00", "2026-09-04T07:00:00"),
    420,
  );
  assert.equal(analytics.clockDeltaMinutes("00:10", "23:50"), 20);
  assert.equal(analytics.clockDeltaMinutes("23:50", "00:10"), -20);
  assert.equal(
    analytics.signedDateTimeDeltaMinutes("2026-09-01T06:50:00", "2026-09-01T07:00:00"),
    -10,
  );
});

test("BRL helpers keep integer cent amounts", () => {
  assert.equal(analytics.parseBRLToMinor("R$ 1.234,56"), 123_456);
  assert.equal(analytics.parseBRLToMinor("-12,05"), -1_205);
  assert.equal(analytics.parseBRLToMinor("1.234"), 123_400);
  assert.equal(analytics.parseBRLToMinor("invalid"), null);
  assert.equal(
    analytics.moneyToMinor({ amountMinor: 4_099, currency: "BRL" }),
    4_099,
  );
  assert.equal(analytics.moneyToMinor({ amountMinor: 4_099, currency: "USD" }), null);
  assert.equal(analytics.sumBRLMinor([12_345, -345, 500]), 12_500);
  assert.match(analytics.formatBRLMinor(123_456), /1\.234,56/);
});

test("weekly and monthly numeric aggregates use civil calendar boundaries", () => {
  const values = [
    { localDate: "2026-08-31", value: 10 },
    { localDate: "2026-09-06", value: 20 },
    { localDate: "2026-09-07", value: 30 },
  ];
  assert.deepEqual(analytics.aggregateByWeek(values), [
    {
      key: "2026-08-31",
      start: "2026-08-31",
      end: "2026-09-06",
      n: 2,
      sum: 30,
      average: 15,
      minimum: 10,
      maximum: 20,
    },
    {
      key: "2026-09-07",
      start: "2026-09-07",
      end: "2026-09-13",
      n: 1,
      sum: 30,
      average: 30,
      minimum: 30,
      maximum: 30,
    },
  ]);
  assert.deepEqual(analytics.aggregateByMonth(values).map(({ key, n, sum }) => ({ key, n, sum })), [
    { key: "2026-08-01", n: 1, sum: 10 },
    { key: "2026-09-01", n: 2, sum: 50 },
  ]);
});

test("full report covers 13 domains and never converts missing data to absence", () => {
  sequence = 0;
  const input = [
    entity({
      id: "shift-complete",
      domain: "internato",
      type: "internato.shift",
      payload: {
        scheduleState: "confirmed_planned",
        scheduledStartLocal: "2026-09-01T07:00:00",
        scheduledEndLocal: "2026-09-01T19:00:00",
        attendance: known("present"),
        arrivalLocal: known("2026-09-01T06:50:00"),
        departureLocal: known("2026-09-01T19:00:00"),
        breakStartLocal: known("2026-09-01T12:00:00"),
        breakEndLocal: known("2026-09-01T12:30:00"),
        assignment: unknown("not_confirmed"),
      },
    }),
    entity({
      id: "shift-absent",
      domain: "internato",
      type: "internato.shift",
      localDate: "2026-09-02",
      payload: {
        scheduleState: "confirmed_planned",
        scheduledStartLocal: "2026-09-02T07:00:00",
        scheduledEndLocal: "2026-09-02T13:00:00",
        attendance: known("absent_confirmed"),
        arrivalLocal: absent("attendance_absent"),
        departureLocal: absent("attendance_absent"),
      },
    }),
    entity({
      id: "shift-unclosed",
      domain: "internato",
      type: "internato.shift",
      localDate: "2026-09-03",
      payload: {
        scheduleState: "confirmed_planned",
        scheduledStartLocal: "2026-09-03T19:00:00",
        scheduledEndLocal: "2026-09-04T07:00:00",
        attendance: unknown(),
        arrivalLocal: unknown(),
        departureLocal: unknown(),
      },
    }),
    entity({
      domain: "estudos",
      localDate: "2026-09-04",
      payload: {
        eventKind: "study-session",
        actualDurationMinutes: known(40),
        plannedDurationMinutes: known(30),
        completed: known(true),
        questionsAnswered: known(10),
        correctAnswers: known(8),
      },
    }),
    entity({
      domain: "medicamentos",
      type: "medicamentos.confirmation",
      localDate: "2026-09-04",
      payload: {
        confirmation: "taken_on_time",
        scheduledTimeLocal: known("08:00"),
        actualTimeLocal: known("08:05"),
        medicationName: unknown("not_provided"),
      },
    }),
    entity({
      domain: "medicamentos",
      localDate: "2026-09-05",
      payload: { eventKind: "medication-dose", confirmation: unknown() },
    }),
    entity({
      domain: "sono",
      localDate: "2026-09-05",
      payload: {
        eventKind: "sleep-episode",
        sleepStartLocal: known("23:30"),
        sleepEndLocal: known("06:30"),
        perceivedQuality: known("good"),
      },
    }),
    entity({
      domain: "sono",
      localDate: "2026-09-06",
      payload: {
        eventKind: "sleep-episode",
        sleepStartLocal: known("00:10"),
        sleepEndLocal: unknown(),
        perceivedQuality: unknown(),
      },
    }),
    entity({
      domain: "alimentacao",
      localDate: "2026-09-06",
      payload: { eventKind: "meal", presence: known(false), timeLocal: known("13:00") },
    }),
    entity({
      domain: "humor",
      type: "humor.energy-check-in",
      localDate: "2026-09-06",
      payload: { energy: 4, scaleVersion: "energy-1-5-v1", note: unknown() },
    }),
    entity({
      domain: "humor",
      localDate: "2026-09-07",
      payload: { eventKind: "mood-check-in", mood: 3, energy: 2, anxiety: unknown() },
    }),
    entity({
      domain: "cefaleia",
      localDate: "2026-09-07",
      payload: { eventKind: "headache-check-in", presence: known(true), intensity: known(7), durationMinutes: known(120) },
    }),
    entity({
      domain: "cefaleia",
      localDate: "2026-09-08",
      payload: { eventKind: "headache-check-in", presence: known(false), intensity: { state: "not_applicable", reasonCode: "absent" } },
    }),
    entity({
      domain: "bruxismo",
      localDate: "2026-09-08",
      payload: { eventKind: "bruxism-morning", presence: known(true), jawPainIntensity: known(4), morningSymptoms: known(true) },
    }),
    entity({
      domain: "financas",
      localDate: "2026-09-08",
      payload: { eventKind: "financial-movement", movementKind: known("expense"), amount: known({ amountMinor: 12_345, currency: "BRL" }) },
    }),
    entity({
      domain: "financas",
      localDate: "2026-09-09",
      payload: { eventKind: "financial-movement", movementKind: known("income"), amount: known({ amountMinor: 50_000, currency: "BRL" }) },
    }),
    entity({
      domain: "financas",
      type: "financas.account",
      localDate: "2026-09-09",
      payload: { providerName: "PicPay", balance: unknown("not_provided") },
    }),
    entity({
      domain: "rotina",
      type: "rotina.daily-closure",
      localDate: "2026-09-09",
      payload: { completedAtLocal: "2026-09-09T21:00:00", summary: known("Fechado") },
    }),
    entity({
      domain: "agenda",
      localDate: "2026-09-10",
      payload: { eventKind: "calendar-event", startLocal: known("2026-09-10T09:00:00"), endLocal: known("2026-09-10T10:00:00") },
    }),
    entity({
      domain: "agenda",
      localDate: "2026-09-10",
      payload: { eventKind: "calendar-event", startLocal: known("2026-09-10T09:30:00"), endLocal: known("2026-09-10T11:00:00") },
    }),
    entity({
      domain: "ia",
      localDate: "2026-09-10",
      payload: { eventKind: "ai-tool", toolName: known("Ferramenta A"), monthlyCost: known({ amountMinor: 10_000, currency: "BRL" }), deliveries: known(2) },
    }),
    entity({
      domain: "conhecimento",
      localDate: "2026-09-10",
      payload: { eventKind: "knowledge-note", note: known("Pérola"), reviewDueDate: known("2026-09-09"), reviewed: known(false) },
    }),
    entity({
      id: "superseded-event",
      domain: "rotina",
      localDate: "2026-09-10",
      revision: 1,
      payload: { eventKind: "routine-block", completed: known(true) },
    }),
    entity({
      id: "superseded-event",
      domain: "rotina",
      localDate: "2026-09-10",
      revision: 2,
      status: "deleted",
      updatedAt: "2026-09-11T00:00:00.000Z",
      payload: { eventKind: "routine-block", completed: known(true) },
    }),
  ];

  const report = analytics.buildAnalyticsReport(input, {
    endLocalDate: "2026-09-30",
    days: 30,
    datasetId: "bauer-personal-primary",
  });
  assert.deepEqual(Object.keys(report.domains), analytics.ANALYTICS_DOMAINS);
  assert.equal(report.window.start, "2026-09-01");
  assert.equal(report.window.end, "2026-09-30");
  assert.equal(report.interpretationPolicy, "descriptive_only_no_causality");
  assert.ok(report.completeness.unknown > 0);

  assert.equal(metric(report, "internato", "arrival_delta_median_minutes").value, -10);
  assert.equal(metric(report, "internato", "worked_minutes").value, 700);
  assert.equal(metric(report, "internato", "worked_minutes").missing, 1);
  assert.equal(metric(report, "internato", "attendance_confirmed_percent").confirmedAbsences, 1);

  assert.equal(metric(report, "estudos", "focused_minutes").value, 40);
  assert.equal(metric(report, "estudos", "question_accuracy_percent").value, 80);
  assert.equal(metric(report, "medicamentos", "skipped_confirmed").value, 0);
  assert.equal(metric(report, "medicamentos", "dose_confirmation_percent").missing, 1);
  assert.equal(metric(report, "sono", "sleep_duration_average_minutes").value, 420);
  assert.equal(metric(report, "sono", "sleep_duration_average_minutes").missing, 1);
  assert.equal(metric(report, "alimentacao", "meals_omitted_confirmed").value, 1);
  assert.equal(metric(report, "cefaleia", "headache_days").value, 1);
  assert.equal(metric(report, "cefaleia", "headache_days").confirmedAbsences, 0);
  assert.equal(metric(report, "cefaleia", "headache_days").missing, 29);
  assert.equal(metric(report, "cefaleia", "headache_absence_checkins_confirmed").value, 1);
  assert.equal(
    metric(report, "cefaleia", "headache_absence_checkins_confirmed").confirmedAbsences,
    1,
  );
  assert.equal(metric(report, "financas", "net_flow_minor").value, 37_655);
  assert.equal(metric(report, "financas", "consolidated_balance_minor").value, null);
  assert.equal(metric(report, "agenda", "schedule_conflicts").value, 1);
  assert.equal(metric(report, "ia", "cost_per_delivery_minor").value, 5_000);
  assert.equal(metric(report, "conhecimento", "reviews_due").value, 1);

  assert.equal(report.nextActions.length, 3);
  assert.deepEqual(report.nextActions.map(({ domain }) => domain), [
    "medicamentos",
    "internato",
    "sono",
  ]);
  assert.ok(report.nextActions.every(({ optional, reversible }) => optional && reversible));
  assert.ok(report.domains.humor.metrics.every(({ interpretation }) => interpretation === "descriptive_only"));

  const again = analytics.calculateAnalytics(structuredClone(input), {
    endLocalDate: "2026-09-30",
    days: 30,
    datasetId: "bauer-personal-primary",
  });
  assert.deepEqual(again, report, "same input must yield byte-equivalent data structures");
});

test("missing differs from explicit point absence without inventing a headache-free day", () => {
  const report = analytics.buildAnalyticsReport([
    entity({
      domain: "cefaleia",
      localDate: "2026-09-01",
      payload: { eventKind: "headache-check-in", presence: unknown() },
    }),
    entity({
      domain: "cefaleia",
      localDate: "2026-09-02",
      payload: { eventKind: "headache-check-in", presence: absent("explicit_no_headache") },
    }),
  ], { endLocalDate: "2026-09-07", days: 7 });
  const headacheDays = metric(report, "cefaleia", "headache_days");
  const absenceCheckIns = metric(report, "cefaleia", "headache_absence_checkins_confirmed");
  assert.equal(headacheDays.n, 0);
  assert.equal(headacheDays.confirmedAbsences, 0);
  assert.equal(headacheDays.missing, 7);
  assert.equal(headacheDays.value, null);
  assert.equal(absenceCheckIns.n, 1);
  assert.equal(absenceCheckIns.confirmedAbsences, 1);
  assert.equal(absenceCheckIns.value, 1);
});

test("current mood and sleep payloads preserve their real scales and overnight chronology", () => {
  const report = analytics.buildAnalyticsReport([
    entity({
      domain: "humor",
      localDate: "2026-09-01",
      payload: {
        schema: "mood-functional-check-in-v1",
        eventKind: "mood-functional-check-in",
        scaleVersion: "mentor-functional-scales-v1",
        mood: known(-2),
        energy: known(0),
        anxiety: known(0),
        function: known(0),
      },
    }),
    entity({
      domain: "humor",
      localDate: "2026-09-02",
      payload: {
        schema: "mood-functional-check-in-v1",
        eventKind: "mood-functional-check-in",
        scaleVersion: "mentor-functional-scales-v1",
        mood: known(0),
        energy: known(4),
      },
    }),
    entity({
      domain: "sono",
      localDate: "2026-09-02",
      payload: {
        schema: "sleep-chronology-v1",
        eventKind: "sleep-chronology",
        chronology: {
          wentToBedLocal: known("23:00"),
          sleepOnsetLocal: known("23:30"),
          finalWakeLocal: known("06:30"),
          leftBedLocal: known("06:45"),
        },
        awakeMinutes: known(0),
        perceivedQuality: known(5),
        napMinutes: known(0),
      },
    }),
  ], { endLocalDate: "2026-09-07", days: 7 });

  const moodAverage = metric(report, "humor", "mood_average");
  const energyAverage = metric(report, "humor", "energy_average");
  assert.equal(moodAverage.value, -1);
  assert.equal(moodAverage.n, 2);
  assert.match(moodAverage.label, /−2 a \+2/);
  assert.equal(energyAverage.value, 2);
  assert.equal(energyAverage.n, 2);
  assert.match(energyAverage.label, /0 a 4/);
  assert.equal(metric(report, "sono", "sleep_duration_average_minutes").value, 420);
  assert.equal(metric(report, "sono", "sleep_quality_average").value, 5);
  assert.equal(metric(report, "sono", "sleep_latency_average_minutes").value, 30);
  assert.equal(metric(report, "sono", "nap_minutes").value, 0);
  assert.deepEqual(
    { value: metric(report, "humor", "perceived_sleep_need_responses").value,
      n: metric(report, "humor", "perceived_sleep_need_responses").n,
      missing: metric(report, "humor", "perceived_sleep_need_responses").missing },
    { value: null, n: 0, missing: 2 },
  );
});

test("medication adherence uses every planned slot as its denominator", () => {
  const report = analytics.buildAnalyticsReport([
    entity({
      id: "regimen-planned-slots",
      domain: "medicamentos",
      localDate: "2026-09-01",
      payload: {
        schema: "medication-regimen-v2",
        eventKind: "medication-regimen",
        medicationName: known("Medicamento informado"),
        doseLabel: known("Dose informada"),
        scheduledTimesLocal: known(["08:00", "20:00"]),
        status: "active_confirmed",
        activeFromLocalDate: known("2026-09-01"),
        activeThroughLocalDate: unknown(),
        note: unknown(),
      },
    }),
    entity({
      id: "dose-resolved",
      domain: "medicamentos",
      type: "medicamentos.confirmation",
      localDate: "2026-09-01",
      payload: {
        regimenId: known("regimen-planned-slots"),
        medicationName: known("Medicamento informado"),
        doseLabel: known("Dose informada"),
        scheduledTimeLocal: known("08:00"),
        actualTimeLocal: unknown(),
        confirmation: "taken_time_unknown",
        note: unknown(),
      },
    }),
  ], { endLocalDate: "2026-09-01", days: 1 });

  assert.deepEqual(
    { value: metric(report, "medicamentos", "planned_dose_slots").value,
      n: metric(report, "medicamentos", "planned_dose_slots").n },
    { value: 2, n: 2 },
  );
  assert.deepEqual(
    { value: metric(report, "medicamentos", "dose_confirmations").value,
      n: metric(report, "medicamentos", "dose_confirmations").n,
      missing: metric(report, "medicamentos", "dose_confirmations").missing },
    { value: 1, n: 1, missing: 1 },
  );
  assert.equal(metric(report, "medicamentos", "dose_confirmation_percent").value, 50);
});

test("headache, hydration and meal omission keep absence distinct from missing", () => {
  const report = analytics.buildAnalyticsReport([
    entity({
      domain: "cefaleia",
      localDate: "2026-09-01",
      payload: {
        eventKind: "headache-crisis",
        presence: known(true),
        disabilityMinutes: known(60),
        acuteMedicationUsed: unknown(),
      },
    }),
    entity({
      domain: "cefaleia",
      localDate: "2026-09-02",
      payload: {
        eventKind: "headache-crisis",
        presence: absent("headache_absent_confirmed"),
        observationScope: known("full-day"),
      },
    }),
    entity({
      domain: "alimentacao",
      localDate: "2026-09-01",
      payload: {
        eventKind: "nutrition-log",
        recordMode: "omission",
        meal: { presence: absent("meal_omitted_confirmed") },
      },
    }),
    entity({
      domain: "alimentacao",
      localDate: "2026-09-02",
      payload: {
        eventKind: "nutrition-log",
        recordMode: "hydration",
        hydration: { amountMl: known(250), measurement: "increment" },
      },
    }),
  ], { endLocalDate: "2026-09-02", days: 2 });

  assert.deepEqual(
    { value: metric(report, "cefaleia", "acute_medication_days").value,
      n: metric(report, "cefaleia", "acute_medication_days").n,
      missing: metric(report, "cefaleia", "acute_medication_days").missing },
    { value: null, n: 0, missing: 1 },
  );
  assert.equal(metric(report, "cefaleia", "headache_disability_minutes").value, 60);
  assert.equal(metric(report, "cefaleia", "headache_free_days_confirmed").value, 1);
  assert.equal(metric(report, "alimentacao", "meals_omitted_confirmed").value, 1);
  assert.deepEqual(
    { value: metric(report, "alimentacao", "water_increment_recorded_ml").value,
      n: metric(report, "alimentacao", "water_increment_recorded_ml").n },
    { value: 250, n: 1 },
  );
  assert.equal(metric(report, "alimentacao", "water_legacy_ambiguous_entries").value, null);
});

test("functional mood reports all seven named dimensions without mixing quick energy", () => {
  const report = analytics.buildAnalyticsReport([
    entity({
      domain: "humor",
      localDate: "2026-09-01",
      payload: {
        eventKind: "mood-functional-check-in",
        scaleVersion: "mentor-functional-scales-v1",
        mood: known(-1),
        energy: known(0),
        anxiety: known(1),
        irritability: known(2),
        impulsivity: known(3),
        thoughtSpeed: known(-2),
        function: known(4),
        perceivedSleepNeed: known("more_than_usual"),
        perceivedBaselineChange: known("below_usual"),
        protectiveFactors: known(["Pessoa de confiança", "Ambiente seguro"]),
        protectiveFactorsNote: known("Consulta já combinada"),
        medicationChangeConfirmed: known(true),
        medicationChangeNote: known("Mudança informada pelo usuário"),
        safeNow: known(false),
      },
    }),
    entity({
      domain: "humor",
      type: "humor.energy-check-in",
      localDate: "2026-09-02",
      payload: {
        eventKind: "energy-check-in",
        scaleVersion: "energy-1-5-v1",
        energy: known(5),
      },
    }),
  ], { endLocalDate: "2026-09-02", days: 2 });

  assert.equal(metric(report, "humor", "mood_functional_average_minus2_plus2").value, -1);
  assert.equal(metric(report, "humor", "energy_functional_average_0_4").value, 0);
  assert.equal(metric(report, "humor", "energy_quick_average_1_5").value, 5);
  assert.equal(metric(report, "humor", "anxiety_average").value, 1);
  assert.equal(metric(report, "humor", "irritability_average").value, 2);
  assert.equal(metric(report, "humor", "impulsivity_average").value, 3);
  assert.equal(metric(report, "humor", "thought_speed_average").value, -2);
  assert.equal(metric(report, "humor", "functioning_average").value, 4);
  assert.deepEqual(
    { value: metric(report, "humor", "perceived_sleep_need_responses").value,
      n: metric(report, "humor", "perceived_sleep_need_responses").n,
      missing: metric(report, "humor", "perceived_sleep_need_responses").missing },
    { value: 1, n: 1, missing: 0 },
  );
  assert.equal(metric(report, "humor", "perceived_baseline_change_responses").value, 1);
  assert.equal(metric(report, "humor", "protective_factor_checkins").value, 1);
  assert.equal(metric(report, "humor", "protective_factors_recorded").value, 3);
  assert.equal(metric(report, "humor", "medication_changes_confirmed_by_user").value, 1);
  assert.deepEqual(
    { value: metric(report, "humor", "safe_now_user_reported_no").value,
      n: metric(report, "humor", "safe_now_user_reported_no").n,
      missing: metric(report, "humor", "safe_now_user_reported_no").missing },
    { value: 1, n: 1, missing: 0 },
  );
});

test("mood context readers separate true, false, unknown, invalid and historical v1", () => {
  const report = analytics.buildAnalyticsReport([
    entity({
      domain: "humor",
      localDate: "2026-09-01",
      payload: {
        schema: "mood-functional-check-in-v2",
        eventKind: "mood-functional-check-in",
        perceivedSleepNeed: known("more_than_usual"),
        perceivedBaselineChange: known("above_usual"),
        medicationChangeConfirmed: known(true),
        safeNow: known(true),
      },
    }),
    entity({
      domain: "humor",
      localDate: "2026-09-02",
      payload: {
        schema: "mood-functional-check-in-v2",
        eventKind: "mood-functional-check-in",
        perceivedSleepNeed: known("usual"),
        perceivedBaselineChange: known("usual"),
        medicationChangeConfirmed: known(false),
        safeNow: known(false),
      },
    }),
    entity({
      domain: "humor",
      localDate: "2026-09-03",
      payload: {
        schema: "mood-functional-check-in-v2",
        eventKind: "mood-functional-check-in",
        perceivedSleepNeed: known("unsupported_internal_token"),
        perceivedBaselineChange: known("unsupported_internal_token"),
        medicationChangeConfirmed: unknown(),
        safeNow: unknown(),
      },
    }),
    entity({
      domain: "humor",
      localDate: "2026-09-04",
      payload: {
        schema: "mood-functional-check-in-v1",
        eventKind: "mood-functional-check-in",
      },
    }),
  ], { endLocalDate: "2026-09-04", days: 4 });

  assert.deepEqual(
    { value: metric(report, "humor", "perceived_sleep_need_responses").value,
      n: metric(report, "humor", "perceived_sleep_need_responses").n,
      missing: metric(report, "humor", "perceived_sleep_need_responses").missing },
    { value: 2, n: 2, missing: 2 },
  );
  assert.deepEqual(
    { value: metric(report, "humor", "perceived_baseline_change_responses").value,
      n: metric(report, "humor", "perceived_baseline_change_responses").n,
      missing: metric(report, "humor", "perceived_baseline_change_responses").missing },
    { value: 2, n: 2, missing: 2 },
  );
  assert.deepEqual(
    { value: metric(report, "humor", "medication_changes_confirmed_by_user").value,
      n: metric(report, "humor", "medication_changes_confirmed_by_user").n,
      missing: metric(report, "humor", "medication_changes_confirmed_by_user").missing },
    { value: 1, n: 2, missing: 2 },
  );
  assert.deepEqual(
    { value: metric(report, "humor", "safe_now_user_reported_no").value,
      n: metric(report, "humor", "safe_now_user_reported_no").n,
      missing: metric(report, "humor", "safe_now_user_reported_no").missing },
    { value: 1, n: 2, missing: 2 },
  );
  assert.match(
    metric(report, "humor", "safe_now_user_reported_no").description,
    /sim.*não prova ausência de risco/i,
  );
});

test("current internato, study and medication detail aliases feed metrics without invented stock days", () => {
  const report = analytics.buildAnalyticsReport([
    entity({
      domain: "internato",
      payload: {
        schema: "internship-debrief-v1",
        eventKind: "internship-debrief",
        topicsSeen: known(["CTG/tocografia", "Puerpério"]),
      },
    }),
    entity({
      domain: "estudos",
      localDate: "2026-09-02",
      payload: {
        schema: "study-session-v1",
        eventKind: "study-session",
        minutes: unknown(),
        startedAtLocal: known("23:30"),
        endedAtLocal: known("00:15"),
        questions: { attempted: known(5), correct: known(4) },
      },
    }),
    entity({
      domain: "medicamentos",
      localDate: "2026-09-03",
      payload: {
        schema: "medication-detail-v1",
        eventKind: "medication-stock",
        recordMode: "stock",
        medicationName: known("Medicamento informado"),
        stock: {
          quantity: known(12),
          unit: known("comprimidos"),
          refillAt: known(5),
        },
      },
    }),
  ], { endLocalDate: "2026-09-07", days: 7 });

  assert.equal(metric(report, "internato", "clinical_topics").value, 2);
  assert.equal(metric(report, "estudos", "focused_minutes").value, 45);
  assert.equal(metric(report, "estudos", "question_accuracy_percent").value, 80);
  assert.equal(metric(report, "medicamentos", "stock_quantity_latest").value, 12);
  assert.equal(metric(report, "medicamentos", "stock_refill_threshold_latest").value, 5);
  assert.equal(metric(report, "medicamentos", "stock_days_latest").value, null);
  assert.equal(metric(report, "medicamentos", "stock_days_latest").missing, 1);
});

test("current bruxism and routine nested fields retain AM/PM, task, anchor and closure facts", () => {
  const report = analytics.buildAnalyticsReport([
    entity({
      domain: "bruxismo",
      payload: {
        schema: "bruxism-am-pm-v1",
        eventKind: "bruxism-am-pm",
        morning: {
          jawPain: known(2),
          templePain: known(0),
          stiffness: known(1),
          dentalSensitivity: known(0),
        },
        evening: {
          jawPain: known(4),
          templePain: known(0),
          stiffness: known(2),
          dentalSensitivity: known(0),
        },
        daytimeClenching: known(true),
        grindingReported: known(false),
        guardUsed: known(true),
      },
    }),
    entity({
      domain: "rotina",
      localDate: "2026-09-02",
      payload: {
        schema: "routine-day-plan-v1",
        eventKind: "routine-day-plan",
        anchors: [
          { kind: "wake", timeLocal: known("07:00") },
          { kind: "main-start", timeLocal: known("08:00") },
          { kind: "study", timeLocal: unknown() },
          { kind: "wind-down", timeLocal: unknown() },
        ],
        tasks: [
          { title: known("Base"), status: known("done"), priority: known("essential") },
          { title: known("Boa"), status: known("deferred"), priority: known("good") },
          { title: known("Ouro"), status: known("planned"), priority: known("gold") },
        ],
        closure: {
          state: known("closed"),
          dayScore: known(3),
          carriedForward: unknown(),
          reflection: unknown(),
        },
      },
    }),
  ], { endLocalDate: "2026-09-07", days: 7 });

  assert.equal(metric(report, "bruxismo", "jaw_pain_average").value, 3);
  assert.equal(metric(report, "bruxismo", "jaw_pain_morning_average").value, 2);
  assert.equal(metric(report, "bruxismo", "jaw_pain_evening_average").value, 4);
  assert.equal(metric(report, "bruxismo", "splint_use_events").value, 1);
  assert.equal(metric(report, "rotina", "routine_tasks").value, 3);
  assert.equal(metric(report, "rotina", "completed_blocks_percent").value, 33.33);
  assert.equal(metric(report, "rotina", "deferred_tasks").value, 1);
  assert.equal(metric(report, "rotina", "anchors_scheduled").value, 2);
  assert.equal(metric(report, "rotina", "anchors_scheduled").missing, 2);
  assert.equal(metric(report, "rotina", "daily_closures").value, 1);
});

test("current agenda, AI and knowledge nested fields map without promoting unknown review state", () => {
  const report = analytics.buildAnalyticsReport([
    entity({
      domain: "agenda",
      localDate: "2026-09-03",
      payload: {
        schema: "agenda-record-v1",
        eventKind: "agenda-event",
        recordMode: "event",
        date: known("2026-09-03"),
        event: { startLocal: known("09:00"), endLocal: known("10:00") },
      },
    }),
    entity({
      domain: "agenda",
      localDate: "2026-09-03",
      payload: {
        schema: "agenda-record-v1",
        eventKind: "agenda-event",
        recordMode: "event",
        date: known("2026-09-03"),
        event: { startLocal: known("09:30"), endLocal: known("11:00") },
      },
    }),
    entity({
      domain: "agenda",
      localDate: "2026-09-01",
      payload: {
        schema: "agenda-record-v1",
        eventKind: "agenda-task",
        recordMode: "task",
        date: known("2026-09-01"),
        task: { dueLocal: known("10:00"), status: known("planned") },
      },
    }),
    entity({
      domain: "ia",
      localDate: "2026-09-04",
      payload: {
        schema: "ai-tool-portfolio-v1",
        eventKind: "ai-tool-portfolio",
        toolName: known("Ferramenta A"),
        subscription: {
          price: known({ amountMinor: 10_000, currency: "BRL" }),
          cadence: known("monthly"),
          renewalDate: known("2026-09-20"),
        },
      },
    }),
    entity({
      domain: "conhecimento",
      localDate: "2026-09-04",
      payload: {
        schema: "knowledge-capture-v1",
        eventKind: "knowledge-capture",
        title: known("Pérola"),
        capture: known("Conteúdo"),
        nextReviewDate: known("2026-09-05"),
      },
    }),
  ], { endLocalDate: "2026-09-10", days: 10 });

  assert.equal(metric(report, "agenda", "commitments").value, 2);
  assert.equal(metric(report, "agenda", "committed_minutes").value, 150);
  assert.equal(metric(report, "agenda", "schedule_conflicts").value, 1);
  assert.equal(metric(report, "agenda", "overdue_tasks").value, 1);
  assert.equal(metric(report, "ia", "monthly_cost_minor").value, 10_000);
  assert.equal(metric(report, "conhecimento", "review_dates_reached").value, 1);
  assert.equal(metric(report, "conhecimento", "reviews_due").value, null);
  assert.equal(metric(report, "conhecimento", "reviews_due").missing, 1);
});

test("current finance transaction, debt and subscription payloads remain separate facts", () => {
  const financePayload = (eventKind, recordMode, patch) => ({
    schema: "finance-record-v1",
    eventKind,
    recordMode,
    institution: known("Banco do Brasil"),
    transaction: {
      direction: { state: "not_applicable", reasonCode: `${recordMode}_record` },
      amount: { state: "not_applicable", reasonCode: `${recordMode}_record` },
      ...patch.transaction,
    },
    debt: {
      outstanding: { state: "not_applicable", reasonCode: `${recordMode}_record` },
      dueDate: { state: "not_applicable", reasonCode: `${recordMode}_record` },
      minimumPayment: { state: "not_applicable", reasonCode: `${recordMode}_record` },
      ...patch.debt,
    },
    subscription: {
      price: { state: "not_applicable", reasonCode: `${recordMode}_record` },
      renewalDate: { state: "not_applicable", reasonCode: `${recordMode}_record` },
      status: { state: "not_applicable", reasonCode: `${recordMode}_record` },
      ...patch.subscription,
    },
  });
  const report = analytics.buildAnalyticsReport([
    entity({
      domain: "financas",
      payload: financePayload("finance-transaction", "transaction", {
        transaction: {
          direction: known("income"),
          amount: known({ amountMinor: 50_000, currency: "BRL" }),
        },
      }),
    }),
    entity({
      domain: "financas",
      localDate: "2026-09-02",
      payload: financePayload("finance-transaction", "transaction", {
        transaction: {
          direction: known("expense"),
          amount: known({ amountMinor: 12_345, currency: "BRL" }),
        },
      }),
    }),
    entity({
      domain: "financas",
      localDate: "2026-09-03",
      payload: financePayload("finance-debt", "debt", {
        debt: {
          outstanding: known({ amountMinor: 100_000, currency: "BRL" }),
          dueDate: known("2026-10-02"),
          minimumPayment: known({ amountMinor: 5_000, currency: "BRL" }),
        },
      }),
    }),
    entity({
      domain: "financas",
      localDate: "2026-09-04",
      payload: financePayload("finance-subscription", "subscription", {
        subscription: {
          price: known({ amountMinor: 9_900, currency: "BRL" }),
          renewalDate: known("2026-10-03"),
          status: known("active_confirmed"),
        },
      }),
    }),
  ], { endLocalDate: "2026-09-30", days: 30 });

  assert.equal(metric(report, "financas", "income_minor").value, 50_000);
  assert.equal(metric(report, "financas", "expense_minor").value, 12_345);
  assert.equal(metric(report, "financas", "net_flow_minor").value, 37_655);
  assert.equal(metric(report, "financas", "debt_recorded_minor").value, 100_000);
  assert.equal(metric(report, "financas", "bill_recorded_minor").value, 9_900);
  assert.equal(metric(report, "financas", "obligations_7d_minor").value, 14_900);
});

test("subscription obligations require explicitly confirmed active status", () => {
  const canonicalSubscription = (status) => ({
    schema: "finance-record-v1",
    eventKind: "finance-subscription",
    recordMode: "subscription",
    institution: known("Banco do Brasil"),
    subscription: {
      service: known("Serviço informado"),
      price: known({ amountMinor: 2_500, currency: "BRL" }),
      cadence: known("monthly"),
      renewalDate: known("2026-10-02"),
      status,
    },
  });
  const canonicalReport = analytics.buildAnalyticsReport([
    known("active_confirmed"),
    known("trial_confirmed"),
    known("cancelled_confirmed"),
    known("uncertain"),
  ].map((status) => entity({
    domain: "financas",
    localDate: "2026-09-29",
    payload: canonicalSubscription(status),
  })), { endLocalDate: "2026-09-30", days: 30 });

  const canonicalObligations = metric(canonicalReport, "financas", "obligations_7d_minor");
  assert.equal(canonicalObligations.value, 2_500);
  assert.equal(canonicalObligations.n, 1);
  assert.equal(canonicalObligations.missing, 0);
  assert.equal(metric(canonicalReport, "financas", "bill_recorded_minor").value, 10_000);

  const unknownReport = analytics.buildAnalyticsReport([
    entity({
      domain: "financas",
      localDate: "2026-09-29",
      payload: canonicalSubscription(unknown("not_confirmed")),
    }),
  ], { endLocalDate: "2026-09-30", days: 30 });
  assert.equal(metric(unknownReport, "financas", "obligations_7d_minor").value, null);
  assert.equal(metric(unknownReport, "financas", "obligations_7d_minor").n, 0);

  const legacyReport = analytics.buildAnalyticsReport([
    entity({
      domain: "financas",
      localDate: "2026-09-29",
      payload: {
        eventKind: "finance-subscription",
        subscription: {
          price: known({ amountMinor: 2_500, currency: "BRL" }),
          renewalDate: known("2026-10-02"),
        },
      },
    }),
  ], { endLocalDate: "2026-09-30", days: 30 });
  assert.equal(metric(legacyReport, "financas", "obligations_7d_minor").value, null);
  assert.equal(metric(legacyReport, "financas", "obligations_7d_minor").n, 0);
  assert.equal(metric(legacyReport, "financas", "bill_recorded_minor").value, 2_500);
});

test("canonical FinanceWorkspace transactions include only posted facts in cash flow", () => {
  const provider = { kind: "listed", name: "Mercado Pago" };
  const transaction = (direction, amountMinor, status, transactionDate) => ({
    provider,
    direction,
    amount: { amountMinor, currency: "BRL" },
    transactionDate,
    settledDate: unknown(),
    status,
    category: unknown(),
    description: unknown(),
  });
  const report = analytics.buildAnalyticsReport([
    entity({
      domain: "financas",
      type: "financas.transaction",
      localDate: "2026-09-10",
      payload: transaction("income", 10_000, "posted", "2026-09-10"),
    }),
    entity({
      domain: "financas",
      type: "financas.transaction",
      localDate: "2026-09-11",
      payload: transaction("expense", 2_550, "posted", "2026-09-11"),
    }),
    entity({
      domain: "financas",
      type: "financas.transaction",
      localDate: "2026-09-12",
      payload: transaction("income", 99_900, "pending", "2026-09-12"),
    }),
    entity({
      domain: "financas",
      type: "financas.transaction",
      localDate: "2026-09-13",
      payload: transaction("expense", 88_800, "voided", "2026-09-13"),
    }),
  ], { endLocalDate: "2026-09-30", days: 30 });

  assert.deepEqual(
    {
      income: metric(report, "financas", "income_minor").value,
      expense: metric(report, "financas", "expense_minor").value,
      net: metric(report, "financas", "net_flow_minor").value,
    },
    { income: 10_000, expense: 2_550, net: 7_450 },
  );
  assert.equal(metric(report, "financas", "income_minor").n, 1);
  assert.equal(metric(report, "financas", "expense_minor").n, 1);
});

test("canonical FinanceWorkspace obligations use active status, future due dates, and recorded interest", () => {
  const provider = { kind: "listed", name: "Banco do Brasil" };
  const bill = ({ label, amountMinor, dueDate, status, interestMinor }) => ({
    provider,
    label,
    amount: known({ amountMinor, currency: "BRL" }),
    dueDate: known(dueDate),
    paidDate: status === "paid" ? known(dueDate) : unknown(),
    interestCharged: interestMinor === undefined
      ? unknown()
      : known({ amountMinor: interestMinor, currency: "BRL" }),
    status,
    note: unknown(),
  });
  const debt = ({ label, localDate, dueDate, status, interestMinor }) => ({
    provider,
    label,
    originalPrincipal: unknown(),
    outstandingBalance: known({ amountMinor: 100_000, currency: "BRL" }),
    annualPercentageRateBps: unknown(),
    interestCharged: interestMinor === undefined
      ? unknown()
      : known({ amountMinor: interestMinor, currency: "BRL" }),
    balanceAsOfLocalDate: known(localDate),
    dueDate: known(dueDate),
    status,
    note: unknown(),
  });
  const futureTransaction = {
    provider,
    direction: "income",
    amount: { amountMinor: 500_000, currency: "BRL" },
    transactionDate: "2026-10-02",
    settledDate: unknown(),
    status: "posted",
    category: unknown(),
    description: unknown(),
  };

  const report = analytics.buildAnalyticsReport([
    entity({
      domain: "financas",
      type: "financas.bill",
      localDate: "2026-09-15",
      payload: bill({
        label: "Conta já paga",
        amountMinor: 4_000,
        dueDate: "2026-09-15",
        status: "paid",
        interestMinor: 250,
      }),
    }),
    entity({
      domain: "financas",
      type: "financas.debt",
      localDate: "2026-09-20",
      payload: debt({
        label: "Cheque especial",
        localDate: "2026-09-20",
        dueDate: "2026-10-20",
        status: "active",
        interestMinor: 700,
      }),
    }),
    // A canonical bill is dated by its future due date in the repository. It
    // must still appear as an obligation without becoming historical flow.
    entity({
      domain: "financas",
      type: "financas.bill",
      localDate: "2026-10-02",
      payload: bill({
        label: "Fatura futura ativa",
        amountMinor: 10_000,
        dueDate: "2026-10-02",
        status: "scheduled",
      }),
    }),
    entity({
      domain: "financas",
      type: "financas.bill",
      localDate: "2026-10-03",
      payload: bill({
        label: "Fatura futura paga",
        amountMinor: 20_000,
        dueDate: "2026-10-03",
        status: "paid",
      }),
    }),
    entity({
      domain: "financas",
      type: "financas.bill",
      localDate: "2026-10-04",
      payload: bill({
        label: "Fatura futura cancelada",
        amountMinor: 30_000,
        dueDate: "2026-10-04",
        status: "cancelled",
      }),
    }),
    entity({
      domain: "financas",
      type: "financas.debt",
      localDate: "2026-09-25",
      payload: debt({
        label: "Dívida ativa sem parcela informada",
        localDate: "2026-09-25",
        dueDate: "2026-10-05",
        status: "active",
      }),
    }),
    entity({
      domain: "financas",
      type: "financas.debt",
      localDate: "2026-09-25",
      payload: debt({
        label: "Dívida pausada",
        localDate: "2026-09-25",
        dueDate: "2026-10-06",
        status: "paused",
      }),
    }),
    entity({
      domain: "financas",
      type: "financas.debt",
      localDate: "2026-09-25",
      payload: debt({
        label: "Dívida paga",
        localDate: "2026-09-25",
        dueDate: "2026-10-06",
        status: "paid",
      }),
    }),
    entity({
      domain: "financas",
      type: "financas.transaction",
      localDate: "2026-10-02",
      payload: futureTransaction,
    }),
  ], { endLocalDate: "2026-09-30", days: 30 });

  const obligations = metric(report, "financas", "obligations_7d_minor");
  assert.equal(obligations.value, 10_000);
  assert.equal(obligations.n, 1);
  assert.equal(obligations.missing, 1);
  assert.equal(metric(report, "financas", "obligations_30d_minor").value, 10_000);
  assert.equal(metric(report, "financas", "interest_recorded_minor").value, 950);
  assert.equal(metric(report, "financas", "income_minor").value, null);
  assert.equal(metric(report, "financas", "net_flow_minor").value, null);
  assert.ok(report.nextActions.some((action) =>
    action.domain === "financas" && action.evidence.metricKey === "obligations_7d_minor"
  ));
});

test("canonical cards use an active statement or explicit minimum without inventing balance", () => {
  const provider = { kind: "listed", name: "PicPay" };
  const card = ({ label, dueDate, status, statement, minimum, balance = 900_000 }) => ({
    provider,
    label,
    closingDate: unknown(),
    dueDate: known(dueDate),
    statedCreditLimit: unknown(),
    currentBalance: known({ amountMinor: balance, currency: "BRL" }),
    currentStatementAmount: statement === undefined
      ? unknown()
      : known({ amountMinor: statement, currency: "BRL" }),
    minimumPayment: minimum === undefined
      ? unknown()
      : known({ amountMinor: minimum, currency: "BRL" }),
    annualPercentageRateBps: unknown(),
    balanceAsOfLocalDate: known("2026-09-30"),
    installments: [],
    status,
    note: unknown(),
  });
  const report = analytics.buildAnalyticsReport([
    entity({
      domain: "financas",
      type: "financas.card",
      localDate: "2026-10-02",
      payload: card({
        label: "Fatura ativa",
        dueDate: "2026-10-02",
        status: "active",
        statement: 30_000,
        minimum: 3_000,
      }),
    }),
    entity({
      domain: "financas",
      type: "financas.card",
      localDate: "2026-10-03",
      payload: card({
        label: "Somente mínimo explícito",
        dueDate: "2026-10-03",
        status: "active",
        minimum: 2_500,
      }),
    }),
    entity({
      domain: "financas",
      type: "financas.card",
      localDate: "2026-10-04",
      payload: card({
        label: "Sem fatura ou mínimo",
        dueDate: "2026-10-04",
        status: "active",
      }),
    }),
    entity({
      domain: "financas",
      type: "financas.card",
      localDate: "2026-10-05",
      payload: card({
        label: "Cartão pausado",
        dueDate: "2026-10-05",
        status: "paused",
        statement: 80_000,
      }),
    }),
    entity({
      domain: "financas",
      type: "financas.card",
      localDate: "2026-10-06",
      payload: card({
        label: "Cartão encerrado",
        dueDate: "2026-10-06",
        status: "closed",
        statement: 70_000,
      }),
    }),
  ], { endLocalDate: "2026-09-30", days: 30 });

  const obligations = metric(report, "financas", "obligations_7d_minor");
  assert.equal(obligations.value, 32_500);
  assert.equal(obligations.n, 2);
  assert.equal(obligations.missing, 1);
  assert.notEqual(obligations.value, 900_000);
});

test("card installments enter 30-day obligations once and include the D+30 edge", () => {
  const provider = { kind: "listed", name: "PicPay" };
  const money = (amountMinor) => known({ amountMinor, currency: "BRL" });
  const installment = ({ id, amountMinor, remaining, nextDueDate }) => ({
    id,
    label: id,
    purchaseTotal: unknown(),
    installmentAmount: money(amountMinor),
    totalInstallments: known(6),
    remainingInstallments: known(remaining),
    nextDueDate: known(nextDueDate),
    finalDueDate: unknown(),
  });
  const card = ({ label, dueDate, statement, installments }) => ({
    provider,
    label,
    closingDate: unknown(),
    dueDate: dueDate ? known(dueDate) : unknown(),
    statedCreditLimit: unknown(),
    currentBalance: unknown(),
    currentStatementAmount: statement === undefined ? unknown() : money(statement),
    minimumPayment: unknown(),
    annualPercentageRateBps: unknown(),
    balanceAsOfLocalDate: known("2026-09-30"),
    installments,
    status: "active",
    note: unknown(),
  });
  const report = analytics.buildAnalyticsReport([
    entity({
      domain: "financas",
      type: "financas.card",
      localDate: "2026-10-02",
      payload: card({
        label: "Fatura com parcelas",
        dueDate: "2026-10-02",
        statement: 30_000,
        installments: [
          installment({ id: "incluída-na-fatura", amountMinor: 10_000, remaining: 2, nextDueDate: "2026-10-02" }),
          installment({ id: "próximo-ciclo", amountMinor: 5_000, remaining: 2, nextDueDate: "2026-10-10" }),
          installment({ id: "concluída", amountMinor: 9_000, remaining: 0, nextDueDate: "2026-10-05" }),
        ],
      }),
    }),
    entity({
      domain: "financas",
      type: "financas.card",
      localDate: "2026-10-30",
      payload: card({
        label: "Somente parcela em D+30",
        installments: [
          installment({ id: "d-mais-30", amountMinor: 7_000, remaining: 1, nextDueDate: "2026-10-30" }),
        ],
      }),
    }),
  ], { endLocalDate: "2026-09-30", days: 30 });

  const due7 = metric(report, "financas", "obligations_7d_minor");
  assert.equal(due7.value, 30_000);
  assert.equal(due7.n, 1);

  const due30 = metric(report, "financas", "obligations_30d_minor");
  assert.equal(due30.value, 42_000);
  assert.equal(due30.n, 3);
  assert.equal(due30.missing, 0);
});

test("recorded medication clocks never invent an on-time classification", () => {
  const report = analytics.buildAnalyticsReport([
    entity({
      domain: "medicamentos",
      type: "medicamentos.confirmation",
      localDate: "2026-09-01",
      payload: {
        confirmation: "taken_time_recorded",
        scheduledTimeLocal: known("08:00"),
        actualTimeLocal: known("08:07"),
      },
    }),
  ], { endLocalDate: "2026-09-01", days: 1 });

  assert.equal(metric(report, "medicamentos", "on_time_percent").value, null);
  assert.equal(metric(report, "medicamentos", "on_time_percent").n, 0);
  assert.equal(metric(report, "medicamentos", "on_time_percent").missing, 1);
  assert.equal(metric(report, "medicamentos", "delay_median_minutes").value, 7);
});
