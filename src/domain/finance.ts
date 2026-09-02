import type {
  GenericPayload,
  ISOInstant,
  Knowledge,
  LocalDate,
  Money,
} from "./model";
import { assertLocalDate, shiftLocalDate } from "./dates";

declare const brlMinorUnitsBrand: unique symbol;
declare const annualPercentageRateBpsBrand: unique symbol;

/** Integer centavos. Negative values are reserved for derived deltas; persisted
 * transaction, bill, debt, budget, and goal amounts are validated as >= 0. */
export type BRLMinorUnits = number & {
  readonly [brlMinorUnitsBrand]: "BRLMinorUnits";
};

/** One basis point is 0.01 percentage point (1250 = 12.50% APR). */
export type AnnualPercentageRateBps = number & {
  readonly [annualPercentageRateBpsBrand]: "AnnualPercentageRateBps";
};

export interface BRLMoney {
  amountMinor: BRLMinorUnits;
  currency: "BRL";
}

export const LISTED_FINANCE_PROVIDERS = [
  "Mercado Pago",
  "Banco do Brasil",
  "PicPay",
] as const;

export type ListedFinanceProviderName =
  (typeof LISTED_FINANCE_PROVIDERS)[number];

export type FinanceProvider =
  | {
      kind: "listed";
      name: ListedFinanceProviderName;
    }
  | {
      kind: "other";
      name: string;
    };

export type FinanceSubscriptionStatus =
  | "active_confirmed"
  | "trial_confirmed"
  | "cancelled_confirmed"
  | "uncertain";

/**
 * Stored shape used by the first subscription journey. It intentionally stays
 * a generic.event until a future, explicit data migration introduces a
 * canonical subscription entity.
 */
export interface FinanceSubscriptionPayloadCandidate extends GenericPayload {
  eventKind: "finance-subscription";
  subscription: Record<string, unknown>;
}

export interface ParsedFinanceSubscription {
  payload: FinanceSubscriptionPayloadCandidate;
  institution: Knowledge<string>;
  service: Knowledge<string>;
  price: Knowledge<Money>;
  cadence: Knowledge<string>;
  renewalDate: Knowledge<LocalDate>;
  status: Knowledge<FinanceSubscriptionStatus>;
}

export interface UpdateFinanceSubscriptionStatusInput {
  entityId: string;
  expectedRevision: number;
  status: FinanceSubscriptionStatus;
  justification: string;
  occurredAtUTC?: ISOInstant;
}

const FINANCE_SUBSCRIPTION_STATUSES = new Set<FinanceSubscriptionStatus>([
  "active_confirmed",
  "trial_confirmed",
  "cancelled_confirmed",
  "uncertain",
]);

const KNOWLEDGE_SOURCES = new Set([
  "user",
  "confirmed_schedule",
  "imported",
  "derived",
]);

const UNKNOWN_REASONS = new Set([
  "not_recorded",
  "not_confirmed",
  "not_provided",
  "legacy_ambiguous",
  "withheld",
  "conflict",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function legacyAmbiguous<T>(): Knowledge<T> {
  return { state: "unknown", reason: "legacy_ambiguous" };
}

function normalizeKnowledge<T>(
  value: unknown,
  normalizeKnown: (candidate: unknown) => T | null,
): Knowledge<T> {
  if (!isRecord(value) || typeof value.state !== "string") {
    return legacyAmbiguous<T>();
  }
  if (value.state === "known") {
    const normalized = normalizeKnown(value.value);
    if (normalized === null || !KNOWLEDGE_SOURCES.has(String(value.source))) {
      return legacyAmbiguous<T>();
    }
    return {
      state: "known",
      value: normalized,
      source: value.source as Extract<Knowledge<T>, { state: "known" }>["source"],
      ...(typeof value.recordedAt === "string" ? { recordedAt: value.recordedAt } : {}),
    };
  }
  if (value.state === "unknown" && UNKNOWN_REASONS.has(String(value.reason))) {
    return value as Knowledge<T>;
  }
  if (value.state === "confirmed_absent") {
    return {
      state: "confirmed_absent",
      ...(typeof value.reasonCode === "string" ? { reasonCode: value.reasonCode } : {}),
    };
  }
  if (value.state === "not_applicable" && typeof value.reasonCode === "string") {
    return { state: "not_applicable", reasonCode: value.reasonCode };
  }
  if (
    value.state === "invalid" &&
    Array.isArray(value.issueCodes) &&
    value.issueCodes.every((code) => typeof code === "string")
  ) {
    return { state: "invalid", issueCodes: [...value.issueCodes] };
  }
  return legacyAmbiguous<T>();
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeMoney(value: unknown): Money | null {
  if (
    !isRecord(value) ||
    value.currency !== "BRL" ||
    !Number.isSafeInteger(value.amountMinor) ||
    Number(value.amountMinor) < 0
  ) {
    return null;
  }
  return { amountMinor: Number(value.amountMinor), currency: "BRL" };
}

function normalizeLocalDate(value: unknown): LocalDate | null {
  if (typeof value !== "string") return null;
  try {
    assertLocalDate(value);
    return value;
  } catch {
    return null;
  }
}

export function isFinanceSubscriptionStatus(
  value: unknown,
): value is FinanceSubscriptionStatus {
  return typeof value === "string" &&
    FINANCE_SUBSCRIPTION_STATUSES.has(value as FinanceSubscriptionStatus);
}

function normalizeSubscriptionStatus(value: unknown): FinanceSubscriptionStatus | null {
  return isFinanceSubscriptionStatus(value) ? value : null;
}

export function isFinanceSubscriptionPayload(
  value: unknown,
): value is FinanceSubscriptionPayloadCandidate {
  return isRecord(value) &&
    value.eventKind === "finance-subscription" &&
    isRecord(value.subscription);
}

/**
 * Parses both the current payload and incomplete legacy variants. Missing or
 * malformed fields stay explicitly unknown instead of being promoted to facts.
 */
export function parseFinanceSubscriptionPayload(
  value: unknown,
): ParsedFinanceSubscription | null {
  if (!isFinanceSubscriptionPayload(value)) return null;
  return {
    payload: value,
    institution: normalizeKnowledge(value.institution, normalizeString),
    service: normalizeKnowledge(value.subscription.service, normalizeString),
    price: normalizeKnowledge(value.subscription.price, normalizeMoney),
    cadence: normalizeKnowledge(value.subscription.cadence, normalizeString),
    renewalDate: normalizeKnowledge(value.subscription.renewalDate, normalizeLocalDate),
    status: normalizeKnowledge(value.subscription.status, normalizeSubscriptionStatus),
  };
}

export function financeSubscriptionIsConfirmedActive(value: unknown): boolean {
  const parsed = parseFinanceSubscriptionPayload(value);
  return parsed?.status.state === "known" &&
    parsed.status.value === "active_confirmed";
}

export function listedFinanceProvider(
  name: ListedFinanceProviderName,
): FinanceProvider {
  return { kind: "listed", name };
}

export function otherFinanceProvider(name: string): FinanceProvider {
  const normalized = name.trim();
  if (!normalized) {
    throw new Error("O nome do outro provedor financeiro precisa ser informado.");
  }
  if ((LISTED_FINANCE_PROVIDERS as readonly string[]).includes(normalized)) {
    throw new Error("Use um provedor listado para Mercado Pago, Banco do Brasil ou PicPay.");
  }
  return { kind: "other", name: normalized };
}

export function assertFinanceProvider(provider: FinanceProvider): void {
  if (
    provider === null ||
    typeof provider !== "object" ||
    Object.keys(provider).some((key) => key !== "kind" && key !== "name")
  ) {
    throw new Error("O provedor financeiro contém campos não permitidos.");
  }
  if (provider.kind === "listed") {
    if (!(LISTED_FINANCE_PROVIDERS as readonly string[]).includes(provider.name)) {
      throw new Error("Provedor financeiro listado inválido.");
    }
    return;
  }
  if (provider.kind !== "other" || !provider.name.trim()) {
    throw new Error("O outro provedor financeiro precisa ter um nome.");
  }
  if (provider.name !== provider.name.trim()) {
    throw new Error("O nome do outro provedor financeiro não pode ter espaços nas bordas.");
  }
  if ((LISTED_FINANCE_PROVIDERS as readonly string[]).includes(provider.name.trim())) {
    throw new Error("Use um provedor listado para Mercado Pago, Banco do Brasil ou PicPay.");
  }
}

export function asBRLMinorUnits(value: number): BRLMinorUnits {
  if (!Number.isSafeInteger(value)) {
    throw new Error("O valor em centavos de BRL precisa ser um inteiro seguro.");
  }
  return value as BRLMinorUnits;
}

export function asAnnualPercentageRateBps(
  value: number,
): AnnualPercentageRateBps {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("A taxa anual precisa ser informada em basis points não negativos.");
  }
  return value as AnnualPercentageRateBps;
}

/**
 * Parses Brazilian display amounts without floating point arithmetic.
 * Accepted examples: `1234`, `10,5`, `1.234,56`, and `R$ 1.234,56`.
 */
function parseBRLDisplayMinorUnits(
  input: string,
  allowNegative: boolean,
): BRLMinorUnits {
  let normalized = input
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/[\u00a0\s]/g, "");
  let sign = 1;
  if (allowNegative && normalized.startsWith("-")) {
    sign = -1;
    normalized = normalized.slice(1);
  }
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(normalized);
  if (!match) {
    throw new Error("Valor BRL inválido. Use centavos com vírgula, por exemplo 1.234,56.");
  }

  const wholeReais = match[1].replace(/\./g, "");
  const cents = (match[2] ?? "").padEnd(2, "0");
  const absoluteMinor = Number(wholeReais) * 100 + Number(cents || "0");
  const amountMinor = absoluteMinor === 0 ? 0 : sign * absoluteMinor;
  return asBRLMinorUnits(amountMinor);
}

export function parseBRLMinorUnits(input: string): BRLMinorUnits {
  return parseBRLDisplayMinorUnits(input, false);
}

/**
 * Parses a manually confirmed account balance. Unlike obligations and
 * expenses, an account snapshot may truthfully be negative (for example,
 * overdraft use), so this parser accepts one leading minus sign.
 */
export function parseSignedBRLMinorUnits(input: string): BRLMinorUnits {
  return parseBRLDisplayMinorUnits(input, true);
}

export function brlMoney(amountMinor: BRLMinorUnits): BRLMoney {
  asBRLMinorUnits(amountMinor);
  return { amountMinor, currency: "BRL" };
}

export type FinanceTransactionDirection = "income" | "expense";
export type FinanceTransactionStatus = "pending" | "posted" | "voided";
export type FinanceBillStatus =
  | "scheduled"
  | "due"
  | "paid"
  | "overdue"
  | "cancelled";
export type FinanceDebtStatus =
  | "active"
  | "paid"
  | "paused"
  | "defaulted"
  | "disputed";
export type FinanceBudgetStatus = "active" | "paused" | "closed";
export type FinanceGoalStatus = "active" | "achieved" | "paused" | "cancelled";
export type FinanceCardStatus = "active" | "paused" | "closed";
export type FinanceAccountKind = "checking" | "wallet" | "credit" | "other";

export type FinanceStatusByEntityType = {
  "financas.transaction": FinanceTransactionStatus;
  "financas.bill": FinanceBillStatus;
  "financas.debt": FinanceDebtStatus;
  "financas.budget": FinanceBudgetStatus;
  "financas.goal": FinanceGoalStatus;
  "financas.card": FinanceCardStatus;
};

export interface FinanceTransactionPayload {
  provider: FinanceProvider;
  direction: FinanceTransactionDirection;
  amount: BRLMoney;
  transactionDate: LocalDate;
  settledDate: Knowledge<LocalDate>;
  status: FinanceTransactionStatus;
  category: Knowledge<string>;
  description: Knowledge<string>;
}

export interface FinanceBillPayload {
  provider: FinanceProvider;
  label: string;
  amount: Knowledge<BRLMoney>;
  dueDate: Knowledge<LocalDate>;
  paidDate: Knowledge<LocalDate>;
  interestCharged: Knowledge<BRLMoney>;
  status: FinanceBillStatus;
  note: Knowledge<string>;
}

export interface FinanceDebtPayload {
  provider: FinanceProvider;
  label: string;
  originalPrincipal: Knowledge<BRLMoney>;
  outstandingBalance: Knowledge<BRLMoney>;
  annualPercentageRateBps: Knowledge<AnnualPercentageRateBps>;
  interestCharged: Knowledge<BRLMoney>;
  balanceAsOfLocalDate: Knowledge<LocalDate>;
  dueDate: Knowledge<LocalDate>;
  status: FinanceDebtStatus;
  note: Knowledge<string>;
}

export interface FinanceBudgetPayload {
  provider: FinanceProvider;
  label: string;
  limit: BRLMoney;
  spentAmount: Knowledge<BRLMoney>;
  periodStartLocalDate: LocalDate;
  periodEndLocalDate: LocalDate;
  status: FinanceBudgetStatus;
  note: Knowledge<string>;
}

export interface FinanceGoalPayload {
  provider: FinanceProvider;
  label: string;
  targetAmount: BRLMoney;
  accumulatedAmount: Knowledge<BRLMoney>;
  targetDate: Knowledge<LocalDate>;
  status: FinanceGoalStatus;
  note: Knowledge<string>;
}

export interface FinanceCardInstallmentPayload {
  id: string;
  label: string;
  purchaseTotal: Knowledge<BRLMoney>;
  installmentAmount: Knowledge<BRLMoney>;
  totalInstallments: Knowledge<number>;
  remainingInstallments: Knowledge<number>;
  nextDueDate: Knowledge<LocalDate>;
  finalDueDate: Knowledge<LocalDate>;
}

/** A manually confirmed card snapshot. It intentionally excludes PAN, CVV,
 * credentials, tokens and every field that could move money. */
export interface FinanceCardPayload {
  provider: FinanceProvider;
  label: string;
  closingDate: Knowledge<LocalDate>;
  dueDate: Knowledge<LocalDate>;
  statedCreditLimit: Knowledge<BRLMoney>;
  currentBalance: Knowledge<BRLMoney>;
  currentStatementAmount: Knowledge<BRLMoney>;
  minimumPayment: Knowledge<BRLMoney>;
  annualPercentageRateBps: Knowledge<AnnualPercentageRateBps>;
  balanceAsOfLocalDate: Knowledge<LocalDate>;
  installments: FinanceCardInstallmentPayload[];
  status: FinanceCardStatus;
  note: Knowledge<string>;
}

interface FinanceCreateInputBase {
  provider: FinanceProvider;
  occurredAtUTC?: ISOInstant;
}

export interface CreateFinanceTransactionInput extends FinanceCreateInputBase {
  direction: FinanceTransactionDirection;
  amountMinor: BRLMinorUnits;
  transactionDate: LocalDate;
  settledDate?: LocalDate;
  status: FinanceTransactionStatus;
  category?: string;
  description?: string;
}

export interface CreateFinanceBillInput extends FinanceCreateInputBase {
  label: string;
  amountMinor?: BRLMinorUnits;
  dueDate?: LocalDate;
  paidDate?: LocalDate;
  interestChargedMinor?: BRLMinorUnits;
  status: FinanceBillStatus;
  note?: string;
}

export interface CreateFinanceDebtInput extends FinanceCreateInputBase {
  label: string;
  originalPrincipalMinor?: BRLMinorUnits;
  outstandingBalanceMinor?: BRLMinorUnits;
  annualPercentageRateBps?: AnnualPercentageRateBps;
  interestChargedMinor?: BRLMinorUnits;
  balanceAsOfLocalDate?: LocalDate;
  dueDate?: LocalDate;
  status: FinanceDebtStatus;
  note?: string;
}

export interface CreateFinanceBudgetInput extends FinanceCreateInputBase {
  label: string;
  limitMinor: BRLMinorUnits;
  spentAmountMinor?: BRLMinorUnits;
  periodStartLocalDate: LocalDate;
  periodEndLocalDate: LocalDate;
  status: FinanceBudgetStatus;
  note?: string;
}

export interface CreateFinanceGoalInput extends FinanceCreateInputBase {
  label: string;
  targetAmountMinor: BRLMinorUnits;
  accumulatedAmountMinor?: BRLMinorUnits;
  targetDate?: LocalDate;
  status: FinanceGoalStatus;
  note?: string;
}

export interface CreateFinanceCardInstallmentInput {
  id?: string;
  label: string;
  purchaseTotalMinor?: BRLMinorUnits;
  installmentAmountMinor?: BRLMinorUnits;
  totalInstallments?: number;
  remainingInstallments?: number;
  nextDueDate?: LocalDate;
  finalDueDate?: LocalDate;
}

export interface CreateFinanceCardInput extends FinanceCreateInputBase {
  label: string;
  closingDate?: LocalDate;
  dueDate?: LocalDate;
  statedCreditLimitMinor?: BRLMinorUnits;
  currentBalanceMinor?: BRLMinorUnits;
  currentStatementAmountMinor?: BRLMinorUnits;
  minimumPaymentMinor?: BRLMinorUnits;
  annualPercentageRateBps?: AnnualPercentageRateBps;
  balanceAsOfLocalDate?: LocalDate;
  installments?: readonly CreateFinanceCardInstallmentInput[];
  status: FinanceCardStatus;
  note?: string;
}

interface FinanceUpdateInputBase {
  entityId: string;
  expectedRevision: number;
  occurredAtUTC?: ISOInstant;
}

/**
 * A complete, user-confirmed snapshot of one of the three seeded accounts.
 * Credentials, account numbers and payment-capable fields are deliberately
 * absent from this contract.
 */
export interface UpdateFinanceAccountInput extends FinanceUpdateInputBase {
  /** `null` explicitly records that the field was not provided. */
  accountKind: FinanceAccountKind | null;
  /** Signed because an account snapshot may be overdrawn; `null` is unknown. */
  balanceMinor: BRLMinorUnits | null;
  /** `null` explicitly clears an earlier manually confirmed date. */
  dueDate: LocalDate | null;
}

type FinancePatchInput<TPayload extends { status: string }> =
  | {
      /** Status changes are a separate compare-and-swap dimension. */
      expectedStatus: TPayload["status"];
      patch: Partial<Omit<TPayload, "status">> & {
        status: TPayload["status"];
      };
    }
  | {
      expectedStatus?: never;
      patch: Partial<Omit<TPayload, "status">> & { status?: never };
    };

export type UpdateFinanceRecordInput =
  | (FinanceUpdateInputBase & FinancePatchInput<FinanceTransactionPayload> & {
      type: "financas.transaction";
    })
  | (FinanceUpdateInputBase & FinancePatchInput<FinanceBillPayload> & {
      type: "financas.bill";
    })
  | (FinanceUpdateInputBase & FinancePatchInput<FinanceDebtPayload> & {
      type: "financas.debt";
    })
  | (FinanceUpdateInputBase & FinancePatchInput<FinanceBudgetPayload> & {
      type: "financas.budget";
    })
  | (FinanceUpdateInputBase & FinancePatchInput<FinanceGoalPayload> & {
      type: "financas.goal";
    })
  | (FinanceUpdateInputBase & FinancePatchInput<FinanceCardPayload> & {
      type: "financas.card";
    });

export type FinanceEntityType =
  | "financas.transaction"
  | "financas.bill"
  | "financas.debt"
  | "financas.budget"
  | "financas.goal"
  | "financas.card";

const FINANCE_STATUS_TRANSITIONS = {
  "financas.transaction": {
    pending: ["posted", "voided"],
    posted: [],
    voided: [],
  },
  "financas.bill": {
    scheduled: ["due", "overdue", "paid", "cancelled"],
    due: ["overdue", "paid", "cancelled"],
    overdue: ["paid", "cancelled"],
    paid: [],
    cancelled: [],
  },
  "financas.debt": {
    active: ["paid", "paused", "defaulted", "disputed"],
    paused: ["active", "paid"],
    defaulted: ["active", "paid", "paused", "disputed"],
    disputed: ["active", "paid", "paused", "defaulted"],
    paid: [],
  },
  "financas.budget": {
    active: ["paused", "closed"],
    paused: ["active", "closed"],
    closed: [],
  },
  "financas.goal": {
    active: ["achieved", "paused", "cancelled"],
    achieved: [],
    paused: ["active", "achieved", "cancelled"],
    cancelled: [],
  },
  "financas.card": {
    active: ["paused", "closed"],
    paused: ["active", "closed"],
    closed: [],
  },
} as const satisfies Record<
  FinanceEntityType,
  Readonly<Record<string, readonly string[]>>
>;

export function financeStatusTransitionIsAllowed<TType extends FinanceEntityType>(
  type: TType,
  from: FinanceStatusByEntityType[TType],
  to: FinanceStatusByEntityType[TType],
): boolean {
  const transitions = FINANCE_STATUS_TRANSITIONS[type] as Readonly<
    Record<string, readonly string[]>
  >;
  return transitions[from]?.includes(to) ?? false;
}

export function assertFinanceStatusTransition<TType extends FinanceEntityType>(
  type: TType,
  from: FinanceStatusByEntityType[TType],
  to: FinanceStatusByEntityType[TType],
): void {
  if (!financeStatusTransitionIsAllowed(type, from, to)) {
    throw new Error(
      `Transição financeira não permitida para ${type}: ${from} → ${to}.`,
    );
  }
}

export interface FinanceWindowQuery {
  startLocalDate?: LocalDate;
  endLocalDate?: LocalDate;
  types?: readonly FinanceEntityType[];
}

export interface FinanceTransactionSummary {
  transactionCount: number;
  postedTransactionCount: number;
  income: Knowledge<BRLMoney>;
  expense: Knowledge<BRLMoney>;
  net: Knowledge<BRLMoney>;
}

/** 10,000 utilization basis points represent 100%. */
export interface FinanceCardSummary {
  utilizationBasisPoints: Knowledge<number>;
  remainingInstallmentCommitment: Knowledge<BRLMoney>;
  installmentCount: number;
  completeInstallmentCount: number;
}

export interface FinanceCardPayoffInput {
  currentBalanceMinor: BRLMinorUnits;
  annualPercentageRateBps: AnnualPercentageRateBps;
  monthlyPaymentMinor: BRLMinorUnits;
  maximumMonths?: number;
}

export interface FinanceCardPayoffScenario {
  status: "paid_off" | "payment_not_above_interest" | "maximum_months_reached";
  months: number | null;
  firstMonthInterest: BRLMoney;
  totalInterest: Knowledge<BRLMoney>;
  totalPaid: Knowledge<BRLMoney>;
  remainingBalance: BRLMoney;
  maximumMonths: number;
}

export const FINANCE_DEADLINE_RAIL_RECENT_OVERDUE_DAYS = 30;
export const FINANCE_DEADLINE_RAIL_UPCOMING_DAYS = 30;

export interface FinanceDeadlineRailBounds {
  start: LocalDate;
  end: LocalDate;
}

/** Keeps the short decision rail focused without deleting older obligations
 * from history. Both edges are inclusive. */
export function financeDeadlineRailBounds(
  referenceDate: LocalDate,
): FinanceDeadlineRailBounds {
  assertLocalDate(referenceDate);
  return {
    start: shiftLocalDate(
      referenceDate,
      -FINANCE_DEADLINE_RAIL_RECENT_OVERDUE_DAYS,
    ),
    end: shiftLocalDate(referenceDate, FINANCE_DEADLINE_RAIL_UPCOMING_DAYS),
  };
}

/** Keeps the short rail decision-oriented inside its inclusive ±30-day
 * window. Nearest upcoming items receive priority; remaining slots show the
 * most recent overdue items in chronological order. */
export function selectFinanceDeadlineRailItems<T extends { date: LocalDate }>(
  items: readonly T[],
  referenceDate: LocalDate,
  limit = 6,
): T[] {
  assertLocalDate(referenceDate);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("O limite do trilho financeiro precisa ser um inteiro positivo.");
  }
  const bounds = financeDeadlineRailBounds(referenceDate);
  const sorted = items
    .filter((item) => item.date >= bounds.start && item.date <= bounds.end)
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date));
  const overdue = sorted.filter((item) => item.date < referenceDate);
  const upcoming = sorted.filter((item) => item.date >= referenceDate);
  const selectedUpcoming = upcoming.slice(0, limit);
  const overdueCount = Math.min(overdue.length, limit - selectedUpcoming.length);
  return [
    ...(overdueCount > 0 ? overdue.slice(-overdueCount) : []),
    ...selectedUpcoming,
  ];
}

/** Mirrors the analytics obligation fallback: current statement first, then
 * an explicitly recorded minimum payment. Unknown never becomes zero. */
export function financeCardDeadlineAmount(
  card: Pick<FinanceCardPayload, "currentStatementAmount" | "minimumPayment">,
): Knowledge<BRLMoney> {
  const candidates = [card.currentStatementAmount, card.minimumPayment] as const;
  const knownCandidate = candidates.find((candidate) => candidate.state === "known");
  if (knownCandidate) return knownCandidate;

  for (const state of [
    "confirmed_absent",
    "invalid",
    "unknown",
    "not_applicable",
  ] as const) {
    const candidate = candidates.find((item) => item.state === state);
    if (candidate) return candidate;
  }
  return card.currentStatementAmount;
}

/** An explicitly completed installment must not keep producing future due
 * items. Unknown remaining quantity stays visible because it is not evidence
 * that the commitment ended. */
export function financeCardInstallmentHasRemainingPayments(
  installment: Pick<FinanceCardInstallmentPayload, "remainingInstallments">,
): boolean {
  return installment.remainingInstallments.state !== "known" ||
    installment.remainingInstallments.value > 0;
}

function safeSum(values: readonly BRLMinorUnits[]): BRLMinorUnits {
  return asBRLMinorUnits(
    values.reduce((total, value) => {
      const next = total + value;
      if (!Number.isSafeInteger(next)) {
        throw new Error("A soma em centavos ultrapassou o limite inteiro seguro.");
      }
      return next;
    }, 0),
  );
}

function derivedMoney(amountMinor: BRLMinorUnits): Knowledge<BRLMoney> {
  return { state: "known", value: brlMoney(amountMinor), source: "derived" };
}

function missingMoney(): Knowledge<BRLMoney> {
  return { state: "unknown", reason: "not_recorded" };
}

function knownMoneyValue(value: Knowledge<BRLMoney>): BRLMinorUnits | null {
  return value.state === "known" ? value.value.amountMinor : null;
}

function knownNumberValue(value: Knowledge<number>): number | null {
  return value.state === "known" ? value.value : null;
}

function roundedNonNegativeRatio(
  value: BRLMinorUnits,
  numerator: number,
  denominator: number,
): BRLMinorUnits {
  if (value < 0 || !Number.isSafeInteger(numerator) || numerator < 0 || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error("A razão financeira precisa usar inteiros não negativos e denominador positivo.");
  }
  const product = BigInt(value) * BigInt(numerator);
  const rounded = (product + BigInt(Math.floor(denominator / 2))) / BigInt(denominator);
  const result = Number(rounded);
  return asBRLMinorUnits(result);
}

/** Derives card utilization and remaining installment commitment only when the
 * complete set of required values was explicitly recorded. */
export function summarizeFinanceCard(
  card: Pick<
    FinanceCardPayload,
    "statedCreditLimit" | "currentBalance" | "installments"
  >,
): FinanceCardSummary {
  const limit = knownMoneyValue(card.statedCreditLimit);
  const balance = knownMoneyValue(card.currentBalance);
  let utilizationBasisPoints: Knowledge<number> = {
    state: "unknown",
    reason: "not_recorded",
  };
  if (limit !== null && balance !== null && limit > 0) {
    const utilization = roundedNonNegativeRatio(balance, 10_000, limit);
    utilizationBasisPoints = {
      state: "known",
      value: utilization,
      source: "derived",
    };
  }

  const complete = card.installments.flatMap((installment) => {
    const amount = knownMoneyValue(installment.installmentAmount);
    const remaining = knownNumberValue(installment.remainingInstallments);
    if (
      amount === null ||
      remaining === null ||
      !Number.isSafeInteger(remaining) ||
      remaining < 0
    ) {
      return [];
    }
    const product = Number(BigInt(amount) * BigInt(remaining));
    return [asBRLMinorUnits(product)];
  });
  const commitment = card.installments.length > 0 && complete.length === card.installments.length
    ? safeSum(complete)
    : null;

  return {
    utilizationBasisPoints,
    remainingInstallmentCommitment: commitment === null
      ? missingMoney()
      : derivedMoney(commitment),
    installmentCount: card.installments.length,
    completeInstallmentCount: complete.length,
  };
}

/** A descriptive, fixed-input scenario: no new purchases, fixed APR, monthly
 * interest approximated as APR/12 and payment made after interest. It neither
 * recommends nor contracts a financial product. */
export function simulateFinanceCardPayoff(
  input: FinanceCardPayoffInput,
): FinanceCardPayoffScenario {
  asBRLMinorUnits(input.currentBalanceMinor);
  asBRLMinorUnits(input.monthlyPaymentMinor);
  asAnnualPercentageRateBps(input.annualPercentageRateBps);
  if (input.currentBalanceMinor < 0 || input.monthlyPaymentMinor <= 0) {
    throw new Error("Saldo deve ser não negativo e o pagamento mensal precisa ser positivo.");
  }
  const maximumMonths = input.maximumMonths ?? 600;
  if (!Number.isSafeInteger(maximumMonths) || maximumMonths < 1 || maximumMonths > 1_200) {
    throw new Error("O horizonte do cenário precisa ficar entre 1 e 1.200 meses.");
  }

  const interestFor = (balance: BRLMinorUnits) => roundedNonNegativeRatio(
    balance,
    input.annualPercentageRateBps,
    120_000,
  );
  const firstMonthInterest = interestFor(input.currentBalanceMinor);
  if (input.currentBalanceMinor === 0) {
    return {
      status: "paid_off",
      months: 0,
      firstMonthInterest: brlMoney(firstMonthInterest),
      totalInterest: derivedMoney(asBRLMinorUnits(0)),
      totalPaid: derivedMoney(asBRLMinorUnits(0)),
      remainingBalance: brlMoney(asBRLMinorUnits(0)),
      maximumMonths,
    };
  }
  if (input.monthlyPaymentMinor <= firstMonthInterest) {
    return {
      status: "payment_not_above_interest",
      months: null,
      firstMonthInterest: brlMoney(firstMonthInterest),
      totalInterest: missingMoney(),
      totalPaid: missingMoney(),
      remainingBalance: brlMoney(input.currentBalanceMinor),
      maximumMonths,
    };
  }

  let balance = input.currentBalanceMinor;
  let totalInterest = asBRLMinorUnits(0);
  let totalPaid = asBRLMinorUnits(0);
  for (let month = 1; month <= maximumMonths; month += 1) {
    const interest = interestFor(balance);
    totalInterest = asBRLMinorUnits(totalInterest + interest);
    const due = asBRLMinorUnits(balance + interest);
    const payment = asBRLMinorUnits(Math.min(input.monthlyPaymentMinor, due));
    totalPaid = asBRLMinorUnits(totalPaid + payment);
    balance = asBRLMinorUnits(due - payment);
    if (balance === 0) {
      return {
        status: "paid_off",
        months: month,
        firstMonthInterest: brlMoney(firstMonthInterest),
        totalInterest: derivedMoney(totalInterest),
        totalPaid: derivedMoney(totalPaid),
        remainingBalance: brlMoney(balance),
        maximumMonths,
      };
    }
  }
  return {
    status: "maximum_months_reached",
    months: null,
    firstMonthInterest: brlMoney(firstMonthInterest),
    totalInterest: derivedMoney(totalInterest),
    totalPaid: derivedMoney(totalPaid),
    remainingBalance: brlMoney(balance),
    maximumMonths,
  };
}

/**
 * Summarizes only explicitly posted transactions. A missing income or expense
 * side remains unknown, so net is unknown until both sides have observations.
 */
export function summarizeFinanceTransactions(
  transactions: readonly Pick<
    FinanceTransactionPayload,
    "direction" | "amount" | "status"
  >[],
): FinanceTransactionSummary {
  const posted = transactions.filter((transaction) => transaction.status === "posted");
  for (const transaction of posted) {
    if (transaction.amount.currency !== "BRL") {
      throw new Error("O resumo financeiro aceita somente valores em BRL.");
    }
    asBRLMinorUnits(transaction.amount.amountMinor);
    if (transaction.amount.amountMinor < 0) {
      throw new Error("Uma transação persistida precisa usar valor não negativo.");
    }
  }
  const incomeValues = posted
    .filter((transaction) => transaction.direction === "income")
    .map((transaction) => transaction.amount.amountMinor);
  const expenseValues = posted
    .filter((transaction) => transaction.direction === "expense")
    .map((transaction) => transaction.amount.amountMinor);
  const income = incomeValues.length ? safeSum(incomeValues) : null;
  const expense = expenseValues.length ? safeSum(expenseValues) : null;

  return {
    transactionCount: transactions.length,
    postedTransactionCount: posted.length,
    income: income === null ? missingMoney() : derivedMoney(income),
    expense: expense === null ? missingMoney() : derivedMoney(expense),
    net:
      income === null || expense === null
        ? missingMoney()
        : derivedMoney(asBRLMinorUnits(income - expense)),
  };
}
