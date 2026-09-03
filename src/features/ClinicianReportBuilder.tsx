import { CalendarBlank } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { FileText } from "@phosphor-icons/react/dist/csr/FileText";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import {
  useId,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  ClinicianReportDomain,
} from "../data";
import { CLINICIAN_REPORT_PLAINTEXT_WARNING } from "../data";
import type {
  LocalDate,
  MentorEntity,
} from "../domain";
import { KeyboardInput, useKeyboard } from "../mobile";
import {
  buildClinicianReportPreview,
  CLINICIAN_REPORT_DEFAULT_DOMAINS,
  CLINICIAN_REPORT_DOMAIN_OPTIONS,
  CLINICIAN_REPORT_PRIVACY_CONFIRMATION,
  CLINICIAN_REPORT_WINDOWS,
  createConfirmedClinicianReport,
  type ClinicianReportGeneration,
  type ClinicianReportWindowDays,
} from "./clinicianReportPlanning";
import "./clinician-report-builder.css";

export interface ClinicianReportBuilderProps {
  entities: readonly MentorEntity[];
  referenceLocalDate: LocalDate;
  onReportReady: (
    report: ClinicianReportGeneration,
  ) => void | Promise<void>;
  initialWindowDays?: ClinicianReportWindowDays;
  initialDomains?: readonly ClinicianReportDomain[];
  initialTitle?: string;
  disabled?: boolean;
  onCancel?: () => void;
}

function formatLocalDate(localDate: LocalDate): string {
  const [year, month, day] = localDate.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * Builds a local report only after an explicit privacy confirmation.
 * Sharing or downloading is intentionally delegated to `onReportReady`.
 */
export function ClinicianReportBuilder({
  entities,
  referenceLocalDate,
  onReportReady,
  initialWindowDays = 60,
  initialDomains = CLINICIAN_REPORT_DEFAULT_DOMAINS,
  initialTitle = "",
  disabled = false,
  onCancel,
}: ClinicianReportBuilderProps) {
  const keyboard = useKeyboard();
  const titleId = useId();
  const [windowDays, setWindowDays] = useState<ClinicianReportWindowDays>(initialWindowDays);
  const [domains, setDomains] = useState<ClinicianReportDomain[]>(() => [
    ...new Set(initialDomains),
  ]);
  const [title, setTitle] = useState(initialTitle);
  const [reviewing, setReviewing] = useState(false);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selection = useMemo(() => ({
    referenceLocalDate,
    windowDays,
    domains,
    title,
  }), [domains, referenceLocalDate, title, windowDays]);
  const preview = useMemo(
    () => buildClinicianReportPreview(entities, selection),
    [entities, selection],
  );
  const unavailable = disabled || generating;

  useEffect(() => {
    setReviewing(false);
    setPrivacyConfirmed(false);
    setNotice(null);
    setError(null);
  }, [entities, referenceLocalDate]);

  const invalidateConfirmation = () => {
    setReviewing(false);
    setPrivacyConfirmed(false);
    setNotice(null);
    setError(null);
  };

  const selectWindow = (nextWindow: ClinicianReportWindowDays) => {
    invalidateConfirmation();
    setWindowDays(nextWindow);
  };

  const toggleDomain = (domain: ClinicianReportDomain) => {
    invalidateConfirmation();
    setDomains((current) => current.includes(domain)
      ? current.filter((item) => item !== domain)
      : [...current, domain]);
  };

  const prepareConfirmation = () => {
    keyboard.hide();
    setNotice(null);
    if (preview.selectedDomains.length === 0) {
      setError("Selecione pelo menos um domínio para preparar o relatório.");
      return;
    }
    if (!preview.hasExportableData) {
      setError("Não há registros nos domínios e no período selecionados.");
      return;
    }
    setError(null);
    setPrivacyConfirmed(false);
    setReviewing(true);
  };

  const generate = async () => {
    keyboard.hide();
    setNotice(null);
    setError(null);
    setGenerating(true);
    try {
      const report = createConfirmedClinicianReport(
        entities,
        selection,
        privacyConfirmed,
      );
      await onReportReady(report);
      setPrivacyConfirmed(false);
      setReviewing(false);
      setNotice("Arquivo criado localmente. Nada foi enviado automaticamente.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível gerar o relatório.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="clinician-report-builder" aria-labelledby={`${titleId}-heading`}>
      <header className="clinician-report-builder__header">
        <span><FileText size={23} weight="duotone" aria-hidden="true" /></span>
        <div>
          <p>Exportação sob seu comando</p>
          <h2 id={`${titleId}-heading`}>Relatório para consulta</h2>
          <small>Você escolhe o recorte, confere a prévia e confirma antes de criar.</small>
        </div>
      </header>

      <div className="clinician-report-builder__privacy">
        <WarningCircle size={22} weight="duotone" aria-hidden="true" />
        <p>
          <strong>Texto sem criptografia.</strong>
          <span>{CLINICIAN_REPORT_PLAINTEXT_WARNING} Nada é criado ou enviado antes da confirmação final.</span>
        </p>
      </div>

      {notice ? <p className="clinician-report-builder__notice" role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" />{notice}</p> : null}
      {error ? <p className="clinician-report-builder__error" role="alert"><WarningCircle size={18} weight="fill" aria-hidden="true" />{error}</p> : null}

      <section className="clinician-report-builder__section">
        <div className="clinician-report-builder__section-title">
          <CalendarBlank size={20} aria-hidden="true" />
          <div><h3>Período</h3><p>Janela civil inclusiva, encerrada na data de referência.</p></div>
        </div>
        <div className="clinician-report-builder__windows" role="group" aria-label="Período do relatório">
          {CLINICIAN_REPORT_WINDOWS.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={windowDays === days}
              disabled={unavailable}
              onClick={() => selectWindow(days)}
            >
              {days}d
            </button>
          ))}
        </div>
        <p className="clinician-report-builder__range">
          {formatLocalDate(preview.startLocalDate)} a {formatLocalDate(preview.endLocalDate)}
        </p>
      </section>

      <section className="clinician-report-builder__section">
        <div className="clinician-report-builder__section-title">
          <FileText size={20} aria-hidden="true" />
          <div><h3>Domínios</h3><p>Somente os itens marcados entrarão no arquivo.</p></div>
        </div>
        <div className="clinician-report-builder__domains" role="group" aria-label="Domínios do relatório">
          {CLINICIAN_REPORT_DOMAIN_OPTIONS.map(({ id, label }) => {
            const selected = domains.includes(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                disabled={unavailable}
                onClick={() => toggleDomain(id)}
              >
                <span aria-hidden="true">{selected ? <Check size={13} weight="bold" /> : null}</span>
                {label}
              </button>
            );
          })}
        </div>
        <label className="clinician-report-builder__title" htmlFor={titleId}>
          <span>Título opcional</span>
          <KeyboardInput
            id={titleId}
            value={title}
            maxLength={120}
            disabled={unavailable}
            placeholder="Ex.: acompanhamento — consulta de setembro"
            onChange={(event) => {
              invalidateConfirmation();
              setTitle(event.target.value);
            }}
          />
        </label>
      </section>

      <section className="clinician-report-builder__section" aria-live="polite">
        <div className="clinician-report-builder__section-title">
          <CheckCircle size={20} aria-hidden="true" />
          <div><h3>Prévia verificável</h3><p>Dia sem registro continua desconhecido; não significa ausência de sintoma.</p></div>
        </div>
        <dl className="clinician-report-builder__summary">
          <div><dt>Registros</dt><dd>{preview.recordCount}</dd></div>
          <div><dt>Dias com algum registro</dt><dd>{preview.daysWithAnyRecord}/{preview.windowDays}</dd></div>
          <div><dt>Dias sem registro</dt><dd>{preview.daysWithoutAnySelectedRecord}</dd></div>
        </dl>
        <div className="clinician-report-builder__domain-preview">
          {preview.byDomain.length ? preview.byDomain.map((domain) => (
            <article key={domain.domain}>
              <strong>{domain.label}</strong>
              <span>{domain.recordCount} registro(s)</span>
              <small>{domain.daysWithRecords} dia(s) com registro · {domain.daysWithoutRecords} sem registro</small>
            </article>
          )) : <p>Nenhum domínio selecionado.</p>}
        </div>
        <p className="clinician-report-builder__missing-note">
          {preview.daysWithoutAnySelectedRecord} de {preview.windowDays} dia(s) não têm registro nos domínios escolhidos. Isso não prova ausência, adesão ou piora.
        </p>
        {preview.selectedDomains.length ? (
          <div className="clinician-report-builder__content-preview">
            <div>
              <strong>Conteúdo exato do arquivo</strong>
              <span>Bauer Vieira · {formatLocalDate(preview.startLocalDate)} a {formatLocalDate(preview.endLocalDate)}</span>
            </div>
            <pre tabIndex={0}>{preview.contentText}</pre>
          </div>
        ) : (
          <p className="clinician-report-builder__preview-empty">
            Selecione somente os domínios necessários. A prévia integral aparecerá aqui antes da confirmação.
          </p>
        )}
      </section>

      {reviewing ? (
        <section className="clinician-report-builder__confirmation" role="group" aria-label="Confirmação de geração">
          <h3>Confirme antes de gerar</h3>
          <p>{preview.recordCount} registro(s), {preview.selectedDomains.length} domínio(s), de {formatLocalDate(preview.startLocalDate)} a {formatLocalDate(preview.endLocalDate)}.</p>
          <p><strong>Atenção:</strong> ao continuar, o mesmo texto mostrado na prévia será entregue ao Compartilhar/Download e o destino poderá armazenar ou sincronizar uma cópia.</p>
          <label>
            <input
              type="checkbox"
              checked={privacyConfirmed}
              disabled={unavailable}
              onChange={(event) => setPrivacyConfirmed(event.target.checked)}
            />
            <span>{CLINICIAN_REPORT_PRIVACY_CONFIRMATION}</span>
          </label>
          <div>
            <button type="button" disabled={unavailable} onClick={() => { setReviewing(false); setPrivacyConfirmed(false); }}>Voltar e editar</button>
            <button type="button" disabled={unavailable || !privacyConfirmed} onClick={() => void generate()}>
              {generating ? "Gerando…" : "Confirmar e gerar arquivo"}
            </button>
          </div>
        </section>
      ) : (
        <div className="clinician-report-builder__actions">
          {onCancel ? <button type="button" disabled={unavailable} onClick={() => { keyboard.hide(); onCancel(); }}>Cancelar</button> : null}
          <button type="button" disabled={unavailable || !preview.hasExportableData} onClick={prepareConfirmation}>Revisar geração</button>
        </div>
      )}
    </section>
  );
}
