import { useId, useMemo, useState, type ReactNode } from "react";
import {
  Archive,
  ArrowCounterClockwise,
  CaretRight,
  CheckCircle,
  Database,
  FileArrowDown,
  FileArrowUp,
  FileCode,
  FileCsv,
  FileText,
  MagnifyingGlass,
  PencilSimple,
  ShieldCheck,
  SlidersHorizontal,
  Trash,
} from "@phosphor-icons/react";
import type {
  Domain,
  LocalDate,
  MentorEntity,
  StorageDurabilityStatus,
} from "../domain";
import { buildArchiveSnapshot } from "../domain/history";
import { humanEventLabel, READABLE_EXPORT_PLAINTEXT_WARNING } from "../data/exports";
import { KeyboardInput } from "../mobile";
import { DOMAIN_CATALOG } from "./domainCatalog";
import { isLaboratoryPanelPayload, laboratorySearchText } from "../domain/laboratory";
import "./archive-workspace.css";

type ArchiveCallback = () => void | Promise<void>;
type ArchiveEntityCallback = (
  entity: MentorEntity,
) => void | Promise<void>;

export interface ArchiveWorkspaceProps {
  /** Canonical workspace entities. The component never mutates this array. */
  entities: readonly MentorEntity[];
  /** Civil date used as the inclusive end of the retained 365-day window. */
  currentLocalDate: LocalDate;
  storage: StorageDurabilityStatus | null;
  /** When supplied, enables the recoverable-deletions view. */
  deletedEntities?: readonly MentorEntity[];
  onBackup: ArchiveCallback;
  onRestore: ArchiveCallback;
  onPreferences: ArchiveCallback;
  onDelete: ArchiveEntityCallback;
  onRestoreEntity: ArchiveEntityCallback;
  onEdit?: ArchiveEntityCallback;
  onExportJson: ArchiveCallback;
  onExportCsv: ArchiveCallback;
  onClinicianReport: ArchiveCallback;
  onRequestPersistence?: ArchiveCallback;
  maintenance?: ReactNode;
}

const domainCatalogById = new Map<Domain, (typeof DOMAIN_CATALOG)[number]>(
  DOMAIN_CATALOG.map((entry) => [entry.id, entry]),
);

const longDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const compactNumberFormatter = new Intl.NumberFormat("pt-BR");

const sourceLabels: Record<MentorEntity["source"], string> = {
  manual: "Registro manual",
  seed: "Dado inicial confirmado",
  imported: "Importado",
  derived: "Derivado",
};

function dateAtNoonUTC(localDate: LocalDate): Date {
  return new Date(`${localDate}T12:00:00.000Z`);
}

function formatShortDate(localDate: LocalDate): string {
  return shortDateFormatter.format(dateAtNoonUTC(localDate)).replace(/\./g, "");
}

function formatDayHeading(localDate: LocalDate, currentLocalDate: LocalDate): string {
  if (localDate === currentLocalDate) return "Hoje";
  const formatted = longDateFormatter.format(dateAtNoonUTC(localDate));
  return formatted.charAt(0).toLocaleUpperCase("pt-BR") + formatted.slice(1);
}

function formatInstantTime(entity: MentorEntity): string {
  const instant = new Date(entity.occurredAtUTC);
  if (Number.isNaN(instant.getTime())) return "Horário não informado";

  try {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: entity.timezone,
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(instant);
  }
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const unitIndex = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  const amount = value / 1024 ** unitIndex;
  return `${new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: amount >= 10 || unitIndex === 0 ? 0 : 1,
  }).format(amount)} ${units[unitIndex]}`;
}

function storageUsageLabel(storage: StorageDurabilityStatus | null): string {
  if (storage?.usageBytes != null && storage.quotaBytes != null) {
    return `${formatBytes(storage.usageBytes)} usados de ${formatBytes(storage.quotaBytes)} disponíveis`;
  }
  if (storage?.usageBytes != null) {
    return `${formatBytes(storage.usageBytes)} usados localmente`;
  }
  if (storage?.quotaBytes != null) {
    return `${formatBytes(storage.quotaBytes)} disponíveis no navegador`;
  }
  return "Uso e limite não informados pelo navegador";
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function entitySearchText(entity: MentorEntity): string {
  const domainLabel = domainCatalogById.get(entity.domain)?.label ?? entity.domain;
  let payload = "";
  try {
    payload = isLaboratoryPanelPayload(entity.payload) ? laboratorySearchText(entity.payload) : JSON.stringify(entity.payload);
  } catch {
    // Payloads are expected to be serializable. Keep metadata searchable if a
    // future payload cannot be serialized.
  }
  return normalizeSearch(
    [
      humanEventLabel(entity),
      domainLabel,
      entity.domain,
      entity.type,
      entity.localDate,
      sourceLabels[entity.source],
      payload,
    ].join(" "),
  );
}

const previewKeysByDomain: Record<Domain, readonly string[]> = {
  internato: ["topics", "topic", "feedback", "nextAction", "area", "notes"],
  estudos: ["topic", "subject", "objective", "nextReview", "notes"],
  medicamentos: ["medicationName", "name", "notes"],
  sono: ["recoveryNotes", "notes", "context"],
  alimentacao: ["meal", "description", "context", "notes"],
  humor: ["observedSigns", "note", "notes", "context"],
  cefaleia: ["painLocation", "triggers", "notes", "context"],
  bruxismo: ["symptoms", "triggers", "notes", "context"],
  financas: ["memo", "description", "institution", "merchant", "creditor", "notes"],
  rotina: ["task", "anchor", "description", "notes"],
  agenda: ["label", "title", "task", "description", "notes"],
  ia: ["toolName", "name", "role", "notes"],
  conhecimento: ["capture", "title", "topic", "application", "openQuestion", "notes"],
  exames: ["title", "laboratory", "collectedOn", "note"],
};

function readableKnownText(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s+/g, " ");
    return normalized.length > 0 ? normalized : null;
  }

  if (Array.isArray(value)) {
    const items = value
      .map(readableKnownText)
      .filter((item): item is string => item !== null)
      .slice(0, 3);
    return items.length > 0 ? items.join(" · ") : null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.state === "known") return readableKnownText(record.value);
  }

  return null;
}

function findPreviewField(
  value: unknown,
  targetKey: string,
  depth = 0,
): string | null {
  if (!value || typeof value !== "object" || depth > 4) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findPreviewField(item, targetKey, depth + 1);
      if (match) return match;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, targetKey)) {
    const direct = readableKnownText(record[targetKey]);
    if (direct) return direct;
  }

  for (const nested of Object.values(record)) {
    const match = findPreviewField(nested, targetKey, depth + 1);
    if (match) return match;
  }
  return null;
}

function eventPreview(entity: MentorEntity): string | null {
  for (const key of [...previewKeysByDomain[entity.domain], "note", "notes", "description"]) {
    const match = findPreviewField(entity.payload, key);
    if (match) return match.length > 180 ? `${match.slice(0, 177)}…` : match;
  }
  return null;
}

function newestFirst(left: MentorEntity, right: MentorEntity): number {
  if (left.localDate !== right.localDate) {
    return right.localDate.localeCompare(left.localDate);
  }
  if (left.occurredAtUTC !== right.occurredAtUTC) {
    return right.occurredAtUTC.localeCompare(left.occurredAtUTC);
  }
  return right.id.localeCompare(left.id);
}

interface ArchiveDayGroup {
  localDate: LocalDate;
  entities: MentorEntity[];
}

function groupByLocalDate(entities: readonly MentorEntity[]): ArchiveDayGroup[] {
  const groups = new Map<LocalDate, MentorEntity[]>();
  for (const entity of entities) {
    const existing = groups.get(entity.localDate);
    if (existing) existing.push(entity);
    else groups.set(entity.localDate, [entity]);
  }
  return [...groups.entries()].map(([localDate, groupedEntities]) => ({
    localDate,
    entities: groupedEntities,
  }));
}

function storageCopy(storage: StorageDurabilityStatus | null): {
  title: string;
  description: string;
  state: "protected" | "attention" | "unknown";
} {
  if (storage?.persisted === true) {
    return {
      title: "Persistência local protegida",
      description: "O navegador confirmou proteção contra limpeza automática de armazenamento.",
      state: "protected",
    };
  }
  if (storage?.persisted === false) {
    return {
      title: "Persistência ainda não garantida",
      description: "Mantenha um backup recente: o navegador pode liberar espaço automaticamente.",
      state: "attention",
    };
  }
  return {
    title: "Estado de persistência indisponível",
    description: "O navegador não informou se este armazenamento está protegido contra limpeza.",
    state: "unknown",
  };
}

export function ArchiveWorkspace({
  entities,
  currentLocalDate,
  storage,
  deletedEntities,
  onBackup,
  onRestore,
  onPreferences,
  onDelete,
  onRestoreEntity,
  onEdit,
  onExportJson,
  onExportCsv,
  onClinicianReport,
  onRequestPersistence,
  maintenance,
}: ArchiveWorkspaceProps) {
  const id = useId().replace(/:/g, "");
  const [query, setQuery] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<Domain | "all">("all");
  const [showDeleted, setShowDeleted] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const snapshot = useMemo(
    () => buildArchiveSnapshot(entities, currentLocalDate),
    [currentLocalDate, entities],
  );

  const activeEntities = useMemo(() => {
    const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
    return snapshot.events
      .map((event) => entitiesById.get(event.id))
      .filter((entity): entity is MentorEntity => entity !== undefined)
      .reverse();
  }, [entities, snapshot.events]);

  const retainedDeletedEntities = useMemo(
    () =>
      (deletedEntities ?? [])
        .filter((entity) => entity.status === "deleted")
        .sort(newestFirst),
    [deletedEntities],
  );

  const normalizedQuery = normalizeSearch(query);
  const visibleEntities = useMemo(() => {
    const candidates = showDeleted
      ? [...activeEntities, ...retainedDeletedEntities]
      : activeEntities;
    return candidates
      .filter((entity) =>
        selectedDomain === "all" ? true : entity.domain === selectedDomain,
      )
      .filter((entity) =>
        normalizedQuery ? entitySearchText(entity).includes(normalizedQuery) : true,
      )
      .sort(newestFirst);
  }, [activeEntities, normalizedQuery, retainedDeletedEntities, selectedDomain, showDeleted]);

  const dayGroups = useMemo(() => groupByLocalDate(visibleEntities), [visibleEntities]);
  const filtersActive = normalizedQuery.length > 0 || selectedDomain !== "all";
  const storageStatus = storageCopy(storage);
  const hasExportableData = snapshot.eventCount > 0;
  const deletedViewAvailable = deletedEntities !== undefined;

  const clearFilters = () => {
    setQuery("");
    setSelectedDomain("all");
  };

  return (
    <div className="archive-workspace" data-testid="archive-workspace">
      <header className="archive-workspace__header">
        <span className="archive-workspace__header-icon" aria-hidden="true">
          <Archive size={29} weight="thin" />
        </span>
        <div>
          <p className="archive-workspace__eyebrow">Memória privada e recuperável</p>
          <h1>Arquivo</h1>
          <p>Consulte fatos preservados, recupere exclusões e leve seus dados com você.</p>
        </div>
      </header>

      <section
        className="archive-workspace__retention"
        aria-labelledby={`${id}-retention-title`}
      >
        <div className="archive-workspace__retention-mark" aria-hidden="true">
          <strong>{snapshot.window.days}</strong>
          <span>dias</span>
        </div>
        <div>
          <p className="archive-workspace__section-kicker">Evidência de retenção</p>
          <h2 id={`${id}-retention-title`}>Histórico canônico preservado</h2>
          <p>
            Janela inclusiva de <time dateTime={snapshot.window.start}>{formatShortDate(snapshot.window.start)}</time>{" "}
            a <time dateTime={snapshot.window.end}>{formatShortDate(snapshot.window.end)}</time>.
          </p>
          <p className="archive-workspace__retention-count">
            <strong>{compactNumberFormatter.format(snapshot.eventCount)}</strong>{" "}
            {snapshot.eventCount === 1 ? "registro ativo retido" : "registros ativos retidos"}
          </p>
        </div>
      </section>

      <section
        className="archive-workspace__section"
        aria-labelledby={`${id}-safety-title`}
      >
        <div className="archive-workspace__section-heading">
          <ShieldCheck size={23} weight="thin" aria-hidden="true" />
          <div>
            <h2 id={`${id}-safety-title`}>Segurança e recuperação</h2>
            <p>Backup cifrado e restauração continuam sob seu comando.</p>
          </div>
        </div>

        <div className="archive-workspace__action-list">
          <button type="button" className="archive-workspace__action" onClick={onBackup}>
            <FileArrowDown size={24} weight="thin" aria-hidden="true" />
            <span>
              <strong>Criar backup</strong>
              <small>Preparar uma cópia portátil e protegida</small>
            </span>
            <CaretRight size={18} weight="light" aria-hidden="true" />
          </button>
          <button type="button" className="archive-workspace__action" onClick={onRestore}>
            <FileArrowUp size={24} weight="thin" aria-hidden="true" />
            <span>
              <strong>Restaurar backup</strong>
              <small>Validar uma cópia antes de aplicá-la</small>
            </span>
            <CaretRight size={18} weight="light" aria-hidden="true" />
          </button>
          <button type="button" className="archive-workspace__action" onClick={onPreferences}>
            <SlidersHorizontal size={24} weight="thin" aria-hidden="true" />
            <span>
              <strong>Preferências e metas</strong>
              <small>Aplicar sua régua de estudo, sono e acessibilidade</small>
            </span>
            <CaretRight size={18} weight="light" aria-hidden="true" />
          </button>
        </div>

        <div className="archive-workspace__storage" data-state={storageStatus.state}>
          <span className="archive-workspace__storage-icon" aria-hidden="true">
            {storageStatus.state === "protected" ? (
              <CheckCircle size={22} weight="fill" />
            ) : (
              <Database size={22} weight="thin" />
            )}
          </span>
          <div>
            <strong>{storageStatus.title}</strong>
            <p>{storageStatus.description}</p>
            <small>{storageUsageLabel(storage)}</small>
            {storage?.persisted !== true && onRequestPersistence ? <button type="button" onClick={onRequestPersistence}>Solicitar proteção ao iPhone</button> : null}
          </div>
        </div>
      </section>

      {maintenance}

      <section
        className="archive-workspace__section archive-workspace__history"
        aria-labelledby={`${id}-history-title`}
      >
        <div className="archive-workspace__section-heading">
          <Archive size={23} weight="thin" aria-hidden="true" />
          <div>
            <h2 id={`${id}-history-title`}>Histórico</h2>
            <p>Busque sem alterar os registros originais.</p>
          </div>
        </div>

        <div className="archive-workspace__filters" role="search" aria-label="Filtrar histórico">
          <label className="archive-workspace__search" htmlFor={`${id}-archive-search`}>
            <span>Buscar no arquivo</span>
            <span className="archive-workspace__input-wrap">
              <MagnifyingGlass size={18} aria-hidden="true" />
              <KeyboardInput
                id={`${id}-archive-search`}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Evento, domínio ou conteúdo"
                autoComplete="off"
              />
            </span>
          </label>

          <label className="archive-workspace__domain-filter" htmlFor={`${id}-archive-domain`}>
            <span>Domínio</span>
            <select
              id={`${id}-archive-domain`}
              value={selectedDomain}
              onChange={(event) =>
                setSelectedDomain(event.currentTarget.value as Domain | "all")
              }
            >
              <option value="all">Todos os domínios</option>
              {DOMAIN_CATALOG.map((domain) => (
                <option value={domain.id} key={domain.id}>{domain.label}</option>
              ))}
            </select>
          </label>
        </div>

        {deletedViewAvailable ? (
          <div className="archive-workspace__deleted-control">
            <label>
              <input
                type="checkbox"
                checked={showDeleted}
                disabled={retainedDeletedEntities.length === 0}
                onChange={(event) => setShowDeleted(event.currentTarget.checked)}
              />
              <span>Mostrar registros excluídos</span>
            </label>
            <small>
              {retainedDeletedEntities.length === 0
                ? "Nenhum registro excluído nesta janela."
                : `${compactNumberFormatter.format(retainedDeletedEntities.length)} ${retainedDeletedEntities.length === 1 ? "item recuperável" : "itens recuperáveis"}`}
            </small>
          </div>
        ) : null}

        <div className="archive-workspace__result-summary" role="status" aria-live="polite">
          <span>
            {compactNumberFormatter.format(visibleEntities.length)}{" "}
            {visibleEntities.length === 1 ? "registro exibido" : "registros exibidos"}
          </span>
          {filtersActive ? (
            <button type="button" onClick={clearFilters}>Limpar busca e domínio</button>
          ) : null}
        </div>

        {dayGroups.length > 0 ? (
          <div className="archive-workspace__days">
            {dayGroups.map((group) => (
              <section
                className="archive-workspace__day"
                key={group.localDate}
                aria-labelledby={`${id}-day-${group.localDate}`}
              >
                <div className="archive-workspace__day-heading">
                  <h3 id={`${id}-day-${group.localDate}`}>
                    <time dateTime={group.localDate}>
                      {formatDayHeading(group.localDate, currentLocalDate)}
                    </time>
                  </h3>
                  <span>{group.entities.length}</span>
                </div>
                <ol>
                  {group.entities.map((entity) => {
                    const catalogEntry = domainCatalogById.get(entity.domain);
                    const DomainIcon = catalogEntry?.icon ?? Archive;
                    const eventLabel = humanEventLabel(entity);
                    const preview = eventPreview(entity);
                    const isDeleted = entity.status === "deleted";

                    return (
                      <li key={`${entity.id}:${entity.revision}`}>
                        <article
                          className="archive-workspace__record"
                          data-deleted={isDeleted ? "true" : "false"}
                        >
                          <span
                            className="archive-workspace__record-icon"
                            data-tone={catalogEntry?.tone ?? "wine"}
                            aria-hidden="true"
                          >
                            <DomainIcon size={21} weight="thin" />
                          </span>
                          <div className="archive-workspace__record-body">
                            <div className="archive-workspace__record-title">
                              <p>{catalogEntry?.label ?? entity.domain}</p>
                              <h4>{eventLabel}</h4>
                            </div>
                            {preview ? (
                              <p className="archive-workspace__record-preview">{preview}</p>
                            ) : null}
                            <p className="archive-workspace__record-meta">
                              <span>{sourceLabels[entity.source]}</span>
                              <span>Revisão {entity.revision}</span>
                              {isDeleted ? <strong>Registro excluído</strong> : null}
                            </p>
                          </div>
                          <time
                            className="archive-workspace__record-time"
                            dateTime={entity.occurredAtUTC}
                          >
                            {formatInstantTime(entity)}
                          </time>
                          {!isDeleted && pendingDeleteId === entity.id ? (
                            <div className="archive-workspace__delete-confirm" role="group" aria-label={`Confirmar exclusão recuperável de ${eventLabel}`}>
                              <p>Retirar do histórico ativo? O registro continuará recuperável.</p>
                              <button type="button" onClick={() => setPendingDeleteId(null)}>Cancelar</button>
                              <button type="button" data-confirm onClick={async () => { await onDelete(entity); setPendingDeleteId(null); }}>Mover para excluídos</button>
                            </div>
                          ) : isDeleted ? (
                            <button type="button" className="archive-workspace__entity-action" data-action="restore" onClick={() => onRestoreEntity(entity)} aria-label={`Restaurar ${eventLabel} de ${formatShortDate(entity.localDate)}`}><ArrowCounterClockwise size={17} aria-hidden="true" /><span>Restaurar</span></button>
                          ) : (
                            <div className="archive-workspace__record-actions">
                              {onEdit ? <button type="button" className="archive-workspace__entity-action" data-action="edit" onClick={() => onEdit(entity)} aria-label={`Editar ${eventLabel} de ${formatShortDate(entity.localDate)}`}><PencilSimple size={17} aria-hidden="true" /><span>Editar</span></button> : null}
                              <button type="button" className="archive-workspace__entity-action" data-action="delete" onClick={() => setPendingDeleteId(entity.id)} aria-label={`Mover ${eventLabel} de ${formatShortDate(entity.localDate)} para excluídos`}><Trash size={17} aria-hidden="true" /><span>Excluir</span></button>
                            </div>
                          )}
                        </article>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        ) : (
          <div className="archive-workspace__empty" role="note">
            <Archive size={29} weight="thin" aria-hidden="true" />
            {filtersActive ? (
              <>
                <h3>Nenhum registro corresponde aos filtros</h3>
                <p>Tente outra palavra ou volte a todos os domínios.</p>
                <button type="button" onClick={clearFilters}>Limpar filtros</button>
              </>
            ) : showDeleted ? (
              <>
                <h3>Nenhum registro disponível nesta visualização</h3>
                <p>Não há registros ativos nem excluídos dentro da janela preservada.</p>
              </>
            ) : (
              <>
                <h3>Ainda não há registros no arquivo</h3>
                <p>Novos fatos aparecerão aqui depois de serem registrados.</p>
              </>
            )}
          </div>
        )}
      </section>

      <section
        className="archive-workspace__section"
        aria-labelledby={`${id}-export-title`}
      >
        <div className="archive-workspace__section-heading">
          <FileText size={23} weight="thin" aria-hidden="true" />
          <div>
            <h2 id={`${id}-export-title`}>Exportar e compartilhar</h2>
            <p>As exportações usam os registros ativos retidos, independentemente da busca na tela.</p>
            <p>{READABLE_EXPORT_PLAINTEXT_WARNING}</p>
          </div>
        </div>

        <div className="archive-workspace__export-grid">
          <button type="button" onClick={onExportJson} disabled={!hasExportableData}>
            <FileCode size={22} weight="thin" aria-hidden="true" />
            <span><strong>JSON</strong><small>Cópia legível dos dados</small></span>
          </button>
          <button type="button" onClick={onExportCsv} disabled={!hasExportableData}>
            <FileCsv size={22} weight="thin" aria-hidden="true" />
            <span><strong>CSV</strong><small>Abrir em planilha</small></span>
          </button>
          <button
            type="button"
            className="archive-workspace__clinician-export"
            onClick={onClinicianReport}
            disabled={!hasExportableData}
          >
            <FileText size={22} weight="thin" aria-hidden="true" />
            <span>
              <strong>Relatório para consulta</strong>
              <small>Resumo para revisar antes de compartilhar com um profissional</small>
            </span>
          </button>
        </div>
        {!hasExportableData ? (
          <p className="archive-workspace__export-empty">
            Não há registros ativos nesta janela para exportar.
          </p>
        ) : null}
      </section>
    </div>
  );
}

export default ArchiveWorkspace;
