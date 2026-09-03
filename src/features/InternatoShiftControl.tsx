import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CalendarBlank } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { Coffee } from "@phosphor-icons/react/dist/csr/Coffee";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { MoonStars } from "@phosphor-icons/react/dist/csr/MoonStars";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { KeyboardInput } from "../mobile";
import {
  APP_TIME_ZONE,
  combineLocalDateAndTime,
  draftFromShift,
  emptyManualShiftDraft,
  localTimeInTimeZone,
  markAttendancePresent,
  planManualShiftCreation,
  planShiftUpdate,
  selectDefaultShiftId,
  shiftSpansLocalDate,
  todayInTimeZone,
  type CreateManualShiftInput,
  type LocalDate,
  type ManualShiftDraft,
  type MentorEntity,
  type RecordShiftTimeInput,
  type ShiftActualDraft,
  type ShiftAttendanceDraft,
  type ShiftBreakDraftMode,
  type UpdateShiftInput,
} from "../domain";
import "./internato-shift-control.css";

interface InternatoShiftActions {
  createManualShift: (input: CreateManualShiftInput) => Promise<MentorEntity<"internato.shift">>;
  updateShift: (input: UpdateShiftInput) => Promise<MentorEntity<"internato.shift">>;
  recordBreakStart: (input: RecordShiftTimeInput) => Promise<MentorEntity<"internato.shift">>;
  recordBreakEnd: (input: RecordShiftTimeInput) => Promise<MentorEntity<"internato.shift">>;
}

export interface InternatoShiftControlProps {
  shifts: Array<MentorEntity<"internato.shift">>;
  actions: InternatoShiftActions;
  referenceDate: LocalDate;
  preferredShiftId?: string | null;
  saving?: boolean;
  onSaved?: (shift: MentorEntity<"internato.shift">) => void | Promise<void>;
}

const ATTENDANCE_OPTIONS: Array<{
  value: ShiftAttendanceDraft;
  label: string;
  detail: string;
}> = [
  { value: "unknown", label: "Não confirmei", detail: "continua desconhecido" },
  { value: "present", label: "Presente", detail: "registre os horários reais" },
  { value: "absent_confirmed", label: "Falta confirmada", detail: "não presume motivo" },
  { value: "swapped", label: "Troca", detail: "a jornada não foi realizada por mim" },
  { value: "excused", label: "Dispensa", detail: "ausência autorizada" },
  { value: "cancelled", label: "Cancelada", detail: "a jornada foi cancelada" },
];

const BREAK_OPTIONS: Array<{
  value: ShiftBreakDraftMode;
  label: string;
  detail: string;
}> = [
  { value: "unknown", label: "Ainda não registrei", detail: "não vira zero nem ausência" },
  { value: "timed", label: "Houve intervalo", detail: "informar início e fim" },
  { value: "none_confirmed", label: "Sem intervalo", detail: "ausência confirmada" },
];

function formatClock(value: string): string {
  return value.slice(11, 16);
}

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function shiftTitle(shift: MentorEntity<"internato.shift">): string {
  const assignment = shift.payload.assignment;
  return assignment.state === "known" ? assignment.value : "Jornada de internato";
}

function shiftWindowLabel(shift: MentorEntity<"internato.shift">): string {
  const start = shift.payload.scheduledStartLocal;
  const end = shift.payload.scheduledEndLocal;
  const crossesMidnight = start.slice(0, 10) !== end.slice(0, 10);
  return crossesMidnight
    ? `${formatDate(start)} · ${formatClock(start)} → ${formatDate(end)} · ${formatClock(end)}`
    : `${formatDate(start)} · ${formatClock(start)}–${formatClock(end)}`;
}

function currentLocalDateTime(): `${LocalDate}T${string}` {
  return combineLocalDateAndTime(todayInTimeZone(APP_TIME_ZONE), localTimeInTimeZone(APP_TIME_ZONE));
}

interface ManualShiftComposerProps {
  actions: InternatoShiftActions;
  defaultDate: LocalDate;
  saving: boolean;
  initiallyOpen?: boolean;
  onCreated: (shift: MentorEntity<"internato.shift">) => void | Promise<void>;
}

function ManualShiftComposer({
  actions,
  defaultDate,
  saving,
  initiallyOpen = false,
  onCreated,
}: ManualShiftComposerProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const [draft, setDraft] = useState<ManualShiftDraft>(() =>
    emptyManualShiftDraft(defaultDate),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = useMemo(() => planManualShiftCreation(draft), [draft]);
  const isBusy = busy || saving;

  const changeDraft = (patch: Partial<ManualShiftDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const handleCreate = async () => {
    if (!plan.input) {
      setError(plan.errors[0] ?? "Revise os dados da jornada.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await actions.createManualShift(plan.input);
      await onCreated(created);
      setDraft(emptyManualShiftDraft(created.localDate));
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar a jornada.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="isc-create">
      <button
        type="button"
        className="isc-create-toggle"
        onClick={() => {
          setOpen((current) => !current);
          setError(null);
        }}
        disabled={isBusy}
        aria-expanded={open}
        aria-controls="isc-create-panel"
      >
        <Plus size={17} weight="bold" aria-hidden="true" />
        {open ? "Fechar nova jornada" : "Adicionar jornada"}
      </button>

      {open ? (
        <form
          id="isc-create-panel"
          className="isc-create-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreate();
          }}
        >
          <div className="isc-create-heading">
            <div>
              <p className="isc-section-label">Além da escala atual</p>
              <h3>Nova jornada planejada</h3>
            </div>
            <CalendarBlank size={23} weight="thin" aria-hidden="true" />
          </div>
          <p className="isc-hint">
            Informe somente o que já sabe. Setor e local vazios continuarão desconhecidos,
            e nenhum horário realizado será presumido.
          </p>

          <div className="isc-create-grid">
            <label className="isc-create-date">
              <span>Data</span>
              <KeyboardInput
                type="date"
                value={draft.localDate}
                onChange={(event) => changeDraft({ localDate: event.target.value })}
                disabled={isBusy}
                required
              />
            </label>
            <label>
              <span>Início</span>
              <KeyboardInput
                type="time"
                value={draft.startTimeLocal}
                onChange={(event) => changeDraft({ startTimeLocal: event.target.value })}
                disabled={isBusy}
                required
              />
            </label>
            <label>
              <span>Fim</span>
              <KeyboardInput
                type="time"
                value={draft.endTimeLocal}
                onChange={(event) => changeDraft({ endTimeLocal: event.target.value })}
                disabled={isBusy}
                required
              />
            </label>
          </div>

          <fieldset className="isc-fieldset isc-create-options">
            <legend>Quando termina?</legend>
            <div className="isc-choice-grid isc-create-choice-grid">
              <button
                type="button"
                className="isc-choice"
                data-selected={!draft.endsNextDay}
                onClick={() => changeDraft({ endsNextDay: false })}
                disabled={isBusy}
                aria-pressed={!draft.endsNextDay}
              >
                <span>{!draft.endsNextDay ? <Check size={15} weight="bold" /> : null}No mesmo dia</span>
                <small>o fim usa a data informada</small>
              </button>
              <button
                type="button"
                className="isc-choice"
                data-selected={draft.endsNextDay}
                onClick={() => changeDraft({ endsNextDay: true })}
                disabled={isBusy}
                aria-pressed={draft.endsNextDay}
              >
                <span>{draft.endsNextDay ? <Check size={15} weight="bold" /> : null}No dia seguinte</span>
                <small>para plantões que cruzam meia-noite</small>
              </button>
            </div>
          </fieldset>

          <fieldset className="isc-fieldset isc-create-options">
            <legend>Estado da escala</legend>
            <div className="isc-choice-grid isc-create-choice-grid">
              <button
                type="button"
                className="isc-choice"
                data-selected={draft.scheduleState === "confirmed_planned"}
                onClick={() => changeDraft({ scheduleState: "confirmed_planned" })}
                disabled={isBusy}
                aria-pressed={draft.scheduleState === "confirmed_planned"}
              >
                <span>{draft.scheduleState === "confirmed_planned" ? <Check size={15} weight="bold" /> : null}Confirmada</span>
                <small>planejamento já confirmado</small>
              </button>
              <button
                type="button"
                className="isc-choice"
                data-selected={draft.scheduleState === "tentative"}
                onClick={() => changeDraft({ scheduleState: "tentative" })}
                disabled={isBusy}
                aria-pressed={draft.scheduleState === "tentative"}
              >
                <span>{draft.scheduleState === "tentative" ? <Check size={15} weight="bold" /> : null}Tentativa</span>
                <small>ainda não confirmada</small>
              </button>
            </div>
          </fieldset>

          <div className="isc-create-grid isc-create-details">
            <label>
              <span>Setor / área <small>opcional</small></span>
              <KeyboardInput
                type="text"
                value={draft.assignment}
                onChange={(event) => changeDraft({ assignment: event.target.value })}
                disabled={isBusy}
                placeholder="Ex.: enfermaria obstétrica"
                autoComplete="off"
              />
            </label>
            <label>
              <span>Local <small>opcional</small></span>
              <KeyboardInput
                type="text"
                value={draft.location}
                onChange={(event) => changeDraft({ location: event.target.value })}
                disabled={isBusy}
                placeholder="Ex.: Hospital X"
                autoComplete="off"
              />
            </label>
          </div>

          <div className="isc-create-footer">
            <div className="isc-feedback" aria-live="polite">
              {error ? (
                <p className="isc-error" role="alert"><WarningCircle size={17} />{error}</p>
              ) : (
                <p><Info size={16} />A jornada aparecerá no mesmo histórico e nas mesmas métricas da escala.</p>
              )}
            </div>
            <button type="submit" className="isc-save" disabled={isBusy}>
              {isBusy ? "Criando…" : "Criar jornada"}
              {!isBusy ? <ArrowRight size={18} /> : null}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function InternatoShiftControl({
  shifts,
  actions,
  referenceDate,
  preferredShiftId,
  saving = false,
  onSaved,
}: InternatoShiftControlProps) {
  const orderedShifts = useMemo(
    () => [...shifts].sort((left, right) =>
      left.payload.scheduledStartLocal.localeCompare(right.payload.scheduledStartLocal),
    ),
    [shifts],
  );
  const defaultShiftId = useMemo(
    () => selectDefaultShiftId(orderedShifts, referenceDate, preferredShiftId),
    [orderedShifts, preferredShiftId, referenceDate],
  );
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(defaultShiftId);
  const selectedShift = useMemo(
    () => orderedShifts.find((shift) => shift.id === selectedShiftId) ?? null,
    [orderedShifts, selectedShiftId],
  );
  const [draft, setDraft] = useState<ShiftActualDraft | null>(() =>
    selectedShift ? draftFromShift(selectedShift) : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedShiftId || !orderedShifts.some((shift) => shift.id === selectedShiftId)) {
      setSelectedShiftId(defaultShiftId);
    }
  }, [defaultShiftId, orderedShifts, selectedShiftId]);

  useEffect(() => {
    setDraft(selectedShift ? draftFromShift(selectedShift) : null);
    setError(null);
    setSavedMessage(null);
  }, [selectedShift?.id, selectedShift?.revision]);

  const plan = selectedShift && draft ? planShiftUpdate(selectedShift, draft) : null;
  const isBusy = busy || saving;
  const attendanceDisablesActuals = Boolean(
    draft && draft.attendance !== "unknown" && draft.attendance !== "present",
  );

  const updateDraft = (patch: Partial<ShiftActualDraft>) => {
    setDraft((current) => current ? { ...current, ...patch } : current);
    setSavedMessage(null);
    setError(null);
  };

  const updateClock = (
    field: "arrival" | "departure" | "breakStart" | "breakEnd",
    value: string,
  ) => {
    setDraft((current) => current
      ? { ...markAttendancePresent(current), [field]: value }
      : current);
    setSavedMessage(null);
    setError(null);
  };

  const updateBreakMode = (breakMode: ShiftBreakDraftMode) => {
    setDraft((current) => {
      if (!current) return current;
      const next = breakMode === "unknown" ? current : markAttendancePresent(current);
      return { ...next, breakMode };
    });
    setSavedMessage(null);
    setError(null);
  };

  const handleSave = async () => {
    if (!selectedShift || !draft || !plan) return;
    if (plan.errors.length) {
      setError(plan.errors[0]);
      return;
    }
    if (!plan.changedFields.length) {
      setSavedMessage("Nenhuma alteração: o que não foi informado continua desconhecido.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await actions.updateShift({ shiftId: selectedShift.id, ...plan.patch });
      setDraft(draftFromShift(updated));
      setSavedMessage("Jornada atualizada sem alterar o planejamento original.");
      await onSaved?.(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar a jornada.");
    } finally {
      setBusy(false);
    }
  };

  const recordBreakNow = async (kind: "start" | "end") => {
    if (!selectedShift) return;
    const now = currentLocalDateTime();
    const today = now.slice(0, 10) as LocalDate;
    if (!shiftSpansLocalDate(selectedShift, today)) {
      setError("O registro “agora” só pode ser usado durante a data desta jornada.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const action = kind === "start" ? actions.recordBreakStart : actions.recordBreakEnd;
      const updated = await action({ shiftId: selectedShift.id, localDateTime: now });
      setDraft(draftFromShift(updated));
      setSavedMessage(kind === "start" ? "Início do intervalo registrado." : "Fim do intervalo registrado.");
      await onSaved?.(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível registrar o intervalo.");
    } finally {
      setBusy(false);
    }
  };

  const handleCreated = async (created: MentorEntity<"internato.shift">) => {
    setSelectedShiftId(created.id);
    setError(null);
    setSavedMessage("Jornada criada; os dados realizados continuam desconhecidos.");
    await onSaved?.(created);
  };

  if (!orderedShifts.length) {
    return (
      <section className="isc-shell" aria-labelledby="isc-title">
        <header className="isc-header">
          <div>
            <p className="isc-section-label">Jornadas de internato</p>
            <h2 id="isc-title">Planejado e realizado, sem misturar</h2>
          </div>
          <ShieldCheck size={26} weight="thin" aria-hidden="true" />
        </header>
        <ManualShiftComposer
          actions={actions}
          defaultDate={referenceDate}
          saving={isBusy}
          initiallyOpen
          onCreated={handleCreated}
        />
        <div className="isc-empty" aria-live="polite">
          <CalendarBlank size={25} weight="thin" />
          <div>
            <strong>Nenhuma jornada registrada</strong>
            <p>Sem escala não há falta, atraso nem horas realizadas a calcular.</p>
          </div>
        </div>
      </section>
    );
  }

  if (!selectedShift || !draft) return null;
  const overnight = selectedShift.payload.scheduledStartLocal.slice(0, 10)
    !== selectedShift.payload.scheduledEndLocal.slice(0, 10);

  return (
    <section className="isc-shell" aria-labelledby="isc-title">
      <header className="isc-header">
        <div>
          <p className="isc-section-label">Jornada atual</p>
          <h2 id="isc-title">Planejado e realizado, sem misturar</h2>
        </div>
        <ShieldCheck size={26} weight="thin" aria-hidden="true" />
      </header>

      <ManualShiftComposer
        actions={actions}
        defaultDate={referenceDate}
        saving={isBusy}
        onCreated={handleCreated}
      />

      <label className="isc-shift-picker">
        <span>Selecionar jornada</span>
        <select
          value={selectedShift.id}
          onChange={(event) => setSelectedShiftId(event.target.value)}
          disabled={isBusy}
        >
          {orderedShifts.map((shift) => (
            <option key={shift.id} value={shift.id}>
              {formatDate(shift.payload.scheduledStartLocal)} · {formatClock(shift.payload.scheduledStartLocal)}–{formatClock(shift.payload.scheduledEndLocal)} · {shiftTitle(shift)}
            </option>
          ))}
        </select>
      </label>

      <div className="isc-planned" aria-label="Planejamento preservado">
        <div className="isc-planned-icon">
          {overnight ? <MoonStars size={25} weight="thin" /> : <CalendarBlank size={25} weight="thin" />}
        </div>
        <div>
          <small>Planejado · somente leitura</small>
          <strong>{shiftTitle(selectedShift)}</strong>
          <p>{shiftWindowLabel(selectedShift)}</p>
        </div>
      </div>

      <fieldset className="isc-fieldset">
        <legend>O que aconteceu com esta jornada?</legend>
        <p className="isc-hint">“Não confirmei” preserva desconhecido. Falta, troca, dispensa e cancelamento só existem quando você selecionar.</p>
        <div className="isc-choice-grid isc-attendance-grid">
          {ATTENDANCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="isc-choice"
              data-selected={draft.attendance === option.value}
              data-attendance={option.value}
              onClick={() => updateDraft({ attendance: option.value })}
              disabled={isBusy}
              aria-pressed={draft.attendance === option.value}
            >
              <span>{draft.attendance === option.value ? <Check size={15} weight="bold" /> : null}{option.label}</span>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>
      </fieldset>

      {attendanceDisablesActuals ? (
        <div className="isc-state-note" role="status">
          <Info size={18} />
          <p>Os horários realizados ficam “não aplicáveis”. A jornada planejada continua intacta no histórico.</p>
        </div>
      ) : (
        <>
          <fieldset className="isc-fieldset isc-time-ledger">
            <legend>Chegada e saída reais</legend>
            <p className="isc-hint">Ao digitar um horário, a presença é confirmada. No plantão noturno, a saída da manhã será salva no dia seguinte.</p>
            <div className="isc-time-grid">
              <label>
                <span>Chegada</span>
                <KeyboardInput type="time" value={draft.arrival} onChange={(event) => updateClock("arrival", event.target.value)} disabled={isBusy} />
              </label>
              <span className="isc-time-arrow"><ArrowRight size={18} /></span>
              <label>
                <span>Saída</span>
                <KeyboardInput type="time" value={draft.departure} onChange={(event) => updateClock("departure", event.target.value)} disabled={isBusy} />
              </label>
            </div>
          </fieldset>

          <fieldset className="isc-fieldset isc-break-ledger">
            <legend>Intervalo / almoço</legend>
            <div className="isc-choice-grid isc-break-grid">
              {BREAK_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="isc-choice"
                  data-selected={draft.breakMode === option.value}
                  onClick={() => updateBreakMode(option.value)}
                  disabled={isBusy}
                  aria-pressed={draft.breakMode === option.value}
                >
                  <span>{option.value === "timed" ? <Coffee size={15} /> : null}{option.label}</span>
                  <small>{option.detail}</small>
                </button>
              ))}
            </div>

            {draft.breakMode === "timed" ? (
              <div className="isc-break-times">
                <div className="isc-time-grid">
                  <label>
                    <span>Início</span>
                    <KeyboardInput type="time" value={draft.breakStart} onChange={(event) => updateClock("breakStart", event.target.value)} disabled={isBusy} />
                  </label>
                  <span className="isc-time-arrow"><ArrowRight size={18} /></span>
                  <label>
                    <span>Fim</span>
                    <KeyboardInput type="time" value={draft.breakEnd} onChange={(event) => updateClock("breakEnd", event.target.value)} disabled={isBusy} />
                  </label>
                </div>
                <div className="isc-now-actions">
                  <button type="button" onClick={() => void recordBreakNow("start")} disabled={isBusy}>
                    <Clock size={16} />Iniciar agora
                  </button>
                  <button type="button" onClick={() => void recordBreakNow("end")} disabled={isBusy}>
                    <Clock size={16} />Encerrar agora
                  </button>
                </div>
              </div>
            ) : null}
          </fieldset>
        </>
      )}

      <footer className="isc-footer">
        <div className="isc-feedback" aria-live="polite">
          {error ? <p className="isc-error" role="alert"><WarningCircle size={17} />{error}</p> : null}
          {!error && savedMessage ? <p className="isc-success"><Check size={17} />{savedMessage}</p> : null}
          {!error && !savedMessage ? <p><Info size={16} />Campos vazios não viram zero nem ausência.</p> : null}
        </div>
        <button
          type="button"
          className="isc-save"
          onClick={() => void handleSave()}
          disabled={isBusy || Boolean(plan?.errors.length)}
        >
          {isBusy ? "Salvando…" : "Salvar jornada"}
          {!isBusy ? <ArrowRight size={18} /> : null}
        </button>
      </footer>
    </section>
  );
}
