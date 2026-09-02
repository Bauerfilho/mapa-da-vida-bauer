import {
  RETENTION_POLICY,
  assertDashboardWindowDays,
  buildArchiveSnapshot,
  buildDashboardSnapshot,
  inclusiveDateWindow,
  todayInTimeZone,
  type ArchiveSnapshot,
  type DashboardSnapshot,
  type DashboardWindowDays,
  type LocalDate,
} from "../domain";
import { listEntities } from "./repository";
import { selectOperationalWindow } from "../domain/operationalState";

export interface DashboardSnapshotQuery {
  days?: DashboardWindowDays;
  endLocalDate?: LocalDate;
  datasetId?: string;
}

export interface ArchiveSnapshotQuery {
  endLocalDate?: LocalDate;
  datasetId?: string;
}

function dashboardQuery(
  queryOrDays: DashboardSnapshotQuery | DashboardWindowDays,
  requestedEndLocalDate?: LocalDate,
): Required<Pick<DashboardSnapshotQuery, "days" | "endLocalDate">> &
  Pick<DashboardSnapshotQuery, "datasetId"> {
  const query = typeof queryOrDays === "number"
    ? { days: queryOrDays, endLocalDate: requestedEndLocalDate }
    : queryOrDays;
  const days = query.days ?? RETENTION_POLICY.defaultAnalyticsDays;
  assertDashboardWindowDays(days);
  return {
    days,
    endLocalDate: query.endLocalDate ?? todayInTimeZone(),
    ...(query.datasetId ? { datasetId: query.datasetId } : {}),
  };
}

/** Read the selected civil-day window from canonical persisted entities. */
export async function getDashboardSnapshot(
  queryOrDays: DashboardSnapshotQuery | DashboardWindowDays = {},
  requestedEndLocalDate?: LocalDate,
): Promise<DashboardSnapshot> {
  const query = dashboardQuery(queryOrDays, requestedEndLocalDate);
  const window = inclusiveDateWindow(query.endLocalDate, query.days);
  const entities = await listEntities({
    ...(query.datasetId ? { datasetId: query.datasetId } : {}),
  });
  // Regimes e obrigações anteriores à janela continuam necessários para o denominador correto.
  return buildDashboardSnapshot(selectOperationalWindow(entities, window.start, window.end), {
    endLocalDate: query.endLocalDate,
    days: query.days,
    ...(query.datasetId ? { datasetId: query.datasetId } : {}),
  });
}

/** Read the complete inclusive 365-day canonical archive. */
export async function getArchiveSnapshot(
  query: ArchiveSnapshotQuery = {},
): Promise<ArchiveSnapshot> {
  const endLocalDate = query.endLocalDate ?? todayInTimeZone();
  const window = inclusiveDateWindow(endLocalDate, RETENTION_POLICY.rawHistoryDays);
  const entities = await listEntities({
    ...(query.datasetId ? { datasetId: query.datasetId } : {}),
    startLocalDate: window.start,
    endLocalDate: window.end,
  });
  return buildArchiveSnapshot(entities, endLocalDate, {
    ...(query.datasetId ? { datasetId: query.datasetId } : {}),
  });
}

export async function getArchiveEvents(
  query: ArchiveSnapshotQuery = {},
): Promise<ArchiveSnapshot["events"]> {
  return (await getArchiveSnapshot(query)).events;
}
