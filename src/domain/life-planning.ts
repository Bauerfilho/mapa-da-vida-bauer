export interface StudyEvidenceInput {
  plannedMinutes: number | null;
  actualMinutes: number | null;
  attemptedQuestions: number | null;
  correctQuestions: number | null;
  reviewDue: boolean | null;
}

export interface StudyEvidenceSummary {
  plannedMinutes: number | null;
  actualMinutes: number | null;
  estimateDeltaMinutes: number | null;
  questionAccuracyPercent: number | null;
  questionCount: number;
  reviewsDue: number | null;
}

export interface RoutineBlockEvidenceInput {
  plannedMinutes: number | null;
  actualMinutes: number | null;
  completed: boolean | null;
  replanned: boolean | null;
}

export interface RoutineEvidenceSummary {
  plannedMinutes: number | null;
  actualMinutes: number | null;
  estimateDeltaMinutes: number | null;
  completionPercent: number | null;
  completionCount: number;
  replannedBlocks: number | null;
}

function safeSum(values: readonly number[]): number | null {
  if (!values.length) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) {
    throw new Error("A soma de minutos ultrapassou o limite inteiro seguro.");
  }
  return total;
}

function validMinutes(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

export function summarizeStudyEvidence(
  inputs: readonly StudyEvidenceInput[],
): StudyEvidenceSummary {
  const planned = inputs.flatMap((input) =>
    validMinutes(input.plannedMinutes) ? [input.plannedMinutes] : [],
  );
  const actual = inputs.flatMap((input) =>
    validMinutes(input.actualMinutes) ? [input.actualMinutes] : [],
  );
  const comparableDurations = inputs.flatMap((input) =>
    validMinutes(input.plannedMinutes) && validMinutes(input.actualMinutes)
      ? [input.actualMinutes - input.plannedMinutes]
      : [],
  );
  const validQuestionPairs = inputs.flatMap((input) => {
    if (
      !validMinutes(input.attemptedQuestions) ||
      !validMinutes(input.correctQuestions) ||
      input.correctQuestions > input.attemptedQuestions
    ) {
      return [];
    }
    return [{ attempted: input.attemptedQuestions, correct: input.correctQuestions }];
  });
  const attempted = validQuestionPairs.reduce(
    (sum, pair) => sum + pair.attempted,
    0,
  );
  const correct = validQuestionPairs.reduce((sum, pair) => sum + pair.correct, 0);
  const reviewStates = inputs.flatMap((input) =>
    input.reviewDue === null ? [] : [input.reviewDue],
  );

  return {
    plannedMinutes: safeSum(planned),
    actualMinutes: safeSum(actual),
    estimateDeltaMinutes: safeSum(comparableDurations),
    questionAccuracyPercent: attempted > 0 ? (correct / attempted) * 100 : null,
    questionCount: attempted,
    reviewsDue: reviewStates.length
      ? reviewStates.filter(Boolean).length
      : null,
  };
}

export function summarizeRoutineEvidence(
  inputs: readonly RoutineBlockEvidenceInput[],
): RoutineEvidenceSummary {
  const planned = inputs.flatMap((input) =>
    validMinutes(input.plannedMinutes) ? [input.plannedMinutes] : [],
  );
  const actual = inputs.flatMap((input) =>
    validMinutes(input.actualMinutes) ? [input.actualMinutes] : [],
  );
  const comparableDurations = inputs.flatMap((input) =>
    validMinutes(input.plannedMinutes) && validMinutes(input.actualMinutes)
      ? [input.actualMinutes - input.plannedMinutes]
      : [],
  );
  const completed = inputs.flatMap((input) =>
    input.completed === null ? [] : [input.completed],
  );
  const replanned = inputs.flatMap((input) =>
    input.replanned === null ? [] : [input.replanned],
  );

  return {
    plannedMinutes: safeSum(planned),
    actualMinutes: safeSum(actual),
    estimateDeltaMinutes: safeSum(comparableDurations),
    completionPercent: completed.length
      ? (completed.filter(Boolean).length / completed.length) * 100
      : null,
    completionCount: completed.length,
    replannedBlocks: replanned.length
      ? replanned.filter(Boolean).length
      : null,
  };
}

/**
 * Calculates a clock interval only after the caller explicitly states whether
 * it crosses midnight. Empty or incomplete pairs stay unknown (`null`).
 */
export function explicitClockSpanMinutes(
  start: string,
  end: string,
  crossesMidnight: boolean,
): number | null {
  const pattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!start && !end) return null;
  if (!pattern.test(start) || !pattern.test(end)) {
    throw new Error("Início e fim precisam usar HH:mm.");
  }
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const startTotal = startHour * 60 + startMinute;
  const rawEnd = endHour * 60 + endMinute;
  const endTotal = crossesMidnight ? rawEnd + 1_440 : rawEnd;
  if (endTotal < startTotal) {
    throw new Error("Marque que o bloco cruza a meia-noite ou corrija o fim.");
  }
  return endTotal - startTotal;
}
