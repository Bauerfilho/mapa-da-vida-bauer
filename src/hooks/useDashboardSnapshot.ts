import { useCallback, useEffect, useState } from "react";
import type {
  ArchiveSnapshot,
  DashboardSnapshot,
  DashboardWindowDays,
  LocalDate,
} from "../domain";
import {
  getArchiveSnapshot,
  getDashboardSnapshot,
  type ArchiveSnapshotQuery,
  type DashboardSnapshotQuery,
} from "../data";

export interface DashboardSnapshotState {
  snapshot: DashboardSnapshot | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<DashboardSnapshot>;
}

export interface ArchiveSnapshotState {
  snapshot: ArchiveSnapshot | null;
  events: ArchiveSnapshot["events"];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<ArchiveSnapshot>;
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function normalizeDashboardQuery(
  queryOrDays: DashboardSnapshotQuery | DashboardWindowDays,
  requestedEndLocalDate?: LocalDate,
): DashboardSnapshotQuery {
  return typeof queryOrDays === "number"
    ? {
        days: queryOrDays,
        ...(requestedEndLocalDate ? { endLocalDate: requestedEndLocalDate } : {}),
      }
    : queryOrDays;
}

export function useDashboardSnapshot(
  queryOrDays: DashboardSnapshotQuery | DashboardWindowDays = {},
  requestedEndLocalDate?: LocalDate,
): DashboardSnapshotState {
  const query = normalizeDashboardQuery(queryOrDays, requestedEndLocalDate);
  const days = query.days;
  const endLocalDate = query.endLocalDate;
  const datasetId = query.datasetId;
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async (): Promise<DashboardSnapshot> => {
    setLoading(true);
    setError(null);
    try {
      const next = await getDashboardSnapshot({
        ...(days ? { days } : {}),
        ...(endLocalDate ? { endLocalDate } : {}),
        ...(datasetId ? { datasetId } : {}),
      });
      setSnapshot(next);
      return next;
    } catch (reason) {
      const nextError = asError(reason);
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, [datasetId, days, endLocalDate]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getDashboardSnapshot({
      ...(days ? { days } : {}),
      ...(endLocalDate ? { endLocalDate } : {}),
      ...(datasetId ? { datasetId } : {}),
    })
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch((reason: unknown) => {
        if (active) setError(asError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [datasetId, days, endLocalDate]);

  return { snapshot, loading, error, refresh };
}

export const useDashboardData = useDashboardSnapshot;

export function useArchiveEvents(
  query: ArchiveSnapshotQuery = {},
): ArchiveSnapshotState {
  const endLocalDate = query.endLocalDate;
  const datasetId = query.datasetId;
  const [snapshot, setSnapshot] = useState<ArchiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async (): Promise<ArchiveSnapshot> => {
    setLoading(true);
    setError(null);
    try {
      const next = await getArchiveSnapshot({
        ...(endLocalDate ? { endLocalDate } : {}),
        ...(datasetId ? { datasetId } : {}),
      });
      setSnapshot(next);
      return next;
    } catch (reason) {
      const nextError = asError(reason);
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, [datasetId, endLocalDate]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getArchiveSnapshot({
      ...(endLocalDate ? { endLocalDate } : {}),
      ...(datasetId ? { datasetId } : {}),
    })
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch((reason: unknown) => {
        if (active) setError(asError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [datasetId, endLocalDate]);

  return {
    snapshot,
    events: snapshot?.events ?? [],
    loading,
    error,
    refresh,
  };
}
