import { useId, type ReactNode } from "react";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { ChartBar } from "@phosphor-icons/react/dist/csr/ChartBar";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { Lightbulb } from "@phosphor-icons/react/dist/csr/Lightbulb";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ANALYTICS_DOMAINS,
  formatBRLMinor,
  type ActivityAggregate,
  type AnalyticsDomain,
  type AnalyticsMetric,
  type AnalyticsReport,
  type DomainAnalyticsSummary,
  type NextActionCandidate,
} from "../domain/analytics";
import { getDomainCatalogEntry } from "./domainCatalog";
import "./mentor-insights.css";

export const MENTOR_INSIGHTS_WINDOWS = [7, 30, 60, 180, 365] as const;

export type MentorInsightsWindowDays =
  (typeof MENTOR_INSIGHTS_WINDOWS)[number];

export interface MentorInsightsProps {
  /** The report is authoritative for every value rendered by this surface. */
  report: AnalyticsReport;
  /** Controlled selection for the 7, 30, 60, 180 or 365-day switch. */
  windowDays: MentorInsightsWindowDays;
  onWindowChange: (days: MentorInsightsWindowDays) => void;
  onDomainSelect?: (domain: AnalyticsDomain) => void;
  onNextActionSelect?: (action: NextActionCandidate) => void;
  /** Labels the supplied dataset as a visual sample; it never creates sample data. */
  demoMode?: boolean;
  className?: string;
  valueContent?: ReactNode;
  customWindowLabel?: string;
}

interface ActivitySeries {
  cadence: "weekly" | "monthly";
  values: ActivityAggregate[];
}

const countFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 0,
});

const localDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

function formatLocalDate(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return localDate;
  return localDateFormatter
    .format(new Date(Date.UTC(year, month - 1, day)))
    .replace(" de ", " ");
}

function formatWindowLabel(days: MentorInsightsWindowDays): string {
  return days === 365 ? "1 ano" : `${days}d`;
}

function formatCompleteness(value: number | null): string {
  return value === null ? "Não calculável" : percentFormatter.format(value);
}

function formatMetricValue(metric: AnalyticsMetric): string {
  if (metric.value === null) return "Dado insuficiente";

  const value = countFormatter.format(metric.value);
  switch (metric.unit) {
    case "BRL_minor":
      return Number.isSafeInteger(metric.value)
        ? formatBRLMinor(metric.value)
        : "Valor inválido";
    case "hours":
      return `${value} h`;
    case "minutes":
      return `${value} min`;
    case "percent":
      return `${value}%`;
    case "score":
      return value;
    case "count":
      return value;
    default:
      return value;
  }
}

function metricStateLabel(metric: AnalyticsMetric): string {
  if (metric.state === "preferred") return "Amostra preferencial";
  if (metric.state === "emerging") return "Amostra em formação";
  return "Amostra inicial";
}

function selectLeadMetric(
  summary: DomainAnalyticsSummary,
): AnalyticsMetric | null {
  return summary.metrics.find((metric) => metric.value !== null && metric.n > 0)
    ?? summary.metrics.find((metric) => metric.n > 0)
    ?? summary.metrics[0]
    ?? null;
}

function selectActivitySeries(report: AnalyticsReport): ActivitySeries {
  const weekly = report.activity.weekly.filter((item) => item.n > 0);
  const monthly = report.activity.monthly.filter((item) => item.n > 0);
  const preferMonthly = report.window.days >= 180;

  if (preferMonthly && monthly.length > 0) {
    return { cadence: "monthly", values: monthly };
  }
  if (!preferMonthly && weekly.length > 0) {
    return { cadence: "weekly", values: weekly };
  }
  return monthly.length > 0
    ? { cadence: "monthly", values: monthly }
    : { cadence: "weekly", values: weekly };
}

function ActivityFigure({ series }: { series: ActivitySeries }) {
  if (series.values.length === 0) {
    return (
      <div className="mi-chart-empty" role="status">
        <ChartBar size={25} weight="thin" aria-hidden="true" />
        <div>
          <strong>Sem série temporal nesta janela</strong>
          <span>O gráfico aparece quando há atividade registrada.</span>
        </div>
      </div>
    );
  }

  const chartData = series.values.map((item) => ({
    label: formatLocalDate(item.start),
    n: item.n,
    observedDays: item.observedDays,
  }));
  const cadenceLabel = series.cadence === "weekly" ? "semanal" : "mensal";

  return (
    <figure className="mi-chart-figure" aria-labelledby="mi-activity-title">
      <figcaption>
        <span>
          <ChartBar size={19} weight="thin" aria-hidden="true" />
          <strong id="mi-activity-title">Atividade registrada</strong>
        </span>
        <small>Série {cadenceLabel} · contagem descritiva</small>
      </figcaption>
      <div className="mi-chart-canvas" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 12, right: 4, bottom: 0, left: -18 }}
          >
            <CartesianGrid
              stroke="rgba(255,255,255,.09)"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              tick={{ fill: "#cfc6bb", fontSize: 9 }}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              width={34}
              tick={{ fill: "#cfc6bb", fontSize: 9 }}
            />
            <Tooltip
              cursor={{ fill: "rgba(199,151,81,.08)" }}
              contentStyle={{
                background: "#241f1a",
                border: "1px solid #c79751",
                borderRadius: 9,
                color: "#fffaf4",
                fontSize: 11,
              }}
              formatter={(value) => countFormatter.format(Number(value))}
            />
            <Bar
              dataKey="n"
              name="Registros"
              fill="#d1a35f"
              radius={[5, 5, 1, 1]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="observedDays"
              name="Dias observados"
              fill="#6f87b8"
              radius={[5, 5, 1, 1]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="mi-sr-only">
        <caption>Valores da série de atividade {cadenceLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Período iniciado em</th>
            <th scope="col">Registros</th>
            <th scope="col">Dias observados</th>
          </tr>
        </thead>
        <tbody>
          {series.values.map((item) => (
            <tr key={item.key}>
              <th scope="row">{formatLocalDate(item.start)}</th>
              <td>{item.n}</td>
              <td>{item.observedDays}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function MetricEvidence({ metric }: { metric: AnalyticsMetric }) {
  return (
    <dl className="mi-metric-evidence">
      <div>
        <dt>Amostra</dt>
        <dd>n={metric.n}</dd>
      </div>
      <div>
        <dt>Faltantes</dt>
        <dd>{metric.missing}</dd>
      </div>
      <div>
        <dt>Completude</dt>
        <dd>{formatCompleteness(metric.completeness)}</dd>
      </div>
      <div>
        <dt>Leitura</dt>
        <dd>{metricStateLabel(metric)}</dd>
      </div>
    </dl>
  );
}

function DomainMetricLane({
  summary,
  onSelect,
}: {
  summary: DomainAnalyticsSummary;
  onSelect?: (domain: AnalyticsDomain) => void;
}) {
  const catalog = getDomainCatalogEntry(summary.domain);
  const DomainIcon = catalog.icon;
  const leadMetric = selectLeadMetric(summary);
  const leadValue = summary.n === 0
    ? "Sem observações"
    : leadMetric
      ? formatMetricValue(leadMetric)
      : "Sem métrica";

  return (
    <details className="mi-domain-lane" data-tone={catalog.tone}>
      <summary>
        <span className="mi-domain-icon" aria-hidden="true">
          <DomainIcon size={21} weight="thin" />
        </span>
        <span className="mi-domain-copy">
          <strong>{catalog.label}</strong>
          <small>
            {summary.n} registro{summary.n === 1 ? "" : "s"} · {summary.missingDays} dia{summary.missingDays === 1 ? "" : "s"} sem registro
          </small>
        </span>
        <span className="mi-domain-lead">
          <strong>{leadValue}</strong>
          <small>{leadMetric?.label ?? "Nenhuma métrica disponível"}</small>
        </span>
        <CaretDown
          className="mi-domain-caret"
          size={17}
          weight="light"
          aria-hidden="true"
        />
      </summary>
      <div className="mi-domain-detail">
        <div className="mi-domain-evidence">
          <span>Janela: {summary.window.days} dias</span>
          <span>Completude: {formatCompleteness(summary.completeness.completeness)}</span>
          <span>Ausências confirmadas: {summary.confirmedAbsences}</span>
        </div>
        {summary.metrics.length > 0 ? (
          <ul className="mi-metric-list">
            {summary.metrics.map((metric) => (
              <li key={metric.key}>
                <div className="mi-metric-heading">
                  <span>{metric.label}</span>
                  <strong>{formatMetricValue(metric)}</strong>
                </div>
                <p>{metric.description}</p>
                <MetricEvidence metric={metric} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mi-no-metrics">Nenhuma métrica definida para este domínio.</p>
        )}
        <p className="mi-domain-caveat">
          <Info size={15} weight="light" aria-hidden="true" />
          {summary.caveat}
        </p>
        {onSelect ? (
          <button
            className="mi-domain-action"
            type="button"
            onClick={() => onSelect(summary.domain)}
          >
            Abrir {catalog.label}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </details>
  );
}

function NextAction({
  action,
  index,
  onSelect,
}: {
  action: NextActionCandidate;
  index: number;
  onSelect?: (action: NextActionCandidate) => void;
}) {
  const catalog = getDomainCatalogEntry(action.domain);

  return (
    <article className="mi-next-action" data-tone={catalog.tone}>
      <span className="mi-action-index" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="mi-action-copy">
        <small>{catalog.label} · opcional e reversível</small>
        <h3>{action.title}</h3>
        <p>{action.reason}</p>
        <span>
          Janela {action.evidence.window.days}d · n={action.evidence.n} · {action.evidence.missing} faltante{action.evidence.missing === 1 ? "" : "s"}
        </span>
      </div>
      {onSelect ? (
        <button type="button" onClick={() => onSelect(action)}>
          Abrir
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      ) : null}
    </article>
  );
}

export function MentorInsights({
  report,
  windowDays,
  onWindowChange,
  onDomainSelect,
  onNextActionSelect,
  demoMode = false,
  className,
  valueContent,
  customWindowLabel,
}: MentorInsightsProps) {
  const reportId = useId();
  const activitySeries = selectActivitySeries(report);
  const nextActions = report.nextActions.slice(0, 3);
  const missingFields = report.completeness.unknown + report.completeness.invalid;
  const isPendingWindow = !customWindowLabel && windowDays !== report.window.days;
  const rootClassName = ["mentor-insights", className].filter(Boolean).join(" ");

  return (
    <section
      className={rootClassName}
      aria-labelledby={`${reportId}-title`}
      data-testid="mentor-insights"
    >
      <header className="mi-header">
        <span className="mi-header-icon" aria-hidden="true">
          <ChartBar size={24} weight="thin" />
        </span>
        <div>
          <h2 id={`${reportId}-title`}>Padrões com evidência</h2>
          <p>Fatos primeiro; sugestões sempre mostram base e incerteza.</p>
        </div>
        {demoMode ? (
          <span className="mi-visual-sample">Amostra visual</span>
        ) : null}
      </header>

      <div
        className="mi-window-switch"
        role="group"
        aria-label="Janela do relatório"
        data-testid="mentor-window-switch"
      >
        {MENTOR_INSIGHTS_WINDOWS.map((days) => (
          <button
            key={days}
            type="button"
            aria-controls={reportId}
            aria-label={`${days} dias`}
            aria-pressed={!customWindowLabel && windowDays === days}
            onClick={() => onWindowChange(days)}
          >
            {formatWindowLabel(days)}
          </button>
        ))}
      </div>

      {valueContent}

      <section
        id={reportId}
        className="mi-report-card"
        aria-labelledby={`${reportId}-evidence-title`}
        aria-live="polite"
      >
        <div className="mi-report-heading">
          <div>
            <small>Relatório descritivo</small>
            <h3 id={`${reportId}-evidence-title`}>
              {formatLocalDate(report.window.start)} — {formatLocalDate(report.window.end)}
            </h3>
          </div>
          <Info size={22} weight="thin" aria-hidden="true" />
        </div>

        <dl className="mi-report-evidence">
          <div>
            <dt>Janela</dt>
            <dd>{report.window.days} dias</dd>
          </div>
          <div>
            <dt>Amostra</dt>
            <dd>n={report.n}</dd>
          </div>
          <div>
            <dt>Dias sem registro</dt>
            <dd>{report.missingDays}</dd>
          </div>
          <div>
            <dt>Completude</dt>
            <dd>{formatCompleteness(report.completeness.completeness)}</dd>
          </div>
        </dl>

        <p className="mi-completeness-detail">
          {report.observedDays} dia{report.observedDays === 1 ? "" : "s"} observado{report.observedDays === 1 ? "" : "s"} · {missingFields} campo{missingFields === 1 ? "" : "s"} desconhecido{missingFields === 1 ? "" : "s"} ou inválido{missingFields === 1 ? "" : "s"} · {report.completeness.confirmedAbsences} ausência{report.completeness.confirmedAbsences === 1 ? "" : "s"} confirmada{report.completeness.confirmedAbsences === 1 ? "" : "s"}
        </p>

        {isPendingWindow ? (
          <p className="mi-window-pending" role="status">
            Exibindo o relatório consolidado de {report.window.days} dias enquanto a janela de {windowDays} dias é preparada.
          </p>
        ) : null}

        <ActivityFigure series={activitySeries} />
      </section>

      <section
        className="mi-section mi-domains"
        aria-labelledby={`${reportId}-domains-title`}
      >
        <div className="mi-section-heading">
          <span aria-hidden="true">
            <ChartBar size={21} weight="thin" />
          </span>
          <div>
            <h3 id={`${reportId}-domains-title`}>Métricas por domínio</h3>
            <p>{ANALYTICS_DOMAINS.length} áreas, cada uma com sua própria base.</p>
          </div>
        </div>
        <div className="mi-domain-list">
          {ANALYTICS_DOMAINS.map((domain) => (
            <DomainMetricLane
              key={domain}
              summary={report.domains[domain]}
              onSelect={onDomainSelect}
            />
          ))}
        </div>
      </section>

      <section
        className="mi-section mi-actions"
        aria-labelledby={`${reportId}-actions-title`}
      >
        <div className="mi-section-heading">
          <span aria-hidden="true">
            <Lightbulb size={21} weight="thin" />
          </span>
          <div>
            <h3 id={`${reportId}-actions-title`}>Próximas ações</h3>
            <p>No máximo três gestos, sustentados pelo relatório atual.</p>
          </div>
        </div>
        {nextActions.length > 0 ? (
          <div className="mi-action-list">
            {nextActions.map((action, index) => (
              <NextAction
                key={action.id}
                action={action}
                index={index}
                onSelect={onNextActionSelect}
              />
            ))}
          </div>
        ) : (
          <div className="mi-actions-empty" role="status">
            <Lightbulb size={22} weight="thin" aria-hidden="true" />
            <div>
              <strong>Nenhuma ação sugerida nesta janela</strong>
              <span>O relatório ainda não sustenta um próximo gesto.</span>
            </div>
          </div>
        )}
      </section>

      <aside className="mi-policy-note" aria-label="Política de interpretação">
        <ShieldCheck size={20} weight="thin" aria-hidden="true" />
        <p>
          <strong>Leitura descritiva.</strong> Ausência de registro continua desconhecida; associação não estabelece causalidade.
        </p>
      </aside>
    </section>
  );
}

export default MentorInsights;
