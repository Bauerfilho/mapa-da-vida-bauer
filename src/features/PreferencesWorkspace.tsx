import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { BookOpen } from "@phosphor-icons/react/dist/csr/BookOpen";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Database } from "@phosphor-icons/react/dist/csr/Database";
import { FloppyDisk } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { LockKey } from "@phosphor-icons/react/dist/csr/LockKey";
import { MoonStars } from "@phosphor-icons/react/dist/csr/MoonStars";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { TextAa } from "@phosphor-icons/react/dist/csr/TextAa";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { RETENTION_POLICY, type StorageDurabilityStatus } from "../domain";
import { KeyboardInput } from "../mobile";
import {
  ACCESSIBILITY_CLASS_NAMES,
  accessibilityClassNames,
  mentorPreferencesEqual,
  normalizeMentorPreferences,
  validateMentorPreferences,
  type MentorPreferences,
} from "./preferencesModel";
import "./preferences-workspace.css";

export interface PreferencesWorkspaceProps {
  value: MentorPreferences;
  storage: StorageDurabilityStatus | null;
  saving?: boolean;
  onBack: () => void;
  onSave: (value: MentorPreferences) => Promise<void>;
  onRequestPersistence?: () => Promise<void> | void;
  appearanceContent?: ReactNode;
}

function updateAccessibilityClasses(accessibility: MentorPreferences["accessibility"]): void {
  if (typeof document === "undefined") return;
  const selected = new Set(accessibilityClassNames(accessibility));
  for (const className of ACCESSIBILITY_CLASS_NAMES) {
    document.documentElement.classList.toggle(className, selected.has(className));
  }
}

function parseMinuteInput(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function durationLabel(minutes: number | null): string {
  if (minutes === null) return "não definida";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder} min`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h${String(remainder).padStart(2, "0")}`;
}

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return "não informado";
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value / 1_024)} KB`;
  if (value < 1_073_741_824) return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value / 1_048_576)} MB`;
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value / 1_073_741_824)} GB`;
}

function storageStatus(storage: StorageDurabilityStatus | null): {
  state: "protected" | "attention" | "unknown";
  title: string;
  description: string;
} {
  if (storage?.persisted === true) {
    return {
      state: "protected",
      title: "Proteção local confirmada",
      description: "O Safari informou que este armazenamento não é candidato à limpeza automática.",
    };
  }
  if (storage?.persisted === false) {
    return {
      state: "attention",
      title: "Proteção local ainda não confirmada",
      description: "O histórico segue salvo, mas um backup recente continua sendo a proteção mais segura.",
    };
  }
  return {
    state: "unknown",
    title: "Estado não informado pelo navegador",
    description: "Se o Safari não responder, o Mentor mantém os dados e recomenda backup manual.",
  };
}

function MinuteField({
  label,
  value,
  min = 1,
  onChange,
}: {
  label: string;
  value: number | null;
  min?: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="preferences-workspace__minute-field">
      <span>{label}</span>
      <span className="preferences-workspace__minute-input">
        <KeyboardInput
          type="number"
          inputMode="numeric"
          min={min}
          max={1_440}
          step={1}
          value={value ?? ""}
          onChange={(event) => onChange(parseMinuteInput(event.currentTarget.value))}
          placeholder="—"
        />
        <small>min</small>
      </span>
    </label>
  );
}

function AccessibilityChoice({
  icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="preferences-workspace__accessibility-choice">
      <span className="preferences-workspace__accessibility-icon" aria-hidden="true">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}

export function PreferencesWorkspace({
  value,
  storage,
  saving = false,
  onBack,
  onSave,
  onRequestPersistence,
  appearanceContent,
}: PreferencesWorkspaceProps) {
  const savedFingerprint = JSON.stringify(value);
  const [draft, setDraft] = useState<MentorPreferences>(() => normalizeMentorPreferences(value));
  const [localSaving, setLocalSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(normalizeMentorPreferences(value));
    setFeedback(null);
    setSubmitError(null);
  }, [savedFingerprint, value]);

  useEffect(() => {
    updateAccessibilityClasses(draft.accessibility);
    return () => updateAccessibilityClasses(value.accessibility);
  }, [draft.accessibility, value.accessibility]);

  const validation = useMemo(() => validateMentorPreferences(draft), [draft]);
  const dirty = !mentorPreferencesEqual(draft, value);
  const storageCopy = storageStatus(storage);
  const busy = saving || localSaving;

  const setStudyGoal = (key: keyof MentorPreferences["studyGoals"], next: number | null) => {
    setFeedback(null);
    setSubmitError(null);
    setDraft((current) => ({
      ...current,
      studyGoals: { ...current.studyGoals, [key]: next },
    }));
  };

  const setSleepGoal = (key: keyof MentorPreferences["sleepGoal"], next: number | null) => {
    setFeedback(null);
    setSubmitError(null);
    setDraft((current) => ({
      ...current,
      sleepGoal: { ...current.sleepGoal, [key]: next },
    }));
  };

  const setAccessibility = (
    key: keyof MentorPreferences["accessibility"],
    checked: boolean,
  ) => {
    setFeedback(null);
    setSubmitError(null);
    setDraft((current) => ({
      ...current,
      accessibility: { ...current.accessibility, [key]: checked },
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validation.valid || busy || !dirty) return;
    setLocalSaving(true);
    setSubmitError(null);
    setFeedback(null);
    try {
      await onSave(draft);
      setFeedback("Preferências salvas neste conjunto de dados.");
    } catch (reason) {
      setSubmitError(reason instanceof Error
        ? reason.message
        : "Não foi possível salvar. As preferências anteriores foram preservadas.");
    } finally {
      setLocalSaving(false);
    }
  };

  return (
    <main className="preferences-workspace" data-testid="preferences-workspace">
      <button type="button" className="preferences-workspace__back" onClick={onBack}>
        <ArrowLeft size={18} />Voltar ao Arquivo
      </button>

      <header className="preferences-workspace__header">
        <span aria-hidden="true"><ShieldCheck size={28} weight="thin" /></span>
        <div>
          <p>Seu ritmo, sem valores presumidos</p>
          <h1>Preferências</h1>
          <small>Metas orientam o Mentor; registros reais continuam separados e nunca são preenchidos por elas.</small>
        </div>
      </header>

      <form onSubmit={(event) => void submit(event)}>
        <section className="preferences-workspace__section" aria-labelledby="preferences-study-title">
          <header>
            <BookOpen size={23} weight="thin" aria-hidden="true" />
            <div>
              <h2 id="preferences-study-title">Régua pessoal de estudo</h2>
              <p>Base sustenta o dia difícil; Boa é o alvo habitual; Ouro é expansão, nunca dívida.</p>
            </div>
          </header>
          <div className="preferences-workspace__goal-grid">
            <MinuteField label="Base" value={draft.studyGoals.baseMinutes} onChange={(next) => setStudyGoal("baseMinutes", next)} />
            <MinuteField label="Boa" value={draft.studyGoals.goodMinutes} onChange={(next) => setStudyGoal("goodMinutes", next)} />
            <MinuteField label="Ouro" value={draft.studyGoals.goldMinutes} onChange={(next) => setStudyGoal("goldMinutes", next)} />
          </div>
          <p className="preferences-workspace__truth"><Info size={16} />Campo vazio continua “meta não definida”; não vira zero minuto.</p>
        </section>

        <section className="preferences-workspace__section" aria-labelledby="preferences-sleep-title">
          <header>
            <MoonStars size={23} weight="thin" aria-hidden="true" />
            <div>
              <h2 id="preferences-sleep-title">Meta pessoal de sono</h2>
              <p>Defina uma referência central e, se quiser, uma faixa. O diário registra o que aconteceu.</p>
            </div>
          </header>
          <div className="preferences-workspace__sleep-summary" aria-live="polite">
            <span><small>Meta</small><strong>{durationLabel(draft.sleepGoal.targetMinutes)}</strong></span>
            <span><small>Faixa</small><strong>{draft.sleepGoal.minimumMinutes === null && draft.sleepGoal.maximumMinutes === null ? "não definida" : `${durationLabel(draft.sleepGoal.minimumMinutes)} – ${durationLabel(draft.sleepGoal.maximumMinutes)}`}</strong></span>
          </div>
          <div className="preferences-workspace__goal-grid preferences-workspace__goal-grid--sleep">
            <MinuteField label="Meta central" min={60} value={draft.sleepGoal.targetMinutes} onChange={(next) => setSleepGoal("targetMinutes", next)} />
            <MinuteField label="Faixa mínima" min={60} value={draft.sleepGoal.minimumMinutes} onChange={(next) => setSleepGoal("minimumMinutes", next)} />
            <MinuteField label="Faixa máxima" min={60} value={draft.sleepGoal.maximumMinutes} onChange={(next) => setSleepGoal("maximumMinutes", next)} />
          </div>
        </section>

        <section className="preferences-workspace__section" aria-labelledby="preferences-accessibility-title">
          <header>
            <TextAa size={23} weight="thin" aria-hidden="true" />
            <div>
              <h2 id="preferences-accessibility-title">Leitura e movimento</h2>
              <p>A mudança aparece imediatamente para você conferir antes de salvar.</p>
            </div>
          </header>
          <div className="preferences-workspace__accessibility-list">
            {appearanceContent}
            <AccessibilityChoice icon={<TextAa size={21} />} title="Texto maior" description="Amplia a base tipográfica das áreas responsivas." checked={draft.accessibility.largerText} onChange={(checked) => setAccessibility("largerText", checked)} />
            <AccessibilityChoice icon={<Info size={21} />} title="Movimento reduzido" description="Remove animações e transições não essenciais." checked={draft.accessibility.reducedMotion} onChange={(checked) => setAccessibility("reducedMotion", checked)} />
            <AccessibilityChoice icon={<ShieldCheck size={21} />} title="Contraste reforçado" description="Escurece textos secundários e evidencia contornos." checked={draft.accessibility.highContrast} onChange={(checked) => setAccessibility("highContrast", checked)} />
          </div>
        </section>

        <section className="preferences-workspace__section" aria-labelledby="preferences-retention-title">
          <header>
            <LockKey size={23} weight="thin" aria-hidden="true" />
            <div>
              <h2 id="preferences-retention-title">Memória e janelas</h2>
              <p>Política fixa desta versão: você entende o que é guardado sem correr o risco de reduzir a proteção por engano.</p>
            </div>
          </header>
          <div className="preferences-workspace__retention-grid">
            <article><strong>{RETENTION_POLICY.rawHistoryDays}</strong><span>dias de histórico canônico</span><LockKey size={16} aria-label="Fixo nesta versão" /></article>
            <article><strong>{RETENTION_POLICY.defaultAnalyticsDays}</strong><span>dias no painel padrão</span><LockKey size={16} aria-label="Fixo nesta versão" /></article>
          </div>
          <p className="preferences-workspace__truth"><Info size={16} />O painel de 60 dias não apaga os fatos anteriores; o Arquivo preserva a janela completa de 365 dias.</p>
        </section>

        <section className="preferences-workspace__section" aria-labelledby="preferences-storage-title">
          <header>
            <Database size={23} weight="thin" aria-hidden="true" />
            <div>
              <h2 id="preferences-storage-title">Armazenamento e privacidade</h2>
              <p>Estado informado por este navegador, sem prometer autenticação ou sincronização inexistente.</p>
            </div>
          </header>
          <div className="preferences-workspace__storage" data-state={storageCopy.state}>
            {storageCopy.state === "protected" ? <CheckCircle size={23} weight="fill" /> : <WarningCircle size={23} />}
            <div>
              <strong>{storageCopy.title}</strong>
              <p>{storageCopy.description}</p>
              <dl>
                <div><dt>Em uso</dt><dd>{formatBytes(storage?.usageBytes ?? null)}</dd></div>
                <div><dt>Limite informado</dt><dd>{formatBytes(storage?.quotaBytes ?? null)}</dd></div>
              </dl>
              {storage?.persisted !== true && onRequestPersistence ? <button type="button" onClick={() => void onRequestPersistence()}>Solicitar proteção ao iPhone</button> : null}
            </div>
          </div>
          <div className="preferences-workspace__privacy-facts">
            <p><LockKey size={17} /><span><strong>Local primeiro</strong><small>Os dados ficam no armazenamento deste perfil do Safari/PWA.</small></span></p>
            <p><Database size={17} /><span><strong>Sem conexões automáticas</strong><small>Nenhum banco, e-mail, calendário ou nuvem está conectado nesta versão.</small></span></p>
            <p><ShieldCheck size={17} /><span><strong>Recuperação sob seu comando</strong><small>O backup cifrado continua disponível no Arquivo.</small></span></p>
          </div>
        </section>

        {!validation.valid ? (
          <div className="preferences-workspace__feedback" data-state="error" role="alert">
            <WarningCircle size={19} />
            <ul>{validation.errors.map((error) => <li key={error}>{error}</li>)}</ul>
          </div>
        ) : submitError ? (
          <p className="preferences-workspace__feedback" data-state="error" role="alert"><WarningCircle size={19} />{submitError}</p>
        ) : feedback ? (
          <p className="preferences-workspace__feedback" data-state="success" role="status"><CheckCircle size={19} />{feedback}</p>
        ) : null}

        <button className="preferences-workspace__save" type="submit" disabled={!dirty || !validation.valid || busy}>
          <FloppyDisk size={19} />
          {busy ? "Salvando…" : dirty ? "Salvar preferências" : "Preferências salvas"}
        </button>
        <p className="preferences-workspace__save-note"><ShieldCheck size={15} />As metas não alteram registros anteriores nem criam conclusões clínicas.</p>
      </form>
    </main>
  );
}

export default PreferencesWorkspace;
