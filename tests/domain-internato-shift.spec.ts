import { expect, test } from "@playwright/test";
import {
  buildAnalyticsReport,
  buildArchiveSnapshot,
  buildManualShiftPayload,
  draftFromShift,
  emptyManualShiftDraft,
  planManualShiftCreation,
  planShiftUpdate,
  selectDefaultShiftId,
  type LocalDate,
  type MentorEntity,
  type ShiftActualDraft,
} from "../src/domain";
import { known, unknown } from "../src/domain/model";

function makeShift(options: {
  id?: string;
  localDate?: LocalDate;
  start?: `${LocalDate}T${string}`;
  end?: `${LocalDate}T${string}`;
} = {}): MentorEntity<"internato.shift"> {
  const localDate = options.localDate ?? "2026-09-03";
  const timestamp = "2026-09-01T00:00:00.000Z";
  return {
    id: options.id ?? "shift-night",
    datasetId: "dataset-bauer-primary",
    domain: "internato",
    type: "internato.shift",
    localDate,
    occurredAtUTC: timestamp,
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision: 1,
    source: "seed",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    payload: {
      scheduleState: "confirmed_planned",
      scheduledStartLocal: options.start ?? "2026-09-03T19:00:00",
      scheduledEndLocal: options.end ?? "2026-09-04T07:00:00",
      assignment: known("Internato", "confirmed_schedule"),
      location: unknown("not_confirmed"),
      attendance: unknown("not_recorded"),
      arrivalLocal: unknown("not_recorded"),
      departureLocal: unknown("not_recorded"),
      breakStartLocal: unknown("not_recorded"),
      breakEndLocal: unknown("not_recorded"),
    },
  };
}

test.describe("plano de atualização da jornada", () => {
  test("não transforma campos vazios intocados em ausência ou zero", () => {
    const shift = makeShift();
    const draft = draftFromShift(shift);
    const result = planShiftUpdate(shift, draft);

    expect(result.errors).toEqual([]);
    expect(result.changedFields).toEqual([]);
    expect(result.patch).toEqual({});
  });

  test("mantém horário de relógio para o repositório resolver o plantão noturno", () => {
    const shift = makeShift();
    const draft: ShiftActualDraft = {
      ...draftFromShift(shift),
      attendance: "present",
      arrival: "18:55",
      departure: "06:45",
      breakMode: "timed",
      breakStart: "23:30",
      breakEnd: "00:10",
    };
    const result = planShiftUpdate(shift, draft);

    expect(result.errors).toEqual([]);
    expect(result.patch).toEqual({
      attendance: "present",
      arrivalLocal: "18:55",
      departureLocal: "06:45",
      breakStartLocal: "23:30",
      breakEndLocal: "00:10",
    });
    expect(shift.payload.scheduledStartLocal).toBe("2026-09-03T19:00:00");
    expect(shift.payload.scheduledEndLocal).toBe("2026-09-04T07:00:00");
  });

  test("confirma falta sem apagar nem reescrever o planejamento", () => {
    const shift = makeShift();
    const result = planShiftUpdate(shift, {
      ...draftFromShift(shift),
      attendance: "absent_confirmed",
    });

    expect(result.patch.attendance).toBe("absent_confirmed");
    expect(result.patch.arrivalLocal).toEqual({
      state: "not_applicable",
      reasonCode: "attendance_absent_confirmed",
    });
    expect(result.patch.departureLocal).toEqual({
      state: "not_applicable",
      reasonCode: "attendance_absent_confirmed",
    });
    expect(shift.payload.scheduleState).toBe("confirmed_planned");
    expect(shift.payload.scheduledStartLocal).toBe("2026-09-03T19:00:00");
  });

  test("distingue sem intervalo confirmado de intervalo desconhecido", () => {
    const shift = makeShift();
    const noBreak = planShiftUpdate(shift, {
      ...draftFromShift(shift),
      attendance: "present",
      breakMode: "none_confirmed",
    });

    expect(noBreak.patch.breakStartLocal).toEqual({
      state: "not_applicable",
      reasonCode: "no_break_confirmed",
    });
    expect(noBreak.patch.breakEndLocal).toEqual({
      state: "not_applicable",
      reasonCode: "no_break_confirmed",
    });

    const persistedNoBreak = makeShift();
    persistedNoBreak.payload.attendance = known("present");
    persistedNoBreak.payload.breakStartLocal = {
      state: "not_applicable",
      reasonCode: "no_break_confirmed",
    };
    persistedNoBreak.payload.breakEndLocal = {
      state: "not_applicable",
      reasonCode: "no_break_confirmed",
    };
    const unknownAgain = planShiftUpdate(persistedNoBreak, {
      ...draftFromShift(persistedNoBreak),
      breakMode: "unknown",
    });
    expect(unknownAgain.patch.breakStartLocal).toEqual({
      state: "unknown",
      reason: "not_recorded",
    });
    expect(unknownAgain.patch.breakEndLocal).toEqual({
      state: "unknown",
      reason: "not_recorded",
    });
  });
});

test.describe("seleção da jornada atual", () => {
  test("reconhece o segundo dia de um plantão noturno", () => {
    const night = makeShift();
    const later = makeShift({
      id: "shift-later",
      localDate: "2026-09-05",
      start: "2026-09-05T19:00:00",
      end: "2026-09-06T07:00:00",
    });
    expect(selectDefaultShiftId([later, night], "2026-09-04")).toBe(night.id);
  });

  test("prefere a seleção explícita e depois a próxima jornada", () => {
    const first = makeShift({
      id: "shift-first",
      localDate: "2026-09-03",
      start: "2026-09-03T19:00:00",
      end: "2026-09-04T07:00:00",
    });
    const next = makeShift({
      id: "shift-next",
      localDate: "2026-09-05",
      start: "2026-09-05T19:00:00",
      end: "2026-09-06T07:00:00",
    });

    expect(selectDefaultShiftId([first, next], "2026-09-01", next.id)).toBe(next.id);
    expect(selectDefaultShiftId([first, next], "2026-09-01")).toBe(first.id);
  });
});

test.describe("criação manual de jornadas", () => {
  test("cria jornada confirmada além de setembro sem inventar dados opcionais ou realizados", () => {
    const plan = planManualShiftCreation({
      ...emptyManualShiftDraft("2026-10-05"),
      startTimeLocal: "07:00",
      endTimeLocal: "19:00",
    });

    expect(plan.errors).toEqual([]);
    expect(plan.input).toEqual({
      localDate: "2026-10-05",
      startTimeLocal: "07:00",
      endTimeLocal: "19:00",
      endsNextDay: false,
      scheduleState: "confirmed_planned",
    });

    const timestamp = "2026-09-01T12:00:00.000Z";
    const payload = buildManualShiftPayload(plan.input!, timestamp);
    expect(payload.scheduledStartLocal).toBe("2026-10-05T07:00");
    expect(payload.scheduledEndLocal).toBe("2026-10-05T19:00");
    expect(payload.assignment).toEqual({ state: "unknown", reason: "not_recorded" });
    expect(payload.location).toEqual({ state: "unknown", reason: "not_recorded" });
    expect(payload.attendance).toEqual({ state: "unknown", reason: "not_recorded" });
    expect(payload.arrivalLocal).toEqual({ state: "unknown", reason: "not_recorded" });
    expect(payload.departureLocal).toEqual({ state: "unknown", reason: "not_recorded" });
    expect(payload.breakStartLocal).toEqual({ state: "unknown", reason: "not_recorded" });
    expect(payload.breakEndLocal).toEqual({ state: "unknown", reason: "not_recorded" });

    const entity: MentorEntity<"internato.shift"> = {
      id: "shift-manual-october",
      datasetId: "dataset-bauer-primary",
      domain: "internato",
      type: "internato.shift",
      localDate: plan.input!.localDate,
      occurredAtUTC: timestamp,
      timezone: "America/Sao_Paulo",
      schemaVersion: 1,
      revision: 1,
      source: "manual",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      payload,
    };
    const archive = buildArchiveSnapshot([entity], "2026-10-05");
    const analytics = buildAnalyticsReport([entity], {
      endLocalDate: "2026-10-05",
      days: 60,
    });
    const scheduledMetric = analytics.domains.internato.metrics.find(
      (metric) => metric.key === "scheduled_shifts",
    );

    expect(archive.events).toHaveLength(1);
    expect(archive.events[0]).toMatchObject({
      id: entity.id,
      type: "internato.shift",
      source: "manual",
    });
    expect(scheduledMetric).toMatchObject({ value: 1, n: 1 });
  });

  test("preserva tentativa, setor e local em um plantão que termina no dia seguinte", () => {
    const plan = planManualShiftCreation({
      ...emptyManualShiftDraft("2026-11-14"),
      startTimeLocal: "19:00",
      endTimeLocal: "07:00",
      endsNextDay: true,
      scheduleState: "tentative",
      assignment: "  Centro obstétrico  ",
      location: "  Hospital Escola  ",
    });

    expect(plan.errors).toEqual([]);
    expect(plan.input).toMatchObject({
      scheduleState: "tentative",
      assignment: "Centro obstétrico",
      location: "Hospital Escola",
    });
    const payload = buildManualShiftPayload(
      plan.input!,
      "2026-09-01T12:00:00.000Z",
    );
    expect(payload.scheduledStartLocal).toBe("2026-11-14T19:00");
    expect(payload.scheduledEndLocal).toBe("2026-11-15T07:00");
    expect(payload.assignment).toMatchObject({ state: "known", value: "Centro obstétrico" });
    expect(payload.location).toMatchObject({ state: "known", value: "Hospital Escola" });
  });

  test("exige fim posterior ao início e não infere automaticamente o dia seguinte", () => {
    const equal = planManualShiftCreation({
      ...emptyManualShiftDraft("2026-10-05"),
      startTimeLocal: "07:00",
      endTimeLocal: "07:00",
    });
    const backwards = planManualShiftCreation({
      ...emptyManualShiftDraft("2026-10-05"),
      startTimeLocal: "19:00",
      endTimeLocal: "07:00",
      endsNextDay: false,
    });

    expect(equal.input).toBeNull();
    expect(equal.errors).toContain("O fim da jornada precisa ser posterior ao início.");
    expect(backwards.input).toBeNull();
    expect(backwards.errors).toContain("O fim da jornada precisa ser posterior ao início.");
  });
});
