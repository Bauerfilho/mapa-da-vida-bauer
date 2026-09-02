import type {
  EntityPayloadByType,
  EntityType,
  ISOInstant,
  LocalDate,
  MentorEntity,
  OperationRecord,
  RevisionRecord,
} from "./model";

export const ENTITY_REVISION_CONFLICT = "ENTITY_REVISION_CONFLICT" as const;
export const ENTITY_UNDO_UNAVAILABLE = "ENTITY_UNDO_UNAVAILABLE" as const;
export const ENTITY_EDIT_INVALID = "ENTITY_EDIT_INVALID" as const;
export const ENTITY_USER_EDIT_REASON = "entity_user_edit" as const;
export const MAX_ENTITY_REVISION_SUMMARY_LENGTH = 240;
export const MAX_REVISION_PATCH_DEPTH = 6;
export const MAX_REVISION_PATCH_LEAVES = 64;
export const MAX_REVISION_TEXT_LENGTH = 2_000;
export const MAX_REVISION_LIST_ITEMS = 12;
const MAX_REVISION_TRAVERSAL_NODES = 512;

type JsonObject = Record<string, unknown>;

const RESERVED_REVISION_OBJECT_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const SAFE_EXACT_REVISION_PATHS: Partial<Record<EntityType, ReadonlySet<string>>> = {
  "internato.shift": new Set(["assignment.value", "location.value"]),
  "humor.energy-check-in": new Set(["note.value"]),
  // Medication identity and dose belong to the domain-specific medication
  // flow. A generic correction may only amend the narrative observation.
  "medicamentos.confirmation": new Set(["note.value"]),
  "financas.transaction": new Set(["category.value", "description.value"]),
  "financas.bill": new Set(["label", "note.value"]),
  "financas.debt": new Set(["label", "note.value"]),
  "financas.budget": new Set(["label", "note.value"]),
  "financas.goal": new Set(["label", "note.value"]),
  "financas.card": new Set(["label", "note.value"]),
  "agenda.task": new Set(["title", "note.value"]),
  "agenda.event": new Set(["title", "note.value"]),
  "agenda.goal-set": new Set(["minimum", "good", "gold", "note.value"]),
  "rotina.daily-closure": new Set(["summary.value"]),
};

const SAFE_GENERIC_REVISION_KEYS = new Set([
  "application",
  "area",
  "capture",
  "context",
  "description",
  "feedback",
  "label",
  "location",
  "memo",
  "name",
  "nextaction",
  "note",
  "notes",
  "objective",
  "openquestion",
  "reference",
  "role",
  "summary",
  "tags",
  "title",
]);

export interface RevisionPayloadPatchValidation {
  valid: boolean;
  changed: boolean;
  error?: string;
}

/**
 * A recursive patch deliberately has no delete sentinel. Omitted and
 * `undefined` fields mean "preserve the stored value"; arrays and knowledge
 * states are atomic replacements. That makes schema-forward edits safe: a
 * client that does not know a newer field cannot erase it accidentally.
 */
export type PreserveUnknownPatch<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: PreserveUnknownPatch<T[K]> }
    : T;

export interface RevisionAwareEntityPatch<TType extends EntityType = EntityType> {
  entityId: string;
  expectedRevision: number;
  payloadPatch?: PreserveUnknownPatch<EntityPayloadByType[TType]>;
  localDate?: LocalDate;
  occurredAtUTC?: ISOInstant;
  /** Human-readable audit text; required so a revision never becomes opaque. */
  summary: string;
  /**
   * @deprecated Public callers cannot select the stored audit reason. This
   * legacy input is ignored and every user edit is recorded canonically as
   * `ENTITY_USER_EDIT_REASON`.
   */
  reason?: string;
  committedAtUTC?: ISOInstant;
}

export interface UndoEntityMutationInput {
  entityId: string;
  expectedRevision: number;
  /** When supplied, it must still be the operation that produced the current revision. */
  operationId?: string;
  committedAtUTC?: ISOInstant;
}

export interface RevisionMutationResult<TType extends EntityType = EntityType> {
  entity: MentorEntity<TType>;
  operation: OperationRecord;
  revision: RevisionRecord;
}

export interface UndoEntityMutationResult<TType extends EntityType = EntityType>
  extends RevisionMutationResult<TType> {
  undoneOperation: OperationRecord;
}

export interface EntityRevisionHistoryItem {
  revision: RevisionRecord;
  operation: OperationRecord | null;
}

export interface EntityEditSession<TType extends EntityType = EntityType> {
  entity: MentorEntity<TType>;
  history: EntityRevisionHistoryItem[];
  latestOperation: OperationRecord | null;
  canUndo: boolean;
}

export class EntityRevisionConflictError<TType extends EntityType = EntityType>
  extends Error {
  readonly code = ENTITY_REVISION_CONFLICT;

  constructor(
    readonly entityId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
    readonly currentEntity: MentorEntity<TType>,
  ) {
    super(
      `O registro mudou da revisão ${expectedRevision} para a ${actualRevision}. ` +
        "Sua edição não foi aplicada.",
    );
    this.name = "EntityRevisionConflictError";
  }
}

export class EntityUndoUnavailableError extends Error {
  readonly code = ENTITY_UNDO_UNAVAILABLE;

  constructor(message: string) {
    super(message);
    this.name = "EntityUndoUnavailableError";
  }
}

export class EntityEditValidationError extends Error {
  readonly code = ENTITY_EDIT_INVALID;

  constructor(message: string) {
    super(message);
    this.name = "EntityEditValidationError";
  }
}

export function isEntityRevisionConflictError(
  value: unknown,
): value is EntityRevisionConflictError {
  if (!value || typeof value !== "object") return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "code");
    return Boolean(
      descriptor &&
        "value" in descriptor &&
        descriptor.value === ENTITY_REVISION_CONFLICT,
    );
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function isUnsafeRevisionObjectKey(value: string): boolean {
  return RESERVED_REVISION_OBJECT_KEYS.has(value.toLowerCase());
}

function normalizedRevisionKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function semanticRevisionKey(path: readonly string[]): string {
  const finalIndex = path.length - 1;
  const semanticIndex = path[finalIndex] === "value" ? finalIndex - 1 : finalIndex;
  return normalizedRevisionKey(path[semanticIndex] ?? "");
}

function isDenseRevisionArray(value: readonly unknown[]): boolean {
  try {
    if (Object.keys(value).length !== value.length) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isRevisionTextValue(value: unknown): value is string | string[] {
  return (
    typeof value === "string" &&
    value.length <= MAX_REVISION_TEXT_LENGTH
  ) || (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_REVISION_LIST_ITEMS &&
    isDenseRevisionArray(value) &&
    value.every((item) =>
      typeof item === "string" &&
      item.trim().length > 0 &&
      item.length <= MAX_REVISION_TEXT_LENGTH
    )
  );
}

function sameRevisionTextValue(left: string | string[], right: string | string[]): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((item, index) => item === right[index]);
  }
  return left === right;
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (
      isUnsafeRevisionObjectKey(segment) ||
      !isPlainObject(current) ||
      !Object.hasOwn(current, segment)
    ) return undefined;
    current = current[segment];
  }
  return current;
}

interface RevisionPatchLeaf {
  path: string[];
  value: unknown;
}

type RevisionPatchTraversal =
  | { leaves: RevisionPatchLeaf[]; error?: never }
  | { leaves?: never; error: string };

function patchLeaves(
  value: unknown,
): RevisionPatchTraversal {
  const leaves: RevisionPatchLeaf[] = [];
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; path: string[] }> = [{ value, path: [] }];
  let traversedNodes = 0;

  while (stack.length) {
    const current = stack.pop()!;
    if (current.value === undefined) continue;
    traversedNodes += 1;
    if (traversedNodes > MAX_REVISION_TRAVERSAL_NODES) {
      return { error: "A alteração possui uma estrutura ampla demais para edição segura." };
    }
    if (current.path.length > MAX_REVISION_PATCH_DEPTH) {
      return {
        error: `A alteração ultrapassa o limite seguro de ${MAX_REVISION_PATCH_DEPTH} níveis.`,
      };
    }
    if (isPlainObject(current.value)) {
      if (seen.has(current.value)) {
        return { error: "A alteração contém uma referência circular ou repetida." };
      }
      seen.add(current.value);
      let keys: string[];
      try {
        keys = Object.keys(current.value);
      } catch {
        return { error: "Não foi possível validar a estrutura da alteração." };
      }
      if (traversedNodes + stack.length + keys.length > MAX_REVISION_TRAVERSAL_NODES) {
        return { error: "A alteração possui uma estrutura ampla demais para edição segura." };
      }
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index]!;
        if (isUnsafeRevisionObjectKey(key)) {
          return { error: `O campo reservado ${key} não pode ser alterado.` };
        }
        const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
        if (!descriptor || !("value" in descriptor)) {
          return { error: `O campo ${key} não possui uma estrutura de dados segura.` };
        }
        stack.push({ value: descriptor.value, path: [...current.path, key] });
      }
      continue;
    }
    if (current.path.length === 0) {
      return { error: "A alteração precisa preservar a estrutura atual do registro." };
    }
    leaves.push({ path: current.path, value: current.value });
    if (leaves.length > MAX_REVISION_PATCH_LEAVES) {
      return {
        error: `Altere no máximo ${MAX_REVISION_PATCH_LEAVES} campos por revisão.`,
      };
    }
  }

  return { leaves };
}

/**
 * The generic editor deliberately exposes only narrative strings and short
 * string lists. Numeric measurements, enums, times, money and structural
 * fields require their domain-specific editor so their invariants cannot be
 * bypassed by the revision API.
 */
export function isRevisionPayloadLeafEditable(
  type: EntityType,
  path: readonly string[],
  value: unknown,
  currentPayload?: unknown,
): boolean {
  if (
    path.length === 0 ||
    path.length > MAX_REVISION_PATCH_DEPTH ||
    path.some(isUnsafeRevisionObjectKey)
  ) return false;
  if (!isRevisionTextValue(value)) return false;
  const serializedPath = path.join(".");
  if (type === "generic.event") {
    if (isPlainObject(currentPayload) && currentPayload.schema === "agenda-annual-date-v1") return ["label", "note.value"].includes(serializedPath);
    if (isPlainObject(currentPayload) && currentPayload.schema === "laboratory-panel-v1") return ["title.value", "note.value"].includes(serializedPath);
    return SAFE_GENERIC_REVISION_KEYS.has(semanticRevisionKey(path));
  }
  return SAFE_EXACT_REVISION_PATHS[type]?.has(serializedPath) ?? false;
}

/** Civil dates require their domain-specific flow in the safest release. */
export function isRevisionLocalDateEditable(_type: EntityType): boolean {
  return false;
}

/**
 * Validates an untrusted recursive patch against the same conservative policy
 * used by the UI. Existing and replacement values must keep the same textual
 * shape; a patch cannot add fields or replace a Knowledge state.
 */
export function validateRevisionPayloadPatch(
  type: EntityType,
  currentPayload: unknown,
  patch: unknown,
): RevisionPayloadPatchValidation {
  if (!isPlainObject(currentPayload) || !isPlainObject(patch)) {
    return {
      valid: false,
      changed: false,
      error: "A alteração precisa preservar a estrutura atual do registro.",
    };
  }
  const traversal = patchLeaves(patch);
  if ("error" in traversal) {
    return {
      valid: false,
      changed: false,
      error: traversal.error,
    };
  }
  const leaves = traversal.leaves;
  if (leaves.length === 0) {
    return {
      valid: false,
      changed: false,
      error: "Nenhum campo editável foi informado.",
    };
  }

  let changed = false;
  for (const leaf of leaves) {
    const currentValue = valueAtPath(currentPayload, leaf.path);
    if (
      !isRevisionTextValue(currentValue) ||
      !isRevisionPayloadLeafEditable(type, leaf.path, currentValue, currentPayload)
    ) {
      return {
        valid: false,
        changed: false,
        error: `O campo ${leaf.path.join(".")} exige o editor específico do domínio.`,
      };
    }
    if (Array.isArray(leaf.value) && leaf.value.length === 0) {
      return {
        valid: false,
        changed: false,
        error: `O campo ${leaf.path.join(".")} precisa manter pelo menos um item.`,
      };
    }
    if (!isRevisionTextValue(leaf.value)) {
      return {
        valid: false,
        changed: false,
        error: `O campo ${leaf.path.join(".")} aceita apenas texto seguro.`,
      };
    }
    if (Array.isArray(currentValue) !== Array.isArray(leaf.value)) {
      return {
        valid: false,
        changed: false,
        error: `O campo ${leaf.path.join(".")} precisa manter o formato original.`,
      };
    }
    if (typeof leaf.value === "string" && leaf.value.trim().length === 0) {
      return {
        valid: false,
        changed: false,
        error: `O campo ${leaf.path.join(".")} não pode virar um texto vazio.`,
      };
    }
    if (!sameRevisionTextValue(currentValue, leaf.value)) changed = true;
  }

  return { valid: true, changed };
}

function isKnowledgeState(value: JsonObject): boolean {
  return (
    typeof value.state === "string" &&
    ["known", "unknown", "confirmed_absent", "not_applicable", "invalid"].includes(
      value.state,
    )
  );
}

function assertSafeRevisionMergeGraph(value: unknown): void {
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let leaves = 0;
  let traversedNodes = 0;

  while (stack.length) {
    const current = stack.pop()!;
    if (current.value === undefined) continue;
    traversedNodes += 1;
    if (traversedNodes > MAX_REVISION_TRAVERSAL_NODES) {
      throw new EntityEditValidationError(
        "A alteração possui uma estrutura ampla demais para edição segura.",
      );
    }
    if (current.depth > MAX_REVISION_PATCH_DEPTH) {
      throw new EntityEditValidationError(
        `A alteração ultrapassa o limite seguro de ${MAX_REVISION_PATCH_DEPTH} níveis.`,
      );
    }
    if (current.value && typeof current.value === "object") {
      if (seen.has(current.value)) {
        throw new EntityEditValidationError(
          "A alteração contém uma referência circular ou repetida.",
        );
      }
      seen.add(current.value);
      if (Array.isArray(current.value)) {
        if (!isDenseRevisionArray(current.value)) {
          throw new EntityEditValidationError(
            "A alteração contém uma lista esparsa ou com campos não permitidos.",
          );
        }
        if (
          traversedNodes + stack.length + current.value.length >
            MAX_REVISION_TRAVERSAL_NODES
        ) {
          throw new EntityEditValidationError(
            "A alteração possui uma estrutura ampla demais para edição segura.",
          );
        }
        for (const child of current.value) {
          stack.push({ value: child, depth: current.depth + 1 });
        }
        continue;
      }
      if (!isPlainObject(current.value)) {
        throw new EntityEditValidationError(
          "A alteração precisa usar apenas estruturas de dados simples.",
        );
      }
      const keys = Object.keys(current.value);
      if (traversedNodes + stack.length + keys.length > MAX_REVISION_TRAVERSAL_NODES) {
        throw new EntityEditValidationError(
          "A alteração possui uma estrutura ampla demais para edição segura.",
        );
      }
      for (const key of keys) {
        if (isUnsafeRevisionObjectKey(key)) {
          throw new EntityEditValidationError(
            `O campo reservado ${key} não pode ser alterado.`,
          );
        }
        const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
        if (!descriptor || !("value" in descriptor)) {
          throw new EntityEditValidationError(
            `O campo ${key} não possui uma estrutura de dados segura.`,
          );
        }
        stack.push({ value: descriptor.value, depth: current.depth + 1 });
      }
      continue;
    }
    if (typeof current.value === "string" && current.value.length > MAX_REVISION_TEXT_LENGTH) {
      throw new EntityEditValidationError(
        `Cada texto pode ter no máximo ${MAX_REVISION_TEXT_LENGTH} caracteres.`,
      );
    }
    leaves += 1;
    if (leaves > MAX_REVISION_PATCH_LEAVES) {
      throw new EntityEditValidationError(
        `Altere no máximo ${MAX_REVISION_PATCH_LEAVES} campos por revisão.`,
      );
    }
  }
}

function mergePreservingUnknownUnchecked<T>(
  current: T,
  patch: PreserveUnknownPatch<T>,
): T {
  if (patch === undefined) return current;
  if (Array.isArray(patch)) return [...patch] as T;
  if (!isPlainObject(patch)) return patch as T;

  // Knowledge<T> is a discriminated fact. Mixing properties from two states
  // could create an invalid fact (for example `unknown` carrying an old value).
  if (isKnowledgeState(patch)) return { ...patch } as T;

  const currentRecord: JsonObject = isPlainObject(current) ? current : {};
  const result: JsonObject = { ...currentRecord };
  for (const [key, nextValue] of Object.entries(patch)) {
    if (nextValue === undefined) continue;
    const previousValue = Object.hasOwn(currentRecord, key)
      ? currentRecord[key]
      : undefined;
    result[key] = isPlainObject(nextValue) && !isKnowledgeState(nextValue)
      ? mergePreservingUnknownUnchecked(previousValue, nextValue)
      : Array.isArray(nextValue)
        ? [...nextValue]
        : nextValue;
  }
  return result as T;
}

/** Pure, non-mutating merge used by the repository and independently tested. */
export function mergePreservingUnknown<T>(current: T, patch: PreserveUnknownPatch<T>): T {
  assertSafeRevisionMergeGraph(patch);
  return mergePreservingUnknownUnchecked(current, patch);
}

export function revisionConflictMessage(error: EntityRevisionConflictError): string {
  return (
    `Este registro já está na revisão ${error.actualRevision}. ` +
    "Nada foi sobrescrito; carregue a versão atual antes de salvar novamente."
  );
}
