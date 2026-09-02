import { useCallback, useEffect, useState } from "react";
import type {
  CreateMedicationRegimenInput,
  LocalDate,
  MentorEntity,
  RecordMedicationDoseInput,
} from "../domain";
import {
  createMedicationRegimen,
  getMedicationWorkspaceSnapshot,
  recordMedicationDose,
  type MedicationWorkspaceSnapshot,
} from "../data";

export interface MedicationDataState {
  snapshot: MedicationWorkspaceSnapshot | null;
  loading: boolean;
  saving: boolean;
  error: Error | null;
  refresh: () => Promise<MedicationWorkspaceSnapshot>;
  createRegimen: (
    input: CreateMedicationRegimenInput,
  ) => Promise<void>;
  recordDose: (
    input: RecordMedicationDoseInput,
  ) => Promise<MentorEntity<"medicamentos.confirmation">>;
}

export function useMedicationData(localDate: LocalDate): MedicationDataState {
  const [snapshot, setSnapshot] = useState<MedicationWorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    const next = await getMedicationWorkspaceSnapshot(localDate);
    setSnapshot(next);
    return next;
  }, [localDate]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getMedicationWorkspaceSnapshot(localDate)
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason : new Error(String(reason)));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [localDate]);

  const runMutation = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setSaving(true);
    setError(null);
    try {
      const result = await operation();
      await refresh();
      return result;
    } catch (reason) {
      const nextError = reason instanceof Error ? reason : new Error(String(reason));
      setError(nextError);
      throw nextError;
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  const createRegimenAction = useCallback(
    async (input: CreateMedicationRegimenInput) => {
      await runMutation(() => createMedicationRegimen(input));
    },
    [runMutation],
  );
  const recordDoseAction = useCallback(
    (input: RecordMedicationDoseInput) =>
      runMutation(() => recordMedicationDose(input)),
    [runMutation],
  );

  return {
    snapshot,
    loading,
    saving,
    error,
    refresh,
    createRegimen: createRegimenAction,
    recordDose: recordDoseAction,
  };
}
