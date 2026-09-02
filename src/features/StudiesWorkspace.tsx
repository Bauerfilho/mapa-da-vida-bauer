import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Brain,
  CalendarBlank,
  CaretRight,
  ChartLineUp,
  Check,
  CheckCircle,
  Clock,
  FirstAid,
  GraduationCap,
  Info,
  Link,
  ListChecks,
  NotePencil,
  Plus,
  Question,
  Repeat,
  ShieldCheck,
  Sparkle,
  Target,
  Timer,
  TrendUp,
  Warning,
  type Icon,
} from "@phosphor-icons/react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { KeyboardInput, KeyboardTextarea } from "../mobile";
import {
  inclusiveDateWindow,
  invalidKnowledge,
  known,
  notApplicable,
  summarizeStudyEvidence,
  todayInTimeZone,
  unknown as unknownKnowledge,
  type GenericPayload,
  type Knowledge,
  type LocalDate,
  type MentorEntity,
  type StudyEvidenceInput,
} from "../domain";
import { useMentorData } from "../hooks";
import "./studies-workspace.css";

type StudyTier = "base" | "good" | "gold";

interface TierDraft {
  minutes: string;
  outcome: string;
}

interface StudyTierPlan {
  minutes: Knowledge<number>;
  outcome: Knowledge<string>;
}

interface StudiesWorkspacePayload extends GenericPayload {
  schema: "study-session-v1";
  eventKind: "study-session";
  subject: Knowledge<string>;
  source: Knowledge<string>;
  startedAtLocal: Knowledge<string>;
  endedAtLocal: Knowledge<string>;
  minutes: Knowledge<number>;
  actualDurationMinutes: Knowledge<number>;
  plannedDurationMinutes: Knowledge<number>;
  completed: Knowledge<boolean>;
  questions: {
    attempted: Knowledge<number>;
    correct: Knowledge<number>;
  };
  confidenceBefore: Knowledge<number>;
  confidenceAfter: Knowledge<number>;
  review: {
    state: Knowledge<string>;
    nextDate: Knowledge<string>;
  };
  note: Knowledge<string>;
  plan: {
    selectedTier: Knowledge<StudyTier>;
    tiers: Record<StudyTier, StudyTierPlan>;
  };
  method: Knowledge<string>;
  sourceReference: Knowledge<string>;
  activeRecall: {
    prompt: Knowledge<string>;
    response: Knowledge<string>;
    confidence: Knowledge<number>;
  };
  internatoLink: {
    entityId: Knowledge<string>;
    localDate: Knowledge<string>;
    context: Knowledge<string>;
  };
}

export interface StudiesWorkspaceProps {
  currentLocalDate?: LocalDate;
  studyGoalDefaults?: {
    baseMinutes: number | null;
    goodMinutes: number | null;
    goldMinutes: number | null;
  };
  onBack?: () => void;
  onDataChange?: () => void;
}

const TIER_META: readonly {
  id: StudyTier;
  label: string;
  note: string;
  icon: Icon;
}[] = [
  { id: "base", label: "Base", note: "o menor bloco que mantém contato", icon: ShieldCheck },
  { id: "good", label: "Boa", note: "avanço consistente para o dia real", icon: TrendUp },
  { id: "gold", label: "Ouro", note: "expansão se houver capacidade", icon: Sparkle },
];

const METHODS = [
  "Active recall",
  "Questões",
  "Explicar em voz alta",
  "Caso clínico",
  "Leitura guiada",
  "Vídeo/aula",
] as const;

function knowledgeValue<T>(value: unknown): T | null {
  if (
    value &&
    typeof value === "object" &&
    "state" in value &&
    (value as { state?: unknown }).state === "known" &&
    "value" in value
  ) {
    return (value as { value: T }).value;
  }
  return null;
}

function textKnowledge(value: string): Knowledge<string> {
  const normalized = value.trim();
  return normalized ? known(normalized) : unknownKnowledge("not_recorded");
}

function nonNegativeIntegerKnowledge(
  value: string,
  label: string,
  maximum = 1_440,
): Knowledge<number> {
  if (!value.trim()) return unknownKnowledge("not_recorded");
  if (!/^\d+$/.test(value.trim())) return invalidKnowledge(`${label}_not_integer`);
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum
    ? known(parsed)
    : invalidKnowledge(`${label}_out_of_range`);
}

function scaleKnowledge(value: number | null): Knowledge<number> {
  return value === null ? unknownKnowledge("not_recorded") : known(value);
}

function formatMinutes(value: number | null): string {
  if (value === null) return "Sem amostra";
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours}h ${minutes}min` : `${hours}h`;
}

function formatDate(value: LocalDate): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function StudyField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="sw-field"><span>{label}{hint ? <small>{hint}</small> : null}</span>{children}</label>;
}

function StudyScale({ value, onChange, label }: { value: number | null; onChange: (value: number) => void; label: string }) {
  return <div className="sw-scale" role="group" aria-label={label}>{[1, 2, 3, 4, 5].map((item) => <button type="button" key={item} aria-pressed={value === item} onClick={() => onChange(item)}>{item}</button>)}</div>;
}

function payloadOf(entity: MentorEntity): GenericPayload | null {
  return entity.type === "generic.event"
    ? (entity as MentorEntity<"generic.event">).payload
    : null;
}

function studyEvidenceFromEntity(entity: MentorEntity, referenceDate: LocalDate): StudyEvidenceInput | null {
  const payload = payloadOf(entity);
  if (!payload || payload.eventKind !== "study-session") return null;
  const questions = payload.questions && typeof payload.questions === "object"
    ? payload.questions as Record<string, unknown>
    : {};
  const review = payload.review && typeof payload.review === "object"
    ? payload.review as Record<string, unknown>
    : {};
  const reviewState = knowledgeValue<string>(review.state);
  const reviewDate = knowledgeValue<string>(review.nextDate);
  const reviewDue = reviewState === "already_reviewed" || reviewState === "not_needed_confirmed"
    ? false
    : reviewDate
      ? reviewDate <= referenceDate
      : null;
  return {
    plannedMinutes: knowledgeValue<number>(payload.plannedDurationMinutes),
    actualMinutes: knowledgeValue<number>(payload.actualDurationMinutes ?? payload.minutes),
    attemptedQuestions: knowledgeValue<number>(questions.attempted),
    correctQuestions: knowledgeValue<number>(questions.correct),
    reviewDue,
  };
}

interface InternatoOption {
  id: string;
  localDate: LocalDate;
  label: string;
  detail: string;
}

function internatoOptions(entities: readonly MentorEntity[]): InternatoOption[] {
  return entities
    .filter((entity) => entity.domain === "internato" && entity.status === "active")
    .flatMap((entity): InternatoOption[] => {
      if (entity.type === "internato.shift") {
        const shift = entity as MentorEntity<"internato.shift">;
        const assignment = knowledgeValue<string>(shift.payload.assignment);
        const location = knowledgeValue<string>(shift.payload.location);
        return [{
          id: entity.id,
          localDate: entity.localDate,
          label: assignment ?? "Turno de internato",
          detail: location ?? "local não informado",
        }];
      }
      if (entity.type === "generic.event") {
        const payload = (entity as MentorEntity<"generic.event">).payload;
        if (payload.eventKind !== "internship-debrief") return [];
        const topics = knowledgeValue<string[]>(payload.topics ?? payload.topicsSeen);
        const nextPractice = knowledgeValue<string>(payload.nextPractice);
        return [{
          id: entity.id,
          localDate: entity.localDate,
          label: topics?.slice(0, 2).join(" · ") || "Debrief do internato",
          detail: nextPractice ?? "sem próximo gesto informado",
        }];
      }
      return [];
    })
    .sort((left, right) => right.localDate.localeCompare(left.localDate))
    .slice(0, 10);
}

function minuteDraft(value: number | null | undefined): string {
  return Number.isInteger(value) && Number(value) > 0 ? String(value) : "";
}

export function StudiesWorkspace({ currentLocalDate, studyGoalDefaults, onBack, onDataChange }: StudiesWorkspaceProps) {
  const referenceDate = currentLocalDate ?? todayInTimeZone();
  const mentor = useMentorData(referenceDate);
  const [date, setDate] = useState<LocalDate>(referenceDate);
  const [subject, setSubject] = useState("");
  const [selectedTier, setSelectedTier] = useState<StudyTier>("base");
  const [tiers, setTiers] = useState<Record<StudyTier, TierDraft>>({
    base: { minutes: minuteDraft(studyGoalDefaults?.baseMinutes), outcome: "" },
    good: { minutes: minuteDraft(studyGoalDefaults?.goodMinutes), outcome: "" },
    gold: { minutes: minuteDraft(studyGoalDefaults?.goldMinutes), outcome: "" },
  });
  const [method, setMethod] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [actualMinutes, setActualMinutes] = useState("");
  const [completed, setCompleted] = useState<boolean | null>(null);
  const [attempted, setAttempted] = useState("");
  const [correct, setCorrect] = useState("");
  const [recallPrompt, setRecallPrompt] = useState("");
  const [recallResponse, setRecallResponse] = useState("");
  const [recallConfidence, setRecallConfidence] = useState<number | null>(null);
  const [reviewState, setReviewState] = useState("scheduled");
  const [reviewDate, setReviewDate] = useState("");
  const [internatoId, setInternatoId] = useState("");
  const [internatoContext, setInternatoContext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const entities = mentor.workspace?.entities ?? [];
  const window = inclusiveDateWindow(referenceDate, 60);
  const studyEntities = entities.filter((entity) =>
    entity.domain === "estudos" &&
    entity.status === "active" &&
    entity.localDate >= window.start &&
    entity.localDate <= window.end,
  );
  const evidence = useMemo(
    () => summarizeStudyEvidence(studyEntities.flatMap((entity) => {
      const item = studyEvidenceFromEntity(entity, referenceDate);
      return item ? [item] : [];
    })),
    [referenceDate, studyEntities],
  );
  const internshipOptions = useMemo(() => internatoOptions(entities), [entities]);
  const selectedInternato = internshipOptions.find((option) => option.id === internatoId) ?? null;
  const history = [...studyEntities]
    .filter((entity) => payloadOf(entity)?.eventKind === "study-session")
    .sort((left, right) => right.occurredAtUTC.localeCompare(left.occurredAtUTC));

  const updateTier = (tier: StudyTier, patch: Partial<TierDraft>) => {
    setTiers((current) => ({ ...current, [tier]: { ...current[tier], ...patch } }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (!subject.trim()) {
      setError("Defina o tema ou objetivo antes de salvar.");
      return;
    }
    const tierKnowledge = Object.fromEntries(TIER_META.map((tier) => [tier.id, {
      minutes: nonNegativeIntegerKnowledge(tiers[tier.id].minutes, `${tier.id}_minutes`),
      outcome: textKnowledge(tiers[tier.id].outcome),
    }])) as Record<StudyTier, StudyTierPlan>;
    const planned = tierKnowledge[selectedTier].minutes;
    const actual = nonNegativeIntegerKnowledge(actualMinutes, "actual_minutes");
    const attemptedKnowledge = nonNegativeIntegerKnowledge(attempted, "attempted_questions", 10_000);
    const correctKnowledge = nonNegativeIntegerKnowledge(correct, "correct_questions", 10_000);
    for (const [label, value] of [["Meta escolhida", planned], ["Duração real", actual], ["Questões", attemptedKnowledge], ["Acertos", correctKnowledge]] as const) {
      if (value.state === "invalid") {
        setError(`${label}: use um número inteiro válido.`);
        return;
      }
    }
    if (
      attemptedKnowledge.state === "known" &&
      correctKnowledge.state === "known" &&
      correctKnowledge.value > attemptedKnowledge.value
    ) {
      setError("Acertos não podem superar as questões feitas.");
      return;
    }
    if (planned.state !== "known" && tierKnowledge[selectedTier].outcome.state !== "known") {
      setError("A meta escolhida precisa de minutos ou de um resultado observável.");
      return;
    }
    const reviewDateKnowledge: Knowledge<string> = reviewState === "not_needed_confirmed"
      ? notApplicable("review_not_needed_confirmed")
      : textKnowledge(reviewDate);
    const payload: StudiesWorkspacePayload = {
      schema: "study-session-v1",
      eventKind: "study-session",
      subject: textKnowledge(subject),
      source: method ? known(method) : unknownKnowledge("not_recorded"),
      startedAtLocal: unknownKnowledge("not_recorded"),
      endedAtLocal: unknownKnowledge("not_recorded"),
      minutes: actual,
      actualDurationMinutes: actual,
      plannedDurationMinutes: planned,
      completed: completed === null ? unknownKnowledge("not_confirmed") : known(completed),
      questions: { attempted: attemptedKnowledge, correct: correctKnowledge },
      confidenceBefore: unknownKnowledge("not_recorded"),
      confidenceAfter: scaleKnowledge(recallConfidence),
      review: { state: known(reviewState), nextDate: reviewDateKnowledge },
      note: textKnowledge(recallResponse),
      plan: { selectedTier: known(selectedTier), tiers: tierKnowledge },
      method: method ? known(method) : unknownKnowledge("not_recorded"),
      sourceReference: textKnowledge(sourceReference),
      activeRecall: {
        prompt: textKnowledge(recallPrompt),
        response: textKnowledge(recallResponse),
        confidence: scaleKnowledge(recallConfidence),
      },
      internatoLink: {
        entityId: internatoId ? known(internatoId) : unknownKnowledge("not_recorded"),
        localDate: selectedInternato ? known(selectedInternato.localDate) : unknownKnowledge("not_recorded"),
        context: textKnowledge(internatoContext || selectedInternato?.label || ""),
      },
    };
    try {
      await mentor.actions.recordGenericEvent({
        domain: "estudos",
        payload,
        summary: "Study plan, session evidence and review bridge explicitly recorded by the user.",
        localDate: date,
      });
      onDataChange?.();
      setSuccess("Plano e evidências de estudo salvos neste iPhone.");
      setActualMinutes("");
      setAttempted("");
      setCorrect("");
      setRecallResponse("");
      setCompleted(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar este estudo.");
    }
  };

  return <main className="studies-workspace" data-testid="studies-workspace">
    {onBack ? <button type="button" className="sw-back" onClick={onBack}><ArrowLeft size={18} />Voltar</button> : null}
    <header className="sw-header"><span><GraduationCap size={29} weight="thin" /></span><div><p>Mentoria de estudo</p><h1>Estudos</h1><small>Do menor bloco possível à recuperação ativa — planejado e realizado nunca se confundem.</small></div></header>

    <section className="sw-evidence" aria-labelledby="sw-evidence-title">
      <header><div><p>Janela de 60 dias</p><h2 id="sw-evidence-title">Evidências do seu estudo</h2></div><ChartLineUp size={26} weight="thin" /></header>
      <dl>
        <div><dt>Planejado</dt><dd>{formatMinutes(evidence.plannedMinutes)}</dd><small>somente metas informadas</small></div>
        <div><dt>Real</dt><dd>{formatMinutes(evidence.actualMinutes)}</dd><small>somente duração registrada</small></div>
        <div><dt>Questões</dt><dd>{evidence.questionAccuracyPercent === null ? "Sem par completo" : `${Math.round(evidence.questionAccuracyPercent)}%`}</dd><small>n={evidence.questionCount}</small></div>
        <div><dt>Revisões vencidas</dt><dd>{evidence.reviewsDue ?? "Sem amostra"}</dd><small>datas confirmadas</small></div>
      </dl>
      <p><Info size={14} />Ausência de sessão não vira zero; plano sem execução também não vira estudo realizado.</p>
    </section>

    <form className="sw-form" onSubmit={(event) => void submit(event)}>
      <section className="sw-identity">
        <div><BookOpenText size={24} weight="duotone" /><span><small>Sessão-guia</small><strong>{subject.trim() || "Tema ainda não informado"}</strong></span></div>
        <div className="sw-two-column"><StudyField label="Data"><KeyboardInput type="date" value={date} onChange={(event) => setDate(event.target.value as LocalDate)} /></StudyField><StudyField label="Tema ou objetivo"><KeyboardInput value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Ex.: classificar CTG e justificar conduta" /></StudyField></div>
      </section>

      <section className="sw-internato-bridge">
        <header><FirstAid size={22} weight="duotone" /><div><h2>Ponte com o Internato</h2><p>Vincule somente a um turno ou debrief realmente registrado.</p></div></header>
        <StudyField label="Contexto clínico">
          <select value={internatoId} onChange={(event) => setInternatoId(event.target.value)}><option value="">Sem vínculo informado</option>{internshipOptions.map((option) => <option key={option.id} value={option.id}>{formatDate(option.localDate)} · {option.label}</option>)}</select>
        </StudyField>
        {selectedInternato ? <button type="button" className="sw-use-context" onClick={() => { setInternatoContext(`${selectedInternato.label} — ${selectedInternato.detail}`); if (!subject.trim()) setSubject(selectedInternato.label); }}><Link size={16} />Usar este contexto explícito<CaretRight size={15} /></button> : null}
        <StudyField label="O que esse contexto pede de você"><KeyboardTextarea value={internatoContext} onChange={(event) => setInternatoContext(event.target.value)} placeholder="Uma lacuna, técnica ou decisão que vale revisar" /></StudyField>
      </section>

      <section className="sw-tier-ladder">
        <header><Target size={22} /><div><h2>Escada Base · Boa · Ouro</h2><p>Escolha o piso do dia; os degraus maiores continuam opcionais.</p></div></header>
        {TIER_META.map((tier, index) => { const TierIcon = tier.icon; return <article key={tier.id} data-tier={tier.id} data-active={selectedTier === tier.id}><button type="button" aria-pressed={selectedTier === tier.id} onClick={() => setSelectedTier(tier.id)}><span>{index + 1}</span><TierIcon size={19} /><p><strong>{tier.label}</strong><small>{tier.note}</small></p></button><div><StudyField label="Minutos"><KeyboardInput inputMode="numeric" value={tiers[tier.id].minutes} onChange={(event) => updateTier(tier.id, { minutes: event.target.value })} placeholder="—" /></StudyField><StudyField label="Resultado observável"><KeyboardInput value={tiers[tier.id].outcome} onChange={(event) => updateTier(tier.id, { outcome: event.target.value })} placeholder="Ex.: explicar 3 critérios" /></StudyField></div></article>; })}
      </section>

      <section className="sw-method-lab">
        <header><Brain size={22} weight="duotone" /><div><h2>Método e fonte</h2><p>A forma deve servir ao tema, não repetir uma aula genérica.</p></div></header>
        <div className="sw-methods" role="group" aria-label="Método principal">{METHODS.map((item) => <button type="button" key={item} aria-pressed={method === item} onClick={() => setMethod(item)}>{method === item ? <Check size={14} /> : <Plus size={14} />}{item}</button>)}</div>
        <StudyField label="Fonte específica"><KeyboardInput value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} placeholder="Apostila, capítulo, banco de questões, aula…" /></StudyField>
      </section>

      <section className="sw-session-ledger">
        <header><Timer size={22} /><div><h2>Bloco real</h2><p>Preencha depois ou durante; vazio permanece desconhecido.</p></div></header>
        <div className="sw-two-column"><StudyField label="Minutos realizados"><KeyboardInput inputMode="numeric" value={actualMinutes} onChange={(event) => setActualMinutes(event.target.value)} placeholder="—" /></StudyField><fieldset className="sw-completion"><legend>Conclusão</legend><div><button type="button" aria-pressed={completed === true} onClick={() => setCompleted(true)}>Concluída</button><button type="button" aria-pressed={completed === false} onClick={() => setCompleted(false)}>Interrompida</button><button type="button" aria-pressed={completed === null} onClick={() => setCompleted(null)}>Não registrei</button></div></fieldset></div>
      </section>

      <section className="sw-question-bench">
        <header><Question size={22} weight="duotone" /><div><h2>Bancada de questões</h2><p>O percentual nasce apenas quando feitas e corretas formam um par válido.</p></div></header>
        <div className="sw-score-line"><StudyField label="Feitas"><KeyboardInput inputMode="numeric" value={attempted} onChange={(event) => setAttempted(event.target.value)} placeholder="—" /></StudyField><ArrowRight size={18} /><StudyField label="Corretas"><KeyboardInput inputMode="numeric" value={correct} onChange={(event) => setCorrect(event.target.value)} placeholder="—" /></StudyField></div>
      </section>

      <section className="sw-recall">
        <header><Repeat size={22} /><div><h2>Active recall e revisão</h2><p>Crie a pergunta que fará o conhecimento reaparecer.</p></div></header>
        <StudyField label="Pergunta de recuperação"><KeyboardTextarea value={recallPrompt} onChange={(event) => setRecallPrompt(event.target.value)} placeholder="Sem olhar: como eu reconheço e conduzo…?" /></StudyField>
        <StudyField label="Resposta recuperada"><KeyboardTextarea value={recallResponse} onChange={(event) => setRecallResponse(event.target.value)} placeholder="Escreva com suas palavras; lacunas podem ficar explícitas" /></StudyField>
        <span className="sw-scale-label">Confiança depois da recuperação</span><StudyScale value={recallConfidence} onChange={setRecallConfidence} label="Confiança depois do active recall" />
        <div className="sw-two-column"><StudyField label="Estado da revisão"><select value={reviewState} onChange={(event) => setReviewState(event.target.value)}><option value="scheduled">Agendar</option><option value="already_reviewed">Já revisei</option><option value="not_needed_confirmed">Não precisa</option><option value="undecided">Decidir depois</option></select></StudyField>{reviewState !== "not_needed_confirmed" ? <StudyField label="Próxima revisão"><KeyboardInput type="date" value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} /></StudyField> : <div className="sw-no-review"><CheckCircle size={18} /><span>Dispensa confirmada por você.</span></div>}</div>
      </section>

      {error || success ? <p className="sw-feedback" data-state={error ? "error" : "success"} role={error ? "alert" : "status"}>{error ? <Warning size={17} /> : <CheckCircle size={17} />}{error ?? success}</p> : null}
      <button type="submit" className="sw-save" disabled={mentor.saving}><GraduationCap size={19} weight="bold" />{mentor.saving ? "Salvando…" : "Salvar plano e evidências"}<ArrowRight size={17} /></button>
      <p className="sw-truth"><ShieldCheck size={14} />O plano escolhido não preenche o tempo real; questões ausentes não viram erro.</p>
    </form>

    <section className="sw-history" aria-labelledby="sw-history-title"><header><ListChecks size={22} weight="thin" /><div><h2 id="sw-history-title">Últimas sessões</h2><p>Histórico da janela atual, sem completar lacunas.</p></div></header>{mentor.loading ? <p className="sw-loading">Lendo o histórico deste iPhone…</p> : history.length ? <div>{history.slice(0, 8).map((entity) => { const payload = payloadOf(entity)!; const questions = payload.questions as Record<string, unknown> | undefined; const actual = knowledgeValue<number>(payload.actualDurationMinutes ?? payload.minutes); const planned = knowledgeValue<number>(payload.plannedDurationMinutes); const subjectValue = knowledgeValue<string>(payload.subject) ?? "Tema não informado"; const attemptedValue = knowledgeValue<number>(questions?.attempted); const correctValue = knowledgeValue<number>(questions?.correct); return <article key={entity.id}><time>{formatDate(entity.localDate)}</time><span /><p><strong>{subjectValue}</strong><small>{planned === null ? "plano desconhecido" : `${planned} min planejados`} · {actual === null ? "real desconhecido" : `${actual} min reais`}</small><em>{attemptedValue === null || correctValue === null ? "questões sem par" : `${correctValue}/${attemptedValue} questões`}</em></p></article>; })}</div> : <div className="sw-empty"><NotePencil size={24} /><p><strong>A primeira evidência nasce do primeiro registro.</strong><span>Você pode salvar somente o plano e completar uma sessão futura separadamente.</span></p></div>}</section>
    {mentor.error ? <p className="sw-global-error" role="alert"><Warning size={16} />{mentor.error.message}</p> : null}
  </main>;
}

export default StudiesWorkspace;
