import {
  ANALYTICS_DOMAINS,
  buildAnalyticsReport,
  type ActivityAggregate,
  type AnalyticsMetric,
  type AnalyticsOptions,
  type NextActionCandidate,
} from "./analytics";
import {
  RETENTION_POLICY,
  type Domain,
  type InclusiveDateWindow,
  type LocalDate,
  type MentorEntity,
} from "./model";

export const DASHBOARD_WINDOW_DAYS = RETENTION_POLICY.supportedWindows;
export type DashboardWindowDays = (typeof DASHBOARD_WINDOW_DAYS)[number];
export type CoverageBasis = "civil_day" | "payload_field";

export interface SampleCoverage {
  basis: CoverageBasis;
  total: number;
  eligible: number;
  included: number;
  unknown: number;
  invalid: number;
  /** A subset of included, never an inferred absence. */
  confirmedAbsent: number;
  notApplicable: number;
  completeness: number | null;
}

export interface DashboardDomainSnapshot {
  domain: Domain;
  recordCount: number;
  recordedDayCount: number;
  missingDayCount: number;
  dayCoverage: SampleCoverage;
  fieldCoverage: SampleCoverage;
  metrics: AnalyticsMetric[];
  caveat: "Dados descritivos; associações não estabelecem causalidade.";
}

export interface DashboardSnapshot {
  referenceLocalDate: LocalDate;
  windowDays: DashboardWindowDays;
  window: InclusiveDateWindow;
  entityCount: number;
  recordedDayCount: number;
  missingDayCount: number;
  countsByDomain: Record<Domain, number>;
  dayCoverage: SampleCoverage;
  fieldCoverage: SampleCoverage;
  domains: Record<Domain, DashboardDomainSnapshot>;
  activity: {
    weekly: ActivityAggregate[];
    monthly: ActivityAggregate[];
  };
  nextActions: NextActionCandidate[];
  interpretationPolicy: "descriptive_only_no_causality";
}

export interface DashboardOptions extends Omit<AnalyticsOptions, "days"> {
  days?: DashboardWindowDays;
}

export function isDashboardWindowDays(value: number): value is DashboardWindowDays {
  return (DASHBOARD_WINDOW_DAYS as readonly number[]).includes(value);
}

export function assertDashboardWindowDays(
  value: number,
): asserts value is DashboardWindowDays {
  if (!isDashboardWindowDays(value)) {
    throw new Error("A janela do painel precisa ser 7, 30, 60, 180 ou 365 dias.");
  }
}

function dayCoverage(
  window: InclusiveDateWindow,
  included: number,
): SampleCoverage {
  const normalizedIncluded = Math.max(0, Math.min(window.days, included));
  return {
    basis: "civil_day",
    total: window.days,
    eligible: window.days,
    included: normalizedIncluded,
    unknown: window.days - normalizedIncluded,
    invalid: 0,
    confirmedAbsent: 0,
    notApplicable: 0,
    completeness: window.days ? normalizedIncluded / window.days : null,
  };
}

function fieldCoverage(
  evidence: {
    known: number;
    confirmedAbsences: number;
    unknown: number;
    invalid: number;
    notApplicable: number;
    eligible: number;
    completeness: number | null;
  },
): SampleCoverage {
  const included = evidence.known + evidence.confirmedAbsences;
  return {
    basis: "payload_field",
    total: evidence.eligible + evidence.notApplicable,
    eligible: evidence.eligible,
    included,
    unknown: evidence.unknown,
    invalid: evidence.invalid,
    confirmedAbsent: evidence.confirmedAbsences,
    notApplicable: evidence.notApplicable,
    completeness: evidence.completeness,
  };
}

function dashboardMetrics(metrics: readonly AnalyticsMetric[]): AnalyticsMetric[] {
  return metrics.map((metric) => ({
    ...metric,
    // A count of stored records may be zero, but an analytic observation with
    // n=0 has no evidence for a numeric conclusion.
    value: metric.n === 0 ? null : metric.value,
  }));
}

/**
 * Builds a deterministic dashboard from canonical entity snapshots. It never
 * reads the clock or storage and is therefore safe to exercise with fixtures.
 */
export function buildDashboardSnapshot(
  entities: readonly MentorEntity[],
  options: DashboardOptions,
): DashboardSnapshot {
  const days = options.days ?? RETENTION_POLICY.defaultAnalyticsDays;
  assertDashboardWindowDays(days);
  const report = buildAnalyticsReport(entities, {
    endLocalDate: options.endLocalDate,
    days,
    ...(options.datasetId ? { datasetId: options.datasetId } : {}),
  });

  const countsByDomain = Object.fromEntries(
    ANALYTICS_DOMAINS.map((domain) => [domain, report.domains[domain].n]),
  ) as Record<Domain, number>;
  const domains = Object.fromEntries(
    ANALYTICS_DOMAINS.map((domain) => {
      const summary = report.domains[domain];
      return [domain, {
        domain,
        recordCount: summary.n,
        recordedDayCount: summary.observedDays,
        missingDayCount: summary.missingDays,
        dayCoverage: dayCoverage(report.window, summary.observedDays),
        fieldCoverage: fieldCoverage(summary.completeness),
        metrics: dashboardMetrics(summary.metrics),
        caveat: summary.caveat,
      } satisfies DashboardDomainSnapshot];
    }),
  ) as Record<Domain, DashboardDomainSnapshot>;

  return {
    referenceLocalDate: options.endLocalDate,
    windowDays: days,
    window: report.window,
    entityCount: report.n,
    recordedDayCount: report.observedDays,
    missingDayCount: report.missingDays,
    countsByDomain,
    dayCoverage: dayCoverage(report.window, report.observedDays),
    fieldCoverage: fieldCoverage(report.completeness),
    domains,
    activity: report.activity,
    nextActions: report.nextActions,
    interpretationPolicy: report.interpretationPolicy,
  };
}

export const calculateDashboardSnapshot = buildDashboardSnapshot;
