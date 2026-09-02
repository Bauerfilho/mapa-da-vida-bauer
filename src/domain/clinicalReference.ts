import { CLINICAL_CATALOG } from "./clinicalCatalog";
import type { GenericPayload, MentorEntity } from "./model";

export type ClinicalReferenceKind = "cid" | "exam" | "medicine";
export interface ClinicalReferenceSource { label: string; url: string; }
export interface ClinicalReferenceItem {
  id: string; kind: ClinicalReferenceKind; title: string; code?: string;
  aliases: readonly string[]; category: string; summary: string;
  cautions: readonly string[]; related: readonly string[];
  sources: readonly ClinicalReferenceSource[]; scope: string;
  personal?: boolean;
  gestationalReference?: boolean;
  presentation?: string;
}
export interface ClinicalSearchResult { item: ClinicalReferenceItem; match: "code" | "title" | "alias" | "prefix" | "approximate"; score: number; }

// Normaliza somente linguagem de busca, nunca códigos exibidos ou unidades laboratoriais.
export function normalizeClinicalQuery(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
const compact = (value: string) => normalizeClinicalQuery(value).replace(/ /g, "");
const stopwords = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "em", "ao", "para", "com"]);
const tokens = (value: string) => normalizeClinicalQuery(value).split(" ").filter((word) => word && !stopwords.has(word));

// Distância de edição limitada à navegação textual; não calcula probabilidade clínica.
function distance(left: string, right: string): number {
  if (Math.abs(left.length - right.length) > 2) return 3;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) current.push(Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)));
    previous = current;
  }
  return previous[right.length];
}

export function searchClinicalReferences(query: string, kind: ClinicalReferenceKind, additional: readonly ClinicalReferenceItem[] = []): ClinicalSearchResult[] {
  const normalized = normalizeClinicalQuery(query.slice(0, 160));
  const catalog = [...CLINICAL_CATALOG, ...additional].filter((item) => item.kind === kind);
  if (!normalized) return catalog.map((item) => ({ item, score: 0, match: "prefix" as const }));
  const codeQuery = compact(query);
  const looksLikeCode = kind === "cid" ? /^[a-z]\d/i.test(query.trim()) : kind === "exam" && /^\d{3}/.test(query.trim());
  const queryTokens = tokens(query);
  if (!queryTokens.length) return [];
  const matches: ClinicalSearchResult[] = [];
  for (const item of catalog) {
    const officialCode = item.code ? compact(item.code) : "";
    if (officialCode && officialCode === codeQuery) { matches.push({ item, score: 1000, match: "code" }); continue; }
    if (looksLikeCode) {
      if (officialCode.startsWith(codeQuery) && codeQuery.length >= 2) matches.push({ item, score: 800, match: "prefix" });
      continue;
    }
    const title = normalizeClinicalQuery(item.title);
    const aliases = item.aliases.map(normalizeClinicalQuery);
    if (title === normalized || compact(title) === codeQuery) { matches.push({ item, score: 950, match: "title" }); continue; }
    if (aliases.some((alias) => alias === normalized || compact(alias) === codeQuery)) { matches.push({ item, score: 900, match: "alias" }); continue; }
    // Sem correspondência exata, uma negação não pode ser reinterpretada como condição positiva.
    if (queryTokens.includes("nao") || queryTokens.includes("sem")) continue;
    const words = tokens([item.title, ...item.aliases].join(" "));
    if (queryTokens.every((token) => words.some((word) => word === token || (token.length >= 3 && word.startsWith(token))))) {
      matches.push({ item, score: 650 - Math.min(words.length, 100), match: "prefix" }); continue;
    }
    if (queryTokens.every((token) => words.some((word) => word === token || (token.length >= 4 && distance(token, word) <= (token.length >= 6 ? 2 : 1))))) matches.push({ item, score: 350 - Math.min(words.length, 100), match: "approximate" });
  }
  return matches.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, "pt-BR"));
}

export interface SoapDraft { subjective: string; objective: string; assessment: string; plan: string; }
export const createEmptySoapDraft = (): SoapDraft => ({ subjective: "", objective: "", assessment: "", plan: "" });
export function serializeSoap(draft: SoapDraft): string {
  const sections = [["S — Subjetivo", draft.subjective], ["O — Objetivo", draft.objective], ["A — Avaliação", draft.assessment], ["P — Plano", draft.plan]];
  if (sections.every(([, value]) => !value.trim())) return "";
  // O conteúdo é do operador. Não acrescenta achados, negativas, hipóteses ou condutas.
  return sections.map(([heading, value]) => `${heading}\n${value.trim() || "Não preenchido"}`).join("\n\n");
}

export interface PersonalReferencePayload extends GenericPayload {
  schema: "clinical-reference-personal-v1"; eventKind: "clinical-reference-personal";
  referenceKind: ClinicalReferenceKind; title: string; aliases: string[]; code: string;
  category: string; note: string; sourceUrl: string;
}
export function isPersonalReferencePayload(value: unknown): value is PersonalReferencePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  const fields = ["schema", "eventKind", "referenceKind", "title", "aliases", "code", "category", "note", "sourceUrl"];
  if (Object.keys(raw).some((key) => !fields.includes(key)) || raw.schema !== "clinical-reference-personal-v1" || raw.eventKind !== "clinical-reference-personal" ||
    !["title", "code", "category", "note", "sourceUrl", "referenceKind"].every((key) => typeof raw[key] === "string") ||
    !Array.isArray(raw.aliases) || !raw.aliases.every((alias) => typeof alias === "string")) return false;
  try {
    createPersonalReference({ kind: raw.referenceKind as ClinicalReferenceKind, title: raw.title as string, aliases: raw.aliases.join(","), code: raw.code as string, category: raw.category as string, note: raw.note as string, sourceUrl: raw.sourceUrl as string });
    return true;
  } catch { return false; }
}
export function createPersonalReference(input: { kind: ClinicalReferenceKind; title: string; aliases: string; code?: string; category?: string; note?: string; sourceUrl?: string }): PersonalReferencePayload {
  const title = input.title.trim();
  if (!["cid", "exam", "medicine"].includes(input.kind) || !title || title.length > 160) throw new Error("Informe o tipo e um nome de referência com até 160 caracteres.");
  const aliases = input.aliases.split(/[,;\n]/).map((value) => value.trim()).filter(Boolean);
  if (aliases.length > 20 || aliases.some((alias) => alias.length > 100)) throw new Error("Use até 20 sinônimos curtos, separados por vírgula.");
  if ((input.note?.length ?? 0) > 1000 || (input.code?.length ?? 0) > 20 || (input.category?.length ?? 0) > 80) throw new Error("A referência deve ser curta; não inclua prontuário ou dados de paciente.");
  let sourceUrl = input.sourceUrl?.trim() ?? "";
  if (sourceUrl) {
    let url: URL; try { url = new URL(sourceUrl); } catch { throw new Error("Informe uma fonte HTTPS válida ou deixe em branco."); }
    if (url.protocol !== "https:" || url.username || url.password || sourceUrl.length > 1000) throw new Error("A fonte precisa ser HTTPS e não pode conter credenciais.");
    sourceUrl = url.href;
  }
  return { schema: "clinical-reference-personal-v1", eventKind: "clinical-reference-personal", referenceKind: input.kind, title, aliases, code: input.code?.trim() ?? "", category: input.category?.trim() || "Minha referência", note: input.note?.trim() ?? "", sourceUrl };
}
export function personalReferencesFromEntities(entities: readonly MentorEntity[]): ClinicalReferenceItem[] {
  return entities.flatMap((entity) => {
    if (entity.status !== "active" || entity.domain !== "conhecimento" || entity.type !== "generic.event") return [];
    const raw = entity.payload as Partial<PersonalReferencePayload>;
    if (!isPersonalReferencePayload(raw)) return [];
    try {
      const payload = createPersonalReference({ kind: raw.referenceKind as ClinicalReferenceKind, title: raw.title, aliases: raw.aliases.join(","), code: typeof raw.code === "string" ? raw.code : "", category: typeof raw.category === "string" ? raw.category : "", note: typeof raw.note === "string" ? raw.note : "", sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : "" });
      return [{ id: entity.id, kind: payload.referenceKind, title: payload.title, ...(payload.code ? { code: payload.code } : {}), aliases: payload.aliases, category: payload.category, summary: payload.note || "Referência adicionada por você.", cautions: ["Anotação pessoal, sem revisão documental. Não valida indicação, formulação, dose ou código assistencial."], related: [], sources: payload.sourceUrl ? [{ label: "Fonte informada por você", url: payload.sourceUrl }] : [], scope: "Adição pessoal ao catálogo; confirme o conteúdo na fonte apropriada antes do uso assistencial.", personal: true, gestationalReference: false }];
    } catch { return []; }
  });
}
