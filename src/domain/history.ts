import { inclusiveDateWindow, isWithinInclusiveWindow } from "./dates";
import {
  RETENTION_POLICY,
  type Domain,
  type EntitySource,
  type EntityType,
  type GenericPayload,
  type InclusiveDateWindow,
  type ISOInstant,
  type LocalDate,
  type MentorEntity,
} from "./model";

export interface ArchiveEvent {
  id: string;
  datasetId: string;
  domain: Domain;
  type: EntityType;
  /** The generic event discriminator, when it was explicitly recorded. */
  eventKind: string | null;
  eventKindState: "known" | "unknown" | "invalid";
  localDate: LocalDate;
  occurredAtUTC: ISOInstant;
  source: EntitySource;
  revision: number;
  payload: MentorEntity["payload"];
}

export interface ArchiveSnapshot {
  window: InclusiveDateWindow;
  eventCount: number;
  /** Oldest to newest; callers may reverse a copy for a newest-first feed. */
  events: ArchiveEvent[];
}

export interface ArchiveOptions {
  datasetId?: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function explicitString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (
    isRecord(value) &&
    value.state === "known" &&
    typeof value.value === "string"
  ) {
    const trimmed = value.value.trim();
    return trimmed || null;
  }
  return null;
}

export function archiveEventKind(entity: MentorEntity): string | null {
  if (entity.type !== "generic.event") return entity.type;
  const payload = entity.payload as GenericPayload;
  return explicitString(payload.eventKind);
}

function archiveEventKindState(entity: MentorEntity): ArchiveEvent["eventKindState"] {
  if (entity.type !== "generic.event") return "known";
  const raw = (entity.payload as GenericPayload).eventKind;
  if (explicitString(raw) !== null) return "known";
  if (isRecord(raw) && raw.state === "invalid") return "invalid";
  if (raw !== undefined && raw !== null &&
    !(isRecord(raw) && ["unknown", "not_applicable", "confirmed_absent"].includes(
      String(raw.state),
    ))) return "invalid";
  return "unknown";
}

function compareArchiveEvents(left: ArchiveEvent, right: ArchiveEvent): number {
  if (left.localDate !== right.localDate) {
    return left.localDate.localeCompare(right.localDate);
  }
  if (left.occurredAtUTC !== right.occurredAtUTC) {
    return left.occurredAtUTC.localeCompare(right.occurredAtUTC);
  }
  if (left.revision !== right.revision) return left.revision - right.revision;
  return left.id.localeCompare(right.id);
}

function entityTieKey(entity: MentorEntity): string {
  return [
    entity.updatedAt,
    entity.occurredAtUTC,
    entity.localDate,
    entity.status,
    entity.source,
    entity.domain,
    entity.type,
    JSON.stringify(entity.payload),
  ].join("\u0000");
}

function selectCanonicalEntities(
  entities: readonly MentorEntity[],
  datasetId?: string,
): MentorEntity[] {
  const latest = new Map<string, MentorEntity>();
  for (const entity of entities) {
    if (datasetId && entity.datasetId !== datasetId) continue;
    const key = `${entity.datasetId}\u0000${entity.id}`;
    const previous = latest.get(key);
    if (!previous || entity.revision > previous.revision ||
      (entity.revision === previous.revision && entityTieKey(entity) > entityTieKey(previous))) {
      latest.set(key, entity);
    }
  }
  return [...latest.values()];
}

/**
 * Builds the durable canonical archive without interpreting a missing day as
 * an event-free day. The date bounds are inclusive civil dates.
 */
export function buildArchiveSnapshot(
  entities: readonly MentorEntity[],
  endLocalDate: LocalDate,
  options: ArchiveOptions = {},
): ArchiveSnapshot {
  const window = inclusiveDateWindow(
    endLocalDate,
    RETENTION_POLICY.rawHistoryDays,
  );
  const events = selectCanonicalEntities(entities, options.datasetId)
    .filter(
      (entity) =>
        entity.status === "active" &&
        isWithinInclusiveWindow(entity.localDate, window),
    )
    .map<ArchiveEvent>((entity) => ({
      id: entity.id,
      datasetId: entity.datasetId,
      domain: entity.domain,
      type: entity.type,
      eventKind: archiveEventKind(entity),
      eventKindState: archiveEventKindState(entity),
      localDate: entity.localDate,
      occurredAtUTC: entity.occurredAtUTC,
      source: entity.source,
      revision: entity.revision,
      payload: entity.payload,
    }))
    .sort(compareArchiveEvents);

  return { window, eventCount: events.length, events };
}

export function buildArchiveEvents(
  entities: readonly MentorEntity[],
  endLocalDate: LocalDate,
  options: ArchiveOptions = {},
): ArchiveEvent[] {
  return buildArchiveSnapshot(entities, endLocalDate, options).events;
}
