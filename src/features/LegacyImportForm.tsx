import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { FileCode } from "@phosphor-icons/react/dist/csr/FileCode";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import {
  applyStagedLegacyImport,
  discardStagedLegacyImport,
  rollbackLegacyImport,
  validateAndStageLegacyImport,
  type AppliedLegacyImportResult,
  type RolledBackLegacyImportResult,
  type StagedLegacyImportResult,
} from "../data";
import "./legacy-import-form.css";

export interface LegacyImportFormProps {
  file: File;
  onApplied: (result: AppliedLegacyImportResult) => void | Promise<void>;
  onRolledBack?: (result: RolledBackLegacyImportResult) => void | Promise<void>;
}

const familyLabel = (family: StagedLegacyImportResult["family"]) =>
  family === "legacy-obstetricia" ? "Diário de Obstetrícia" : "Cefaleia e Bruxismo";

export function LegacyImportForm({ file, onApplied, onRolledBack }: LegacyImportFormProps) {
  const [preview, setPreview] = useState<StagedLegacyImportResult | null>(null);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<AppliedLegacyImportResult | null>(null);
  const [rolledBack, setRolledBack] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stagedIdRef = useRef<string | null>(null);

  useEffect(() => () => {
    const importId = stagedIdRef.current;
    if (importId && !applied) void discardStagedLegacyImport(importId).catch(() => undefined);
  }, [applied]);

  const requiredWarnings = useMemo(
    () => preview?.warnings.filter((warning) => warning.requiresAcknowledgement) ?? [],
    [preview],
  );
  const canApply = Boolean(
    preview && requiredWarnings.every((warning) => acknowledged.includes(warning.code)),
  );

  const analyze = async () => {
    setBusy(true);
    setError(null);
    setFeedback("Lendo o arquivo em uma área isolada…");
    try {
      const source = await file.text();
      const staged = await validateAndStageLegacyImport(source, file.name);
      stagedIdRef.current = staged.importId;
      setPreview(staged);
      setAcknowledged([]);
      setFeedback("Prévia selada. Nenhum registro ativo foi alterado.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível reconhecer este beta.");
      setFeedback(null);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview || !canApply) return;
    setBusy(true);
    setError(null);
    setFeedback("Aplicando somente itens seguros…");
    try {
      const result = await applyStagedLegacyImport(preview.importId, {
        expectedPlanDigest: preview.planDigestSHA256,
        mode: "safe-only",
        acknowledgedWarningCodes: acknowledged,
      });
      setApplied(result);
      setFeedback(
        result.conflicts.length
          ? `Importação aplicada com ${result.conflicts.length} conflito(s) preservado(s).`
          : "Importação aplicada com snapshot reversível.",
      );
      await onApplied(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "A importação não pôde ser aplicada.");
      setFeedback(null);
    } finally {
      setBusy(false);
    }
  };

  const rollback = async () => {
    if (!applied || rolledBack) return;
    setBusy(true);
    setError(null);
    setFeedback("Conferindo se houve edições depois da importação…");
    try {
      const result = await rollbackLegacyImport(applied.importId);
      setRolledBack(true);
      setFeedback("Importação revertida; os registros posteriores foram protegidos.");
      await onRolledBack?.(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível reverter com segurança.");
      setFeedback(null);
    } finally {
      setBusy(false);
    }
  };

  if (!preview) {
    return <section className="legacy-import" aria-busy={busy}>
      <div className="legacy-import__callout"><FileCode size={22} weight="thin" /><div><strong>Beta preservado</strong><p>O JSON será apenas lido e normalizado. O HTML original não será modificado.</p></div></div>
      <button type="button" className="sheet-secondary" disabled={busy} onClick={() => void analyze()}>{busy ? "Analisando…" : "Analisar beta sem importar"}</button>
      {feedback ? <p className="legacy-import__feedback" role="status">{feedback}</p> : null}
      {error ? <p className="legacy-import__error" role="alert"><WarningCircle size={17} />{error}</p> : null}
    </section>;
  }

  return <section className="legacy-import" aria-busy={busy}>
    <header className="legacy-import__header"><CheckCircle size={22} weight="fill" /><div><strong>{familyLabel(preview.family)} reconhecido</strong><p>{preview.sourceName} · checksum {preview.sourceChecksumSHA256.slice(0, 12)}…</p></div></header>
    <dl className="legacy-import__metrics">
      <div><dt>Criar</dt><dd>{preview.counts.creates}</dd></div>
      <div><dt>Atualizar</dt><dd>{preview.counts.updates}</dd></div>
      <div><dt>Idênticos</dt><dd>{preview.counts.identical}</dd></div>
      <div><dt>Conflitos</dt><dd>{preview.counts.conflicts}</dd></div>
    </dl>
    <div className="legacy-import__truth"><Info size={17} /><p>Vazio permanece desconhecido. Texto livre nunca vira diagnóstico, ausência, adesão ou conclusão.</p></div>
    {preview.warnings.length ? <div className="legacy-import__warnings">
      <h3>Avisos da prévia</h3>
      {preview.warnings.map((warning, index) => warning.requiresAcknowledgement ? (
        <label key={`${warning.code}:${warning.sourceKey ?? index}`}>
          <input type="checkbox" checked={acknowledged.includes(warning.code)} onChange={(event) => setAcknowledged((current) => event.currentTarget.checked ? [...new Set([...current, warning.code])] : current.filter((code) => code !== warning.code))} />
          <span><strong>Confirmar revisão de texto livre</strong><small>{warning.message} Não importe nomes, prontuários ou dados identificáveis de pacientes.</small></span>
        </label>
      ) : <p key={`${warning.code}:${warning.sourceKey ?? index}`}><WarningCircle size={15} />{warning.message}</p>)}
    </div> : null}
    {!applied ? <button type="button" className="sheet-primary" disabled={busy || !canApply} onClick={() => void apply()}><ShieldCheck size={19} />{busy ? "Aplicando…" : "Aplicar somente itens seguros"}</button> : null}
    {applied && !rolledBack ? <button type="button" className="legacy-import__rollback" disabled={busy} onClick={() => void rollback()}><ArrowCounterClockwise size={18} />Reverter esta importação</button> : null}
    {feedback ? <p className="legacy-import__feedback" role="status">{feedback}</p> : null}
    {error ? <p className="legacy-import__error" role="alert"><WarningCircle size={17} />{error}</p> : null}
  </section>;
}

