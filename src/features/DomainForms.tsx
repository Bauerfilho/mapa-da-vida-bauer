import { useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { Bed } from "@phosphor-icons/react/dist/csr/Bed";
import { BookOpenText } from "@phosphor-icons/react/dist/csr/BookOpenText";
import { Brain } from "@phosphor-icons/react/dist/csr/Brain";
import { CalendarBlank } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { ChartBar } from "@phosphor-icons/react/dist/csr/ChartBar";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { Coffee } from "@phosphor-icons/react/dist/csr/Coffee";
import { CurrencyCircleDollar } from "@phosphor-icons/react/dist/csr/CurrencyCircleDollar";
import { Drop } from "@phosphor-icons/react/dist/csr/Drop";
import { ForkKnife } from "@phosphor-icons/react/dist/csr/ForkKnife";
import { Gauge } from "@phosphor-icons/react/dist/csr/Gauge";
import { GraduationCap } from "@phosphor-icons/react/dist/csr/GraduationCap";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { Lightbulb } from "@phosphor-icons/react/dist/csr/Lightbulb";
import { ListChecks } from "@phosphor-icons/react/dist/csr/ListChecks";
import { Moon } from "@phosphor-icons/react/dist/csr/Moon";
import { NotePencil } from "@phosphor-icons/react/dist/csr/NotePencil";
import { Package } from "@phosphor-icons/react/dist/csr/Package";
import { Pill } from "@phosphor-icons/react/dist/csr/Pill";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Pulse } from "@phosphor-icons/react/dist/csr/Pulse";
import { Receipt } from "@phosphor-icons/react/dist/csr/Receipt";
import { Repeat } from "@phosphor-icons/react/dist/csr/Repeat";
import { Robot } from "@phosphor-icons/react/dist/csr/Robot";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { Stethoscope } from "@phosphor-icons/react/dist/csr/Stethoscope";
import { SunHorizon } from "@phosphor-icons/react/dist/csr/SunHorizon";
import { Tag } from "@phosphor-icons/react/dist/csr/Tag";
import { Timer } from "@phosphor-icons/react/dist/csr/Timer";
import { Tooth } from "@phosphor-icons/react/dist/csr/Tooth";
import { TrendUp } from "@phosphor-icons/react/dist/csr/TrendUp";
import { Wallet } from "@phosphor-icons/react/dist/csr/Wallet";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import type { Icon } from "@phosphor-icons/react";
import { KeyboardInput, KeyboardTextarea } from "../mobile";
import { LaboratoryCapture } from "./LaboratoryWorkspace";
import { todayInTimeZone as laboratoryToday } from "../domain/dates";
import {
  assertLocalDate,
  combineLocalDateAndTime,
  confirmedAbsent,
  durationMinutes,
  invalidKnowledge,
  known,
  notApplicable,
  unknown,
  type Domain,
  type GenericPayload,
  type Knowledge,
  type LocalDate,
  type LocalTime,
  type Money,
  type RecordGenericEventInput,
} from "../domain";
import { getDomainCatalogEntry } from "./domainCatalog";
import {
  brlMoneyKnowledge,
  firstValidationIssue,
  hasAnyRecordedValue,
  headacheDetailsIssue,
  knowledgeValidationIssue,
  medicationSosConfirmationIssue,
  medicationSosUseKnowledge,
  otherInstitutionIssue,
  rangedNumberKnowledge,
  routineTaskKnowledge,
  sleepChronologyIssue,
  type NumberKnowledgeOptions,
} from "./domainFormValidation";
import {
  buildMoodFunctionalPayload,
  type MoodMetricKey,
  type MoodMetricState,
  type PerceivedBaselineChange,
  type PerceivedSleepNeed,
} from "./moodPayload";
export type {
  MoodFunctionalPayload,
  MoodFunctionalPayloadV1,
  MoodFunctionalPayloadV2,
} from "./moodPayload";
import "./domain-forms.css";

export interface DomainSaveRequest<
  TPayload extends GenericPayload = GenericPayload,
> {
  input: RecordGenericEventInput<TPayload>;
  message: string;
}

export type DomainSaveHandler = (
  request: DomainSaveRequest,
) => void | Promise<void>;

export type DomainFormMode =
  | "medication-stock"
  | "medication-sos"
  | "finance-subscription";

export interface DomainFormsProps {
  domain: Domain;
  onSaved: DomainSaveHandler;
  localDate?: LocalDate;
  disabled?: boolean;
  initialMode?: DomainFormMode;
}

interface FormProps {
  onSaved: DomainSaveHandler;
  localDate?: LocalDate;
  disabled?: boolean;
  initialMode?: DomainFormMode;
}

export type InternatoDebriefPayload = GenericPayload & {
  schema: "internship-debrief-v1";
  eventKind: "internship-debrief";
  participation: Knowledge<string>;
  topicsSeen: Knowledge<string[]>;
  /** Canonical analytics alias. `topicsSeen` remains for backward compatibility. */
  topics: Knowledge<string[]>;
  feedback: {
    state: Knowledge<string>;
    count: Knowledge<number>;
    areas: Knowledge<string[]>;
    wording: Knowledge<string>;
  };
  nextPractice: Knowledge<string>;
  learningNote: Knowledge<string>;
};

export type StudySessionPayload = GenericPayload & {
  schema: "study-session-v1";
  eventKind: "study-session";
  subject: Knowledge<string>;
  source: Knowledge<string>;
  startedAtLocal: Knowledge<string>;
  endedAtLocal: Knowledge<string>;
  minutes: Knowledge<number>;
  /** Canonical duration alias; equal to `minutes`. */
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
};

export type MedicationDetailPayload = GenericPayload & {
  schema: "medication-detail-v1";
  eventKind: "medication-regimen" | "medication-stock" | "medication-sos";
  recordMode: "regimen" | "stock" | "sos";
  medicationName: Knowledge<string>;
  dose: Knowledge<string>;
  form: Knowledge<string>;
  schedule: Knowledge<string>;
  regimenStatus: Knowledge<string>;
  stock: {
    quantity: Knowledge<number>;
    unit: Knowledge<string>;
    refillAt: Knowledge<number>;
  };
  sos: {
    useConfirmed: Knowledge<boolean>;
    reason: Knowledge<string>;
    takenAtLocal: Knowledge<string>;
    response: Knowledge<number>;
  };
  note: Knowledge<string>;
};

export type SleepChronologyPayload = GenericPayload & {
  schema: "sleep-chronology-v1";
  eventKind: "sleep-chronology";
  chronology: {
    wentToBedLocal: Knowledge<string>;
    sleepOnsetLocal: Knowledge<string>;
    finalWakeLocal: Knowledge<string>;
    leftBedLocal: Knowledge<string>;
  };
  awakenings: Knowledge<number>;
  awakeMinutes: Knowledge<number>;
  napMinutes: Knowledge<number>;
  perceivedQuality: Knowledge<number>;
  restorative: Knowledge<boolean>;
  note: Knowledge<string>;
};

export type NutritionLogPayload = GenericPayload & {
  schema: "nutrition-log-v1";
  eventKind: "nutrition-log";
  recordMode: "meal" | "omission" | "hydration";
  meal: {
    presence: Knowledge<boolean>;
    kind: Knowledge<string>;
    timeLocal: Knowledge<string>;
    composition: Knowledge<string>;
    context: Knowledge<string>;
  };
  omissionContext: Knowledge<string>;
  hydration: {
    amountMl: Knowledge<number>;
    measurement: "increment";
  };
  /** Backward-compatible analytics alias for `hydration.amountMl`. */
  waterMl: Knowledge<number>;
  caffeine: {
    servings: Knowledge<number>;
    lastUseLocal: Knowledge<string>;
  };
  hungerBefore: Knowledge<number>;
  fullnessAfter: Knowledge<number>;
};

export type HeadacheCrisisPayload = GenericPayload & {
  schema: "headache-crisis-v1";
  eventKind: "headache-crisis";
  presence: Knowledge<boolean>;
  observationScope: Knowledge<"moment" | "full-day">;
  onsetLocal: Knowledge<string>;
  endedLocal: Knowledge<string>;
  intensityCurrent: Knowledge<number>;
  intensityPeak: Knowledge<number>;
  locations: Knowledge<string[]>;
  qualities: Knowledge<string[]>;
  associatedSymptoms: Knowledge<string[]>;
  suspectedTriggers: Knowledge<string[]>;
  disabilityMinutes: Knowledge<number>;
  acuteMedicationUsed: Knowledge<boolean>;
  rescueUsed: Knowledge<string>;
  response: Knowledge<number>;
  note: Knowledge<string>;
};

export type BruxismAmPmPayload = GenericPayload & {
  schema: "bruxism-am-pm-v1";
  eventKind: "bruxism-am-pm";
  morning: BruxismPeriodPayload;
  evening: BruxismPeriodPayload;
  daytimeClenching: Knowledge<boolean>;
  grindingReported: Knowledge<boolean>;
  guardUsed: Knowledge<boolean>;
  /** Canonical analytics alias; equal to `guardUsed`. */
  splintUsed: Knowledge<boolean>;
  morningSymptoms: Knowledge<boolean>;
  note: Knowledge<string>;
};

export interface BruxismPeriodPayload {
  jawPain: Knowledge<number>;
  templePain: Knowledge<number>;
  stiffness: Knowledge<number>;
  dentalSensitivity: Knowledge<number>;
}

export type FinanceRecordPayload = GenericPayload & {
  schema: "finance-record-v1";
  eventKind: "finance-transaction" | "finance-debt" | "finance-subscription";
  recordMode: "transaction" | "debt" | "subscription";
  institution: Knowledge<string>;
  transaction: {
    direction: Knowledge<string>;
    amount: Knowledge<Money>;
    category: Knowledge<string>;
    occurredOn: Knowledge<string>;
  };
  debt: {
    creditor: Knowledge<string>;
    outstanding: Knowledge<Money>;
    interestRate: Knowledge<number>;
    ratePeriod: Knowledge<string>;
    dueDate: Knowledge<string>;
    minimumPayment: Knowledge<Money>;
  };
  subscription: {
    service: Knowledge<string>;
    price: Knowledge<Money>;
    cadence: Knowledge<string>;
    renewalDate: Knowledge<string>;
    status: Knowledge<string>;
  };
  note: Knowledge<string>;
};

export type RoutineDayPayload = GenericPayload & {
  schema: "routine-day-plan-v1";
  eventKind: "routine-day-plan";
  anchors: Array<{
    kind: string;
    timeLocal: Knowledge<string>;
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
};

export type AgendaRecordPayload = GenericPayload & {
  schema: "agenda-record-v1";
  eventKind: "agenda-event" | "agenda-task";
  recordMode: "event" | "task";
  title: Knowledge<string>;
  date: Knowledge<string>;
  plannedStartLocal: Knowledge<string>;
  plannedEndLocal: Knowledge<string>;
  dueLocalDate: Knowledge<string>;
  dueLocalTime: Knowledge<string>;
  status: Knowledge<string>;
  priority: Knowledge<string>;
  event: {
    startLocal: Knowledge<string>;
    endLocal: Knowledge<string>;
    location: Knowledge<string>;
    confirmation: Knowledge<boolean>;
  };
  task: {
    dueLocal: Knowledge<string>;
    priority: Knowledge<string>;
    status: Knowledge<string>;
  };
  source: "manual";
  note: Knowledge<string>;
};

export type AIToolPortfolioPayload = GenericPayload & {
  schema: "ai-tool-portfolio-v1";
  eventKind: "ai-tool-portfolio";
  toolName: Knowledge<string>;
  provider: Knowledge<string>;
  roles: Knowledge<string[]>;
  project: Knowledge<string>;
  subscription: {
    price: Knowledge<Money>;
    /** Canonical analytics alias; equal to `price`, with cadence kept alongside. */
    amount: Knowledge<Money>;
    cadence: Knowledge<string>;
    renewalDate: Knowledge<string>;
  };
  usefulness: Knowledge<number>;
  overlap: Knowledge<number>;
  status: Knowledge<string>;
  decision: Knowledge<string>;
  note: Knowledge<string>;
};

export type KnowledgeCapturePayload = GenericPayload & {
  schema: "knowledge-capture-v1";
  eventKind: "knowledge-capture";
  title: Knowledge<string>;
  topic: Knowledge<string>;
  source: {
    kind: Knowledge<string>;
    reference: Knowledge<string>;
  };
  capture: Knowledge<string>;
  application: Knowledge<string>;
  openQuestion: Knowledge<string>;
  confidence: Knowledge<number>;
  nextReviewDate: Knowledge<string>;
  reviewDueDate: Knowledge<string>;
  review: {
    dueDate: Knowledge<string>;
  };
  tags: Knowledge<string[]>;
};

export function DomainForms({
  domain,
  onSaved,
  localDate,
  disabled,
  initialMode,
}: DomainFormsProps) {
  const props = { onSaved, localDate, disabled, initialMode };

  switch (domain) {
    case "internato": return <InternatoForm {...props} />;
    case "estudos": return <StudiesForm {...props} />;
    case "medicamentos": return <MedicationForm {...props} />;
    case "sono": return <SleepForm {...props} />;
    case "alimentacao": return <NutritionForm {...props} />;
    case "humor": return <MoodForm {...props} />;
    case "cefaleia": return <HeadacheForm {...props} />;
    case "bruxismo": return <BruxismForm {...props} />;
    case "financas": return <FinanceForm {...props} />;
    case "rotina": return <RoutineForm {...props} />;
    case "agenda": return <AgendaForm {...props} />;
    case "ia": return <AIToolForm {...props} />;
    case "conhecimento": return <KnowledgeForm {...props} />;
    case "exames": return <LaboratoryCapture referenceDate={localDate ?? laboratoryToday()} disabled={disabled} onSave={async (payload) => onSaved({ input: { domain: "exames", payload, localDate: payload.collectedOn, summary: "Exames laboratoriais transcritos pelo usuário." }, message: "Exame guardado no arquivo pessoal" })} />;
  }
}

export const DomainForm = DomainForms;

function makeRequest<TPayload extends GenericPayload>(
  domain: Domain,
  payload: TPayload,
  summary: string,
  message: string,
  localDate?: LocalDate,
): DomainSaveRequest<TPayload> {
  return {
    input: {
      domain,
      payload,
      summary,
      ...(localDate ? { localDate } : {}),
    },
    message,
  };
}

function useSaveRequest(onSaved: DomainSaveHandler) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (request: DomainSaveRequest) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSaved(request);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar este registro.");
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, save };
}

function textKnowledge(value: string): Knowledge<string> {
  const clean = value.trim();
  return clean ? known(clean) : unknown("not_recorded");
}

function arrayKnowledge(values: Iterable<string>): Knowledge<string[]> {
  const clean = Array.from(values, (value) => value.trim()).filter(Boolean);
  return clean.length ? known(clean) : unknown("not_recorded");
}

function numberKnowledge(
  value: string,
  options: NumberKnowledgeOptions = {},
): Knowledge<number> {
  return rangedNumberKnowledge(value, options);
}

function scaleKnowledge(value: number | null): Knowledge<number> {
  return value === null ? unknown("not_recorded") : known(value);
}

function rangedScaleKnowledge(
  value: number | null,
  min: number,
  max: number,
): Knowledge<number> {
  if (value === null) return unknown("not_recorded");
  return Number.isFinite(value) && value >= min && value <= max
    ? known(value)
    : invalidKnowledge("scale_out_of_range");
}

function truthKnowledge(value: boolean | null, reasonCode: string): Knowledge<boolean> {
  if (value === null) return unknown("not_confirmed");
  return value ? known(true) : confirmedAbsent(reasonCode);
}

function moneyKnowledge(value: string): Knowledge<Money> {
  return brlMoneyKnowledge(value);
}

function localDateKnowledge(value: string): Knowledge<string> {
  const clean = value.trim();
  if (!clean) return unknown("not_recorded");
  try {
    assertLocalDate(clean);
    return known(clean);
  } catch {
    return invalidKnowledge("invalid_local_date");
  }
}

function localDateValue(value: Knowledge<string>): LocalDate | undefined {
  return value.state === "known" ? value.value as LocalDate : undefined;
}

function localTimeKnowledge(value: string): Knowledge<string> {
  const clean = value.trim();
  if (!clean) return unknown("not_recorded");
  try {
    combineLocalDateAndTime("2000-01-01", clean as LocalTime);
    return known(clean);
  } catch {
    return invalidKnowledge("invalid_local_time");
  }
}

function localDateTimeKnowledge(
  date: Knowledge<string>,
  time: Knowledge<string>,
): Knowledge<string> {
  if (date.state === "invalid" || time.state === "invalid") {
    return invalidKnowledge("invalid_local_date_time");
  }
  if (date.state !== "known" || time.state !== "known") {
    return unknown("not_recorded");
  }
  try {
    return known(combineLocalDateAndTime(date.value as LocalDate, time.value as LocalTime));
  } catch {
    return invalidKnowledge("invalid_local_date_time");
  }
}

function temporalValidationIssue(
  label: string,
  value: Knowledge<string>,
): string | null {
  return value.state === "invalid" ? `${label} é inválido.` : null;
}

function toggleSet(
  current: ReadonlySet<string>,
  value: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function submitForm(
  event: FormEvent<HTMLFormElement>,
  action: () => void | Promise<void>,
) {
  event.preventDefault();
  void action();
}

function FormIntro({ domain, icon: OverrideIcon }: { domain: Domain; icon?: Icon }) {
  const entry = getDomainCatalogEntry(domain);
  const IconComponent = OverrideIcon ?? entry.icon;
  const patientSensitive = ["internato", "medicamentos", "sono", "humor", "cefaleia", "bruxismo", "conhecimento"].includes(domain);
  return (
    <header className="df-intro" data-tone={entry.tone}>
      <span className="df-intro-icon"><IconComponent size={21} weight="duotone" /></span>
      <span>
        <strong>{entry.anatomy}</strong>
        <small>{entry.description}</small>
      </span>
      {patientSensitive ? <em className="df-patient-privacy"><ShieldCheck size={13} />Não registre nome, prontuário ou qualquer dado identificável de paciente.</em> : null}
    </header>
  );
}

function FormSection({
  title,
  hint,
  icon: IconComponent,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  icon?: Icon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`df-section ${className}`.trim()}>
      <div className="df-section-heading">
        {IconComponent ? <IconComponent size={18} weight="duotone" /> : null}
        <span><strong>{title}</strong>{hint ? <small>{hint}</small> : null}</span>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`df-field ${className}`.trim()}>
      <span className="df-field-label">{label}</span>
      {hint ? <small>{hint}</small> : null}
      {children}
    </label>
  );
}

interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  detail?: string;
}

function SegmentedChoice<T extends string>({
  value,
  onChange,
  options,
  label,
  columns,
}: {
  value: T | null;
  onChange: (value: T) => void;
  options: readonly ChoiceOption<T>[];
  label: string;
  columns?: number;
}) {
  return (
    <div
      className="df-segmented"
      role="group"
      aria-label={label}
      style={columns ? { "--df-columns": columns } as CSSProperties : undefined}
    >
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          <strong>{option.label}</strong>
          {option.detail ? <small>{option.detail}</small> : null}
        </button>
      ))}
    </div>
  );
}

function ScaleChoice({
  value,
  onChange,
  min,
  max,
  label,
  lowLabel,
  highLabel,
  compact = false,
}: {
  value: number | null;
  onChange: (value: number) => void;
  min: number;
  max: number;
  label: string;
  lowLabel?: string;
  highLabel?: string;
  compact?: boolean;
}) {
  const values = Array.from({ length: max - min + 1 }, (_, index) => min + index);
  return (
    <div className={`df-scale ${compact ? "df-scale-compact" : ""}`.trim()}>
      <div role="group" aria-label={label}>
        {values.map((item) => (
          <button
            type="button"
            key={item}
            aria-label={`${label}: ${item}`}
            aria-pressed={value === item}
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {(lowLabel || highLabel) ? <small><span>{lowLabel}</span><span>{highLabel}</span></small> : null}
    </div>
  );
}

function TagPicker({
  selected,
  onChange,
  options,
  label,
}: {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  options: readonly string[];
  label: string;
}) {
  return (
    <div className="df-tags" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option}
          aria-pressed={selected.has(option)}
          onClick={() => onChange(toggleSet(selected, option))}
        >
          {selected.has(option) ? <Check size={13} weight="bold" /> : <Plus size={13} />}
          {option}
        </button>
      ))}
    </div>
  );
}

function TriStateChoice({
  value,
  onChange,
  label,
  yes = "Sim",
  no = "Não",
}: {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  label: string;
  yes?: string;
  no?: string;
}) {
  return (
    <div className="df-tristate" role="group" aria-label={label}>
      <button type="button" aria-pressed={value === true} onClick={() => onChange(true)}>{yes}</button>
      <button type="button" aria-pressed={value === false} onClick={() => onChange(false)}>{no}</button>
      <button type="button" aria-pressed={value === null} onClick={() => onChange(null)}>Não registrei</button>
    </div>
  );
}

function SaveFooter({
  busy,
  disabled,
  error,
  label,
  icon: IconComponent = CheckCircle,
}: {
  busy: boolean;
  disabled?: boolean;
  error: string | null;
  label: string;
  icon?: Icon;
}) {
  return (
    <footer className="df-save-footer">
      {error ? <p role="alert"><WarningCircle size={16} />{error}</p> : null}
      <p className="df-truth-note"><ShieldCheck size={14} />Vazio = desconhecido; “não” só é salvo quando você confirma.</p>
      <button type="submit" className="df-save" disabled={busy || disabled}>
        <IconComponent size={19} weight="bold" />
        {busy ? "Salvando…" : label}
        {!busy ? <ArrowRight size={17} /> : null}
      </button>
    </footer>
  );
}

function InlineNotice({ children, tone = "gold" }: { children: ReactNode; tone?: "gold" | "red" | "green" | "blue" }) {
  return <div className="df-notice" data-tone={tone}><Info size={17} /><p>{children}</p></div>;
}

const INTERNATO_TOPICS = [
  "CTG/tocografia",
  "Exame físico",
  "Partograma",
  "Pré-natal",
  "Puerpério",
  "Prescrição",
  "Evolução",
  "Comunicação",
] as const;

const FEEDBACK_AREAS = [
  "Conhecimento",
  "Técnica",
  "Pontualidade",
  "Organização",
  "Comunicação",
  "Postura",
] as const;

function InternatoForm({ onSaved, localDate, disabled }: FormProps) {
  const [participation, setParticipation] = useState<string | null>(null);
  const [topics, setTopics] = useState<Set<string>>(() => new Set());
  const [customTopic, setCustomTopic] = useState("");
  const [feedbackState, setFeedbackState] = useState<string | null>(null);
  const [feedbackCount, setFeedbackCount] = useState("");
  const [feedbackAreas, setFeedbackAreas] = useState<Set<string>>(() => new Set());
  const [feedbackWording, setFeedbackWording] = useState("");
  const [nextPractice, setNextPractice] = useState("");
  const [learningNote, setLearningNote] = useState("");
  const { busy, error, save } = useSaveRequest(onSaved);

  const allTopics = new Set(topics);
  if (customTopic.trim()) allTopics.add(customTopic.trim());
  const topicsKnowledge = arrayKnowledge(allTopics);
  const feedbackCountKnowledge = feedbackState === "none_confirmed"
    ? confirmedAbsent<number>("no_feedback_confirmed")
    : numberKnowledge(feedbackCount, { min: 0, integer: true });
  const hasMeaningfulValue = hasAnyRecordedValue([
    participation,
    allTopics,
    feedbackState,
    feedbackCount,
    feedbackAreas,
    feedbackWording,
    nextPractice,
    learningNote,
  ]);
  const validationIssue = firstValidationIssue(hasMeaningfulValue, [
    knowledgeValidationIssue("Quantidade de feedbacks", feedbackCountKnowledge),
  ]);

  const handleSave = () => {
    const payload: InternatoDebriefPayload = {
      schema: "internship-debrief-v1",
      eventKind: "internship-debrief",
      participation: participation ? known(participation) : unknown("not_recorded"),
      topicsSeen: topicsKnowledge,
      topics: topicsKnowledge,
      feedback: {
        state: feedbackState ? known(feedbackState) : unknown("not_confirmed"),
        count: feedbackCountKnowledge,
        areas: feedbackState === "none_confirmed"
          ? confirmedAbsent("no_feedback_confirmed")
          : arrayKnowledge(feedbackAreas),
        wording: feedbackState === "none_confirmed"
          ? notApplicable("no_feedback_confirmed")
          : textKnowledge(feedbackWording),
      },
      nextPractice: textKnowledge(nextPractice),
      learningNote: textKnowledge(learningNote),
    };
    return save(makeRequest(
      "internato",
      payload,
      "Internship participation, topics and feedback explicitly recorded by the user.",
      "Debrief do internato salvo",
      localDate,
    ));
  };

  return (
    <form className="df-form df-internato" onSubmit={(event) => submitForm(event, handleSave)}>
      <FormIntro domain="internato" />
      <FormSection title="Como você entrou na cena" hint="participação observável, não nota de desempenho" icon={Stethoscope} className="df-debrief-step">
        <SegmentedChoice
          label="Nível de participação"
          value={participation}
          onChange={setParticipation}
          columns={2}
          options={[
            { value: "observed", label: "Observei", detail: "acompanhei o raciocínio" },
            { value: "assisted", label: "Auxiliei", detail: "participei com supervisão" },
            { value: "performed", label: "Executei", detail: "realizei parte do cuidado" },
            { value: "discussed", label: "Discuti", detail: "apresentei ou defendi conduta" },
          ]}
        />
      </FormSection>

      <FormSection title="O que passou pela enfermaria" hint="selecione somente o que realmente apareceu" icon={BookOpenText} className="df-topic-field">
        <TagPicker selected={topics} onChange={setTopics} options={INTERNATO_TOPICS} label="Temas vistos" />
        <Field label="Outro tema">
          <KeyboardInput value={customTopic} onChange={(event) => setCustomTopic(event.target.value)} placeholder="Ex.: rotura prematura de membranas" />
        </Field>
      </FormSection>

      <FormSection title="Feedback recebido" hint="bronca, correção e elogio ficam separados de ausência de registro" icon={Pulse} className="df-feedback-ledger">
        <SegmentedChoice
          label="Tipo de feedback"
          value={feedbackState}
          onChange={setFeedbackState}
          columns={2}
          options={[
            { value: "correction", label: "Correção", detail: "algo precisou mudar" },
            { value: "positive", label: "Positivo", detail: "algo foi reconhecido" },
            { value: "mixed", label: "Misto", detail: "houve os dois" },
            { value: "none_confirmed", label: "Nenhum", detail: "ausência confirmada" },
          ]}
        />
        {feedbackState !== "none_confirmed" ? (
          <>
            <div className="df-two-column">
              <Field label="Quantos episódios?">
                <KeyboardInput inputMode="numeric" value={feedbackCount} onChange={(event) => setFeedbackCount(event.target.value)} placeholder="0" />
              </Field>
              <div className="df-mini-summary"><ChartBar size={18} /><span><small>Leitura futura</small><strong>área × frequência</strong></span></div>
            </div>
            <TagPicker selected={feedbackAreas} onChange={setFeedbackAreas} options={FEEDBACK_AREAS} label="Áreas do feedback" />
            <Field label="O que foi dito" hint="registre com suas palavras; não precisa interpretar agora">
              <KeyboardTextarea value={feedbackWording} onChange={(event) => setFeedbackWording(event.target.value)} placeholder="Ex.: organizar o exame antes de apresentar…" />
            </Field>
          </>
        ) : <InlineNotice tone="green">Você confirmou que não recebeu feedback neste período.</InlineNotice>}
      </FormSection>

      <FormSection title="Fechar o ciclo" icon={Repeat} className="df-next-gesture">
        <Field label="Próximo gesto para praticar">
          <KeyboardInput value={nextPractice} onChange={(event) => setNextPractice(event.target.value)} placeholder="Uma ação pequena e observável" />
        </Field>
        <Field label="Aprendizado do dia">
          <KeyboardTextarea value={learningNote} onChange={(event) => setLearningNote(event.target.value)} placeholder="O que vale levar para o próximo plantão?" />
        </Field>
      </FormSection>
      <SaveFooter
        busy={busy}
        disabled={disabled || Boolean(validationIssue)}
        error={error || (hasMeaningfulValue ? validationIssue : null)}
        label="Salvar debrief"
      />
    </form>
  );
}

function StudiesForm({ onSaved, localDate, disabled }: FormProps) {
  const [subject, setSubject] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [minutes, setMinutes] = useState("");
  const [plannedMinutes, setPlannedMinutes] = useState("");
  const [completed, setCompleted] = useState<boolean | null>(null);
  const [attempted, setAttempted] = useState("");
  const [correct, setCorrect] = useState("");
  const [confidenceBefore, setConfidenceBefore] = useState<number | null>(null);
  const [confidenceAfter, setConfidenceAfter] = useState<number | null>(null);
  const [reviewState, setReviewState] = useState<string | null>(null);
  const [nextReviewDate, setNextReviewDate] = useState("");
  const [note, setNote] = useState("");
  const { busy, error, save } = useSaveRequest(onSaved);

  const startedKnowledge = localTimeKnowledge(startedAt);
  const endedKnowledge = localTimeKnowledge(endedAt);
  const explicitMinutesKnowledge = numberKnowledge(minutes, { min: 0, max: 1_440, integer: true });
  const plannedMinutesKnowledge = numberKnowledge(plannedMinutes, { min: 0, max: 1_440, integer: true });
  const derivedMinutes = startedKnowledge.state === "known" && endedKnowledge.state === "known"
    ? durationMinutes(startedKnowledge.value, endedKnowledge.value)
    : null;
  const minutesKnowledge = explicitMinutesKnowledge.state === "unknown" && derivedMinutes !== null
    ? known(derivedMinutes, "derived")
    : explicitMinutesKnowledge;
  const attemptedKnowledge = numberKnowledge(attempted, { min: 0, integer: true });
  const rawCorrectKnowledge = numberKnowledge(correct, { min: 0, integer: true });
  const questionError = attemptedKnowledge.state === "known" && rawCorrectKnowledge.state === "known" &&
    rawCorrectKnowledge.value > attemptedKnowledge.value
    ? "Acertos não podem superar as questões feitas."
    : null;
  const correctKnowledge = questionError
    ? invalidKnowledge<number>("correct_exceeds_attempted")
    : rawCorrectKnowledge;
  const reviewDateKnowledge = reviewState === "not_needed_confirmed"
    ? notApplicable<string>("review_not_needed_confirmed")
    : localDateKnowledge(nextReviewDate);
  const hasMeaningfulValue = hasAnyRecordedValue([
    subject,
    source,
    startedAt,
    endedAt,
    minutes,
    plannedMinutes,
    completed,
    attempted,
    correct,
    confidenceBefore,
    confidenceAfter,
    reviewState,
    nextReviewDate,
    note,
  ]);
  const validationIssue = firstValidationIssue(hasMeaningfulValue, [
    temporalValidationIssue("Horário inicial", startedKnowledge),
    temporalValidationIssue("Horário final", endedKnowledge),
    knowledgeValidationIssue("Duração", minutesKnowledge),
    knowledgeValidationIssue("Duração planejada", plannedMinutesKnowledge),
    knowledgeValidationIssue("Questões feitas", attemptedKnowledge),
    knowledgeValidationIssue("Acertos", correctKnowledge),
    questionError,
    temporalValidationIssue("Data da revisão", reviewDateKnowledge),
  ]);

  const handleSave = () => {
    const payload: StudySessionPayload = {
      schema: "study-session-v1",
      eventKind: "study-session",
      subject: textKnowledge(subject),
      source: source ? known(source) : unknown("not_recorded"),
      startedAtLocal: startedKnowledge,
      endedAtLocal: endedKnowledge,
      minutes: minutesKnowledge,
      actualDurationMinutes: minutesKnowledge,
      plannedDurationMinutes: plannedMinutesKnowledge,
      completed: completed === null ? unknown("not_confirmed") : known(completed),
      questions: {
        attempted: attemptedKnowledge,
        correct: correctKnowledge,
      },
      confidenceBefore: scaleKnowledge(confidenceBefore),
      confidenceAfter: scaleKnowledge(confidenceAfter),
      review: {
        state: reviewState ? known(reviewState) : unknown("not_confirmed"),
        nextDate: reviewDateKnowledge,
      },
      note: textKnowledge(note),
    };
    return save(makeRequest(
      "estudos",
      payload,
      "Study session and review plan explicitly recorded by the user.",
      "Sessão de estudo salva",
      localDate,
    ));
  };

  return (
    <form className="df-form df-studies" onSubmit={(event) => submitForm(event, handleSave)}>
      <FormIntro domain="estudos" icon={GraduationCap} />
      <section className="df-study-ticket">
        <div><BookOpenText size={22} weight="duotone" /><span><small>Sessão</small><strong>{subject.trim() || "Tema ainda não informado"}</strong></span></div>
        <Field label="Tema ou objetivo">
          <KeyboardInput value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Ex.: interpretação da cardiotocografia" />
        </Field>
        <SegmentedChoice
          label="Fonte principal"
          value={source}
          onChange={setSource}
          columns={3}
          options={[
            { value: "aula", label: "Aula" },
            { value: "questoes", label: "Questões" },
            { value: "leitura", label: "Leitura" },
            { value: "caso", label: "Caso" },
            { value: "video", label: "Vídeo" },
            { value: "outro", label: "Outro" },
          ]}
        />
      </section>

      <FormSection title="Cronômetro honesto" hint="horários ou duração; o que estiver vazio permanece desconhecido" icon={Timer} className="df-study-clock">
        <div className="df-three-column">
          <Field label="Início"><KeyboardInput type="time" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></Field>
          <Field label="Fim"><KeyboardInput type="time" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} /></Field>
          <Field label="Minutos"><KeyboardInput inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} placeholder="—" /></Field>
        </div>
        <div className="df-two-column">
          <Field label="Minutos planejados"><KeyboardInput inputMode="numeric" value={plannedMinutes} onChange={(event) => setPlannedMinutes(event.target.value)} placeholder="—" /></Field>
          <div className="df-mini-summary"><Timer size={18} /><span><small>Comparação futura</small><strong>planejado × realizado</strong></span></div>
        </div>
        <div className="df-confirmation-stamp"><span>Esta sessão foi concluída?</span><TriStateChoice value={completed} onChange={setCompleted} label="Conclusão da sessão" yes="Concluída" no="Não concluída" /></div>
      </FormSection>

      <FormSection title="Bancada de questões" icon={Gauge} className="df-question-bench">
        <div className="df-question-score">
          <Field label="Feitas"><KeyboardInput inputMode="numeric" value={attempted} onChange={(event) => setAttempted(event.target.value)} placeholder="0" /></Field>
          <span><ArrowRight size={19} /><small>resultado informado</small></span>
          <Field label="Acertos"><KeyboardInput inputMode="numeric" value={correct} onChange={(event) => setCorrect(event.target.value)} placeholder="0" /></Field>
        </div>
        {questionError ? <p className="df-validation" role="alert"><WarningCircle size={15} />{questionError}</p> : null}
      </FormSection>

      <FormSection title="Confiança antes × depois" hint="1 = não explico ainda · 5 = explico sem apoio" icon={TrendUp} className="df-confidence-compare">
        <div className="df-compare-scale"><span>Antes</span><ScaleChoice value={confidenceBefore} onChange={setConfidenceBefore} min={1} max={5} label="Confiança antes" compact /></div>
        <div className="df-compare-scale"><span>Depois</span><ScaleChoice value={confidenceAfter} onChange={setConfidenceAfter} min={1} max={5} label="Confiança depois" compact /></div>
      </FormSection>

      <section className="df-review-slip">
        <div><Repeat size={19} /><span><strong>Bilhete de revisão</strong><small>deixe uma ponte para o próximo contato</small></span></div>
        <SegmentedChoice
          label="Estado da revisão"
          value={reviewState}
          onChange={setReviewState}
          columns={2}
          options={[
            { value: "scheduled", label: "Agendar" },
            { value: "already_reviewed", label: "Já revisei" },
            { value: "not_needed_confirmed", label: "Não precisa" },
            { value: "undecided", label: "Decidir depois" },
          ]}
        />
        {reviewState !== "not_needed_confirmed" ? <Field label="Próxima revisão"><KeyboardInput type="date" value={nextReviewDate} onChange={(event) => setNextReviewDate(event.target.value)} /></Field> : null}
        <Field label="Erro, dúvida ou síntese"><KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Uma frase que ajude o Bauer de amanhã" /></Field>
      </section>
      <SaveFooter
        busy={busy}
        disabled={disabled || Boolean(validationIssue)}
        error={error || (hasMeaningfulValue ? validationIssue : null)}
        label="Salvar sessão"
        icon={GraduationCap}
      />
    </form>
  );
}

type MedicationMode = "regimen" | "stock" | "sos";

function MedicationForm({ onSaved, localDate, disabled, initialMode }: FormProps) {
  const supplementalModeLocked =
    initialMode === "medication-stock" || initialMode === "medication-sos";
  const [mode, setMode] = useState<MedicationMode>(() =>
    initialMode === "medication-stock"
      ? "stock"
      : initialMode === "medication-sos"
        ? "sos"
        : "regimen",
  );
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [form, setForm] = useState("");
  const [schedule, setSchedule] = useState("");
  const [regimenStatus, setRegimenStatus] = useState<string | null>(null);
  const [stockQuantity, setStockQuantity] = useState("");
  const [stockUnit, setStockUnit] = useState("");
  const [refillAt, setRefillAt] = useState("");
  const [sosUseConfirmed, setSosUseConfirmed] = useState<boolean | null>(null);
  const [sosReason, setSosReason] = useState("");
  const [sosTime, setSosTime] = useState("");
  const [sosResponse, setSosResponse] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const { busy, error, save } = useSaveRequest(onSaved);

  const stockQuantityKnowledge = mode === "stock"
    ? numberKnowledge(stockQuantity, { min: 0 })
    : notApplicable<number>(`${mode}_record`);
  const refillAtKnowledge = mode === "stock"
    ? numberKnowledge(refillAt, { min: 0 })
    : notApplicable<number>(`${mode}_record`);
  const sosTimeKnowledge = mode === "sos"
    ? localTimeKnowledge(sosTime)
    : notApplicable<string>(`${mode}_record`);
  const sosUseKnowledge = medicationSosUseKnowledge(mode, sosUseConfirmed);
  const validationIssue = firstValidationIssue(true, [
    knowledgeValidationIssue("Quantidade em estoque", stockQuantityKnowledge),
    knowledgeValidationIssue("Limite de reposição", refillAtKnowledge),
    temporalValidationIssue("Horário do uso SOS", sosTimeKnowledge),
    medicationSosConfirmationIssue(mode, sosUseConfirmed),
  ]);
  const hasModeDetail = mode === "stock"
    ? Boolean(stockQuantity.trim() || refillAt.trim() || stockUnit.trim() || note.trim())
    : mode === "sos"
      ? sosUseConfirmed === true
      : Boolean(dose.trim() || form.trim() || schedule.trim() || regimenStatus || note.trim());

  const handleSave = () => {
    if (mode === "sos" && sosUseConfirmed !== true) return;
    const modeIs = (candidate: MedicationMode) => mode === candidate;
    const payload: MedicationDetailPayload = {
      schema: "medication-detail-v1",
      eventKind: mode === "regimen" ? "medication-regimen" : mode === "stock" ? "medication-stock" : "medication-sos",
      recordMode: mode,
      medicationName: textKnowledge(name),
      dose: modeIs("stock") ? notApplicable("stock_record") : textKnowledge(dose),
      form: modeIs("sos") ? unknown("not_recorded") : textKnowledge(form),
      schedule: modeIs("regimen") ? textKnowledge(schedule) : notApplicable(`${mode}_record`),
      regimenStatus: modeIs("regimen") && regimenStatus ? known(regimenStatus) : modeIs("regimen") ? unknown("not_confirmed") : notApplicable(`${mode}_record`),
      stock: {
        quantity: stockQuantityKnowledge,
        unit: modeIs("stock") ? textKnowledge(stockUnit) : notApplicable(`${mode}_record`),
        refillAt: refillAtKnowledge,
      },
      sos: {
        useConfirmed: sosUseKnowledge,
        reason: modeIs("sos") ? textKnowledge(sosReason) : notApplicable(`${mode}_record`),
        takenAtLocal: sosTimeKnowledge,
        response: modeIs("sos") ? scaleKnowledge(sosResponse) : notApplicable(`${mode}_record`),
      },
      note: textKnowledge(note),
    };
    return save(makeRequest(
      "medicamentos",
      payload,
      "Medication regimen, stock or SOS use explicitly recorded by the user; no recommendation inferred.",
      mode === "regimen" ? "Regime informado salvo" : mode === "stock" ? "Estoque informado salvo" : "Uso SOS informado salvo",
      localDate,
    ));
  };

  return (
    <form className="df-form df-medication" onSubmit={(event) => submitForm(event, handleSave)}>
      <FormIntro domain="medicamentos" />
      <InlineNotice>Este registro organiza apenas o que você informou. Não ajusta dose, horário nem necessidade de uso.</InlineNotice>
      {!supplementalModeLocked ? <nav className="df-drawer-tabs" aria-label="Tipo de registro de medicação">
        {([
          ["regimen", "Regime", Pill],
          ["stock", "Estoque", Package],
          ["sos", "Uso SOS", Pulse],
        ] as const).map(([value, label, IconComponent]) => (
          <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>
            <IconComponent size={18} weight="duotone" />{label}
          </button>
        ))}
      </nav> : null}

      <section className="df-medication-label">
        <span><Pill size={25} weight="duotone" /></span>
        <Field label="Nome exatamente como está na receita/caixa">
          <KeyboardInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Nenhum nome pré-preenchido" autoComplete="off" />
        </Field>
      </section>

      {mode === "regimen" ? (
        <FormSection title="Regime informado" icon={Clock} className="df-regimen-card">
          <div className="df-two-column">
            <Field label="Dose escrita"><KeyboardInput value={dose} onChange={(event) => setDose(event.target.value)} placeholder="Ex.: 50 mg" /></Field>
            <Field label="Apresentação"><KeyboardInput value={form} onChange={(event) => setForm(event.target.value)} placeholder="Ex.: comprimido" /></Field>
          </div>
          <Field label="Horários ou instrução informada"><KeyboardInput value={schedule} onChange={(event) => setSchedule(event.target.value)} placeholder="Copie o regime, sem reinterpretar" /></Field>
          <SegmentedChoice
            label="Situação do regime"
            value={regimenStatus}
            onChange={setRegimenStatus}
            columns={2}
            options={[
              { value: "active_confirmed", label: "Ativo", detail: "confirmado por mim" },
              { value: "paused_confirmed", label: "Pausado", detail: "confirmado por mim" },
              { value: "finished_confirmed", label: "Finalizado", detail: "confirmado por mim" },
              { value: "uncertain", label: "Não confirmei", detail: "preciso conferir" },
            ]}
          />
        </FormSection>
      ) : null}

      {mode === "stock" ? (
        <FormSection title="Contagem física" hint="não estimamos consumo sem um regime confirmado" icon={Package} className="df-stock-shelf">
          <div className="df-stock-count">
            <Field label="Quantidade"><KeyboardInput inputMode="decimal" value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} placeholder="—" /></Field>
            <span><Package size={24} /><small>contagem feita agora</small></span>
            <Field label="Unidade"><KeyboardInput value={stockUnit} onChange={(event) => setStockUnit(event.target.value)} placeholder="cp, mL, canetas…" /></Field>
          </div>
          <Field label="Avisar quando restarem" hint="apenas um limite escolhido por você"><KeyboardInput inputMode="decimal" value={refillAt} onChange={(event) => setRefillAt(event.target.value)} placeholder="quantidade" /></Field>
        </FormSection>
      ) : null}

      {mode === "sos" ? (
        <FormSection title="Episódio SOS" hint="registre o uso; não use esta tela para decidir se deve tomar" icon={Pulse} className="df-sos-trace">
          <TriStateChoice
            value={sosUseConfirmed}
            onChange={setSosUseConfirmed}
            label="Você confirma que este uso SOS aconteceu?"
            yes="Sim, usei"
            no="Não aconteceu"
          />
          <InlineNotice>
            Somente “Sim, usei” cria uma ocorrência. Horário e demais detalhes podem permanecer desconhecidos.
          </InlineNotice>
          <div className="df-two-column">
            <Field label="Dose informada"><KeyboardInput value={dose} onChange={(event) => setDose(event.target.value)} placeholder="como foi utilizada" /></Field>
            <Field label="Horário"><KeyboardInput type="time" value={sosTime} onChange={(event) => setSosTime(event.target.value)} /></Field>
          </div>
          <Field label="Motivo registrado"><KeyboardInput value={sosReason} onChange={(event) => setSosReason(event.target.value)} placeholder="sintoma ou contexto" /></Field>
          <div className="df-response-meter"><span>Resposta percebida</span><ScaleChoice value={sosResponse} onChange={setSosResponse} min={0} max={4} label="Resposta percebida" lowLabel="nenhuma" highLabel="muito boa" /></div>
        </FormSection>
      ) : null}

      <Field label="Observação"><KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opcional; vazio não significa ausência" /></Field>
      <SaveFooter
        busy={busy}
        disabled={disabled || !name.trim() || !hasModeDetail || Boolean(validationIssue)}
        error={error || validationIssue}
        label={mode === "regimen" ? "Salvar regime" : mode === "stock" ? "Salvar estoque" : "Salvar uso SOS"}
        icon={Pill}
      />
    </form>
  );
}

function SleepForm({ onSaved, localDate, disabled }: FormProps) {
  const [wentToBed, setWentToBed] = useState("");
  const [sleepOnset, setSleepOnset] = useState("");
  const [finalWake, setFinalWake] = useState("");
  const [leftBed, setLeftBed] = useState("");
  const [awakenings, setAwakenings] = useState("");
  const [awakeMinutes, setAwakeMinutes] = useState("");
  const [napMinutes, setNapMinutes] = useState("");
  const [quality, setQuality] = useState<number | null>(null);
  const [restorative, setRestorative] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const { busy, error, save } = useSaveRequest(onSaved);

  const wentToBedKnowledge = localTimeKnowledge(wentToBed);
  const sleepOnsetKnowledge = localTimeKnowledge(sleepOnset);
  const finalWakeKnowledge = localTimeKnowledge(finalWake);
  const leftBedKnowledge = localTimeKnowledge(leftBed);
  const awakeningsKnowledge = numberKnowledge(awakenings, { min: 0, max: 100, integer: true });
  const awakeMinutesKnowledge = numberKnowledge(awakeMinutes, { min: 0, max: 1_440, integer: true });
  const napMinutesKnowledge = numberKnowledge(napMinutes, { min: 0, max: 1_440, integer: true });
  const hasMeaningfulValue = hasAnyRecordedValue([
    wentToBed,
    sleepOnset,
    finalWake,
    leftBed,
    awakenings,
    awakeMinutes,
    napMinutes,
    quality,
    restorative,
    note,
  ]);
  const validationIssue = firstValidationIssue(hasMeaningfulValue, [
    temporalValidationIssue("Horário de ida para a cama", wentToBedKnowledge),
    temporalValidationIssue("Horário de início do sono", sleepOnsetKnowledge),
    temporalValidationIssue("Horário do despertar", finalWakeKnowledge),
    temporalValidationIssue("Horário de saída da cama", leftBedKnowledge),
    knowledgeValidationIssue("Número de despertares", awakeningsKnowledge),
    knowledgeValidationIssue("Minutos acordado", awakeMinutesKnowledge),
    knowledgeValidationIssue("Minutos de cochilo", napMinutesKnowledge),
    sleepChronologyIssue(
      wentToBed,
      sleepOnset,
      finalWake,
      leftBed,
      awakeMinutesKnowledge,
    ),
  ]);

  const handleSave = () => {
    const payload: SleepChronologyPayload = {
      schema: "sleep-chronology-v1",
      eventKind: "sleep-chronology",
      chronology: {
        wentToBedLocal: wentToBedKnowledge,
        sleepOnsetLocal: sleepOnsetKnowledge,
        finalWakeLocal: finalWakeKnowledge,
        leftBedLocal: leftBedKnowledge,
      },
      awakenings: awakeningsKnowledge,
      awakeMinutes: awakeMinutesKnowledge,
      napMinutes: napMinutesKnowledge,
      perceivedQuality: scaleKnowledge(quality),
      restorative: truthKnowledge(restorative, "not_restorative_confirmed"),
      note: textKnowledge(note),
    };
    return save(makeRequest(
      "sono",
      payload,
      "Sleep chronology explicitly recorded by the user.",
      "Cronologia do sono salva",
      localDate,
    ));
  };

  const timeline = [
    { label: "Fui para a cama", value: wentToBed, setter: setWentToBed, icon: Bed },
    { label: "Acho que dormi", value: sleepOnset, setter: setSleepOnset, icon: Moon },
    { label: "Despertar final", value: finalWake, setter: setFinalWake, icon: SunHorizon },
    { label: "Saí da cama", value: leftBed, setter: setLeftBed, icon: ArrowRight },
  ] as const;

  return (
    <form className="df-form df-sleep" onSubmit={(event) => submitForm(event, handleSave)}>
      <FormIntro domain="sono" />
      <section className="df-night-track" aria-label="Cronologia da noite">
        <div className="df-night-sky"><Moon size={22} weight="fill" /><span>noite</span><i /><SunHorizon size={23} weight="duotone" /><span>manhã</span></div>
        <ol>
          {timeline.map(({ label, value, setter, icon: IconComponent }, index) => (
            <li key={label}>
              <span className="df-night-node"><IconComponent size={16} weight="duotone" /></span>
              <Field label={`${index + 1}. ${label}`}>
                <KeyboardInput type="time" value={value} onChange={(event) => setter(event.target.value)} />
              </Field>
            </li>
          ))}
        </ol>
      </section>

      <FormSection title="Interrupções" hint="conte o que lembrar; não preencher não vira zero" icon={Clock} className="df-awakening-ledger">
        <div className="df-two-column">
          <Field label="Número de despertares"><KeyboardInput inputMode="numeric" value={awakenings} onChange={(event) => setAwakenings(event.target.value)} placeholder="—" /></Field>
          <Field label="Minutos acordado ao todo"><KeyboardInput inputMode="numeric" value={awakeMinutes} onChange={(event) => setAwakeMinutes(event.target.value)} placeholder="—" /></Field>
        </div>
        <Field label="Cochilos durante o dia (min)"><KeyboardInput inputMode="numeric" value={napMinutes} onChange={(event) => setNapMinutes(event.target.value)} placeholder="—" /></Field>
      </FormSection>

      <section className="df-sleep-verdict">
        <div><Gauge size={19} /><span><strong>Leitura subjetiva</strong><small>não substitui a cronologia</small></span></div>
        <span className="df-scale-label">Qualidade percebida</span>
        <ScaleChoice value={quality} onChange={setQuality} min={1} max={5} label="Qualidade do sono" lowLabel="muito ruim" highLabel="excelente" />
        <span className="df-scale-label">Acordou restaurado?</span>
        <TriStateChoice value={restorative} onChange={setRestorative} label="Sono restaurador" yes="Sim" no="Não" />
      </section>

      <Field label="Contexto da noite"><KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Despertar, ambiente, sonhos, desconforto…" /></Field>
      <SaveFooter
        busy={busy}
        disabled={disabled || Boolean(validationIssue)}
        error={error || (hasMeaningfulValue ? validationIssue : null)}
        label="Salvar noite"
        icon={Moon}
      />
    </form>
  );
}

const MEAL_TYPES = ["Café da manhã", "Lanche", "Almoço", "Jantar", "Ceia"] as const;
type NutritionMode = "meal" | "omission" | "hydration";

function NutritionForm({ onSaved, localDate, disabled }: FormProps) {
  const [mode, setMode] = useState<NutritionMode>("meal");
  const [mealKind, setMealKind] = useState<string | null>(null);
  const [mealTime, setMealTime] = useState("");
  const [composition, setComposition] = useState("");
  const [context, setContext] = useState<string | null>(null);
  const [omissionContext, setOmissionContext] = useState("");
  const [waterMl, setWaterMl] = useState("");
  const [caffeineServings, setCaffeineServings] = useState("");
  const [caffeineLastUse, setCaffeineLastUse] = useState("");
  const [hunger, setHunger] = useState<number | null>(null);
  const [fullness, setFullness] = useState<number | null>(null);
  const { busy, error, save } = useSaveRequest(onSaved);

  const mealTimeKnowledge = mode === "meal"
    ? localTimeKnowledge(mealTime)
    : notApplicable<string>(`${mode}_record`);
  const waterKnowledge = numberKnowledge(waterMl, { min: 0, max: 20_000, integer: true });
  const caffeineServingsKnowledge = numberKnowledge(caffeineServings, { min: 0, max: 100 });
  const caffeineLastUseKnowledge = localTimeKnowledge(caffeineLastUse);
  const hasMeaningfulValue = mode === "omission" || hasAnyRecordedValue([
    mealKind,
    mealTime,
    composition,
    context,
    waterMl,
    caffeineServings,
    caffeineLastUse,
    hunger,
    fullness,
    omissionContext,
  ]);
  const validationIssue = firstValidationIssue(hasMeaningfulValue, [
    mode === "meal" && !mealKind ? "Selecione qual refeição foi realizada." : null,
    temporalValidationIssue("Horário da refeição", mealTimeKnowledge),
    knowledgeValidationIssue("Volume de água", waterKnowledge),
    knowledgeValidationIssue("Porções de cafeína", caffeineServingsKnowledge),
    temporalValidationIssue("Horário da cafeína", caffeineLastUseKnowledge),
  ]);

  const handleSave = () => {
    const mealRecord = mode === "meal";
    const notMeal = <T,>(): Knowledge<T> => notApplicable<T>(`${mode}_record`);
    const payload: NutritionLogPayload = {
      schema: "nutrition-log-v1",
      eventKind: "nutrition-log",
      recordMode: mode,
      meal: {
        presence: mealRecord
          ? known(true)
          : mode === "omission"
            ? confirmedAbsent("meal_omitted_confirmed")
            : notMeal<boolean>(),
        kind: mealRecord && mealKind ? known(mealKind) : notMeal<string>(),
        timeLocal: mealTimeKnowledge,
        composition: mealRecord ? textKnowledge(composition) : notMeal<string>(),
        context: mealRecord && context ? known(context) : mealRecord ? unknown("not_recorded") : notMeal<string>(),
      },
      omissionContext: mode === "omission"
        ? textKnowledge(omissionContext)
        : notApplicable<string>(`${mode}_record`),
      hydration: {
        amountMl: waterKnowledge,
        measurement: "increment",
      },
      waterMl: waterKnowledge,
      caffeine: {
        servings: caffeineServingsKnowledge,
        lastUseLocal: caffeineLastUseKnowledge,
      },
      hungerBefore: mealRecord ? scaleKnowledge(hunger) : notMeal<number>(),
      fullnessAfter: mealRecord ? scaleKnowledge(fullness) : notMeal<number>(),
    };
    return save(makeRequest(
      "alimentacao",
      payload,
      "Meal presence/omission and hydration increments explicitly recorded by the user.",
      mode === "meal" ? "Refeição registrada" : mode === "omission" ? "Omissão confirmada" : "Hidratação/cafeína registrada",
      localDate,
    ));
  };

  return (
    <form className="df-form df-nutrition" onSubmit={(event) => submitForm(event, handleSave)}>
      <FormIntro domain="alimentacao" />
      <nav className="df-drawer-tabs" aria-label="Tipo de registro alimentar">
        <button type="button" aria-pressed={mode === "meal"} onClick={() => setMode("meal")}><ForkKnife size={18} weight="duotone" />Refeição</button>
        <button type="button" aria-pressed={mode === "omission"} onClick={() => setMode("omission")}><WarningCircle size={18} weight="duotone" />Omissão</button>
        <button type="button" aria-pressed={mode === "hydration"} onClick={() => setMode("hydration")}><Drop size={18} weight="duotone" />Água/cafeína</button>
      </nav>

      {mode === "omission" ? (
        <FormSection title="Refeição omitida" hint="isso exige sua confirmação; vazio nunca vira omissão" icon={WarningCircle}>
          <Field label="Contexto opcional"><KeyboardTextarea value={omissionContext} onChange={(event) => setOmissionContext(event.target.value)} placeholder="Ex.: plantão, falta de tempo, indisposição…" /></Field>
        </FormSection>
      ) : null}

      {mode === "meal" ? <section className="df-meal-tray">
        <div className="df-tray-header"><ForkKnife size={20} weight="duotone" /><strong>Refeição</strong><Field label="Horário"><KeyboardInput type="time" value={mealTime} onChange={(event) => setMealTime(event.target.value)} /></Field></div>
        <div className="df-meal-types" role="group" aria-label="Tipo de refeição">
          {MEAL_TYPES.map((meal) => <button type="button" key={meal} aria-pressed={mealKind === meal} onClick={() => setMealKind(meal)}>{meal}</button>)}
        </div>
        <Field label="O que compôs a refeição" hint="descrição livre, sem classificação automática">
          <KeyboardTextarea value={composition} onChange={(event) => setComposition(event.target.value)} placeholder="Ex.: arroz, feijão, frango, salada…" />
        </Field>
        <SegmentedChoice
          label="Contexto da refeição"
          value={context}
          onChange={setContext}
          columns={2}
          options={[
            { value: "planned", label: "Planejada" },
            { value: "rushed", label: "Com pressa" },
            { value: "social", label: "Social" },
            { value: "impulsive", label: "Impulsiva" },
          ]}
        />
      </section> : null}

      {mode === "meal" ? <section className="df-appetite-balance">
        <div className="df-compare-scale"><span>Fome antes</span><ScaleChoice value={hunger} onChange={setHunger} min={0} max={5} label="Fome antes" compact /></div>
        <div className="df-balance-line"><i /><ForkKnife size={16} /><i /></div>
        <div className="df-compare-scale"><span>Saciedade depois</span><ScaleChoice value={fullness} onChange={setFullness} min={0} max={5} label="Saciedade depois" compact /></div>
      </section> : null}

      <div className="df-fluid-cards">
        <section className="df-fluid-card df-water-card">
          <Drop size={25} weight="duotone" />
          <span><strong>Água adicionada</strong><small>incremento deste registro</small></span>
          <Field label="mL agora"><KeyboardInput inputMode="numeric" value={waterMl} onChange={(event) => setWaterMl(event.target.value)} placeholder="—" /></Field>
        </section>
        <section className="df-fluid-card df-coffee-card">
          <Coffee size={25} weight="duotone" />
          <span><strong>Cafeína</strong><small>café/energético</small></span>
          <Field label="Porções"><KeyboardInput inputMode="numeric" value={caffeineServings} onChange={(event) => setCaffeineServings(event.target.value)} placeholder="—" /></Field>
          <Field label="Último uso"><KeyboardInput type="time" value={caffeineLastUse} onChange={(event) => setCaffeineLastUse(event.target.value)} /></Field>
        </section>
      </div>
      <SaveFooter
        busy={busy}
        disabled={disabled || Boolean(validationIssue)}
        error={error || (hasMeaningfulValue ? validationIssue : null)}
        label={mode === "meal" ? "Salvar refeição" : mode === "omission" ? "Confirmar omissão" : "Salvar água/cafeína"}
        icon={ForkKnife}
      />
    </form>
  );
}

const MOOD_METRICS: readonly {
  key: MoodMetricKey;
  label: string;
  low: string;
  high: string;
  min: number;
  max: number;
}[] = [
  { key: "mood", label: "Humor", low: "muito baixo", high: "muito elevado", min: -2, max: 2 },
  { key: "energy", label: "Energia", low: "sem energia", high: "muito alta", min: 0, max: 4 },
  { key: "anxiety", label: "Ansiedade", low: "nenhuma", high: "muito intensa", min: 0, max: 4 },
  { key: "irritability", label: "Irritabilidade", low: "nenhuma", high: "muito intensa", min: 0, max: 4 },
  { key: "impulsivity", label: "Impulsividade", low: "nenhuma", high: "muito intensa", min: 0, max: 4 },
  { key: "thoughtSpeed", label: "Velocidade do pensamento", low: "mais lento", high: "acelerado", min: -2, max: 2 },
  { key: "function", label: "Funcionamento", low: "não consegui", high: "funcionei bem", min: 0, max: 4 },
];

const PROTECTIVE_FACTORS = [
  "Pessoa de confiança",
  "Acompanhamento profissional",
  "Ambiente seguro",
  "Rotina ou compromisso",
  "Fé, valores ou propósito",
  "Animal de estimação",
] as const;

function MoodForm({ onSaved, localDate, disabled }: FormProps) {
  const [metrics, setMetrics] = useState<MoodMetricState>({
    mood: null,
    energy: null,
    anxiety: null,
    irritability: null,
    impulsivity: null,
    thoughtSpeed: null,
    function: null,
  });
  const [perceivedSleepNeed, setPerceivedSleepNeed] = useState<PerceivedSleepNeed | null>(null);
  const [perceivedBaselineChange, setPerceivedBaselineChange] = useState<PerceivedBaselineChange | null>(null);
  const [protectiveFactors, setProtectiveFactors] = useState<Set<string>>(() => new Set());
  const [protectiveFactorsNote, setProtectiveFactorsNote] = useState("");
  const [medicationChangeConfirmed, setMedicationChangeConfirmed] = useState<boolean | null>(null);
  const [medicationChangeNote, setMedicationChangeNote] = useState("");
  const [safeNow, setSafeNow] = useState<boolean | null>(null);
  const [context, setContext] = useState("");
  const { busy, error, save } = useSaveRequest(onSaved);

  const moodKnowledge = rangedScaleKnowledge(metrics.mood, -2, 2);
  const energyKnowledge = rangedScaleKnowledge(metrics.energy, 0, 4);
  const anxietyKnowledge = rangedScaleKnowledge(metrics.anxiety, 0, 4);
  const irritabilityKnowledge = rangedScaleKnowledge(metrics.irritability, 0, 4);
  const impulsivityKnowledge = rangedScaleKnowledge(metrics.impulsivity, 0, 4);
  const thoughtSpeedKnowledge = rangedScaleKnowledge(metrics.thoughtSpeed, -2, 2);
  const functionKnowledge = rangedScaleKnowledge(metrics.function, 0, 4);
  const hasMeaningfulValue = hasAnyRecordedValue([
    ...Object.values(metrics),
    perceivedSleepNeed,
    perceivedBaselineChange,
    protectiveFactors,
    protectiveFactorsNote,
    medicationChangeConfirmed,
    medicationChangeNote,
    safeNow,
    context,
  ]);
  const validationIssue = firstValidationIssue(hasMeaningfulValue, [
    knowledgeValidationIssue("Humor", moodKnowledge),
    knowledgeValidationIssue("Energia", energyKnowledge),
    knowledgeValidationIssue("Ansiedade", anxietyKnowledge),
    knowledgeValidationIssue("Irritabilidade", irritabilityKnowledge),
    knowledgeValidationIssue("Impulsividade", impulsivityKnowledge),
    knowledgeValidationIssue("Velocidade do pensamento", thoughtSpeedKnowledge),
    knowledgeValidationIssue("Funcionamento", functionKnowledge),
  ]);

  const handleSave = () => {
    const payload = buildMoodFunctionalPayload({
      metrics,
      perceivedSleepNeed,
      perceivedBaselineChange,
      protectiveFactors: [...protectiveFactors],
      protectiveFactorsNote,
      medicationChangeConfirmed,
      medicationChangeNote,
      safeNow,
      context,
    });
    return save(makeRequest(
      "humor",
      payload,
      "Mood and functional dimensions explicitly recorded by the user without diagnostic inference.",
      "Check-in de humor salvo",
      localDate,
    ));
  };

  return (
    <form className="df-form df-mood" onSubmit={(event) => submitForm(event, handleSave)}>
      <FormIntro domain="humor" />
      <InlineNotice tone="blue">Este painel descreve o momento em escalas funcionais próprias. Energia aqui é 0–4; o check-in rápido de Hoje é 1–5 e permanece em uma série separada. Nada diagnostica depressão, mania ou hipomania, nem altera medicação.</InlineNotice>
      <section className="df-mood-matrix">
        <header><Brain size={21} weight="duotone" /><span><strong>Leitura do agora</strong><small>toque somente no que consegue avaliar</small></span></header>
        {MOOD_METRICS.map((metric) => (
          <div className="df-mood-row" key={metric.key}>
            <span><strong>{metric.label}</strong><small>{metric.low} ↔ {metric.high}</small></span>
            <ScaleChoice
              value={metrics[metric.key]}
              onChange={(value) => setMetrics((current) => ({ ...current, [metric.key]: value }))}
              min={metric.min}
              max={metric.max}
              label={metric.label}
              compact
            />
          </div>
        ))}
      </section>
      <FormSection
        title="Mudanças percebidas"
        hint="comparações pessoais, sem classificação automática"
        icon={Moon}
      >
        <div className="df-two-column">
          <Field label="Necessidade de sono agora" hint="comparada ao seu habitual">
            <select
              value={perceivedSleepNeed ?? ""}
              onChange={(event) => setPerceivedSleepNeed(
                event.target.value ? event.target.value as PerceivedSleepNeed : null,
              )}
            >
              <option value="">Não registrei</option>
              <option value="less_than_usual">Menor que o habitual</option>
              <option value="usual">Parecida com o habitual</option>
              <option value="more_than_usual">Maior que o habitual</option>
            </select>
          </Field>
          <Field label="Mudança em relação ao seu basal" hint="sua percepção do estado geral">
            <select
              value={perceivedBaselineChange ?? ""}
              onChange={(event) => setPerceivedBaselineChange(
                event.target.value ? event.target.value as PerceivedBaselineChange : null,
              )}
            >
              <option value="">Não registrei</option>
              <option value="below_usual">Abaixo do habitual</option>
              <option value="usual">Sem mudança percebida</option>
              <option value="above_usual">Acima do habitual</option>
              <option value="different_unclear">Mudou de outro modo</option>
            </select>
          </Field>
        </div>
      </FormSection>
      <FormSection
        title="Apoios presentes"
        hint="marque apenas o que você percebe como apoio agora"
        icon={ShieldCheck}
      >
        <TagPicker
          selected={protectiveFactors}
          onChange={setProtectiveFactors}
          options={PROTECTIVE_FACTORS}
          label="Fatores protetores percebidos"
        />
        <Field label="Outro apoio ou detalhe (opcional)">
          <KeyboardTextarea
            value={protectiveFactorsNote}
            onChange={(event) => setProtectiveFactorsNote(event.target.value)}
            placeholder="Pessoa, lugar, compromisso ou estratégia que está ajudando…"
          />
        </Field>
      </FormSection>
      <FormSection
        title="Fatos desde o último registro"
        hint="o app não deduz nem recomenda mudanças"
        icon={Pill}
      >
        <TriStateChoice
          value={medicationChangeConfirmed}
          onChange={setMedicationChangeConfirmed}
          label="Mudança de medicamento, dose ou horário confirmada por você"
          yes="Sim, eu confirmo"
          no="Não houve"
        />
        {medicationChangeConfirmed === true ? (
          <Field label="O que você confirma que mudou?" hint="transcrição livre; não é orientação do app">
            <KeyboardTextarea
              value={medicationChangeNote}
              onChange={(event) => setMedicationChangeNote(event.target.value)}
              placeholder="Descreva somente o que ocorreu…"
            />
          </Field>
        ) : null}
      </FormSection>
      <FormSection
        title="Segurança neste momento"
        hint="resposta opcional e informada por você"
        icon={ShieldCheck}
      >
        <TriStateChoice
          value={safeNow}
          onChange={setSafeNow}
          label="Sinto-me seguro agora"
          yes="Sim"
          no="Não"
        />
        {safeNow === false ? (
          <InlineNotice tone="red">
            Você marcou que não se sente seguro agora. Este app não monitora você, não envia alertas e não substitui ajuda humana. Entre em contato agora com alguém de confiança ou com um profissional de saúde. Se houver perigo imediato, não fique sozinho e procure um serviço de urgência ou emergência da sua região.
          </InlineNotice>
        ) : null}
      </FormSection>
      <section className="df-function-note">
        <Lightbulb size={20} weight="duotone" />
        <Field label="O que ajuda a interpretar estes números?">
          <KeyboardTextarea value={context} onChange={(event) => setContext(event.target.value)} placeholder="Sono, acontecimentos, uso de substâncias, pressão acadêmica, gastos…" />
        </Field>
      </section>
      <SaveFooter
        busy={busy}
        disabled={disabled || Boolean(validationIssue)}
        error={error || (hasMeaningfulValue ? validationIssue : null)}
        label="Salvar fotografia do momento"
        icon={Brain}
      />
    </form>
  );
}

const HEADACHE_LOCATIONS = ["Frontal", "Temporal D", "Temporal E", "Retro-orbitária", "Occipital", "Difusa", "Face"] as const;
const HEADACHE_QUALITIES = ["Pulsátil", "Pressão", "Pontada", "Queimação", "Choque"] as const;
const HEADACHE_SYMPTOMS = ["Náusea", "Vômito", "Fotofobia", "Fonofobia", "Aura", "Lacrimejamento", "Parestesia"] as const;
const HEADACHE_TRIGGERS = ["Pouco sono", "Estresse", "Jejum", "Cafeína", "Bruxismo", "Tela", "Odor", "Desidratação"] as const;

function HeadacheForm({ onSaved, localDate, disabled }: FormProps) {
  const [presence, setPresence] = useState<boolean | null>(null);
  const [absenceScope, setAbsenceScope] = useState<"moment" | "full-day" | null>(null);
  const [onset, setOnset] = useState("");
  const [ended, setEnded] = useState("");
  const [currentIntensity, setCurrentIntensity] = useState<number | null>(null);
  const [peakIntensity, setPeakIntensity] = useState<number | null>(null);
  const [locations, setLocations] = useState<Set<string>>(() => new Set());
  const [qualities, setQualities] = useState<Set<string>>(() => new Set());
  const [symptoms, setSymptoms] = useState<Set<string>>(() => new Set());
  const [triggers, setTriggers] = useState<Set<string>>(() => new Set());
  const [disabilityMinutes, setDisabilityMinutes] = useState("");
  const [acuteMedicationUsed, setAcuteMedicationUsed] = useState<boolean | null>(null);
  const [rescueUsed, setRescueUsed] = useState("");
  const [response, setResponse] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const { busy, error, save } = useSaveRequest(onSaved);

  const crisisKnowledge = <T,>(value: Knowledge<T>): Knowledge<T> => presence === false
    ? notApplicable("headache_absence_confirmed")
    : value;
  const onsetKnowledge = crisisKnowledge(localTimeKnowledge(onset));
  const endedKnowledge = crisisKnowledge(localTimeKnowledge(ended));
  const currentIntensityKnowledge = crisisKnowledge(rangedScaleKnowledge(currentIntensity, 0, 10));
  const peakIntensityKnowledge = crisisKnowledge(rangedScaleKnowledge(peakIntensity, 0, 10));
  const responseKnowledge = crisisKnowledge(rangedScaleKnowledge(response, 0, 4));
  const disabilityKnowledge = crisisKnowledge(numberKnowledge(disabilityMinutes, {
    min: 0,
    max: 1_440,
    integer: true,
  }));
  const acuteMedicationKnowledge = crisisKnowledge(
    truthKnowledge(acuteMedicationUsed, "acute_medication_not_used_confirmed"),
  );
  const hasCrisisDetails = hasAnyRecordedValue([
    onset,
    ended,
    currentIntensity,
    peakIntensity,
    locations,
    qualities,
    symptoms,
    triggers,
    disabilityMinutes,
    acuteMedicationUsed,
    rescueUsed,
    response,
    note,
  ]);
  const hasMeaningfulValue = presence !== null || hasCrisisDetails;
  const validationIssue = firstValidationIssue(hasMeaningfulValue, [
    presence === false && absenceScope === null
      ? "Informe se a ausência vale apenas para este momento ou para o dia inteiro."
      : null,
    headacheDetailsIssue(presence, hasCrisisDetails),
    temporalValidationIssue("Horário de início", onsetKnowledge),
    temporalValidationIssue("Horário de término", endedKnowledge),
    knowledgeValidationIssue("Intensidade atual", currentIntensityKnowledge),
    knowledgeValidationIssue("Pico de intensidade", peakIntensityKnowledge),
    knowledgeValidationIssue("Resposta ao resgate", responseKnowledge),
    knowledgeValidationIssue("Minutos de incapacidade", disabilityKnowledge),
  ]);

  const handleSave = () => {
    const payload: HeadacheCrisisPayload = {
      schema: "headache-crisis-v1",
      eventKind: "headache-crisis",
      presence: truthKnowledge(presence, "headache_absence_confirmed"),
      observationScope: presence === false && absenceScope
        ? known(absenceScope)
        : presence === false
          ? unknown("not_confirmed")
          : notApplicable("headache_present"),
      onsetLocal: onsetKnowledge,
      endedLocal: endedKnowledge,
      intensityCurrent: currentIntensityKnowledge,
      intensityPeak: peakIntensityKnowledge,
      locations: crisisKnowledge(arrayKnowledge(locations)),
      qualities: crisisKnowledge(arrayKnowledge(qualities)),
      associatedSymptoms: crisisKnowledge(arrayKnowledge(symptoms)),
      suspectedTriggers: crisisKnowledge(arrayKnowledge(triggers)),
      disabilityMinutes: disabilityKnowledge,
      acuteMedicationUsed: acuteMedicationKnowledge,
      rescueUsed: crisisKnowledge(textKnowledge(rescueUsed)),
      response: responseKnowledge,
      note: crisisKnowledge(textKnowledge(note)),
    };
    return save(makeRequest(
      "cefaleia",
      payload,
      presence === false
        ? "Headache absence explicitly confirmed by the user."
        : "Headache crisis details explicitly recorded by the user.",
      presence === false
        ? absenceScope === "full-day" ? "Dia sem cefaleia confirmado" : "Ausência neste momento confirmada"
        : "Crise de cefaleia salva",
      localDate,
    ));
  };

  return (
    <form className="df-form df-headache" onSubmit={(event) => submitForm(event, handleSave)}>
      <FormIntro domain="cefaleia" />
      <section className="df-crisis-switch">
        <span><Pulse size={21} weight="duotone" /><strong>Há cefaleia neste registro?</strong></span>
        <TriStateChoice value={presence} onChange={setPresence} label="Presença de cefaleia" yes="Sim" no="Não" />
      </section>
      {presence === false ? (
        <>
          <InlineNotice tone="green">A ausência foi confirmada. Diga o alcance para não transformar um check-in em um dia inteiro sem dor.</InlineNotice>
          <SegmentedChoice
            label="Esta ausência vale para"
            value={absenceScope}
            onChange={(value) => setAbsenceScope(value as "moment" | "full-day")}
            columns={2}
            options={[
              { value: "moment", label: "Este momento", detail: "check-in pontual" },
              { value: "full-day", label: "Dia inteiro", detail: "confirmado por mim" },
            ]}
          />
        </>
      ) : (
        <>
          <section className="df-crisis-trace">
            <div className="df-crisis-times">
              <Field label="Começou"><KeyboardInput type="time" value={onset} onChange={(event) => setOnset(event.target.value)} /></Field>
              <span><i /><Pulse size={19} weight="fill" /><i /></span>
              <Field label="Terminou"><KeyboardInput type="time" value={ended} onChange={(event) => setEnded(event.target.value)} /></Field>
            </div>
            <div className="df-intensity-pair">
              <div><span>Intensidade agora</span><ScaleChoice value={currentIntensity} onChange={setCurrentIntensity} min={0} max={10} label="Intensidade atual" compact /></div>
              <div><span>Pico da crise</span><ScaleChoice value={peakIntensity} onChange={setPeakIntensity} min={0} max={10} label="Pico de intensidade" compact /></div>
            </div>
          </section>

          <FormSection title="Fenótipo percebido" hint="descrição para histórico; não fecha diagnóstico" icon={Stethoscope} className="df-phenotype-map">
            <span className="df-scale-label">Localização</span><TagPicker selected={locations} onChange={setLocations} options={HEADACHE_LOCATIONS} label="Localizações da dor" />
            <span className="df-scale-label">Qualidade</span><TagPicker selected={qualities} onChange={setQualities} options={HEADACHE_QUALITIES} label="Qualidades da dor" />
            <span className="df-scale-label">Sintomas associados</span><TagPicker selected={symptoms} onChange={setSymptoms} options={HEADACHE_SYMPTOMS} label="Sintomas associados" />
          </FormSection>

          <FormSection title="Contexto e resposta" icon={Gauge} className="df-crisis-response">
            <TagPicker selected={triggers} onChange={setTriggers} options={HEADACHE_TRIGGERS} label="Gatilhos suspeitos" />
            <Field label="Minutos de incapacidade" hint="tempo que você percebeu não conseguir manter suas atividades"><KeyboardInput inputMode="numeric" value={disabilityMinutes} onChange={(event) => setDisabilityMinutes(event.target.value)} placeholder="—" /></Field>
            <div>
              <span className="df-scale-label">Houve uso de medicamento agudo?</span>
              <TriStateChoice value={acuteMedicationUsed} onChange={setAcuteMedicationUsed} label="Uso de medicamento agudo" />
            </div>
            <Field label="Medida ou resgate usado" hint="apenas o que você usou; sem sugestão"><KeyboardInput value={rescueUsed} onChange={(event) => setRescueUsed(event.target.value)} placeholder="Ex.: repouso, medicamento informado…" /></Field>
            <span className="df-scale-label">Resposta percebida</span><ScaleChoice value={response} onChange={setResponse} min={0} max={4} label="Resposta ao resgate" lowLabel="nenhuma" highLabel="completa" />
            <Field label="Observações"><KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Evolução, contexto ou algo incomum" /></Field>
          </FormSection>
        </>
      )}
      <SaveFooter
        busy={busy}
        disabled={disabled || Boolean(validationIssue)}
        error={error || (hasMeaningfulValue ? validationIssue : null)}
        label={presence === false ? "Confirmar ausência" : "Salvar traçado da crise"}
        icon={Pulse}
      />
    </form>
  );
}

type BruxismMetricKey = keyof BruxismPeriodPayload;
type BruxismMetricState = Record<BruxismMetricKey, number | null>;

const BRUXISM_METRICS: readonly { key: BruxismMetricKey; label: string }[] = [
  { key: "jawPain", label: "Dor mandibular" },
  { key: "templePain", label: "Dor temporal" },
  { key: "stiffness", label: "Rigidez/cansaço" },
  { key: "dentalSensitivity", label: "Sensibilidade dentária" },
];

const EMPTY_BRUXISM_PERIOD: BruxismMetricState = {
  jawPain: null,
  templePain: null,
  stiffness: null,
  dentalSensitivity: null,
};

function BruxismPeriodPanel({
  period,
  title,
  value,
  onChange,
}: {
  period: "morning" | "evening";
  title: string;
  value: BruxismMetricState;
  onChange: (next: BruxismMetricState) => void;
}) {
  return (
    <section className="df-bruxism-period" data-period={period}>
      <header>{period === "morning" ? <SunHorizon size={20} /> : <Moon size={20} />}<strong>{title}</strong></header>
      {BRUXISM_METRICS.map((metric) => (
        <div key={metric.key}>
          <span>{metric.label}</span>
          <ScaleChoice
            value={value[metric.key]}
            onChange={(nextValue) => onChange({ ...value, [metric.key]: nextValue })}
            min={0}
            max={4}
            label={`${metric.label}, ${title}`}
            compact
          />
        </div>
      ))}
    </section>
  );
}

function bruxismPeriodKnowledge(state: BruxismMetricState): BruxismPeriodPayload {
  return {
    jawPain: rangedScaleKnowledge(state.jawPain, 0, 4),
    templePain: rangedScaleKnowledge(state.templePain, 0, 4),
    stiffness: rangedScaleKnowledge(state.stiffness, 0, 4),
    dentalSensitivity: rangedScaleKnowledge(state.dentalSensitivity, 0, 4),
  };
}

function morningSymptomsKnowledge(state: BruxismMetricState): Knowledge<boolean> {
  const recorded = Object.values(state).filter((value): value is number => value !== null);
  if (recorded.some((value) => value > 0)) return known(true, "derived");
  return recorded.length === Object.keys(state).length
    ? confirmedAbsent("all_morning_symptom_scales_zero")
    : unknown("not_recorded");
}

function BruxismForm({ onSaved, localDate, disabled }: FormProps) {
  const [activePeriod, setActivePeriod] = useState<"morning" | "evening">("morning");
  const [morning, setMorning] = useState<BruxismMetricState>(() => ({ ...EMPTY_BRUXISM_PERIOD }));
  const [evening, setEvening] = useState<BruxismMetricState>(() => ({ ...EMPTY_BRUXISM_PERIOD }));
  const [daytimeClenching, setDaytimeClenching] = useState<boolean | null>(null);
  const [grindingReported, setGrindingReported] = useState<boolean | null>(null);
  const [guardUsed, setGuardUsed] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const { busy, error, save } = useSaveRequest(onSaved);

  const morningKnowledge = bruxismPeriodKnowledge(morning);
  const eveningKnowledge = bruxismPeriodKnowledge(evening);
  const guardKnowledge = truthKnowledge(guardUsed, "guard_not_used_confirmed");
  const hasMeaningfulValue = hasAnyRecordedValue([
    ...Object.values(morning),
    ...Object.values(evening),
    daytimeClenching,
    grindingReported,
    guardUsed,
    note,
  ]);
  const validationIssue = firstValidationIssue(hasMeaningfulValue, [
    ...Object.entries(morningKnowledge).map(([label, value]) => knowledgeValidationIssue(`Sintoma matinal ${label}`, value)),
    ...Object.entries(eveningKnowledge).map(([label, value]) => knowledgeValidationIssue(`Sintoma noturno ${label}`, value)),
  ]);

  const handleSave = () => {
    const payload: BruxismAmPmPayload = {
      schema: "bruxism-am-pm-v1",
      eventKind: "bruxism-am-pm",
      morning: morningKnowledge,
      evening: eveningKnowledge,
      daytimeClenching: truthKnowledge(daytimeClenching, "daytime_clenching_absent_confirmed"),
      grindingReported: truthKnowledge(grindingReported, "grinding_not_reported_confirmed"),
      guardUsed: guardKnowledge,
      splintUsed: guardKnowledge,
      morningSymptoms: morningSymptomsKnowledge(morning),
      note: textKnowledge(note),
    };
    return save(makeRequest(
      "bruxismo",
      payload,
      "Morning and evening bruxism dimensions explicitly recorded by the user.",
      "Espelho do bruxismo salvo",
      localDate,
    ));
  };

  const activeValue = activePeriod === "morning" ? morning : evening;
  const updateActive = activePeriod === "morning" ? setMorning : setEvening;

  return (
    <form className="df-form df-bruxism" onSubmit={(event) => submitForm(event, handleSave)}>
      <FormIntro domain="bruxismo" />
      <section className="df-am-pm-mirror">
        <header>
          <button type="button" aria-pressed={activePeriod === "morning"} onClick={() => setActivePeriod("morning")}><SunHorizon size={19} />Ao acordar</button>
          <span><Tooth size={26} weight="duotone" /><i /></span>
          <button type="button" aria-pressed={activePeriod === "evening"} onClick={() => setActivePeriod("evening")}><Moon size={19} />Fim do dia</button>
        </header>
        <BruxismPeriodPanel
          period={activePeriod}
          title={activePeriod === "morning" ? "Ao acordar" : "Fim do dia"}
          value={activeValue}
          onChange={updateActive}
        />
        <div className="df-am-pm-preview" aria-label="Progresso manhã e noite">
          <span><SunHorizon size={15} /><small>{Object.values(morning).filter((value) => value !== null).length}/4 respondidos</small></span>
          <i />
          <span><Moon size={15} /><small>{Object.values(evening).filter((value) => value !== null).length}/4 respondidos</small></span>
        </div>
      </section>

      <FormSection title="Sinais observáveis" hint="responda sim/não somente quando tiver certeza" icon={Tooth} className="df-bruxism-truths">
        <div><span>Percebi aperto durante o dia</span><TriStateChoice value={daytimeClenching} onChange={setDaytimeClenching} label="Aperto diurno" /></div>
        <div><span>Alguém relatou ranger à noite</span><TriStateChoice value={grindingReported} onChange={setGrindingReported} label="Ranger relatado" /></div>
        <div><span>Usei placa neste período</span><TriStateChoice value={guardUsed} onChange={setGuardUsed} label="Uso de placa" /></div>
      </FormSection>

      <Field label="Contexto"><KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Estresse, despertar, mastigação, dor de cabeça…" /></Field>
      <SaveFooter
        busy={busy}
        disabled={disabled || Boolean(validationIssue)}
        error={error || (hasMeaningfulValue ? validationIssue : null)}
        label="Salvar comparação AM/PM"
        icon={Tooth}
      />
    </form>
  );
}

type FinanceMode = "transaction" | "debt" | "subscription";

function FinanceForm({ onSaved, localDate, disabled, initialMode }: FormProps) {
  const supplementalModeLocked = initialMode === "finance-subscription";
  const [mode, setMode] = useState<FinanceMode>(() =>
    initialMode === "finance-subscription" ? "subscription" : "transaction",
  );
  const [institutionChoice, setInstitutionChoice] = useState<string | null>(null);
  const [otherInstitution, setOtherInstitution] = useState("");
  const [direction, setDirection] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [creditor, setCreditor] = useState("");
  const [outstanding, setOutstanding] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [ratePeriod, setRatePeriod] = useState<string | null>(null);
  const [debtDueDate, setDebtDueDate] = useState("");
  const [minimumPayment, setMinimumPayment] = useState("");
  const [service, setService] = useState("");
  const [subscriptionPrice, setSubscriptionPrice] = useState("");
  const [cadence, setCadence] = useState<string | null>(null);
  const [renewalDate, setRenewalDate] = useState("");
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const { busy, error, save } = useSaveRequest(onSaved);

  const institution = institutionChoice === "Outro informado"
    ? textKnowledge(otherInstitution)
    : institutionChoice ? known(institutionChoice) : unknown<string>("not_confirmed");

  const transactionMode = mode === "transaction";
  const debtMode = mode === "debt";
  const subscriptionMode = mode === "subscription";
  const amountKnowledge = transactionMode ? moneyKnowledge(amount) : notApplicable<Money>(`${mode}_record`);
  const occurredOnKnowledge = transactionMode ? localDateKnowledge(occurredOn) : notApplicable<string>(`${mode}_record`);
  const outstandingKnowledge = debtMode ? moneyKnowledge(outstanding) : notApplicable<Money>(`${mode}_record`);
  const interestRateKnowledge = debtMode
    ? numberKnowledge(interestRate, { min: 0, max: 100_000 })
    : notApplicable<number>(`${mode}_record`);
  const debtDueDateKnowledge = debtMode ? localDateKnowledge(debtDueDate) : notApplicable<string>(`${mode}_record`);
  const minimumPaymentKnowledge = debtMode ? moneyKnowledge(minimumPayment) : notApplicable<Money>(`${mode}_record`);
  const subscriptionPriceKnowledge = subscriptionMode ? moneyKnowledge(subscriptionPrice) : notApplicable<Money>(`${mode}_record`);
  const renewalDateKnowledge = subscriptionMode ? localDateKnowledge(renewalDate) : notApplicable<string>(`${mode}_record`);
  const modeValues = transactionMode
    ? [direction, amount, category, occurredOn]
    : debtMode
      ? [creditor, outstanding, interestRate, ratePeriod, debtDueDate, minimumPayment]
      : [service, subscriptionPrice, cadence, renewalDate, subscriptionStatus];
  const hasMeaningfulValue = hasAnyRecordedValue([
    institutionChoice,
    institutionChoice === "Outro informado" ? otherInstitution : null,
    note,
    ...modeValues,
  ]);
  const validationIssue = firstValidationIssue(hasMeaningfulValue, [
    otherInstitutionIssue(institutionChoice, otherInstitution),
    knowledgeValidationIssue("Valor da movimentação", amountKnowledge),
    temporalValidationIssue("Data da movimentação", occurredOnKnowledge),
    knowledgeValidationIssue("Saldo devedor", outstandingKnowledge),
    knowledgeValidationIssue("Taxa informada", interestRateKnowledge),
    temporalValidationIssue("Vencimento da dívida", debtDueDateKnowledge),
    knowledgeValidationIssue("Pagamento mínimo", minimumPaymentKnowledge),
    knowledgeValidationIssue("Preço da assinatura", subscriptionPriceKnowledge),
    temporalValidationIssue("Renovação da assinatura", renewalDateKnowledge),
  ]);

  const handleSave = () => {
    const payload: FinanceRecordPayload = {
      schema: "finance-record-v1",
      eventKind: transactionMode ? "finance-transaction" : debtMode ? "finance-debt" : "finance-subscription",
      recordMode: mode,
      institution,
      transaction: {
        direction: transactionMode && direction ? known(direction) : transactionMode ? unknown("not_confirmed") : notApplicable(`${mode}_record`),
        amount: amountKnowledge,
        category: transactionMode ? textKnowledge(category) : notApplicable(`${mode}_record`),
        occurredOn: occurredOnKnowledge,
      },
      debt: {
        creditor: debtMode ? textKnowledge(creditor) : notApplicable(`${mode}_record`),
        outstanding: outstandingKnowledge,
        interestRate: interestRateKnowledge,
        ratePeriod: debtMode && ratePeriod ? known(ratePeriod) : debtMode ? unknown("not_confirmed") : notApplicable(`${mode}_record`),
        dueDate: debtDueDateKnowledge,
        minimumPayment: minimumPaymentKnowledge,
      },
      subscription: {
        service: subscriptionMode ? textKnowledge(service) : notApplicable(`${mode}_record`),
        price: subscriptionPriceKnowledge,
        cadence: subscriptionMode && cadence ? known(cadence) : subscriptionMode ? unknown("not_confirmed") : notApplicable(`${mode}_record`),
        renewalDate: renewalDateKnowledge,
        status: subscriptionMode && subscriptionStatus ? known(subscriptionStatus) : subscriptionMode ? unknown("not_confirmed") : notApplicable(`${mode}_record`),
      },
      note: textKnowledge(note),
    };
    return save(makeRequest(
      "financas",
      payload,
      "Finance fact explicitly recorded by the user; no balance, debt or bank fact inferred.",
      transactionMode ? "Movimentação salva" : debtMode ? "Dívida informada salva" : "Assinatura informada salva",
      transactionMode ? localDateValue(occurredOnKnowledge) ?? localDate : localDate,
    ));
  };

  const modeLabel = mode === "transaction" ? "Movimentação" : mode === "debt" ? "Dívida" : "Assinatura";

  return (
    <form className="df-form df-finance" onSubmit={(event) => submitForm(event, handleSave)}>
      <FormIntro domain="financas" />
      <InlineNotice tone="green">Mercado Pago, Banco do Brasil e PicPay são apenas núcleos confirmados. Nenhum saldo, dívida ou vencimento é presumido.</InlineNotice>
      {!supplementalModeLocked ? <nav className="df-finance-ledger-tabs" aria-label="Tipo de fato financeiro">
        {([
          ["transaction", "Movimento", CurrencyCircleDollar],
          ["debt", "Dívida", Wallet],
          ["subscription", "Assinatura", Receipt],
        ] as const).map(([value, label, IconComponent]) => (
          <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}><IconComponent size={19} weight="duotone" /><span>{label}</span></button>
        ))}
      </nav> : null}

      <section className="df-ledger-heading">
        <span><Wallet size={22} weight="duotone" /></span>
        <div><small>Livro-caixa</small><strong>{modeLabel}</strong></div>
      </section>

      <FormSection title="Onde isso está" hint="selecione somente uma instituição confirmada" icon={Wallet} className="df-bank-selector">
        <SegmentedChoice
          label="Instituição"
          value={institutionChoice}
          onChange={setInstitutionChoice}
          columns={2}
          options={[
            { value: "Mercado Pago", label: "Mercado Pago" },
            { value: "Banco do Brasil", label: "Banco do Brasil" },
            { value: "PicPay", label: "PicPay" },
            { value: "Outro informado", label: "Outro" },
          ]}
        />
        {institutionChoice === "Outro informado" ? <Field label="Nome informado"><KeyboardInput value={otherInstitution} onChange={(event) => setOtherInstitution(event.target.value)} /></Field> : null}
      </FormSection>

      {mode === "transaction" ? (
        <section className="df-transaction-slip">
          <SegmentedChoice label="Direção" value={direction} onChange={setDirection} columns={2} options={[
            { value: "expense", label: "Saída", detail: "valor que saiu" },
            { value: "income", label: "Entrada", detail: "valor que entrou" },
          ]} />
          <div className="df-money-line"><span>R$</span><KeyboardInput aria-label="Valor da movimentação" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" /></div>
          <div className="df-two-column">
            <Field label="Categoria"><KeyboardInput value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Ex.: assinatura" /></Field>
            <Field label="Data"><KeyboardInput type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></Field>
          </div>
        </section>
      ) : null}

      {mode === "debt" ? (
        <section className="df-debt-contract">
          <header><Wallet size={20} /><span><strong>Retrato da dívida</strong><small>todos os valores são os que você digitou</small></span></header>
          <Field label="Credor ou produto"><KeyboardInput value={creditor} onChange={(event) => setCreditor(event.target.value)} placeholder="Ex.: cartão, cheque especial…" /></Field>
          <div className="df-two-column">
            <Field label="Saldo devedor informado"><KeyboardInput inputMode="decimal" value={outstanding} onChange={(event) => setOutstanding(event.target.value)} placeholder="R$ 0,00" /></Field>
            <Field label="Pagamento mínimo informado"><KeyboardInput inputMode="decimal" value={minimumPayment} onChange={(event) => setMinimumPayment(event.target.value)} placeholder="R$ 0,00" /></Field>
          </div>
          <div className="df-interest-line">
            <Field label="Taxa informada (%)"><KeyboardInput inputMode="decimal" value={interestRate} onChange={(event) => setInterestRate(event.target.value)} placeholder="—" /></Field>
            <SegmentedChoice label="Período da taxa" value={ratePeriod} onChange={setRatePeriod} columns={2} options={[
              { value: "monthly", label: "ao mês" },
              { value: "yearly", label: "ao ano" },
            ]} />
          </div>
          <Field label="Próximo vencimento"><KeyboardInput type="date" value={debtDueDate} onChange={(event) => setDebtDueDate(event.target.value)} /></Field>
        </section>
      ) : null}

      {mode === "subscription" ? (
        <section className="df-subscription-pass">
          <header><Receipt size={20} /><span><strong>Assinatura</strong><small>custo recorrente informado</small></span></header>
          <Field label="Serviço"><KeyboardInput value={service} onChange={(event) => setService(event.target.value)} placeholder="Nome da assinatura" /></Field>
          <div className="df-two-column">
            <Field label="Preço"><KeyboardInput inputMode="decimal" value={subscriptionPrice} onChange={(event) => setSubscriptionPrice(event.target.value)} placeholder="R$ 0,00" /></Field>
            <Field label="Renovação"><KeyboardInput type="date" value={renewalDate} onChange={(event) => setRenewalDate(event.target.value)} /></Field>
          </div>
          <SegmentedChoice label="Periodicidade" value={cadence} onChange={setCadence} columns={3} options={[
            { value: "monthly", label: "Mensal" },
            { value: "yearly", label: "Anual" },
            { value: "other", label: "Outra" },
          ]} />
          <SegmentedChoice label="Situação" value={subscriptionStatus} onChange={setSubscriptionStatus} columns={2} options={[
            { value: "active_confirmed", label: "Ativa" },
            { value: "trial_confirmed", label: "Teste" },
            { value: "cancelled_confirmed", label: "Cancelada" },
            { value: "uncertain", label: "Conferir" },
          ]} />
        </section>
      ) : null}

      <Field label="Observação"><KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="O que precisa ser lembrado sem inventar um fato financeiro" /></Field>
      <SaveFooter
        busy={busy}
        disabled={disabled || (subscriptionMode && !service.trim()) || Boolean(validationIssue)}
        error={error || (hasMeaningfulValue ? validationIssue : null)}
        label={`Salvar ${modeLabel.toLocaleLowerCase("pt-BR")}`}
        icon={CurrencyCircleDollar}
      />
    </form>
  );
}

type RoutineTaskState = { title: string; status: string | null; priority: string | null };

function RoutineForm({ onSaved, localDate, disabled }: FormProps) {
  const [wakeTime, setWakeTime] = useState("");
  const [startTime, setStartTime] = useState("");
  const [studyTime, setStudyTime] = useState("");
  const [windDownTime, setWindDownTime] = useState("");
  const [tasks, setTasks] = useState<RoutineTaskState[]>(() => [
    { title: "", status: null, priority: "essential" },
    { title: "", status: null, priority: "good" },
    { title: "", status: null, priority: "gold" },
  ]);
  const [closureState, setClosureState] = useState<string | null>(null);
  const [dayScore, setDayScore] = useState<number | null>(null);
  const [carriedForward, setCarriedForward] = useState("");
  const [reflection, setReflection] = useState("");
  const { busy, error, save } = useSaveRequest(onSaved);

  const wakeTimeKnowledge = localTimeKnowledge(wakeTime);
  const startTimeKnowledge = localTimeKnowledge(startTime);
  const studyTimeKnowledge = localTimeKnowledge(studyTime);
  const windDownTimeKnowledge = localTimeKnowledge(windDownTime);
  const hasMeaningfulValue = hasAnyRecordedValue([
    wakeTime,
    startTime,
    studyTime,
    windDownTime,
    tasks.map((task) => [task.title, task.status]),
    closureState,
    dayScore,
    carriedForward,
    reflection,
  ]);
  const validationIssue = firstValidationIssue(hasMeaningfulValue, [
    temporalValidationIssue("Horário de acordar", wakeTimeKnowledge),
    temporalValidationIssue("Horário do começo principal", startTimeKnowledge),
    temporalValidationIssue("Horário do estudo", studyTimeKnowledge),
    temporalValidationIssue("Horário de desacelerar", windDownTimeKnowledge),
    tasks.some((task) => !task.title.trim() && task.status)
      ? "Dê um nome à tarefa antes de marcar seu estado."
      : null,
  ]);

  const updateTask = (index: number, patch: Partial<RoutineTaskState>) => {
    setTasks((current) => current.map((task, taskIndex) => taskIndex === index ? { ...task, ...patch } : task));
  };

  const handleSave = () => {
    const populatedAnchors = [
      { kind: "wake", timeLocal: wakeTimeKnowledge },
      { kind: "main-start", timeLocal: startTimeKnowledge },
      { kind: "study", timeLocal: studyTimeKnowledge },
      { kind: "wind-down", timeLocal: windDownTimeKnowledge },
    ].filter((anchor) => anchor.timeLocal.state === "known");
    const populatedTasks = tasks
      .map((task) => routineTaskKnowledge(task.title, task.status, task.priority))
      .filter((task) => task.title.state === "known");
    const payload: RoutineDayPayload = {
      schema: "routine-day-plan-v1",
      eventKind: "routine-day-plan",
      anchors: populatedAnchors,
      tasks: populatedTasks,
      closure: {
        state: closureState ? known(closureState) : unknown("not_confirmed"),
        dayScore: scaleKnowledge(dayScore),
        carriedForward: textKnowledge(carriedForward),
        reflection: textKnowledge(reflection),
      },
    };
    return save(makeRequest(
      "rotina",
      payload,
      "Routine anchors, tasks and daily closure explicitly recorded by the user.",
      "Trilho do dia salvo",
      localDate,
    ));
  };

  const anchors = [
    { label: "Acordar", value: wakeTime, setter: setWakeTime, icon: SunHorizon },
    { label: "Começo principal", value: startTime, setter: setStartTime, icon: Clock },
    { label: "Estudo", value: studyTime, setter: setStudyTime, icon: GraduationCap },
    { label: "Desacelerar", value: windDownTime, setter: setWindDownTime, icon: Moon },
  ] as const;

  const taskLabels = [
    { title: "Mínimo básico", note: "mantém o dia de pé", tone: "essential" },
    { title: "Alvo bom", note: "faz o dia avançar", tone: "good" },
    { title: "Padrão ouro", note: "se houver capacidade", tone: "gold" },
  ] as const;

  return (
    <form className="df-form df-routine" onSubmit={(event) => submitForm(event, handleSave)}>
      <FormIntro domain="rotina" />
      <section className="df-anchor-rail">
        <header><Clock size={20} weight="duotone" /><span><strong>Âncoras do dia</strong><small>pontos de retorno, não uma grade punitiva</small></span></header>
        <ol>
          {anchors.map(({ label, value, setter, icon: IconComponent }) => (
            <li key={label}><span><IconComponent size={16} /></span><Field label={label}><KeyboardInput type="time" value={value} onChange={(event) => setter(event.target.value)} /></Field></li>
          ))}
        </ol>
      </section>

      <section className="df-task-ladder">
        <header><ListChecks size={20} /><span><strong>Escada de tarefas</strong><small>três níveis para proteger foco e energia</small></span></header>
        {tasks.map((task, index) => (
          <article key={taskLabels[index].tone} data-level={taskLabels[index].tone}>
            <div><span>{index + 1}</span><p><strong>{taskLabels[index].title}</strong><small>{taskLabels[index].note}</small></p></div>
            <KeyboardInput aria-label={taskLabels[index].title} value={task.title} onChange={(event) => updateTask(index, { title: event.target.value })} placeholder="Defina uma ação concreta" />
            <SegmentedChoice label={`Estado de ${taskLabels[index].title}`} value={task.status} onChange={(value) => updateTask(index, { status: value })} columns={3} options={[
              { value: "planned", label: "Planejada" },
              { value: "done", label: "Feita" },
              { value: "deferred", label: "Adiada" },
            ]} />
          </article>
        ))}
      </section>

      <section className="df-day-closure">
        <header><CheckCircle size={20} /><span><strong>Fechamento</strong><small>se o dia ainda não acabou, marque como parcial</small></span></header>
        <SegmentedChoice label="Estado do fechamento" value={closureState} onChange={setClosureState} columns={2} options={[
          { value: "partial", label: "Parcial" },
          { value: "closed", label: "Encerrado" },
        ]} />
        <span className="df-scale-label">Como o dia funcionou?</span><ScaleChoice value={dayScore} onChange={setDayScore} min={1} max={5} label="Funcionamento do dia" lowLabel="difícil" highLabel="muito bom" />
        <Field label="Levar para amanhã"><KeyboardInput value={carriedForward} onChange={(event) => setCarriedForward(event.target.value)} placeholder="Uma pendência explícita" /></Field>
        <Field label="Fecho em uma frase"><KeyboardTextarea value={reflection} onChange={(event) => setReflection(event.target.value)} placeholder="O que sustentou ou desviou o dia?" /></Field>
      </section>
      <SaveFooter
        busy={busy}
        disabled={disabled || Boolean(validationIssue)}
        error={error || (hasMeaningfulValue ? validationIssue : null)}
        label="Salvar trilho do dia"
        icon={ListChecks}
      />
    </form>
  );
}

type AgendaMode = "event" | "task";

function AgendaForm({ onSaved, localDate, disabled }: FormProps) {
  const [mode, setMode] = useState<AgendaMode>("event");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [location, setLocation] = useState("");
  const [confirmed, setConfirmed] = useState<boolean | null>(null);
  const [taskDue, setTaskDue] = useState("");
  const [priority, setPriority] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const { busy, error, save } = useSaveRequest(onSaved);

  const eventMode = mode === "event";
  const dateKnowledge = localDateKnowledge(date);
  const eventStartKnowledge = eventMode ? localTimeKnowledge(eventStart) : notApplicable<string>("task_record");
  const eventEndKnowledge = eventMode ? localTimeKnowledge(eventEnd) : notApplicable<string>("task_record");
  const taskDueKnowledge = eventMode ? notApplicable<string>("event_record") : localTimeKnowledge(taskDue);
  const plannedStartKnowledge = eventMode
    ? localDateTimeKnowledge(dateKnowledge, eventStartKnowledge)
    : notApplicable<string>("task_record");
  const plannedEndKnowledge = eventMode
    ? localDateTimeKnowledge(dateKnowledge, eventEndKnowledge)
    : notApplicable<string>("task_record");
  const dueDateKnowledge = eventMode ? notApplicable<string>("event_record") : dateKnowledge;
  const canonicalStatus = eventMode
    ? confirmed === null
      ? unknown<string>("not_confirmed")
      : known(confirmed ? "confirmed" : "tentative", "derived")
    : taskStatus
      ? known(taskStatus === "done" ? "completed" : taskStatus, "derived")
      : unknown<string>("not_confirmed");
  const canonicalPriority = eventMode
    ? unknown<string>("not_recorded")
    : priority ? known(priority) : unknown<string>("not_confirmed");
  const hasMeaningfulValue = hasAnyRecordedValue([
    title,
    date,
    eventMode ? [eventStart, eventEnd, location, confirmed] : [taskDue, priority, taskStatus],
    note,
  ]);
  const validationIssue = firstValidationIssue(hasMeaningfulValue, [
    temporalValidationIssue("Data", dateKnowledge),
    temporalValidationIssue("Horário de início", eventStartKnowledge),
    temporalValidationIssue("Horário de fim", eventEndKnowledge),
    temporalValidationIssue("Horário-limite", taskDueKnowledge),
    eventMode && (eventStart || eventEnd) && !date.trim()
      ? "Informe a data para salvar os horários do evento."
      : null,
    !eventMode && taskDue && !date.trim()
      ? "Informe a data para salvar o horário-limite da tarefa."
      : null,
    eventMode && eventStart && eventEnd && eventEnd <= eventStart
      ? "O fim do evento precisa ser posterior ao início nesta data."
      : null,
  ]);

  const handleSave = () => {
    const payload: AgendaRecordPayload = {
      schema: "agenda-record-v1",
      eventKind: eventMode ? "agenda-event" : "agenda-task",
      recordMode: mode,
      title: textKnowledge(title),
      date: dateKnowledge,
      plannedStartLocal: plannedStartKnowledge,
      plannedEndLocal: plannedEndKnowledge,
      dueLocalDate: dueDateKnowledge,
      dueLocalTime: taskDueKnowledge,
      status: canonicalStatus,
      priority: canonicalPriority,
      event: {
        startLocal: eventStartKnowledge,
        endLocal: eventEndKnowledge,
        location: eventMode ? textKnowledge(location) : notApplicable("task_record"),
        confirmation: eventMode ? truthKnowledge(confirmed, "event_not_confirmed") : notApplicable("task_record"),
      },
      task: {
        dueLocal: taskDueKnowledge,
        priority: eventMode ? notApplicable("event_record") : priority ? known(priority) : unknown("not_confirmed"),
        status: eventMode ? notApplicable("event_record") : taskStatus ? known(taskStatus) : unknown("not_confirmed"),
      },
      source: "manual",
      note: textKnowledge(note),
    };
    return save(makeRequest(
      "agenda",
      payload,
      "Manual agenda event or task explicitly recorded by the user.",
      eventMode ? "Evento manual salvo" : "Tarefa manual salva",
      localDateValue(dateKnowledge) ?? localDate,
    ));
  };

  return (
    <form className="df-form df-agenda" onSubmit={(event) => submitForm(event, handleSave)}>
      <FormIntro domain="agenda" />
      <section className="df-agenda-card" data-side={mode}>
        <nav aria-label="Tipo de item da agenda">
          <button type="button" aria-pressed={mode === "event"} onClick={() => setMode("event")}><CalendarBlank size={18} />Evento</button>
          <button type="button" aria-pressed={mode === "task"} onClick={() => setMode("task")}><CheckCircle size={18} />Tarefa</button>
        </nav>
        <div className="df-agenda-card-title">
          {mode === "event" ? <CalendarBlank size={24} weight="duotone" /> : <ListChecks size={24} weight="duotone" />}
          <Field label={mode === "event" ? "Nome do compromisso" : "O que precisa ser feito"}>
            <KeyboardInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder={mode === "event" ? "Ex.: internato — enfermaria" : "Ex.: revisar CTG"} />
          </Field>
        </div>
        <Field label="Data"><KeyboardInput type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>

        {mode === "event" ? (
          <div className="df-event-side">
            <div className="df-event-time-band">
              <Field label="Início"><KeyboardInput type="time" value={eventStart} onChange={(event) => setEventStart(event.target.value)} /></Field>
              <span><Clock size={18} /><i /></span>
              <Field label="Fim"><KeyboardInput type="time" value={eventEnd} onChange={(event) => setEventEnd(event.target.value)} /></Field>
            </div>
            <Field label="Local"><KeyboardInput value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Somente se confirmado" /></Field>
            <div className="df-confirmation-stamp"><span>Esse compromisso está confirmado?</span><TriStateChoice value={confirmed} onChange={setConfirmed} label="Confirmação do evento" yes="Confirmado" no="Não confirmado" /></div>
          </div>
        ) : (
          <div className="df-task-side">
            <Field label="Horário-limite, se houver"><KeyboardInput type="time" value={taskDue} onChange={(event) => setTaskDue(event.target.value)} /></Field>
            <SegmentedChoice label="Prioridade" value={priority} onChange={setPriority} columns={3} options={[
              { value: "low", label: "Baixa" },
              { value: "medium", label: "Média" },
              { value: "high", label: "Alta" },
            ]} />
            <SegmentedChoice label="Estado da tarefa" value={taskStatus} onChange={setTaskStatus} columns={3} options={[
              { value: "planned", label: "Planejada" },
              { value: "done", label: "Feita" },
              { value: "deferred", label: "Adiada" },
            ]} />
          </div>
        )}
        <Field label="Detalhes"><KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Informação útil para chegar e agir" /></Field>
        <p className="df-manual-source"><NotePencil size={13} />Fonte: entrada manual. Calendários externos não foram consultados.</p>
      </section>
      <SaveFooter
        busy={busy}
        disabled={disabled || !title.trim() || Boolean(validationIssue)}
        error={error || (hasMeaningfulValue ? validationIssue : null)}
        label={mode === "event" ? "Salvar evento" : "Salvar tarefa"}
        icon={CalendarBlank}
      />
    </form>
  );
}

const AI_ROLES = ["Brain/orquestração", "Código", "Pesquisa", "Escrita", "Design", "Imagem", "Vídeo", "E-mail", "Estudo"] as const;

function AIToolForm({ onSaved, localDate, disabled }: FormProps) {
  const [toolName, setToolName] = useState("");
  const [provider, setProvider] = useState("");
  const [roles, setRoles] = useState<Set<string>>(() => new Set());
  const [project, setProject] = useState("");
  const [price, setPrice] = useState("");
  const [cadence, setCadence] = useState<string | null>(null);
  const [renewalDate, setRenewalDate] = useState("");
  const [usefulness, setUsefulness] = useState<number | null>(null);
  const [overlap, setOverlap] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [decision, setDecision] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const { busy, error, save } = useSaveRequest(onSaved);

  const priceKnowledge = moneyKnowledge(price);
  const renewalDateKnowledge = localDateKnowledge(renewalDate);
  const validationIssue = firstValidationIssue(true, [
    knowledgeValidationIssue("Custo da ferramenta", priceKnowledge),
    temporalValidationIssue("Data de renovação", renewalDateKnowledge),
  ]);

  const handleSave = () => {
    const payload: AIToolPortfolioPayload = {
      schema: "ai-tool-portfolio-v1",
      eventKind: "ai-tool-portfolio",
      toolName: textKnowledge(toolName),
      provider: textKnowledge(provider),
      roles: arrayKnowledge(roles),
      project: textKnowledge(project),
      subscription: {
        price: priceKnowledge,
        amount: priceKnowledge,
        cadence: cadence ? known(cadence) : unknown("not_confirmed"),
        renewalDate: renewalDateKnowledge,
      },
      usefulness: scaleKnowledge(usefulness),
      overlap: scaleKnowledge(overlap),
      status: status ? known(status) : unknown("not_confirmed"),
      decision: decision ? known(decision) : unknown("not_confirmed"),
      note: textKnowledge(note),
    };
    return save(makeRequest(
      "ia",
      payload,
      "AI tool portfolio facts and evaluation explicitly recorded by the user.",
      "Ferramenta adicionada ao portfólio",
      localDate,
    ));
  };

  return (
    <form className="df-form df-ai" onSubmit={(event) => submitForm(event, handleSave)}>
      <FormIntro domain="ia" />
      <section className="df-tool-dossier">
        <header><Robot size={28} weight="duotone" /><div><small>Dossiê de ferramenta</small><strong>{toolName.trim() || "Nome ainda não informado"}</strong></div><span>{status || "sem status"}</span></header>
        <div className="df-two-column">
          <Field label="Ferramenta"><KeyboardInput value={toolName} onChange={(event) => setToolName(event.target.value)} placeholder="Nome do produto" /></Field>
          <Field label="Fornecedor"><KeyboardInput value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="Empresa, se souber" /></Field>
        </div>
        <span className="df-scale-label">Papel na sua frota</span><TagPicker selected={roles} onChange={setRoles} options={AI_ROLES} label="Papéis da ferramenta" />
        <Field label="Projeto ou fluxo principal"><KeyboardInput value={project} onChange={(event) => setProject(event.target.value)} placeholder="Onde ela entrega valor" /></Field>
      </section>

      <section className="df-tool-cost">
        <div><CurrencyCircleDollar size={21} /><span><strong>Custo informado</strong><small>não consultamos fatura nem e-mail</small></span></div>
        <div className="df-two-column">
          <Field label="Valor"><KeyboardInput inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="R$ 0,00" /></Field>
          <Field label="Renovação"><KeyboardInput type="date" value={renewalDate} onChange={(event) => setRenewalDate(event.target.value)} /></Field>
        </div>
        <SegmentedChoice label="Periodicidade" value={cadence} onChange={setCadence} columns={3} options={[
          { value: "monthly", label: "Mensal" },
          { value: "yearly", label: "Anual" },
          { value: "other", label: "Outra" },
        ]} />
      </section>

      <section className="df-tool-scorecard">
        <header><ChartBar size={20} /><span><strong>Valor no portfólio</strong><small>avaliação sua, não ranking automático</small></span></header>
        <div><span>Utilidade real</span><ScaleChoice value={usefulness} onChange={setUsefulness} min={0} max={5} label="Utilidade real" lowLabel="nenhuma" highLabel="essencial" /></div>
        <div><span>Sobreposição com outras</span><ScaleChoice value={overlap} onChange={setOverlap} min={0} max={5} label="Sobreposição" lowLabel="única" highLabel="redundante" /></div>
      </section>

      <FormSection title="Estado e decisão" icon={Robot} className="df-tool-decision">
        <SegmentedChoice label="Status" value={status} onChange={setStatus} columns={3} options={[
          { value: "active", label: "Ativa" },
          { value: "trial", label: "Teste" },
          { value: "paused", label: "Pausada" },
        ]} />
        <SegmentedChoice label="Decisão" value={decision} onChange={setDecision} columns={2} options={[
          { value: "keep", label: "Manter" },
          { value: "review", label: "Reavaliar" },
          { value: "cancel", label: "Cancelar" },
          { value: "undecided", label: "Não decidi" },
        ]} />
        <Field label="Evidência ou observação"><KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex.: entregou X no projeto Y; falhou em Z…" /></Field>
      </FormSection>
      <SaveFooter
        busy={busy}
        disabled={disabled || !toolName.trim() || Boolean(validationIssue)}
        error={error || validationIssue}
        label="Salvar dossiê"
        icon={Robot}
      />
    </form>
  );
}

function KnowledgeForm({ onSaved, localDate, disabled }: FormProps) {
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [sourceKind, setSourceKind] = useState<string | null>(null);
  const [sourceReference, setSourceReference] = useState("");
  const [capture, setCapture] = useState("");
  const [application, setApplication] = useState("");
  const [openQuestion, setOpenQuestion] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [nextReviewDate, setNextReviewDate] = useState("");
  const [tagsText, setTagsText] = useState("");
  const { busy, error, save } = useSaveRequest(onSaved);

  const tags = tagsText.split(",").map((tagValue) => tagValue.trim()).filter(Boolean);
  const reviewDateKnowledge = localDateKnowledge(nextReviewDate);
  const validationIssue = firstValidationIssue(true, [
    temporalValidationIssue("Data da próxima revisão", reviewDateKnowledge),
  ]);

  const handleSave = () => {
    const payload: KnowledgeCapturePayload = {
      schema: "knowledge-capture-v1",
      eventKind: "knowledge-capture",
      title: textKnowledge(title),
      topic: textKnowledge(topic),
      source: {
        kind: sourceKind ? known(sourceKind) : unknown("not_confirmed"),
        reference: textKnowledge(sourceReference),
      },
      capture: textKnowledge(capture),
      application: textKnowledge(application),
      openQuestion: textKnowledge(openQuestion),
      confidence: scaleKnowledge(confidence),
      nextReviewDate: reviewDateKnowledge,
      reviewDueDate: reviewDateKnowledge,
      review: { dueDate: reviewDateKnowledge },
      tags: arrayKnowledge(tags),
    };
    return save(makeRequest(
      "conhecimento",
      payload,
      "Knowledge card explicitly captured by the user.",
      "Ficha de conhecimento salva",
      localDate,
    ));
  };

  return (
    <form className="df-form df-knowledge" onSubmit={(event) => submitForm(event, handleSave)}>
      <FormIntro domain="conhecimento" />
      <InlineNotice>Não inclua nome, CPF, telefone ou outro dado identificável de paciente nesta ficha.</InlineNotice>
      <section className="df-knowledge-card">
        <header><BookOpenText size={24} weight="duotone" /><span><small>Frente</small><strong>O que merece sobreviver ao dia?</strong></span></header>
        <Field label="Título"><KeyboardInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Uma frase encontrável depois" /></Field>
        <Field label="Tema"><KeyboardInput value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Ex.: desaceleração tardia" /></Field>
        <Field label="Captura principal"><KeyboardTextarea value={capture} onChange={(event) => setCapture(event.target.value)} placeholder="Explique com suas palavras, sem copiar um prontuário" /></Field>
      </section>

      <section className="df-source-ribbon">
        <header><Tag size={18} /><strong>Origem</strong></header>
        <SegmentedChoice label="Tipo de fonte" value={sourceKind} onChange={setSourceKind} columns={3} options={[
          { value: "class", label: "Aula" },
          { value: "book", label: "Livro" },
          { value: "article", label: "Artigo" },
          { value: "case_deidentified", label: "Caso sem ID" },
          { value: "mentor", label: "Preceptor" },
          { value: "other", label: "Outra" },
        ]} />
        <Field label="Referência"><KeyboardInput value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} placeholder="Título, capítulo, DOI, URL ou descrição" /></Field>
      </section>

      <section className="df-knowledge-card df-knowledge-back">
        <header><Lightbulb size={24} weight="duotone" /><span><small>Verso</small><strong>Como isso muda uma ação?</strong></span></header>
        <Field label="Aplicação"><KeyboardTextarea value={application} onChange={(event) => setApplication(event.target.value)} placeholder="Quando esse conhecimento será útil?" /></Field>
        <Field label="Pergunta que ficou"><KeyboardInput value={openQuestion} onChange={(event) => setOpenQuestion(event.target.value)} placeholder="O que ainda preciso verificar?" /></Field>
        <span className="df-scale-label">Confiança atual</span><ScaleChoice value={confidence} onChange={setConfidence} min={1} max={5} label="Confiança no conhecimento" lowLabel="frágil" highLabel="explico" />
      </section>

      <section className="df-review-index">
        <div><Repeat size={18} /><span><strong>Índice de recuperação</strong><small>facilita encontrar e revisar</small></span></div>
        <div className="df-two-column">
          <Field label="Próxima revisão"><KeyboardInput type="date" value={nextReviewDate} onChange={(event) => setNextReviewDate(event.target.value)} /></Field>
          <Field label="Etiquetas"><KeyboardInput value={tagsText} onChange={(event) => setTagsText(event.target.value)} placeholder="obstetrícia, CTG" /></Field>
        </div>
        {tags.length ? <div className="df-tag-preview">{tags.map((tagValue) => <span key={tagValue}>#{tagValue}</span>)}</div> : null}
      </section>
      <SaveFooter
        busy={busy}
        disabled={disabled || !title.trim() || !capture.trim() || Boolean(validationIssue)}
        error={error || validationIssue}
        label="Salvar ficha"
        icon={BookOpenText}
      />
    </form>
  );
}
