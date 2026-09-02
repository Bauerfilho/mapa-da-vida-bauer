import {
  ArrowLeft,
  ArrowRight,
  BatteryHigh,
  CalendarBlank,
  Check,
  CheckCircle,
  Clock,
  Coffee,
  Compass,
  FirstAid,
  GraduationCap,
  Info,
  ListChecks,
  Moon,
  Plus,
  Repeat,
  ShieldCheck,
  Sparkle,
  SunHorizon,
  Timer,
  TrendUp,
  Warning,
  type Icon,
} from "@phosphor-icons/react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { KeyboardInput, KeyboardTextarea } from "../mobile";
import {
  explicitClockSpanMinutes,
  inclusiveDateWindow,
  invalidKnowledge,
  known,
  summarizeRoutineEvidence,
  todayInTimeZone,
  unknown as unknownKnowledge,
  type GenericPayload,
  type Knowledge,
  type LocalDate,
  type MentorEntity,
  type RoutineBlockEvidenceInput,
} from "../domain";
import { useMentorData } from "../hooks";
import "./routine-workspace.css";

type CapacityBand = "base" | "steady" | "strong";
type PriorityTier = "base" | "good" | "gold";
type BlockStatus = "planned" | "in_progress" | "done" | "deferred" | "cancelled";

interface AnchorDraft {
  kind: string;
  label: string;
  planned: string;
  actual: string;
  icon: Icon;
}

interface PriorityDraft {
  tier: PriorityTier;
  title: string;
  status: BlockStatus | "";
}

interface BlockDraft {
  id: string;
  title: string;
  plannedStart: string;
  plannedEnd: string;
  plannedCrossesMidnight: boolean;
  actualStart: string;
  actualEnd: string;
  actualCrossesMidnight: boolean;
  status: BlockStatus | "";
  replanned: boolean | null;
  replannedStart: string;
  replannedEnd: string;
  replanReason: string;
}

interface RoutineWorkspacePayload extends GenericPayload {
  schema: "routine-day-plan-v1";
  eventKind: "routine-day-plan";
  entryMode: RoutineWorkspaceMode;
  anchors: Array<{
    kind: string;
    timeLocal: Knowledge<string>;
    plannedTimeLocal: Knowledge<string>;
    actualTimeLocal: Knowledge<string>;
  }>;
  tasks: Array<{
    title: Knowledge<string>;
    status: Knowledge<string>;
    priority: Knowledge<string>;
  }>;
  closure: {
    state: Knowledge<string>;
    dayScore: Knowledge<number>;
    carriedForward: Knowledge<string>;
    reflection: Knowledge<string>;
  };
  capacity: {
    energy: Knowledge<number>;
    band: Knowledge<CapacityBand>;
    note: Knowledge<string>;
  };
  blocks: Array<{
    id: string;
    title: Knowledge<string>;
    plannedStartLocal: Knowledge<string>;
    plannedEndLocal: Knowledge<string>;
    plannedDurationMinutes: Knowledge<number>;
    actualStartLocal: Knowledge<string>;
    actualEndLocal: Knowledge<string>;
    actualDurationMinutes: Knowledge<number>;
    status: Knowledge<BlockStatus>;
    completed: Knowledge<boolean>;
    replanned: Knowledge<boolean>;
    replan: {
      startLocal: Knowledge<string>;
      endLocal: Knowledge<string>;
      reason: Knowledge<string>;
    };
  }>;
  recovery: {
    activity: Knowledge<string>;
    plannedMinutes: Knowledge<number>;
    actualMinutes: Knowledge<number>;
  };
}

export interface RoutineWorkspaceProps {
  currentLocalDate?: LocalDate;
  initialMode?: RoutineWorkspaceMode;
  onBack?: () => void;
  onDataChange?: () => void;
}

export type RoutineWorkspaceMode = "planning" | "closure";

const CAPACITY_BANDS: readonly { id: CapacityBand; label: string; note: string }[] = [
  { id: "base", label: "Base", note: "proteger o essencial" },
  { id: "steady", label: "Estável", note: "ritmo sustentável" },
  { id: "strong", label: "Ampla", note: "há margem extra" },
];

const PRIORITY_META: readonly { id: PriorityTier; label: string; note: string; icon: Icon }[] = [
  { id: "base", label: "Prioridade 1", note: "mantém o dia de pé", icon: ShieldCheck },
  { id: "good", label: "Prioridade 2", note: "faz o dia avançar", icon: TrendUp },
  { id: "gold", label: "Prioridade 3", note: "somente se houver margem", icon: Sparkle },
];

function knowledgeValue<T>(value: unknown): T | null {
  if (value && typeof value === "object" && "state" in value && (value as { state?: unknown }).state === "known" && "value" in value) {
    return (value as { value: T }).value;
  }
  return null;
}

function textKnowledge(value: string): Knowledge<string> {
  const normalized = value.trim();
  return normalized ? known(normalized) : unknownKnowledge("not_recorded");
}

function integerKnowledge(value: string, label: string, maximum = 1_440): Knowledge<number> {
  if (!value.trim()) return unknownKnowledge("not_recorded");
  if (!/^\d+$/.test(value.trim())) return invalidKnowledge(`${label}_not_integer`);
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum
    ? known(parsed)
    : invalidKnowledge(`${label}_out_of_range`);
}

function timeKnowledge(value: string): Knowledge<string> {
  if (!value) return unknownKnowledge("not_recorded");
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? known(value)
    : invalidKnowledge("invalid_local_time");
}

function spanKnowledge(start: string, end: string, crossesMidnight: boolean): Knowledge<number> {
  try {
    const value = explicitClockSpanMinutes(start, end, crossesMidnight);
    return value === null ? unknownKnowledge("not_recorded") : known(value, "derived");
  } catch {
    return invalidKnowledge("invalid_clock_span");
  }
}

function statusCompleted(status: BlockStatus | ""): Knowledge<boolean> {
  if (!status) return unknownKnowledge("not_confirmed");
  if (status === "cancelled") return unknownKnowledge("not_confirmed");
  return known(status === "done", "derived");
}

function formatMinutes(value: number | null): string {
  if (value === null) return "Sem amostra";
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours}h ${minutes}min` : `${hours}h`;
}

function formatDate(value: LocalDate): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function RoutineField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="rw-field"><span>{label}{hint ? <small>{hint}</small> : null}</span>{children}</label>;
}

function ChoiceButtons<T extends string>({ label, value, onChange, options }: { label: string; value: T | ""; onChange: (value: T) => void; options: readonly { value: T; label: string }[] }) {
  return <fieldset className="rw-choices"><legend>{label}</legend><div>{options.map((option) => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{value === option.value ? <Check size={13} /> : null}{option.label}</button>)}</div></fieldset>;
}

function payloadOf(entity: MentorEntity): GenericPayload | null {
  return entity.type === "generic.event"
    ? (entity as MentorEntity<"generic.event">).payload
    : null;
}

function routineEvidenceFromEntity(entity: MentorEntity): RoutineBlockEvidenceInput[] {
  const payload = payloadOf(entity);
  if (!payload || payload.eventKind !== "routine-day-plan" || !Array.isArray(payload.blocks)) return [];
  return payload.blocks.flatMap((raw): RoutineBlockEvidenceInput[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const block = raw as Record<string, unknown>;
    return [{
      plannedMinutes: knowledgeValue<number>(block.plannedDurationMinutes),
      actualMinutes: knowledgeValue<number>(block.actualDurationMinutes),
      completed: knowledgeValue<boolean>(block.completed),
      replanned: knowledgeValue<boolean>(block.replanned),
    }];
  });
}

function newBlock(index: number): BlockDraft {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `block-${Date.now()}-${index}`,
    title: index === 0 ? "Internato / compromisso principal" : index === 1 ? "Estudo" : "Recuperação / margem",
    plannedStart: "",
    plannedEnd: "",
    plannedCrossesMidnight: false,
    actualStart: "",
    actualEnd: "",
    actualCrossesMidnight: false,
    status: "",
    replanned: null,
    replannedStart: "",
    replannedEnd: "",
    replanReason: "",
  };
}

function blockHasRecordedDetail(block: BlockDraft): boolean {
  return Boolean(
    block.plannedStart || block.plannedEnd || block.actualStart || block.actualEnd ||
    block.status || block.replanned !== null || block.replannedStart || block.replannedEnd ||
    block.replanReason.trim(),
  );
}

export function RoutineWorkspace({ currentLocalDate, initialMode = "planning", onBack, onDataChange }: RoutineWorkspaceProps) {
  const referenceDate = currentLocalDate ?? todayInTimeZone();
  const mentor = useMentorData(referenceDate);
  const [mode, setMode] = useState<RoutineWorkspaceMode>(initialMode);
  const [date, setDate] = useState<LocalDate>(referenceDate);
  const [energy, setEnergy] = useState<number | null>(null);
  const [capacity, setCapacity] = useState<CapacityBand | "">("");
  const [capacityNote, setCapacityNote] = useState("");
  const [anchors, setAnchors] = useState<AnchorDraft[]>([
    { kind: "wake", label: "Acordar", planned: "", actual: "", icon: SunHorizon },
    { kind: "main-start", label: "Começo principal", planned: "", actual: "", icon: Clock },
    { kind: "study", label: "Estudo", planned: "", actual: "", icon: GraduationCap },
    { kind: "wind-down", label: "Desacelerar", planned: "", actual: "", icon: Moon },
  ]);
  const [priorities, setPriorities] = useState<PriorityDraft[]>([
    { tier: "base", title: "", status: "" },
    { tier: "good", title: "", status: "" },
    { tier: "gold", title: "", status: "" },
  ]);
  const [blocks, setBlocks] = useState<BlockDraft[]>([newBlock(0), newBlock(1), newBlock(2)]);
  const [recoveryActivity, setRecoveryActivity] = useState("");
  const [recoveryPlanned, setRecoveryPlanned] = useState("");
  const [recoveryActual, setRecoveryActual] = useState("");
  const [closureState, setClosureState] = useState("");
  const [carriedForward, setCarriedForward] = useState("");
  const [reflection, setReflection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const entities = mentor.workspace?.entities ?? [];
  const window = inclusiveDateWindow(referenceDate, 60);
  const routineEntities = entities.filter((entity) => entity.domain === "rotina" && entity.status === "active" && entity.localDate >= window.start && entity.localDate <= window.end);
  const evidence = useMemo(() => summarizeRoutineEvidence(routineEntities.flatMap(routineEvidenceFromEntity)), [routineEntities]);
  const history = [...routineEntities].filter((entity) => payloadOf(entity)?.eventKind === "routine-day-plan").sort((left, right) => right.occurredAtUTC.localeCompare(left.occurredAtUTC));

  const updateAnchor = (index: number, patch: Partial<AnchorDraft>) => setAnchors((current) => current.map((anchor, itemIndex) => itemIndex === index ? { ...anchor, ...patch } : anchor));
  const updatePriority = (index: number, patch: Partial<PriorityDraft>) => setPriorities((current) => current.map((priority, itemIndex) => itemIndex === index ? { ...priority, ...patch } : priority));
  const updateBlock = (id: string, patch: Partial<BlockDraft>) => setBlocks((current) => current.map((block) => block.id === id ? { ...block, ...patch } : block));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const populatedPriorities = mode === "planning" ? priorities.filter((priority) => priority.title.trim()) : [];
    const populatedBlocks = mode === "planning" ? blocks.filter((block) => block.title.trim() && blockHasRecordedDetail(block)) : [];
    const hasPlanningInput = populatedPriorities.length > 0 || populatedBlocks.length > 0;
    const hasClosureInput = Boolean(closureState || carriedForward.trim() || reflection.trim());
    if (!hasPlanningInput && !hasClosureInput) {
      setError(mode === "closure"
        ? "Escolha o estado do fechamento ou registre uma reflexão para salvar."
        : "Defina uma prioridade, um bloco com detalhes ou registre o fechamento do dia.");
      return;
    }
    const normalizedBlocks = populatedBlocks.map((block) => {
      const plannedDuration = spanKnowledge(block.plannedStart, block.plannedEnd, block.plannedCrossesMidnight);
      const actualDuration = spanKnowledge(block.actualStart, block.actualEnd, block.actualCrossesMidnight);
      return {
        id: block.id,
        title: textKnowledge(block.title),
        plannedStartLocal: timeKnowledge(block.plannedStart),
        plannedEndLocal: timeKnowledge(block.plannedEnd),
        plannedDurationMinutes: plannedDuration,
        actualStartLocal: timeKnowledge(block.actualStart),
        actualEndLocal: timeKnowledge(block.actualEnd),
        actualDurationMinutes: actualDuration,
        status: block.status ? known(block.status) : unknownKnowledge<BlockStatus>("not_confirmed"),
        completed: statusCompleted(block.status),
        replanned: block.replanned === null ? unknownKnowledge<boolean>("not_confirmed") : known(block.replanned),
        replan: {
          startLocal: block.replanned === true ? timeKnowledge(block.replannedStart) : unknownKnowledge<string>("not_recorded"),
          endLocal: block.replanned === true ? timeKnowledge(block.replannedEnd) : unknownKnowledge<string>("not_recorded"),
          reason: block.replanned === true ? textKnowledge(block.replanReason) : unknownKnowledge<string>("not_recorded"),
        },
      };
    });
    const invalidBlock = normalizedBlocks.find((block) => [block.plannedStartLocal, block.plannedEndLocal, block.plannedDurationMinutes, block.actualStartLocal, block.actualEndLocal, block.actualDurationMinutes, block.replan.startLocal, block.replan.endLocal].some((value) => value.state === "invalid"));
    if (invalidBlock) {
      setError("Revise os horários: pares incompletos ou blocos que cruzam a meia-noite precisam de confirmação explícita.");
      return;
    }
    const plannedRecovery = mode === "planning" ? integerKnowledge(recoveryPlanned, "recovery_planned") : unknownKnowledge<number>("not_recorded");
    const actualRecovery = mode === "planning" ? integerKnowledge(recoveryActual, "recovery_actual") : unknownKnowledge<number>("not_recorded");
    if (plannedRecovery.state === "invalid" || actualRecovery.state === "invalid") {
      setError("A recuperação precisa ser informada em minutos inteiros válidos.");
      return;
    }
    const payload: RoutineWorkspacePayload = {
      schema: "routine-day-plan-v1",
      eventKind: "routine-day-plan",
      entryMode: hasPlanningInput ? "planning" : "closure",
      anchors: mode === "planning" ? anchors.filter((anchor) => anchor.planned || anchor.actual).map((anchor) => ({
        kind: anchor.kind,
        timeLocal: timeKnowledge(anchor.planned),
        plannedTimeLocal: timeKnowledge(anchor.planned),
        actualTimeLocal: timeKnowledge(anchor.actual),
      })) : [],
      tasks: populatedPriorities.map((priority) => ({
        title: textKnowledge(priority.title),
        status: priority.status ? known(priority.status) : unknownKnowledge("not_confirmed"),
        priority: known(priority.tier),
      })),
      closure: {
        state: closureState ? known(closureState) : unknownKnowledge("not_confirmed"),
        dayScore: unknownKnowledge("not_recorded"),
        carriedForward: textKnowledge(carriedForward),
        reflection: textKnowledge(reflection),
      },
      capacity: {
        energy: mode === "planning" && energy !== null ? known(energy) : unknownKnowledge("not_recorded"),
        band: mode === "planning" && capacity ? known(capacity) : unknownKnowledge("not_confirmed"),
        note: mode === "planning" ? textKnowledge(capacityNote) : unknownKnowledge("not_recorded"),
      },
      blocks: normalizedBlocks,
      recovery: {
        activity: mode === "planning" ? textKnowledge(recoveryActivity) : unknownKnowledge("not_recorded"),
        plannedMinutes: plannedRecovery,
        actualMinutes: actualRecovery,
      },
    };
    try {
      await mentor.actions.recordGenericEvent({
        domain: "rotina",
        payload,
        summary: hasPlanningInput
          ? "Routine plan, actual blocks, recovery and explicit replanning recorded by the user."
          : "Daily closure and reflection explicitly recorded by the user.",
        localDate: date,
      });
      onDataChange?.();
      setSuccess(hasPlanningInput
        ? "Trilho do dia salvo; plano e realizado permanecem separados."
        : "Fechamento salvo; o restante do dia continua como não registrado.");
      setBlocks((current) => current.map((block) => ({ ...block, actualStart: "", actualEnd: "", actualCrossesMidnight: false, status: "", replanned: null, replannedStart: "", replannedEnd: "", replanReason: "" })));
      setRecoveryActual("");
      setClosureState("");
      setCarriedForward("");
      setReflection("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar esta rotina.");
    }
  };

  return <main className="routine-workspace" data-testid="routine-workspace" data-mode={mode}>
    {onBack ? <button type="button" className="rw-back" onClick={onBack}><ArrowLeft size={18} />Voltar</button> : null}
    <header className="rw-header"><span>{mode === "closure" ? <CheckCircle size={27} weight="thin" /> : <Compass size={29} weight="thin" />}</span><div><p>{mode === "closure" ? "Encerramento consciente" : "Organizador adaptativo"}</p><h1>{mode === "closure" ? "Fechar meu dia" : "Rotina"}</h1><small>{mode === "closure" ? "Uma reflexão curta e uma próxima ação; sem repetir seus registros de saúde." : "Âncoras e blocos flexíveis: o plano original sobrevive ao dia real."}</small></div></header>

    <nav className="rw-mode-switch" aria-label="Modo da rotina">
      <button type="button" aria-pressed={mode === "closure"} onClick={() => { setMode("closure"); setError(null); setSuccess(null); }}><CheckCircle size={18} /><span><strong>Fechamento rápido</strong><small>reflexão e amanhã</small></span></button>
      <button type="button" aria-pressed={mode === "planning"} onClick={() => { setMode("planning"); setError(null); setSuccess(null); }}><CalendarBlank size={18} /><span><strong>Planejamento completo</strong><small>prioridades e blocos</small></span></button>
    </nav>

    {mode === "planning" ? <section className="rw-evidence"><header><div><p>Janela de 60 dias</p><h2>Calibração da rotina</h2></div><TrendUp size={26} weight="thin" /></header><dl><div><dt>Planejado</dt><dd>{formatMinutes(evidence.plannedMinutes)}</dd><small>blocos com pares válidos</small></div><div><dt>Real</dt><dd>{formatMinutes(evidence.actualMinutes)}</dd><small>nunca preenchido pelo plano</small></div><div><dt>Conclusão</dt><dd>{evidence.completionPercent === null ? "Sem amostra" : `${Math.round(evidence.completionPercent)}%`}</dd><small>n={evidence.completionCount}</small></div><div><dt>Replanejados</dt><dd>{evidence.replannedBlocks ?? "Sem amostra"}</dd><small>somente confirmação explícita</small></div></dl><p><Info size={14} />Flexibilidade é um dado de calibração; replanejar não apaga o compromisso original.</p></section> : null}

    <form className={`rw-form${mode === "closure" ? " rw-form--closure" : ""}`} onSubmit={(event) => void submit(event)}>
      {mode === "planning" ? <>
      <section className="rw-capacity"><header><BatteryHigh size={23} weight="duotone" /><div><h2>Capacidade de hoje</h2><p>Energia e ambição são escolhidas separadamente.</p></div></header><RoutineField label="Data"><KeyboardInput type="date" value={date} onChange={(event) => setDate(event.target.value as LocalDate)} /></RoutineField><span className="rw-label">Energia percebida</span><div className="rw-energy" role="group" aria-label="Energia percebida">{[1,2,3,4,5].map((value) => <button type="button" key={value} aria-pressed={energy === value} onClick={() => setEnergy(value)}>{value}</button>)}</div><div className="rw-capacity-bands" role="group" aria-label="Faixa de capacidade">{CAPACITY_BANDS.map((band) => <button type="button" key={band.id} aria-pressed={capacity === band.id} onClick={() => setCapacity(band.id)}><strong>{band.label}</strong><small>{band.note}</small></button>)}</div><RoutineField label="Contexto da capacidade"><KeyboardTextarea value={capacityNote} onChange={(event) => setCapacityNote(event.target.value)} placeholder="Sono, plantão, dor, deslocamento ou margem real" /></RoutineField></section>

      <section className="rw-anchor-rail"><header><Clock size={22} weight="duotone" /><div><h2>Âncoras do dia</h2><p>Pontos de retorno; horário planejado não prova realização.</p></div></header><ol>{anchors.map((anchor,index) => { const AnchorIcon=anchor.icon; return <li key={anchor.kind}><span><AnchorIcon size={17} /></span><strong>{anchor.label}</strong><RoutineField label="Planejado"><KeyboardInput type="time" value={anchor.planned} onChange={(event) => updateAnchor(index,{planned:event.target.value})} /></RoutineField><RoutineField label="Real"><KeyboardInput type="time" value={anchor.actual} onChange={(event) => updateAnchor(index,{actual:event.target.value})} /></RoutineField></li>; })}</ol></section>

      <section className="rw-priorities"><header><ListChecks size={22} /><div><h2>Três prioridades protegidas</h2><p>Ordem de atenção, não uma lista infinita.</p></div></header>{priorities.map((priority,index) => { const meta=PRIORITY_META[index]; const PriorityIcon=meta.icon; return <article key={priority.tier} data-tier={priority.tier}><div><span>{index+1}</span><PriorityIcon size={18} /><p><strong>{meta.label}</strong><small>{meta.note}</small></p></div><RoutineField label="Ação concreta"><KeyboardInput value={priority.title} onChange={(event) => updatePriority(index,{title:event.target.value})} placeholder="Um verbo + um resultado" /></RoutineField><ChoiceButtons<BlockStatus> label="Estado" value={priority.status} onChange={(value) => updatePriority(index,{status:value})} options={[{value:"planned",label:"Planejada"},{value:"in_progress",label:"Em curso"},{value:"done",label:"Feita"},{value:"deferred",label:"Adiada"}]} /></article>; })}</section>

      <section className="rw-blocks"><header><CalendarBlank size={22} weight="duotone" /><div><h2>Blocos flexíveis</h2><p>Planejado, realizado e replanejado ocupam trilhos distintos.</p></div></header>{blocks.map((block,index) => <article key={block.id} data-index={index+1}><div className="rw-block-title"><span>{index+1}</span><RoutineField label="Nome do bloco"><KeyboardInput value={block.title} onChange={(event) => updateBlock(block.id,{title:event.target.value})} /></RoutineField></div><div className="rw-time-tracks"><fieldset><legend>Plano original</legend><div><RoutineField label="Início"><KeyboardInput type="time" value={block.plannedStart} onChange={(event) => updateBlock(block.id,{plannedStart:event.target.value})} /></RoutineField><ArrowRight size={16} /><RoutineField label="Fim"><KeyboardInput type="time" value={block.plannedEnd} onChange={(event) => updateBlock(block.id,{plannedEnd:event.target.value})} /></RoutineField></div><label className="rw-midnight"><input type="checkbox" checked={block.plannedCrossesMidnight} onChange={(event) => updateBlock(block.id,{plannedCrossesMidnight:event.target.checked})} />Cruza meia-noite</label></fieldset><fieldset><legend>Realizado</legend><div><RoutineField label="Início"><KeyboardInput type="time" value={block.actualStart} onChange={(event) => updateBlock(block.id,{actualStart:event.target.value})} /></RoutineField><ArrowRight size={16} /><RoutineField label="Fim"><KeyboardInput type="time" value={block.actualEnd} onChange={(event) => updateBlock(block.id,{actualEnd:event.target.value})} /></RoutineField></div><label className="rw-midnight"><input type="checkbox" checked={block.actualCrossesMidnight} onChange={(event) => updateBlock(block.id,{actualCrossesMidnight:event.target.checked})} />Cruza meia-noite</label></fieldset></div><ChoiceButtons<BlockStatus> label="Estado real" value={block.status} onChange={(value) => updateBlock(block.id,{status:value})} options={[{value:"planned",label:"Não iniciei"},{value:"in_progress",label:"Em curso"},{value:"done",label:"Concluído"},{value:"deferred",label:"Adiado"},{value:"cancelled",label:"Cancelado"}]} /><fieldset className="rw-replan-choice"><legend>Este bloco foi replanejado?</legend><div><button type="button" aria-pressed={block.replanned===true} onClick={() => updateBlock(block.id,{replanned:true})}>Sim</button><button type="button" aria-pressed={block.replanned===false} onClick={() => updateBlock(block.id,{replanned:false})}>Não</button><button type="button" aria-pressed={block.replanned===null} onClick={() => updateBlock(block.id,{replanned:null})}>Não registrei</button></div></fieldset>{block.replanned===true ? <div className="rw-replan"><header><Repeat size={17} /><strong>Novo encaixe — o plano acima continua intacto</strong></header><div><RoutineField label="Novo início"><KeyboardInput type="time" value={block.replannedStart} onChange={(event) => updateBlock(block.id,{replannedStart:event.target.value})} /></RoutineField><RoutineField label="Novo fim"><KeyboardInput type="time" value={block.replannedEnd} onChange={(event) => updateBlock(block.id,{replannedEnd:event.target.value})} /></RoutineField></div><RoutineField label="Motivo"><KeyboardInput value={block.replanReason} onChange={(event) => updateBlock(block.id,{replanReason:event.target.value})} placeholder="O que mudou a capacidade ou a ordem" /></RoutineField></div> : null}</article>)}<button type="button" className="rw-add-block" onClick={() => setBlocks((current) => [...current,newBlock(current.length)])}><Plus size={17} />Adicionar outro bloco</button></section>

      <section className="rw-recovery"><header><Coffee size={22} weight="duotone" /><div><h2>Recuperação protegida</h2><p>Descanso também pode ser planejado e observado.</p></div></header><RoutineField label="Forma de recuperação"><KeyboardInput value={recoveryActivity} onChange={(event) => setRecoveryActivity(event.target.value)} placeholder="Sono, pausa, refeição, caminhada, silêncio…" /></RoutineField><div className="rw-two-column"><RoutineField label="Minutos planejados"><KeyboardInput inputMode="numeric" value={recoveryPlanned} onChange={(event) => setRecoveryPlanned(event.target.value)} placeholder="—" /></RoutineField><RoutineField label="Minutos realizados"><KeyboardInput inputMode="numeric" value={recoveryActual} onChange={(event) => setRecoveryActual(event.target.value)} placeholder="—" /></RoutineField></div></section>
      </> : null}

      <section className="rw-closure">
        <header><CheckCircle size={22} /><div><h2>Fechamento do dia</h2><p>Parcial continua válido; pendência não vira fracasso.</p></div></header>
        {mode === "closure" ? <><RoutineField label="Data do fechamento"><KeyboardInput type="date" value={date} onChange={(event) => setDate(event.target.value as LocalDate)} /></RoutineField><p className="rw-closure-scope"><Info size={15} />Sono, humor, dor e medicação continuam nos módulos próprios. Aqui entram somente o fecho e a próxima ação.</p></> : null}
        <ChoiceButtons label="Estado do fechamento" value={closureState} onChange={setClosureState} options={[{value:"partial",label:"Parcial"},{value:"closed",label:"Encerrado"}]} />
        <RoutineField label="Fecho em uma frase"><KeyboardTextarea value={reflection} onChange={(event) => setReflection(event.target.value)} placeholder="O que sustentou, desviou ou merece ajuste?" /></RoutineField>
        <RoutineField label="Levar para amanhã" hint="no máximo uma próxima ação"><KeyboardInput value={carriedForward} onChange={(event) => setCarriedForward(event.target.value)} placeholder="Uma pendência explícita" /></RoutineField>
      </section>

      {error||success ? <p className="rw-feedback" data-state={error?"error":"success"} role={error?"alert":"status"}>{error?<Warning size={17}/>:<CheckCircle size={17}/>} {error??success}</p>:null}<button type="submit" className="rw-save" disabled={mentor.saving}>{mode === "closure" ? <CheckCircle size={19} weight="bold" /> : <Compass size={19} weight="bold" />}{mentor.saving?"Salvando…":mode === "closure"?"Salvar fechamento":"Salvar trilho do dia"}<ArrowRight size={17}/></button><p className="rw-truth"><ShieldCheck size={14}/>{mode === "closure" ? "Fechar o dia não exige preencher o que você não registrou." : "O Mentor registra ajuste; não reescreve o plano original nem chama lacuna de falha."}</p>
    </form>

    {mode === "planning" ? <section className="rw-history"><header><Timer size={22} weight="thin"/><div><h2>Últimos trilhos</h2><p>Planos e fatos da janela de 60 dias.</p></div></header>{mentor.loading?<p className="rw-loading">Lendo o histórico deste iPhone…</p>:history.length?<div>{history.slice(0,8).map((entity)=>{const payload=payloadOf(entity)!;const blockItems=Array.isArray(payload.blocks)?payload.blocks:[];const summary=summarizeRoutineEvidence(routineEvidenceFromEntity(entity));return <article key={entity.id}><time>{formatDate(entity.localDate)}</time><span/><p><strong>{blockItems.length} bloco{blockItems.length===1?"":"s"} registrado{blockItems.length===1?"":"s"}</strong><small>{formatMinutes(summary.plannedMinutes)} planejados · {formatMinutes(summary.actualMinutes)} reais</small><em>{summary.completionPercent===null?"conclusão desconhecida":`${Math.round(summary.completionPercent)}% concluído`}</em></p></article>})}</div>:<div className="rw-empty"><ListChecks size={24}/><p><strong>O primeiro trilho ainda será registrado.</strong><span>Você pode salvar prioridades, blocos com detalhes ou somente o fechamento do dia.</span></p></div>}</section> : null}
    {mentor.error?<p className="rw-global-error" role="alert"><Warning size={16}/>{mentor.error.message}</p>:null}
  </main>;
}

export default RoutineWorkspace;
