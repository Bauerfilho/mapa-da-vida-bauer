import { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CalendarBlank } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { Minus } from "@phosphor-icons/react/dist/csr/Minus";
import { Package } from "@phosphor-icons/react/dist/csr/Package";
import { Pill } from "@phosphor-icons/react/dist/csr/Pill";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Pulse } from "@phosphor-icons/react/dist/csr/Pulse";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { useMemo, useState, type FormEvent } from "react";
import {
  todayInTimeZone,
  type LocalDate,
  type LocalTime,
  type MedicationTrailSlot,
} from "../domain";
import { localTimeInAppZone } from "../data";
import { useMedicationData } from "../hooks";
import { KeyboardInput, KeyboardTextarea } from "../mobile";
import "./medication-workspace.css";

type WorkspaceView = "trail" | "regimens";
type PendingDoseAction =
  | { kind: "custom-time"; slotId: string }
  | { kind: "skip"; slotId: string }
  | null;

export interface MedicationWorkspaceProps {
  currentLocalDate?: LocalDate;
  onBack?: () => void;
  onDataChange?: () => void;
  onOpenSupplemental?: (mode: "medication-stock" | "medication-sos") => void;
}

function formatLocalDate(localDate: LocalDate): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(new Date(`${localDate}T12:00:00Z`));
}

function formatTiming(slot: MedicationTrailSlot): string | null {
  if (slot.timing.state !== "known") return null;
  const minutes = Math.abs(slot.timing.deltaMinutes);
  if (slot.timing.relation === "exact") return "no horário registrado";
  if (slot.timing.relation === "late") return `${minutes} min após o planejado`;
  return `${minutes} min antes do planejado`;
}

function slotStatus(slot: MedicationTrailSlot): {
  title: string;
  detail: string;
  tone: "unknown" | "taken" | "skipped";
} {
  const actual = slot.event?.payload.actualTimeLocal;
  const actualTime = actual?.state === "known" ? actual.value.slice(0, 5) : null;
  const timing = formatTiming(slot);
  switch (slot.state) {
    case "taken_time_recorded":
      return {
        title: "Tomado · horário registrado",
        detail: [actualTime ? `real ${actualTime}` : null, timing].filter(Boolean).join(" · "),
        tone: "taken",
      };
    case "taken_time_unknown":
      return {
        title: "Tomado · horário não registrado",
        detail: "a tomada foi confirmada; o relógio ficou desconhecido",
        tone: "taken",
      };
    case "skipped_confirmed":
      return {
        title: "Pulado · confirmado",
        detail: "omissão registrada explicitamente",
        tone: "skipped",
      };
    case "legacy_timing_state":
      return {
        title: "Tomada registrada",
        detail: actualTime ? `horário real ${actualTime}` : "registro anterior preservado",
        tone: "taken",
      };
    default:
      return {
        title: "Não registrado",
        detail: "lacuna de dados; não significa que a dose foi pulada",
        tone: "unknown",
      };
  }
}

function knownText(value: { state: string; value?: string }, fallback: string): string {
  return value.state === "known" && typeof value.value === "string" ? value.value : fallback;
}

export function MedicationWorkspace({
  currentLocalDate = todayInTimeZone(),
  onBack,
  onDataChange,
  onOpenSupplemental,
}: MedicationWorkspaceProps) {
  const medication = useMedicationData(currentLocalDate);
  const [view, setView] = useState<WorkspaceView>("trail");
  const [composerOpen, setComposerOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingDoseAction>(null);
  const [customTime, setCustomTime] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const trail = medication.snapshot?.trail;
  const counts = useMemo(() => {
    const slots = trail?.slots ?? [];
    return {
      total: slots.length,
      taken: slots.filter((slot) =>
        slot.state === "taken_time_recorded" ||
        slot.state === "taken_time_unknown" ||
        slot.state === "legacy_timing_state",
      ).length,
      skipped: slots.filter((slot) => slot.state === "skipped_confirmed").length,
      notRecorded: slots.filter((slot) => slot.state === "not_recorded").length,
    };
  }, [trail]);

  const saveDose = async (
    slot: MedicationTrailSlot,
    confirmation: "taken_time_recorded" | "taken_time_unknown" | "skipped_confirmed",
    actualTimeLocal?: LocalTime,
  ) => {
    setFeedback(null);
    try {
      await medication.recordDose({
        regimenId: slot.regimen.id,
        localDate: currentLocalDate,
        scheduledTimeLocal: slot.scheduledTimeLocal,
        confirmation,
        ...(actualTimeLocal ? { actualTimeLocal } : {}),
      });
      setPendingAction(null);
      setCustomTime("");
      setFeedback(
        confirmation === "skipped_confirmed"
          ? "Dose pulada registrada como confirmação explícita."
          : "Tomada registrada no trilho.",
      );
      onDataChange?.();
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <section className="mw-workspace" aria-labelledby="mw-title">
      <header className="mw-header">
        {onBack ? (
          <button type="button" className="mw-back" onClick={onBack} aria-label="Voltar">
            <ArrowLeft size={20} />
          </button>
        ) : (
          <span className="mw-mark" aria-hidden="true"><Pill size={22} weight="duotone" /></span>
        )}
        <div>
          <p>registro factual</p>
          <h1 id="mw-title">Medicamentos</h1>
          <span>{formatLocalDate(currentLocalDate)}</span>
        </div>
      </header>

      <div className="mw-safety" role="note">
        <ShieldCheck size={21} weight="duotone" />
        <p><strong>Seu esquema, sem interpretação.</strong> O app organiza o que você informou e nunca sugere dose, suspensão ou alteração de horário.</p>
      </div>

      <nav className="mw-tabs" aria-label="Área de medicamentos">
        <button type="button" aria-pressed={view === "trail"} onClick={() => setView("trail")}>
          <Clock size={18} />Trilho do dia
        </button>
        <button type="button" aria-pressed={view === "regimens"} onClick={() => setView("regimens")}>
          <Pill size={18} />Regimes informados
        </button>
      </nav>

      {onOpenSupplemental ? (
        <section className="mw-supplemental" aria-label="Outros registros de medicamentos">
          <button type="button" onClick={() => onOpenSupplemental("medication-stock")}>
            <Package size={19} weight="duotone" />
            <span><strong>Estoque e reposição</strong><small>contagem física e limite escolhido por você</small></span>
          </button>
          <button type="button" onClick={() => onOpenSupplemental("medication-sos")}>
            <Pulse size={19} weight="duotone" />
            <span><strong>Registrar uso SOS</strong><small>uso ocorrido e resposta percebida, sem recomendação</small></span>
          </button>
        </section>
      ) : null}

      {medication.error ? <p className="mw-feedback mw-error" role="alert">{medication.error.message}</p> : null}
      {feedback ? <p className="mw-feedback" role="status">{feedback}</p> : null}

      {view === "trail" ? (
        <div className="mw-trail-view">
          <dl className="mw-summary" aria-label="Resumo do trilho de medicamentos">
            <div><dt>Planejadas</dt><dd>{counts.total || "—"}</dd></div>
            <div data-tone="taken"><dt>Tomadas</dt><dd>{counts.total ? counts.taken : "—"}</dd></div>
            <div data-tone="unknown"><dt>Sem registro</dt><dd>{counts.total ? counts.notRecorded : "—"}</dd></div>
            <div data-tone="skipped"><dt>Puladas</dt><dd>{counts.total ? counts.skipped : "—"}</dd></div>
          </dl>

          {medication.loading ? (
            <div className="mw-loading" aria-live="polite">Abrindo o trilho privado…</div>
          ) : !trail?.slots.length ? (
            <div className="mw-empty">
              <Pill size={28} weight="thin" />
              <div><h2>Nenhum horário estruturado</h2><p>Cadastre somente o regime que você já recebeu. Depois, cada horário aparece aqui sem transformar silêncio em dose pulada.</p></div>
              <button type="button" onClick={() => { setView("regimens"); setComposerOpen(true); }}><Plus size={18} />Cadastrar regime informado</button>
            </div>
          ) : (
            <ol className="mw-dose-list">
              {trail.slots.map((slot) => {
                const status = slotStatus(slot);
                const name = knownText(slot.regimen.payload.medicationName, "Medicamento não nomeado");
                const dose = knownText(slot.regimen.payload.doseLabel, "dose não registrada");
                const isPending = pendingAction?.slotId === slot.id;
                return (
                  <li className="mw-dose" key={slot.id} data-tone={status.tone}>
                    <div className="mw-dose-time"><span>{slot.scheduledTimeLocal.slice(0, 5)}</span><i aria-hidden="true" /></div>
                    <div className="mw-dose-body">
                      <header><div><h2>{name}</h2><p>{dose}</p></div><span className="mw-state-icon" aria-hidden="true">{status.tone === "taken" ? <Check size={16} /> : status.tone === "skipped" ? <Minus size={16} /> : <Clock size={16} />}</span></header>
                      <div className="mw-dose-status"><strong>{status.title}</strong><small>{status.detail}</small></div>

                      {slot.state === "not_recorded" && !isPending ? (
                        <div className="mw-dose-actions">
                          <button type="button" onClick={() => void saveDose(slot, "taken_time_recorded", localTimeInAppZone())}><CheckCircle size={17} />Tomei agora</button>
                          <button type="button" onClick={() => { setCustomTime(""); setPendingAction({ kind: "custom-time", slotId: slot.id }); }}><Clock size={17} />Outro horário</button>
                          <button type="button" onClick={() => void saveDose(slot, "taken_time_unknown")}><Check size={17} />Sem horário</button>
                          <button type="button" className="mw-skip" onClick={() => setPendingAction({ kind: "skip", slotId: slot.id })}><Minus size={17} />Pulei</button>
                        </div>
                      ) : null}

                      {pendingAction?.kind === "custom-time" && pendingAction.slotId === slot.id ? (
                        <div className="mw-inline-editor">
                          <label><span>Horário real da tomada</span><KeyboardInput type="time" value={customTime} onChange={(event) => setCustomTime(event.target.value)} /></label>
                          <div><button type="button" onClick={() => setPendingAction(null)}>Cancelar</button><button type="button" disabled={!customTime || medication.saving} onClick={() => void saveDose(slot, "taken_time_recorded", customTime as LocalTime)}>Salvar horário real</button></div>
                        </div>
                      ) : null}

                      {pendingAction?.kind === "skip" && pendingAction.slotId === slot.id ? (
                        <div className="mw-skip-confirm" role="alert">
                          <WarningCircle size={20} />
                          <p><strong>Confirmar dose pulada?</strong><span>Só use esta opção se a omissão realmente aconteceu.</span></p>
                          <div><button type="button" onClick={() => setPendingAction(null)}>Voltar</button><button type="button" disabled={medication.saving} onClick={() => void saveDose(slot, "skipped_confirmed")}>Confirmar pulada</button></div>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {trail?.unlinkedDoseEvents.length ? (
            <div className="mw-legacy-note"><Info size={18} /><p><strong>{trail.unlinkedDoseEvents.length} registro(s) anterior(es) preservado(s)</strong><span>Eles continuam no histórico, mas não foram vinculados automaticamente a um regime para evitar suposições.</span></p></div>
          ) : null}
        </div>
      ) : (
        <RegimenPanel
          localDate={currentLocalDate}
          open={composerOpen}
          setOpen={setComposerOpen}
          regimens={medication.snapshot?.regimens ?? []}
          saving={medication.saving}
          onCreate={async (input) => {
            setFeedback(null);
            try {
              await medication.createRegimen(input);
              setComposerOpen(false);
              setFeedback("Regime informado salvo e conectado ao trilho.");
              onDataChange?.();
            } catch (reason) {
              const message = reason instanceof Error ? reason.message : String(reason);
              setFeedback(message);
              throw reason;
            }
          }}
        />
      )}
    </section>
  );
}

function RegimenPanel({
  localDate,
  open,
  setOpen,
  regimens,
  saving,
  onCreate,
}: {
  localDate: LocalDate;
  open: boolean;
  setOpen: (open: boolean) => void;
  regimens: NonNullable<ReturnType<typeof useMedicationData>["snapshot"]>["regimens"];
  saving: boolean;
  onCreate: (input: {
    medicationName: string;
    doseLabel: string;
    scheduledTimesLocal: LocalTime[];
    activeFromLocalDate: LocalDate;
    activeThroughLocalDate?: LocalDate;
    note?: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [times, setTimes] = useState<string[]>([""]);
  const [startDate, setStartDate] = useState<LocalDate>(localDate);
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const scheduledTimesLocal = [...new Set(times.filter(Boolean))] as LocalTime[];
    if (!name.trim() || !dose.trim() || !scheduledTimesLocal.length) {
      setFormError("Preencha nome, dose escrita e ao menos um horário informado.");
      return;
    }
    try {
      await onCreate({
        medicationName: name,
        doseLabel: dose,
        scheduledTimesLocal,
        activeFromLocalDate: startDate,
        ...(endDate ? { activeThroughLocalDate: endDate as LocalDate } : {}),
        ...(note.trim() ? { note } : {}),
      });
      setName(""); setDose(""); setTimes([""]); setEndDate(""); setNote("");
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <div className="mw-regimen-view">
      <div className="mw-regimen-command">
        <div><h2>Regimes informados</h2><p>Nome, dose escrita e horários formam a chave que liga cada registro do dia.</p></div>
        <button type="button" onClick={() => setOpen(!open)}><Plus size={17} />{open ? "Fechar" : "Novo regime"}</button>
      </div>

      {open ? (
        <form className="mw-regimen-form" onSubmit={submit}>
          <div className="mw-form-title"><Pill size={22} weight="duotone" /><div><h3>Transcrever regime</h3><p>Copie exatamente o que você já recebeu; esta tela não decide conduta.</p></div></div>
          <label><span>Nome na receita ou caixa</span><KeyboardInput required value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" placeholder="Sem nome pré-preenchido" /></label>
          <label><span>Dose escrita</span><KeyboardInput required value={dose} onChange={(event) => setDose(event.target.value)} placeholder="Ex.: 50 mg" /></label>
          <fieldset className="mw-times"><legend>Horários informados</legend>{times.map((time, index) => <div key={index}><KeyboardInput required type="time" value={time} onChange={(event) => setTimes((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} aria-label={`Horário ${index + 1}`} />{times.length > 1 ? <button type="button" onClick={() => setTimes((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remover horário ${index + 1}`}><Minus size={16} /></button> : null}</div>)}<button type="button" onClick={() => setTimes((current) => [...current, ""])}><Plus size={16} />Adicionar horário</button></fieldset>
          <div className="mw-date-grid"><label><span>Início informado</span><KeyboardInput required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value as LocalDate)} /></label><label><span>Fim informado</span><KeyboardInput type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /><small>opcional; vazio = não informado</small></label></div>
          <label><span>Observação factual</span><KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opcional; não inclua dados de pacientes" /></label>
          {formError ? <p className="mw-form-error" role="alert">{formError}</p> : null}
          <button className="mw-save-regimen" type="submit" disabled={saving}><ShieldCheck size={18} />{saving ? "Salvando…" : "Salvar regime informado"}</button>
        </form>
      ) : null}

      {!regimens.length ? (
        <div className="mw-regimen-empty"><CalendarBlank size={25} /><p><strong>Nenhum regime estruturado.</strong><span>Registros antigos permanecem no arquivo; nada foi adivinhado para preencher esta área.</span></p></div>
      ) : (
        <ul className="mw-regimen-list">
          {regimens.map((regimen) => {
            const name = knownText(regimen.payload.medicationName, "Medicamento não nomeado");
            const dose = knownText(regimen.payload.doseLabel, "dose não registrada");
            const times = regimen.payload.scheduledTimesLocal.state === "known"
              ? regimen.payload.scheduledTimesLocal.value.map((time) => time.slice(0, 5)).join(" · ")
              : "horários não registrados";
            const from = regimen.payload.activeFromLocalDate.state === "known" ? regimen.payload.activeFromLocalDate.value : "—";
            const through = regimen.payload.activeThroughLocalDate.state === "known" ? regimen.payload.activeThroughLocalDate.value : "sem fim informado";
            return <li key={regimen.id}><span><Pill size={21} weight="duotone" /></span><div><h3>{name}</h3><p>{dose}</p><strong><Clock size={14} />{times}</strong><small>{from} → {through}</small></div><i>ativo confirmado</i></li>;
          })}
        </ul>
      )}
    </div>
  );
}
