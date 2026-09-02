import { expect, test } from "@playwright/test";
import {
  buildAnalyticsReport,
  confirmedAbsent,
  known,
  shiftLocalDate,
  unknown,
  type AnalyticsMetric,
  type Domain,
  type GenericPayload,
  type LocalDate,
  type MentorEntity,
} from "../src/domain";

const DATASET_ID = "contract-dataset";

function entity(
  id: string,
  domain: Domain,
  localDate: LocalDate,
  payload: GenericPayload,
  occurredAtUTC = `${localDate}T12:00:00.000Z`,
): MentorEntity<"generic.event"> {
  return {
    id,
    datasetId: DATASET_ID,
    domain,
    type: "generic.event",
    localDate,
    occurredAtUTC,
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision: 1,
    source: "manual",
    status: "active",
    createdAt: occurredAtUTC,
    updatedAt: occurredAtUTC,
    payload,
  };
}

function metric(
  entities: readonly MentorEntity[],
  domain: Domain,
  key: string,
  days = 60,
): AnalyticsMetric {
  const report = buildAnalyticsReport(entities, {
    endLocalDate: "2026-09-01",
    days,
    datasetId: DATASET_ID,
  });
  const result = report.domains[domain].metrics.find((item) => item.key === key);
  if (!result) throw new Error(`Métrica ausente: ${domain}.${key}`);
  return result;
}

function sleepChronology(
  awakeMinutes: ReturnType<typeof known<number>> | ReturnType<typeof unknown<number>>,
  napMinutes: ReturnType<typeof known<number>> | ReturnType<typeof unknown<number>> = known(0),
): GenericPayload {
  return {
    schema: "sleep-chronology-v1",
    eventKind: "sleep-chronology",
    chronology: {
      wentToBedLocal: known("23:00"),
      sleepOnsetLocal: known("23:30"),
      finalWakeLocal: known("07:00"),
      leftBedLocal: known("07:15"),
    },
    awakenings: known(2),
    awakeMinutes,
    napMinutes,
    perceivedQuality: known(4),
    restorative: known(true),
    note: unknown(),
  };
}

function energyPayload(value: number): GenericPayload {
  return {
    eventKind: "mood-functional-check-in",
    scaleVersion: "mentor-functional-scales-v1",
    mood: unknown(),
    energy: known(value),
    anxiety: unknown(),
    irritability: unknown(),
  };
}

test("sleep chronology derives total, latency, time in bed, efficiency and naps without inventing zero", () => {
  const complete = entity("sleep-complete", "sono", "2026-09-01", sleepChronology(known(30), known(30)));

  expect(metric([complete], "sono", "sleep_period_average_minutes")).toMatchObject({ value: 450, n: 1 });
  expect(metric([complete], "sono", "sleep_duration_average_minutes")).toMatchObject({ value: 420, n: 1 });
  expect(metric([complete], "sono", "time_in_bed_average_minutes")).toMatchObject({ value: 495, n: 1 });
  expect(metric([complete], "sono", "sleep_latency_average_minutes")).toMatchObject({ value: 30, n: 1 });
  expect(metric([complete], "sono", "awake_minutes_average")).toMatchObject({ value: 30, n: 1 });
  expect(metric([complete], "sono", "sleep_efficiency_average_percent")).toMatchObject({ value: 84.85, n: 1 });
  expect(metric([complete], "sono", "naps")).toMatchObject({ value: 1, n: 1, missing: 0 });
  expect(metric([complete], "sono", "nap_minutes")).toMatchObject({ value: 30, n: 1, missing: 0 });

  const incomplete = entity("sleep-incomplete", "sono", "2026-09-01", sleepChronology(unknown(), unknown()));
  expect(metric([incomplete], "sono", "sleep_period_average_minutes")).toMatchObject({ value: 450, n: 1 });
  expect(metric([incomplete], "sono", "sleep_duration_average_minutes")).toMatchObject({ value: null, n: 0, missing: 1 });
  expect(metric([incomplete], "sono", "sleep_efficiency_average_percent")).toMatchObject({ value: null, n: 0, missing: 1 });
  expect(metric([incomplete], "sono", "naps")).toMatchObject({ value: null, n: 0, missing: 1 });

  const impossible = entity("sleep-impossible", "sono", "2026-09-01", sleepChronology(known(451)));
  expect(metric([impossible], "sono", "sleep_duration_average_minutes")).toMatchObject({ value: null, n: 0, missing: 1 });
  expect(metric([impossible], "sono", "sleep_efficiency_average_percent")).toMatchObject({ value: null, n: 0, missing: 1 });
});

test("nap events stay out of main sleep and the sleep-energy signal waits for fourteen complete pairs", () => {
  const thirteenPairs: MentorEntity[] = [];
  for (let offset = 0; offset < 13; offset += 1) {
    const localDate = shiftLocalDate("2026-09-01", -offset);
    thirteenPairs.push(
      entity(`sleep-13-${offset}`, "sono", localDate, {
        eventKind: "sleep-episode",
        sleepStartLocal: known(offset < 2 ? "01:00" : "23:00"),
        sleepEndLocal: known(offset < 2 ? "06:00" : "07:00"),
      }),
      entity(`energy-13-${offset}`, "humor", localDate, energyPayload(offset < 2 ? 4 : 2)),
    );
  }
  expect(metric(thirteenPairs, "humor", "short_sleep_high_energy_cooccurrence", 30)).toMatchObject({
    value: null,
    n: 13,
  });

  const fourteenthDate = shiftLocalDate("2026-09-01", -13);
  const ready = [
    ...thirteenPairs,
    entity("sleep-14", "sono", fourteenthDate, {
      eventKind: "sleep-episode",
      sleepStartLocal: known("23:00"),
      sleepEndLocal: known("07:00"),
    }),
    entity("energy-14", "humor", fourteenthDate, energyPayload(2)),
    entity("nap-does-not-count", "sono", fourteenthDate, {
      eventKind: "sleep-nap",
      durationMinutes: known(30),
    }, `${fourteenthDate}T14:00:00.000Z`),
  ];
  expect(metric(ready, "humor", "short_sleep_high_energy_cooccurrence", 30)).toMatchObject({
    value: 2,
    n: 14,
    missing: 16,
  });
  expect(metric(ready, "sono", "sleep_duration_average_minutes", 30)).toMatchObject({ value: 454.29, n: 14 });
});

test("bedtime variability remains circular around midnight", () => {
  const records = [
    entity("bed-a", "sono", "2026-08-31", {
      ...sleepChronology(known(0)),
      chronology: {
        wentToBedLocal: known("23:55"),
        sleepOnsetLocal: known("00:00"),
        finalWakeLocal: known("07:00"),
        leftBedLocal: known("07:05"),
      },
    }),
    entity("bed-b", "sono", "2026-09-01", {
      ...sleepChronology(known(0)),
      chronology: {
        wentToBedLocal: known("00:05"),
        sleepOnsetLocal: known("00:10"),
        finalWakeLocal: known("07:00"),
        leftBedLocal: known("07:05"),
      },
    }),
  ];
  expect(metric(records, "sono", "bedtime_variability_minutes").value).toBeCloseTo(5, 1);
});

test("study metrics use planned and completed facts plus only comparable question pairs", () => {
  const records = [
    entity("study-complete", "estudos", "2026-09-01", {
      eventKind: "study-session",
      minutes: known(50),
      actualDurationMinutes: known(50),
      plannedDurationMinutes: known(60),
      completed: known(true),
      questions: { attempted: known(10), correct: known(8) },
    }),
    entity("study-missing-hits", "estudos", "2026-08-31", {
      eventKind: "study-session",
      minutes: known(30),
      plannedDurationMinutes: known(30),
      completed: known(false),
      questions: { attempted: known(10), correct: unknown() },
    }),
    entity("study-invalid-pair", "estudos", "2026-08-30", {
      eventKind: "study-session",
      minutes: known(0),
      plannedDurationMinutes: known(0),
      completed: known(false),
      questions: { attempted: known(5), correct: known(8) },
    }),
  ];
  expect(metric(records, "estudos", "focused_minutes")).toMatchObject({ value: 80, n: 3 });
  expect(metric(records, "estudos", "planned_minutes")).toMatchObject({ value: 90, n: 3 });
  expect(metric(records, "estudos", "completed_sessions")).toMatchObject({ value: 1, n: 3 });
  expect(metric(records, "estudos", "question_accuracy_percent")).toMatchObject({ value: 80, n: 10, missing: 2 });
});

test("bruxism reads AM/PM jaw pain and guard use while preserving explicit absence", () => {
  const record = entity("bruxism", "bruxismo", "2026-09-01", {
    eventKind: "bruxism-am-pm",
    morning: { jawPain: known(2), stiffness: known(0) },
    evening: { jawPain: known(4) },
    guardUsed: confirmedAbsent("guard_not_used_confirmed"),
    morningSymptoms: confirmedAbsent("all_morning_symptom_scales_zero"),
  });
  expect(metric([record], "bruxismo", "jaw_pain_morning_average")).toMatchObject({ value: 2, n: 1 });
  expect(metric([record], "bruxismo", "jaw_pain_evening_average")).toMatchObject({ value: 4, n: 1 });
  expect(metric([record], "bruxismo", "splint_use_events")).toMatchObject({ value: 0, n: 1, confirmedAbsences: 1 });

  const unknownRecord = entity("bruxism-unknown", "bruxismo", "2026-09-01", {
    eventKind: "bruxism-am-pm",
    morning: { jawPain: unknown() },
    evening: { jawPain: unknown() },
    guardUsed: unknown(),
  });
  expect(metric([unknownRecord], "bruxismo", "jaw_pain_morning_average")).toMatchObject({ value: null, n: 0 });
  expect(metric([unknownRecord], "bruxismo", "splint_use_events")).toMatchObject({ value: null, n: 0, missing: 1 });
});

test("AI price/amount aliases respect cadence and unknown renewal/use stay unknown", () => {
  const records = [
    entity("ai-monthly", "ia", "2026-09-01", {
      eventKind: "ai-tool-portfolio",
      toolName: known("Mensal"),
      subscription: {
        price: known({ amountMinor: 3_000, currency: "BRL" }),
        cadence: known("monthly"),
        renewalDate: unknown(),
      },
    }),
    entity("ai-yearly-legacy", "ia", "2026-08-31", {
      eventKind: "ai-tool-portfolio",
      toolName: known("Anual"),
      subscription: {
        amount: known({ amountMinor: 12_000, currency: "BRL" }),
        cadence: known("yearly"),
        renewalDate: unknown(),
      },
    }),
  ];
  expect(metric(records, "ia", "monthly_cost_minor")).toMatchObject({ value: 4_000, n: 2 });
  expect(metric(records, "ia", "renewals_7d")).toMatchObject({ value: null, n: 0, missing: 2 });
  expect(metric(records, "ia", "tools_with_confirmed_no_use")).toMatchObject({ value: null, n: 0, missing: 2 });
});

test("knowledge accepts current and legacy review dates without inventing review completion", () => {
  const current = entity("knowledge-current", "conhecimento", "2026-08-20", {
    eventKind: "knowledge-capture",
    title: known("Atual"),
    nextReviewDate: known("2026-08-31"),
    review: { completed: unknown() },
    convertedToQuestion: unknown(),
  });
  expect(metric([current], "conhecimento", "review_dates_reached")).toMatchObject({ value: 1, n: 1 });
  expect(metric([current], "conhecimento", "reviews_due")).toMatchObject({ value: null, n: 0, missing: 1 });
  expect(metric([current], "conhecimento", "notes_reviewed")).toMatchObject({ value: null, n: 0, missing: 1 });
  expect(metric([current], "conhecimento", "notes_converted")).toMatchObject({ value: null, n: 0, missing: 1 });

  const legacy = entity("knowledge-legacy", "conhecimento", "2026-08-21", {
    eventKind: "knowledge-capture",
    title: known("Legada"),
    reviewDueDate: known("2026-08-31"),
    reviewed: known(false),
  });
  expect(metric([legacy], "conhecimento", "reviews_due")).toMatchObject({ value: 1, n: 1, missing: 0 });
});

test("routine arrays ignore placeholder slots and count only named tasks and timed anchors", () => {
  const record = entity("routine", "rotina", "2026-09-01", {
    eventKind: "routine-day-plan",
    anchors: [
      { kind: "wake", timeLocal: known("07:00") },
      { kind: "study", timeLocal: unknown() },
    ],
    tasks: [
      { title: known("Revisar CTG"), status: known("done"), priority: known("essential") },
      { title: unknown(), status: unknown(), priority: unknown() },
      { title: unknown(), status: unknown(), priority: unknown() },
    ],
    closure: { state: unknown() },
  });
  expect(metric([record], "rotina", "routine_tasks")).toMatchObject({ value: 1, n: 1 });
  expect(metric([record], "rotina", "completed_blocks_percent")).toMatchObject({ value: 100, n: 1 });
  expect(metric([record], "rotina", "anchors_scheduled")).toMatchObject({ value: 1, n: 1, missing: 1 });
  expect(metric([record], "rotina", "daily_closures")).toMatchObject({ value: null, n: 0, missing: 1 });
});
