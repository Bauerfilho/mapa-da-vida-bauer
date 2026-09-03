import {
  useId,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { CalendarBlank } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { CalendarPlus } from "@phosphor-icons/react/dist/csr/CalendarPlus";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCountdown } from "@phosphor-icons/react/dist/csr/ClockCountdown";
import { Flag } from "@phosphor-icons/react/dist/csr/Flag";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { ListChecks } from "@phosphor-icons/react/dist/csr/ListChecks";
import { Target } from "@phosphor-icons/react/dist/csr/Target";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import type {
  AgendaEventStatus,
  AgendaGoalTier,
  AgendaItemStatus,
  AgendaPriority,
  AgendaTaskStatus,
  AgendaWindowDays,
  Knowledge,
  LocalDate,
  LocalDateTime,
  LocalTime,
  MentorEntity,
} from "../domain";
import {
  type AgendaFinanceSnapshot,
  useAgendaFinanceData,
} from "../hooks/useAgendaFinanceData";
import { KeyboardInput, KeyboardTextarea, useKeyboard } from "../mobile";
import "./agenda-planner.css";

type PlannerMode = "task" | "event" | "goals";
type BufferMode = "unknown" | "none" | "known";

interface BufferDraft {
  mode: BufferMode;
  minutes: string;
}

interface TaskDraft {
  title: string;
  status: AgendaTaskStatus;
  priority: AgendaPriority;
  goalTier: "" | AgendaGoalTier;
  dueLocalDate: string;
  dueLocalTime: string;
  plannedStartLocal: string;
  plannedEndLocal: string;
  note: string;
}

interface EventDraft {
  title: string;
  status: AgendaEventStatus;
  priority: AgendaPriority;
  plannedStartLocal: string;
  plannedEndLocal: string;
  bufferBefore: BufferDraft;
  bufferAfter: BufferDraft;
  note: string;
}

interface GoalDraft {
  appliesToLocalDate: string;
  minimum: string;
  good: string;
  gold: string;
  note: string;
}

export interface AgendaPlannerProps {
  /** First civil date shown by the canonical 7/30-day agenda window. */
  startLocalDate: LocalDate;
  /** Controlled window. Omit to let the planner manage its own switch. */
  windowDays?: AgendaWindowDays;
  defaultWindowDays?: AgendaWindowDays;
  onWindowDaysChange?: (days: AgendaWindowDays) => void;
  /** Called only after a canonical mutation has been persisted and re-read. */
  onDataChange?: (snapshot: AgendaFinanceSnapshot) => void;
  className?: string;
}

const TASK_STATUS_OPTIONS: ReadonlyArray<{
  value: AgendaTaskStatus;
  label: string;
}> = [
  { value: "captured", label: "Capturada" },
  { value: "planned", label: "Planejada" },
  { value: "in_progress", label: "Em andamento" },
  { value: "completed", label: "Concluída" },
  { value: "deferred", label: "Adiada" },
  { value: "cancelled", label: "Cancelada" },
];

const EVENT_STATUS_OPTIONS: ReadonlyArray<{
  value: AgendaEventStatus;
  label: string;
}> = [
  { value: "tentative", label: "Tentativo" },
  { value: "confirmed", label: "Confirmado" },
  { value: "in_progress", label: "Em andamento" },
  { value: "completed", label: "Concluído" },
  { value: "cancelled", label: "Cancelado" },
];

const PRIORITY_OPTIONS: ReadonlyArray<{
  value: AgendaPriority;
  label: string;
}> = [
  { value: "low", label: "Baixa" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];

const GOAL_TIER_LABELS: Record<AgendaGoalTier, string> = {
  minimum: "Mínimo básico",
  good: "Alvo bom",
  gold: "Padrão-ouro",
};

const initialTaskDraft: TaskDraft = {
  title: "",
  status: "captured",
  priority: "normal",
  goalTier: "",
  dueLocalDate: "",
  dueLocalTime: "",
  plannedStartLocal: "",
  plannedEndLocal: "",
  note: "",
};

const initialEventDraft: EventDraft = {
  title: "",
  status: "tentative",
  priority: "normal",
  plannedStartLocal: "",
  plannedEndLocal: "",
  bufferBefore: { mode: "unknown", minutes: "" },
  bufferAfter: { mode: "unknown", minutes: "" },
  note: "",
};

function createInitialGoalDraft(startLocalDate: LocalDate): GoalDraft {
  return {
    appliesToLocalDate: startLocalDate,
    minimum: "",
    good: "",
    gold: "",
    note: "",
  };
}

function knownValue<T>(knowledge: Knowledge<T>): T | undefined {
  return knowledge.state === "known" ? knowledge.value : undefined;
}

function asLocalDate(value: string): LocalDate | undefined {
  return value ? (value as LocalDate) : undefined;
}

function asLocalTime(value: string): LocalTime | undefined {
  return value ? (value as LocalTime) : undefined;
}

function asLocalDateTime(value: string): LocalDateTime | undefined {
  return value ? (value as LocalDateTime) : undefined;
}

function optionalNote(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function bufferValue(draft: BufferDraft): number | null | undefined {
  if (draft.mode === "unknown") return undefined;
  if (draft.mode === "none") return null;
  const value = Number(draft.minutes);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Informe o buffer em minutos inteiros, ou deixe-o como desconhecido.");
  }
  return value;
}

function dateAtNoonUTC(localDate: string): Date {
  return new Date(`${localDate}T12:00:00.000Z`);
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

function formatLocalDate(localDate: string): string {
  return dateFormatter.format(dateAtNoonUTC(localDate)).replace(/\./g, "");
}

function formatLocalDateTime(localDateTime: string): string {
  const [date, time = ""] = localDateTime.split("T");
  return `${formatLocalDate(date)} · ${time.slice(0, 5) || "horário não informado"}`;
}

function taskStatusLabel(status: AgendaTaskStatus): string {
  return TASK_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function eventStatusLabel(status: AgendaEventStatus): string {
  return EVENT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function agendaItemSchedule(
  entity: MentorEntity<"agenda.task"> | MentorEntity<"agenda.event">,
): { primary: string; secondary: string } {
  const plannedStart = knownValue(entity.payload.plannedStartLocal);
  const plannedEnd = knownValue(entity.payload.plannedEndLocal);
  if (plannedStart && plannedEnd) {
    return {
      primary: formatLocalDateTime(plannedStart),
      secondary: `até ${plannedEnd.slice(11, 16)}`,
    };
  }

  const dueDate = knownValue(entity.payload.dueLocalDate);
  const dueTime = knownValue(entity.payload.dueLocalTime);
  if (dueDate) {
    return {
      primary: formatLocalDate(dueDate),
      secondary: dueTime ? `prazo às ${dueTime.slice(0, 5)}` : "horário do prazo não informado",
    };
  }

  return {
    primary: "Sem data confirmada",
    secondary: "permanece na caixa de entrada",
  };
}

function itemStatusLabel(
  entity: MentorEntity<"agenda.task"> | MentorEntity<"agenda.event">,
): string {
  return entity.type === "agenda.task"
    ? taskStatusLabel(entity.payload.status)
    : eventStatusLabel(entity.payload.status);
}

function isFinishedStatus(status: AgendaItemStatus): boolean {
  return status === "completed" || status === "cancelled";
}

function statusOptionsFor(
  entity: MentorEntity<"agenda.task"> | MentorEntity<"agenda.event">,
) {
  return entity.type === "agenda.task"
    ? TASK_STATUS_OPTIONS
    : EVENT_STATUS_OPTIONS;
}

function itemActualTruth(
  entity: MentorEntity<"agenda.task"> | MentorEntity<"agenda.event">,
): string {
  const actualStart = knownValue(entity.payload.actualStartLocal);
  const actualEnd = knownValue(entity.payload.actualEndLocal);
  if (actualStart && actualEnd) {
    return `Realizado ${formatLocalDateTime(actualStart)}–${actualEnd.slice(11, 16)}`;
  }
  if (actualStart) return `Início realizado: ${formatLocalDateTime(actualStart)}`;
  return "Horários realizados ainda não registrados";
}

function titleById(snapshot: AgendaFinanceSnapshot, entityId: string): string {
  const item = snapshot.agenda.items.find((candidate) => candidate.id === entityId);
  if (item) return item.payload.title;
  const shift = snapshot.agenda.blockingShifts.find((candidate) => candidate.id === entityId);
  if (!shift) return "Item não localizado";
  return knownValue(shift.payload.assignment) ?? "Turno de internato";
}

function PlannerTabs({
  mode,
  onChange,
  panelId,
}: {
  mode: PlannerMode;
  onChange: (mode: PlannerMode) => void;
  panelId: string;
}) {
  const tabs: ReadonlyArray<{
    id: PlannerMode;
    label: string;
    icon: typeof ListChecks;
  }> = [
    { id: "task", label: "Tarefa", icon: ListChecks },
    { id: "event", label: "Evento", icon: CalendarPlus },
    { id: "goals", label: "Metas", icon: Target },
  ];

  return (
    <div className="agenda-planner__tabs" role="tablist" aria-label="Tipo de planejamento">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={mode === tab.id}
            aria-controls={panelId}
            onClick={() => onChange(tab.id)}
          >
            <Icon size={18} weight="thin" aria-hidden="true" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function BufferField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: BufferDraft;
  onChange: (next: BufferDraft) => void;
}) {
  return (
    <fieldset className="agenda-planner__buffer">
      <legend>{label}</legend>
      <select
        id={`${id}-mode`}
        aria-label={`${label}: estado`}
        value={value.mode}
        onChange={(event) => onChange({ ...value, mode: event.target.value as BufferMode })}
      >
        <option value="unknown">Não informado</option>
        <option value="none">Sem buffer</option>
        <option value="known">Informar minutos</option>
      </select>
      {value.mode === "known" ? (
        <KeyboardInput
          id={`${id}-minutes`}
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          aria-label={`${label}: minutos`}
          value={value.minutes}
          onChange={(event) => onChange({ ...value, minutes: event.target.value })}
          placeholder="min"
          required
        />
      ) : null}
    </fieldset>
  );
}

function TaskForm({
  draft,
  saving,
  onChange,
  onSubmit,
}: {
  draft: TaskDraft;
  saving: boolean;
  onChange: (next: TaskDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="agenda-planner__form" onSubmit={onSubmit}>
      <label className="agenda-planner__field agenda-planner__field--wide">
        <span>O que precisa acontecer?</span>
        <KeyboardInput
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          placeholder="Ex.: revisar CTG por 20 minutos"
          maxLength={180}
          required
        />
      </label>
      <label className="agenda-planner__field">
        <span>Estado inicial</span>
        <select
          value={draft.status}
          onChange={(event) => onChange({ ...draft, status: event.target.value as AgendaTaskStatus })}
        >
          {TASK_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="agenda-planner__field">
        <span>Prioridade</span>
        <select
          value={draft.priority}
          onChange={(event) => onChange({ ...draft, priority: event.target.value as AgendaPriority })}
        >
          {PRIORITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="agenda-planner__field">
        <span>Nível da meta</span>
        <select
          value={draft.goalTier}
          onChange={(event) => onChange({ ...draft, goalTier: event.target.value as "" | AgendaGoalTier })}
        >
          <option value="">Não definido</option>
          <option value="minimum">Mínimo básico</option>
          <option value="good">Alvo bom</option>
          <option value="gold">Padrão-ouro</option>
        </select>
      </label>
      <label className="agenda-planner__field">
        <span>Data do prazo</span>
        <KeyboardInput
          type="date"
          value={draft.dueLocalDate}
          onChange={(event) => onChange({
            ...draft,
            dueLocalDate: event.target.value,
            dueLocalTime: event.target.value ? draft.dueLocalTime : "",
          })}
        />
      </label>
      <label className="agenda-planner__field">
        <span>Horário do prazo</span>
        <KeyboardInput
          type="time"
          value={draft.dueLocalTime}
          disabled={!draft.dueLocalDate}
          onChange={(event) => onChange({ ...draft, dueLocalTime: event.target.value })}
        />
      </label>
      <details className="agenda-planner__details agenda-planner__field--wide">
        <summary>Reservar um bloco no dia</summary>
        <div className="agenda-planner__details-grid">
          <label className="agenda-planner__field">
            <span>Início planejado</span>
            <KeyboardInput
              type="datetime-local"
              step="60"
              value={draft.plannedStartLocal}
              onChange={(event) => onChange({ ...draft, plannedStartLocal: event.target.value })}
            />
          </label>
          <label className="agenda-planner__field">
            <span>Fim planejado</span>
            <KeyboardInput
              type="datetime-local"
              step="60"
              value={draft.plannedEndLocal}
              onChange={(event) => onChange({ ...draft, plannedEndLocal: event.target.value })}
            />
          </label>
        </div>
      </details>
      <label className="agenda-planner__field agenda-planner__field--wide">
        <span>Observação opcional</span>
        <KeyboardTextarea
          value={draft.note}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
          placeholder="Contexto que ajuda a executar, sem dados de pacientes"
          maxLength={800}
        />
      </label>
      <button className="agenda-planner__primary agenda-planner__field--wide" type="submit" disabled={saving}>
        <CheckCircle size={19} weight="thin" aria-hidden="true" />
        {saving ? "Salvando…" : "Guardar tarefa"}
      </button>
    </form>
  );
}

function EventForm({
  draft,
  saving,
  onChange,
  onSubmit,
}: {
  draft: EventDraft;
  saving: boolean;
  onChange: (next: EventDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="agenda-planner__form" onSubmit={onSubmit}>
      <label className="agenda-planner__field agenda-planner__field--wide">
        <span>Qual é o compromisso?</span>
        <KeyboardInput
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          placeholder="Ex.: enfermaria obstétrica"
          maxLength={180}
          required
        />
      </label>
      <label className="agenda-planner__field">
        <span>Início planejado</span>
        <KeyboardInput
          type="datetime-local"
          step="60"
          value={draft.plannedStartLocal}
          onChange={(event) => onChange({ ...draft, plannedStartLocal: event.target.value })}
          required
        />
      </label>
      <label className="agenda-planner__field">
        <span>Fim planejado</span>
        <KeyboardInput
          type="datetime-local"
          step="60"
          value={draft.plannedEndLocal}
          onChange={(event) => onChange({ ...draft, plannedEndLocal: event.target.value })}
          required
        />
      </label>
      <label className="agenda-planner__field">
        <span>Estado inicial</span>
        <select
          value={draft.status}
          onChange={(event) => onChange({ ...draft, status: event.target.value as AgendaEventStatus })}
        >
          {EVENT_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="agenda-planner__field">
        <span>Prioridade</span>
        <select
          value={draft.priority}
          onChange={(event) => onChange({ ...draft, priority: event.target.value as AgendaPriority })}
        >
          {PRIORITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <BufferField
        id="agenda-buffer-before"
        label="Folga antes"
        value={draft.bufferBefore}
        onChange={(bufferBefore) => onChange({ ...draft, bufferBefore })}
      />
      <BufferField
        id="agenda-buffer-after"
        label="Folga depois"
        value={draft.bufferAfter}
        onChange={(bufferAfter) => onChange({ ...draft, bufferAfter })}
      />
      <label className="agenda-planner__field agenda-planner__field--wide">
        <span>Observação opcional</span>
        <KeyboardTextarea
          value={draft.note}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
          placeholder="Preparação, deslocamento ou contexto útil"
          maxLength={800}
        />
      </label>
      <button className="agenda-planner__primary agenda-planner__field--wide" type="submit" disabled={saving}>
        <CalendarPlus size={19} weight="thin" aria-hidden="true" />
        {saving ? "Salvando…" : "Guardar evento"}
      </button>
    </form>
  );
}

function GoalForm({
  draft,
  saving,
  onChange,
  onSubmit,
}: {
  draft: GoalDraft;
  saving: boolean;
  onChange: (next: GoalDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="agenda-planner__form" onSubmit={onSubmit}>
      <label className="agenda-planner__field agenda-planner__field--wide">
        <span>Dia do plano gentil</span>
        <KeyboardInput
          type="date"
          value={draft.appliesToLocalDate}
          onChange={(event) => onChange({ ...draft, appliesToLocalDate: event.target.value })}
          required
        />
      </label>
      <label className="agenda-planner__field agenda-planner__field--wide" data-tier="minimum">
        <span>Mínimo básico</span>
        <KeyboardInput
          value={draft.minimum}
          onChange={(event) => onChange({ ...draft, minimum: event.target.value })}
          placeholder="O menor resultado que ainda protege o dia"
          maxLength={220}
          required
        />
      </label>
      <label className="agenda-planner__field agenda-planner__field--wide" data-tier="good">
        <span>Alvo bom</span>
        <KeyboardInput
          value={draft.good}
          onChange={(event) => onChange({ ...draft, good: event.target.value })}
          placeholder="O resultado realista se houver energia"
          maxLength={220}
          required
        />
      </label>
      <label className="agenda-planner__field agenda-planner__field--wide" data-tier="gold">
        <span>Padrão-ouro</span>
        <KeyboardInput
          value={draft.gold}
          onChange={(event) => onChange({ ...draft, gold: event.target.value })}
          placeholder="O extra — nunca uma cobrança automática"
          maxLength={220}
          required
        />
      </label>
      <label className="agenda-planner__field agenda-planner__field--wide">
        <span>Observação opcional</span>
        <KeyboardTextarea
          value={draft.note}
          onChange={(event) => onChange({ ...draft, note: event.target.value })}
          placeholder="Condição, limite ou apoio que torna este plano possível"
          maxLength={800}
        />
      </label>
      <button className="agenda-planner__primary agenda-planner__field--wide" type="submit" disabled={saving}>
        <Target size={19} weight="thin" aria-hidden="true" />
        {saving ? "Salvando…" : "Guardar plano gentil"}
      </button>
    </form>
  );
}

export function AgendaPlanner({
  startLocalDate,
  windowDays,
  defaultWindowDays = 7,
  onWindowDaysChange,
  onDataChange,
  className,
}: AgendaPlannerProps) {
  const keyboard = useKeyboard();
  const [internalWindowDays, setInternalWindowDays] = useState<AgendaWindowDays>(defaultWindowDays);
  const activeWindowDays = windowDays ?? internalWindowDays;
  const { snapshot, loading, saving, error, actions, refresh } = useAgendaFinanceData(
    startLocalDate,
    activeWindowDays,
  );
  const [mode, setMode] = useState<PlannerMode>("task");
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(initialTaskDraft);
  const [eventDraft, setEventDraft] = useState<EventDraft>(initialEventDraft);
  const [goalDraft, setGoalDraft] = useState<GoalDraft>(() => createInitialGoalDraft(startLocalDate));
  const [localError, setLocalError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const panelId = useId();

  const unscheduledCount = useMemo(() => snapshot?.agenda.items.filter((item) => (
    knownValue(item.payload.plannedStartLocal) === undefined
    && knownValue(item.payload.dueLocalDate) === undefined
  )).length ?? 0, [snapshot]);

  const goalsForStartDate = useMemo(() => snapshot?.agenda.goalSets.find(
    (goalSet) => goalSet.payload.appliesToLocalDate === startLocalDate,
  ) ?? null, [snapshot, startLocalDate]);

  const setWindow = (days: AgendaWindowDays) => {
    if (windowDays === undefined) setInternalWindowDays(days);
    onWindowDaysChange?.(days);
  };

  const notifyChanged = async () => {
    if (!onDataChange) return;
    const next = await refresh();
    onDataChange(next);
  };

  const runCreate = async (operation: () => Promise<void>, success: string) => {
    setLocalError(null);
    setFeedback(null);
    try {
      await operation();
      keyboard.hide();
      setFeedback(success);
      await notifyChanged();
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const submitTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const plannedStart = asLocalDateTime(taskDraft.plannedStartLocal);
    const plannedEnd = asLocalDateTime(taskDraft.plannedEndLocal);
    if ((plannedStart === undefined) !== (plannedEnd === undefined)) {
      setLocalError("Para reservar um bloco, informe início e fim planejados.");
      return;
    }
    void runCreate(async () => {
      await actions.createAgendaTask({
        title: taskDraft.title,
        status: taskDraft.status,
        priority: taskDraft.priority,
        ...(taskDraft.goalTier ? { goalTier: taskDraft.goalTier } : {}),
        ...(asLocalDate(taskDraft.dueLocalDate) ? { dueLocalDate: asLocalDate(taskDraft.dueLocalDate) } : {}),
        ...(asLocalTime(taskDraft.dueLocalTime) ? { dueLocalTime: asLocalTime(taskDraft.dueLocalTime) } : {}),
        ...(plannedStart ? { plannedStartLocal: plannedStart } : {}),
        ...(plannedEnd ? { plannedEndLocal: plannedEnd } : {}),
        ...(optionalNote(taskDraft.note) ? { note: optionalNote(taskDraft.note) } : {}),
      });
      setTaskDraft(initialTaskDraft);
    }, "Tarefa guardada na agenda.");
  };

  const submitEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const plannedStartLocal = asLocalDateTime(eventDraft.plannedStartLocal);
    const plannedEndLocal = asLocalDateTime(eventDraft.plannedEndLocal);
    if (!plannedStartLocal || !plannedEndLocal) {
      setLocalError("Informe início e fim planejados do evento.");
      return;
    }
    void runCreate(async () => {
      const bufferBeforeMinutes = bufferValue(eventDraft.bufferBefore);
      const bufferAfterMinutes = bufferValue(eventDraft.bufferAfter);
      await actions.createAgendaEvent({
        title: eventDraft.title,
        status: eventDraft.status,
        priority: eventDraft.priority,
        plannedStartLocal,
        plannedEndLocal,
        ...(bufferBeforeMinutes !== undefined ? { bufferBeforeMinutes } : {}),
        ...(bufferAfterMinutes !== undefined ? { bufferAfterMinutes } : {}),
        ...(optionalNote(eventDraft.note) ? { note: optionalNote(eventDraft.note) } : {}),
      });
      setEventDraft(initialEventDraft);
    }, "Evento guardado e conflitos recalculados.");
  };

  const submitGoals = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const appliesToLocalDate = asLocalDate(goalDraft.appliesToLocalDate);
    if (!appliesToLocalDate) {
      setLocalError("Informe o dia do plano gentil.");
      return;
    }
    void runCreate(async () => {
      await actions.createAgendaGoalSet({
        appliesToLocalDate,
        minimum: goalDraft.minimum,
        good: goalDraft.good,
        gold: goalDraft.gold,
        ...(optionalNote(goalDraft.note) ? { note: optionalNote(goalDraft.note) } : {}),
      });
      setGoalDraft(createInitialGoalDraft(appliesToLocalDate));
    }, "Plano gentil guardado para este dia.");
  };

  const updateStatus = async (
    entity: MentorEntity<"agenda.task"> | MentorEntity<"agenda.event">,
    nextStatus: string,
  ) => {
    setUpdatingId(entity.id);
    setLocalError(null);
    setFeedback(null);
    try {
      if (entity.type === "agenda.task") {
        await actions.updateAgendaItem({
          type: "agenda.task",
          entityId: entity.id,
          expectedRevision: entity.revision,
          patch: { status: nextStatus as AgendaTaskStatus },
        });
      } else {
        await actions.updateAgendaItem({
          type: "agenda.event",
          entityId: entity.id,
          expectedRevision: entity.revision,
          patch: { status: nextStatus as AgendaEventStatus },
        });
      }
      setFeedback(`Estado de “${entity.payload.title}” atualizado.`);
      await notifyChanged();
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUpdatingId(null);
    }
  };

  const renderedError = localError ?? error?.message ?? null;

  return (
    <section
      className={["agenda-planner", className].filter(Boolean).join(" ")}
      aria-labelledby={`${panelId}-title`}
      aria-busy={loading || saving}
    >
      <header className="agenda-planner__header">
        <span className="agenda-planner__header-icon" aria-hidden="true">
          <ClockCountdown size={23} weight="thin" />
        </span>
        <div>
          <h2 id={`${panelId}-title`}>Planejador fiel</h2>
          <p>Planejado, realizado e desconhecido continuam verdades separadas.</p>
        </div>
        <div className="agenda-planner__window" role="group" aria-label="Janela da agenda">
          {([7, 30] as const).map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={activeWindowDays === days}
              onClick={() => setWindow(days)}
            >
              {days}d
            </button>
          ))}
        </div>
      </header>

      {loading && !snapshot ? (
        <div className="agenda-planner__loading" role="status">
          <span />
          <p><strong>Abrindo sua agenda…</strong><small>Nenhum valor é estimado durante a leitura.</small></p>
        </div>
      ) : snapshot ? (
        <>
          <dl className="agenda-planner__facts" aria-label="Resumo factual da janela">
            <div>
              <dt>Janela</dt>
              <dd>{formatLocalDate(snapshot.agenda.window.start)}–{formatLocalDate(snapshot.agenda.window.end)}</dd>
            </div>
            <div>
              <dt>Itens</dt>
              <dd>{snapshot.agenda.items.length}</dd>
            </div>
            <div data-attention={snapshot.agenda.conflicts.length > 0 || undefined}>
              <dt>Conflitos</dt>
              <dd>{snapshot.agenda.conflicts.length} {snapshot.agenda.conflicts.length === 1 ? "calculável" : "calculáveis"}</dd>
            </div>
          </dl>

          <section className="agenda-planner__conflicts" aria-labelledby={`${panelId}-conflicts`}>
            <div className="agenda-planner__section-title">
              <WarningCircle size={21} weight="thin" aria-hidden="true" />
              <div>
                <h3 id={`${panelId}-conflicts`}>Choques e folgas</h3>
                <p>Calculados apenas com intervalos planejados conhecidos.</p>
              </div>
            </div>
            {snapshot.agenda.conflicts.length > 0 ? (
              <ul>
                {snapshot.agenda.conflicts.map((conflict, index) => (
                  <li key={`${conflict.firstId}-${conflict.secondId}-${conflict.kind}-${index}`}>
                    <span>{conflict.kind === "planned_overlap" ? "Sobreposição" : "Folga curta"}</span>
                    <strong>{titleById(snapshot, conflict.firstId)} × {titleById(snapshot, conflict.secondId)}</strong>
                    <small>
                      {conflict.kind === "planned_overlap"
                        ? `${conflict.overlapMinutes} min sobrepostos`
                        : conflict.shortfallMinutes === null
                          ? "faltam minutos ainda não calculáveis"
                          : `faltam ${conflict.shortfallMinutes} min de folga`}
                      {conflict.requiredBufferMinutes === null ? " · buffer desconhecido" : ""}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="agenda-planner__calm" role="status">
                <CheckCircle size={22} weight="thin" aria-hidden="true" />
                <p>
                  <strong>Nenhum conflito calculável nesta janela.</strong>
                  <small>{unscheduledCount > 0
                    ? `${unscheduledCount} item${unscheduledCount === 1 ? " permanece" : " permanecem"} sem intervalo planejado e não entra${unscheduledCount === 1 ? "" : "m"} no cálculo.`
                    : "Todos os intervalos conhecidos cabem sem choque detectado."}</small>
                </p>
              </div>
            )}
          </section>

          <section className="agenda-planner__goals" aria-labelledby={`${panelId}-goals`}>
            <div className="agenda-planner__section-title">
              <Target size={21} weight="thin" aria-hidden="true" />
              <div>
                <h3 id={`${panelId}-goals`}>Plano gentil · {formatLocalDate(startLocalDate)}</h3>
                <p>Três alcances escolhidos por você; nunca um placar.</p>
              </div>
            </div>
            {goalsForStartDate ? (
              <dl>
                <div data-tier="minimum"><dt>Mínimo</dt><dd>{goalsForStartDate.payload.minimum}</dd></div>
                <div data-tier="good"><dt>Bom</dt><dd>{goalsForStartDate.payload.good}</dd></div>
                <div data-tier="gold"><dt>Ouro</dt><dd>{goalsForStartDate.payload.gold}</dd></div>
              </dl>
            ) : (
              <div className="agenda-planner__unknown">
                <Info size={20} weight="thin" aria-hidden="true" />
                <p><strong>Metas ainda não definidas.</strong><small>Isso continua desconhecido — não equivale a zero ou falha.</small></p>
              </div>
            )}
          </section>

          <section className="agenda-planner__timeline" aria-labelledby={`${panelId}-timeline`}>
            <div className="agenda-planner__section-title">
              <CalendarBlank size={21} weight="thin" aria-hidden="true" />
              <div>
                <h3 id={`${panelId}-timeline`}>Itens da janela</h3>
                <p>Trocar o estado não inventa horário realizado.</p>
              </div>
            </div>
            {snapshot.agenda.items.length > 0 ? (
              <ol>
                {snapshot.agenda.items.map((item) => {
                  const schedule = agendaItemSchedule(item);
                  const goalTier = item.type === "agenda.task" ? knownValue(item.payload.goalTier) : undefined;
                  return (
                    <li key={item.id} data-finished={isFinishedStatus(item.payload.status) || undefined}>
                      <span className="agenda-planner__timeline-mark" aria-hidden="true" />
                      <div className="agenda-planner__item-copy">
                        <small>{schedule.primary} · {schedule.secondary}</small>
                        <strong>{item.payload.title}</strong>
                        <p>
                          {itemStatusLabel(item)} · {item.payload.priority === "normal" ? "prioridade normal" : `prioridade ${PRIORITY_OPTIONS.find((option) => option.value === item.payload.priority)?.label.toLocaleLowerCase("pt-BR")}`}
                          {goalTier ? ` · ${GOAL_TIER_LABELS[goalTier]}` : ""}
                        </p>
                        <em>{itemActualTruth(item)}</em>
                      </div>
                      <label className="agenda-planner__status">
                        <span className="agenda-planner__sr-only">Estado de {item.payload.title}</span>
                        <select
                          value={item.payload.status}
                          disabled={saving || updatingId === item.id}
                          onChange={(event) => void updateStatus(item, event.target.value)}
                        >
                          {statusOptionsFor(item).map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="agenda-planner__unknown">
                <ListChecks size={20} weight="thin" aria-hidden="true" />
                <p><strong>Nenhum item cadastrado na janela.</strong><small>A ausência de registro não significa folga.</small></p>
              </div>
            )}
          </section>
        </>
      ) : null}

      <section className="agenda-planner__compose" aria-labelledby={`${panelId}-compose`}>
        <div className="agenda-planner__section-title">
          <Flag size={21} weight="thin" aria-hidden="true" />
          <div>
            <h3 id={`${panelId}-compose`}>Planejar sem sobrecarga</h3>
            <p>Cada registro pergunta somente o que pertence ao contexto.</p>
          </div>
        </div>
        <PlannerTabs mode={mode} onChange={setMode} panelId={`${panelId}-form`} />
        <div id={`${panelId}-form`} role="tabpanel" className="agenda-planner__form-panel">
          {mode === "task" ? (
            <TaskForm draft={taskDraft} saving={saving} onChange={setTaskDraft} onSubmit={submitTask} />
          ) : mode === "event" ? (
            <EventForm draft={eventDraft} saving={saving} onChange={setEventDraft} onSubmit={submitEvent} />
          ) : (
            <GoalForm draft={goalDraft} saving={saving} onChange={setGoalDraft} onSubmit={submitGoals} />
          )}
        </div>
      </section>

      <div className="agenda-planner__messages" aria-live="polite" aria-atomic="true">
        {renderedError ? <p className="agenda-planner__error" role="alert">{renderedError}</p> : null}
        {!renderedError && feedback ? <p className="agenda-planner__success" role="status">{feedback}</p> : null}
      </div>
    </section>
  );
}

export default AgendaPlanner;
