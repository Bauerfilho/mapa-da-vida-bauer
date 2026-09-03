import { useMemo, useState, type FormEvent } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { Bell } from "@phosphor-icons/react/dist/csr/Bell";
import { Cake } from "@phosphor-icons/react/dist/csr/Cake";
import { CalendarCheck } from "@phosphor-icons/react/dist/csr/CalendarCheck";
import { CalendarDots } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { Gift } from "@phosphor-icons/react/dist/csr/Gift";
import { Pause } from "@phosphor-icons/react/dist/csr/Pause";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { BottomSheet, KeyboardInput, KeyboardTextarea, useKeyboard } from "../mobile";
import { recordGenericEvent, shareOrDownloadFile, updateAnnualDate } from "../data";
import { calendarDayCount, shiftLocalDate } from "../domain/dates";
import { annualDateDefinitions, createAnnualDate, projectAnnualDates, type AnnualDateKind, type AnnualDatePayload, type NonLeapYearPolicy } from "../domain/annualDates";
import { buildAnnualCalendar } from "../domain/annualCalendar";
import type { LocalDate, MentorEntity } from "../domain/model";
import "./annual-dates-workspace.css";

type AnnualEntity = MentorEntity<"generic.event"> & { payload: AnnualDatePayload };
const months = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function noticeLabel(payload: AnnualDatePayload): string {
  if (payload.recurrenceStatus === "paused") return "Recorrência pausada";
  if (payload.reminderLeadDays.state === "known") return payload.reminderLeadDays.value === 0 ? "Lembrar no dia" : `Lembrar ${payload.reminderLeadDays.value} dia${payload.reminderLeadDays.value === 1 ? "" : "s"} antes`;
  return payload.reminderLeadDays.state === "not_applicable" ? "Sem aviso antecipado" : "Antecedência não escolhida";
}

function AnnualDateForm({ entry, onSave }: { entry: AnnualEntity | null; onSave: (payload: AnnualDatePayload) => Promise<void> }) {
  const keyboard = useKeyboard(); const previous = entry?.payload;
  const [kind, setKind] = useState<AnnualDateKind>(previous?.kind ?? "birthday");
  const [label, setLabel] = useState(previous?.label ?? "");
  const [month, setMonth] = useState(previous ? String(previous.month) : "");
  const [day, setDay] = useState(previous ? String(previous.day) : "");
  const [lead, setLead] = useState(previous?.reminderLeadDays.state === "known" ? String(previous.reminderLeadDays.value) : "");
  const [noticeMode, setNoticeMode] = useState(previous?.reminderLeadDays.state === "not_applicable" ? "off" : "on");
  const [leapPolicy, setLeapPolicy] = useState<NonLeapYearPolicy | "">(previous?.nonLeapYearPolicy.state === "known" ? previous.nonLeapYearPolicy.value : "");
  const [active, setActive] = useState(previous?.recurrenceStatus !== "paused");
  const [note, setNote] = useState(previous?.note.state === "known" ? previous.note.value : "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const leap = month === "2" && Number(day) === 29;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; keyboard.hide(); setBusy(true); setError(null);
    try {
      const parsedDay = /^\d{1,2}$/.test(day) ? Number(day) : NaN;
      const parsedLead = lead === "" ? undefined : /^\d{1,3}$/.test(lead) ? Number(lead) : NaN;
      await onSave(createAnnualDate({ kind, label, month: Number(month), day: parsedDay, reminderLeadDays: noticeMode === "off" ? null : parsedLead, nonLeapYearPolicy: leapPolicy || undefined, recurrenceStatus: active ? "active" : "paused", note }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível guardar a data."); }
    finally { setBusy(false); }
  };
  return <form className="annual-form" onSubmit={submit} noValidate>
    <div className="annual-kind" role="group" aria-label="Tipo de data anual"><button type="button" aria-pressed={kind === "birthday"} onClick={() => setKind("birthday")}><Cake size={22} weight="thin" />Aniversário</button><button type="button" aria-pressed={kind === "annual_commitment"} onClick={() => setKind("annual_commitment")}><CalendarCheck size={22} weight="thin" />Compromisso anual</button></div>
    <label>{kind === "birthday" ? "Quem você quer lembrar?" : "Nome do compromisso"}<KeyboardInput aria-label="Nome da data anual" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={120} required autoComplete="off" placeholder={kind === "birthday" ? "Nome da pessoa" : "Uma data que volta todo ano"} /></label>
    <div className="annual-date-fields"><label>Dia<KeyboardInput aria-label="Dia da data anual" inputMode="numeric" value={day} onChange={(event) => setDay(event.target.value)} maxLength={2} required placeholder="DD" /></label><label>Mês<select aria-label="Mês da data anual" value={month} onChange={(event) => setMonth(event.target.value)} required><option value="">Escolher mês</option>{months.map((name, index) => <option key={name} value={String(index + 1)}>{name}</option>)}</select></label></div>
    <p className="annual-help">Não pedimos ano de nascimento. A data se repete anualmente e não reserva horário.</p>
    {leap ? <label>Em anos sem 29 de fevereiro<select aria-label="Regra para 29 de fevereiro" value={leapPolicy} onChange={(event) => setLeapPolicy(event.target.value as NonLeapYearPolicy | "")}><option value="">Deixar pendente</option><option value="feb28">Lembrar em 28 de fevereiro</option><option value="mar01">Lembrar em 1º de março</option></select><small>Sem escolha, nenhum dia substituto ou alarme é inventado.</small></label> : null}
    <fieldset className="annual-reminder-fields"><legend><Bell size={18} />Como lembrar</legend><label>Antecedência<select aria-label="Modo de aviso anual" value={noticeMode} onChange={(event) => setNoticeMode(event.target.value)}><option value="on">Definir quantos dias antes</option><option value="off">Sem aviso antecipado</option></select></label>{noticeMode === "on" ? <label>Dias antes<KeyboardInput aria-label="Dias de antecedência" inputMode="numeric" value={lead} onChange={(event) => setLead(event.target.value)} maxLength={3} placeholder="0 = no próprio dia" /><small>De 0 a 365. Vazio continua como não escolhido.</small></label> : null}<p>Os avisos aparecem em Hoje quando você abre o app. Para alertar com o app fechado, exporte para o calendário e confira a importação.</p></fieldset>
    <label>Observação opcional<KeyboardTextarea aria-label="Observação da data anual" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} /></label>
    {entry ? <label className="annual-checkbox"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />Repetir esta data nos próximos anos</label> : null}
    {error ? <p className="annual-error" role="alert">{error}</p> : null}
    <button type="submit" className="primary-cta" disabled={busy}>{busy ? "Guardando…" : entry ? "Salvar revisão da data" : "Guardar data anual"}</button>
  </form>;
}

function CalendarExport({ entities, today, onDelivered }: { entities: readonly MentorEntity[]; today: LocalDate; onDelivered: (message: string) => void }) {
  const [years, setYears] = useState(2); const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const end = shiftLocalDate(today, years === 2 ? 730 : 365);
  const preview = useMemo(() => projectAnnualDates(entities, today, end), [entities, today, end]);
  const exportCalendar = async () => {
    if (busy || !acknowledged || preview.pending.length || !preview.occurrences.length) return;
    setBusy(true); setError(null);
    try {
      const result = await buildAnnualCalendar(entities, { start: today, end });
      const delivery = await shareOrDownloadFile(new Blob([result.text], { type: "text/calendar;charset=utf-8" }), `Mentor-datas-${today}.ics`, "Datas anuais do Mentor");
      onDelivered(delivery === "shared" ? "Arquivo entregue ao menu de compartilhamento. Confira a importação no calendário escolhido." : "Arquivo de calendário baixado. A importação e os alertas precisam ser conferidos no aparelho.");
    } catch (reason) { setError(reason instanceof DOMException && reason.name === "AbortError" ? "Entrega cancelada. Suas datas continuam guardadas no app." : reason instanceof Error ? reason.message : "Não foi possível gerar o calendário."); }
    finally { setBusy(false); }
  };
  return <div className="annual-export"><div className="annual-export-summary"><CalendarDots size={35} weight="thin" /><div><strong>{preview.occurrences.length}</strong><span>ocorrências no arquivo</span></div></div>
    <label>Período<select aria-label="Período da exportação anual" value={years} onChange={(event) => setYears(Number(event.target.value))}><option value={1}>Próximos 365 dias</option><option value={2}>Próximos 730 dias</option></select></label>
    <ul><li>Datas de dia inteiro, sem ocupar disponibilidade.</li><li>Alarmes às 09h no fuso de Brasília, respeitando a antecedência escolhida. Avisos cuja data já passou não são recriados.</li><li>O arquivo contém nomes e datas, sem suas observações. Não é um backup cifrado.</li></ul>
    <p className="annual-export-note"><ShieldCheck size={19} /><span>Importar não sincroniza. Use um calendário separado; correções, pausas e exclusões no Mentor não atualizam as cópias já importadas. Confira possíveis duplicatas e os alertas no destino.</span></p>
    {preview.pending.length ? <p className="annual-error" role="alert">Há uma regra de 29/02 pendente para {preview.pending.length} ocorrência(s). Edite essa data antes de exportar; não vamos escolher o dia por você.</p> : null}
    <label className="annual-checkbox"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />Entendi que o calendário receberá nomes e datas.</label>
    {error ? <p className="annual-error" role="alert">{error}</p> : null}
    <button type="button" className="primary-cta" disabled={busy || !acknowledged || !!preview.pending.length || !preview.occurrences.length} onClick={() => void exportCalendar()}><ArrowSquareOut size={18} />{busy ? "Preparando…" : "Exportar arquivo de calendário"}</button>
  </div>;
}

export function AnnualDatesWorkspace({ entities, today, onDataChange }: { entities: readonly MentorEntity[]; today: LocalDate; onDataChange: () => void }) {
  const keyboard = useKeyboard(); const [editing, setEditing] = useState<AnnualEntity | null>(null);
  const [formOpen, setFormOpen] = useState(false); const [exportOpen, setExportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null); const [limit, setLimit] = useState(5);
  const definitions = useMemo(() => annualDateDefinitions(entities), [entities]);
  const projection = useMemo(() => projectAnnualDates(entities, today, shiftLocalDate(today, 366)), [entities, today]);
  const activeCount = definitions.filter((item) => item.payload.recurrenceStatus === "active").length;
  const rows = definitions.map((entry) => ({ entry, next: projection.occurrences.find((item) => item.entityId === entry.id), pending: projection.pending.some((item) => item.entityId === entry.id) })).sort((a, b) => (a.next?.localDate ?? "9999-12-31").localeCompare(b.next?.localDate ?? "9999-12-31") || a.entry.payload.label.localeCompare(b.entry.payload.label, "pt-BR"));
  const begin = (entry: AnnualEntity | null) => { keyboard.hide(); setEditing(entry); setFormOpen(true); setNotice(null); };
  return <section className="annual-workspace" data-testid="annual-dates-workspace">
    <header className="annual-header"><span className="annual-header-icon"><Gift size={26} weight="thin" /></span><div><p className="eyebrow">Laços e compromissos</p><h2>Datas que voltam</h2><p>{activeCount ? `${activeCount} ${activeCount === 1 ? "data anual ativa" : "datas anuais ativas"}` : "Lembrar de quem e do que importa"}</p></div><button type="button" className="annual-add" aria-label="Adicionar data anual" onClick={() => begin(null)}><Plus size={21} /></button></header>
    {!definitions.length ? <div className="annual-empty"><p>Aniversários próximos e compromissos que se repetem, sem preencher sua agenda de estudo.</p><button type="button" className="secondary-cta" onClick={() => begin(null)}><Cake size={20} weight="thin" />Guardar a primeira data</button></div> : <div className="annual-list">{rows.slice(0, limit).map(({ entry, next, pending }) => { const payload = entry.payload; const distance = next ? calendarDayCount(today, next.localDate) - 1 : null; return <button type="button" key={entry.id} className={`annual-row ${distance === 0 ? "is-today" : ""} ${payload.recurrenceStatus === "paused" ? "is-paused" : ""}`} aria-label={`Editar ${payload.label}`} onClick={() => begin(entry)}><span className="annual-date-badge"><small>{months[payload.month - 1].slice(0, 3)}</small><strong>{payload.day}</strong></span><span className="annual-row-copy"><strong>{payload.label}</strong><small>{payload.kind === "birthday" ? "Aniversário" : "Compromisso anual"}{distance !== null ? ` · ${distance === 0 ? "hoje" : distance === 1 ? "amanhã" : `em ${distance} dias`}` : ""}</small><em>{pending ? "29/02: escolha a regra para anos comuns" : noticeLabel(payload)}</em></span>{payload.recurrenceStatus === "paused" ? <Pause size={16} /> : pending ? <WarningCircle size={19} /> : <CaretRight size={17} />}</button>; })}</div>}
    {definitions.length > limit ? <button type="button" className="annual-more" onClick={() => setLimit((value) => value + 12)}>Ver mais {Math.min(12, definitions.length - limit)} datas</button> : null}
    {definitions.length ? <button type="button" className="annual-export-button" onClick={() => { keyboard.hide(); setExportOpen(true); }}><ArrowSquareOut size={18} /><span>Levar ao calendário do aparelho<small>Arquivo .ics · importação manual</small></span><CaretRight size={16} /></button> : null}
    {notice ? <p className="annual-notice" role="status"><Check size={17} />{notice}</p> : null}
    <BottomSheet open={formOpen} onOpenChange={setFormOpen} title={editing ? "Editar data anual" : "Uma data para lembrar"} description="Nome, dia, mês e antecedência; sem inventar horários." snap={0.91}>{formOpen ? <AnnualDateForm entry={editing} onSave={async (payload) => { if (editing) await updateAnnualDate({ entityId: editing.id, expectedRevision: editing.revision, payload }); else await recordGenericEvent({ domain: "agenda", payload, summary: "Data anual guardada pelo usuário." }); onDataChange(); setFormOpen(false); setNotice(editing ? "Data atualizada; a revisão anterior permanece no histórico." : "Data guardada. Os próximos anos são calculados automaticamente."); }} /> : null}</BottomSheet>
    <BottomSheet open={exportOpen} onOpenChange={setExportOpen} title="Calendário do aparelho" description="Você escolhe onde importar. Nenhuma conta é conectada automaticamente." snap={0.87}>{exportOpen ? <CalendarExport entities={entities} today={today} onDelivered={(message) => { setExportOpen(false); setNotice(message); }} /> : null}</BottomSheet>
  </section>;
}
