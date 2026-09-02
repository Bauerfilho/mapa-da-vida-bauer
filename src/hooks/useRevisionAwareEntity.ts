import { useCallback, useEffect, useState } from "react";
import {
  deleteEntity,
  getEntityEditSession,
  restoreEntity,
  undoEntityMutation,
  updateEntityRevisionAware,
} from "../data";
import {
  isEntityRevisionConflictError,
  type EntityEditSession,
  type EntityRevisionConflictError,
  type EntityType,
  type MentorEntity,
  type RevisionAwareEntityPatch,
  type RevisionMutationResult,
  type UndoEntityMutationResult,
} from "../domain";

export type RevisionAwareSaveInput<TType extends EntityType> = Omit<
  RevisionAwareEntityPatch<TType>,
  "entityId" | "expectedRevision"
>;

export interface RevisionAwareEntityState<TType extends EntityType> {
  session: EntityEditSession<TType> | null;
  loading: boolean;
  saving: boolean;
  error: Error | null;
  conflict: EntityRevisionConflictError | null;
  reload: () => Promise<EntityEditSession<TType>>;
  save: (
    input: RevisionAwareSaveInput<TType>,
  ) => Promise<RevisionMutationResult<TType>>;
  undoLatest: () => Promise<UndoEntityMutationResult<TType>>;
  deleteRecord: () => Promise<MentorEntity<TType>>;
  restoreRecord: () => Promise<MentorEntity<TType>>;
}

export interface UseRevisionAwareEntityOptions<TType extends EntityType> {
  expectedType?: TType;
  onChanged?: (entity: MentorEntity<TType>) => void | Promise<void>;
}

export function useRevisionAwareEntity<TType extends EntityType = EntityType>(
  entityId: string,
  options: UseRevisionAwareEntityOptions<TType> = {},
): RevisionAwareEntityState<TType> {
  const [session, setSession] = useState<EntityEditSession<TType> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [conflict, setConflict] = useState<EntityRevisionConflictError | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getEntityEditSession(entityId, options.expectedType);
      setSession(next);
      setConflict(null);
      return next;
    } catch (reason) {
      const nextError = reason instanceof Error ? reason : new Error(String(reason));
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, [entityId, options.expectedType]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getEntityEditSession(entityId, options.expectedType)
      .then((next) => {
        if (!active) return;
        setSession(next);
        setConflict(null);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason : new Error(String(reason)));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [entityId, options.expectedType]);

  const runMutation = useCallback(async <TResult extends { entity: MentorEntity<TType> }>(
    mutation: (baseline: EntityEditSession<TType>) => Promise<TResult>,
  ): Promise<TResult> => {
    if (!session) throw new Error("O registro ainda não foi carregado.");
    setSaving(true);
    setError(null);
    setConflict(null);
    let result: TResult;
    try {
      result = await mutation(session);
    } catch (reason) {
      const nextError = reason instanceof Error ? reason : new Error(String(reason));
      if (isEntityRevisionConflictError(nextError)) setConflict(nextError);
      setError(nextError);
      setSaving(false);
      throw nextError;
    }
    try {
      const next = await getEntityEditSession(entityId, options.expectedType);
      setSession(next);
      await options.onChanged?.(result.entity);
    } catch (reason) {
      // The write is already committed. Keep the successful mutation result
      // and report only that this view could not refresh, so a user is never
      // invited to repeat an operation that already happened.
      setError(reason instanceof Error ? reason : new Error(String(reason)));
    } finally {
      setSaving(false);
    }
    return result;
  }, [entityId, options.expectedType, options.onChanged, session]);

  const save = useCallback((input: RevisionAwareSaveInput<TType>) =>
    runMutation((baseline) => updateEntityRevisionAware<TType>({
      ...input,
      entityId: baseline.entity.id,
      expectedRevision: baseline.entity.revision,
    })), [runMutation]);

  const undoLatest = useCallback(() => runMutation((baseline) => {
    if (!baseline.latestOperation) {
      throw new Error("Não existe uma alteração disponível para desfazer.");
    }
    return undoEntityMutation<TType>({
      entityId: baseline.entity.id,
      expectedRevision: baseline.entity.revision,
      operationId: baseline.latestOperation.id,
    });
  }), [runMutation]);

  const deleteRecord = useCallback(() => runMutation(async (baseline) => ({
    entity: await deleteEntity<TType>({
      entityId: baseline.entity.id,
      expectedRevision: baseline.entity.revision,
    }),
  })).then((result) => result.entity), [runMutation]);

  const restoreRecord = useCallback(() => runMutation(async (baseline) => ({
    entity: await restoreEntity<TType>({
      entityId: baseline.entity.id,
      expectedRevision: baseline.entity.revision,
    }),
  })).then((result) => result.entity), [runMutation]);

  return {
    session,
    loading,
    saving,
    error,
    conflict,
    reload,
    save,
    undoLatest,
    deleteRecord,
    restoreRecord,
  };
}
