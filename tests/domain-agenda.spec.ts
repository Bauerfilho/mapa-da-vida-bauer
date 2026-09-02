import { expect, test } from "@playwright/test";
import {
  calculateAgendaConflicts,
  forwardAgendaWindow,
} from "../src/domain/agenda";

test.describe("forwardAgendaWindow", () => {
  test("creates only the supported inclusive 7/30-day windows", () => {
    expect(forwardAgendaWindow("2026-12-28", 7)).toEqual({
      start: "2026-12-28",
      end: "2027-01-03",
      days: 7,
    });
    expect(forwardAgendaWindow("2026-09-01", 30).end).toBe("2026-09-30");
    expect(() => forwardAgendaWindow("2026-09-01", 14 as 7)).toThrow();
  });
});

test.describe("calculateAgendaConflicts", () => {
  test("rejects equal civil times written at different precisions", () => {
    expect(() =>
      calculateAgendaConflicts([
        {
          id: "zero-duration",
          plannedStartLocal: "2026-09-01T09:00",
          plannedEndLocal: "2026-09-01T09:00:00",
        },
      ]),
    ).toThrow();
  });

  test("reports an overlap from planned truth", () => {
    expect(
      calculateAgendaConflicts([
        {
          id: "rounds",
          plannedStartLocal: "2026-09-01T07:00",
          plannedEndLocal: "2026-09-01T09:00",
          bufferAfterMinutes: 15,
        },
        {
          id: "study",
          plannedStartLocal: "2026-09-01T08:40",
          plannedEndLocal: "2026-09-01T10:00",
          bufferBeforeMinutes: 10,
        },
      ]),
    ).toEqual([
      {
        firstId: "rounds",
        secondId: "study",
        kind: "planned_overlap",
        overlapMinutes: 20,
        availableGapMinutes: 0,
        requiredBufferMinutes: 25,
        shortfallMinutes: 45,
      },
    ]);
  });

  test("reports a shortfall when the explicit buffer exceeds the gap", () => {
    expect(
      calculateAgendaConflicts([
        {
          id: "first",
          plannedStartLocal: "2026-09-01T09:00",
          plannedEndLocal: "2026-09-01T10:00",
          bufferAfterMinutes: 20,
        },
        {
          id: "second",
          plannedStartLocal: "2026-09-01T10:10",
          plannedEndLocal: "2026-09-01T11:00",
          bufferBeforeMinutes: 5,
        },
      ]),
    ).toEqual([
      {
        firstId: "first",
        secondId: "second",
        kind: "buffer_shortfall",
        overlapMinutes: 0,
        availableGapMinutes: 10,
        requiredBufferMinutes: 25,
        shortfallMinutes: 15,
      },
    ]);
  });

  test("measures separation shortfall correctly for a nested interval", () => {
    expect(
      calculateAgendaConflicts([
        {
          id: "long",
          plannedStartLocal: "2026-09-01T09:00",
          plannedEndLocal: "2026-09-01T12:00",
        },
        {
          id: "nested",
          plannedStartLocal: "2026-09-01T10:00",
          plannedEndLocal: "2026-09-01T11:00",
        },
      ])[0],
    ).toMatchObject({
      kind: "planned_overlap",
      overlapMinutes: 60,
      shortfallMinutes: 120,
    });
  });

  test("does not coerce an unknown requested buffer to zero", () => {
    expect(
      calculateAgendaConflicts([
        {
          id: "first",
          plannedStartLocal: "2026-09-01T09:00",
          plannedEndLocal: "2026-09-01T10:00",
          bufferAfterMinutes: null,
        },
        {
          id: "second",
          plannedStartLocal: "2026-09-01T09:30",
          plannedEndLocal: "2026-09-01T11:00",
        },
      ])[0],
    ).toMatchObject({
      kind: "planned_overlap",
      overlapMinutes: 30,
      requiredBufferMinutes: null,
      shortfallMinutes: null,
    });
  });

  test("does not invent a buffer and ignores cancelled intervals", () => {
    expect(
      calculateAgendaConflicts([
        {
          id: "first",
          plannedStartLocal: "2026-09-01T09:00",
          plannedEndLocal: "2026-09-01T10:00",
        },
        {
          id: "cancelled",
          plannedStartLocal: "2026-09-01T09:30",
          plannedEndLocal: "2026-09-01T10:30",
          status: "cancelled",
        },
        {
          id: "second",
          plannedStartLocal: "2026-09-01T10:00",
          plannedEndLocal: "2026-09-01T11:00",
        },
      ]),
    ).toEqual([]);
  });
});
