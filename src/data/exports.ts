import type {
  Domain,
  Knowledge,
  LocalDate,
  MentorEntity,
} from "../domain/model";
import { renderClinicianReviewText } from "./clinicianReportText";

export { CLINICIAN_REPORT_PLAINTEXT_WARNING } from "./clinicianReportText";

export const READABLE_EXPORT_PLAINTEXT_WARNING =
  "JSON e CSV são arquivos sem criptografia e podem incluir os documentos dos exames. Não substituem o backup cifrado .bauerlife; confira o destino antes de compartilhar.";

export interface ExportFilter {
  startLocalDate?: LocalDate;
  endLocalDate?: LocalDate;
  domains?: Domain[];
}

export type ClinicianReportDomain = Extract<Domain,
  | "medicamentos"
  | "sono"
  | "alimentacao"
  | "humor"
  | "cefaleia"
  | "bruxismo"
  | "exames"
>;

export interface ClinicianReportOptions extends ExportFilter {
  startLocalDate: LocalDate;
  endLocalDate: LocalDate;
  domains: ClinicianReportDomain[];
  title?: string;
}

type ShareResult = "shared" | "downloaded";

const domainLabels: Record<Domain, string> = {
  internato: "Internato",
  estudos: "Estudos",
  medicamentos: "Medicamentos",
  sono: "Sono",
  alimentacao: "Alimentação",
  humor: "Humor e energia",
  cefaleia: "Cefaleia",
  bruxismo: "Bruxismo/ATM",
  financas: "Finanças",
  rotina: "Rotina",
  agenda: "Agenda",
  ia: "Ferramentas de IA",
  conhecimento: "Conhecimento",
  exames: "Exames laboratoriais",
};

const eventLabels: Record<string, string> = {
  "agenda-annual-date": "Data anual",
  "clinical-reference-personal": "Referência pessoal de consulta",
  "laboratory-panel": "Painel laboratorial",
  "internato.shift": "Jornada de internato",
  "humor.energy-check-in": "Check-in de energia",
  "medicamentos.confirmation": "Confirmação de medicamento",
  "financas.account": "Conta financeira",
  "rotina.daily-closure": "Fechamento diário",
  "financial-movement": "Movimentação financeira",
  "mood-check-in": "Check-in de humor",
  "sleep-episode": "Episódio de sono",
  "headache-check-in": "Registro de cefaleia",
  "headache-crisis": "Crise de cefaleia",
  "bruxism-check-in": "Check-in de bruxismo/ATM",
  "medication-dose": "Dose de medicamento",
  "medication-regimen": "Esquema de medicamento",
  "study-session": "Sessão de estudo",
  "meal-entry": "Alimentação/hidratação",
  "routine-anchor": "Âncora de rotina",
  "agenda-event": "Compromisso",
  "agenda-task": "Tarefa",
  "ai-tool": "Ferramenta de IA",
  "knowledge-note": "Nota de conhecimento",
  "knowledge-capture": "Captura rápida",
  "internship-debrief": "Fechamento do internato",
  "medication-stock": "Estoque de medicamento",
  "medication-sos": "Uso SOS informado",
  "sleep-chronology": "Cronologia do sono",
  "nutrition-log": "Alimentação e hidratação",
  "mood-functional-check-in": "Humor e energia",
  "bruxism-am-pm": "Bruxismo manhã/noite",
  "finance-transaction": "Movimentação financeira",
  "finance-debt": "Dívida",
  "finance-subscription": "Assinatura",
  "routine-day-plan": "Plano do dia",
  "ai-tool-portfolio": "Ferramenta de IA",
};

function isKnowledge(value: unknown): value is Knowledge<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "state")) return false;
  const record = value as Record<string, unknown>;
  let allowed: readonly string[];
  switch (record.state) {
    case "known":
      if (!Object.hasOwn(record, "value") || record.value === undefined) return false;
      allowed = ["state", "value", "source", "recordedAt"]; break;
    case "unknown": allowed = ["state", "reason"]; break;
    case "confirmed_absent":
    case "not_applicable": allowed = ["state", "reasonCode"]; break;
    case "invalid": allowed = ["state", "issueCodes"]; break;
    default: return false;
  }
  // Envelopes antigos podem conservar campos da versão conhecida: o estado atual prevalece.
  if (record.state !== "known") allowed = [...allowed, "value", "source", "recordedAt", "reason", "reasonCode", "issueCodes"];
  // Um objeto de negócio com campo state não é, por isso, um envelope de conhecimento.
  return Reflect.ownKeys(record).every((key) => typeof key === "string" && allowed.includes(key));
}

function publicRecord(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, publicValue(item)]));
}

function publicValue(value: unknown): unknown {
  if (isKnowledge(value)) {
    if (value.state === "known") return publicValue(value.value);
    if (value.state === "confirmed_absent") return "ausência confirmada";
    if (value.state === "not_applicable") return "não se aplica";
    if (value.state === "invalid") return "registro inválido";
    return "não registrado";
  }
  if (Array.isArray(value)) return value.map(publicValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.hasOwn(record, "state") && Object.hasOwn(record, "value") &&
        typeof record.state === "string" && ["unknown", "confirmed_absent", "not_applicable", "invalid"].includes(record.state)) {
      // Não classificar uma forma ambígua expondo o valor antigo: o original e o backup ficam intactos.
      throw new Error("Um campo ambíguo contém valor antigo marcado como não conhecido. A exportação legível foi interrompida; preserve seus dados pelo backup cifrado .bauerlife.");
    }
    return publicRecord(value);
  }
  return value;
}

function eventKind(entity: MentorEntity): string {
  if (entity.type !== "generic.event") return entity.type;
  const kind = (entity.payload as Record<string, unknown>).eventKind;
  if (typeof kind === "string") return kind;
  if (isKnowledge(kind) && kind.state === "known" && typeof kind.value === "string") {
    return kind.value;
  }
  return "generic.event";
}

export function humanEventLabel(entity: MentorEntity): string {
  const kind = eventKind(entity);
  return Object.hasOwn(eventLabels, kind) ? eventLabels[kind] : domainLabels[entity.domain];
}

export function filterExportEntities(
  entities: MentorEntity[],
  filter: ExportFilter = {},
): MentorEntity[] {
  const domains = filter.domains ? new Set(filter.domains) : null;
  return entities
    .filter((entity) => entity.status === "active")
    .filter((entity) => (domains ? domains.has(entity.domain) : true))
    .filter((entity) =>
      filter.startLocalDate ? entity.localDate >= filter.startLocalDate : true,
    )
    .filter((entity) =>
      filter.endLocalDate ? entity.localDate <= filter.endLocalDate : true,
    )
    .sort((left, right) =>
      right.occurredAtUTC.localeCompare(left.occurredAtUTC),
    );
}

function exportRecord(entity: MentorEntity) {
  return {
    date: entity.localDate,
    occurredAtUTC: entity.occurredAtUTC,
    timezone: entity.timezone,
    domain: domainLabels[entity.domain],
    event: humanEventLabel(entity),
    source: entity.source,
    revision: entity.revision,
    // A raiz é sempre o payload do evento; mesmo {state, value} continua sendo um registro.
    values: publicRecord(entity.payload),
  };
}

export function createJsonExport(
  entities: MentorEntity[],
  filter: ExportFilter = {},
): Blob {
  const selected = filterExportEntities(entities, filter);
  const envelope = {
    format: "mentor-bauer-readable-export",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    recordCount: selected.length,
    filter,
    note:
      `Exportação legível criada sob comando do usuário. Campos não registrados permanecem identificados como tal. ${READABLE_EXPORT_PLAINTEXT_WARNING}`,
    records: selected.map(exportRecord),
  };
  return new Blob([JSON.stringify(envelope, null, 2)], {
    type: "application/json;charset=utf-8",
  });
}

/** @internal Células textuais perigosas ficam literais em planilhas, sem mudar números reais. */
export function csvCell(value: unknown): string {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value) ?? "";
  const formulaLike = typeof value === "string" && (/^[\s\u0000-\u0020]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text));
  const serialized = formulaLike ? `'${text}` : text;
  return `"${serialized.replace(/"/g, '""')}"`;
}

export function createCsvExport(
  entities: MentorEntity[],
  filter: ExportFilter = {},
): Blob {
  const header = [
    "data",
    "instante_utc",
    "dominio",
    "evento",
    "origem",
    "revisao",
    "valores_json",
  ];
  const rows = filterExportEntities(entities, filter).map((entity) => {
    const record = exportRecord(entity);
    return [
      record.date,
      record.occurredAtUTC,
      record.domain,
      record.event,
      record.source,
      record.revision,
      record.values,
    ]
      .map(csvCell)
      .join(",");
  });
  return new Blob([`\uFEFF${header.map(csvCell).join(",")}\r\n${rows.join("\r\n")}`], {
    type: "text/csv;charset=utf-8",
  });
}

export function createClinicianReviewReport(
  entities: MentorEntity[],
  options: ClinicianReportOptions,
): Blob {
  return new Blob([createClinicianReviewText(entities, options)], {
    type: "text/plain;charset=utf-8",
  });
}

/**
 * Produces the exact plaintext used by the clinician report blob.
 * Keeping preview and download on this single renderer prevents a reviewed
 * summary from drifting from the file that is eventually shared.
 */
export function createClinicianReviewText(
  entities: MentorEntity[],
  options: ClinicianReportOptions,
): string {
  const selected = filterExportEntities(entities, options);
  return renderClinicianReviewText(selected, options);
}

export async function shareOrDownloadFile(
  blob: Blob,
  fileName: string,
  title = "Mentor Bauer",
): Promise<ShareResult> {
  const file = new File([blob], fileName, { type: blob.type || "application/octet-stream" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title, files: [file] });
    return "shared";
  }

  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
  return "downloaded";
}
