import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { FilePdf } from "@phosphor-icons/react/dist/csr/FilePdf";
import { Flask } from "@phosphor-icons/react/dist/csr/Flask";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Paperclip } from "@phosphor-icons/react/dist/csr/Paperclip";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { TestTube } from "@phosphor-icons/react/dist/csr/TestTube";
import { Trash } from "@phosphor-icons/react/dist/csr/Trash";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BottomSheet, KeyboardInput, KeyboardTextarea, useKeyboard } from "../mobile";
import type { Knowledge, LocalDate, MentorEntity } from "../domain/model";
import {
  buildLaboratoryPanel, buildLaboratorySeries, createLaboratoryAttachment,
  isLaboratoryPanelEntity, laboratorySearchText, normalizeLaboratoryLabel, normalizeLaboratoryUnit, formatLaboratoryNumber, formatLaboratoryReference, verifyLaboratoryAttachments,
  type LaboratoryAttachment, type LaboratoryPanelEntity, type LaboratoryPanelInput,
  type LaboratoryPanelPayload, type LaboratoryResult,
} from "../domain/laboratory";
import "./laboratory-workspace.css";

const text = <T,>(value: Knowledge<T>, fallback: T): T => value.state === "known" ? value.value : fallback;
const shortDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const fullDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const numeric = formatLaboratoryNumber;
const symbols = { eq: "", lt: "< ", le: "≤ ", gt: "> ", ge: "≥ " } as const;

function resultLabel(result: LaboratoryResult): string {
  if (result.value.state !== "known") return "Não informado";
  const value = result.value.value;
  return value.kind === "text" ? value.value : `${symbols[value.comparator]}${numeric(value.value)}`;
}
function referenceLabel(result: LaboratoryResult): string {
  return formatLaboratoryReference(result);
}
function LabField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="lab-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}
type ResultDraft = LaboratoryPanelInput["results"][number];
const emptyResult = (): ResultDraft => ({ id: crypto.randomUUID(), analyte: "", value: "", kind: "numeric", unit: "", referenceText: "", referenceLow: "", referenceHigh: "" });

export function LaboratoryCapture({ referenceDate, initial, onSave, onCancel, disabled = false }: {
  referenceDate: LocalDate; initial?: LaboratoryPanelEntity; disabled?: boolean;
  onSave: (payload: LaboratoryPanelPayload) => Promise<unknown>; onCancel?: () => void;
}) {
  const keyboard = useKeyboard();
  const [title, setTitle] = useState(initial ? text(initial.payload.title, "") : "");
  const [collectedOn, setCollectedOn] = useState<string>(initial?.payload.collectedOn ?? referenceDate);
  const [reportedOn, setReportedOn] = useState(initial ? text(initial.payload.reportedOn, "") : "");
  const [laboratory, setLaboratory] = useState(initial ? text(initial.payload.laboratory, "") : "");
  const [note, setNote] = useState(initial ? text(initial.payload.note, "") : "");
  const [documentsOnly, setDocumentsOnly] = useState(Boolean(initial && initial.payload.results.length === 0));
  const [results, setResults] = useState<ResultDraft[]>(() => initial ? initial.payload.results.map((result) => ({
    id: result.id, analyte: result.analyte,
    kind: result.value.state === "known" ? result.value.value.kind : "numeric",
    value: result.value.state !== "known" ? "" : result.value.value.kind === "text" ? result.value.value.value : `${symbols[result.value.value.comparator]}${formatLaboratoryNumber(result.value.value.value)}`,
    unit: text(result.unit, ""), referenceText: text(result.referenceText, ""),
    referenceLow: result.referenceLow.state === "known" ? formatLaboratoryNumber(result.referenceLow.value) : "",
    referenceHigh: result.referenceHigh.state === "known" ? formatLaboratoryNumber(result.referenceHigh.value) : "",
  })) : [emptyResult()]);
  const [attachments, setAttachments] = useState<LaboratoryAttachment[]>(initial?.payload.attachments ?? []);
  const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = disabled || saving || uploading;
  const changeResult = (index: number, patch: Partial<ResultDraft>) => setResults((current) => current.map((item, position) => position === index ? { ...item, ...patch } : item));
  const attachFiles = async (files: File[]) => {
    keyboard.hide(); setUploading(true); setError(null);
    try {
      // Confere o limite pelos metadados antes de ler ou converter qualquer arquivo.
      if (attachments.length + files.length > 8 || [...attachments, ...files].reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) throw new Error("O painel pode ter até 8 anexos e 8 MB no total.");
      const next: LaboratoryAttachment[] = [];
      for (const file of files) next.push(await createLaboratoryAttachment(file));
      const combined = [...attachments, ...next];
      if (combined.length > 8 || combined.reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) throw new Error("O painel pode ter até 8 anexos e 8 MB no total.");
      setAttachments(combined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível ler o laudo."); }
    finally { setUploading(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setError(null); setSaving(true); keyboard.hide();
    try {
      const payload = buildLaboratoryPanel({ title, collectedOn, reportedOn, laboratory, note, results: documentsOnly ? [] : results, attachments, referenceDate });
      await onSave(payload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar. Seus campos continuam aqui."); }
    finally { setSaving(false); }
  };
  return <form className="lab-capture" onSubmit={submit} noValidate data-testid="laboratory-capture">
    <p className="lab-form-intro">Transcreva o laudo. Campo vazio continua desconhecido; não complete valores por estimativa.</p>
    <LabField label="Título do painel"><KeyboardInput value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: check-up de setembro" /></LabField>
    <div className="lab-two-columns">
      <LabField label="Data da coleta"><KeyboardInput type="date" value={collectedOn} max={referenceDate} onChange={(event) => setCollectedOn(event.target.value)} /></LabField>
      <LabField label="Data da emissão (opcional)"><KeyboardInput type="date" value={reportedOn} max={referenceDate} onChange={(event) => setReportedOn(event.target.value)} /></LabField>
    </div>
    <LabField label="Laboratório (opcional)"><KeyboardInput value={laboratory} maxLength={200} onChange={(event) => setLaboratory(event.target.value)} placeholder="Nome que aparece no laudo" /></LabField>
    {!initial || initial.payload.results.length === 0 ? <div className="lab-window" role="group" aria-label="Forma de guardar o exame"><button type="button" aria-pressed={!documentsOnly} onClick={() => setDocumentsOnly(false)}>Transcrever resultados</button><button type="button" aria-pressed={documentsOnly} onClick={() => setDocumentsOnly(true)}>Só guardar laudo</button></div> : null}
    {!documentsOnly ? <><div className="lab-form-section"><span className="lab-step">01</span><div><h3>Um resultado por linha</h3><p>Unidade e referência ficam exatamente como foram informadas.</p></div></div>
    {results.map((result, index) => <fieldset className="lab-result-editor" key={result.id}>
      <legend>Resultado {index + 1}</legend>
      {results.length > 1 ? <button type="button" className="lab-remove" aria-label={`Remover resultado ${index + 1}`} onClick={() => setResults((current) => current.filter((_, position) => position !== index))}><X size={18} /></button> : null}
      <LabField label={`Nome do exame ${index + 1}`}><KeyboardInput value={result.analyte} onChange={(event) => changeResult(index, { analyte: event.target.value })} maxLength={120} placeholder="Ex.: hemoglobina, TSH, creatinina" /></LabField>
      <div className="lab-two-columns">
        <LabField label={`Tipo de resultado ${index + 1}`}><select value={result.kind} onChange={(event) => changeResult(index, { kind: event.target.value as ResultDraft["kind"] })}><option value="numeric">Numérico</option><option value="text">Texto do laudo</option></select></LabField>
        <LabField label={`Unidade ${index + 1}`}><KeyboardInput value={result.unit ?? ""} maxLength={60} onChange={(event) => changeResult(index, { unit: event.target.value })} placeholder="Ex.: g/dL, mg/dL, mUI/L" /></LabField>
      </div>
      <LabField label={`Valor ${index + 1}`} hint={result.kind === "numeric" ? "Sem separador de milhar. Aceita vírgula, ponto e limites como < 0,5." : "Transcreva a expressão do laudo, sem reinterpretá-la."}><KeyboardInput inputMode={result.kind === "numeric" ? "decimal" : "text"} value={result.value} onChange={(event) => changeResult(index, { value: event.target.value })} maxLength={500} placeholder={result.kind === "numeric" ? "Ex.: 12,8" : "Ex.: não reagente"} /></LabField>
      <details className="lab-reference-fields"><summary>Referência do laudo · opcional</summary><div className="lab-two-columns">
        <LabField label={`Limite inferior ${index + 1}`}><KeyboardInput inputMode="decimal" value={result.referenceLow ?? ""} onChange={(event) => changeResult(index, { referenceLow: event.target.value })} /></LabField>
        <LabField label={`Limite superior ${index + 1}`}><KeyboardInput inputMode="decimal" value={result.referenceHigh ?? ""} onChange={(event) => changeResult(index, { referenceHigh: event.target.value })} /></LabField>
      </div><LabField label={`Referência em texto ${index + 1}`}><KeyboardInput value={result.referenceText ?? ""} maxLength={500} onChange={(event) => changeResult(index, { referenceText: event.target.value })} placeholder="Use o texto quando o intervalo não for numérico" /></LabField></details>
    </fieldset>)}
    <button type="button" className="lab-add-result" disabled={busy || results.length >= 64} onClick={() => setResults((current) => [...current, emptyResult()])}><Plus size={18} />Adicionar outro exame</button>
    </> : <p className="lab-form-intro">O documento ficará guardado com data e título. Você pode transcrever os valores depois; não criaremos medições a partir do arquivo.</p>}
    <div className="lab-form-section"><span className="lab-step">{documentsOnly ? "01" : "02"}</span><div><h3>Guarde o documento original</h3><p>PDF, PNG ou JPEG · até 3 MB por arquivo, 8 MB por painel.</p></div></div>
    <label className="lab-upload"><Paperclip size={21} /><span>{uploading ? "Conferindo arquivo…" : "Anexar laudo"}<small>Os bytes ficam no seu banco local e no backup cifrado.</small></span><input type="file" accept="application/pdf,image/png,image/jpeg" multiple disabled={busy} aria-label="Anexar laudo" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void attachFiles(files); }} /></label>
    {attachments.map((attachment) => <div className="lab-file" key={attachment.id}><FilePdf size={19} /><span>{attachment.name}<small>{Math.ceil(attachment.size / 1024)} KB · integridade verificada</small></span><button type="button" aria-label={`Retirar anexo ${attachment.name}`} disabled={busy} onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}><Trash size={18} /></button></div>)}
    <LabField label="Observação pessoal (opcional)"><KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} placeholder="Ex.: jejum informado, pergunta para a próxima consulta" rows={3} /></LabField>
    {error ? <p className="lab-error" role="alert">{error}</p> : null}
    <div className="lab-form-actions">{onCancel ? <button type="button" className="secondary-cta" disabled={busy} onClick={() => { keyboard.hide(); onCancel(); }}>Cancelar</button> : null}<button type="submit" className="primary-cta" disabled={busy}><ShieldCheck size={20} />{saving ? "Salvando…" : initial ? "Salvar nova revisão" : "Guardar meu exame"}</button></div>
    <p className="lab-privacy-note">Somente seus exames. Não inclua laudos ou identificadores de pacientes atendidos no hospital.</p>
  </form>;
}

export function LaboratoryWorkspace({ entities, currentLocalDate, onBack, onSave, initialEditId }: {
  entities: readonly MentorEntity[]; currentLocalDate: LocalDate; onBack: () => void;
  initialEditId?: string | null; onSave: (payload: LaboratoryPanelPayload, original?: LaboratoryPanelEntity) => Promise<unknown>;
}) {
  const keyboard = useKeyboard();
  const panels = useMemo(() => entities.filter(isLaboratoryPanelEntity).filter((entity) => entity.status === "active").sort((a, b) => b.payload.collectedOn.localeCompare(a.payload.collectedOn) || b.updatedAt.localeCompare(a.updatedAt)), [entities]);
  const [editing, setEditing] = useState<LaboratoryPanelEntity | undefined>(() => panels.find((entity) => entity.id === initialEditId));
  const [formOpen, setFormOpen] = useState(Boolean(initialEditId));
  const [query, setQuery] = useState(""); const [windowDays, setWindowDays] = useState(60);
  const [selectedKey, setSelectedKey] = useState(""); const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null); const [limit, setLimit] = useState(30);
  const seriesOptions = useMemo(() => {
    const options = new Map<string, { key: string; analyte: string; unit: string }>();
    panels.forEach((panel) => panel.payload.results.forEach((result) => {
      if (result.value.state !== "known" || result.value.value.kind !== "numeric" || result.unit.state !== "known") return;
      const key = `${normalizeLaboratoryLabel(result.analyte)}|${normalizeLaboratoryUnit(result.unit.value)}`;
      options.set(key, { key, analyte: result.analyte, unit: result.unit.value });
    }));
    return [...options.values()].sort((a, b) => a.analyte.localeCompare(b.analyte, "pt-BR"));
  }, [panels]);
  const selected = seriesOptions.find((option) => option.key === selectedKey) ?? seriesOptions[0];
  const series = useMemo(() => selected ? buildLaboratorySeries(panels, { analyte: selected.analyte, unit: selected.unit, days: windowDays, endLocalDate: currentLocalDate }) : null, [panels, selected, windowDays, currentLocalDate]);
  const lastPoint = series?.points.filter((point) => point.value !== null).at(-1);
  const filtered = panels.filter((panel) => normalizeLaboratoryLabel(laboratorySearchText(panel.payload)).includes(normalizeLaboratoryLabel(query)));
  const openCapture = (panel?: LaboratoryPanelEntity) => { keyboard.hide(); setEditing(panel); setFormOpen(true); };
  const download = async (panel: LaboratoryPanelEntity, attachment: LaboratoryAttachment) => {
    try {
      await verifyLaboratoryAttachments(panel.payload);
      const bytes = Uint8Array.from(atob(attachment.dataBase64), (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: attachment.mimeType }));
      const link = document.createElement("a"); link.href = url; link.download = attachment.name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setNotice("Arquivo preparado. Confirme que apareceu nos seus downloads ou Arquivos.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "O laudo não pôde ser aberto."); }
  };
  return <div className="page inner-page lab-workspace" data-testid="laboratory-workspace">
    <button type="button" className="back-button" onClick={onBack}><ArrowLeft size={18} />Voltar</button>
    <header className="lab-heading"><span className="lab-symbol"><Flask size={30} weight="thin" /></span><div><p className="eyebrow">Saúde · memória pessoal</p><h1>Meus exames</h1><p>O laudo guardado.<br />A evolução à vista.</p></div></header>
    <section className="lab-overview" aria-label="Resumo dos exames"><div><strong>{panels.length}</strong><span>coletas guardadas</span></div><div><strong>{panels.reduce((sum, panel) => sum + panel.payload.results.length, 0)}</strong><span>resultados separados</span></div><div><strong>{panels.reduce((sum, panel) => sum + panel.payload.attachments.length, 0)}</strong><span>laudos originais</span></div></section>
    <button type="button" className="primary-cta lab-new" onClick={() => openCapture()}><Plus size={22} />Adicionar exame ou laudo<ArrowUpRight size={20} /></button>
    <section className="lab-evolution" aria-label="Evolução laboratorial"><div className="lab-section-heading"><TestTube size={21} weight="thin" /><h2>Evolução, com contexto</h2></div>
      <div className="lab-window" role="group" aria-label="Janela dos exames">{[60, 180, 365].map((days) => <button type="button" key={days} aria-pressed={windowDays === days} onClick={() => setWindowDays(days)}>{days === 365 ? "1 ano" : `${days} dias`}</button>)}</div>
      {selected && series ? <>
        <LabField label="Exame e unidade para comparar"><select value={selected.key} onChange={(event) => { setSelectedKey(event.target.value); setSelectedDate(null); }}>{seriesOptions.map((option) => <option key={option.key} value={option.key}>{option.analyte} · {option.unit}</option>)}</select></LabField>
        <div className="lab-latest"><span>Último valor exato na janela</span><strong>{lastPoint?.value !== null && lastPoint ? numeric(lastPoint.value) : "—"}<small>{selected.unit}</small></strong><p>{lastPoint ? shortDate(lastPoint.date) : "Sem valor comparável neste período"}</p></div>
        <div className="lab-chart" data-testid="laboratory-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={series.points} margin={{ top: 15, right: 12, left: -16, bottom: 4 }} onClick={(state) => { if (typeof state.activeLabel === "string") setSelectedDate(state.activeLabel); }}><CartesianGrid vertical={false} stroke="var(--lab-line)" strokeDasharray="3 6" /><XAxis dataKey="date" tickFormatter={shortDate} minTickGap={40} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip labelFormatter={(label) => shortDate(String(label))} formatter={(value) => [`${value === null ? "Não medido" : numeric(Number(value))} ${selected.unit}`, selected.analyte]} /><Line type="linear" dataKey="value" name={selected.analyte} connectNulls={false} stroke="var(--lab-blue)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--lab-blue)", stroke: "var(--lab-paper)", strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
        <p className="lab-evidence">{series.sampleSize} valores · {series.window.days} dias · {series.missingDays} dias sem coleta comparável</p>
        {series.excludedCensored > 0 ? <p className="lab-caption">{series.excludedCensored} resultado(s) com &lt; ou &gt; preservado(s) no histórico, sem virar ponto exato.</p> : null}
        {series.repeatedDays > 0 ? <p className="lab-caption">{series.repeatedDays} dia(s) com mais de uma medição: consulte os valores separados abaixo; nenhuma média foi inventada.</p> : null}
        {selectedDate ? <div className="lab-point-detail" aria-live="polite"><strong>{fullDate(selectedDate)}</strong><p>{series.points.find((point) => point.date === selectedDate)?.values.map(numeric).join(" · ") || "Sem coleta comparável nesse dia"} {selected.unit}</p></div> : null}
        <p className="lab-caption">Mesma unidade, sem conversão automática. Lacunas não valem zero. Valores descrevem o laudo; não definem diagnóstico.</p>
      </> : <div className="lab-empty"><TestTube size={34} weight="thin" /><h3>{panels.length ? "A curva precisa de valor e unidade" : "Sua primeira coleta começa aqui"}</h3><p>{panels.length ? "Resultados textuais e campos incompletos ficam guardados. Adicione a unidade informada para comparar números." : "Guarde a data, transcreva os resultados e anexe o original. A evolução aparece com os seus dados reais."}</p></div>}
    </section>
    <section className="lab-history" aria-label="Linha do tempo dos exames"><div className="lab-section-heading"><h2>Coleta por coleta</h2><span>{filtered.length}</span></div><label className="lab-search"><MagnifyingGlass size={18} /><KeyboardInput aria-label="Buscar nos meus exames" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(30); }} placeholder="Buscar coleta, analito ou laboratório" /></label>
      {filtered.slice(0, limit).map((panel) => <article className="lab-panel-card" key={panel.id}><div className="lab-panel-date"><span>{shortDate(panel.payload.collectedOn)}</span><small>{panel.payload.collectedOn.slice(0, 4)}</small></div><div className="lab-panel-content"><header><div><h3>{text(panel.payload.title, "Painel")}</h3><p>{text(panel.payload.laboratory, "Laboratório não informado")}</p></div><button type="button" aria-label={`Editar ${text(panel.payload.title, "painel")}`} onClick={() => openCapture(panel)}><PencilSimple size={19} /></button></header><dl className="lab-result-list">{panel.payload.results.map((result) => <div key={result.id}><dt>{result.analyte}<small>{referenceLabel(result)}</small></dt><dd>{resultLabel(result)}<small>{text(result.unit, result.value.state === "known" && result.value.value.kind === "text" ? "" : "unidade não informada")}</small></dd></div>)}</dl>{panel.payload.note.state === "known" ? <p className="lab-panel-note">{panel.payload.note.value}</p> : null}{panel.payload.attachments.map((attachment) => <button type="button" className="lab-download" key={attachment.id} onClick={() => void download(panel, attachment)}><FilePdf size={18} /><span>{attachment.name}<small>{Math.ceil(attachment.size / 1024)} KB · original verificado</small></span><DownloadSimple size={18} /></button>)}</div></article>)}
      {filtered.length === 0 && panels.length > 0 ? <p className="lab-caption">Nenhum exame com esse termo. Tente o nome do analito ou da coleta.</p> : null}
      {filtered.length > limit ? <button type="button" className="secondary-cta" onClick={() => setLimit((current) => current + 30)}>Mostrar mais coletas</button> : null}
    </section>
    <aside className="lab-private"><ShieldCheck size={22} weight="thin" /><p><strong>Seus resultados, no seu aparelho.</strong> Incluídos no backup cifrado. Atualizar o app não troca o banco. Leve o contexto e os laudos à consulta; o Mentor não interpreta tratamento.</p></aside>
    {notice ? <p className="lab-notice" role="status"><Info size={18} />{notice}</p> : null}
    <BottomSheet open={formOpen} onOpenChange={setFormOpen} title={editing ? "Revisar exame" : "Novo exame pessoal"} description="Uma coleta, seus resultados e o documento original." snap={0.92}><LaboratoryCapture key={editing?.id ?? "new"} referenceDate={currentLocalDate} initial={editing} onCancel={() => setFormOpen(false)} onSave={async (payload) => { await onSave(payload, editing); setFormOpen(false); setNotice(editing ? "Nova revisão salva. A versão anterior continua no histórico." : "Exame guardado. O original faz parte do backup cifrado."); }} /></BottomSheet>
  </div>;
}
