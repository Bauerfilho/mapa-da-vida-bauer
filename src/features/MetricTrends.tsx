import { useEffect, useId, useMemo, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { ChartLine } from "@phosphor-icons/react/dist/csr/ChartLine";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { ListNumbers } from "@phosphor-icons/react/dist/csr/ListNumbers";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildMetricSeries, formatSignalDate, formatSignalValue, METRIC_SIGNALS, observationTime, type MetricSignalId, type SignalPoint } from "../domain/metricSeries";
import type { Domain, InclusiveDateWindow, MentorEntity } from "../domain/model";
import { getDomainCatalogEntry } from "./domainCatalog";
import "./metric-trends.css";

const stateLabels = { known: "Valor registrado", unknown: "Campo não informado", invalid: "Dado não utilizável", not_applicable: "Não se aplica", confirmed_absent: "Ausência confirmada", unrecorded: "Sem registro neste dia" };
const emptyHeadings = { known: "Valor indisponível", unknown: "Em aberto", invalid: "Revisar registro", not_applicable: "Não se aplica", confirmed_absent: "Ausência confirmada", unrecorded: "Sem registro" };
export interface MetricTrendsProps { entities: readonly MentorEntity[]; datasetId: string; window: InclusiveDateWindow; signalId?: MetricSignalId; onSignalChange?: (signal: MetricSignalId) => void; domain?: Domain; reducedMotion?: boolean; onRegister?: (domain: Domain) => void; }

function PointDetail({ point, signalId }: { point: SignalPoint; signalId: MetricSignalId }) {
  return <div className="mt-point-detail" data-testid="metric-point-detail" aria-live="polite"><div className="mt-point-heading"><div><small>Dia em foco</small><h3>{formatSignalDate(point.localDate)}</h3></div><div><strong>{point.value === null ? emptyHeadings[point.state] : formatSignalValue(signalId, point.value)}</strong><span>{point.partial ? "Parcial · há registros sem valor utilizável" : point.value === null ? stateLabels[point.state] : `${point.observations.length} registro${point.observations.length === 1 ? "" : "s"} de origem`}</span></div></div>
    {point.observations.length ? <details className="mt-observations"><summary><ListNumbers size={16} />Conferir os registros deste dia<CaretDown size={14} /></summary><ol>{point.observations.map((item) => <li key={`${item.entityId}:${item.revision}`}><span><strong>{item.title}</strong><small>Registrado às {observationTime(item.occurredAtUTC)} · revisão {item.revision}</small></span><em>{item.value === null ? stateLabels[item.state] : formatSignalValue(signalId, item.value)}</em></li>)}</ol></details> : <p className="mt-gap-copy">Esta lacuna fica vazia no gráfico. Não significa zero, ausência, descanso ou falha.</p>}
  </div>;
}

export function MetricTrends({ entities, datasetId, window, signalId, onSignalChange, domain, reducedMotion = false, onRegister }: MetricTrendsProps) {
  const unique = useId().replace(/:/g, "");
  const choices = METRIC_SIGNALS.filter((item) => !domain || item.domain === domain);
  const [localSignal, setLocalSignal] = useState<MetricSignalId>(signalId ?? choices[0]?.id ?? "sleep-duration");
  const requested = signalId ?? localSignal;
  const selected = choices.find((item) => item.id === requested) ?? choices[0];
  const series = useMemo(() => selected ? buildMetricSeries(entities, selected.id, { datasetId, endLocalDate: window.end, days: window.days }) : null, [entities, datasetId, selected?.id, window.end, window.days]);
  const [focusedDate, setFocusedDate] = useState(window.end);
  const [showTable, setShowTable] = useState(false);
  const [motionAllowed, setMotionAllowed] = useState(false);
  useEffect(() => { const preference = matchMedia("(prefers-reduced-motion: reduce)"); const update = () => setMotionAllowed(!preference.matches); update(); preference.addEventListener("change", update); return () => preference.removeEventListener("change", update); }, []);
  useEffect(() => { if (series) setFocusedDate([...series.points].reverse().find((point) => point.observations.length)?.localDate ?? series.window.end); }, [series?.signal.id, series?.window.start, series?.window.end]);
  if (!selected || !series) return null;
  const selectedIndex = Math.max(0, series.points.findIndex((point) => point.localDate === focusedDate));
  const focused = series.points[selectedIndex]; const summary = series.summary;
  const Icon = getDomainCatalogEntry(selected.domain).icon;
  const chooseSignal = (value: string) => { const next = choices.find((item) => item.id === value); if (!next) return; setLocalSignal(next.id); onSignalChange?.(next.id); setShowTable(false); };
  // O próprio ponto carrega sua data; um toque não depende do hover anterior da biblioteca.
  const drawPoint = (props: { cx?: number; cy?: number; payload?: SignalPoint }, emphasized = false) => {
    const point = props.payload;
    if (!point || point.value === null || typeof props.cx !== "number" || typeof props.cy !== "number") return <g />;
    const choose = () => setFocusedDate(point.localDate);
    return <g className="mt-curve-point" data-metric-date={point.localDate} onPointerDown={choose} onClick={(event) => { event.stopPropagation(); choose(); }} style={{ cursor: "pointer" }}><circle cx={props.cx} cy={props.cy} r={summary.knownDays <= 30 ? 12 : 6} fill="transparent" /><circle cx={props.cx} cy={props.cy} r={emphasized ? 6 : summary.knownDays > 50 ? 1.8 : 3.4} fill="var(--mt-line)" stroke={emphasized ? "#f5eee2" : "#182334"} strokeWidth={emphasized ? 2 : 1.5} /></g>;
  };
  const yDomain: [number | "auto", number | "auto"] = selected.id === "energy" ? [1, 5] : selected.id === "sleep-efficiency" ? [0, 100] : selected.id === "arrival-offset" ? ["auto", "auto"] : [0, "auto"];
  const pointsWithRecords = series.points.filter((point) => point.observations.length);

  return <section className="metric-trends" data-domain={selected.domain} data-testid="metric-trends" aria-labelledby={`${unique}-title`}>
    <header className="mt-header"><span className="mt-domain-icon"><Icon size={25} weight="thin" /></span><div><p className="eyebrow">Sua trajetória, por valor</p><h2 id={`${unique}-title`}>{selected.title}</h2></div><ChartLine size={24} weight="thin" /></header>
    <label className="mt-select"><span>O que observar</span><select aria-label="O que observar · sinal da curva" value={selected.id} onChange={(event) => chooseSignal(event.target.value)}>{[...new Set(choices.map((item) => item.group))].map((group) => <optgroup label={group} key={group}>{choices.filter((item) => item.group === group).map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</optgroup>)}</select></label>
    <div className="mt-plot-card">
      <div className="mt-plot-heading"><div><span>Último valor conhecido</span><strong data-testid="metric-last-value">{summary.last ? formatSignalValue(selected.id, summary.last.value) : "—"}</strong><small>{summary.last ? formatSignalDate(summary.last.localDate) : "Aguardando um registro válido"}</small></div><span className="mt-period">{window.days} dias<small>{summary.knownDays} com valor</small></span></div>
      {summary.knownDays ? <div className="mt-chart" aria-hidden="true"><ResponsiveContainer width="100%" height="100%" minWidth={0}><LineChart data={series.points} margin={{ top: 17, right: 15, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="rgba(244,232,213,.1)" strokeDasharray="2 5" />
        <XAxis dataKey="localDate" tickFormatter={formatSignalDate} tick={{ fill: "#c5c5ca", fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={35} interval="preserveStartEnd" />
        <YAxis domain={yDomain} tickFormatter={(value: number) => formatSignalValue(selected.id, value, true)} tick={{ fill: "#c5c5ca", fontSize: 9 }} width={49} axisLine={false} tickLine={false} allowDecimals={selected.id !== "energy"} />
        {selected.id === "arrival-offset" ? <ReferenceLine y={0} stroke="rgba(244,232,213,.5)" strokeDasharray="4 4" /> : null}
        <ReferenceLine x={focused.localDate} stroke="rgba(244,232,213,.35)" strokeDasharray="3 5" />
        <Tooltip cursor={false} labelFormatter={(value) => formatSignalDate(String(value) as SignalPoint["localDate"])} formatter={(value) => [formatSignalValue(selected.id, typeof value === "number" ? value : null), selected.title]} contentStyle={{ background: "#1f2836", border: "1px solid #c8a26a", borderRadius: 12, color: "#fff8eb", fontSize: 12 }} labelStyle={{ color: "#dfd3c2", marginBottom: 5 }} itemStyle={{ color: "#fff8eb" }} />
        <Line type="monotone" dataKey="value" name={selected.title} connectNulls={false} stroke="var(--mt-line)" strokeWidth={2.6} dot={(props) => drawPoint(props)} activeDot={(props) => drawPoint(props, true)} isAnimationActive={motionAllowed && !reducedMotion} animationDuration={500} animationEasing="ease-out" />
      </LineChart></ResponsiveContainer></div> : <div className="mt-chart-empty"><ChartLine size={43} weight="thin" /><strong>A curva começa com um registro</strong><span>Sem preencher dias vazios nem inventar uma tendência.</span>{onRegister ? <button type="button" onClick={() => onRegister(selected.domain)}><Plus size={15} />Registrar {selected.group.toLocaleLowerCase("pt-BR")}</button> : null}</div>}
      <div className="mt-plot-legend"><span><i />{selected.aggregation === "latest" ? "Último registro de cada dia" : selected.aggregation === "sum" ? "Soma dos valores conhecidos no dia" : "Maior desvio de cada dia"}</span><small>Lacunas não são ligadas</small></div>
    </div>
    <dl className="mt-summary"><div><dt>{selected.central === "median" ? "Mediana" : "Média por dia"}</dt><dd>{formatSignalValue(selected.id, summary.central, true)}</dd><small>{summary.knownDays} {summary.knownDays === 1 ? "dia" : "dias"} com valor</small></div><div><dt>Menor → maior</dt><dd>{summary.minimum === null ? "—" : `${formatSignalValue(selected.id, summary.minimum, true)} → ${formatSignalValue(selected.id, summary.maximum, true)}`}</dd><small>Faixa observada, não meta</small></div>{summary.total !== null ? <div><dt>Total registrado</dt><dd>{formatSignalValue(selected.id, summary.total, true)}</dd><small>{summary.partialDays ? `${summary.partialDays} dia(s) parcial(is)` : "Somente valores conhecidos"}</small></div> : <div><dt>Sem valor</dt><dd>{window.days - summary.knownDays}<span> {window.days - summary.knownDays === 1 ? "dia" : "dias"}</span></dd><small>{summary.unrecordedDays} sem registro · {summary.openDays} em aberto{summary.excludedDays ? ` · ${summary.excludedDays} excluído(s) explicitamente` : ""}</small></div>}</dl>
    <div className="mt-date-control" role="group" aria-label="Consultar um dia da curva"><button type="button" aria-label="Dia anterior da curva" disabled={selectedIndex === 0} onClick={() => setFocusedDate(series.points[selectedIndex - 1].localDate)}><ArrowLeft size={17} /></button><label><span>{formatSignalDate(focused.localDate)}</span><input type="range" aria-label="Dia da curva" aria-valuetext={`${formatSignalDate(focused.localDate)}: ${focused.value === null ? stateLabels[focused.state] : formatSignalValue(selected.id, focused.value)}`} min={0} max={series.points.length - 1} step={1} value={selectedIndex} onChange={(event) => setFocusedDate(series.points[Number(event.target.value)].localDate)} /></label><button type="button" aria-label="Próximo dia da curva" disabled={selectedIndex === series.points.length - 1} onClick={() => setFocusedDate(series.points[selectedIndex + 1].localDate)}><ArrowRight size={17} /></button></div>
    <PointDetail point={focused} signalId={selected.id} />
    <p className="mt-method"><Info size={17} /><span>{selected.explanation} {summary.partialDays ? `${summary.partialDays} dia(s) contém dados parciais.` : ""}</span></p>
    <div className="mt-footer"><span>{formatSignalDate(window.start)} a {formatSignalDate(window.end)} · {summary.observations} registro{summary.observations === 1 ? "" : "s"}</span><button type="button" onClick={() => setShowTable(!showTable)} aria-expanded={showTable}>{showTable ? "Ocultar valores" : "Ver valores"}<CaretDown size={13} /></button>{onRegister ? <button type="button" onClick={() => onRegister(selected.domain)}>Abrir {getDomainCatalogEntry(selected.domain).label}<ArrowRight size={13} /></button> : null}</div>
    {showTable ? <div className="mt-table-wrap" tabIndex={0}><table><caption>Valores diários: {selected.title}. Dias sem registro ficam fora desta tabela, mas permanecem como lacunas na curva.</caption><thead><tr><th scope="col">Dia</th><th scope="col">Valor</th><th scope="col">Registros</th></tr></thead><tbody>{pointsWithRecords.map((point) => <tr key={point.localDate}><th scope="row"><button type="button" onClick={() => setFocusedDate(point.localDate)}>{formatSignalDate(point.localDate)}</button></th><td>{point.value === null ? stateLabels[point.state] : formatSignalValue(selected.id, point.value)}{point.partial ? " · parcial" : ""}</td><td>{point.observations.length}</td></tr>)}</tbody></table>{!pointsWithRecords.length ? <p>Sem registros deste sinal no período.</p> : null}</div> : null}
    {summary.rejectedRecords ? <p className="mt-rejected" role="status">{summary.rejectedRecords} registro(s) com data ou identificação inválida não foram usados nesta curva.</p> : null}
  </section>;
}
