import { expect, test } from "@playwright/test";
import {
  ANALYTICS_DOMAINS,
  buildArchiveSnapshot,
  buildDashboardSnapshot,
  confirmedAbsent,
  invalidKnowledge,
  known,
  notApplicable,
  unknown,
  type AnalyticsMetric,
  type Domain,
  type GenericPayload,
  type LocalDate,
  type MentorEntity,
} from "../src/domain";

const DATASET_A = "dataset-a";

interface EntityOptions {
  id: string;
  domain: Domain;
  localDate: LocalDate;
  payload: GenericPayload;
  datasetId?: string;
  occurredAtUTC?: string;
  revision?: number;
  status?: MentorEntity["status"];
}

function genericEntity(options: EntityOptions): MentorEntity<"generic.event"> {
  const occurredAtUTC = options.occurredAtUTC ?? `${options.localDate}T12:00:00.000Z`;
  return {
    id: options.id,
    datasetId: options.datasetId ?? DATASET_A,
    domain: options.domain,
    type: "generic.event",
    localDate: options.localDate,
    occurredAtUTC,
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision: options.revision ?? 1,
    source: "manual",
    status: options.status ?? "active",
    createdAt: occurredAtUTC,
    updatedAt: occurredAtUTC,
    payload: options.payload,
  };
}

function shiftEntity(): MentorEntity<"internato.shift"> {
  const occurredAtUTC = "2026-09-01T10:00:00.000Z";
  return {
    id: "shift",
    datasetId: DATASET_A,
    domain: "internato",
    type: "internato.shift",
    localDate: "2026-09-01",
    occurredAtUTC,
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision: 1,
    source: "manual",
    status: "active",
    createdAt: occurredAtUTC,
    updatedAt: occurredAtUTC,
    payload: {
      scheduleState: "confirmed_planned",
      scheduledStartLocal: "2026-09-01T07:00:00",
      scheduledEndLocal: "2026-09-01T13:00:00",
      assignment: unknown(),
      location: unknown(),
      attendance: known("present"),
      arrivalLocal: known("2026-09-01T07:05:00"),
      departureLocal: known("2026-09-01T13:00:00"),
      breakStartLocal: unknown(),
      breakEndLocal: unknown(),
    },
  };
}

function medicationEntity(): MentorEntity<"medicamentos.confirmation"> {
  const occurredAtUTC = "2026-09-01T11:00:00.000Z";
  return {
    id: "medication",
    datasetId: DATASET_A,
    domain: "medicamentos",
    type: "medicamentos.confirmation",
    localDate: "2026-09-01",
    occurredAtUTC,
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision: 1,
    source: "manual",
    status: "active",
    createdAt: occurredAtUTC,
    updatedAt: occurredAtUTC,
    payload: {
      medicationName: unknown(),
      scheduledTimeLocal: known("08:00"),
      actualTimeLocal: known("08:10"),
      confirmation: "taken_time_recorded",
      note: unknown(),
    },
  };
}

function canonicalAgendaEntities(): MentorEntity[] {
  const base = {
    datasetId: DATASET_A,
    domain: "agenda" as const,
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision: 1,
    source: "manual" as const,
    status: "active" as const,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  };
  const first: MentorEntity<"agenda.event"> = {
    ...base,
    id: "agenda-first",
    type: "agenda.event",
    localDate: "2026-09-01",
    occurredAtUTC: "2026-09-01T12:00:00.000Z",
    payload: {
      title: "Primeiro compromisso",
      status: "confirmed",
      priority: "normal",
      plannedStartLocal: known("2026-09-01T09:00"),
      plannedEndLocal: known("2026-09-01T10:00"),
      actualStartLocal: unknown(),
      actualEndLocal: unknown(),
      dueLocalDate: unknown(),
      dueLocalTime: unknown(),
      bufferBeforeMinutes: notApplicable("no_buffer_requested"),
      bufferAfterMinutes: known(20),
      note: unknown(),
    },
  };
  const second: MentorEntity<"agenda.event"> = {
    ...base,
    id: "agenda-second",
    type: "agenda.event",
    localDate: "2026-09-01",
    occurredAtUTC: "2026-09-01T13:00:00.000Z",
    payload: {
      title: "Segundo compromisso",
      status: "confirmed",
      priority: "normal",
      plannedStartLocal: known("2026-09-01T10:10"),
      plannedEndLocal: known("2026-09-01T11:00"),
      actualStartLocal: unknown(),
      actualEndLocal: unknown(),
      dueLocalDate: unknown(),
      dueLocalTime: unknown(),
      bufferBeforeMinutes: known(5),
      bufferAfterMinutes: notApplicable("no_buffer_requested"),
      note: unknown(),
    },
  };
  const task: MentorEntity<"agenda.task"> = {
    ...base,
    id: "agenda-task",
    type: "agenda.task",
    localDate: "2026-08-31",
    occurredAtUTC: "2026-08-31T13:00:00.000Z",
    payload: {
      title: "Tarefa explicitamente pendente",
      status: "planned",
      priority: "normal",
      goalTier: unknown(),
      plannedStartLocal: unknown(),
      plannedEndLocal: unknown(),
      actualStartLocal: unknown(),
      actualEndLocal: unknown(),
      dueLocalDate: known("2026-08-31"),
      dueLocalTime: unknown(),
      bufferBeforeMinutes: notApplicable("no_buffer_requested"),
      bufferAfterMinutes: notApplicable("no_buffer_requested"),
      note: unknown(),
    },
  };
  return [first, second, task];
}

function metric(
  snapshot: ReturnType<typeof buildDashboardSnapshot>,
  domain: Domain,
  key: string,
): AnalyticsMetric {
  const result = snapshot.domains[domain].metrics.find((item) => item.key === key);
  if (!result) throw new Error(`Missing ${domain}.${key}`);
  return result;
}

test("builds only supported inclusive civil-day windows with honest empty coverage", () => {
  const snapshot = buildDashboardSnapshot([], {
    endLocalDate: "2024-03-01",
    days: 7,
    datasetId: DATASET_A,
  });

  expect(snapshot.window).toEqual({ start: "2024-02-24", end: "2024-03-01", days: 7 });
  expect(snapshot.entityCount).toBe(0);
  expect(snapshot.dayCoverage).toMatchObject({
    eligible: 7,
    included: 0,
    unknown: 7,
    invalid: 0,
    confirmedAbsent: 0,
  });
  expect(Object.keys(snapshot.domains)).toEqual([...ANALYTICS_DOMAINS]);
  for (const domain of ANALYTICS_DOMAINS) {
    expect(snapshot.domains[domain].recordCount).toBe(0);
    expect(snapshot.domains[domain].dayCoverage.unknown).toBe(7);
  }
  expect(metric(snapshot, "internato", "scheduled_shifts").value).toBeNull();

  expect(() => buildDashboardSnapshot([], {
    endLocalDate: "2024-03-01",
    days: 14 as 7,
  })).toThrow("7, 30, 60, 180 ou 365");
});

test("keeps notes out of structured metrics while retaining domain and field coverage", () => {
  const note = genericEntity({
    id: "study-note",
    domain: "estudos",
    localDate: "2026-08-31",
    payload: {
      eventKind: "study-note",
      minutes: known(90),
      note: known("Revisar depois"),
      unresolved: unknown("not_recorded"),
      malformed: invalidKnowledge("invalid_fixture"),
    },
  });
  const snapshot = buildDashboardSnapshot([note], {
    endLocalDate: "2026-09-01",
    days: 7,
    datasetId: DATASET_A,
  });

  expect(snapshot.domains.estudos.recordCount).toBe(1);
  expect(snapshot.domains.estudos.recordedDayCount).toBe(1);
  expect(snapshot.domains.estudos.dayCoverage.unknown).toBe(6);
  expect(snapshot.domains.estudos.fieldCoverage.unknown).toBeGreaterThanOrEqual(1);
  expect(snapshot.domains.estudos.fieldCoverage.invalid).toBeGreaterThanOrEqual(1);
  expect(metric(snapshot, "estudos", "focused_minutes")).toMatchObject({
    value: null,
    n: 0,
  });
});

test("derives simple metrics only from explicit usable observations", () => {
  const entities: MentorEntity[] = [
    shiftEntity(),
    medicationEntity(),
    ...canonicalAgendaEntities(),
    genericEntity({
      id: "study-known",
      domain: "estudos",
      localDate: "2026-08-27",
      payload: { eventKind: "study-session", minutes: known(60), completed: known(true) },
    }),
    genericEntity({
      id: "study-unknown",
      domain: "estudos",
      localDate: "2026-08-28",
      payload: { eventKind: "study-session", minutes: unknown(), completed: invalidKnowledge("bad_completion") },
    }),
    genericEntity({
      id: "sleep-known",
      domain: "sono",
      localDate: "2026-08-28",
      payload: {
        eventKind: "sleep-episode",
        sleepStartLocal: known("23:30"),
        sleepEndLocal: known("06:30"),
        perceivedQuality: known("good"),
      },
    }),
    genericEntity({
      id: "sleep-equal-clocks",
      domain: "sono",
      localDate: "2026-08-29",
      payload: {
        eventKind: "sleep-episode",
        sleepStartLocal: known("08:00"),
        sleepEndLocal: known("08:00"),
        perceivedQuality: unknown(),
      },
    }),
    genericEntity({
      id: "nutrition",
      domain: "alimentacao",
      localDate: "2026-08-29",
      payload: {
        eventKind: "nutrition-log",
        meal: { kind: known("Almoço"), timeLocal: known("12:30") },
        waterMl: known(500),
      },
    }),
    genericEntity({
      id: "mood-old",
      domain: "humor",
      localDate: "2026-08-30",
      occurredAtUTC: "2026-08-30T10:00:00.000Z",
      payload: { eventKind: "mood-check-in", mood: 1, scaleVersion: "mood-1-5-v1" },
    }),
    genericEntity({
      id: "mood-latest",
      domain: "humor",
      localDate: "2026-08-30",
      occurredAtUTC: "2026-08-30T12:00:00.000Z",
      payload: { eventKind: "mood-check-in", mood: 5, scaleVersion: "mood-1-5-v1" },
    }),
    genericEntity({
      id: "mood-invalid",
      domain: "humor",
      localDate: "2026-08-31",
      payload: { eventKind: "mood-check-in", mood: 6, scaleVersion: "mood-1-5-v1" },
    }),
    genericEntity({
      id: "energy",
      domain: "humor",
      localDate: "2026-09-01",
      payload: {
        eventKind: "mood-functional-check-in",
        mood: unknown(),
        energy: known(4),
        scaleVersion: "mentor-functional-scales-v1",
      },
    }),
    genericEntity({
      id: "headache-present",
      domain: "cefaleia",
      localDate: "2026-08-31",
      occurredAtUTC: "2026-08-31T10:00:00.000Z",
      payload: {
        eventKind: "headache-check-in",
        presence: known(true),
        intensity: known(7),
        onsetLocal: known("09:00"),
        endedLocal: known("10:30"),
      },
    }),
    genericEntity({
      id: "headache-later-absent",
      domain: "cefaleia",
      localDate: "2026-08-31",
      occurredAtUTC: "2026-08-31T20:00:00.000Z",
      payload: {
        eventKind: "headache-check-in",
        presence: known(false),
        intensity: notApplicable("headache_confirmed_absent"),
      },
    }),
    genericEntity({
      id: "bruxism",
      domain: "bruxismo",
      localDate: "2026-08-31",
      payload: {
        eventKind: "bruxism-am-pm",
        daytimeClenching: known(true),
        grindingReported: confirmedAbsent("not_reported"),
      },
    }),
    genericEntity({
      id: "income",
      domain: "financas",
      localDate: "2026-08-28",
      payload: {
        eventKind: "financial-movement",
        movementKind: known("income"),
        amount: known({ amountMinor: 100_00, currency: "BRL" }),
      },
    }),
    genericEntity({
      id: "expense",
      domain: "financas",
      localDate: "2026-08-29",
      payload: {
        eventKind: "financial-movement",
        movementKind: known("expense"),
        amount: known({ amountMinor: 20_00, currency: "BRL" }),
      },
    }),
    genericEntity({
      id: "debt",
      domain: "financas",
      localDate: "2026-08-30",
      payload: {
        eventKind: "financial-movement",
        movementKind: known("debt"),
        amount: known({ amountMinor: 500_00, currency: "BRL" }),
      },
    }),
    genericEntity({
      id: "bill",
      domain: "financas",
      localDate: "2026-08-31",
      payload: {
        eventKind: "financial-movement",
        movementKind: known("bill"),
        amount: known({ amountMinor: 30_00, currency: "BRL" }),
      },
    }),
    genericEntity({
      id: "routine",
      domain: "rotina",
      localDate: "2026-09-01",
      payload: { eventKind: "routine-day-plan", anchors: [], tasks: [] },
    }),
  ];

  const snapshot = buildDashboardSnapshot(entities, {
    endLocalDate: "2026-09-01",
    days: 7,
    datasetId: DATASET_A,
  });

  expect(metric(snapshot, "estudos", "focused_minutes")).toMatchObject({ value: 60, n: 1, missing: 1 });
  expect(metric(snapshot, "estudos", "completed_sessions")).toMatchObject({ value: 1, n: 1, missing: 1 });
  expect(metric(snapshot, "sono", "sleep_duration_average_minutes")).toMatchObject({ value: 420, n: 1, missing: 1 });
  expect(metric(snapshot, "sono", "sleep_quality_average")).toMatchObject({ value: 3, n: 1, missing: 1 });
  expect(metric(snapshot, "alimentacao", "meals_recorded").value).toBe(1);
  expect(metric(snapshot, "alimentacao", "water_entries").value).toBe(1);
  expect(metric(snapshot, "alimentacao", "water_recorded_ml").value).toBe(500);
  // The displayed fallback is the legacy 1–5 mood series, so its missingness
  // must not absorb an empty field from the separate functional −2…+2 series.
  expect(metric(snapshot, "humor", "mood_average")).toMatchObject({ value: 5, n: 1, missing: 1 });
  expect(metric(snapshot, "humor", "mood_legacy_average_1_5")).toMatchObject({ value: 5, n: 1, missing: 1 });
  expect(metric(snapshot, "humor", "mood_functional_average_minus2_plus2")).toMatchObject({ value: null, n: 0, missing: 1 });
  expect(metric(snapshot, "humor", "energy_average")).toMatchObject({ value: 4, n: 1 });
  expect(metric(snapshot, "humor", "energy_functional_average_0_4")).toMatchObject({ value: 4, n: 1, missing: 0 });
  expect(metric(snapshot, "cefaleia", "headache_days").value).toBe(1);
  expect(metric(snapshot, "cefaleia", "headache_intensity_average").value).toBe(7);
  expect(metric(snapshot, "cefaleia", "headache_duration_median_minutes").value).toBe(90);
  expect(metric(snapshot, "bruxismo", "bruxism_episodes").value).toBe(1);
  expect(metric(snapshot, "financas", "income_minor").value).toBe(100_00);
  expect(metric(snapshot, "financas", "expense_minor").value).toBe(20_00);
  expect(metric(snapshot, "financas", "net_flow_minor").value).toBe(80_00);
  expect(metric(snapshot, "financas", "debt_recorded_minor").value).toBe(500_00);
  expect(metric(snapshot, "financas", "bill_recorded_minor").value).toBe(30_00);
  expect(metric(snapshot, "rotina", "routine_records").value).toBe(1);
  expect(metric(snapshot, "internato", "scheduled_shifts").value).toBe(1);
  expect(metric(snapshot, "internato", "actual_attendance_known").value).toBe(1);
  expect(metric(snapshot, "internato", "worked_minutes")).toMatchObject({ value: null, n: 0, missing: 1 });
  expect(metric(snapshot, "internato", "night_minutes")).toMatchObject({ value: 0, n: 1 });
  expect(metric(snapshot, "medicamentos", "dose_confirmations").value).toBe(1);
  expect(metric(snapshot, "agenda", "commitments").value).toBe(2);
  expect(metric(snapshot, "agenda", "committed_minutes").value).toBe(110);
  expect(metric(snapshot, "agenda", "buffer_shortfalls")).toMatchObject({ value: 1, n: 1 });
  expect(metric(snapshot, "agenda", "overdue_tasks")).toMatchObject({ value: 1, n: 1 });
  expect(metric(snapshot, "agenda", "tasks_without_next_action")).toMatchObject({ value: null, n: 0 });
});

test("archive uses an exact 365-day civil window, dataset isolation, canonical revisions and stable civil chronology", () => {
  const entities: MentorEntity[] = [
    genericEntity({
      id: "at-start",
      domain: "rotina",
      localDate: "2025-09-02",
      occurredAtUTC: "2025-09-03T01:00:00.000Z",
      payload: { eventKind: "routine-note" },
    }),
    genericEntity({
      id: "before-start",
      domain: "rotina",
      localDate: "2025-09-01",
      payload: { eventKind: "routine-note" },
    }),
    genericEntity({
      id: "same-day-earlier",
      domain: "humor",
      localDate: "2026-09-01",
      occurredAtUTC: "2026-09-01T10:00:00.000Z",
      payload: { eventKind: known("mood-check-in") },
    }),
    genericEntity({
      id: "unknown-kind",
      domain: "conhecimento",
      localDate: "2026-09-01",
      occurredAtUTC: "2026-09-01T11:00:00.000Z",
      payload: { eventKind: unknown() },
    }),
    genericEntity({
      id: "revised",
      domain: "estudos",
      localDate: "2026-08-31",
      revision: 1,
      payload: { eventKind: "study-note", note: known("old") },
    }),
    genericEntity({
      id: "revised",
      domain: "estudos",
      localDate: "2026-08-31",
      revision: 2,
      occurredAtUTC: "2026-08-31T13:00:00.000Z",
      payload: { eventKind: "study-note", note: known("new") },
    }),
    genericEntity({
      id: "deleted",
      domain: "rotina",
      localDate: "2026-09-01",
      status: "deleted",
      payload: { eventKind: "routine-note" },
    }),
    genericEntity({
      id: "future",
      domain: "rotina",
      localDate: "2026-09-02",
      payload: { eventKind: "routine-note" },
    }),
    genericEntity({
      id: "other-dataset",
      datasetId: "dataset-b",
      domain: "rotina",
      localDate: "2026-09-01",
      payload: { eventKind: "routine-note" },
    }),
  ];

  const snapshot = buildArchiveSnapshot(entities, "2026-09-01", {
    datasetId: DATASET_A,
  });

  expect(snapshot.window).toEqual({ start: "2025-09-02", end: "2026-09-01", days: 365 });
  expect(snapshot.events.map((event) => event.id)).toEqual([
    "at-start",
    "revised",
    "same-day-earlier",
    "unknown-kind",
  ]);
  expect(snapshot.events.find((event) => event.id === "revised")?.revision).toBe(2);
  expect(snapshot.events.find((event) => event.id === "same-day-earlier")?.eventKind).toBe("mood-check-in");
  expect(snapshot.events.find((event) => event.id === "unknown-kind")).toMatchObject({
    eventKind: null,
    eventKindState: "unknown",
  });
});
