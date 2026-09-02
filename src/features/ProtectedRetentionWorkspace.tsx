import { useEffect, useRef, useState } from "react";
import { Archive, ArrowClockwise, CheckCircle, FileArrowUp, LockKey, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { KeyboardInput, useKeyboard } from "../mobile";
import { applyProtectedRetention, discardProtectedRetentionProof, getProtectedRetentionPreview, prepareProtectedRetention, type RetentionReceipt } from "../data/protectedRetention";
import { RETENTION_REASON_LABELS, type RetentionPlan, type RetentionReason } from "../domain/protectedRetention";
import "./protected-retention-workspace.css";

type Prepared = Awaited<ReturnType<typeof prepareProtectedRetention>>;
const blockerLabels: Record<string, string> = { first_year: "O primeiro ano ainda está sendo preservado.", month_done: "A limpeza deste mês já foi confirmada.", dataset_date_unknown: "Não foi possível confirmar a data de início deste conjunto.", transport_present: "Há transporte de dados declarado; esta limpeza local não pode agir.", sync_state_present: "Existe estado de sincronização que precisa ser tratado antes da limpeza.", external_state_present: "Há informações de uma integração externa ainda não conferidas.", opaque_context: "Há configuração adicional sem contrato de recuperação conhecido.", import_in_progress: "Conclua ou descarte a importação que está em andamento.", rollback_available: "Uma importação ainda pode ser desfeita; seu estado de retorno será preservado." };
function dateLabel(value: string): string { return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)); }

export function ProtectedRetentionWorkspace({ dataRevision, onDataChange, onBackup }: { dataRevision?: number; onDataChange?: () => void; onBackup: () => void }) {
  const keyboard = useKeyboard(); const proofRef = useRef<string | null>(null);
  const [plan, setPlan] = useState<RetentionPlan | null>(null); const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null); const [passphrase, setPassphrase] = useState("");
  const [proof, setProof] = useState<Prepared | null>(null); const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false); const [receipt, setReceipt] = useState<RetentionReceipt | null>(null);
  const clearProof = () => { if (proofRef.current) discardProtectedRetentionProof(proofRef.current); proofRef.current = null; setProof(null); setAcknowledged(false); };
  const refresh = async () => { setError(null); try { setPlan(await getProtectedRetentionPreview()); } catch { setError("Não foi possível conferir a retenção agora. Todos os registros permanecem intactos."); } };
  useEffect(() => { clearProof(); void refresh(); }, [dataRevision]);
  useEffect(() => () => { if (proofRef.current) discardProtectedRetentionProof(proofRef.current); }, []);
  const prepare = async () => {
    if (!file || !passphrase || busy) return; keyboard.hide(); setBusy(true); setError(null); clearProof();
    try { const result = await prepareProtectedRetention(file, passphrase); proofRef.current = result.proofId; setProof(result); setPlan(result.plan); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível conferir o arquivo."); }
    finally { setPassphrase(""); setBusy(false); }
  };
  const apply = async () => {
    if (!proof || !acknowledged || busy) return; keyboard.hide(); setBusy(true); setError(null);
    try { const result = await applyProtectedRetention(proof.proofId); setReceipt(result.receipt); clearProof(); setFile(null); onDataChange?.(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "A limpeza não foi concluída. Nenhuma remoção parcial foi mantida."); clearProof(); }
    finally { setBusy(false); }
  };
  const ready = !!plan && plan.blockers.length === 0 && plan.candidates.length > 0;
  const protectedCounts = plan?.protected.reduce((counts, item) => ({ ...counts, [item.reason]: (counts[item.reason] ?? 0) + 1 }), {} as Partial<Record<RetentionReason, number>>) ?? {};

  return <section className="protected-retention" data-testid="protected-retention"><header><span><Archive size={25} weight="thin" /></span><div><p className="eyebrow">Memória com continuidade</p><h2>Revisão mensal do arquivo</h2></div><button type="button" onClick={() => { clearProof(); void refresh(); }} aria-label="Atualizar prévia de retenção" disabled={busy}><ArrowClockwise size={18} /></button></header>
    <p className="pr-intro">A partir do 13º mês, você pode retirar fatos com mais de 365 dias. Configurações, dependências e alterações recentes continuam protegidas.</p>
    {receipt ? <div className="pr-success" role="status"><CheckCircle size={23} /><div><strong>{receipt.counts.entities} {receipt.counts.entities === 1 ? "registro arquivado" : "registros arquivados"} com conferência</strong><p>As versões e filas correspondentes saíram deste aparelho. O arquivo permanece recuperável; nada foi declarado sincronizado. A liberação física de espaço depende do navegador.</p><small>Comprovante {receipt.proofId.slice(0, 8)} · {receipt.completedAt.slice(0, 10)}</small></div></div> : null}
    {!plan && !error ? <p role="status">Conferindo o arquivo local…</p> : null}
    {plan ? <>
      {plan.blockers.length ? <div className="pr-protected-note"><ShieldCheck size={21} /><div>{plan.blockers.map((reason) => <p key={reason}>{blockerLabels[reason] ?? "Uma proteção impede a limpeza deste lote."}</p>)}{plan.blockers.includes("first_year") && plan.firstEligibleOn ? <small>Primeira revisão disponível: {dateLabel(plan.firstEligibleOn)}.</small> : null}</div></div> : null}
      <div className="pr-counts"><div><strong>{plan.candidates.length}</strong><small>{plan.candidates.length === 1 ? "fato antigo para conferir" : "fatos antigos para conferir"}</small></div><div><strong>{plan.protected.length}</strong><small>{plan.protected.length === 1 ? "registro preservado" : "registros preservados"}</small></div></div>
      <details className="pr-list"><summary>O que permanece protegido</summary><ul>{Object.entries(protectedCounts).map(([reason, count]) => <li key={reason}><span>{RETENTION_REASON_LABELS[reason as RetentionReason]}</span><strong>{count}</strong></li>)}</ul>{!plan.protected.length ? <p>Nenhum registro classificado nesta prévia.</p> : null}</details>
      {plan.candidates.length ? <details className="pr-list"><summary>Conferir o lote de {plan.candidates.length} {plan.candidates.length === 1 ? "registro" : "registros"}</summary><p>Somente datas anteriores a {dateLabel(plan.cutoff)}; mudanças desde {dateLabel(plan.protectedSince)} permanecem.</p><ol>{plan.candidates.map((item) => <li key={item.entityId}><span>{item.domain} · {dateLabel(item.localDate)}</span><small>revisão {item.revision}</small></li>)}</ol></details> : null}
      {ready ? <div className="pr-flow"><div className="pr-step"><b>01</b><div><h3>Tenha uma cópia recuperável</h3><p>Crie um backup cifrado e guarde o arquivo. Para proteção contra perda do aparelho, mantenha também uma cópia fora dele, por exemplo no seu armazenamento de nuvem.</p><button type="button" className="secondary-cta" onClick={onBackup} disabled={busy}>Criar backup antes de revisar</button></div></div><div className="pr-step"><b>02</b><div><h3>Reabra e confira o arquivo</h3><p>Escolha o arquivo que você guardou. A conferência não importa nem substitui registros.</p><label className="pr-file"><FileArrowUp size={19} /><span>{file?.name ?? "Selecionar .bauerlife salvo"}</span><input type="file" aria-label="Backup para conferência de retenção" accept=".bauerlife,application/vnd.bauerlife+json" disabled={busy} onChange={(event) => { clearProof(); setFile(event.target.files?.[0] ?? null); setPassphrase(""); setError(null); }} /></label>{!proof ? <><label className="pr-password"><span><LockKey size={14} />Senha desse arquivo</span><KeyboardInput type="password" aria-label="Senha do backup para retenção" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="off" disabled={busy} /></label><button type="button" className="secondary-cta" disabled={!file || !passphrase || busy} onClick={() => void prepare()}>{busy ? "Conferindo…" : "Conferir conteúdo e recuperação"}</button></> : <p className="pr-proof"><ShieldCheck size={18} />Arquivo e contexto conferidos. Validade: cinco minutos.</p>}</div></div>{proof ? <div className="pr-step pr-final-step"><b>03</b><div><h3>Confirmar a retirada local</h3><p>{proof.plan.candidates.length === 1 ? "Será retirado somente o fato deste lote, com suas versões." : `Serão retirados somente os ${proof.plan.candidates.length} fatos do lote e suas versões.`} Isso não apaga o arquivo de backup.</p><label className="pr-ack"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={busy} /><span>Guardei esse arquivo em local seguro e conferi o lote. Entendo que a recuperação depende dele.</span></label><button type="button" className="pr-apply" disabled={!acknowledged || busy} onClick={() => void apply()}>{busy ? "Aplicando com proteção…" : "Arquivar lote conferido"}</button></div></div> : null}</div> : !plan.blockers.length ? <p className="pr-empty">Não há fatos elegíveis para retirar nesta revisão. Isso não altera nenhum registro.</p> : null}
    </> : null}
    {error ? <p className="pr-error" role="alert"><WarningCircle size={19} />{error}</p> : null}
    <p className="pr-footnote">A revisão acontece ao abrir o app; não prometemos tarefas com a PWA fechada. Sem arquivo verificado e confirmação, nenhum dado é removido. Sua senha não é guardada.</p>
  </section>;
}
