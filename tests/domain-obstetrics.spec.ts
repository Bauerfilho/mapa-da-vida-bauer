import { expect, test } from "@playwright/test";
import {
  ACOG_DATING_POLICY,
  acogRedatingThreshold,
  assessSuboptimalDating,
  assessWhoPostpartumHemorrhageCriterion,
  calculateApgar,
  calculateArtDating,
  calculateGestationalAgeFromLmp,
  calculateGestationalAgeFromUltrasound,
  calculateMaternalShockIndex,
  calculateQuantifiedBloodLoss,
  civilDayDifference,
  classifyGestationalAgeAtBirth,
  classifyPregnancyTrimester,
  comparePregnancyDating,
  gestationalAgeFromDays,
  ObstetricCalculationError,
  pregnancyMilestones,
  type ApgarInput,
  type ArtDatingInput,
} from "../src/domain/obstetrics";
import { shiftLocalDate } from "../src/domain/dates";
import type { LocalDate } from "../src/domain/model";

test.describe("obstetrics civil-date arithmetic", () => {
  test("counts the start date as gestational day zero", () => {
    expect(civilDayDifference("2026-03-04", "2026-03-04")).toBe(0);
    expect(civilDayDifference("2026-03-04", "2026-03-05")).toBe(1);
  });

  test("is stable across leap days and year boundaries", () => {
    expect(civilDayDifference("2024-02-28", "2024-03-01")).toBe(2);
    expect(civilDayDifference("2023-02-28", "2023-03-01")).toBe(1);
    expect(civilDayDifference("2025-12-31", "2026-01-01")).toBe(1);
  });

  test("rejects malformed and nonexistent dates instead of normalizing them", () => {
    expect(() => civilDayDifference("2026-02-30", "2026-03-01")).toThrow(
      ObstetricCalculationError,
    );
    expect(() => civilDayDifference("2026-2-01" as LocalDate, "2026-03-01")).toThrow(
      "start must be a valid civil date",
    );
  });
});

test.describe("obstetrics dating by LMP", () => {
  test("calculates day zero, estimated conception, EDD, and milestones", () => {
    const result = calculateGestationalAgeFromLmp({
      lmp: "2026-01-01",
      referenceDate: "2026-01-01",
    });

    expect(result.basis).toBe("lmp");
    expect(result.gestationalAge).toEqual({ totalDays: 0, weeks: 0, days: 0 });
    expect(result.estimatedConceptionDate).toBe("2026-01-15");
    expect(result.estimatedDueDate).toBe("2026-10-08");
    expect(result.trimester).toBe("first");
    expect(result.milestones.map(({ id, date }) => [id, date])).toEqual([
      ["week_12", "2026-03-26"],
      ["week_20", "2026-05-21"],
      ["week_24", "2026-06-18"],
      ["third_trimester", "2026-07-16"],
      ["week_32", "2026-08-13"],
      ["week_34", "2026-08-27"],
      ["week_36", "2026-09-10"],
      ["early_term", "2026-09-17"],
      ["full_term", "2026-10-01"],
      ["estimated_due_date", "2026-10-08"],
      ["late_term", "2026-10-15"],
    ]);
  });

  test("calculates weeks and residual days without rounding", () => {
    const result = calculateGestationalAgeFromLmp({
      lmp: "2026-01-01",
      referenceDate: "2026-04-05",
    });
    expect(result.gestationalAge).toEqual({ totalDays: 94, weeks: 13, days: 3 });
  });

  test("matches the canonical 2026-07-28 LMP example", () => {
    const result = calculateGestationalAgeFromLmp({
      lmp: "2026-07-28",
      referenceDate: "2026-09-01",
    });
    expect(result.gestationalAge).toEqual({ totalDays: 35, weeks: 5, days: 0 });
    expect(result.estimatedDueDate).toBe("2027-05-04");
  });

  test("handles a leap-day span and its EDD", () => {
    const result = calculateGestationalAgeFromLmp({
      lmp: "2024-02-28",
      referenceDate: "2024-03-01",
    });
    expect(result.gestationalAge).toEqual({ totalDays: 2, weeks: 0, days: 2 });
    expect(result.estimatedDueDate).toBe("2024-12-04");
  });

  test("places 40+0 exactly on the EDD", () => {
    const result = calculateGestationalAgeFromLmp({
      lmp: "2026-01-01",
      referenceDate: "2026-10-08",
    });
    expect(result.gestationalAge).toEqual({ totalDays: 280, weeks: 40, days: 0 });
  });

  test("rejects a future LMP but flags a historical reference beyond 45+6", () => {
    expect(() =>
      calculateGestationalAgeFromLmp({
        lmp: "2026-09-02",
        referenceDate: "2026-09-01",
      }),
    ).toThrow("referenceDate is before gestational day zero");

    const historical = calculateGestationalAgeFromLmp({
      lmp: "2026-01-01",
      referenceDate: shiftLocalDate("2026-01-01", 45 * 7 + 7),
    });
    expect(historical.gestationalAge).toEqual({
      totalDays: 322,
      weeks: 46,
      days: 0,
    });
    expect(historical.isBeyond45Weeks6Days).toBe(true);
    expect(historical.alerts).toEqual([
      expect.objectContaining({ code: "reference_beyond_45w6d" }),
    ]);
  });
});

test.describe("obstetrics dating by ultrasound", () => {
  test("anchors the pregnancy to age on the examination date", () => {
    const result = calculateGestationalAgeFromUltrasound({
      examinationDate: "2026-03-01",
      gestationalWeeks: 12,
      gestationalDays: 3,
      referenceDate: "2026-03-01",
    });

    expect(result.gestationalAgeAtExamination).toEqual({
      totalDays: 87,
      weeks: 12,
      days: 3,
    });
    expect(result.gestationalAge).toEqual({ totalDays: 87, weeks: 12, days: 3 });
    expect(result.estimatedLmp).toBe("2025-12-04");
    expect(result.estimatedDueDate).toBe("2026-09-10");
  });

  test("advances by exact civil days after the scan", () => {
    const result = calculateGestationalAgeFromUltrasound({
      examinationDate: "2026-03-01",
      gestationalWeeks: 12,
      gestationalDays: 3,
      referenceDate: "2026-03-31",
    });
    expect(result.gestationalAge).toEqual({ totalDays: 117, weeks: 16, days: 5 });
  });

  test("matches the canonical ultrasound example", () => {
    const result = calculateGestationalAgeFromUltrasound({
      examinationDate: "2026-07-28",
      gestationalWeeks: 12,
      gestationalDays: 3,
      referenceDate: "2026-09-01",
    });
    expect(result.gestationalAge).toEqual({ totalDays: 122, weeks: 17, days: 3 });
    expect(result.estimatedLmp).toBe("2026-05-02");
    expect(result.estimatedDueDate).toBe("2027-02-06");
  });

  test("keeps ultrasound arithmetic stable across a leap day", () => {
    const result = calculateGestationalAgeFromUltrasound({
      examinationDate: "2024-02-28",
      gestationalWeeks: 8,
      gestationalDays: 6,
      referenceDate: "2024-03-01",
    });
    expect(result.gestationalAge).toEqual({ totalDays: 64, weeks: 9, days: 1 });
    expect(result.estimatedLmp).toBe("2023-12-28");
  });

  test("keeps a completed pregnancy calculable at a later historical reference", () => {
    const result = calculateGestationalAgeFromUltrasound({
      examinationDate: "2026-02-25",
      gestationalWeeks: 36,
      gestationalDays: 4,
      referenceDate: "2026-09-01",
    });
    expect(result.gestationalAge).toEqual({ totalDays: 444, weeks: 63, days: 3 });
    expect(result.estimatedDueDate).toBe("2026-03-21");
    expect(result.isBeyond45Weeks6Days).toBe(true);
    expect(result.alerts[0]?.code).toBe("reference_beyond_45w6d");
  });

  test("rejects fractional weeks and residual days outside 0 through 6", () => {
    expect(() =>
      calculateGestationalAgeFromUltrasound({
        examinationDate: "2026-03-01",
        gestationalWeeks: 12.5,
        gestationalDays: 0,
        referenceDate: "2026-03-01",
      }),
    ).toThrow("gestationalWeeks must be an integer");
    expect(() =>
      calculateGestationalAgeFromUltrasound({
        examinationDate: "2026-03-01",
        gestationalWeeks: 12,
        gestationalDays: 7,
        referenceDate: "2026-03-01",
      }),
    ).toThrow("gestationalDays must be at most 6");
  });

  test("rejects an examination date after the active reference date", () => {
    expect(() =>
      calculateGestationalAgeFromUltrasound({
        examinationDate: "2026-09-02",
        gestationalWeeks: 12,
        gestationalDays: 0,
        referenceDate: "2026-09-01",
      }),
    ).toThrow("examinationDate cannot be after referenceDate");
  });
});

test.describe("obstetrics ACOG CO700 dating comparison", () => {
  const boundaryCases = [
    { age: 8 * 7 + 6, threshold: 5 },
    { age: 9 * 7, threshold: 7 },
    { age: 13 * 7 + 6, threshold: 7 },
    { age: 14 * 7, threshold: 7 },
    { age: 15 * 7 + 6, threshold: 7 },
    { age: 16 * 7, threshold: 10 },
    { age: 21 * 7 + 6, threshold: 10 },
    { age: 22 * 7, threshold: 14 },
    { age: 27 * 7 + 6, threshold: 14 },
    { age: 28 * 7, threshold: 21 },
    { age: 42 * 7, threshold: 21 },
  ] as const;

  for (const { age, threshold } of boundaryCases) {
    test(`uses a ${threshold}-day threshold at gestational day ${age}`, () => {
      expect(acogRedatingThreshold(age).discrepancyThresholdDays).toBe(threshold);
    });
  }

  test("uses a strictly-greater-than rule at every ACOG threshold", () => {
    const examinationDate = "2026-08-01" as const;
    const representativeAges = [
      { lmpDays: 7 * 7, threshold: 5 },
      { lmpDays: 10 * 7, threshold: 7 },
      { lmpDays: 14 * 7, threshold: 7 },
      { lmpDays: 18 * 7, threshold: 10 },
      { lmpDays: 24 * 7, threshold: 14 },
      { lmpDays: 29 * 7, threshold: 21 },
    ];

    for (const { lmpDays, threshold } of representativeAges) {
      const ultrasoundAtThreshold = lmpDays + threshold;
      const ultrasoundOverThreshold = ultrasoundAtThreshold + 1;
      const exact = comparePregnancyDating({
        lmp: shiftLocalDate(examinationDate, -lmpDays),
        examinationDate,
        ultrasoundWeeks: Math.floor(ultrasoundAtThreshold / 7),
        ultrasoundDays: ultrasoundAtThreshold % 7,
      });
      const over = comparePregnancyDating({
        lmp: shiftLocalDate(examinationDate, -lmpDays),
        examinationDate,
        ultrasoundWeeks: Math.floor(ultrasoundOverThreshold / 7),
        ultrasoundDays: ultrasoundOverThreshold % 7,
      });
      expect(exact.absoluteDifferenceDays).toBe(threshold);
      expect(exact.exceedsRedatingThreshold).toBe(false);
      expect(exact.candidateDueDateIfRedated).toBeNull();
      expect(over.absoluteDifferenceDays).toBe(threshold + 1);
      expect(over.exceedsRedatingThreshold).toBe(true);
      expect(over.candidateDueDateIfRedated).toBe(over.ultrasoundEstimatedDueDate);
    }
  });

  test("selects the threshold band from LMP-derived age, not ultrasound age", () => {
    const examinationDate = "2026-08-01" as const;
    const lmpDays = 8 * 7 + 6;
    const result = comparePregnancyDating({
      lmp: shiftLocalDate(examinationDate, -lmpDays),
      examinationDate,
      ultrasoundWeeks: 9,
      ultrasoundDays: 5,
    });
    expect(result.lmpGestationalAgeAtExamination.totalDays).toBe(62);
    expect(result.ultrasoundGestationalAgeAtExamination.totalDays).toBe(68);
    expect(result.absoluteDifferenceDays).toBe(6);
    expect(result.discrepancyThresholdDays).toBe(5);
    expect(result.exceedsRedatingThreshold).toBe(true);
    expect(result.policy.thresholdBasis).toBe(
      "LMP_GA_AT_ULTRASOUND",
    );
  });

  test("preserves signed direction and exposes auditable policy metadata", () => {
    const older = comparePregnancyDating({
      lmp: "2026-01-01",
      examinationDate: "2026-03-12",
      ultrasoundWeeks: 11,
      ultrasoundDays: 0,
    });
    expect(older.lmpGestationalAgeAtExamination.totalDays).toBe(70);
    expect(older.signedDifferenceDays).toBe(7);
    expect(older.direction).toBe("ultrasound_older");
    expect(older.exceedsRedatingThreshold).toBe(false);
    expect(older.policy).toBe(ACOG_DATING_POLICY);
    expect(older.policy.id).toBe("ACOG-CO700");
    expect(older.policy.discrepancyRule).toBe("strict_greater_than");

    const younger = comparePregnancyDating({
      lmp: "2026-01-01",
      examinationDate: "2026-03-12",
      ultrasoundWeeks: 8,
      ultrasoundDays: 0,
    });
    expect(younger.signedDifferenceDays).toBe(-14);
    expect(younger.direction).toBe("ultrasound_younger");
  });

  test("rejects an examination before the reported LMP", () => {
    expect(() =>
      comparePregnancyDating({
        lmp: "2026-04-01",
        examinationDate: "2026-03-31",
        ultrasoundWeeks: 8,
        ultrasoundDays: 0,
      }),
    ).toThrow("examinationDate is before the reported LMP");
  });

  test("marks absence of confirmation before 22+0 as suboptimally dated", () => {
    expect(assessSuboptimalDating(21 * 7 + 6)).toMatchObject({
      isSuboptimallyDated: false,
      cutoffGestationalDays: 154,
    });
    expect(assessSuboptimalDating(22 * 7)).toMatchObject({
      isSuboptimallyDated: true,
      cutoffGestationalDays: 154,
    });
    expect(assessSuboptimalDating(null).isSuboptimallyDated).toBe(true);
  });

  test("identifies invalid threshold input as LMP-derived age at ultrasound", () => {
    try {
      acogRedatingThreshold(46 * 7);
      throw new Error("Expected an out-of-range LMP-derived age to be rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(ObstetricCalculationError);
      expect(error).toMatchObject({
        code: "gestational_age_out_of_range",
        field: "lmpGestationalAgeAtUltrasound",
      });
    }
  });
});

test.describe("obstetrics ART dating", () => {
  const cases: Array<{
    method: ArtDatingInput["method"];
    expectedBasis: "art_day_3" | "art_day_5" | "art_conception";
    expectedLmp: LocalDate;
    expectedConception: LocalDate;
    expectedDueDate: LocalDate;
    expectedAgeAtProcedure: { totalDays: number; weeks: number; days: number };
    expectedProcedureToDueDateDays: 261 | 263 | 266;
  }> = [
    {
      method: "embryo_transfer_day_3",
      expectedBasis: "art_day_3",
      expectedLmp: "2026-02-03",
      expectedConception: "2026-02-17",
      expectedDueDate: "2026-11-10",
      expectedAgeAtProcedure: { totalDays: 17, weeks: 2, days: 3 },
      expectedProcedureToDueDateDays: 263,
    },
    {
      method: "embryo_transfer_day_5",
      expectedBasis: "art_day_5",
      expectedLmp: "2026-02-01",
      expectedConception: "2026-02-15",
      expectedDueDate: "2026-11-08",
      expectedAgeAtProcedure: { totalDays: 19, weeks: 2, days: 5 },
      expectedProcedureToDueDateDays: 261,
    },
    {
      method: "conception",
      expectedBasis: "art_conception",
      expectedLmp: "2026-02-06",
      expectedConception: "2026-02-20",
      expectedDueDate: "2026-11-13",
      expectedAgeAtProcedure: { totalDays: 14, weeks: 2, days: 0 },
      expectedProcedureToDueDateDays: 266,
    },
  ];

  for (const expected of cases) {
    test(`calculates ${expected.method} without applying an LMP heuristic`, () => {
      const result = calculateArtDating({
        method: expected.method,
        procedureDate: "2026-02-20",
        referenceDate: "2026-02-20",
      });
      expect(result.basis).toBe(expected.expectedBasis);
      expect(result.estimatedLmp).toBe(expected.expectedLmp);
      expect(result.estimatedConceptionDate).toBe(expected.expectedConception);
      expect(result.estimatedDueDate).toBe(expected.expectedDueDate);
      expect(result.gestationalAge).toEqual(expected.expectedAgeAtProcedure);
      expect(result.procedureToDueDateDays).toBe(
        expected.expectedProcedureToDueDateDays,
      );
    });
  }

  test("matches the canonical January ART dates and advances target age exactly", () => {
    const conception = calculateArtDating({
      method: "conception",
      procedureDate: "2026-01-01",
      referenceDate: "2026-01-01",
    });
    const day3 = calculateArtDating({
      method: "embryo_transfer_day_3",
      procedureDate: "2026-01-01",
      referenceDate: "2026-01-01",
    });
    const day5 = calculateArtDating({
      method: "embryo_transfer_day_5",
      procedureDate: "2026-01-01",
      referenceDate: "2026-01-11",
    });
    expect(conception.estimatedDueDate).toBe("2026-09-24");
    expect(conception.gestationalAge).toEqual({ totalDays: 14, weeks: 2, days: 0 });
    expect(day3.estimatedDueDate).toBe("2026-09-21");
    expect(day3.gestationalAge).toEqual({ totalDays: 17, weeks: 2, days: 3 });
    expect(day5.estimatedDueDate).toBe("2026-09-19");
    expect(day5.gestationalAge).toEqual({ totalDays: 29, weeks: 4, days: 1 });
    expect(day5.takesPrecedenceOverLmpUltrasoundRedating).toBe(true);
  });

  test("rejects a method outside the explicit D3, D5, and conception set", () => {
    expect(() =>
      calculateArtDating({
        method: "embryo_transfer_day_2",
        procedureDate: "2026-02-20",
        referenceDate: "2026-02-20",
      } as unknown as ArtDatingInput),
    ).toThrow("not a supported ART dating method");
  });

  for (const method of [
    "conception",
    "embryo_transfer_day_3",
    "embryo_transfer_day_5",
  ] as const) {
    test(`rejects a future ${method} event relative to the reference date`, () => {
      try {
        calculateArtDating({
          method,
          procedureDate: "2026-09-02",
          referenceDate: "2026-09-01",
        });
        throw new Error("Expected calculateArtDating to reject a future ART event.");
      } catch (error) {
        expect(error).toBeInstanceOf(ObstetricCalculationError);
        expect(error).toMatchObject({
          code: "art_event_after_reference",
          field: "procedureDate",
        });
        expect((error as Error).message).toContain(
          "procedureDate cannot be after referenceDate",
        );
      }
    });
  }
});

test.describe("obstetrics trimesters, term categories, and milestones", () => {
  test("uses exact trimester boundaries", () => {
    expect(classifyPregnancyTrimester(13 * 7 + 6)).toBe("first");
    expect(classifyPregnancyTrimester(14 * 7)).toBe("second");
    expect(classifyPregnancyTrimester(27 * 7 + 6)).toBe("second");
    expect(classifyPregnancyTrimester(28 * 7)).toBe("third");
  });

  test("uses gestational-age-at-birth category boundaries only on demand", () => {
    expect(classifyGestationalAgeAtBirth(27 * 7 + 6)).toBe("extremely_preterm");
    expect(classifyGestationalAgeAtBirth(28 * 7)).toBe("very_preterm");
    expect(classifyGestationalAgeAtBirth(31 * 7 + 6)).toBe("very_preterm");
    expect(classifyGestationalAgeAtBirth(32 * 7)).toBe("moderate_to_late_preterm");
    expect(classifyGestationalAgeAtBirth(36 * 7 + 6)).toBe("moderate_to_late_preterm");
    expect(classifyGestationalAgeAtBirth(37 * 7)).toBe("early_term");
    expect(classifyGestationalAgeAtBirth(38 * 7 + 6)).toBe("early_term");
    expect(classifyGestationalAgeAtBirth(39 * 7)).toBe("full_term");
    expect(classifyGestationalAgeAtBirth(40 * 7 + 6)).toBe("full_term");
    expect(classifyGestationalAgeAtBirth(41 * 7)).toBe("late_term");
    expect(classifyGestationalAgeAtBirth(41 * 7 + 6)).toBe("late_term");
    expect(classifyGestationalAgeAtBirth(42 * 7)).toBe("postterm");
  });

  test("returns an ordered, reproducible milestone calendar", () => {
    const milestones = pregnancyMilestones("2024-02-29");
    expect(milestones).toHaveLength(11);
    expect(milestones[0]).toMatchObject({
      id: "week_12",
      gestationalAge: { weeks: 12, days: 0 },
    });
    expect(milestones[9]).toMatchObject({
      id: "estimated_due_date",
      date: "2024-12-05",
      gestationalAge: { weeks: 40, days: 0 },
    });
  });

  test("does not clamp negative or fractional gestational days", () => {
    expect(() => gestationalAgeFromDays(-1)).toThrow("at least 0");
    expect(() => gestationalAgeFromDays(10.5)).toThrow("must be an integer");
  });
});

test.describe("obstetrics quantified blood loss", () => {
  test("subtracts non-blood fluid and dry weights from complete measurements", () => {
    const result = calculateQuantifiedBloodLoss({
      containers: [{ collectedFluidMl: 750, nonBloodFluidMl: 250 }],
      materials: [
        { wetWeightGrams: 500, dryWeightGrams: 100 },
        { wetWeightGrams: 85, dryWeightGrams: 35 },
      ],
    });
    expect(result).toMatchObject({
      status: "complete",
      totalBloodLossMl: 950,
      knownBloodLossMl: 950,
      containerBloodLossMl: 500,
      materialBloodLossMl: 450,
      missingFields: [],
      gramsPerMilliliterAssumption: 1,
    });
  });

  test("supports a complete material-only measurement", () => {
    const result = calculateQuantifiedBloodLoss({
      containers: [],
      materials: [{ wetWeightGrams: 315.5, dryWeightGrams: 115 }],
    });
    expect(result.status).toBe("complete");
    expect(result.totalBloodLossMl).toBeCloseTo(200.5);
  });

  test("matches the canonical 150 mL material plus 300 mL canister case", () => {
    const result = calculateQuantifiedBloodLoss({
      containers: [{ collectedFluidMl: 500, nonBloodFluidMl: 200 }],
      materials: [{ wetWeightGrams: 180, dryWeightGrams: 30 }],
    });
    expect(result.totalBloodLossMl).toBe(450);
    expect(result.policy.id).toBe("ACOG-CO794-QBL");
  });

  test("reports partial arithmetic but never promotes it to a complete total", () => {
    const result = calculateQuantifiedBloodLoss({
      containers: [
        { collectedFluidMl: 800, nonBloodFluidMl: null },
        { collectedFluidMl: 100, nonBloodFluidMl: 20 },
      ],
      materials: [
        { wetWeightGrams: 300, dryWeightGrams: 100 },
        { wetWeightGrams: null, dryWeightGrams: 20 },
      ],
    });
    expect(result.status).toBe("incomplete");
    expect(result.totalBloodLossMl).toBeNull();
    expect(result.knownBloodLossMl).toBe(280);
    expect(result.missingFields).toEqual([
      "containers[0].nonBloodFluidMl",
      "materials[1].wetWeightGrams",
    ]);
  });

  test("rejects empty, negative, reversed, and non-finite measurements", () => {
    expect(() =>
      calculateQuantifiedBloodLoss({ containers: [], materials: [] }),
    ).toThrow("At least one container or weighted material");
    expect(() =>
      calculateQuantifiedBloodLoss({
        containers: [{ collectedFluidMl: -1, nonBloodFluidMl: 0 }],
        materials: [],
      }),
    ).toThrow("must be at least 0");
    expect(() =>
      calculateQuantifiedBloodLoss({
        containers: [{ collectedFluidMl: 100, nonBloodFluidMl: 101 }],
        materials: [],
      }),
    ).toThrow("cannot exceed collectedFluidMl");
    expect(() =>
      calculateQuantifiedBloodLoss({
        containers: [],
        materials: [{ wetWeightGrams: 99, dryWeightGrams: 100 }],
      }),
    ).toThrow("cannot exceed wetWeightGrams");
    expect(() =>
      calculateQuantifiedBloodLoss({
        containers: [{ collectedFluidMl: Number.NaN, nonBloodFluidMl: 0 }],
        materials: [],
      }),
    ).toThrow("must be a finite number");
  });
});

test.describe("obstetrics maternal shock index", () => {
  test("calculates and rounds for display without replacing the raw ratio", () => {
    const result = calculateMaternalShockIndex({
      heartRateBpm: 101,
      systolicBloodPressureMmHg: 80,
    });
    expect(result.shockIndex).toBe(101 / 80);
    expect(result.roundedShockIndex).toBe(1.26);
    expect(result.exceedsWhoAbnormalThreshold).toBe(true);
    expect(result.policy.abnormalRule).toBe("strictly_greater_than");
  });

  test("does not flag a value exactly equal to the strict WHO threshold", () => {
    expect(
      calculateMaternalShockIndex({
        heartRateBpm: 100,
        systolicBloodPressureMmHg: 100,
      }).exceedsWhoAbnormalThreshold,
    ).toBe(false);
  });

  test("rejects zero, negative, and non-finite vital signs", () => {
    expect(() =>
      calculateMaternalShockIndex({
        heartRateBpm: 100,
        systolicBloodPressureMmHg: 0,
      }),
    ).toThrow("systolicBloodPressureMmHg must be greater than zero");
    expect(() =>
      calculateMaternalShockIndex({
        heartRateBpm: -1,
        systolicBloodPressureMmHg: 100,
      }),
    ).toThrow("heartRateBpm must be greater than zero");
    expect(() =>
      calculateMaternalShockIndex({
        heartRateBpm: Number.POSITIVE_INFINITY,
        systolicBloodPressureMmHg: 100,
      }),
    ).toThrow("heartRateBpm must be a finite number");
  });

  test("applies the WHO blood-loss plus hemodynamics rule as a separate tri-state assessment", () => {
    expect(
      assessWhoPostpartumHemorrhageCriterion({
        bloodLossMl: 500,
        heartRateBpm: null,
        systolicBloodPressureMmHg: null,
        diastolicBloodPressureMmHg: null,
      }),
    ).toMatchObject({
      status: "meets",
      triggers: ["blood_loss_at_least_500_ml"],
    });

    expect(
      assessWhoPostpartumHemorrhageCriterion({
        bloodLossMl: 300,
        heartRateBpm: 101,
        systolicBloodPressureMmHg: 110,
        diastolicBloodPressureMmHg: 70,
      }),
    ).toMatchObject({
      status: "meets",
      abnormalHemodynamics: true,
      triggers: [
        "blood_loss_at_least_300_ml_with_abnormal_hemodynamics",
        "heart_rate_above_100",
      ],
    });

    expect(
      assessWhoPostpartumHemorrhageCriterion({
        bloodLossMl: 300,
        heartRateBpm: 90,
        systolicBloodPressureMmHg: null,
        diastolicBloodPressureMmHg: null,
      }).status,
    ).toBe("indeterminate");

    expect(
      assessWhoPostpartumHemorrhageCriterion({
        bloodLossMl: 299,
        heartRateBpm: null,
        systolicBloodPressureMmHg: null,
        diastolicBloodPressureMmHg: null,
      }).status,
    ).toBe("does_not_meet");
  });
});

test.describe("obstetrics Apgar score", () => {
  test("calculates the minimum, moderate, and maximum scores", () => {
    expect(
      calculateApgar({
        minute: 5,
        appearance: 0,
        pulse: 0,
        grimace: 0,
        activity: 0,
        respiration: 0,
      }),
    ).toMatchObject({ total: 0, category: "low" });

    expect(
      calculateApgar({
        minute: 5,
        appearance: 1,
        pulse: 1,
        grimace: 1,
        activity: 1,
        respiration: 1,
      }),
    ).toMatchObject({
      total: 5,
      category: "moderately_abnormal",
      repeatDocumentationEveryFiveMinutesUntil20: true,
    });

    expect(
      calculateApgar({
        minute: 5,
        appearance: 2,
        pulse: 2,
        grimace: 2,
        activity: 2,
        respiration: 2,
      }),
    ).toMatchObject({
      total: 10,
      category: "reassuring",
      categoryIsValidatedForFiveMinuteScore: true,
    });
  });

  test("keeps the one-minute score but marks the five-minute interpretation context", () => {
    const result = calculateApgar({
      minute: 1,
      appearance: 2,
      pulse: 2,
      grimace: 2,
      activity: 2,
      respiration: 2,
    });
    expect(result.total).toBe(10);
    expect(result.categoryIsValidatedForFiveMinuteScore).toBe(false);
    expect(result.note).toContain("does not determine whether initial resuscitation");
    expect(result.policy.reaffirmed).toBe("2025");
  });

  test("stops the every-five-minute reminder at minute 20", () => {
    const result = calculateApgar({
      minute: 20,
      appearance: 1,
      pulse: 2,
      grimace: 1,
      activity: 1,
      respiration: 1,
    });
    expect(result.total).toBe(6);
    expect(result.repeatDocumentationEveryFiveMinutesUntil20).toBe(false);
  });

  test("rejects invalid component scores and unsupported assessment minutes", () => {
    expect(() =>
      calculateApgar({
        minute: 5,
        appearance: 3,
        pulse: 2,
        grimace: 2,
        activity: 2,
        respiration: 2,
      } as unknown as ApgarInput),
    ).toThrow("appearance must be at most 2");
    expect(() =>
      calculateApgar({
        minute: 2,
        appearance: 2,
        pulse: 2,
        grimace: 2,
        activity: 2,
        respiration: 2,
      } as unknown as ApgarInput),
    ).toThrow("minute must be 1, 5, 10, 15, or 20");
  });
});
