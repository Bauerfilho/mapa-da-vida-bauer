import {
  APP_TIME_ZONE,
  invalidKnowledge,
  known,
  unknown,
  type DatasetRecord,
  type Domain,
  type GenericPayload,
  type Knowledge,
  type LocalDate,
  type LocalDateTime,
  type LocalTime,
  type MentorEntity,
  type SettingRecord,
  type ShiftPayload,
} from "./model";

export const LEGACY_IMPORT_MAX_JSON_BYTES = 20 * 1024 * 1024;

export type LegacyImportFamily = "legacy-obstetricia" | "legacy-cefaleia";

export type LegacyImportSourceFormat =
  | "obstetricia-v2-envelope"
  | "obstetricia-v1-state"
  | "cefaleia-v1-object"
  | "cefaleia-v1-entry-array";

export interface LegacyImportWarning {
  code:
    | "legacy_free_text_review_required"
    | "legacy_ambiguous_absence"
    | "invalid_date"
    | "invalid_clock"
    | "invalid_number"
    | "invalid_record"
    | "partial_array"
    | "unmatched_shift_actuals"
    | "undated_value_preserved_in_snapshot";
  message: string;
  sourceKey?: string;
  requiresAcknowledgement: boolean;
}

export interface LegacyEntityTemplate {
  sourceKey: string;
  domain: Domain;
  localDate: LocalDate;
  summary: string;
  payload: GenericPayload;
}

export interface LegacyShiftTemplate {
  sourceKey: string;
  localDate: LocalDate;
  scheduledStartLocal: LocalDateTime;
  scheduledEndLocal: LocalDateTime;
  assignment: Knowledge<string>;
  arrivalLocal?: LocalDateTime;
  departureLocal?: LocalDateTime;
  breakStartLocal?: LocalDateTime;
  breakEndLocal?: LocalDateTime;
}

export interface LegacySettingTemplate {
  sourceKey: string;
  key: string;
  value: unknown;
}

export interface NormalizedLegacyImport {
  family: LegacyImportFamily;
  sourceFormat: LegacyImportSourceFormat;
  rawSource: unknown;
  sourceExportedAt?: string;
  entities: LegacyEntityTemplate[];
  shifts: LegacyShiftTemplate[];
  settings: LegacySettingTemplate[];
  warnings: LegacyImportWarning[];
  sourceCounts: Record<string, number>;
}

export interface LegacyImportConflict {
  subjectKind: "entity" | "setting" | "shift";
  key: string;
  sourceKey: string;
  reason:
    | "different_existing_record"
    | "multiple_shift_matches"
    | "recorded_shift_actual_differs"
    | "different_existing_setting";
  existingRevision?: number;
}

export interface LegacyEntityCreateAction {
  kind: "create-entity";
  sourceKey: string;
  entity: MentorEntity;
}

export interface LegacyEntityUpdateAction {
  kind: "update-entity";
  sourceKey: string;
  before: MentorEntity<"internato.shift">;
  entity: MentorEntity<"internato.shift">;
}

export interface LegacySettingPutAction {
  kind: "put-setting";
  sourceKey: string;
  before: SettingRecord | null;
  setting: SettingRecord;
}

export type LegacyImportAction =
  | LegacyEntityCreateAction
  | LegacyEntityUpdateAction
  | LegacySettingPutAction;

export interface LegacyImportPlan {
  family: LegacyImportFamily;
  sourceFormat: LegacyImportSourceFormat;
  sourceChecksumSHA256: string;
  planDigestSHA256: string;
  importedAt: string;
  actions: LegacyImportAction[];
  identicalKeys: string[];
  conflicts: LegacyImportConflict[];
  warnings: LegacyImportWarning[];
  sourceCounts: Record<string, number>;
  counts: {
    creates: number;
    updates: number;
    settings: number;
    identical: number;
    conflicts: number;
  };
}

export interface LegacyImportPlanContext {
  dataset: DatasetRecord;
  existingEntities: readonly MentorEntity[];
  existingSettings: readonly SettingRecord[];
  importedAt: string;
}

interface UnknownRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function own(record: UnknownRecord, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function hasObstetricStateShape(value: unknown): value is UnknownRecord {
  return isRecord(value) && Array.isArray(own(value, "shifts")) && isRecord(own(value, "days"));
}

function hasCefaleiaObjectShape(value: unknown): value is UnknownRecord {
  if (!isRecord(value) || !Array.isArray(own(value, "entries"))) return false;
  const marcos = own(value, "marcos");
  return marcos === undefined || Array.isArray(marcos);
}

function looksLikeCefaleiaEntry(value: unknown): boolean {
  if (!isRecord(value) || typeof own(value, "data") !== "string") return false;
  return [
    "cef",
    "ot",
    "brDia",
    "brPeriodo",
    "brAcordar",
    "seca",
    "sonoH",
    "analg",
    "notas",
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function parseJSONSource(source: string | unknown): unknown {
  if (typeof source !== "string") return source;
  if (new TextEncoder().encode(source).byteLength > LEGACY_IMPORT_MAX_JSON_BYTES) {
    throw new Error("O arquivo legado excede o limite seguro de 20 MB.");
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error("O arquivo legado não contém JSON válido.");
  }
}

export function detectLegacyImportSource(source: string | unknown): {
  format: LegacyImportSourceFormat;
  family: LegacyImportFamily;
  parsed: unknown;
} {
  const parsed = parseJSONSource(source);
  if (
    isRecord(parsed) &&
    own(parsed, "schemaVersion") === 2 &&
    hasObstetricStateShape(own(parsed, "state"))
  ) {
    return {
      format: "obstetricia-v2-envelope",
      family: "legacy-obstetricia",
      parsed,
    };
  }
  if (hasObstetricStateShape(parsed)) {
    return {
      format: "obstetricia-v1-state",
      family: "legacy-obstetricia",
      parsed,
    };
  }
  if (hasCefaleiaObjectShape(parsed)) {
    return {
      format: "cefaleia-v1-object",
      family: "legacy-cefaleia",
      parsed,
    };
  }
  if (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every(looksLikeCefaleiaEntry)
  ) {
    return {
      format: "cefaleia-v1-entry-array",
      family: "legacy-cefaleia",
      parsed,
    };
  }
  throw new Error(
    "Formato legado não reconhecido. Selecione um JSON exportado do Diário de Obstetrícia ou o objeto de armazenamento do Diário de Cefaleia/Bruxismo.",
  );
}

function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

function isClock(value: unknown): value is LocalTime {
  if (typeof value !== "string") return false;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

function nextDate(date: LocalDate): LocalDate {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-") as LocalDate;
}

function dateTime(date: LocalDate, clock: LocalTime): LocalDateTime {
  return `${date}T${clock}:00` as LocalDateTime;
}

function scheduleEndDate(
  date: LocalDate,
  start: LocalTime,
  end: LocalTime,
): LocalDate {
  return end <= start ? nextDate(date) : date;
}

function minutesFromClock(value: LocalTime): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function resolveClockNear(
  clock: LocalTime,
  reference: LocalDateTime,
): LocalDateTime {
  const referenceDate = reference.slice(0, 10) as LocalDate;
  const previousDate = (() => {
    const [year, month, day] = referenceDate.split("-").map(Number);
    const previous = new Date(Date.UTC(year, month - 1, day - 1));
    return [
      previous.getUTCFullYear(),
      String(previous.getUTCMonth() + 1).padStart(2, "0"),
      String(previous.getUTCDate()).padStart(2, "0"),
    ].join("-") as LocalDate;
  })();
  const dates = [previousDate, referenceDate, nextDate(referenceDate)];
  const referenceMinutes = Date.parse(`${reference}Z`) / 60_000;
  return dates
    .map((candidateDate) => dateTime(candidateDate, clock))
    .sort((left, right) =>
      Math.abs(Date.parse(`${left}Z`) / 60_000 - referenceMinutes) -
      Math.abs(Date.parse(`${right}Z`) / 60_000 - referenceMinutes),
    )[0];
}

function importedText(value: unknown): Knowledge<string> {
  return typeof value === "string" && value.trim()
    ? known(value.trim(), "imported")
    : unknown("not_recorded");
}

function importedStringArray(
  value: unknown,
  warnings: LegacyImportWarning[],
  sourceKey: string,
): Knowledge<string[]> {
  if (!Array.isArray(value)) return unknown("not_recorded");
  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  ).map((item) => item.trim());
  if (strings.length !== value.length) {
    warnings.push({
      code: "partial_array",
      message: "Itens inválidos de uma lista legada foram mantidos apenas no snapshot integral.",
      sourceKey,
      requiresAcknowledgement: false,
    });
  }
  return strings.length ? known(strings, "imported") : unknown("not_recorded");
}

function importedNumber(
  value: unknown,
  min: number,
  max: number,
  warnings: LegacyImportWarning[],
  sourceKey: string,
): Knowledge<number> {
  if (value === "" || value === null || value === undefined) {
    return unknown("not_recorded");
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    warnings.push({
      code: "invalid_number",
      message: "Um número legado está fora da faixa válida e foi marcado como inválido.",
      sourceKey,
      requiresAcknowledgement: false,
    });
    return invalidKnowledge("invalid_legacy_number");
  }
  return known(numeric, "imported");
}

function importedBoolean(value: unknown): Knowledge<boolean> {
  return typeof value === "boolean"
    ? known(value, "imported")
    : unknown("legacy_ambiguous");
}

function anyKnown(values: readonly Knowledge<unknown>[]): boolean {
  return values.some((value) => value.state === "known" || value.state === "invalid");
}

function noteWarning(
  warnings: LegacyImportWarning[],
  sourceKey: string,
): void {
  warnings.push({
    code: "legacy_free_text_review_required",
    message: "Há texto livre legado. Revise nomes, telefones ou outros dados identificáveis de pacientes antes de aplicar.",
    sourceKey,
    requiresAcknowledgement: true,
  });
}

function deduplicateWarnings(warnings: LegacyImportWarning[]): LegacyImportWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.sourceKey ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeObstetricia(
  detected: ReturnType<typeof detectLegacyImportSource>,
): NormalizedLegacyImport {
  const envelope = detected.parsed as UnknownRecord;
  const state = (detected.format === "obstetricia-v2-envelope"
    ? own(envelope, "state")
    : envelope) as UnknownRecord;
  const warnings: LegacyImportWarning[] = [];
  const shifts: LegacyShiftTemplate[] = [];
  const entities: LegacyEntityTemplate[] = [];
  const settings: LegacySettingTemplate[] = [];
  const rawShifts = own(state, "shifts") as unknown[];
  const rawDays = own(state, "days") as UnknownRecord;

  rawShifts.forEach((rawShift, index) => {
    const sourceKey = `shift:${index}`;
    if (!isRecord(rawShift)) {
      warnings.push({
        code: "invalid_record",
        message: "Uma escala legada inválida foi preservada apenas no snapshot.",
        sourceKey,
        requiresAcknowledgement: false,
      });
      return;
    }
    const date = own(rawShift, "date");
    const start = own(rawShift, "tin");
    const end = own(rawShift, "tout");
    if (!isLocalDate(date)) {
      warnings.push({
        code: "invalid_date",
        message: "Uma escala tem data inválida e não foi convertida em jornada.",
        sourceKey,
        requiresAcknowledgement: false,
      });
      return;
    }
    if (!isClock(start) || !isClock(end) || start === end) {
      warnings.push({
        code: "invalid_clock",
        message: "Uma escala tem horário inválido ou ambíguo e não foi convertida em jornada.",
        sourceKey,
        requiresAcknowledgement: false,
      });
      return;
    }
    shifts.push({
      sourceKey: `shift:${date}:${start}`,
      localDate: date,
      scheduledStartLocal: dateTime(date, start),
      scheduledEndLocal: dateTime(scheduleEndDate(date, start, end), end),
      assignment: importedText(own(rawShift, "type")),
    });
  });

  const shiftByDate = new Map(shifts.map((shift) => [shift.localDate, shift]));
  for (const [dateKey, rawDay] of Object.entries(rawDays)) {
    const sourceKey = `day:${dateKey}`;
    if (!isLocalDate(dateKey) || !isRecord(rawDay)) {
      warnings.push({
        code: !isLocalDate(dateKey) ? "invalid_date" : "invalid_record",
        message: "Um dia legado inválido foi preservado apenas no snapshot.",
        sourceKey,
        requiresAcknowledgement: false,
      });
      continue;
    }
    const dayShift = shiftByDate.get(dateKey);
    const clocks = {
      arrival: own(rawDay, "arr"),
      departure: own(rawDay, "out"),
      breakStart: own(rawDay, "lunchIn"),
      breakEnd: own(rawDay, "lunchOut"),
    };
    const validClockEntries = Object.entries(clocks).filter((entry): entry is [string, LocalTime] =>
      isClock(entry[1]),
    );
    for (const [field, value] of Object.entries(clocks)) {
      if (value !== "" && value !== undefined && !isClock(value)) {
        warnings.push({
          code: "invalid_clock",
          message: `O horário legado ${field} é inválido e ficou apenas no snapshot.`,
          sourceKey,
          requiresAcknowledgement: false,
        });
      }
    }
    if (dayShift) {
      if (isClock(clocks.arrival)) {
        dayShift.arrivalLocal = resolveClockNear(clocks.arrival, dayShift.scheduledStartLocal);
      }
      if (isClock(clocks.departure)) {
        dayShift.departureLocal = resolveClockNear(clocks.departure, dayShift.scheduledEndLocal);
      }
      if (isClock(clocks.breakStart)) {
        dayShift.breakStartLocal = resolveClockNear(
          clocks.breakStart,
          dayShift.scheduledStartLocal,
        );
      }
      if (isClock(clocks.breakEnd)) {
        const reference = dayShift.breakStartLocal ?? dayShift.scheduledStartLocal;
        dayShift.breakEndLocal = resolveClockNear(clocks.breakEnd, reference);
        if (
          dayShift.breakStartLocal &&
          dayShift.breakEndLocal < dayShift.breakStartLocal
        ) {
          dayShift.breakEndLocal = dateTime(
            nextDate(dayShift.breakEndLocal.slice(0, 10) as LocalDate),
            clocks.breakEnd,
          );
        }
      }
    } else if (validClockEntries.length) {
      warnings.push({
        code: "unmatched_shift_actuals",
        message: "Há horários reais sem escala correspondente; eles foram preservados no debrief, sem criar uma jornada presumida.",
        sourceKey,
        requiresAcknowledgement: false,
      });
    }

    const topics = importedStringArray(own(rawDay, "topics"), warnings, sourceKey);
    const rawFeedback = Array.isArray(own(rawDay, "broncas"))
      ? (own(rawDay, "broncas") as unknown[])
      : [];
    const feedbackAreas = rawFeedback.flatMap((item) =>
      isRecord(item) && typeof own(item, "area") === "string" && (own(item, "area") as string).trim()
        ? [(own(item, "area") as string).trim()]
        : [],
    );
    const feedbackWording = rawFeedback.flatMap((item) =>
      isRecord(item) && typeof own(item, "note") === "string" && (own(item, "note") as string).trim()
        ? [(own(item, "note") as string).trim()]
        : [],
    );
    const note = importedText(own(rawDay, "note"));
    if (note.state === "known" || feedbackWording.length) noteWarning(warnings, sourceKey);
    const saved = own(rawDay, "saved") === true;
    if (
      saved ||
      topics.state === "known" ||
      feedbackAreas.length ||
      feedbackWording.length ||
      note.state === "known" ||
      (!dayShift && validClockEntries.length)
    ) {
      entities.push({
        sourceKey: `${sourceKey}:internato`,
        domain: "internato",
        localDate: dateKey,
        summary: "Registro de internato importado do Diário de Obstetrícia legado.",
        payload: {
          schema: "internship-debrief-v1",
          eventKind: "internship-debrief",
          participation: unknown("legacy_ambiguous"),
          topicsSeen: topics,
          topics,
          feedback: {
            state: feedbackAreas.length
              ? known("feedback_recorded", "imported")
              : unknown("not_recorded"),
            count: feedbackAreas.length
              ? known(feedbackAreas.length, "imported")
              : unknown("not_recorded"),
            areas: feedbackAreas.length
              ? known(feedbackAreas, "imported")
              : unknown("not_recorded"),
            wording: feedbackWording.length
              ? known(feedbackWording.join("\n"), "imported")
              : unknown("not_recorded"),
          },
          nextPractice: unknown("not_recorded"),
          learningNote: note,
          legacy: {
            saved: known(saved, "imported"),
            unmatchedClocks: !dayShift
              ? known(Object.fromEntries(validClockEntries), "imported")
              : unknown("not_recorded"),
          },
        },
      });
    }

    const mood = isRecord(own(rawDay, "mood")) ? (own(rawDay, "mood") as UnknownRecord) : {};
    const legacyMoodFields = {
      humor: importedNumber(own(mood, "humor"), 1, 7, warnings, sourceKey),
      energia: importedNumber(own(mood, "energia"), 1, 7, warnings, sourceKey),
      ansiedade: importedNumber(own(mood, "ansiedade"), 1, 7, warnings, sourceKey),
      foco: importedNumber(own(mood, "foco"), 1, 7, warnings, sourceKey),
    };
    if (anyKnown(Object.values(legacyMoodFields))) {
      entities.push({
        sourceKey: `${sourceKey}:humor`,
        domain: "humor",
        localDate: dateKey,
        summary: "Escalas 1–7 importadas sem conversão para a escala atual.",
        payload: {
          schema: "legacy-obstetric-mood-v1",
          eventKind: "legacy-mood-check-in-1-7",
          legacyScaleVersion: "obstetricia-mood-1-7-v1",
          legacyValues: legacyMoodFields,
        },
      });
    }
    const sleepHours = importedNumber(own(mood, "sono"), 0, 24, warnings, sourceKey);
    if (sleepHours.state === "known" || sleepHours.state === "invalid") {
      entities.push({
        sourceKey: `${sourceKey}:sono`,
        domain: "sono",
        localDate: dateKey,
        summary: "Duração do sono importada do Diário de Obstetrícia legado.",
        payload: {
          schema: "legacy-sleep-summary-v1",
          eventKind: "sleep-episode",
          totalSleepMinutes: sleepHours.state === "known"
            ? known(Math.round(sleepHours.value * 60), "imported")
            : sleepHours,
          sourcePrecision: "hours",
        },
      });
    }
    const medicationStatus = importedText(own(mood, "meds"));
    if (medicationStatus.state === "known") {
      entities.push({
        sourceKey: `${sourceKey}:medicamentos`,
        domain: "medicamentos",
        localDate: dateKey,
        summary: "Resumo de medicação legado preservado sem inferir doses.",
        payload: {
          schema: "legacy-medication-adherence-summary-v1",
          eventKind: "legacy-medication-adherence-summary",
          legacyStatus: medicationStatus,
          confirmation: unknown("legacy_ambiguous"),
        },
      });
    }
    const study = importedNumber(own(rawDay, "study"), 0, 1_440, warnings, sourceKey);
    if (study.state === "known" && study.value > 0) {
      entities.push({
        sourceKey: `${sourceKey}:estudo`,
        domain: "estudos",
        localDate: dateKey,
        summary: "Tempo de estudo importado do Diário de Obstetrícia legado.",
        payload: {
          schema: "study-session-v1",
          eventKind: "study-session",
          subject: unknown("not_recorded"),
          source: known("Diário de Obstetrícia legado", "imported"),
          startedAtLocal: unknown("not_recorded"),
          endedAtLocal: unknown("not_recorded"),
          minutes: study,
          actualDurationMinutes: study,
          plannedDurationMinutes: unknown("not_recorded"),
          completed: unknown("legacy_ambiguous"),
          questions: {
            attempted: unknown("not_recorded"),
            correct: unknown("not_recorded"),
          },
          confidenceBefore: unknown("not_recorded"),
          confidenceAfter: unknown("not_recorded"),
          review: {
            state: unknown("not_recorded"),
            nextDate: unknown("not_recorded"),
          },
          note: unknown("not_recorded"),
        },
      });
    }
  }

  const rawNotes = Array.isArray(own(state, "notes")) ? (own(state, "notes") as unknown[]) : [];
  rawNotes.forEach((rawNote, index) => {
    const sourceKey = `note:${index}`;
    if (!isRecord(rawNote)) return;
    const timestamp = own(rawNote, "ts");
    const date = typeof timestamp === "number" && Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString().slice(0, 10)
      : null;
    if (!date || !isLocalDate(date)) {
      warnings.push({
        code: "invalid_date",
        message: "Uma anotação sem data válida foi preservada apenas no snapshot.",
        sourceKey,
        requiresAcknowledgement: false,
      });
      return;
    }
    const title = importedText(own(rawNote, "title"));
    const body = importedText(own(rawNote, "body"));
    const tags = importedStringArray(own(rawNote, "tags"), warnings, sourceKey);
    if (body.state === "known" || title.state === "known") noteWarning(warnings, sourceKey);
    entities.push({
      sourceKey: `${sourceKey}:${String(own(rawNote, "id") ?? timestamp ?? index)}`,
      domain: "conhecimento",
      localDate: date,
      summary: "Anotação importada do caderno legado.",
      payload: {
        schema: "knowledge-capture-v1",
        eventKind: "knowledge-capture",
        title,
        topic: unknown("not_recorded"),
        source: {
          kind: known("legacy-diary", "imported"),
          reference: known("Diário de Obstetrícia", "imported"),
        },
        capture: body,
        application: unknown("not_recorded"),
        openQuestion: unknown("not_recorded"),
        confidence: unknown("not_recorded"),
        nextReviewDate: unknown("not_recorded"),
        reviewDueDate: unknown("not_recorded"),
        review: { dueDate: unknown("not_recorded") },
        tags,
      },
    });
  });

  const reviewed = isRecord(own(state, "reviewed")) ? (own(state, "reviewed") as UnknownRecord) : {};
  for (const [topic, dateValue] of Object.entries(reviewed)) {
    if (!isLocalDate(dateValue)) {
      warnings.push({
        code: "invalid_date",
        message: "Uma revisão legada tem data inválida e ficou apenas no snapshot.",
        sourceKey: `review:${topic}`,
        requiresAcknowledgement: false,
      });
      continue;
    }
    entities.push({
      sourceKey: `review:${topic}:${dateValue}`,
      domain: "conhecimento",
      localDate: dateValue,
      summary: "Revisão de tópico importada do Diário de Obstetrícia legado.",
      payload: {
        schema: "legacy-knowledge-review-v1",
        eventKind: "knowledge-capture",
        title: known(topic, "imported"),
        topic: known(topic, "imported"),
        source: {
          kind: known("legacy-review", "imported"),
          reference: known("Diário de Obstetrícia", "imported"),
        },
        capture: unknown("not_recorded"),
        application: unknown("not_recorded"),
        openQuestion: unknown("not_recorded"),
        confidence: unknown("not_recorded"),
        nextReviewDate: unknown("not_recorded"),
        reviewDueDate: unknown("not_recorded"),
        review: { dueDate: unknown("not_recorded") },
        reviewed: known(true, "imported"),
        reviewedAt: known(dateValue, "imported"),
        tags: known(["Revisão legada"], "imported"),
      },
    });
  }

  const goals = own(state, "goals");
  if (isRecord(goals)) {
    settings.push({
      sourceKey: "settings:study-goals",
      key: "legacy.obstetricia.study-goals",
      value: {
        schema: "legacy-obstetricia-study-goals-v1",
        values: goals,
      },
    });
  }

  const exportedAt = detected.format === "obstetricia-v2-envelope"
    ? own(envelope, "exportedAt")
    : undefined;
  return {
    family: "legacy-obstetricia",
    sourceFormat: detected.format,
    rawSource: detected.parsed,
    ...(typeof exportedAt === "number" && Number.isFinite(exportedAt)
      ? { sourceExportedAt: new Date(exportedAt).toISOString() }
      : typeof exportedAt === "string" && Number.isFinite(Date.parse(exportedAt))
        ? { sourceExportedAt: new Date(exportedAt).toISOString() }
        : {}),
    entities,
    shifts,
    settings,
    warnings: deduplicateWarnings(warnings),
    sourceCounts: {
      shifts: rawShifts.length,
      days: Object.keys(rawDays).length,
      notes: rawNotes.length,
      reviews: Object.keys(reviewed).length,
    },
  };
}

function severityPresence(
  value: unknown,
  noneLabels: readonly string[],
): Knowledge<boolean> {
  if (typeof value !== "string" || !value.trim()) return unknown("not_recorded");
  const normalized = value.trim().toLocaleLowerCase("pt-BR");
  return known(!noneLabels.includes(normalized), "imported");
}

function arrayPresence(
  value: unknown,
  noneLabels: readonly string[],
): Knowledge<boolean> {
  if (!Array.isArray(value) || value.length === 0) return unknown("not_recorded");
  const strings = value.filter((item): item is string => typeof item === "string");
  if (!strings.length) return unknown("not_recorded");
  const present = strings.some(
    (item) => !noneLabels.includes(item.trim().toLocaleLowerCase("pt-BR")),
  );
  return known(present, "imported");
}

function normalizeCefaleia(
  detected: ReturnType<typeof detectLegacyImportSource>,
): NormalizedLegacyImport {
  const parsed = detected.parsed;
  const entries = (Array.isArray(parsed)
    ? parsed
    : own(parsed as UnknownRecord, "entries")) as unknown[];
  const marcos = Array.isArray(parsed)
    ? []
    : Array.isArray(own(parsed as UnknownRecord, "marcos"))
      ? (own(parsed as UnknownRecord, "marcos") as unknown[])
      : [];
  const entities: LegacyEntityTemplate[] = [];
  const warnings: LegacyImportWarning[] = [];

  entries.forEach((rawEntry, index) => {
    const baseSourceKey = `entry:${index}`;
    if (!isRecord(rawEntry) || !isLocalDate(own(rawEntry, "data"))) {
      warnings.push({
        code: !isRecord(rawEntry) ? "invalid_record" : "invalid_date",
        message: "Um registro diário legado inválido foi preservado apenas no snapshot.",
        sourceKey: baseSourceKey,
        requiresAcknowledgement: false,
      });
      return;
    }
    const date = own(rawEntry, "data") as LocalDate;
    const sourceKey = `entry:${date}:${String(own(rawEntry, "id") ?? index)}`;
    const cef = own(rawEntry, "cef");
    const headachePresent = isRecord(cef)
      ? known(true, "imported")
      : unknown<boolean>("legacy_ambiguous");
    if (!isRecord(cef)) {
      warnings.push({
        code: "legacy_ambiguous_absence",
        message: "O protótipo antigo não distinguia campo intocado de ausência de cefaleia; o dia foi mantido como desconhecido.",
        sourceKey: `${sourceKey}:cefaleia`,
        requiresAcknowledgement: false,
      });
    }
    const headacheNote = importedText(own(rawEntry, "notas"));
    if (headacheNote.state === "known") noteWarning(warnings, sourceKey);
    const cefIntensity = isRecord(cef)
      ? importedNumber(own(cef, "int"), 0, 10, warnings, sourceKey)
      : unknown<number>("legacy_ambiguous");
    const durationHours = isRecord(cef)
      ? importedNumber(own(cef, "dur"), 0, 24, warnings, sourceKey)
      : unknown<number>("legacy_ambiguous");
    const onset = isRecord(cef) && isClock(own(cef, "inicio"))
      ? known(own(cef, "inicio") as LocalTime, "imported")
      : unknown<string>("not_recorded");
    if (isRecord(cef) && own(cef, "inicio") && onset.state === "unknown") {
      warnings.push({
        code: "invalid_clock",
        message: "Um horário de início de cefaleia inválido ficou apenas no snapshot.",
        sourceKey,
        requiresAcknowledgement: false,
      });
    }
    entities.push({
      sourceKey: `${sourceKey}:cefaleia`,
      domain: "cefaleia",
      localDate: date,
      summary: "Registro de cefaleia importado do diário legado.",
      payload: {
        schema: "legacy-headache-day-v1",
        eventKind: "headache-day",
        scope: known("day", "imported"),
        presence: headachePresent,
        onsetLocal: onset,
        endedLocal: unknown("not_recorded"),
        durationMinutes: durationHours.state === "known"
          ? known(Math.round(durationHours.value * 60), "imported")
          : durationHours,
        intensityCurrent: cefIntensity,
        intensityPeak: cefIntensity,
        locations: isRecord(cef)
          ? importedStringArray(own(cef, "locais"), warnings, sourceKey)
          : unknown("legacy_ambiguous"),
        qualities: isRecord(cef) && typeof own(cef, "carater") === "string" && (own(cef, "carater") as string).trim()
          ? known([(own(cef, "carater") as string).trim()], "imported")
          : unknown("not_recorded"),
        associatedSymptoms: unknown("not_recorded"),
        suspectedTriggers: unknown("not_recorded"),
        rescueUsed: unknown("legacy_ambiguous"),
        response: unknown("not_recorded"),
        note: headacheNote.state === "known"
          ? unknown("legacy_ambiguous")
          : headacheNote,
        legacyNoteReference: headacheNote.state === "known"
          ? known(`${sourceKey}:nota`, "imported")
          : unknown("not_recorded"),
        wakingPresence: isRecord(cef) ? importedText(own(cef, "acordar")) : unknown("not_recorded"),
        legacyContext: {
          earPain: own(rawEntry, "ot") ?? null,
          opticalCorrection: own(rawEntry, "opt") ?? null,
          screenTimeBand: own(rawEntry, "tela") ?? null,
        },
      },
    });
    if (headacheNote.state === "known") {
      entities.push({
        sourceKey: `${sourceKey}:nota`,
        domain: "conhecimento",
        localDate: date,
        summary: "Observação de saúde importada uma única vez do diário legado.",
        payload: {
          schema: "knowledge-capture-v1",
          eventKind: "knowledge-capture",
          title: known("Observação do diário de cefaleia e bruxismo", "imported"),
          topic: known("Saúde e contexto", "imported"),
          source: {
            kind: known("legacy-diary", "imported"),
            reference: known("Diário de Cefaleia e Bruxismo", "imported"),
          },
          capture: headacheNote,
          application: unknown("not_recorded"),
          openQuestion: unknown("not_recorded"),
          confidence: unknown("not_recorded"),
          nextReviewDate: unknown("not_recorded"),
          reviewDueDate: unknown("not_recorded"),
          review: { dueDate: unknown("not_recorded") },
          tags: known(["Saúde", "Importado"], "imported"),
        },
      });
    }

    const bruxismSeverity = importedText(own(rawEntry, "brDia"));
    const morningDescriptors = importedStringArray(
      own(rawEntry, "brAcordar"),
      warnings,
      sourceKey,
    );
    const periodDescriptors = importedStringArray(
      own(rawEntry, "brPeriodo"),
      warnings,
      sourceKey,
    );
    const daytimeClenching = severityPresence(own(rawEntry, "brDia"), ["nenhum", "nenhuma"]);
    const morningSymptoms = arrayPresence(own(rawEntry, "brAcordar"), ["nada", "nenhum", "nenhuma"]);
    if (
      daytimeClenching.state === "known" ||
      morningSymptoms.state === "known" ||
      periodDescriptors.state === "known" ||
      own(rawEntry, "seca") !== null && own(rawEntry, "seca") !== undefined && own(rawEntry, "seca") !== ""
    ) {
      const presence = daytimeClenching.state === "known" && daytimeClenching.value === true ||
        morningSymptoms.state === "known" && morningSymptoms.value === true
        ? known(true, "imported")
        : daytimeClenching.state === "known" && daytimeClenching.value === false &&
          morningSymptoms.state === "known" && morningSymptoms.value === false
          ? known(false, "imported")
          : unknown<boolean>("legacy_ambiguous");
      entities.push({
        sourceKey: `${sourceKey}:bruxismo`,
        domain: "bruxismo",
        localDate: date,
        summary: "Registro de bruxismo importado sem converter categorias em escores.",
        payload: {
          schema: "legacy-bruxism-check-in-v1",
          eventKind: "bruxism-check-in",
          presence,
          daytimeClenching,
          grindingReported: unknown("not_recorded"),
          morningSymptoms,
          morning: {
            jawPain: unknown("legacy_ambiguous"),
            templePain: unknown("legacy_ambiguous"),
            stiffness: unknown("legacy_ambiguous"),
            dentalSensitivity: unknown("not_recorded"),
          },
          evening: {
            jawPain: unknown("not_recorded"),
            templePain: unknown("not_recorded"),
            stiffness: unknown("not_recorded"),
            dentalSensitivity: unknown("not_recorded"),
          },
          guardUsed: unknown("not_recorded"),
          splintUsed: unknown("not_recorded"),
          legacySeverity: bruxismSeverity,
          legacyPeriods: periodDescriptors,
          legacyMorningDescriptors: morningDescriptors,
          dryMouthIntensity: importedNumber(own(rawEntry, "seca"), 0, 10, warnings, sourceKey),
          oralRestlessness: importedText(own(rawEntry, "inq")),
          note: headacheNote.state === "known"
            ? unknown("legacy_ambiguous")
            : headacheNote,
          legacyNoteReference: headacheNote.state === "known"
            ? known(`${sourceKey}:nota`, "imported")
            : unknown("not_recorded"),
        },
      });
    }

    const sleepHours = importedNumber(own(rawEntry, "sonoH"), 0, 24, warnings, sourceKey);
    const awakenings = importedNumber(own(rawEntry, "sonoD"), 0, 100, warnings, sourceKey);
    const sleepQuality = importedText(own(rawEntry, "sonoQ"));
    if (anyKnown([sleepHours, awakenings, sleepQuality])) {
      entities.push({
        sourceKey: `${sourceKey}:sono`,
        domain: "sono",
        localDate: date,
        summary: "Resumo de sono importado do diário legado.",
        payload: {
          schema: "legacy-sleep-summary-v1",
          eventKind: "sleep-episode",
          totalSleepMinutes: sleepHours.state === "known"
            ? known(Math.round(sleepHours.value * 60), "imported")
            : sleepHours,
          awakenings,
          perceivedQuality: sleepQuality,
          sourcePrecision: "daily-summary",
        },
      });
    }

    const firstDose = isClock(own(rawEntry, "lis1"))
      ? known(own(rawEntry, "lis1") as LocalTime, "imported")
      : unknown<string>("not_recorded");
    const secondDose = isClock(own(rawEntry, "lis2"))
      ? known(own(rawEntry, "lis2") as LocalTime, "imported")
      : unknown<string>("not_recorded");
    const analgesicLabel = importedText(own(rawEntry, "analgQual"));
    const analgesicWasExplicitlyPositive = own(rawEntry, "analg") === true;
    if (
      firstDose.state === "known" ||
      secondDose.state === "known" ||
      analgesicWasExplicitlyPositive ||
      analgesicLabel.state === "known"
    ) {
      entities.push({
        sourceKey: `${sourceKey}:medicamentos`,
        domain: "medicamentos",
        localDate: date,
        summary: "Horários e analgésico importados sem inferir medicamento, dose ou prescrição.",
        payload: {
          schema: "legacy-medication-day-v1",
          eventKind: "legacy-medication-day",
          stimulantDoseTimes: {
            first: firstDose,
            second: secondDose,
          },
          analgesicUsed: analgesicWasExplicitlyPositive
            ? known(true, "imported")
            : unknown("legacy_ambiguous"),
          analgesicLabel,
          confirmation: unknown("legacy_ambiguous"),
        },
      });
    }
  });

  marcos.forEach((rawMark, index) => {
    const sourceKey = `scheme-mark:${index}`;
    if (!isRecord(rawMark) || !isLocalDate(own(rawMark, "data"))) {
      warnings.push({
        code: !isRecord(rawMark) ? "invalid_record" : "invalid_date",
        message: "Um marco de esquema inválido ficou apenas no snapshot.",
        sourceKey,
        requiresAcknowledgement: false,
      });
      return;
    }
    const text = importedText(own(rawMark, "texto"));
    if (text.state !== "known") return;
    noteWarning(warnings, sourceKey);
    entities.push({
      sourceKey: `${sourceKey}:${own(rawMark, "data")}:${String(own(rawMark, "id") ?? index)}`,
      domain: "medicamentos",
      localDate: own(rawMark, "data") as LocalDate,
      summary: "Marco de esquema importado literalmente, sem interpretação terapêutica.",
      payload: {
        schema: "legacy-medication-scheme-mark-v1",
        eventKind: "medication-regimen",
        recordMode: "regimen",
        medicationName: unknown("legacy_ambiguous"),
        dose: unknown("legacy_ambiguous"),
        form: unknown("not_recorded"),
        schedule: unknown("legacy_ambiguous"),
        regimenStatus: unknown("not_recorded"),
        stock: {
          quantity: unknown("not_recorded"),
          unit: unknown("not_recorded"),
          refillAt: unknown("not_recorded"),
        },
        sos: {
          reason: unknown("not_recorded"),
          takenAtLocal: unknown("not_recorded"),
          response: unknown("not_recorded"),
        },
        note: text,
        legacySchemeText: text,
      },
    });
  });

  return {
    family: "legacy-cefaleia",
    sourceFormat: detected.format,
    rawSource: detected.parsed,
    entities,
    shifts: [],
    settings: [],
    warnings: deduplicateWarnings(warnings),
    sourceCounts: {
      entries: entries.length,
      schemeMarks: marcos.length,
    },
  };
}

export function normalizeLegacyImport(source: string | unknown): NormalizedLegacyImport {
  const detected = detectLegacyImportSource(source);
  if (
    new TextEncoder().encode(stableSerialize(detected.parsed)).byteLength >
    LEGACY_IMPORT_MAX_JSON_BYTES
  ) {
    throw new Error("O arquivo legado excede o limite seguro de 20 MB.");
  }
  return detected.family === "legacy-obstetricia"
    ? normalizeObstetricia(detected)
    : normalizeCefaleia(detected);
}

export function stableSerialize(value: unknown): string {
  const ancestors = new WeakSet<object>();
  const visit = (current: unknown): unknown => {
    if (current === null || typeof current !== "object") return current;
    if (ancestors.has(current)) {
      throw new Error("O conteúdo legado contém uma referência circular.");
    }
    ancestors.add(current);
    try {
      if (Array.isArray(current)) return current.map(visit);
      const record = current as UnknownRecord;
      return Object.fromEntries(
        Object.keys(record).sort().map((key) => [key, visit(record[key])]),
      );
    } finally {
      ancestors.delete(current);
    }
  };
  return JSON.stringify(visit(value));
}

export async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 indisponível neste navegador.");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function dateOnlyOccurrence(date: LocalDate): string {
  // A data é verdade legada; 12:00Z é apenas o índice técnico estável para um
  // formato que nunca registrou o instante. O payload conserva essa precisão.
  return `${date}T12:00:00.000Z`;
}

function comparableEntity(entity: MentorEntity): unknown {
  return {
    domain: entity.domain,
    type: entity.type,
    localDate: entity.localDate,
    timezone: entity.timezone,
    schemaVersion: entity.schemaVersion,
    status: entity.status,
    payload: entity.payload,
  };
}

function knowledgeSame(left: Knowledge<unknown>, right: Knowledge<unknown>): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

function mergeShiftActuals(
  current: MentorEntity<"internato.shift">,
  incoming: LegacyShiftTemplate,
  importedAt: string,
): { entity: MentorEntity<"internato.shift">; conflict: boolean; changed: boolean } {
  const payload: ShiftPayload = { ...current.payload };
  let conflict = false;
  let changed = false;
  const fields = [
    ["arrivalLocal", incoming.arrivalLocal],
    ["departureLocal", incoming.departureLocal],
    ["breakStartLocal", incoming.breakStartLocal],
    ["breakEndLocal", incoming.breakEndLocal],
  ] as const;
  for (const [field, incomingValue] of fields) {
    if (!incomingValue) continue;
    const nextKnowledge = known(incomingValue, "imported") as Knowledge<LocalDateTime>;
    const existing = payload[field];
    if (existing.state === "unknown") {
      payload[field] = nextKnowledge;
      changed = true;
    } else if (!knowledgeSame(existing, nextKnowledge)) {
      conflict = true;
    }
  }
  return {
    conflict,
    changed,
    entity: {
      ...current,
      payload,
      revision: current.revision + (changed && !conflict ? 1 : 0),
      updatedAt: changed && !conflict ? importedAt : current.updatedAt,
    },
  };
}

async function legacyEntityId(family: LegacyImportFamily, sourceKey: string): Promise<string> {
  const digest = await sha256Hex(`${family}:${sourceKey}`);
  return `legacy-${family === "legacy-obstetricia" ? "obst" : "cef"}-${digest.slice(0, 24)}`;
}

export async function buildLegacyImportPlan(
  normalized: NormalizedLegacyImport,
  context: LegacyImportPlanContext,
): Promise<LegacyImportPlan> {
  if (!Number.isFinite(Date.parse(context.importedAt))) {
    throw new Error("O instante de importação é inválido.");
  }
  const actions: LegacyImportAction[] = [];
  const identicalKeys: string[] = [];
  const conflicts: LegacyImportConflict[] = [];
  const entityById = new Map(context.existingEntities.map((entity) => [entity.id, entity]));
  const settingByKey = new Map(context.existingSettings.map((setting) => [setting.key, setting]));

  for (const template of normalized.entities) {
    const id = await legacyEntityId(normalized.family, template.sourceKey);
    const entity: MentorEntity<"generic.event"> = {
      id,
      datasetId: context.dataset.id,
      domain: template.domain,
      type: "generic.event",
      localDate: template.localDate,
      occurredAtUTC: dateOnlyOccurrence(template.localDate),
      timezone: APP_TIME_ZONE,
      schemaVersion: 1,
      revision: 1,
      source: "imported",
      status: "active",
      createdAt: context.importedAt,
      updatedAt: context.importedAt,
      payload: {
        ...template.payload,
        legacyImport: {
          family: normalized.family,
          sourceFormat: normalized.sourceFormat,
          sourceKey: template.sourceKey,
          occurrencePrecision: "date-only",
        },
      },
    };
    const existing = entityById.get(id);
    if (!existing) {
      actions.push({ kind: "create-entity", sourceKey: template.sourceKey, entity });
    } else if (stableSerialize(comparableEntity(existing)) === stableSerialize(comparableEntity(entity))) {
      identicalKeys.push(template.sourceKey);
    } else {
      conflicts.push({
        subjectKind: "entity",
        key: id,
        sourceKey: template.sourceKey,
        reason: "different_existing_record",
        existingRevision: existing.revision,
      });
    }
  }

  for (const shift of normalized.shifts) {
    const matches = context.existingEntities.flatMap((entity) => {
      if (entity.type !== "internato.shift" || entity.status !== "active") return [];
      const typed = entity as MentorEntity<"internato.shift">;
      return typed.payload.scheduledStartLocal === shift.scheduledStartLocal &&
        typed.payload.scheduledEndLocal === shift.scheduledEndLocal
        ? [typed]
        : [];
    });
    if (matches.length > 1) {
      conflicts.push({
        subjectKind: "shift",
        key: `${shift.scheduledStartLocal}/${shift.scheduledEndLocal}`,
        sourceKey: shift.sourceKey,
        reason: "multiple_shift_matches",
      });
      continue;
    }
    if (matches.length === 1) {
      const merged = mergeShiftActuals(matches[0], shift, context.importedAt);
      if (merged.conflict) {
        conflicts.push({
          subjectKind: "shift",
          key: matches[0].id,
          sourceKey: shift.sourceKey,
          reason: "recorded_shift_actual_differs",
          existingRevision: matches[0].revision,
        });
      } else if (merged.changed) {
        actions.push({
          kind: "update-entity",
          sourceKey: shift.sourceKey,
          before: matches[0],
          entity: merged.entity,
        });
      } else {
        identicalKeys.push(shift.sourceKey);
      }
      continue;
    }

    const id = await legacyEntityId(normalized.family, shift.sourceKey);
    const entity: MentorEntity<"internato.shift"> = {
      id,
      datasetId: context.dataset.id,
      domain: "internato",
      type: "internato.shift",
      localDate: shift.localDate,
      occurredAtUTC: dateOnlyOccurrence(shift.localDate),
      timezone: APP_TIME_ZONE,
      schemaVersion: 1,
      revision: 1,
      source: "imported",
      status: "active",
      createdAt: context.importedAt,
      updatedAt: context.importedAt,
      payload: {
        scheduleState: "confirmed_planned",
        scheduledStartLocal: shift.scheduledStartLocal,
        scheduledEndLocal: shift.scheduledEndLocal,
        assignment: shift.assignment,
        location: unknown("not_confirmed"),
        attendance: unknown("not_recorded"),
        arrivalLocal: shift.arrivalLocal
          ? known(shift.arrivalLocal, "imported")
          : unknown("not_recorded"),
        departureLocal: shift.departureLocal
          ? known(shift.departureLocal, "imported")
          : unknown("not_recorded"),
        breakStartLocal: shift.breakStartLocal
          ? known(shift.breakStartLocal, "imported")
          : unknown("not_recorded"),
        breakEndLocal: shift.breakEndLocal
          ? known(shift.breakEndLocal, "imported")
          : unknown("not_recorded"),
      },
    };
    const existing = entityById.get(id);
    if (!existing) {
      actions.push({ kind: "create-entity", sourceKey: shift.sourceKey, entity });
    } else if (stableSerialize(comparableEntity(existing)) === stableSerialize(comparableEntity(entity))) {
      identicalKeys.push(shift.sourceKey);
    } else {
      conflicts.push({
        subjectKind: "shift",
        key: id,
        sourceKey: shift.sourceKey,
        reason: "different_existing_record",
        existingRevision: existing.revision,
      });
    }
  }

  for (const template of normalized.settings) {
    const existing = settingByKey.get(template.key) ?? null;
    if (existing && stableSerialize(existing.value) === stableSerialize(template.value)) {
      identicalKeys.push(template.sourceKey);
      continue;
    }
    if (existing) {
      conflicts.push({
        subjectKind: "setting",
        key: template.key,
        sourceKey: template.sourceKey,
        reason: "different_existing_setting",
      });
      continue;
    }
    actions.push({
      kind: "put-setting",
      sourceKey: template.sourceKey,
      before: null,
      setting: {
        id: `${context.dataset.id}:${template.key}`,
        datasetId: context.dataset.id,
        key: template.key,
        value: template.value,
        updatedAt: context.importedAt,
      },
    });
  }

  const sourceChecksumSHA256 = await sha256Hex(stableSerialize(normalized.rawSource));
  const planMaterial = {
    family: normalized.family,
    sourceFormat: normalized.sourceFormat,
    sourceChecksumSHA256,
    importedAt: context.importedAt,
    actions,
    identicalKeys: [...identicalKeys].sort(),
    conflicts,
    warnings: normalized.warnings,
  };
  const planDigestSHA256 = await sha256Hex(stableSerialize(planMaterial));
  return {
    family: normalized.family,
    sourceFormat: normalized.sourceFormat,
    sourceChecksumSHA256,
    planDigestSHA256,
    importedAt: context.importedAt,
    actions,
    identicalKeys,
    conflicts,
    warnings: normalized.warnings,
    sourceCounts: normalized.sourceCounts,
    counts: {
      creates: actions.filter((action) => action.kind === "create-entity").length,
      updates: actions.filter((action) => action.kind === "update-entity").length,
      settings: actions.filter((action) => action.kind === "put-setting").length,
      identical: identicalKeys.length,
      conflicts: conflicts.length,
    },
  };
}

export function totalScheduledMinutes(shift: LegacyShiftTemplate): number {
  return Math.max(
    0,
    Math.round(
      (Date.parse(`${shift.scheduledEndLocal}Z`) -
        Date.parse(`${shift.scheduledStartLocal}Z`)) /
        60_000,
    ),
  );
}

export function legacyClockMinutes(value: LocalTime): number {
  return minutesFromClock(value);
}
