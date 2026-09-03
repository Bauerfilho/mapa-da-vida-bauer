import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { FloppyDisk } from "@phosphor-icons/react/dist/csr/FloppyDisk";
import { GitDiff } from "@phosphor-icons/react/dist/csr/GitDiff";
import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ENTITY_USER_EDIT_REASON,
  MAX_ENTITY_REVISION_SUMMARY_LENGTH,
  MAX_REVISION_LIST_ITEMS,
  MAX_REVISION_TEXT_LENGTH,
  type EntityType,
  type MentorEntity,
} from "../domain";
import type { RevisionAwareSaveInput } from "../hooks";
import { useRevisionAwareEntity } from "../hooks";
import { KeyboardInput, KeyboardTextarea, useKeyboard } from "../mobile";
import {
  collectEditablePayloadLeaves,
  editableLeafDraftValue,
  planEditablePayloadPatch,
  type EditablePayloadLeaf,
} from "./entityRevisionFields";
import "./entity-revision-editor.css";

export interface EntityRevisionEditorProps<TType extends EntityType = EntityType> {
  entityId: string;
  expectedType?: TType;
  title?: string;
  onChanged?: (entity: MentorEntity<TType>) => void | Promise<void>;
}

const OPERATION_LABELS = {
  create: "Criação",
  update: "Edição",
  delete: "Exclusão",
  restore: "Restauração",
  import: "Importação",
  settings: "Configuração",
} as const;

function formatDateTime(value: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "horário não disponível";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);
}

function revisionDetail(
  kind: keyof typeof OPERATION_LABELS | null,
  summary: string | null,
  reason: string,
): string {
  if (reason === ENTITY_USER_EDIT_REASON && summary?.trim()) {
    return summary.trim().slice(0, MAX_ENTITY_REVISION_SUMMARY_LENGTH);
  }
  if (reason.startsWith("undo_operation:")) return "Última alteração desfeita sem apagar versões.";
  switch (kind) {
    case "create": return "Registro original preservado.";
    case "delete": return "Registro movido para excluídos.";
    case "restore": return "Registro restaurado ao histórico ativo.";
    case "import": return "Registro trazido por importação validada.";
    case "settings": return "Configuração registrada.";
    case "update": return "Registro atualizado; a versão anterior permanece preservada.";
    default: return "Versão preservada no histórico.";
  }
}

function initialDrafts(leaves: readonly EditablePayloadLeaf[]): Record<string, string> {
  return Object.fromEntries(leaves.map((leaf) => [leaf.id, editableLeafDraftValue(leaf)]));
}

function FieldControl({
  leaf,
  value,
  error,
  disabled,
  onChange,
}: {
  leaf: EditablePayloadLeaf;
  value: string;
  error?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const inputId = `revision-field-${leaf.id.replace(/[^a-z0-9_-]/gi, "-")}`;
  const describedBy = error ? `${inputId}-error` : undefined;
  return (
    <div className="entity-revision-editor__field" data-invalid={Boolean(error) || undefined}>
      <label htmlFor={leaf.kind === "boolean" ? undefined : inputId}>
        {leaf.label}
      </label>
      {leaf.kind === "boolean" ? (
        <div
          className="entity-revision-editor__boolean"
          role="group"
          aria-label={leaf.label}
        >
          <button
            type="button"
            aria-pressed={value === "true"}
            disabled={disabled}
            onClick={() => onChange("true")}
          >
            Sim
          </button>
          <button
            type="button"
            aria-pressed={value === "false"}
            disabled={disabled}
            onClick={() => onChange("false")}
          >
            Não
          </button>
        </div>
      ) : leaf.kind === "list" || leaf.multiline ? (
        <KeyboardTextarea
          id={inputId}
          value={value}
          rows={leaf.kind === "list" ? 3 : 4}
          maxLength={leaf.kind === "list"
            ? MAX_REVISION_LIST_ITEMS * MAX_REVISION_TEXT_LENGTH + MAX_REVISION_LIST_ITEMS - 1
            : MAX_REVISION_TEXT_LENGTH}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <KeyboardInput
          id={inputId}
          value={value}
          disabled={disabled}
          inputMode={leaf.kind === "number" ? "decimal" : undefined}
          maxLength={leaf.kind === "string" ? MAX_REVISION_TEXT_LENGTH : undefined}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {leaf.kind === "list" ? <small>Um item por linha · até 12 itens</small> : null}
      {error ? <small id={describedBy} className="entity-revision-editor__field-error">{error}</small> : null}
    </div>
  );
}

export function EntityRevisionEditor<TType extends EntityType = EntityType>({
  entityId,
  expectedType,
  title = "Editar registro",
  onChanged,
}: EntityRevisionEditorProps<TType>) {
  const keyboard = useKeyboard();
  const editor = useRevisionAwareEntity<TType>(entityId, { expectedType, onChanged });
  const entity = editor.session?.entity ?? null;
  const leaves = useMemo(
    () => entity ? collectEditablePayloadLeaves(entity.type, entity.payload) : [],
    [entity],
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);

  useEffect(() => {
    if (!entity) return;
    setDrafts(initialDrafts(leaves));
    setReason("");
    setLocalError(null);
    setConfirmUndo(false);
  }, [entity?.id, entity?.revision, leaves]);

  const patchPlan = useMemo(
    () => planEditablePayloadPatch(leaves, drafts),
    [drafts, leaves],
  );
  const comparison = patchPlan.changes;
  const invalidDraft = Object.keys(patchPlan.errors).length > 0;
  const editable = entity?.status === "active";
  const canSave = Boolean(
    editable &&
      comparison.length > 0 &&
      reason.trim() &&
      reason.trim().length <= MAX_ENTITY_REVISION_SUMMARY_LENGTH &&
      !invalidDraft &&
      !editor.saving,
  );

  const updateDraft = (leafId: string, value: string) => {
    setDrafts((current) => ({ ...current, [leafId]: value }));
    setNotice(null);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    if (!reason.trim()) {
      setLocalError("Informe o motivo para deixar a revisão compreensível no histórico.");
      return;
    }
    if (comparison.length === 0) {
      setLocalError("Nenhuma mudança foi feita.");
      return;
    }
    if (invalidDraft) {
      setLocalError("Revise os campos sinalizados antes de salvar.");
      return;
    }
    setLocalError(null);
    keyboard.hide();
    const input: RevisionAwareSaveInput<TType> = {
      summary: reason.trim(),
      ...(patchPlan.changes.length
        ? { payloadPatch: patchPlan.payloadPatch as RevisionAwareSaveInput<TType>["payloadPatch"] }
        : {}),
    };
    try {
      await editor.save(input);
      setNotice("Alteração salva como uma nova revisão.");
    } catch {
      // The hook exposes either a typed conflict or the concrete error below.
    }
  };

  const handleReloadConflict = async () => {
    keyboard.hide();
    setLocalError(null);
    setNotice(null);
    try {
      await editor.reload();
      setNotice("Versão atual carregada. Revise os campos antes de salvar.");
    } catch {
      // The hook keeps the concrete read error available to the UI.
    }
  };

  const handleUndo = async () => {
    keyboard.hide();
    setLocalError(null);
    setNotice(null);
    try {
      await editor.undoLatest();
      setConfirmUndo(false);
      setNotice("A última alteração foi desfeita em uma nova revisão recuperável.");
    } catch {
      setConfirmUndo(false);
    }
  };

  if (editor.loading && !entity) {
    return (
      <section className="entity-revision-editor" aria-busy="true">
        <div className="entity-revision-editor__loading">
          <ClockCounterClockwise size={24} aria-hidden="true" />
          <p>Carregando a versão atual…</p>
        </div>
      </section>
    );
  }

  if (!entity || !editor.session) {
    return (
      <section className="entity-revision-editor">
        <div className="entity-revision-editor__empty" role="alert">
          <WarningCircle size={24} aria-hidden="true" />
          <div><strong>Não foi possível abrir o registro</strong><p>{editor.error?.message ?? "Registro indisponível."}</p></div>
        </div>
      </section>
    );
  }

  return (
    <section className="entity-revision-editor" aria-label={title}>
      <header className="entity-revision-editor__header">
        <span><PencilSimple size={22} weight="duotone" aria-hidden="true" /></span>
        <div>
          <p>Edição protegida</p>
          <h2>{title}</h2>
          <small>Revisão {entity.revision} · {entity.status === "active" ? "ativa" : "excluída e recuperável"}</small>
        </div>
      </header>

      <div className="entity-revision-editor__safety">
        <ShieldCheck size={21} weight="duotone" aria-hidden="true" />
        <p><strong>Nada é sobrescrito em silêncio.</strong><span>O salvamento cria uma nova revisão e mantém campos que esta tela não conhece.</span></p>
      </div>

      {editor.conflict ? (
        <div className="entity-revision-editor__conflict" role="alert">
          <WarningCircle size={23} weight="fill" aria-hidden="true" />
          <div>
            <strong>Este registro mudou enquanto estava aberto</strong>
            <p>A revisão {editor.conflict.expectedRevision} virou {editor.conflict.actualRevision}. Sua edição não foi aplicada.</p>
            <button type="button" onClick={() => void handleReloadConflict()} disabled={editor.loading}>
              <ArrowCounterClockwise size={17} aria-hidden="true" />
              Recarregar versão atual
            </button>
          </div>
        </div>
      ) : null}

      {notice ? <p className="entity-revision-editor__notice" role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" />{notice}</p> : null}
      {!editor.conflict && (localError || editor.error) ? (
        <p className="entity-revision-editor__error" role="alert"><WarningCircle size={18} aria-hidden="true" />{localError ?? editor.error?.message}</p>
      ) : null}

      {!editable ? (
        <div className="entity-revision-editor__deleted">
          <p>Este registro está excluído. Use o histórico abaixo para desfazer a exclusão antes de editar.</p>
        </div>
      ) : null}

      <form onSubmit={(event) => void handleSave(event)}>
        <section className="entity-revision-editor__section">
          <div className="entity-revision-editor__section-title">
            <PencilSimple size={20} aria-hidden="true" />
            <div><h3>Dados editáveis</h3><p>Apenas fatos simples já conhecidos aparecem aqui.</p></div>
          </div>
          {leaves.length ? (
            <div className="entity-revision-editor__fields">
              {leaves.map((leaf) => (
                <FieldControl
                  key={leaf.id}
                  leaf={leaf}
                  value={drafts[leaf.id] ?? editableLeafDraftValue(leaf)}
                  error={patchPlan.errors[leaf.id]}
                  disabled={!editable || editor.saving}
                  onChange={(value) => updateDraft(leaf.id, value)}
                />
              ))}
            </div>
          ) : (
            <p className="entity-revision-editor__no-fields">Este registro não possui campos narrativos que o editor genérico possa alterar com segurança.</p>
          )}
        </section>

        <section className="entity-revision-editor__section">
          <div className="entity-revision-editor__section-title">
            <GitDiff size={20} aria-hidden="true" />
            <div><h3>Antes e depois</h3><p>Confira exatamente o que entrará na nova revisão.</p></div>
          </div>
          {comparison.length ? (
            <div className="entity-revision-editor__comparison">
              {comparison.map((change) => (
                <article key={change.id}>
                  <strong>{change.label}</strong>
                  <div><span>Antes</span><p>{change.before}</p></div>
                  <div data-after><span>Depois</span><p>{change.after}</p></div>
                </article>
              ))}
            </div>
          ) : (
            <p className="entity-revision-editor__no-change">Nenhuma diferença até agora.</p>
          )}
          <div className="entity-revision-editor__field entity-revision-editor__reason">
            <label htmlFor="revision-reason">Motivo da alteração <span>obrigatório</span></label>
            <KeyboardTextarea
              id="revision-reason"
              value={reason}
              rows={3}
              maxLength={MAX_ENTITY_REVISION_SUMMARY_LENGTH}
              disabled={!editable || editor.saving}
              placeholder="Ex.: corrigi o horário que registrei por engano"
              onChange={(event) => {
                setReason(event.target.value);
                setLocalError(null);
              }}
            />
          </div>
          <button className="entity-revision-editor__save" type="submit" disabled={!canSave}>
            <FloppyDisk size={19} weight="duotone" aria-hidden="true" />
            {editor.saving ? "Salvando revisão…" : "Salvar nova revisão"}
          </button>
        </section>
      </form>

      <section className="entity-revision-editor__section entity-revision-editor__history">
        <div className="entity-revision-editor__section-title">
          <ClockCounterClockwise size={20} aria-hidden="true" />
          <div><h3>Histórico</h3><p>Versões mais recentes primeiro.</p></div>
        </div>
        <ol>
          {editor.session.history.slice(0, 8).map(({ revision, operation }) => (
            <li key={revision.id}>
              <span>{revision.revision}</span>
              <div>
                <strong>{operation ? OPERATION_LABELS[operation.kind] : "Revisão preservada"}</strong>
                <p>{revisionDetail(operation?.kind ?? null, operation?.summary ?? null, revision.reason)}</p>
                <small>{formatDateTime(revision.createdAt)}</small>
              </div>
            </li>
          ))}
        </ol>

        {editor.session.canUndo ? (
          confirmUndo ? (
            <div className="entity-revision-editor__undo-confirm" role="alert">
              <p><strong>Desfazer a última alteração?</strong><span>Uma nova revisão inversa será criada; nenhuma versão será apagada.</span></p>
              <div>
                <button type="button" onClick={() => setConfirmUndo(false)}>Cancelar</button>
                <button type="button" onClick={() => void handleUndo()} disabled={editor.saving}>Confirmar desfazer</button>
              </div>
            </div>
          ) : (
            <button
              className="entity-revision-editor__undo"
              type="button"
              disabled={editor.saving}
              onClick={() => {
                keyboard.hide();
                setConfirmUndo(true);
              }}
            >
              <ArrowCounterClockwise size={18} aria-hidden="true" />
              Desfazer última alteração
            </button>
          )
        ) : (
          <p className="entity-revision-editor__undo-unavailable">Não há uma operação compatível para desfazer.</p>
        )}
      </section>
    </section>
  );
}
