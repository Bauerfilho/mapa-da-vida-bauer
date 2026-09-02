import { expect, test } from "@playwright/test";
import {
  isBackupEntityPayloadCandidate,
  isMentorEntityCandidate,
} from "../src/data/backup";
import { isUndoSnapshotCandidate } from "../src/data/revisionRepository";
import {
  known,
  listedFinanceProvider,
  unknown,
  type EntityType,
  type MentorEntity,
} from "../src/domain";

const provider = listedFinanceProvider("Banco do Brasil");
const money = { amountMinor: 1_000, currency: "BRL" } as const;

const financePayloads: Array<[EntityType, Record<string, unknown>]> = [
  ["financas.account", {
    providerName: "Banco do Brasil",
    accountKind: known("checking"),
    balance: known(money),
    dueDate: unknown("not_recorded"),
    lastFourDigits: known("1234"),
  }],
  ["financas.transaction", {
    provider,
    direction: "expense",
    amount: money,
    transactionDate: "2026-09-01",
    settledDate: unknown("not_recorded"),
    status: "posted",
    category: unknown("not_recorded"),
    description: unknown("not_recorded"),
  }],
  ["financas.bill", {
    provider,
    label: "Conta",
    amount: known(money),
    dueDate: unknown("not_recorded"),
    paidDate: unknown("not_recorded"),
    interestCharged: unknown("not_recorded"),
    status: "scheduled",
    note: unknown("not_recorded"),
  }],
  ["financas.debt", {
    provider,
    label: "Dívida",
    originalPrincipal: known(money),
    outstandingBalance: known(money),
    annualPercentageRateBps: known(1_200),
    interestCharged: unknown("not_recorded"),
    balanceAsOfLocalDate: known("2026-09-01"),
    dueDate: unknown("not_recorded"),
    status: "active",
    note: unknown("not_recorded"),
  }],
  ["financas.budget", {
    provider,
    label: "Mês",
    limit: money,
    spentAmount: known({ amountMinor: 0, currency: "BRL" }),
    periodStartLocalDate: "2026-09-01",
    periodEndLocalDate: "2026-09-30",
    status: "active",
    note: unknown("not_recorded"),
  }],
  ["financas.goal", {
    provider,
    label: "Reserva",
    targetAmount: money,
    accumulatedAmount: known({ amountMinor: 0, currency: "BRL" }),
    targetDate: unknown("not_recorded"),
    status: "active",
    note: unknown("not_recorded"),
  }],
  ["financas.card", {
    provider,
    label: "Cartão",
    closingDate: unknown("not_recorded"),
    dueDate: unknown("not_recorded"),
    statedCreditLimit: known(money),
    currentBalance: known({ amountMinor: 0, currency: "BRL" }),
    currentStatementAmount: unknown("not_recorded"),
    minimumPayment: unknown("not_recorded"),
    annualPercentageRateBps: unknown("not_recorded"),
    balanceAsOfLocalDate: known("2026-09-01"),
    installments: [],
    status: "active",
    note: unknown("not_recorded"),
  }],
];

test("every canonical finance payload rejects extra credential fields", () => {
  for (const [type, payload] of financePayloads) {
    expect(isBackupEntityPayloadCandidate(type, payload), type).toBe(true);
    expect(isBackupEntityPayloadCandidate(type, {
      ...payload,
      credential: "não permitido",
    }), type).toBe(false);
  }
});

test("finance backup rejects non-BRL, negative, malformed last-four and nested extras", () => {
  const transaction = financePayloads.find(([type]) =>
    type === "financas.transaction"
  )?.[1];
  const account = financePayloads.find(([type]) =>
    type === "financas.account"
  )?.[1];
  expect(transaction).toBeTruthy();
  expect(account).toBeTruthy();

  expect(isBackupEntityPayloadCandidate("financas.transaction", {
    ...transaction,
    amount: { amountMinor: 1_000, currency: "USD" },
  })).toBe(false);
  expect(isBackupEntityPayloadCandidate("financas.transaction", {
    ...transaction,
    amount: { amountMinor: -1, currency: "BRL" },
  })).toBe(false);
  expect(isBackupEntityPayloadCandidate("financas.transaction", {
    ...transaction,
    amount: { amountMinor: 1_000, currency: "BRL", cvv: "123" },
  })).toBe(false);
  expect(isBackupEntityPayloadCandidate("financas.transaction", {
    ...transaction,
    category: { ...known("saúde"), credential: "não permitido" },
  })).toBe(false);

  for (const digits of ["123", "12345", "12a4", 1234]) {
    expect(isBackupEntityPayloadCandidate("financas.account", {
      ...account,
      lastFourDigits: known(digits),
    })).toBe(false);
  }
});

test("finance account backup accepts only the three stable ID-provider pairs", () => {
  const account = financePayloads.find(([type]) =>
    type === "financas.account"
  )?.[1];
  expect(account).toBeTruthy();

  const canonical = {
    id: "seed-finance-banco-do-brasil",
    datasetId: "dataset-1",
    domain: "financas",
    type: "financas.account",
    localDate: "2026-09-01",
    occurredAtUTC: "2026-09-01T12:00:00.000Z",
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision: 2,
    source: "manual",
    status: "active",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    payload: account,
  };

  expect(isMentorEntityCandidate(canonical, canonical.datasetId)).toBe(true);
  expect(isMentorEntityCandidate({
    ...canonical,
    id: "finance-account-extra",
  }, canonical.datasetId)).toBe(false);
  expect(isMentorEntityCandidate({
    ...canonical,
    id: "seed-finance-picpay",
  }, canonical.datasetId)).toBe(false);
  expect(isMentorEntityCandidate({
    ...canonical,
    payload: { ...account, providerName: "Mercado Pago" },
  }, canonical.datasetId)).toBe(false);
});

test("finance backup rejects reversed budgets and sparse installment arrays", () => {
  const budget = financePayloads.find(([type]) => type === "financas.budget")?.[1];
  const card = financePayloads.find(([type]) => type === "financas.card")?.[1];
  const sparseInstallments = new Array(1);

  expect(isBackupEntityPayloadCandidate("financas.budget", {
    ...budget,
    periodStartLocalDate: "2026-09-30",
    periodEndLocalDate: "2026-09-01",
  })).toBe(false);
  expect(isBackupEntityPayloadCandidate("financas.card", {
    ...card,
    installments: sparseInstallments,
  })).toBe(false);
});

function energyEntity(revision: number): MentorEntity<"humor.energy-check-in"> {
  return {
    id: "energy-1",
    datasetId: "dataset-1",
    domain: "humor",
    type: "humor.energy-check-in",
    localDate: "2026-09-01",
    occurredAtUTC: "2026-09-01T12:00:00.000Z",
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision,
    source: "manual",
    status: "active",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: `2026-09-01T12:0${revision}:00.000Z`,
    payload: {
      energy: 3,
      scaleVersion: "energy-1-5-v1",
      note: unknown("not_recorded"),
    },
  };
}

test("historical snapshots and Undo share the canonical entity validator", () => {
  const previous = energyEntity(1);
  const current = energyEntity(2);
  const invalidMeasurement = {
    ...previous,
    payload: { ...previous.payload, energy: 99 },
  };

  expect(isMentorEntityCandidate(previous, previous.datasetId)).toBe(true);
  expect(isUndoSnapshotCandidate(previous, current)).toBe(true);
  expect(isMentorEntityCandidate(invalidMeasurement, previous.datasetId)).toBe(false);
  expect(isUndoSnapshotCandidate(invalidMeasurement, current)).toBe(false);
  expect(isUndoSnapshotCandidate({
    ...previous,
    createdAt: "2026-08-31T12:00:00.000Z",
  }, current)).toBe(false);
});

test("first manual edit of a seed entity can restore only its exact seed snapshot", () => {
  const seed: MentorEntity<"financas.account"> = {
    id: "seed-finance-banco-do-brasil",
    datasetId: "dataset-1",
    domain: "financas",
    type: "financas.account",
    localDate: "2026-09-01",
    occurredAtUTC: "2026-09-01T00:00:00.000Z",
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision: 1,
    source: "seed",
    status: "active",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    payload: {
      providerName: "Banco do Brasil",
      accountKind: unknown("not_confirmed"),
      balance: unknown("not_provided"),
      dueDate: unknown("not_provided"),
      lastFourDigits: unknown("not_provided"),
    },
  };
  const current: MentorEntity<"financas.account"> = {
    ...seed,
    localDate: "2026-09-02",
    revision: 2,
    source: "manual",
    updatedAt: "2026-09-02T12:00:00.000Z",
    payload: {
      ...seed.payload,
      accountKind: known("checking"),
      balance: known(money),
    },
  };

  expect(isMentorEntityCandidate(seed, seed.datasetId)).toBe(true);
  expect(isMentorEntityCandidate(current, current.datasetId)).toBe(true);
  expect(isUndoSnapshotCandidate(seed, current)).toBe(true);

  const incompatibleSnapshots: unknown[] = [
    { ...seed, id: "seed-finance-picpay" },
    { ...seed, datasetId: "dataset-2" },
    { ...seed, type: "financas.card" },
    { ...seed, domain: "internato" },
    { ...seed, timezone: "UTC" },
    { ...seed, schemaVersion: 2 },
    { ...seed, createdAt: "2026-08-31T00:00:00.000Z" },
    { ...seed, revision: 2 },
    { ...seed, status: "staged" },
    { ...seed, source: "imported" },
    {
      ...seed,
      payload: { ...seed.payload, credential: "não permitido" },
    },
  ];
  for (const snapshot of incompatibleSnapshots) {
    expect(isUndoSnapshotCandidate(snapshot, current)).toBe(false);
  }

  expect(isUndoSnapshotCandidate(
    { ...seed, revision: 2 },
    { ...current, revision: 3 },
  )).toBe(false);
});

test("finance generic legacy records cannot smuggle credentials through backup", () => {
  const legacyNote: MentorEntity<"generic.event"> = {
    id: "finance-note-1",
    datasetId: "dataset-1",
    domain: "financas",
    type: "generic.event",
    localDate: "2026-09-01",
    occurredAtUTC: "2026-09-01T12:00:00.000Z",
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision: 1,
    source: "manual",
    status: "active",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    payload: {
      eventKind: "finance-note",
      note: known("Conferido"),
    },
  };

  expect(isMentorEntityCandidate(legacyNote, legacyNote.datasetId)).toBe(true);
  expect(isMentorEntityCandidate({
    ...legacyNote,
    credential: "não permitido",
  }, legacyNote.datasetId)).toBe(false);
  expect(isMentorEntityCandidate({
    ...legacyNote,
    payload: {
      ...legacyNote.payload,
      vault: { cvv: "123" },
    },
  }, legacyNote.datasetId)).toBe(false);
});
