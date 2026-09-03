import { useCallback, useEffect, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClipboardText } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { FileArrowDown } from "@phosphor-icons/react/dist/csr/FileArrowDown";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import {
  createRestoreConflictReviewExport,
  listRestoreConflicts,
  resolveRestoreConflictKeepingLocal,
  shareOrDownloadFile,
  type RestoreConflictView,
} from "../data";
import "./restore-conflict-workspace.css";

export const RESTORE_CONFLICTS_CHANGED_EVENT = "mentor:restore-conflicts-changed";

const reasonLabels: Record<string, string> = {
  different_existing_record: "O registro local e o recebido são diferentes",
  invalid_staged_record: "O registro recebido não é seguro para aplicação automática",
  protected_setting: "Configuração protegida",
};

function snapshotText(value: unknown): string {
  if (value === undefined) return "Sem snapshot disponível";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Snapshot não pôde ser convertido para leitura.";
  }
}

export function RestoreConflictReviewLauncher({
  onOpen,
}: {
  onOpen: () => void;
}) {
  const [openCount, setOpenCount] = useState<number | null>(null);
  const refresh = useCallback(() => {
    void listRestoreConflicts({ state: "open" })
      .then((items) => setOpenCount(items.length))
      .catch(() => setOpenCount(null));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(RESTORE_CONFLICTS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(RESTORE_CONFLICTS_CHANGED_EVENT, refresh);
  }, [refresh]);

  return <section className="restore-conflict-launcher" aria-label="Conflitos de restauração">
    <div>
      <WarningCircle size={22} weight="thin" />
      <span>
        <strong>Revisar conflitos de restauração</strong>
        <small>{openCount === null ? "Ler fila preservada" : openCount === 0 ? "Nenhum conflito aberto" : `${openCount} aguardando revisão`}</small>
      </span>
    </div>
    <button type="button" onClick={onOpen}>Abrir revisão</button>
  </section>;
}

export function RestoreConflictWorkspace() {
  const [conflicts, setConflicts] = useState<RestoreConflictView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConflicts(await listRestoreConflicts({ state: "all" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível ler a fila de conflitos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const keepLocal = async (conflictId: string) => {
    setBusyId(conflictId);
    setError(null);
    try {
      await resolveRestoreConflictKeepingLocal(conflictId);
      setConfirmingId(null);
      setFeedback("Conflito encerrado mantendo explicitamente o dado local atual.");
      await load();
      window.dispatchEvent(new Event(RESTORE_CONFLICTS_CHANGED_EVENT));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível encerrar o conflito.");
    } finally {
      setBusyId(null);
    }
  };

  const exportReview = async () => {
    setError(null);
    setFeedback(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const delivery = await shareOrDownloadFile(
        createRestoreConflictReviewExport(conflicts),
        `Mentor_Bauer_conflitos_${stamp}.json`,
        "Conflitos privados de restauração",
      );
      setFeedback(delivery === "shared"
        ? "Relatório aberto na folha de compartilhamento."
        : "Download solicitado; confirme se o relatório apareceu em Arquivos/Downloads.");
    } catch {
      setFeedback("Exportação cancelada; a fila de conflitos continua preservada.");
    }
  };

  const openCount = conflicts.filter((conflict) => conflict.state === "open").length;
  return <div className="restore-conflict-workspace" aria-busy={loading}>
    <div className="restore-conflict-intro">
      <ShieldCheck size={21} />
      <p>Os dois lados ficam legíveis. Nada recebido é aplicado nesta tela; a única resolução automática disponível é manter o dado local.</p>
    </div>
    {loading ? <p className="restore-conflict-status" role="status">Lendo fila preservada…</p> : null}
    {error ? <p className="restore-conflict-status is-error" role="alert">{error}</p> : null}
    {feedback ? <p className="restore-conflict-status" role="status">{feedback}</p> : null}
    {!loading && conflicts.length === 0 ? <div className="restore-conflict-empty"><CheckCircle size={25} /><p>Nenhum conflito de backup foi preservado até agora.</p></div> : null}
    {conflicts.length ? <>
      <div className="restore-conflict-summary">
        <span><strong>{openCount}</strong><small>abertos</small></span>
        <span><strong>{conflicts.length - openCount}</strong><small>resolvidos</small></span>
        <button type="button" onClick={() => void exportReview()}><FileArrowDown size={17} />Exportar ambos os lados</button>
      </div>
      <div className="restore-conflict-list">
        {conflicts.map((conflict) => <article key={conflict.id} className="restore-conflict-card" data-state={conflict.state}>
          <header>
            <ClipboardText size={19} />
            <div><strong>{conflict.subjectKind === "setting" ? `Configuração · ${conflict.key}` : conflict.key}</strong><small>{reasonLabels[conflict.reason] ?? conflict.reason}</small></div>
            <em>{conflict.state === "open" ? "Aberto" : "Local mantido"}</em>
          </header>
          <p>Local r{conflict.localRevision} · recebido r{conflict.incomingRevision}</p>
          <div className="restore-conflict-snapshots">
            <details><summary>Dado local na detecção</summary><pre>{snapshotText(conflict.localSnapshot)}</pre></details>
            <details><summary>Dado recebido</summary><pre>{snapshotText(conflict.incomingSnapshot)}</pre></details>
            {conflict.resolvedAt ? <details><summary>Local mantido na resolução</summary><pre>{snapshotText(conflict.resolvedLocalSnapshot)}</pre></details> : null}
          </div>
          {conflict.state === "open" && confirmingId !== conflict.id ? <button type="button" className="restore-conflict-keep" onClick={() => setConfirmingId(conflict.id)}>Manter dado local</button> : null}
          {conflict.state === "open" && confirmingId === conflict.id ? <div className="restore-conflict-confirm" role="group" aria-label="Confirmar resolução">
            <p>Isso encerra a pendência sem aplicar o dado recebido. O snapshot recebido continuará no relatório.</p>
            <button type="button" disabled={busyId === conflict.id} onClick={() => void keepLocal(conflict.id)}>{busyId === conflict.id ? "Salvando decisão…" : "Confirmar: manter local"}</button>
            <button type="button" disabled={busyId === conflict.id} onClick={() => setConfirmingId(null)}>Cancelar</button>
          </div> : null}
        </article>)}
      </div>
    </> : null}
  </div>;
}
