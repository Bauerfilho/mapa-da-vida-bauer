import { expect, test } from "@playwright/test";
import {
  brlMoneyKnowledge,
  firstValidationIssue,
  hasAnyRecordedValue,
  headacheDetailsIssue,
  medicationSosConfirmationIssue,
  medicationSosUseKnowledge,
  otherInstitutionIssue,
  rangedNumberKnowledge,
  routineTaskKnowledge,
  sleepChronologyIssue,
} from "../src/features/domainFormValidation";

test.describe("brlMoneyKnowledge", () => {
  test("uses the canonical Brazilian parser and preserves explicit zero", () => {
    expect(brlMoneyKnowledge("1.234,56")).toMatchObject({
      state: "known",
      value: { amountMinor: 123_456, currency: "BRL" },
    });
    expect(brlMoneyKnowledge("10,5")).toMatchObject({
      state: "known",
      value: { amountMinor: 1_050, currency: "BRL" },
    });
    expect(brlMoneyKnowledge("0,00")).toMatchObject({
      state: "known",
      value: { amountMinor: 0, currency: "BRL" },
    });
    expect(brlMoneyKnowledge(" ")).toEqual({
      state: "unknown",
      reason: "not_recorded",
    });
  });

  test("rejects dot decimals, negatives, scientific notation and excess cents", () => {
    for (const value of ["1.23", "1234.56", "-1,00", "1e3", "1,234"]) {
      expect(brlMoneyKnowledge(value)).toEqual({
        state: "invalid",
        issueCodes: ["invalid_brl_amount"],
      });
    }
  });
});

test.describe("rangedNumberKnowledge", () => {
  test("keeps blank unknown and explicit zero known", () => {
    expect(rangedNumberKnowledge("", { min: 0 })).toEqual({
      state: "unknown",
      reason: "not_recorded",
    });
    expect(rangedNumberKnowledge("0", { min: 0 })).toMatchObject({
      state: "known",
      value: 0,
    });
  });

  test("enforces non-negative, integer and maximum constraints", () => {
    expect(rangedNumberKnowledge("-1", { min: 0 })).toMatchObject({
      state: "invalid",
      issueCodes: ["below_minimum"],
    });
    expect(rangedNumberKnowledge("1,5", { min: 0, integer: true })).toMatchObject({
      state: "invalid",
      issueCodes: ["integer_required"],
    });
    expect(rangedNumberKnowledge("101", { min: 0, max: 100 })).toMatchObject({
      state: "invalid",
      issueCodes: ["above_maximum"],
    });
    expect(rangedNumberKnowledge("Infinity", { min: 0 })).toMatchObject({
      state: "invalid",
      issueCodes: ["invalid_number"],
    });
  });
});

test("empty-save gating distinguishes unknown from explicit false and zero", () => {
  expect(hasAnyRecordedValue(["", null, undefined, new Set()])).toBe(false);
  expect(hasAnyRecordedValue([false])).toBe(true);
  expect(hasAnyRecordedValue([0])).toBe(true);
  expect(hasAnyRecordedValue([["", [null, "registrado"]]])).toBe(true);
  expect(firstValidationIssue(false, [])).toBe("Registre ao menos um fato antes de salvar.");
  expect(firstValidationIssue(true, [])).toBeNull();
  expect(firstValidationIssue(true, [null, "Valor inválido"])).toBe("Valor inválido");
});

test("contextual gates require confirmed headache truth and named other institution", () => {
  expect(headacheDetailsIssue(null, true)).toContain("Confirme se há cefaleia");
  expect(headacheDetailsIssue(true, true)).toBeNull();
  expect(headacheDetailsIssue(false, true)).toBeNull();
  expect(otherInstitutionIssue("Outro informado", "  ")).toContain("nome da outra instituição");
  expect(otherInstitutionIssue("Outro informado", "Cooperativa X")).toBeNull();
  expect(otherInstitutionIssue("Banco do Brasil", "")).toBeNull();
});

test("SOS medication records require an explicit occurrence while allowing an unknown clock", () => {
  expect(medicationSosConfirmationIssue("sos", null)).toContain("Confirme que o uso SOS aconteceu");
  expect(medicationSosConfirmationIssue("sos", false)).toContain("Confirme que o uso SOS aconteceu");
  expect(medicationSosConfirmationIssue("sos", true)).toBeNull();

  expect(medicationSosUseKnowledge("sos", true)).toEqual({
    state: "known",
    value: true,
    source: "user",
  });
  expect(medicationSosUseKnowledge("sos", null)).toEqual({
    state: "unknown",
    reason: "not_confirmed",
  });
  expect(medicationSosUseKnowledge("regimen", true)).toEqual({
    state: "not_applicable",
    reasonCode: "regimen_record",
  });
  expect(medicationSosUseKnowledge("stock", true)).toEqual({
    state: "not_applicable",
    reasonCode: "stock_record",
  });
});

test("routine priorities are not known until a task has a title", () => {
  expect(routineTaskKnowledge("", null, "essential")).toEqual({
    title: { state: "unknown", reason: "not_recorded" },
    status: { state: "not_applicable", reasonCode: "task_not_defined" },
    priority: { state: "not_applicable", reasonCode: "task_not_defined" },
  });
  expect(routineTaskKnowledge("Revisar CTG", "planned", "essential")).toMatchObject({
    title: { state: "known", value: "Revisar CTG" },
    status: { state: "known", value: "planned" },
    priority: { state: "known", value: "essential" },
  });
});

test("sleep chronology rejects impossible near-day rollovers and awake time above the sleep period", () => {
  expect(sleepChronologyIssue("23:00", "22:00", "07:00", "07:15", rangedNumberKnowledge("0")))
    .toContain("revise os horários");
  expect(sleepChronologyIssue("23:00", "23:30", "07:00", "07:15", rangedNumberKnowledge("451")))
    .toContain("não podem superar");
  expect(sleepChronologyIssue("23:00", "23:30", "07:00", "07:15", rangedNumberKnowledge("30")))
    .toBeNull();
});
