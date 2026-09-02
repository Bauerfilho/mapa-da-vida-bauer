import { parseBRLMinorUnits } from "../domain/finance";
import { durationMinutes } from "../domain/analytics";
import {
  invalidKnowledge,
  known,
  notApplicable,
  unknown,
  type Knowledge,
  type Money,
} from "../domain/model";

export interface NumberKnowledgeOptions {
  integer?: boolean;
  min?: number;
  max?: number;
}

const PLAIN_DECIMAL_PATTERN = /^-?\d+(?:[.,]\d+)?$/;

/**
 * Parses a user-entered scalar without accepting scientific notation,
 * infinities, or values outside the field's declared clinical/routine range.
 */
export function rangedNumberKnowledge(
  value: string,
  options: NumberKnowledgeOptions = {},
): Knowledge<number> {
  const clean = value.trim();
  if (!clean) return unknown("not_recorded");
  if (!PLAIN_DECIMAL_PATTERN.test(clean)) {
    return invalidKnowledge("invalid_number");
  }

  const parsed = Number(clean.replace(",", "."));
  if (!Number.isFinite(parsed)) return invalidKnowledge("invalid_number");
  if (options.integer && !Number.isInteger(parsed)) {
    return invalidKnowledge("integer_required");
  }
  if (options.min !== undefined && parsed < options.min) {
    return invalidKnowledge("below_minimum");
  }
  if (options.max !== undefined && parsed > options.max) {
    return invalidKnowledge("above_maximum");
  }
  return known(parsed);
}

/** Brazilian currency is parsed once, by the canonical integer-cent parser. */
export function brlMoneyKnowledge(value: string): Knowledge<Money> {
  if (!value.trim()) return unknown("not_recorded");
  try {
    return known({ amountMinor: parseBRLMinorUnits(value), currency: "BRL" });
  } catch {
    return invalidKnowledge("invalid_brl_amount");
  }
}

export function knowledgeValidationIssue<T>(
  label: string,
  value: Knowledge<T>,
): string | null {
  if (value.state !== "invalid") return null;
  if (value.issueCodes.includes("integer_required")) {
    return `${label} precisa ser um número inteiro.`;
  }
  if (value.issueCodes.includes("below_minimum")) {
    return `${label} não pode ser negativo.`;
  }
  if (value.issueCodes.includes("above_maximum")) {
    return `${label} está fora do limite aceito.`;
  }
  if (value.issueCodes.includes("invalid_brl_amount")) {
    return `${label} precisa usar o formato brasileiro, por exemplo 1.234,56.`;
  }
  return `${label} contém um número inválido.`;
}

function isRecordedValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return Boolean(value.trim());
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (value instanceof Set) return value.size > 0;
  if (Array.isArray(value)) return value.some(isRecordedValue);
  return true;
}

/** False and zero are explicit facts; blank strings, null and empty sets are not. */
export function hasAnyRecordedValue(values: readonly unknown[]): boolean {
  return values.some(isRecordedValue);
}

export function firstValidationIssue(
  hasMeaningfulValue: boolean,
  issues: readonly (string | null | undefined)[],
  emptyMessage = "Registre ao menos um fato antes de salvar.",
): string | null {
  return issues.find((issue): issue is string => Boolean(issue)) ??
    (hasMeaningfulValue ? null : emptyMessage);
}

export function headacheDetailsIssue(
  presence: boolean | null,
  hasDetails: boolean,
): string | null {
  return presence === null && hasDetails
    ? "Confirme se há cefaleia antes de salvar os detalhes da crise."
    : null;
}

export function otherInstitutionIssue(
  institutionChoice: string | null,
  otherInstitution: string,
): string | null {
  return institutionChoice === "Outro informado" && !otherInstitution.trim()
    ? "Informe o nome da outra instituição."
    : null;
}

export type MedicationDetailMode = "regimen" | "stock" | "sos";

/**
 * A medication-sos event is an occurrence, so descriptive fields alone must
 * never be enough to create it. Clock time remains optional because an
 * explicitly confirmed use can be truthful even when its time is unknown.
 */
export function medicationSosConfirmationIssue(
  mode: MedicationDetailMode,
  useConfirmed: boolean | null,
): string | null {
  return mode === "sos" && useConfirmed !== true
    ? "Confirme que o uso SOS aconteceu para criar este registro."
    : null;
}

/** Keeps the SOS occurrence fact explicit and other record branches disjoint. */
export function medicationSosUseKnowledge(
  mode: MedicationDetailMode,
  useConfirmed: boolean | null,
): Knowledge<boolean> {
  if (mode !== "sos") return notApplicable(`${mode}_record`);
  return useConfirmed === true ? known(true) : unknown("not_confirmed");
}

/**
 * Guards the clock-only sleep chronology against near-day rollovers that are
 * almost certainly a mistaken field/date. The limits are data-quality gates,
 * not sleep recommendations or diagnoses.
 */
export function sleepChronologyIssue(
  wentToBedLocal: string,
  sleepOnsetLocal: string,
  finalWakeLocal: string,
  leftBedLocal: string,
  awakeMinutes: Knowledge<number>,
): string | null {
  const latency = wentToBedLocal && sleepOnsetLocal
    ? durationMinutes(wentToBedLocal, sleepOnsetLocal)
    : null;
  const sleepPeriod = sleepOnsetLocal && finalWakeLocal
    ? durationMinutes(sleepOnsetLocal, finalWakeLocal)
    : null;
  const riseDelay = finalWakeLocal && leftBedLocal
    ? durationMinutes(finalWakeLocal, leftBedLocal)
    : null;

  if (latency !== null && latency > 720) {
    return "A ordem entre deitar e adormecer parece atravessar quase um dia; revise os horários.";
  }
  if (sleepPeriod !== null && sleepPeriod > 1_200) {
    return "O intervalo entre adormecer e acordar ultrapassa 20 horas; revise os horários.";
  }
  if (riseDelay !== null && riseDelay > 720) {
    return "A ordem entre acordar e levantar parece atravessar quase um dia; revise os horários.";
  }
  if (sleepPeriod !== null && awakeMinutes.state === "known" && awakeMinutes.value > sleepPeriod) {
    return "Os minutos acordado não podem superar o intervalo entre adormecer e acordar.";
  }
  return null;
}

export function routineTaskKnowledge(
  title: string,
  status: string | null,
  priority: string | null,
): {
  title: Knowledge<string>;
  status: Knowledge<string>;
  priority: Knowledge<string>;
} {
  const cleanTitle = title.trim();
  if (!cleanTitle) {
    return {
      title: unknown("not_recorded"),
      status: { state: "not_applicable", reasonCode: "task_not_defined" },
      priority: { state: "not_applicable", reasonCode: "task_not_defined" },
    };
  }
  return {
    title: known(cleanTitle),
    status: status ? known(status) : unknown("not_confirmed"),
    priority: priority ? known(priority) : unknown("not_confirmed"),
  };
}
