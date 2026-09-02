import { assertLocalDate, shiftLocalDate } from "./dates";
import type { LocalDate } from "./model";

const MILLISECONDS_PER_CIVIL_DAY = 86_400_000;
const TERM_DAYS = 280;
const CONCEPTION_OFFSET_DAYS = 14;
const MAX_SUPPORTED_GESTATIONAL_DAYS = 45 * 7 + 6;

export type ObstetricCalculationErrorCode =
  | "invalid_date"
  | "invalid_number"
  | "invalid_integer"
  | "out_of_range"
  | "negative_gestational_age"
  | "source_date_after_reference"
  | "art_event_after_reference"
  | "gestational_age_out_of_range"
  | "incomplete_input"
  | "invalid_measurement";

export class ObstetricCalculationError extends Error {
  readonly code: ObstetricCalculationErrorCode;
  readonly field?: string;

  constructor(
    code: ObstetricCalculationErrorCode,
    message: string,
    field?: string,
  ) {
    super(message);
    this.name = "ObstetricCalculationError";
    this.code = code;
    this.field = field;
  }
}

function fail(
  code: ObstetricCalculationErrorCode,
  message: string,
  field?: string,
): never {
  throw new ObstetricCalculationError(code, message, field);
}

function validateLocalDate(value: LocalDate, field: string): LocalDate {
  try {
    assertLocalDate(value);
  } catch {
    fail("invalid_date", `${field} must be a valid civil date.`, field);
  }
  return value;
}

function civilUtcMilliseconds(value: LocalDate, field: string): number {
  validateLocalDate(value, field);
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * Counts midnight-to-midnight civil days. The start date is day zero.
 * UTC is used only as a timezone-free calendar coordinate, never as an instant.
 */
export function civilDayDifference(start: LocalDate, end: LocalDate): number {
  return Math.trunc(
    (civilUtcMilliseconds(end, "end") - civilUtcMilliseconds(start, "start")) /
      MILLISECONDS_PER_CIVIL_DAY,
  );
}

function assertFiniteNumber(
  value: number,
  field: string,
  options: { min?: number; max?: number; strictlyPositive?: boolean } = {},
): number {
  if (!Number.isFinite(value)) {
    fail("invalid_number", `${field} must be a finite number.`, field);
  }
  if (options.strictlyPositive && value <= 0) {
    fail("out_of_range", `${field} must be greater than zero.`, field);
  }
  if (options.min !== undefined && value < options.min) {
    fail("out_of_range", `${field} must be at least ${options.min}.`, field);
  }
  if (options.max !== undefined && value > options.max) {
    fail("out_of_range", `${field} must be at most ${options.max}.`, field);
  }
  return value;
}

function assertInteger(
  value: number,
  field: string,
  options: { min?: number; max?: number } = {},
): number {
  assertFiniteNumber(value, field, options);
  if (!Number.isInteger(value)) {
    fail("invalid_integer", `${field} must be an integer.`, field);
  }
  return value;
}

export interface GestationalAge {
  totalDays: number;
  weeks: number;
  days: number;
}

export function gestationalAgeFromDays(totalDays: number): GestationalAge {
  assertInteger(totalDays, "totalDays", { min: 0 });
  return {
    totalDays,
    weeks: Math.floor(totalDays / 7),
    days: totalDays % 7,
  };
}

function assertSupportedGestationalDays(totalDays: number, field: string): number {
  assertInteger(totalDays, field, { min: 0 });
  if (totalDays > MAX_SUPPORTED_GESTATIONAL_DAYS) {
    fail(
      "gestational_age_out_of_range",
      `${field} exceeds the supported range of 45 weeks and 6 days.`,
      field,
    );
  }
  return totalDays;
}

export type PregnancyTrimester = "first" | "second" | "third";

export function classifyPregnancyTrimester(totalDays: number): PregnancyTrimester {
  assertInteger(totalDays, "totalDays", { min: 0 });
  if (totalDays <= 13 * 7 + 6) return "first";
  if (totalDays <= 27 * 7 + 6) return "second";
  return "third";
}

export type GestationalAgeAtBirthCategory =
  | "extremely_preterm"
  | "very_preterm"
  | "moderate_to_late_preterm"
  | "early_term"
  | "full_term"
  | "late_term"
  | "postterm";

/** Classifies gestational age only when the supplied age is the age at birth. */
export function classifyGestationalAgeAtBirth(
  totalDays: number,
): GestationalAgeAtBirthCategory {
  assertInteger(totalDays, "totalDays", { min: 0 });
  if (totalDays < 28 * 7) return "extremely_preterm";
  if (totalDays <= 31 * 7 + 6) return "very_preterm";
  if (totalDays <= 36 * 7 + 6) return "moderate_to_late_preterm";
  if (totalDays <= 38 * 7 + 6) return "early_term";
  if (totalDays <= 40 * 7 + 6) return "full_term";
  if (totalDays <= 41 * 7 + 6) return "late_term";
  return "postterm";
}

export type PregnancyMilestoneId =
  | "week_12"
  | "week_20"
  | "week_24"
  | "third_trimester"
  | "week_32"
  | "week_34"
  | "week_36"
  | "early_term"
  | "full_term"
  | "estimated_due_date"
  | "late_term";

export interface PregnancyMilestone {
  id: PregnancyMilestoneId;
  gestationalAge: GestationalAge;
  date: LocalDate;
}

const PREGNANCY_MILESTONE_DAYS: ReadonlyArray<
  readonly [PregnancyMilestoneId, number]
> = [
  ["week_12", 12 * 7],
  ["week_20", 20 * 7],
  ["week_24", 24 * 7],
  ["third_trimester", 28 * 7],
  ["week_32", 32 * 7],
  ["week_34", 34 * 7],
  ["week_36", 36 * 7],
  ["early_term", 37 * 7],
  ["full_term", 39 * 7],
  ["estimated_due_date", 40 * 7],
  ["late_term", 41 * 7],
];

export function dateAtGestationalAge(
  estimatedDueDate: LocalDate,
  totalDays: number,
): LocalDate {
  validateLocalDate(estimatedDueDate, "estimatedDueDate");
  assertInteger(totalDays, "totalDays", { min: 0 });
  const gestationalDayZero = shiftLocalDate(estimatedDueDate, -TERM_DAYS);
  return shiftLocalDate(gestationalDayZero, totalDays);
}

export function pregnancyMilestonesFromEstimatedDueDate(
  estimatedDueDate: LocalDate,
): PregnancyMilestone[] {
  validateLocalDate(estimatedDueDate, "estimatedDueDate");
  return PREGNANCY_MILESTONE_DAYS.map(([id, totalDays]) => ({
    id,
    gestationalAge: gestationalAgeFromDays(totalDays),
    date: dateAtGestationalAge(estimatedDueDate, totalDays),
  }));
}

export function pregnancyMilestones(estimatedLmp: LocalDate): PregnancyMilestone[] {
  validateLocalDate(estimatedLmp, "estimatedLmp");
  return pregnancyMilestonesFromEstimatedDueDate(
    shiftLocalDate(estimatedLmp, TERM_DAYS),
  );
}

export interface PregnancyDatingResult {
  basis: "lmp" | "ultrasound" | "art_day_3" | "art_day_5" | "art_conception";
  referenceDate: LocalDate;
  estimatedLmp: LocalDate;
  estimatedConceptionDate: LocalDate;
  estimatedDueDate: LocalDate;
  gestationalAge: GestationalAge;
  trimester: PregnancyTrimester;
  milestones: PregnancyMilestone[];
  isBeyond45Weeks6Days: boolean;
  alerts: PregnancyDatingAlert[];
}

export interface PregnancyDatingAlert {
  code: "reference_beyond_45w6d";
  message: string;
}

function datingResultFromOrigin(
  basis: PregnancyDatingResult["basis"],
  estimatedLmp: LocalDate,
  estimatedConceptionDate: LocalDate,
  referenceDate: LocalDate,
): PregnancyDatingResult {
  validateLocalDate(estimatedLmp, "estimatedLmp");
  validateLocalDate(estimatedConceptionDate, "estimatedConceptionDate");
  validateLocalDate(referenceDate, "referenceDate");
  const totalDays = civilDayDifference(estimatedLmp, referenceDate);
  if (totalDays < 0) {
    fail(
      "negative_gestational_age",
      "referenceDate is before gestational day zero.",
      "referenceDate",
    );
  }
  const isBeyond45Weeks6Days = totalDays > MAX_SUPPORTED_GESTATIONAL_DAYS;

  return {
    basis,
    referenceDate,
    estimatedLmp,
    estimatedConceptionDate,
    estimatedDueDate: shiftLocalDate(estimatedLmp, TERM_DAYS),
    gestationalAge: gestationalAgeFromDays(totalDays),
    trimester: classifyPregnancyTrimester(totalDays),
    milestones: pregnancyMilestones(estimatedLmp),
    isBeyond45Weeks6Days,
    alerts: isBeyond45Weeks6Days
      ? [
          {
            code: "reference_beyond_45w6d",
            message:
              "The reference date is beyond 45 weeks and 6 days; verify whether this is a historical or completed pregnancy.",
          },
        ]
      : [],
  };
}

export interface LmpDatingInput {
  lmp: LocalDate;
  referenceDate: LocalDate;
}

export function calculateGestationalAgeFromLmp(
  input: LmpDatingInput,
): PregnancyDatingResult {
  validateLocalDate(input.lmp, "lmp");
  return datingResultFromOrigin(
    "lmp",
    input.lmp,
    shiftLocalDate(input.lmp, CONCEPTION_OFFSET_DAYS),
    input.referenceDate,
  );
}

export interface UltrasoundDatingInput {
  examinationDate: LocalDate;
  gestationalWeeks: number;
  gestationalDays: number;
  referenceDate: LocalDate;
}

export interface UltrasoundDatingResult extends PregnancyDatingResult {
  basis: "ultrasound";
  examinationDate: LocalDate;
  gestationalAgeAtExamination: GestationalAge;
}

function ultrasoundAgeDays(input: {
  gestationalWeeks: number;
  gestationalDays: number;
}): number {
  assertInteger(input.gestationalWeeks, "gestationalWeeks", { min: 0, max: 45 });
  assertInteger(input.gestationalDays, "gestationalDays", { min: 0, max: 6 });
  return assertSupportedGestationalDays(
    input.gestationalWeeks * 7 + input.gestationalDays,
    "gestationalAgeAtExamination",
  );
}

export function calculateGestationalAgeFromUltrasound(
  input: UltrasoundDatingInput,
): UltrasoundDatingResult {
  validateLocalDate(input.examinationDate, "examinationDate");
  validateLocalDate(input.referenceDate, "referenceDate");
  if (civilDayDifference(input.examinationDate, input.referenceDate) < 0) {
    fail(
      "source_date_after_reference",
      "examinationDate cannot be after referenceDate.",
      "examinationDate",
    );
  }
  const ageAtExaminationDays = ultrasoundAgeDays(input);
  const estimatedLmp = shiftLocalDate(input.examinationDate, -ageAtExaminationDays);
  const result = datingResultFromOrigin(
    "ultrasound",
    estimatedLmp,
    shiftLocalDate(estimatedLmp, CONCEPTION_OFFSET_DAYS),
    input.referenceDate,
  );
  return {
    ...result,
    basis: "ultrasound",
    examinationDate: input.examinationDate,
    gestationalAgeAtExamination: gestationalAgeFromDays(ageAtExaminationDays),
  };
}

export const ACOG_DATING_POLICY = {
  id: "ACOG-CO700",
  title: "Methods for Estimating the Due Date",
  organizations: [
    "American College of Obstetricians and Gynecologists",
    "American Institute of Ultrasound in Medicine",
    "Society for Maternal-Fetal Medicine",
  ],
  organizationAbbreviations: ["ACOG", "AIUM", "SMFM"],
  documentType: "Committee Opinion",
  number: 700,
  issued: "2017-05",
  reaffirmed: "2025",
  status: "active_reaffirmed",
  doi: "10.1097/AOG.0000000000002046",
  canonicalUrl:
    "https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/05/methods-for-estimating-the-due-date",
  smfmUrl:
    "https://publications.smfm.org/publications/239-acog-committee-opinion-700-methods-for-estimating-the/",
  version: "2017-reaffirmed-2025",
  discrepancyRule: "strict_greater_than",
  thresholdBasis: "LMP_GA_AT_ULTRASOUND",
  suboptimallyDatedCutoffDays: 154 as const,
  subsequentChangeNote:
    "Changing an established estimated due date should be reserved for rare circumstances.",
} as const;

export interface AcogRedatingThreshold {
  minimumGestationalDays: number;
  maximumGestationalDays: number | null;
  discrepancyThresholdDays: 5 | 7 | 10 | 14 | 21;
  biometricMethod: "CRL" | "BPD_HC_AC_FL";
  caution: "THIRD_TRIMESTER_GROWTH" | null;
}

export const ACOG_REDATING_THRESHOLDS: readonly AcogRedatingThreshold[] = [
  { minimumGestationalDays: 0, maximumGestationalDays: 8 * 7 + 6, discrepancyThresholdDays: 5, biometricMethod: "CRL", caution: null },
  { minimumGestationalDays: 9 * 7, maximumGestationalDays: 13 * 7 + 6, discrepancyThresholdDays: 7, biometricMethod: "CRL", caution: null },
  { minimumGestationalDays: 14 * 7, maximumGestationalDays: 15 * 7 + 6, discrepancyThresholdDays: 7, biometricMethod: "BPD_HC_AC_FL", caution: null },
  { minimumGestationalDays: 16 * 7, maximumGestationalDays: 21 * 7 + 6, discrepancyThresholdDays: 10, biometricMethod: "BPD_HC_AC_FL", caution: null },
  { minimumGestationalDays: 22 * 7, maximumGestationalDays: 27 * 7 + 6, discrepancyThresholdDays: 14, biometricMethod: "BPD_HC_AC_FL", caution: null },
  { minimumGestationalDays: 28 * 7, maximumGestationalDays: null, discrepancyThresholdDays: 21, biometricMethod: "BPD_HC_AC_FL", caution: "THIRD_TRIMESTER_GROWTH" },
] as const;

export function acogRedatingThreshold(
  lmpGestationalDays: number,
): AcogRedatingThreshold {
  assertSupportedGestationalDays(
    lmpGestationalDays,
    "lmpGestationalAgeAtUltrasound",
  );
  const threshold = ACOG_REDATING_THRESHOLDS.find(
    ({ minimumGestationalDays, maximumGestationalDays }) =>
      lmpGestationalDays >= minimumGestationalDays &&
      (maximumGestationalDays === null ||
        lmpGestationalDays <= maximumGestationalDays),
  );
  if (!threshold) {
    return fail(
      "out_of_range",
      "No ACOG redating threshold exists for this gestational age.",
      "lmpGestationalAgeAtUltrasound",
    );
  }
  return threshold;
}

export interface SuboptimalDatingAssessment {
  isSuboptimallyDated: boolean;
  cutoffGestationalDays: 154;
  reason: "no_confirming_ultrasound_before_22_weeks" | "confirmed_before_22_weeks";
  policy: typeof ACOG_DATING_POLICY;
}

export function assessSuboptimalDating(
  confirmingUltrasoundGestationalDays: number | null,
): SuboptimalDatingAssessment {
  if (confirmingUltrasoundGestationalDays !== null) {
    assertSupportedGestationalDays(
      confirmingUltrasoundGestationalDays,
      "confirmingUltrasoundGestationalDays",
    );
  }
  const isSuboptimallyDated =
    confirmingUltrasoundGestationalDays === null ||
    confirmingUltrasoundGestationalDays >=
      ACOG_DATING_POLICY.suboptimallyDatedCutoffDays;
  return {
    isSuboptimallyDated,
    cutoffGestationalDays: ACOG_DATING_POLICY.suboptimallyDatedCutoffDays,
    reason: isSuboptimallyDated
      ? "no_confirming_ultrasound_before_22_weeks"
      : "confirmed_before_22_weeks",
    policy: ACOG_DATING_POLICY,
  };
}

export interface PregnancyDatingComparisonInput {
  lmp: LocalDate;
  examinationDate: LocalDate;
  ultrasoundWeeks: number;
  ultrasoundDays: number;
}

export interface PregnancyDatingComparisonResult {
  lmpGestationalAgeAtExamination: GestationalAge;
  ultrasoundGestationalAgeAtExamination: GestationalAge;
  signedDifferenceDays: number;
  absoluteDifferenceDays: number;
  direction: "same" | "ultrasound_older" | "ultrasound_younger";
  discrepancyThresholdDays: number;
  exceedsRedatingThreshold: boolean;
  supportsReview: boolean;
  automaticallyChangesDueDate: false;
  lmpEstimatedDueDate: LocalDate;
  ultrasoundEstimatedDueDate: LocalDate;
  candidateDueDateIfRedated: LocalDate | null;
  policy: typeof ACOG_DATING_POLICY;
}

export function comparePregnancyDating(
  input: PregnancyDatingComparisonInput,
): PregnancyDatingComparisonResult {
  validateLocalDate(input.lmp, "lmp");
  validateLocalDate(input.examinationDate, "examinationDate");
  const lmpDays = civilDayDifference(input.lmp, input.examinationDate);
  if (lmpDays < 0) {
    fail(
      "negative_gestational_age",
      "examinationDate is before the reported LMP.",
      "examinationDate",
    );
  }
  assertSupportedGestationalDays(lmpDays, "lmpGestationalAgeAtExamination");
  const ultrasoundTotalDays = ultrasoundAgeDays({
    gestationalWeeks: input.ultrasoundWeeks,
    gestationalDays: input.ultrasoundDays,
  });
  const threshold = acogRedatingThreshold(lmpDays);
  const signedDifferenceDays = ultrasoundTotalDays - lmpDays;
  const absoluteDifferenceDays = Math.abs(signedDifferenceDays);
  const exceedsRedatingThreshold =
    absoluteDifferenceDays > threshold.discrepancyThresholdDays;
  const ultrasoundEstimatedLmp = shiftLocalDate(
    input.examinationDate,
    -ultrasoundTotalDays,
  );
  const ultrasoundEstimatedDueDate = shiftLocalDate(
    ultrasoundEstimatedLmp,
    TERM_DAYS,
  );

  return {
    lmpGestationalAgeAtExamination: gestationalAgeFromDays(lmpDays),
    ultrasoundGestationalAgeAtExamination:
      gestationalAgeFromDays(ultrasoundTotalDays),
    signedDifferenceDays,
    absoluteDifferenceDays,
    direction:
      signedDifferenceDays === 0
        ? "same"
        : signedDifferenceDays > 0
          ? "ultrasound_older"
          : "ultrasound_younger",
    discrepancyThresholdDays: threshold.discrepancyThresholdDays,
    exceedsRedatingThreshold,
    supportsReview: exceedsRedatingThreshold,
    automaticallyChangesDueDate: false,
    lmpEstimatedDueDate: shiftLocalDate(input.lmp, TERM_DAYS),
    ultrasoundEstimatedDueDate,
    candidateDueDateIfRedated: exceedsRedatingThreshold
      ? ultrasoundEstimatedDueDate
      : null,
    policy: ACOG_DATING_POLICY,
  };
}

export type ArtDatingMethod =
  | "embryo_transfer_day_3"
  | "embryo_transfer_day_5"
  | "conception";

export interface ArtDatingInput {
  method: ArtDatingMethod;
  procedureDate: LocalDate;
  referenceDate: LocalDate;
}

export interface ArtDatingResult extends PregnancyDatingResult {
  basis: "art_day_3" | "art_day_5" | "art_conception";
  method: ArtDatingMethod;
  procedureDate: LocalDate;
  procedureToDueDateDays: 261 | 263 | 266;
  takesPrecedenceOverLmpUltrasoundRedating: true;
}

export function calculateArtDating(input: ArtDatingInput): ArtDatingResult {
  validateLocalDate(input.procedureDate, "procedureDate");
  validateLocalDate(input.referenceDate, "referenceDate");
  if (civilDayDifference(input.procedureDate, input.referenceDate) < 0) {
    fail(
      "art_event_after_reference",
      "procedureDate cannot be after referenceDate for ART dating.",
      "procedureDate",
    );
  }
  const methodDetails = {
    embryo_transfer_day_3: {
      basis: "art_day_3" as const,
      embryoAgeDays: 3,
      procedureToDueDateDays: 263 as const,
    },
    embryo_transfer_day_5: {
      basis: "art_day_5" as const,
      embryoAgeDays: 5,
      procedureToDueDateDays: 261 as const,
    },
    conception: {
      basis: "art_conception" as const,
      embryoAgeDays: 0,
      procedureToDueDateDays: 266 as const,
    },
  }[input.method];
  if (!methodDetails) {
    fail("out_of_range", "method is not a supported ART dating method.", "method");
  }

  const conceptionDate = shiftLocalDate(
    input.procedureDate,
    -methodDetails.embryoAgeDays,
  );
  const estimatedLmp = shiftLocalDate(conceptionDate, -CONCEPTION_OFFSET_DAYS);
  const result = datingResultFromOrigin(
    methodDetails.basis,
    estimatedLmp,
    conceptionDate,
    input.referenceDate,
  );

  return {
    ...result,
    basis: methodDetails.basis,
    method: input.method,
    procedureDate: input.procedureDate,
    procedureToDueDateDays: methodDetails.procedureToDueDateDays,
    takesPrecedenceOverLmpUltrasoundRedating: true,
  };
}

export interface QblContainerInput {
  label?: string;
  collectedFluidMl: number | null;
  nonBloodFluidMl: number | null;
}

export interface QblMaterialInput {
  label?: string;
  wetWeightGrams: number | null;
  dryWeightGrams: number | null;
}

export interface QuantifiedBloodLossInput {
  containers: readonly QblContainerInput[];
  materials: readonly QblMaterialInput[];
}

export interface QuantifiedBloodLossResult {
  status: "complete" | "incomplete";
  totalBloodLossMl: number | null;
  knownBloodLossMl: number;
  containerBloodLossMl: number;
  materialBloodLossMl: number;
  missingFields: string[];
  gramsPerMilliliterAssumption: 1;
  policy: typeof ACOG_QBL_POLICY;
}

export const ACOG_QBL_POLICY = {
  id: "ACOG-CO794-QBL",
  title: "Quantitative Blood Loss in Obstetric Hemorrhage",
  organization: "American College of Obstetricians and Gynecologists",
  reaffirmed: "2025",
  sourceUrl:
    "https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2019/12/quantitative-blood-loss-in-obstetric-hemorrhage",
  gramsPerMilliliterAssumption: 1,
  note:
    "Incomplete tare or non-blood-fluid measurements must not be presented as an exact total.",
} as const;

function validateNullableNonnegativeMeasurement(
  value: number | null,
  field: string,
): number | null {
  if (value === null) return null;
  return assertFiniteNumber(value, field, { min: 0 });
}

export function calculateQuantifiedBloodLoss(
  input: QuantifiedBloodLossInput,
): QuantifiedBloodLossResult {
  if (input.containers.length === 0 && input.materials.length === 0) {
    fail(
      "incomplete_input",
      "At least one container or weighted material is required.",
    );
  }

  const missingFields: string[] = [];
  let containerBloodLossMl = 0;
  input.containers.forEach((container, index) => {
    const collected = validateNullableNonnegativeMeasurement(
      container.collectedFluidMl,
      `containers[${index}].collectedFluidMl`,
    );
    const nonBlood = validateNullableNonnegativeMeasurement(
      container.nonBloodFluidMl,
      `containers[${index}].nonBloodFluidMl`,
    );
    if (collected === null) {
      missingFields.push(`containers[${index}].collectedFluidMl`);
    }
    if (nonBlood === null) {
      missingFields.push(`containers[${index}].nonBloodFluidMl`);
    }
    if (collected !== null && nonBlood !== null) {
      if (nonBlood > collected) {
        fail(
          "invalid_measurement",
          "nonBloodFluidMl cannot exceed collectedFluidMl.",
          `containers[${index}].nonBloodFluidMl`,
        );
      }
      containerBloodLossMl += collected - nonBlood;
    }
  });

  let materialBloodLossMl = 0;
  input.materials.forEach((material, index) => {
    const wet = validateNullableNonnegativeMeasurement(
      material.wetWeightGrams,
      `materials[${index}].wetWeightGrams`,
    );
    const dry = validateNullableNonnegativeMeasurement(
      material.dryWeightGrams,
      `materials[${index}].dryWeightGrams`,
    );
    if (wet === null) missingFields.push(`materials[${index}].wetWeightGrams`);
    if (dry === null) missingFields.push(`materials[${index}].dryWeightGrams`);
    if (wet !== null && dry !== null) {
      if (dry > wet) {
        fail(
          "invalid_measurement",
          "dryWeightGrams cannot exceed wetWeightGrams.",
          `materials[${index}].dryWeightGrams`,
        );
      }
      materialBloodLossMl += wet - dry;
    }
  });

  const knownBloodLossMl = containerBloodLossMl + materialBloodLossMl;
  const status = missingFields.length === 0 ? "complete" : "incomplete";
  return {
    status,
    totalBloodLossMl: status === "complete" ? knownBloodLossMl : null,
    knownBloodLossMl,
    containerBloodLossMl,
    materialBloodLossMl,
    missingFields,
    gramsPerMilliliterAssumption: 1,
    policy: ACOG_QBL_POLICY,
  };
}

export const WHO_MATERNAL_SHOCK_INDEX_POLICY = {
  id: "WHO-PPH-2025",
  organization: "World Health Organization",
  sourceUrl: "https://www.who.int/publications/i/item/9789240115637",
  threshold: 1,
  abnormalRule: "strictly_greater_than",
  note: "Shock index is a trigger for assessment, not a standalone diagnosis.",
} as const;

export interface MaternalShockIndexInput {
  heartRateBpm: number;
  systolicBloodPressureMmHg: number;
}

export interface MaternalShockIndexResult {
  shockIndex: number;
  roundedShockIndex: number;
  exceedsWhoAbnormalThreshold: boolean;
  policy: typeof WHO_MATERNAL_SHOCK_INDEX_POLICY;
}

export function calculateMaternalShockIndex(
  input: MaternalShockIndexInput,
): MaternalShockIndexResult {
  const heartRateBpm = assertFiniteNumber(input.heartRateBpm, "heartRateBpm", {
    strictlyPositive: true,
  });
  const systolicBloodPressureMmHg = assertFiniteNumber(
    input.systolicBloodPressureMmHg,
    "systolicBloodPressureMmHg",
    { strictlyPositive: true },
  );
  const shockIndex = heartRateBpm / systolicBloodPressureMmHg;
  return {
    shockIndex,
    roundedShockIndex: Math.round(shockIndex * 100) / 100,
    exceedsWhoAbnormalThreshold:
      shockIndex > WHO_MATERNAL_SHOCK_INDEX_POLICY.threshold,
    policy: WHO_MATERNAL_SHOCK_INDEX_POLICY,
  };
}

export type WhoPphCriterionStatus = "meets" | "does_not_meet" | "indeterminate";

export interface WhoPphCriterionInput {
  bloodLossMl: number | null;
  heartRateBpm: number | null;
  systolicBloodPressureMmHg: number | null;
  diastolicBloodPressureMmHg: number | null;
}

export interface WhoPphCriterionResult {
  status: WhoPphCriterionStatus;
  abnormalHemodynamics: boolean | null;
  shockIndex: number | null;
  triggers: Array<
    | "blood_loss_at_least_500_ml"
    | "blood_loss_at_least_300_ml_with_abnormal_hemodynamics"
    | "heart_rate_above_100"
    | "systolic_bp_below_100"
    | "diastolic_bp_below_60"
    | "shock_index_above_1"
  >;
  missingFields: string[];
  note: string;
}

function validateNullablePositiveVital(
  value: number | null,
  field: string,
): number | null {
  if (value === null) return null;
  return assertFiniteNumber(value, field, { strictlyPositive: true });
}

/** Applies the WHO 2025 objective PPH diagnostic trigger without inferring missing data. */
export function assessWhoPostpartumHemorrhageCriterion(
  input: WhoPphCriterionInput,
): WhoPphCriterionResult {
  const bloodLossMl =
    input.bloodLossMl === null
      ? null
      : assertFiniteNumber(input.bloodLossMl, "bloodLossMl", { min: 0 });
  const heartRateBpm = validateNullablePositiveVital(
    input.heartRateBpm,
    "heartRateBpm",
  );
  const systolicBloodPressureMmHg = validateNullablePositiveVital(
    input.systolicBloodPressureMmHg,
    "systolicBloodPressureMmHg",
  );
  const diastolicBloodPressureMmHg = validateNullablePositiveVital(
    input.diastolicBloodPressureMmHg,
    "diastolicBloodPressureMmHg",
  );
  const missingFields = [
    ...(bloodLossMl === null ? ["bloodLossMl"] : []),
    ...(heartRateBpm === null ? ["heartRateBpm"] : []),
    ...(systolicBloodPressureMmHg === null
      ? ["systolicBloodPressureMmHg"]
      : []),
    ...(diastolicBloodPressureMmHg === null
      ? ["diastolicBloodPressureMmHg"]
      : []),
  ];
  const shockIndex =
    heartRateBpm !== null && systolicBloodPressureMmHg !== null
      ? heartRateBpm / systolicBloodPressureMmHg
      : null;
  const triggers: WhoPphCriterionResult["triggers"] = [];
  if (heartRateBpm !== null && heartRateBpm > 100) {
    triggers.push("heart_rate_above_100");
  }
  if (
    systolicBloodPressureMmHg !== null &&
    systolicBloodPressureMmHg < 100
  ) {
    triggers.push("systolic_bp_below_100");
  }
  if (
    diastolicBloodPressureMmHg !== null &&
    diastolicBloodPressureMmHg < 60
  ) {
    triggers.push("diastolic_bp_below_60");
  }
  if (shockIndex !== null && shockIndex > 1) {
    triggers.push("shock_index_above_1");
  }
  const abnormalTriggers = triggers.length;
  const allHemodynamicsKnown =
    heartRateBpm !== null &&
    systolicBloodPressureMmHg !== null &&
    diastolicBloodPressureMmHg !== null;
  const abnormalHemodynamics =
    abnormalTriggers > 0 ? true : allHemodynamicsKnown ? false : null;

  let status: WhoPphCriterionStatus;
  if (bloodLossMl === null) {
    status = "indeterminate";
  } else if (bloodLossMl >= 500) {
    status = "meets";
    triggers.unshift("blood_loss_at_least_500_ml");
  } else if (bloodLossMl >= 300 && abnormalHemodynamics === true) {
    status = "meets";
    triggers.unshift("blood_loss_at_least_300_ml_with_abnormal_hemodynamics");
  } else if (bloodLossMl < 300 || abnormalHemodynamics === false) {
    status = "does_not_meet";
  } else {
    status = "indeterminate";
  }

  return {
    status,
    abnormalHemodynamics,
    shockIndex,
    triggers,
    missingFields,
    note:
      "Bleeding or instability requires protocol-based assessment without waiting for this calculation.",
  };
}

export type ApgarComponentScore = 0 | 1 | 2;
export type ApgarAssessmentMinute = 1 | 5 | 10 | 15 | 20;
export type ApgarCategory = "low" | "moderately_abnormal" | "reassuring";

export interface ApgarInput {
  minute: ApgarAssessmentMinute;
  appearance: ApgarComponentScore;
  pulse: ApgarComponentScore;
  grimace: ApgarComponentScore;
  activity: ApgarComponentScore;
  respiration: ApgarComponentScore;
}

export interface ApgarResult {
  minute: ApgarAssessmentMinute;
  total: number;
  category: ApgarCategory;
  categoryIsValidatedForFiveMinuteScore: boolean;
  repeatDocumentationEveryFiveMinutesUntil20: boolean;
  components: Omit<ApgarInput, "minute">;
  note: string;
  policy: typeof APGAR_POLICY;
}

export const APGAR_POLICY = {
  id: "ACOG-AAP-APGAR-2015",
  title: "The Apgar Score",
  organizations: [
    "American College of Obstetricians and Gynecologists",
    "American Academy of Pediatrics",
  ],
  reaffirmed: "2025",
  sourceUrl:
    "https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2015/10/the-apgar-score",
  note:
    "Initial resuscitation decisions precede the one-minute Apgar assessment.",
} as const;

const APGAR_MINUTES: readonly ApgarAssessmentMinute[] = [1, 5, 10, 15, 20];

function validateApgarComponent(
  value: ApgarComponentScore,
  field: keyof Omit<ApgarInput, "minute">,
): ApgarComponentScore {
  assertInteger(value, field, { min: 0, max: 2 });
  return value;
}

export function calculateApgar(input: ApgarInput): ApgarResult {
  if (!APGAR_MINUTES.includes(input.minute)) {
    fail(
      "out_of_range",
      "minute must be 1, 5, 10, 15, or 20.",
      "minute",
    );
  }
  const components = {
    appearance: validateApgarComponent(input.appearance, "appearance"),
    pulse: validateApgarComponent(input.pulse, "pulse"),
    grimace: validateApgarComponent(input.grimace, "grimace"),
    activity: validateApgarComponent(input.activity, "activity"),
    respiration: validateApgarComponent(input.respiration, "respiration"),
  };
  const total = Object.values(components).reduce<number>((sum, score) => sum + score, 0);
  const category: ApgarCategory =
    total <= 3 ? "low" : total <= 6 ? "moderately_abnormal" : "reassuring";
  return {
    minute: input.minute,
    total,
    category,
    categoryIsValidatedForFiveMinuteScore: input.minute === 5,
    repeatDocumentationEveryFiveMinutesUntil20:
      input.minute >= 5 && input.minute < 20 && total < 7,
    components,
    note:
      "The Apgar score does not determine whether initial resuscitation is needed and is not a standalone diagnosis of asphyxia.",
    policy: APGAR_POLICY,
  };
}
