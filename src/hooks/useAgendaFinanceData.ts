import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgendaWindowDays,
  AgendaWindowQuery,
  CreateAgendaEventInput,
  CreateAgendaGoalSetInput,
  CreateAgendaTaskInput,
  CreateFinanceBillInput,
  CreateFinanceBudgetInput,
  CreateFinanceCardInput,
  CreateFinanceDebtInput,
  CreateFinanceGoalInput,
  CreateFinanceTransactionInput,
  FinanceTransactionSummary,
  FinanceWindowQuery,
  LocalDate,
  QuickCaptureAgendaInput,
  UpdateAgendaItemInput,
  UpdateFinanceAccountInput,
  UpdateFinanceSubscriptionStatusInput,
  UpdateFinanceRecordInput,
} from "../domain";
import {
  createAgendaEvent,
  createAgendaGoalSet,
  createAgendaTask,
  createFinanceBill,
  createFinanceBudget,
  createFinanceCard,
  createFinanceDebt,
  createFinanceGoal,
  createFinanceTransaction,
  getFinanceTransactionSummary,
  listAgendaWindow,
  listFinanceAccounts,
  listFinanceRecords,
  listFinanceSubscriptions,
  quickCaptureAgenda,
  updateAgendaItem,
  updateFinanceAccount,
  updateFinanceRecord,
  updateFinanceSubscriptionStatus,
  type AgendaWindowResult,
  type FinanceAccountEntity,
  type FinanceRecordEntity,
  type FinanceSubscriptionEntity,
} from "../data";

export interface AgendaFinanceSnapshot {
  agenda: AgendaWindowResult;
  financeAccounts: FinanceAccountEntity[];
  financeRecords: FinanceRecordEntity[];
  financeSummary: FinanceTransactionSummary;
}

export interface AgendaFinanceDataState {
  snapshot: AgendaFinanceSnapshot | null;
  loading: boolean;
  saving: boolean;
  error: Error | null;
  refresh: () => Promise<AgendaFinanceSnapshot>;
  reads: {
    listAgendaWindow: (query: AgendaWindowQuery) => Promise<AgendaWindowResult>;
    listFinanceRecords: (
      query?: FinanceWindowQuery,
    ) => Promise<FinanceRecordEntity[]>;
    listFinanceAccounts: () => Promise<FinanceAccountEntity[]>;
    listFinanceSubscriptions: () => Promise<FinanceSubscriptionEntity[]>;
    getFinanceTransactionSummary: (
      query?: Omit<FinanceWindowQuery, "types">,
    ) => Promise<FinanceTransactionSummary>;
  };
  actions: {
    createAgendaTask: (input: CreateAgendaTaskInput) => Promise<void>;
    createAgendaEvent: (input: CreateAgendaEventInput) => Promise<void>;
    quickCaptureAgenda: (input: QuickCaptureAgendaInput) => Promise<void>;
    createAgendaGoalSet: (input: CreateAgendaGoalSetInput) => Promise<void>;
    updateAgendaItem: (input: UpdateAgendaItemInput) => Promise<void>;
    createFinanceTransaction: (
      input: CreateFinanceTransactionInput,
    ) => Promise<void>;
    createFinanceBill: (input: CreateFinanceBillInput) => Promise<void>;
    createFinanceDebt: (input: CreateFinanceDebtInput) => Promise<void>;
    createFinanceBudget: (input: CreateFinanceBudgetInput) => Promise<void>;
    createFinanceCard: (input: CreateFinanceCardInput) => Promise<void>;
    createFinanceGoal: (input: CreateFinanceGoalInput) => Promise<void>;
    updateFinanceAccount: (input: UpdateFinanceAccountInput) => Promise<void>;
    updateFinanceRecord: (input: UpdateFinanceRecordInput) => Promise<void>;
    updateFinanceSubscriptionStatus: (
      input: UpdateFinanceSubscriptionStatusInput,
    ) => Promise<void>;
  };
}

/**
 * Canonical agenda/finance hook. Its default financial view follows the same
 * explicit 7/30-day forward window as Agenda; custom reads remain available.
 */
export function useAgendaFinanceData(
  startLocalDate: LocalDate,
  days: AgendaWindowDays = 7,
): AgendaFinanceDataState {
  const [snapshot, setSnapshot] = useState<AgendaFinanceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const loadSequence = useRef(0);
  const pendingMutations = useRef(0);

  const loadSnapshot = useCallback(async (): Promise<AgendaFinanceSnapshot> => {
    const agenda = await listAgendaWindow({
      startLocalDate,
      days,
      includeUnscheduled: true,
    });
    const financeWindow = {
      startLocalDate: agenda.window.start,
      endLocalDate: agenda.window.end,
    };
    const [financeAccounts, financeRecords, financeSummary] = await Promise.all([
      listFinanceAccounts(),
      listFinanceRecords(financeWindow),
      getFinanceTransactionSummary(financeWindow),
    ]);
    return { agenda, financeAccounts, financeRecords, financeSummary };
  }, [days, startLocalDate]);

  const refresh = useCallback(async (): Promise<AgendaFinanceSnapshot> => {
    const sequence = ++loadSequence.current;
    const next = await loadSnapshot();
    if (sequence === loadSequence.current) setSnapshot(next);
    return next;
  }, [loadSnapshot]);

  useEffect(() => {
    let active = true;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    loadSnapshot()
      .then((next) => {
        if (active && sequence === loadSequence.current) setSnapshot(next);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason : new Error(String(reason)));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadSnapshot]);

  const runMutation = useCallback(
    async (mutation: () => Promise<unknown>): Promise<void> => {
      pendingMutations.current += 1;
      setSaving(true);
      setError(null);
      try {
        await mutation();
        await refresh();
      } catch (reason) {
        const nextError = reason instanceof Error ? reason : new Error(String(reason));
        setError(nextError);
        throw nextError;
      } finally {
        pendingMutations.current -= 1;
        setSaving(pendingMutations.current > 0);
      }
    },
    [refresh],
  );

  const reads = useMemo(
    () => ({
      listAgendaWindow,
      listFinanceAccounts,
      listFinanceRecords,
      listFinanceSubscriptions,
      getFinanceTransactionSummary,
    }),
    [],
  );

  const actions = useMemo(
    () => ({
      createAgendaTask: (input: CreateAgendaTaskInput) =>
        runMutation(() => createAgendaTask(input)),
      createAgendaEvent: (input: CreateAgendaEventInput) =>
        runMutation(() => createAgendaEvent(input)),
      quickCaptureAgenda: (input: QuickCaptureAgendaInput) =>
        runMutation(() => quickCaptureAgenda(input)),
      createAgendaGoalSet: (input: CreateAgendaGoalSetInput) =>
        runMutation(() => createAgendaGoalSet(input)),
      updateAgendaItem: (input: UpdateAgendaItemInput) =>
        runMutation(() => updateAgendaItem(input)),
      createFinanceTransaction: (input: CreateFinanceTransactionInput) =>
        runMutation(() => createFinanceTransaction(input)),
      createFinanceBill: (input: CreateFinanceBillInput) =>
        runMutation(() => createFinanceBill(input)),
      createFinanceDebt: (input: CreateFinanceDebtInput) =>
        runMutation(() => createFinanceDebt(input)),
      createFinanceBudget: (input: CreateFinanceBudgetInput) =>
        runMutation(() => createFinanceBudget(input)),
      createFinanceCard: (input: CreateFinanceCardInput) =>
        runMutation(() => createFinanceCard(input)),
      createFinanceGoal: (input: CreateFinanceGoalInput) =>
        runMutation(() => createFinanceGoal(input)),
      updateFinanceAccount: (input: UpdateFinanceAccountInput) =>
        runMutation(() => updateFinanceAccount(input)),
      updateFinanceRecord: (input: UpdateFinanceRecordInput) =>
        runMutation(() => updateFinanceRecord(input)),
      updateFinanceSubscriptionStatus: (input: UpdateFinanceSubscriptionStatusInput) =>
        runMutation(() => updateFinanceSubscriptionStatus(input)),
    }),
    [runMutation],
  );

  return { snapshot, loading, saving, error, refresh, reads, actions };
}
