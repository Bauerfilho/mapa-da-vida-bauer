import { useCallback, useEffect, useMemo, useState } from "react";
import { todayInTimeZone } from "../domain";
import type {
  ConfirmMedicationInput,
  CreateManualShiftInput,
  EntityStatusMutationInput,
  EntityType,
  GenericPayload,
  LocalDate,
  MentorDataRefreshResult,
  MentorEntity,
  MentorWorkspace,
  RecordEnergyInput,
  RecordGenericEventInput,
  RecordShiftTimeInput,
  SettingRecord,
  StoragePersistenceResult,
  TodaySnapshot,
  UpdateShiftInput,
} from "../domain";
import {
  cleanupImportStagingIfDue,
  confirmMedication,
  createManualShift,
  deleteEntity,
  getMentorWorkspace,
  getTodaySnapshot,
  initializeMentorData,
  recordArrival,
  recordBreakEnd,
  recordBreakStart,
  recordDeparture,
  recordEnergy,
  recordGenericEvent,
  requestStoragePersistence,
  restoreEntity,
  saveSetting,
  updateShift,
} from "../data";

const CIVIL_DATE_CHECK_INTERVAL_MS = 30_000;

async function readMentorData(localDate?: LocalDate): Promise<MentorDataRefreshResult> {
  // Resolve the civil date exactly once. Without this boundary, midnight could
  // fall between the two reads and produce a Today snapshot and workspace for
  // different dates.
  const referenceLocalDate = localDate ?? todayInTimeZone();
  const [snapshot, workspace] = await Promise.all([
    getTodaySnapshot(referenceLocalDate),
    getMentorWorkspace(referenceLocalDate),
  ]);
  return { snapshot, workspace };
}

export interface MentorDataState {
  snapshot: TodaySnapshot | null;
  workspace: MentorWorkspace | null;
  loading: boolean;
  saving: boolean;
  error: Error | null;
  refresh: () => Promise<MentorDataRefreshResult>;
  actions: {
    recordEnergy: (input: RecordEnergyInput) => Promise<MentorEntity<"humor.energy-check-in">>;
    confirmMedication: (input: ConfirmMedicationInput) => Promise<MentorEntity<"medicamentos.confirmation">>;
    createManualShift: (input: CreateManualShiftInput) => Promise<MentorEntity<"internato.shift">>;
    recordArrival: (input: RecordShiftTimeInput) => Promise<MentorEntity<"internato.shift">>;
    recordDeparture: (input: RecordShiftTimeInput) => Promise<MentorEntity<"internato.shift">>;
    recordBreakStart: (input: RecordShiftTimeInput) => Promise<MentorEntity<"internato.shift">>;
    recordBreakEnd: (input: RecordShiftTimeInput) => Promise<MentorEntity<"internato.shift">>;
    updateShift: (input: UpdateShiftInput) => Promise<MentorEntity<"internato.shift">>;
    recordGenericEvent: <TPayload extends GenericPayload>(
      input: RecordGenericEventInput<TPayload>,
    ) => Promise<MentorEntity<"generic.event">>;
    saveSetting: <T>(key: string, value: T) => Promise<SettingRecord<T>>;
    deleteEntity: <TType extends EntityType = EntityType>(
      input: EntityStatusMutationInput,
    ) => Promise<MentorEntity<TType>>;
    restoreEntity: <TType extends EntityType = EntityType>(
      input: EntityStatusMutationInput,
    ) => Promise<MentorEntity<TType>>;
    requestStoragePersistence: () => Promise<StoragePersistenceResult>;
  };
}

export function useMentorData(localDate?: LocalDate): MentorDataState {
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [workspace, setWorkspace] = useState<MentorWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async (): Promise<MentorDataRefreshResult> => {
    const next = await readMentorData(localDate);
    setSnapshot(next.snapshot);
    setWorkspace(next.workspace);
    return next;
  }, [localDate]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    initializeMentorData()
      .then(() => requestStoragePersistence().catch(() => null))
      .then(() => readMentorData(localDate))
      .then((next) => {
        if (active) {
          setSnapshot(next.snapshot);
          setWorkspace(next.workspace);
        }
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
  }, [localDate]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    let active = true;
    let refreshInFlight = false;
    let observedLocalDate = localDate ?? todayInTimeZone();

    const refreshFromLifecycle = async (force: boolean) => {
      // The timer and foreground lifecycle events keep plaintext import staging
      // within its retention window even when this PWA process stays alive for
      // days. The runner is throttled and reports failures as data, so hygiene
      // never blocks the user-facing refresh.
      void cleanupImportStagingIfDue();
      const currentLocalDate = localDate ?? todayInTimeZone();
      if ((!force && currentLocalDate === observedLocalDate) || refreshInFlight) return;
      refreshInFlight = true;
      try {
        await refresh();
        if (active) {
          observedLocalDate = currentLocalDate;
          setError(null);
        }
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason : new Error(String(reason)));
        }
      } finally {
        refreshInFlight = false;
      }
    };

    const handlePageShow = () => void refreshFromLifecycle(true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshFromLifecycle(true);
    };
    const dateTimer = localDate === undefined
      ? window.setInterval(
          () => void refreshFromLifecycle(false),
          CIVIL_DATE_CHECK_INTERVAL_MS,
        )
      : null;

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      if (dateTimer !== null) window.clearInterval(dateTimer);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [localDate, refresh]);

  const runMutation = useCallback(
    async <T,>(mutation: () => Promise<T>): Promise<T> => {
      setSaving(true);
      setError(null);
      let result: T;
      try {
        result = await mutation();
      } catch (reason) {
        const nextError = reason instanceof Error ? reason : new Error(String(reason));
        setError(nextError);
        setSaving(false);
        throw nextError;
      }
      try {
        await refresh();
      } catch (reason) {
        // The mutation is already committed. Surface the stale-view problem
        // without reporting a false save failure or inviting a duplicate retry.
        setError(reason instanceof Error ? reason : new Error(String(reason)));
      } finally {
        setSaving(false);
      }
      return result;
    },
    [refresh],
  );

  const actions = useMemo(
    () => ({
      recordEnergy: (input: RecordEnergyInput) =>
        runMutation(() => recordEnergy(input)),
      confirmMedication: (input: ConfirmMedicationInput) =>
        runMutation(() => confirmMedication(input)),
      createManualShift: (input: CreateManualShiftInput) =>
        runMutation(() => createManualShift(input)),
      recordArrival: (input: RecordShiftTimeInput) =>
        runMutation(() => recordArrival(input)),
      recordDeparture: (input: RecordShiftTimeInput) =>
        runMutation(() => recordDeparture(input)),
      recordBreakStart: (input: RecordShiftTimeInput) =>
        runMutation(() => recordBreakStart(input)),
      recordBreakEnd: (input: RecordShiftTimeInput) =>
        runMutation(() => recordBreakEnd(input)),
      updateShift: (input: UpdateShiftInput) =>
        runMutation(() => updateShift(input)),
      recordGenericEvent: <TPayload extends GenericPayload>(
        input: RecordGenericEventInput<TPayload>,
      ) => runMutation(() => recordGenericEvent(input)),
      saveSetting: <T,>(key: string, value: T) =>
        runMutation(() => saveSetting(key, value)),
      deleteEntity: <TType extends EntityType = EntityType>(
        input: EntityStatusMutationInput,
      ) => runMutation(() => deleteEntity<TType>(input)),
      restoreEntity: <TType extends EntityType = EntityType>(
        input: EntityStatusMutationInput,
      ) => runMutation(() => restoreEntity<TType>(input)),
      requestStoragePersistence: () =>
        runMutation(() => requestStoragePersistence()),
    }),
    [runMutation],
  );

  return { snapshot, workspace, loading, saving, error, refresh, actions };
}
