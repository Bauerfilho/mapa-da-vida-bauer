import {
  isRevisionPayloadLeafEditable,
  isUnsafeRevisionObjectKey,
  MAX_REVISION_LIST_ITEMS,
  MAX_REVISION_PATCH_DEPTH,
  MAX_REVISION_PATCH_LEAVES,
  MAX_REVISION_TEXT_LENGTH,
  type EntityType,
} from "../domain";

const HIDDEN_STRUCTURAL_KEYS = new Set([
  "schema",
  "schemaversion",
  "eventkind",
  "recordmode",
  "status",
]);
const MAX_REVISION_FIELD_SCAN_NODES = 512;

type Scalar = string | number | boolean;
type EditableValue = Scalar | Scalar[];
type UnknownRecord = Record<string, unknown>;

export type EditableLeafKind = "string" | "number" | "boolean" | "list";

export interface EditablePayloadLeaf {
  id: string;
  path: string[];
  label: string;
  kind: EditableLeafKind;
  value: EditableValue;
  listItemKind?: Exclude<EditableLeafKind, "list">;
  multiline: boolean;
}

export interface EditableLeafChange {
  id: string;
  label: string;
  before: string;
  after: string;
}

export interface PayloadPatchPlan {
  payloadPatch: Record<string, unknown>;
  changes: EditableLeafChange[];
  errors: Record<string, string>;
}

const PORTUGUESE_LABELS: Record<string, string> = {
  active: "Ativo",
  actualminutes: "Minutos realizados",
  actualtimelocal: "Horário realizado",
  amount: "Valor",
  category: "Categoria",
  completed: "Concluído",
  correct: "Acertos",
  dose: "Dose",
  doselabel: "Dose informada",
  durationminutes: "Duração em minutos",
  energy: "Energia",
  intensity: "Intensidade",
  location: "Local",
  medicationname: "Medicamento",
  minutes: "Minutos",
  mood: "Humor",
  note: "Observação",
  notes: "Observações",
  plannedminutes: "Minutos planejados",
  provider: "Instituição",
  scheduledtimelocal: "Horário previsto",
  summary: "Resumo",
  tags: "Marcadores",
  title: "Título",
  topic: "Tema",
  topics: "Temas",
};

function isPlainObject(value: unknown): value is UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function isScalar(value: unknown): value is Scalar {
  return ["string", "number", "boolean"].includes(typeof value) &&
    (typeof value !== "number" || Number.isFinite(value));
}

function isKnowledgeRecord(value: UnknownRecord): boolean {
  if (!Object.hasOwn(value, "state")) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, "state");
  return Boolean(descriptor && "value" in descriptor && typeof descriptor.value === "string" && [
    "known",
    "unknown",
    "confirmed_absent",
    "not_applicable",
    "invalid",
  ].includes(descriptor.value));
}

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function isStructuralRevisionField(key: string): boolean {
  return isUnsafeRevisionObjectKey(key) || HIDDEN_STRUCTURAL_KEYS.has(normalizedKey(key));
}

function humanizeKey(key: string): string {
  const normalized = normalizedKey(key);
  const translated = PORTUGUESE_LABELS[normalized];
  if (translated) return translated;
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced
    ? spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
    : "Campo";
}

function pathId(path: readonly string[]): string {
  return path
    .map((segment) => segment.replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("/");
}

function scalarKind(value: Scalar): Exclude<EditableLeafKind, "list"> {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  return "boolean";
}

function homogeneousScalarList(value: unknown[]): {
  values: Scalar[];
  itemKind: Exclude<EditableLeafKind, "list">;
} | null {
  if (value.length > MAX_REVISION_LIST_ITEMS || !value.every(isScalar)) return null;
  if (value.length === 0) return null;
  const itemKind = scalarKind(value[0] as Scalar);
  if (!value.every((item) => scalarKind(item as Scalar) === itemKind)) return null;
  return { values: value as Scalar[], itemKind };
}

function makeLeaf(path: string[], value: unknown): EditablePayloadLeaf | null {
  const label = humanizeKey(path[path.length - 1] ?? "campo");
  if (isScalar(value)) {
    return {
      id: pathId(path),
      path,
      label,
      kind: scalarKind(value),
      value,
      multiline: typeof value === "string" && (value.length > 90 || value.includes("\n")),
    };
  }
  if (Array.isArray(value)) {
    const list = homogeneousScalarList(value);
    if (!list) return null;
    return {
      id: pathId(path),
      path,
      label,
      kind: "list",
      listItemKind: list.itemKind,
      value: list.values,
      multiline: true,
    };
  }
  return null;
}

/**
 * Discovers only facts this generic editor can safely round-trip. Unknown
 * Knowledge states, objects, long/heterogeneous lists and structural fields
 * remain stored but never become generic controls.
 */
export function collectEditablePayloadLeaves(
  type: EntityType,
  payload: unknown,
): EditablePayloadLeaf[] {
  if (!isPlainObject(payload)) return [];
  const leaves: EditablePayloadLeaf[] = [];
  const seen = new WeakSet<object>();
  let invalidStructure = false;
  let visitedNodes = 0;

  const visit = (value: unknown, path: string[], depth: number): void => {
    if (
      invalidStructure ||
      depth > MAX_REVISION_PATCH_DEPTH ||
      leaves.length >= MAX_REVISION_PATCH_LEAVES
    ) return;
    visitedNodes += 1;
    if (visitedNodes > MAX_REVISION_FIELD_SCAN_NODES) {
      invalidStructure = true;
      return;
    }
    const direct = makeLeaf(path, value);
    if (direct) {
      if (isRevisionPayloadLeafEditable(type, direct.path, direct.value, payload)) {
        leaves.push(direct);
      }
      return;
    }
    if (!isPlainObject(value)) return;
    if (seen.has(value)) {
      invalidStructure = true;
      return;
    }
    seen.add(value);
    let keys: string[];
    try {
      keys = Object.keys(value);
    } catch {
      invalidStructure = true;
      return;
    }
    if (visitedNodes + keys.length > MAX_REVISION_FIELD_SCAN_NODES) {
      invalidStructure = true;
      return;
    }
    if (keys.some(isUnsafeRevisionObjectKey)) {
      invalidStructure = true;
      return;
    }
    if (isKnowledgeRecord(value)) {
      const stateDescriptor = Object.getOwnPropertyDescriptor(value, "state");
      if (!stateDescriptor || !("value" in stateDescriptor) || stateDescriptor.value !== "known") {
        return;
      }
      const valueDescriptor = Object.getOwnPropertyDescriptor(value, "value");
      if (!valueDescriptor || !("value" in valueDescriptor)) {
        invalidStructure = true;
        return;
      }
      const knownLeaf = makeLeaf([...path, "value"], valueDescriptor.value);
      if (
        knownLeaf &&
        isRevisionPayloadLeafEditable(type, knownLeaf.path, knownLeaf.value, payload)
      ) {
        leaves.push({ ...knownLeaf, id: pathId([...path, "value"]), label: humanizeKey(path.at(-1) ?? "campo") });
      }
      return;
    }
    for (const key of keys) {
      if (isStructuralRevisionField(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        invalidStructure = true;
        return;
      }
      visit(descriptor.value, [...path, key], depth + 1);
    }
  };

  visit(payload, [], 0);
  if (invalidStructure) return [];
  return leaves.sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
}

export function editableLeafDraftValue(leaf: EditablePayloadLeaf): string {
  if (leaf.kind === "boolean") return leaf.value ? "true" : "false";
  if (leaf.kind === "list") return (leaf.value as Scalar[]).map(String).join("\n");
  return String(leaf.value);
}

function parseBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (["true", "sim", "1"].includes(normalized)) return true;
  if (["false", "não", "nao", "0"].includes(normalized)) return false;
  return null;
}

function parseDraft(leaf: EditablePayloadLeaf, draft: string): EditableValue | Error {
  if (leaf.kind === "string") {
    if (!draft.trim()) return new Error("O texto não pode ficar vazio.");
    if (draft.length > MAX_REVISION_TEXT_LENGTH) {
      return new Error(`Use no máximo ${MAX_REVISION_TEXT_LENGTH} caracteres.`);
    }
    return draft;
  }
  if (leaf.kind === "number") {
    const normalized = draft.trim().replace(",", ".");
    const value = Number(normalized);
    return normalized && Number.isFinite(value)
      ? value
      : new Error("Informe um número válido.");
  }
  if (leaf.kind === "boolean") {
    const value = parseBoolean(draft);
    return value === null ? new Error("Escolha sim ou não.") : value;
  }

  const rows = draft
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean);
  if (rows.length === 0) {
    return new Error("A lista precisa manter pelo menos um item.");
  }
  if (rows.length > MAX_REVISION_LIST_ITEMS) {
    return new Error(`Use no máximo ${MAX_REVISION_LIST_ITEMS} itens.`);
  }
  if (rows.some((row) => row.length > MAX_REVISION_TEXT_LENGTH)) {
    return new Error(
      `Cada item pode ter no máximo ${MAX_REVISION_TEXT_LENGTH} caracteres.`,
    );
  }
  if (leaf.listItemKind === "number") {
    const numbers = rows.map((row) => Number(row.replace(",", ".")));
    return numbers.every(Number.isFinite)
      ? numbers
      : new Error("Cada linha precisa ser um número válido.");
  }
  if (leaf.listItemKind === "boolean") {
    const booleans = rows.map(parseBoolean);
    return booleans.every((value) => value !== null)
      ? booleans as boolean[]
      : new Error("Cada linha precisa ser sim ou não.");
  }
  return rows;
}

function sameValue(left: EditableValue, right: EditableValue): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((item, index) => item === right[index]);
  }
  return left === right;
}

function setNested(
  target: UnknownRecord,
  path: readonly string[],
  value: EditableValue,
): boolean {
  if (
    path.length === 0 ||
    path.length > MAX_REVISION_PATCH_DEPTH ||
    path.some(isUnsafeRevisionObjectKey)
  ) return false;
  let cursor = target;
  path.forEach((segment, index) => {
    if (index === path.length - 1) {
      cursor[segment] = value;
      return;
    }
    const next = Object.hasOwn(cursor, segment) ? cursor[segment] : undefined;
    if (!isPlainObject(next)) cursor[segment] = {};
    cursor = cursor[segment] as UnknownRecord;
  });
  return true;
}

export function formatEditableRevisionValue(value: EditableValue): string {
  if (Array.isArray(value)) return value.length ? value.map(String).join(", ") : "lista vazia";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value) || "vazio";
}

export function planEditablePayloadPatch(
  leaves: readonly EditablePayloadLeaf[],
  drafts: Readonly<Record<string, string>>,
): PayloadPatchPlan {
  const payloadPatch: UnknownRecord = Object.create(null) as UnknownRecord;
  const changes: EditableLeafChange[] = [];
  const errors: Record<string, string> = Object.create(null) as Record<string, string>;

  if (leaves.length > MAX_REVISION_PATCH_LEAVES) {
    errors.$payload = `Altere no máximo ${MAX_REVISION_PATCH_LEAVES} campos por revisão.`;
  }

  for (const leaf of leaves.slice(0, MAX_REVISION_PATCH_LEAVES)) {
    if (
      leaf.path.length === 0 ||
      leaf.path.length > MAX_REVISION_PATCH_DEPTH ||
      leaf.path.some(isUnsafeRevisionObjectKey)
    ) {
      errors[leaf.id] = "Este campo não possui um caminho seguro para edição.";
      continue;
    }
    const draft = Object.hasOwn(drafts, leaf.id)
      ? drafts[leaf.id]!
      : editableLeafDraftValue(leaf);
    const parsed = parseDraft(leaf, draft);
    if (parsed instanceof Error) {
      errors[leaf.id] = parsed.message;
      continue;
    }
    if (sameValue(leaf.value, parsed)) continue;
    if (!setNested(payloadPatch, leaf.path, parsed)) {
      errors[leaf.id] = "Este campo não possui um caminho seguro para edição.";
      continue;
    }
    changes.push({
      id: leaf.id,
      label: leaf.label,
      before: formatEditableRevisionValue(leaf.value),
      after: formatEditableRevisionValue(parsed),
    });
  }
  return { payloadPatch, changes, errors };
}
