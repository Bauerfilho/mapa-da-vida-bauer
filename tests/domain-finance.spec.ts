import { expect, test } from "@playwright/test";
import { isBackupEntityPayloadCandidate } from "../src/data/backup";
import {
  brlMoney,
  asAnnualPercentageRateBps,
  assertFinanceProvider,
  assertFinanceStatusTransition,
  financeCardDeadlineAmount,
  financeCardInstallmentHasRemainingPayments,
  financeDeadlineRailBounds,
  selectFinanceDeadlineRailItems,
  financeStatusTransitionIsAllowed,
  financeSubscriptionIsConfirmedActive,
  isFinanceSubscriptionPayload,
  listedFinanceProvider,
  otherFinanceProvider,
  parseBRLMinorUnits,
  parseSignedBRLMinorUnits,
  parseFinanceSubscriptionPayload,
  simulateFinanceCardPayoff,
  summarizeFinanceCard,
  summarizeFinanceTransactions,
} from "../src/domain/finance";
import { known, unknown } from "../src/domain/model";

test.describe("parseBRLMinorUnits", () => {
  test("parses Brazilian amounts exactly into integer centavos", () => {
    expect(parseBRLMinorUnits("R$ 1.234,56")).toBe(123_456);
    expect(parseBRLMinorUnits("10,5")).toBe(1_050);
    expect(parseBRLMinorUnits("1234")).toBe(123_400);
    expect(parseBRLMinorUnits("0,00")).toBe(0);
  });

  test("rejects ambiguous or malformed values instead of rounding", () => {
    for (const value of ["", "1.23", "12,345", "-10,00", "R$ qualquer"]) {
      expect(() => parseBRLMinorUnits(value)).toThrow();
    }
  });
});

test.describe("saldo manual de conta", () => {
  test("aceita saldo negativo explícito sem liberar valores negativos nas obrigações", () => {
    expect(parseSignedBRLMinorUnits("-1.234,56")).toBe(-123_456);
    expect(parseSignedBRLMinorUnits("R$ -10,5")).toBe(-1_050);
    expect(parseSignedBRLMinorUnits("25,00")).toBe(2_500);
    expect(() => parseBRLMinorUnits("-10,00")).toThrow();
    expect(() => parseSignedBRLMinorUnits("--10,00")).toThrow();
  });

  test("normaliza outro provedor somente pelo construtor canônico", () => {
    expect(otherFinanceProvider("  Nubank  ")).toEqual({
      kind: "other",
      name: "Nubank",
    });
    expect(() => assertFinanceProvider({ kind: "other", name: " Nubank " }))
      .toThrow(/espaços nas bordas/i);
  });
});

test.describe("assinatura financeira genérica tipada", () => {
  const payload = (status = known("active_confirmed")) => ({
    schema: "finance-record-v1",
    eventKind: "finance-subscription",
    recordMode: "subscription",
    institution: known("Banco do Brasil"),
    subscription: {
      service: known("Serviço confirmado"),
      price: known({ amountMinor: 2_590, currency: "BRL" }),
      cadence: known("monthly"),
      renewalDate: known("2026-09-20"),
      status,
    },
  });

  test("reconhece e normaliza o payload atual sem inventar campos", () => {
    const current = payload();
    expect(isFinanceSubscriptionPayload(current)).toBe(true);
    expect(parseFinanceSubscriptionPayload(current)).toMatchObject({
      service: { state: "known", value: "Serviço confirmado" },
      price: { state: "known", value: { amountMinor: 2_590, currency: "BRL" } },
      renewalDate: { state: "known", value: "2026-09-20" },
      status: { state: "known", value: "active_confirmed" },
    });
  });

  test("mantém legado incompleto como desconhecido e não promove teste a obrigação", () => {
    const legacy = {
      eventKind: "finance-subscription",
      subscription: {
        service: known("Legado"),
        price: known({ amountMinor: 1_000, currency: "BRL" }),
      },
    };
    expect(parseFinanceSubscriptionPayload(legacy)?.status).toEqual({
      state: "unknown",
      reason: "legacy_ambiguous",
    });
    expect(financeSubscriptionIsConfirmedActive(legacy)).toBe(false);
    expect(financeSubscriptionIsConfirmedActive(payload(known("trial_confirmed")))).toBe(false);
    expect(financeSubscriptionIsConfirmedActive(payload())).toBe(true);
    expect(parseFinanceSubscriptionPayload({ eventKind: "finance-subscription" })).toBeNull();
  });
});

test.describe("summarizeFinanceTransactions", () => {
  test("returns zero only when both sides explicitly record zero", () => {
    expect(summarizeFinanceTransactions([]).net).toEqual({
      state: "unknown",
      reason: "not_recorded",
    });

    const explicitZero = summarizeFinanceTransactions([
      {
        direction: "income",
        amount: brlMoney(parseBRLMinorUnits("0,00")),
        status: "posted",
      },
      {
        direction: "expense",
        amount: brlMoney(parseBRLMinorUnits("0,00")),
        status: "posted",
      },
    ]);
    expect(explicitZero.net).toMatchObject({
      state: "known",
      value: { amountMinor: 0, currency: "BRL" },
    });
  });

  test("keeps absent sides and net unknown rather than inferring zero", () => {
    const summary = summarizeFinanceTransactions([
      {
        direction: "income",
        amount: brlMoney(parseBRLMinorUnits("100,00")),
        status: "posted",
      },
      {
        direction: "expense",
        amount: brlMoney(parseBRLMinorUnits("50,00")),
        status: "pending",
      },
    ]);

    expect(summary.income).toMatchObject({
      state: "known",
      value: { amountMinor: 10_000, currency: "BRL" },
    });
    expect(summary.expense).toEqual({ state: "unknown", reason: "not_recorded" });
    expect(summary.net).toEqual({ state: "unknown", reason: "not_recorded" });
  });

  test("calculates a signed net only from explicitly posted sides", () => {
    const summary = summarizeFinanceTransactions([
      {
        direction: "income",
        amount: brlMoney(parseBRLMinorUnits("100,00")),
        status: "posted",
      },
      {
        direction: "expense",
        amount: brlMoney(parseBRLMinorUnits("125,50")),
        status: "posted",
      },
      {
        direction: "expense",
        amount: brlMoney(parseBRLMinorUnits("999,00")),
        status: "voided",
      },
    ]);

    expect(summary.postedTransactionCount).toBe(2);
    expect(summary.net).toMatchObject({
      state: "known",
      value: { amountMinor: -2_550, currency: "BRL" },
    });
  });
});

test.describe("ciclo de vida financeiro com estado esperado", () => {
  test("permite somente as progressões explícitas de movimento e conta", () => {
    expect(financeStatusTransitionIsAllowed(
      "financas.transaction",
      "pending",
      "posted",
    )).toBe(true);
    expect(financeStatusTransitionIsAllowed(
      "financas.transaction",
      "pending",
      "voided",
    )).toBe(true);
    expect(financeStatusTransitionIsAllowed(
      "financas.transaction",
      "posted",
      "voided",
    )).toBe(false);

    expect(financeStatusTransitionIsAllowed(
      "financas.bill",
      "scheduled",
      "paid",
    )).toBe(true);
    expect(financeStatusTransitionIsAllowed(
      "financas.bill",
      "scheduled",
      "cancelled",
    )).toBe(true);
    expect(() => assertFinanceStatusTransition(
      "financas.bill",
      "paid",
      "scheduled",
    )).toThrow(/não permitida/i);
  });

  test("pausa, retoma e encerra no mesmo ciclo de dívida ou cartão", () => {
    expect(financeStatusTransitionIsAllowed(
      "financas.debt",
      "active",
      "paid",
    )).toBe(true);
    expect(financeStatusTransitionIsAllowed(
      "financas.debt",
      "active",
      "paused",
    )).toBe(true);
    expect(financeStatusTransitionIsAllowed(
      "financas.debt",
      "paused",
      "active",
    )).toBe(true);
    expect(financeStatusTransitionIsAllowed(
      "financas.debt",
      "paid",
      "active",
    )).toBe(false);

    expect(financeStatusTransitionIsAllowed(
      "financas.card",
      "active",
      "paused",
    )).toBe(true);
    expect(financeStatusTransitionIsAllowed(
      "financas.card",
      "active",
      "closed",
    )).toBe(true);
    expect(financeStatusTransitionIsAllowed(
      "financas.card",
      "paused",
      "active",
    )).toBe(true);
    expect(financeStatusTransitionIsAllowed(
      "financas.card",
      "closed",
      "active",
    )).toBe(false);

    expect(financeStatusTransitionIsAllowed(
      "financas.debt",
      "disputed",
      "defaulted",
    )).toBe(true);
    expect(financeStatusTransitionIsAllowed(
      "financas.debt",
      "defaulted",
      "active",
    )).toBe(true);
    expect(financeStatusTransitionIsAllowed(
      "financas.budget",
      "paused",
      "closed",
    )).toBe(true);
    expect(financeStatusTransitionIsAllowed(
      "financas.goal",
      "paused",
      "achieved",
    )).toBe(true);
  });
});

test.describe("trilho financeiro curto e verdadeiro", () => {
  const money = (value: string) => known(brlMoney(parseBRLMinorUnits(value)));

  test("usa fatura atual e só então o pagamento mínimo explícito", () => {
    expect(financeCardDeadlineAmount({
      currentStatementAmount: money("300,00"),
      minimumPayment: money("30,00"),
    })).toMatchObject({ value: { amountMinor: 30_000 } });

    expect(financeCardDeadlineAmount({
      currentStatementAmount: unknown("not_recorded"),
      minimumPayment: money("30,00"),
    })).toMatchObject({ value: { amountMinor: 3_000 } });

    expect(financeCardDeadlineAmount({
      currentStatementAmount: unknown("not_recorded"),
      minimumPayment: unknown("not_recorded"),
    })).toEqual({ state: "unknown", reason: "not_recorded" });
  });

  test("limita atrasos antigos sem remover os fatos do histórico", () => {
    const bounds = financeDeadlineRailBounds("2026-09-01");
    expect(bounds).toEqual({ start: "2026-08-02", end: "2026-10-01" });
    expect("2026-08-01" < bounds.start).toBe(true);
    expect("2026-09-02" >= bounds.start && "2026-09-02" <= bounds.end).toBe(true);
  });

  test("atrasos recentes não escondem todos os próximos compromissos", () => {
    const items = [
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
      "2026-08-31",
      "2026-09-02",
      "2026-09-03",
    ].map((date) => ({ date: date as `${number}-${number}-${number}`, id: date }));

    const selected = selectFinanceDeadlineRailItems(items, "2026-09-01", 6);
    expect(selected.map((item) => item.date)).toEqual([
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
      "2026-08-31",
      "2026-09-02",
      "2026-09-03",
    ]);
    expect(selected.some((item) => item.date >= "2026-09-01")).toBe(true);
  });

  test("o trilho sem próximos compromissos mostra os atrasos mais recentes", () => {
    const items = [
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
    ].map((date) => ({ date: date as `${number}-${number}-${number}`, id: date }));

    expect(selectFinanceDeadlineRailItems(items, "2026-09-01", 2).map((item) => item.date))
      .toEqual(["2026-08-26", "2026-08-27"]);
  });

  test("prioriza próximos, respeita ±30 dias e não altera a entrada", () => {
    const items = [
      "2026-08-01",
      "2026-08-02",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-10-01",
      "2026-10-02",
    ].map((date) => ({ date: date as `${number}-${number}-${number}`, id: date }));
    const originalOrder = items.map((item) => item.id);

    expect(selectFinanceDeadlineRailItems(items, "2026-09-01", 1).map((item) => item.date))
      .toEqual(["2026-09-01"]);
    expect(selectFinanceDeadlineRailItems(items, "2026-09-01", 6).map((item) => item.date))
      .toEqual([
        "2026-08-02",
        "2026-08-31",
        "2026-09-01",
        "2026-09-02",
        "2026-09-03",
        "2026-10-01",
      ]);
    expect(items.map((item) => item.id)).toEqual(originalOrder);
  });
});

test.describe("cartão canônico", () => {
  const money = (value: string) => known(brlMoney(parseBRLMinorUnits(value)));

  test("não inventa utilização nem compromisso quando faltam dados", () => {
    const summary = summarizeFinanceCard({
      statedCreditLimit: unknown("not_recorded"),
      currentBalance: unknown("not_recorded"),
      installments: [],
    });

    expect(summary.utilizationBasisPoints).toEqual({
      state: "unknown",
      reason: "not_recorded",
    });
    expect(summary.remainingInstallmentCommitment).toEqual({
      state: "unknown",
      reason: "not_recorded",
    });
  });

  test("calcula utilização e parcelas somente a partir de pares explícitos", () => {
    const summary = summarizeFinanceCard({
      statedCreditLimit: money("2.000,00"),
      currentBalance: money("500,00"),
      installments: [
        {
          id: "one",
          label: "Compra",
          purchaseTotal: money("400,00"),
          installmentAmount: money("100,00"),
          totalInstallments: known(4),
          remainingInstallments: known(2),
          nextDueDate: unknown("not_recorded"),
          finalDueDate: unknown("not_recorded"),
        },
      ],
    });

    expect(summary.utilizationBasisPoints).toMatchObject({
      state: "known",
      value: 2_500,
      source: "derived",
    });
    expect(summary.remainingInstallmentCommitment).toMatchObject({
      state: "known",
      value: { amountMinor: 20_000, currency: "BRL" },
      source: "derived",
    });
  });

  test("mantém o total parcelado desconhecido se uma compra estiver incompleta", () => {
    const summary = summarizeFinanceCard({
      statedCreditLimit: money("1.000,00"),
      currentBalance: money("0,00"),
      installments: [{
        id: "incomplete",
        label: "Compra",
        purchaseTotal: unknown("not_recorded"),
        installmentAmount: money("50,00"),
        totalInstallments: known(3),
        remainingInstallments: unknown("not_recorded"),
        nextDueDate: unknown("not_recorded"),
        finalDueDate: unknown("not_recorded"),
      }],
    });

    expect(summary.utilizationBasisPoints).toMatchObject({ state: "known", value: 0 });
    expect(summary.remainingInstallmentCommitment).toEqual({
      state: "unknown",
      reason: "not_recorded",
    });
  });
});

test.describe("cenário descritivo de quitação", () => {
  test("projeta um cenário sem juros usando somente os três valores informados", () => {
    const result = simulateFinanceCardPayoff({
      currentBalanceMinor: parseBRLMinorUnits("1.000,00"),
      annualPercentageRateBps: asAnnualPercentageRateBps(0),
      monthlyPaymentMinor: parseBRLMinorUnits("250,00"),
    });

    expect(result.status).toBe("paid_off");
    expect(result.months).toBe(4);
    expect(result.totalInterest).toMatchObject({
      state: "known",
      value: { amountMinor: 0, currency: "BRL" },
    });
    expect(result.totalPaid).toMatchObject({
      state: "known",
      value: { amountMinor: 100_000, currency: "BRL" },
    });
  });

  test("não fabrica prazo quando o pagamento não supera o juro inicial", () => {
    const result = simulateFinanceCardPayoff({
      currentBalanceMinor: parseBRLMinorUnits("1.000,00"),
      annualPercentageRateBps: asAnnualPercentageRateBps(1_200),
      monthlyPaymentMinor: parseBRLMinorUnits("10,00"),
    });

    expect(result.status).toBe("payment_not_above_interest");
    expect(result.months).toBeNull();
    expect(result.firstMonthInterest.amountMinor).toBe(1_000);
    expect(result.totalInterest).toEqual({ state: "unknown", reason: "not_recorded" });
    expect(result.totalPaid).toEqual({ state: "unknown", reason: "not_recorded" });
  });

  test("expõe horizonte, acumulados e saldo quando o limite de meses é atingido", () => {
    const result = simulateFinanceCardPayoff({
      currentBalanceMinor: parseBRLMinorUnits("1.000,00"),
      annualPercentageRateBps: asAnnualPercentageRateBps(1_200),
      monthlyPaymentMinor: parseBRLMinorUnits("10,01"),
      maximumMonths: 1,
    });

    expect(result.status).toBe("maximum_months_reached");
    expect(result.months).toBeNull();
    expect(result.maximumMonths).toBe(1);
    expect(result.totalInterest).toMatchObject({
      state: "known",
      value: { amountMinor: 1_000, currency: "BRL" },
    });
    expect(result.totalPaid).toMatchObject({
      state: "known",
      value: { amountMinor: 1_001, currency: "BRL" },
    });
    expect(result.remainingBalance).toEqual({ amountMinor: 99_999, currency: "BRL" });
  });
});

test.describe("vencimento de compra parcelada", () => {
  test("oculta somente a parcela explicitamente concluída", () => {
    expect(financeCardInstallmentHasRemainingPayments({
      remainingInstallments: known(0),
    })).toBe(false);
    expect(financeCardInstallmentHasRemainingPayments({
      remainingInstallments: known(1),
    })).toBe(true);
    expect(financeCardInstallmentHasRemainingPayments({
      remainingInstallments: unknown("not_recorded"),
    })).toBe(true);
  });
});

test.describe("cartão no esquema de backup", () => {
  const money = (value: string) => known(brlMoney(parseBRLMinorUnits(value)));
  const validCard = () => ({
    provider: listedFinanceProvider("Mercado Pago"),
    label: "Cartão QA sem credenciais",
    closingDate: known("2026-09-20"),
    dueDate: known("2026-09-27"),
    statedCreditLimit: money("2.000,00"),
    currentBalance: money("500,00"),
    currentStatementAmount: money("300,00"),
    minimumPayment: money("30,00"),
    annualPercentageRateBps: known(asAnnualPercentageRateBps(1_200)),
    balanceAsOfLocalDate: known("2026-09-01"),
    installments: [{
      id: "installment-1",
      label: "Compra QA",
      purchaseTotal: money("400,00"),
      installmentAmount: money("100,00"),
      totalInstallments: known(4),
      remainingInstallments: known(2),
      nextDueDate: known("2026-09-27"),
      finalDueDate: known("2026-10-27"),
    }],
    status: "active",
    note: unknown("not_recorded"),
  });

  test("aceita o cartão canônico usado no round-trip cifrado", () => {
    expect(isBackupEntityPayloadCandidate("financas.card", validCard())).toBe(true);
  });

  test("rejeita datas invertidas, parcelas incoerentes e chaves extras", () => {
    const reversedDates = validCard();
    reversedDates.dueDate = known("2026-09-10");
    expect(isBackupEntityPayloadCandidate("financas.card", reversedDates)).toBe(false);

    const invalidInstallments = validCard();
    invalidInstallments.installments[0].remainingInstallments = known(5);
    expect(isBackupEntityPayloadCandidate("financas.card", invalidInstallments)).toBe(false);

    expect(isBackupEntityPayloadCandidate("financas.card", {
      ...validCard(),
      credential: "não permitido",
    })).toBe(false);
  });
});
