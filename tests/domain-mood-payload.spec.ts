import { expect, test } from "@playwright/test";
import {
  buildMoodFunctionalPayload,
  type MoodFunctionalDraft,
  type MoodFunctionalPayloadV1,
} from "../src/features/moodPayload";

function draft(
  patch: Partial<MoodFunctionalDraft> = {},
): MoodFunctionalDraft {
  return {
    metrics: {
      mood: null,
      energy: null,
      anxiety: null,
      irritability: null,
      impulsivity: null,
      thoughtSpeed: null,
      function: null,
    },
    perceivedSleepNeed: null,
    perceivedBaselineChange: null,
    protectiveFactors: [],
    protectiveFactorsNote: "",
    medicationChangeConfirmed: null,
    medicationChangeNote: "",
    safeNow: null,
    context: "",
    ...patch,
  };
}

test("MoodForm payload contract emits v2 and preserves unanswered as unknown", () => {
  const payload = buildMoodFunctionalPayload(draft());

  expect(payload.schema).toBe("mood-functional-check-in-v2");
  expect(payload.perceivedSleepNeed).toMatchObject({ state: "unknown" });
  expect(payload.perceivedBaselineChange).toMatchObject({ state: "unknown" });
  expect(payload.medicationChangeConfirmed).toEqual({ state: "unknown", reason: "not_confirmed" });
  expect(payload.medicationChangeNote).toEqual({ state: "unknown", reason: "not_confirmed" });
  expect(payload.safeNow).toEqual({ state: "unknown", reason: "not_confirmed" });
});

test("MoodForm payload contract keeps explicit true and false as factual booleans", () => {
  const confirmed = buildMoodFunctionalPayload(draft({
    medicationChangeConfirmed: true,
    medicationChangeNote: "  mudança informada  ",
    safeNow: true,
  }));
  expect(confirmed.medicationChangeConfirmed).toMatchObject({ state: "known", value: true });
  expect(confirmed.medicationChangeNote).toMatchObject({ state: "known", value: "mudança informada" });
  expect(confirmed.safeNow).toMatchObject({ state: "known", value: true });

  const denied = buildMoodFunctionalPayload(draft({
    medicationChangeConfirmed: false,
    medicationChangeNote: "não deve persistir",
    safeNow: false,
  }));
  expect(denied.medicationChangeConfirmed).toMatchObject({ state: "known", value: false });
  expect(denied.medicationChangeNote).toEqual({
    state: "not_applicable",
    reasonCode: "no_medication_change_reported",
  });
  expect(denied.safeNow).toMatchObject({ state: "known", value: false });
});

test("MoodForm payload contract rejects enum tokens outside the v2 vocabulary", () => {
  const payload = buildMoodFunctionalPayload(draft({
    perceivedSleepNeed: "internal-token" as MoodFunctionalDraft["perceivedSleepNeed"],
    perceivedBaselineChange: "internal-token" as MoodFunctionalDraft["perceivedBaselineChange"],
  }));

  expect(payload.perceivedSleepNeed).toEqual({
    state: "invalid",
    issueCodes: ["enum_not_supported"],
  });
  expect(payload.perceivedBaselineChange).toEqual({
    state: "invalid",
    issueCodes: ["enum_not_supported"],
  });
});

test("historical v1 payload remains valid without v2 contextual fields", () => {
  const historical: MoodFunctionalPayloadV1 = {
    schema: "mood-functional-check-in-v1",
    eventKind: "mood-functional-check-in",
    scaleVersion: "mentor-functional-scales-v1",
    mood: { state: "known", value: 0, source: "user" },
    energy: { state: "unknown", reason: "not_recorded" },
    anxiety: { state: "unknown", reason: "not_recorded" },
    irritability: { state: "unknown", reason: "not_recorded" },
    impulsivity: { state: "unknown", reason: "not_recorded" },
    thoughtSpeed: { state: "unknown", reason: "not_recorded" },
    function: { state: "unknown", reason: "not_recorded" },
    context: { state: "unknown", reason: "not_recorded" },
  };

  expect(historical.schema).toBe("mood-functional-check-in-v1");
  expect("safeNow" in historical).toBe(false);
});
