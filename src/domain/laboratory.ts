import { assertLocalDate, inclusiveDateWindow, shiftLocalDate } from "./dates";
import { known, unknown as notRecorded, type GenericPayload, type Knowledge, type LocalDate, type MentorEntity } from "./model";

export const LABORATORY_SCHEMA = "laboratory-panel-v1" as const;
export const LAB_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
export const LAB_PANEL_MAX_BYTES = 8 * 1024 * 1024;
export type LaboratoryValue = { kind: "numeric"; value: number; comparator: "eq" | "lt" | "le" | "gt" | "ge" } | { kind: "text"; value: string };
export interface LaboratoryResult {
  id: string;
  analyte: string;
  value: Knowledge<LaboratoryValue>;
  unit: Knowledge<string>;
  referenceText: Knowledge<string>;
  referenceLow: Knowledge<number>;
  referenceHigh: Knowledge<number>;
}
export interface LaboratoryAttachment {
  id: string; name: string; mimeType: "application/pdf" | "image/png" | "image/jpeg";
  size: number; sha256: string; dataBase64: string;
}
export interface LaboratoryPanelPayload extends GenericPayload {
  schema: typeof LABORATORY_SCHEMA;
  eventKind: "laboratory-panel";
  title: Knowledge<string>;
  collectedOn: LocalDate;
  reportedOn: Knowledge<LocalDate>;
  laboratory: Knowledge<string>;
  results: LaboratoryResult[];
  attachments: LaboratoryAttachment[];
  note: Knowledge<string>;
}
export type LaboratoryPanelEntity = MentorEntity<"generic.event"> & { payload: LaboratoryPanelPayload };
export interface LaboratoryPanelInput {
  title: string; collectedOn: string; reportedOn?: string; referenceDate: string;
  laboratory?: string; note?: string; attachments?: LaboratoryAttachment[];
  results: Array<{ id?: string; analyte: string; value: string; kind: "numeric" | "text"; unit?: string; referenceText?: string; referenceLow?: string; referenceHigh?: string }>;
}

const attachmentTypes = ["application/pdf", "image/png", "image/jpeg"];
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));
const nonEmpty = (value: unknown, max = 200): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const dateIsValid = (value: unknown): value is LocalDate => {
  if (typeof value !== "string") return false;
  try { assertLocalDate(value); return true; } catch { return false; }
};
function knowledgeIs<T>(value: unknown, check: (candidate: unknown) => candidate is T): value is Knowledge<T> {
  if (!record(value)) return false;
  if (value.state === "known") return onlyKeys(value, ["state", "value", "source", "recordedAt"]) && (value.recordedAt === undefined || typeof value.recordedAt === "string") && check(value.value) && ["user", "confirmed_schedule", "imported", "derived"].includes(String(value.source));
  return value.state === "unknown" && onlyKeys(value, ["state", "reason"]) && ["not_recorded", "not_confirmed", "not_provided", "legacy_ambiguous", "withheld", "conflict"].includes(String(value.reason));
}
function requireText(value: string, label: string, max = 200): string {
  if (!nonEmpty(value.trim(), max)) throw new Error(`${label}: informe até ${max} caracteres.`);
  return value.trim();
}
function optionalText(value: string | undefined, max = 1000): Knowledge<string> {
  const trimmed = value?.trim();
  return trimmed ? known(requireText(trimmed, "Texto", max)) : notRecorded("not_provided");
}
function decimal(value: string): number {
  const trimmed = value.trim();
  // Ponto e vírgula representam decimais. Separadores de milhar não são inferidos.
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(trimmed)) throw new Error("Use um número sem separador de milhar; vírgula ou ponto indicam decimais.");
  const result = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(result)) throw new Error("O resultado precisa ser um número finito.");
  return result;
}
function optionalNumber(value?: string): Knowledge<number> {
  return value?.trim() ? known(decimal(value)) : notRecorded("not_provided");
}
function parseValue(value: string, kind: "numeric" | "text"): Knowledge<LaboratoryValue> {
  if (!value.trim()) return notRecorded("not_recorded");
  if (kind === "text") return known({ kind, value: requireText(value, "Resultado textual", 500) });
  const match = /^(<=|>=|<|>|≤|≥)?\s*(.*)$/.exec(value.trim())!;
  const comparators = { "<": "lt", "<=": "le", "≤": "le", ">": "gt", ">=": "ge", "≥": "ge" } as const;
  return known({ kind, value: decimal(match[2]), comparator: match[1] ? comparators[match[1] as keyof typeof comparators] : "eq" });
}

export function buildLaboratoryPanel(input: LaboratoryPanelInput): LaboratoryPanelPayload {
  assertLocalDate(input.collectedOn); assertLocalDate(input.referenceDate);
  if (input.results.length === 0 && !input.attachments?.length) throw new Error("Anexe um laudo ou transcreva pelo menos um resultado.");
  if (input.collectedOn > input.referenceDate) throw new Error("A coleta não pode estar no futuro. Um exame solicitado ainda não é um resultado.");
  if (input.reportedOn) {
    assertLocalDate(input.reportedOn);
    if (input.reportedOn < input.collectedOn || input.reportedOn > input.referenceDate) throw new Error("A emissão precisa estar entre a coleta e hoje.");
  }
  const payload: LaboratoryPanelPayload = {
    schema: LABORATORY_SCHEMA, eventKind: "laboratory-panel",
    title: known(requireText(input.title, "Título do painel")), collectedOn: input.collectedOn,
    reportedOn: input.reportedOn ? known(input.reportedOn as LocalDate) : notRecorded("not_provided"),
    laboratory: optionalText(input.laboratory, 200), note: optionalText(input.note, 2000),
    results: input.results.map((item, index) => ({
      id: item.id ?? `result-${index + 1}`, analyte: requireText(item.analyte, "Nome do exame", 120),
      value: parseValue(item.value, item.kind), unit: optionalText(item.unit, 60),
      referenceText: optionalText(item.referenceText, 500), referenceLow: optionalNumber(item.referenceLow), referenceHigh: optionalNumber(item.referenceHigh),
    })),
    attachments: (input.attachments ?? []).map((attachment) => ({ ...attachment })),
  };
  if (!isLaboratoryPanelPayload(payload)) throw new Error("Revise os resultados, o intervalo de referência e os anexos do painel.");
  return payload;
}

function valueIs(value: unknown): value is LaboratoryValue {
  return record(value) && (
    (value.kind === "numeric" && onlyKeys(value, ["kind", "value", "comparator"]) && finite(value.value) && ["eq", "lt", "le", "gt", "ge"].includes(String(value.comparator))) ||
    (value.kind === "text" && onlyKeys(value, ["kind", "value"]) && nonEmpty(value.value, 500))
  );
}
function attachmentIs(value: unknown): value is LaboratoryAttachment {
  if (!record(value) || !onlyKeys(value, ["id", "name", "mimeType", "size", "sha256", "dataBase64"]) || !nonEmpty(value.id, 100) || !nonEmpty(value.name, 180) || !attachmentTypes.includes(String(value.mimeType)) ||
    !Number.isSafeInteger(value.size) || Number(value.size) < 1 || Number(value.size) > LAB_ATTACHMENT_MAX_BYTES ||
    typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.dataBase64 !== "string") return false;
  const encoded = value.dataBase64;
  if (!encoded || encoded.length > 4 * Math.ceil(LAB_ATTACHMENT_MAX_BYTES / 3) || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return false;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return encoded.length * 3 / 4 - padding === value.size;
}

// Validação síncrona reaproveitada no banco, na restauração e antes de qualquer exibição.
export function isLaboratoryPanelPayload(value: unknown): value is LaboratoryPanelPayload {
  if (!record(value) || !onlyKeys(value, ["schema", "eventKind", "title", "collectedOn", "reportedOn", "laboratory", "results", "attachments", "note"]) || value.schema !== LABORATORY_SCHEMA || value.eventKind !== "laboratory-panel" || !dateIsValid(value.collectedOn) ||
    !knowledgeIs(value.title, (item): item is string => nonEmpty(item)) || (value.title as Knowledge<string>).state !== "known" ||
    !knowledgeIs(value.reportedOn, dateIsValid) || !knowledgeIs(value.laboratory, (item): item is string => nonEmpty(item)) ||
    !knowledgeIs(value.note, (item): item is string => nonEmpty(item, 2000)) ||
    !Array.isArray(value.results) || value.results.length > 64 || !Array.isArray(value.attachments) || value.attachments.length > 8) return false;
  if (value.results.length === 0 && value.attachments.length === 0) return false;
  if (value.reportedOn.state === "known" && value.reportedOn.value < value.collectedOn) return false;
  const ids = new Set<string>();
  for (const item of value.results) {
    if (!record(item) || !onlyKeys(item, ["id", "analyte", "value", "unit", "referenceText", "referenceLow", "referenceHigh"]) || !nonEmpty(item.id, 100) || ids.has(item.id) || !nonEmpty(item.analyte, 120) ||
      !knowledgeIs(item.value, valueIs) || !knowledgeIs(item.unit, (candidate): candidate is string => nonEmpty(candidate, 60)) ||
      !knowledgeIs(item.referenceText, (candidate): candidate is string => nonEmpty(candidate, 500)) ||
      !knowledgeIs(item.referenceLow, finite) || !knowledgeIs(item.referenceHigh, finite)) return false;
    if (item.referenceLow.state === "known" && item.referenceHigh.state === "known" && item.referenceLow.value > item.referenceHigh.value) return false;
    ids.add(item.id);
  }
  const attachmentIds = new Set<string>();
  let bytes = 0;
  for (const attachment of value.attachments) {
    if (!attachmentIs(attachment) || attachmentIds.has(attachment.id)) return false;
    bytes += attachment.size; attachmentIds.add(attachment.id);
  }
  return bytes <= LAB_PANEL_MAX_BYTES;
}

export function isLaboratoryPanelEntity(value: MentorEntity): value is LaboratoryPanelEntity {
  return value.type === "generic.event" && String(value.domain) === "exames" && isLaboratoryPanelPayload(value.payload);
}
const bytesFromBase64 = (base64: string) => Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
const digestHex = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
function matchesFileSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === "application/pdf") return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
}

export async function createLaboratoryAttachment(file: File): Promise<LaboratoryAttachment> {
  if (!attachmentTypes.includes(file.type)) throw new Error("Anexe somente PDF, PNG ou JPEG. HTML e SVG não são aceitos.");
  if (file.size < 1 || file.size > LAB_ATTACHMENT_MAX_BYTES) throw new Error("Cada laudo pode ter até 3 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesFileSignature(bytes, file.type)) throw new Error("O conteúdo do arquivo não corresponde ao formato informado.");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return { id: crypto.randomUUID(), name: requireText(file.name, "Nome do arquivo", 180), mimeType: file.type as LaboratoryAttachment["mimeType"], size: bytes.length, sha256: await digestHex(bytes), dataBase64: btoa(binary) };
}

// Conferir só o checksum do JSON não prova que os bytes anexados correspondem ao laudo original.
export async function verifyLaboratoryAttachments(payload: LaboratoryPanelPayload): Promise<void> {
  if (!isLaboratoryPanelPayload(payload)) throw new Error("Painel laboratorial inválido.");
  for (const attachment of payload.attachments) {
    const bytes = bytesFromBase64(attachment.dataBase64);
    if (bytes.length !== attachment.size || !matchesFileSignature(bytes, attachment.mimeType) || await digestHex(bytes) !== attachment.sha256) {
      throw new Error("Falha de integridade no anexo. Nenhum dado deste painel foi alterado.");
    }
  }
}

export function laboratorySearchText(payload: LaboratoryPanelPayload): string {
  const text = (value: Knowledge<string>) => value.state === "known" ? value.value : "";
  return [text(payload.title), payload.collectedOn, text(payload.laboratory), text(payload.note),
    ...payload.results.flatMap((result) => [result.analyte, text(result.unit), text(result.referenceText), result.value.state === "known" ? String(result.value.value.value) : ""]),
    ...payload.attachments.map((attachment) => attachment.name),
  ].join(" ");
}
export const normalizeLaboratoryLabel = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
// Prefixos de unidades são sensíveis a maiúsculas: mIU/L não é MIU/L.
export const normalizeLaboratoryUnit = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ");
export function formatLaboratoryNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Resultado numérico inválido.");
  return new Intl.NumberFormat("pt-BR", { maximumSignificantDigits: 21, useGrouping: false }).format(value);
}
export function formatLaboratoryReference(result: LaboratoryResult): string {
  const parts: string[] = [];
  if (result.referenceText.state === "known") parts.push(result.referenceText.value);
  if (result.referenceLow.state === "known" && result.referenceHigh.state === "known") parts.push(`${formatLaboratoryNumber(result.referenceLow.value)} – ${formatLaboratoryNumber(result.referenceHigh.value)}`);
  else if (result.referenceLow.state === "known") parts.push(`Limite inferior informado: ${formatLaboratoryNumber(result.referenceLow.value)}`);
  else if (result.referenceHigh.state === "known") parts.push(`Limite superior informado: ${formatLaboratoryNumber(result.referenceHigh.value)}`);
  return parts.join(" · ") || "Referência não informada";
}

export interface LaboratorySeriesPoint { date: LocalDate; value: number | null; entityIds: string[]; values: number[]; }
export function buildLaboratorySeries(entities: readonly MentorEntity[], options: { analyte: string; unit: string; endLocalDate: LocalDate; days: number; datasetId?: string }) {
  const window = inclusiveDateWindow(options.endLocalDate, options.days);
  const canonical = new Map<string, MentorEntity>();
  for (const entity of entities) {
    if (options.datasetId && entity.datasetId !== options.datasetId) continue;
    const key = `${entity.datasetId}:${entity.id}`;
    const previous = canonical.get(key);
    if (!previous || entity.revision > previous.revision || (entity.revision === previous.revision && entity.updatedAt > previous.updatedAt)) canonical.set(key, entity);
  }
  const samples = new Map<string, { values: number[]; entityIds: string[] }>();
  let excludedCensored = 0;
  for (const entity of canonical.values()) {
    if (entity.status !== "active" || !isLaboratoryPanelEntity(entity) || entity.payload.collectedOn < window.start || entity.payload.collectedOn > window.end) continue;
    for (const result of entity.payload.results) {
      if (normalizeLaboratoryLabel(result.analyte) !== normalizeLaboratoryLabel(options.analyte) || result.unit.state !== "known" || normalizeLaboratoryUnit(result.unit.value) !== normalizeLaboratoryUnit(options.unit) || result.value.state !== "known" || result.value.value.kind !== "numeric") continue;
      if (result.value.value.comparator !== "eq") { excludedCensored += 1; continue; }
      const day = samples.get(entity.payload.collectedOn) ?? { values: [], entityIds: [] };
      day.values.push(result.value.value.value); day.entityIds.push(entity.id); samples.set(entity.payload.collectedOn, day);
    }
  }
  const points: LaboratorySeriesPoint[] = Array.from({ length: window.days }, (_, offset) => {
    const date = shiftLocalDate(window.start, offset); const day = samples.get(date);
    // Duas coletas no mesmo dia ficam explícitas; o gráfico não inventa uma média clínica.
    return { date, value: day?.values.length === 1 ? day.values[0] : null, values: day?.values ?? [], entityIds: day?.entityIds ?? [] };
  });
  const sampleSize = [...samples.values()].reduce((sum, day) => sum + day.values.length, 0);
  return { window, points, sampleSize, missingDays: window.days - samples.size, excludedCensored, repeatedDays: [...samples.values()].filter((day) => day.values.length > 1).length };
}
