import {
  createClinicianReviewText,
  filterExportEntities,
  type ClinicianReportDomain,
  type ClinicianReportOptions,
} from "../data/exports";
import {
  inclusiveDateWindow,
  type LocalDate,
  type MentorEntity,
} from "../domain";

export const CLINICIAN_REPORT_WINDOWS = [7, 30, 60, 180, 365] as const;
export type ClinicianReportWindowDays = typeof CLINICIAN_REPORT_WINDOWS[number];

export const CLINICIAN_REPORT_DOMAIN_OPTIONS = [
  { id: "sono", label: "Sono" },
  { id: "humor", label: "Humor e energia" },
  { id: "medicamentos", label: "Medicamentos" },
  { id: "cefaleia", label: "Cefaleia" },
  { id: "bruxismo", label: "Bruxismo/ATM" },
  { id: "alimentacao", label: "Alimentação" },
  { id: "exames", label: "Exames laboratoriais" },
] as const satisfies ReadonlyArray<{ id: ClinicianReportDomain; label: string }>;

export const CLINICIAN_REPORT_PRIVACY_CONFIRMATION =
  "Revisei o conteúdo, o período e os domínios. Entendo que o arquivo é texto sem criptografia e quero gerá-lo agora.";

export const CLINICIAN_REPORT_DEFAULT_DOMAINS = [] as const satisfies readonly ClinicianReportDomain[];

export interface ClinicianReportSelection {
  referenceLocalDate: LocalDate;
  windowDays: ClinicianReportWindowDays;
  domains: readonly ClinicianReportDomain[];
  title?: string;
}

export interface ClinicianReportDomainPreview {
  domain: ClinicianReportDomain;
  label: string;
  recordCount: number;
  daysWithRecords: number;
  daysWithoutRecords: number;
}

export interface ClinicianReportPreview {
  windowDays: ClinicianReportWindowDays;
  startLocalDate: LocalDate;
  endLocalDate: LocalDate;
  selectedDomains: ClinicianReportDomain[];
  recordCount: number;
  daysWithAnyRecord: number;
  daysWithoutAnySelectedRecord: number;
  hasExportableData: boolean;
  byDomain: ClinicianReportDomainPreview[];
  /** Exact plaintext that will be placed in the confirmed blob. */
  contentText: string;
}

export interface ClinicianReportGeneration {
  blob: Blob;
  fileName: string;
  options: ClinicianReportOptions;
  preview: ClinicianReportPreview;
}

function normalizedDomains(
  domains: readonly ClinicianReportDomain[],
): ClinicianReportDomain[] {
  const requested = new Set(domains);
  return CLINICIAN_REPORT_DOMAIN_OPTIONS
    .map(({ id }) => id)
    .filter((domain) => requested.has(domain));
}

function reportOptions(selection: ClinicianReportSelection): ClinicianReportOptions {
  if (!CLINICIAN_REPORT_WINDOWS.includes(selection.windowDays)) {
    throw new Error("A janela do relatório precisa ser 7, 30, 60, 180 ou 365 dias.");
  }
  const window = inclusiveDateWindow(selection.referenceLocalDate, selection.windowDays);
  const title = selection.title?.trim();
  return {
    startLocalDate: window.start,
    endLocalDate: window.end,
    domains: normalizedDomains(selection.domains),
    ...(title ? { title } : {}),
  };
}

export function buildClinicianReportPreview(
  entities: readonly MentorEntity[],
  selection: ClinicianReportSelection,
): ClinicianReportPreview {
  const options = reportOptions(selection);
  const selected = filterExportEntities([...entities], options);
  const contentText = createClinicianReviewText([...entities], options);
  const daysWithAnyRecord = new Set(selected.map(({ localDate }) => localDate)).size;
  const byDomain = options.domains.map((domain) => {
    const domainEntities = selected.filter((entity) => entity.domain === domain);
    const daysWithRecords = new Set(
      domainEntities.map(({ localDate }) => localDate),
    ).size;
    return {
      domain,
      label: CLINICIAN_REPORT_DOMAIN_OPTIONS.find(({ id }) => id === domain)?.label ?? domain,
      recordCount: domainEntities.length,
      daysWithRecords,
      daysWithoutRecords: selection.windowDays - daysWithRecords,
    };
  });

  return {
    windowDays: selection.windowDays,
    startLocalDate: options.startLocalDate!,
    endLocalDate: options.endLocalDate!,
    selectedDomains: options.domains,
    recordCount: selected.length,
    daysWithAnyRecord,
    daysWithoutAnySelectedRecord: selection.windowDays - daysWithAnyRecord,
    hasExportableData: selected.length > 0 && options.domains.length > 0,
    byDomain,
    contentText,
  };
}

export function createConfirmedClinicianReport(
  entities: readonly MentorEntity[],
  selection: ClinicianReportSelection,
  confirmed: boolean,
): ClinicianReportGeneration {
  if (!confirmed) {
    throw new Error("Confirme a revisão de privacidade antes de gerar o relatório.");
  }
  const options = reportOptions(selection);
  if (options.domains.length === 0) {
    throw new Error("Selecione pelo menos um domínio para gerar o relatório.");
  }
  const preview = buildClinicianReportPreview(entities, selection);
  if (!preview.hasExportableData) {
    throw new Error("Não há registros nos domínios e no período selecionados.");
  }
  return {
    blob: new Blob([preview.contentText], { type: "text/plain;charset=utf-8" }),
    fileName: `mentor-bauer-relatorio-${selection.referenceLocalDate}-${selection.windowDays}d.txt`,
    options,
    preview,
  };
}
