import {
  invalidKnowledge,
  known,
  notApplicable,
  unknown,
  type GenericPayload,
  type Knowledge,
} from "../domain";

export type MoodMetricKey =
  | "mood"
  | "energy"
  | "anxiety"
  | "irritability"
  | "impulsivity"
  | "thoughtSpeed"
  | "function";

export type MoodMetricState = Record<MoodMetricKey, number | null>;
export type PerceivedSleepNeed = "less_than_usual" | "usual" | "more_than_usual";
export type PerceivedBaselineChange =
  | "below_usual"
  | "usual"
  | "above_usual"
  | "different_unclear";

interface MoodFunctionalCore extends GenericPayload {
  eventKind: "mood-functional-check-in";
  scaleVersion: "mentor-functional-scales-v1";
  mood: Knowledge<number>;
  energy: Knowledge<number>;
  anxiety: Knowledge<number>;
  irritability: Knowledge<number>;
  impulsivity: Knowledge<number>;
  thoughtSpeed: Knowledge<number>;
  function: Knowledge<number>;
  context: Knowledge<string>;
}

/** Historical records did not contain the contextual and safety fields. */
export type MoodFunctionalPayloadV1 = MoodFunctionalCore & {
  schema: "mood-functional-check-in-v1";
};

/** New records keep every optional answer as an explicit Knowledge state. */
export type MoodFunctionalPayloadV2 = MoodFunctionalCore & {
  schema: "mood-functional-check-in-v2";
  perceivedSleepNeed: Knowledge<PerceivedSleepNeed>;
  perceivedBaselineChange: Knowledge<PerceivedBaselineChange>;
  protectiveFactors: Knowledge<string[]>;
  protectiveFactorsNote: Knowledge<string>;
  medicationChangeConfirmed: Knowledge<boolean>;
  medicationChangeNote: Knowledge<string>;
  safeNow: Knowledge<boolean>;
};

export type MoodFunctionalPayload = MoodFunctionalPayloadV1 | MoodFunctionalPayloadV2;

export interface MoodFunctionalDraft {
  metrics: MoodMetricState;
  perceivedSleepNeed: PerceivedSleepNeed | null;
  perceivedBaselineChange: PerceivedBaselineChange | null;
  protectiveFactors: readonly string[];
  protectiveFactorsNote: string;
  medicationChangeConfirmed: boolean | null;
  medicationChangeNote: string;
  safeNow: boolean | null;
  context: string;
}

function scale(value: number | null, minimum: number, maximum: number): Knowledge<number> {
  if (value === null) return unknown("not_recorded");
  return Number.isFinite(value) && value >= minimum && value <= maximum
    ? known(value)
    : invalidKnowledge("scale_out_of_range");
}

function text(value: string): Knowledge<string> {
  const cleaned = value.trim();
  return cleaned ? known(cleaned) : unknown("not_recorded");
}

function list(values: readonly string[]): Knowledge<string[]> {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  return cleaned.length ? known(cleaned) : unknown("not_recorded");
}

function explicitBoolean(value: boolean | null): Knowledge<boolean> {
  return value === null ? unknown("not_confirmed") : known(value);
}

function enumKnowledge<T extends string>(
  value: T | null,
  allowed: readonly T[],
): Knowledge<T> {
  if (value === null) return unknown("not_recorded");
  return allowed.includes(value) ? known(value) : invalidKnowledge("enum_not_supported");
}

/** Pure serialization contract used by MoodForm and by non-browser tests. */
export function buildMoodFunctionalPayload(
  draft: MoodFunctionalDraft,
): MoodFunctionalPayloadV2 {
  return {
    schema: "mood-functional-check-in-v2",
    eventKind: "mood-functional-check-in",
    scaleVersion: "mentor-functional-scales-v1",
    mood: scale(draft.metrics.mood, -2, 2),
    energy: scale(draft.metrics.energy, 0, 4),
    anxiety: scale(draft.metrics.anxiety, 0, 4),
    irritability: scale(draft.metrics.irritability, 0, 4),
    impulsivity: scale(draft.metrics.impulsivity, 0, 4),
    thoughtSpeed: scale(draft.metrics.thoughtSpeed, -2, 2),
    function: scale(draft.metrics.function, 0, 4),
    perceivedSleepNeed: enumKnowledge(
      draft.perceivedSleepNeed,
      ["less_than_usual", "usual", "more_than_usual"] as const,
    ),
    perceivedBaselineChange: enumKnowledge(
      draft.perceivedBaselineChange,
      ["below_usual", "usual", "above_usual", "different_unclear"] as const,
    ),
    protectiveFactors: list(draft.protectiveFactors),
    protectiveFactorsNote: text(draft.protectiveFactorsNote),
    medicationChangeConfirmed: explicitBoolean(draft.medicationChangeConfirmed),
    medicationChangeNote: draft.medicationChangeConfirmed === true
      ? text(draft.medicationChangeNote)
      : draft.medicationChangeConfirmed === false
        ? notApplicable("no_medication_change_reported")
        : unknown("not_confirmed"),
    safeNow: explicitBoolean(draft.safeNow),
    context: text(draft.context),
  };
}
