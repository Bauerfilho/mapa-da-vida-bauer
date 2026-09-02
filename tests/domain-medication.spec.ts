import { expect, test } from "@playwright/test";
import {
  buildMedicationTrail,
  calculateMedicationTiming,
  isCanonicalMedicationRegimen,
  known,
  unknown,
  type CanonicalMedicationRegimenEntity,
  type LocalDate,
  type MentorEntity,
} from "../src/domain";

const DATE = "2026-09-01" as LocalDate;
const DATASET_ID = "dataset-medication-test";

function regimen(): CanonicalMedicationRegimenEntity {
  const timestamp = "2026-09-01T10:00:00.000Z";
  return {
    id: "regimen-1",
    datasetId: DATASET_ID,
    domain: "medicamentos",
    type: "generic.event",
    localDate: DATE,
    occurredAtUTC: timestamp,
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision: 1,
    source: "manual",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    payload: {
      schema: "medication-regimen-v2",
      eventKind: "medication-regimen",
      medicationName: known("Medicamento informado"),
      doseLabel: known("dose informada"),
      scheduledTimesLocal: known(["08:00", "20:00"]),
      status: "active_confirmed",
      activeFromLocalDate: known(DATE),
      activeThroughLocalDate: unknown("not_provided"),
      note: unknown(),
    },
  };
}

function doseEvent(
  confirmation: "taken_time_recorded" | "taken_time_unknown" | "skipped_confirmed",
  scheduledTimeLocal = "08:00" as const,
  actualTimeLocal?: "08:13",
): MentorEntity<"medicamentos.confirmation"> {
  const timestamp = "2026-09-01T11:13:00.000Z";
  return {
    id: `dose-${confirmation}`,
    datasetId: DATASET_ID,
    domain: "medicamentos",
    type: "medicamentos.confirmation",
    localDate: DATE,
    occurredAtUTC: timestamp,
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision: 1,
    source: "manual",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    payload: {
      regimenId: known("regimen-1"),
      medicationName: known("Medicamento informado"),
      doseLabel: known("dose informada"),
      scheduledTimeLocal: known(scheduledTimeLocal),
      actualTimeLocal: actualTimeLocal ? known(actualTimeLocal) : unknown(),
      confirmation,
      note: unknown(),
    },
  };
}

test.describe("medication timing truth", () => {
  test("does not classify delay without both planned and actual clocks", () => {
    expect(calculateMedicationTiming(undefined, "08:10")).toEqual({
      state: "unavailable",
      reason: "planned_missing",
    });
    expect(calculateMedicationTiming("08:00", undefined)).toEqual({
      state: "unavailable",
      reason: "actual_missing",
    });
  });

  test("derives a real signed delta only from two clocks", () => {
    expect(calculateMedicationTiming("08:00", "08:13")).toEqual({
      state: "known",
      deltaMinutes: 13,
      relation: "late",
    });
    expect(calculateMedicationTiming("23:55", "00:05")).toEqual({
      state: "known",
      deltaMinutes: 10,
      relation: "late",
    });
  });
});

test.describe("canonical medication trail", () => {
  test("recognizes only a complete structured regimen", () => {
    const entity = regimen();
    expect(isCanonicalMedicationRegimen(entity)).toBe(true);
    expect(isCanonicalMedicationRegimen({
      ...entity,
      payload: { ...entity.payload, scheduledTimesLocal: unknown() },
    })).toBe(false);
  });

  test("keeps a silent slot as absence of event, never as a skipped dose", () => {
    const trail = buildMedicationTrail([regimen()], [], DATE);
    expect(trail.slots).toHaveLength(2);
    expect(trail.slots[0].state).toBe("not_recorded");
    expect(trail.slots[0].event).toBeNull();
    expect(trail.slots[1].state).toBe("not_recorded");
    expect(trail.unlinkedDoseEvents).toEqual([]);
  });

  test("links the confirmation to regimen and exact planned clock", () => {
    const trail = buildMedicationTrail(
      [regimen()],
      [doseEvent("taken_time_recorded", "08:00", "08:13")],
      DATE,
    );
    expect(trail.slots[0].state).toBe("taken_time_recorded");
    expect(trail.slots[0].event?.payload.regimenId).toEqual(known("regimen-1"));
    expect(trail.slots[0].event?.payload.doseLabel).toEqual(known("dose informada"));
    expect(trail.slots[0].timing).toEqual({
      state: "known",
      deltaMinutes: 13,
      relation: "late",
    });
    expect(trail.slots[1].state).toBe("not_recorded");
  });

  test("preserves taken-without-time and confirmed-skip as distinct facts", () => {
    const taken = buildMedicationTrail(
      [regimen()],
      [doseEvent("taken_time_unknown")],
      DATE,
    );
    expect(taken.slots[0].state).toBe("taken_time_unknown");
    expect(taken.slots[0].timing).toEqual({
      state: "unavailable",
      reason: "actual_missing",
    });

    const skipped = buildMedicationTrail(
      [regimen()],
      [doseEvent("skipped_confirmed")],
      DATE,
    );
    expect(skipped.slots[0].state).toBe("skipped_confirmed");
    expect(skipped.slots[0].event).not.toBeNull();
  });

  test("does not guess a regimen for a legacy or unlinked confirmation", () => {
    const event = doseEvent("taken_time_unknown");
    const unlinked: MentorEntity<"medicamentos.confirmation"> = {
      ...event,
      id: "legacy-dose",
      payload: { ...event.payload, regimenId: undefined },
    };
    const trail = buildMedicationTrail([regimen()], [unlinked], DATE);
    expect(trail.slots[0].state).toBe("not_recorded");
    expect(trail.unlinkedDoseEvents.map((item) => item.id)).toEqual(["legacy-dose"]);
  });
});
