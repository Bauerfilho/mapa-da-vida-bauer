import {
  calendarDayCount,
  type LocalDate,
  type MentorEntity,
} from "../domain";
import type {
  ClinicianReportDomain,
  ClinicianReportOptions,
} from "./exports";
import { isLaboratoryPanelEntity, formatLaboratoryReference, formatLaboratoryNumber } from "../domain/laboratory";
import { scaledReading } from "../domain/analytics";

type ReadState = "known" | "unknown" | "confirmed_absent" | "not_applicable" | "invalid";
type ReadResult = { state: ReadState; value?: unknown };

export const CLINICIAN_REPORT_PLAINTEXT_WARNING =
  "Privacidade do arquivo: este relatório é texto sem criptografia. Depois de Compartilhar ou Download, o destino escolhido pode armazenar ou sincronizar uma cópia.";

const DOMAIN_LABELS: Record<ClinicianReportDomain, string> = {
  medicamentos: "Medicamentos",
  sono: "Sono",
  alimentacao: "Alimentação",
  humor: "Humor e energia",
  cefaleia: "Cefaleia",
  bruxismo: "Bruxismo/ATM",
  exames: "Exames laboratoriais",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) =>
    isRecord(current) ? current[segment] : undefined, root);
}

function unwrap(value: unknown): ReadResult | null {
  if (value === undefined) return null;
  if (isRecord(value) && typeof value.state === "string") {
    if (value.state === "known") return { state: "known", value: value.value };
    if (["unknown", "confirmed_absent", "not_applicable", "invalid"].includes(value.state)) {
      return { state: value.state as ReadState };
    }
  }
  return { state: "known", value };
}

function read(root: unknown, paths: readonly string[]): ReadResult {
  for (const path of paths) {
    const result = unwrap(readPath(root, path));
    if (!result) continue;
    // Paths are ordered canonical -> legacy. Once a canonical field exists,
    // its explicit unknown/absence/invalid state is authoritative and a later
    // alias must never revive stale or private legacy content.
    return result;
  }
  return { state: "unknown" };
}

function knownString(root: unknown, paths: readonly string[]): string | null {
  const result = read(root, paths);
  return result.state === "known" && typeof result.value === "string" && result.value.trim()
    ? result.value.trim()
    : null;
}

function knownNumber(root: unknown, paths: readonly string[]): number | null {
  const result = read(root, paths);
  return result.state === "known" && typeof result.value === "number" && Number.isFinite(result.value)
    ? result.value
    : null;
}

function boundedNumber(
  root: unknown,
  paths: readonly string[],
  minimum: number,
  maximum: number,
): number | null {
  const value = knownNumber(root, paths);
  return value !== null && value >= minimum && value <= maximum ? value : null;
}

function boundedInteger(
  root: unknown,
  paths: readonly string[],
  minimum: number,
  maximum: number,
): number | null {
  const value = boundedNumber(root, paths, minimum, maximum);
  return value !== null && Number.isInteger(value) ? value : null;
}

function truth(root: unknown, paths: readonly string[]): boolean | null {
  const result = read(root, paths);
  if (result.state === "confirmed_absent") return false;
  return result.state === "known" && typeof result.value === "boolean" ? result.value : null;
}

function knownList(root: unknown, paths: readonly string[]): string[] | null {
  const result = read(root, paths);
  if (result.state !== "known" || !Array.isArray(result.value)) return null;
  const values = result.value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  return values.length ? values : [];
}

function eventKind(entity: MentorEntity): string {
  if (entity.type === "medicamentos.confirmation") return "medication-dose";
  const payload = entity.payload as Record<string, unknown>;
  return knownString(payload, ["eventKind"]) ?? entity.type;
}

function formatClock(value: string | null): string {
  return clockMinutes(value) !== null ? value!.slice(0, 5) : "não registrado";
}

function joinFacts(facts: Array<string | null>): string {
  return facts.filter((fact): fact is string => Boolean(fact)).join("; ");
}

function average(values: Array<number | null>): { value: number; n: number } | null {
  const usable = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!usable.length) return null;
  return { value: usable.reduce((sum, value) => sum + value, 0) / usable.length, n: usable.length };
}

function formatAverage(summary: { value: number; n: number } | null, suffix = ""): string {
  return summary ? `${summary.value.toFixed(1).replace(".", ",")}${suffix} (n=${summary.n})` : "não calculável";
}

function clockMinutes(value: string | null): number | null {
  if (!value || !/^\d{2}:\d{2}/.test(value)) return null;
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

function forwardClockDuration(start: string | null, end: string | null, maximum: number): number | null {
  const startMinutes = clockMinutes(start);
  const endMinutes = clockMinutes(end);
  if (startMinutes === null || endMinutes === null) return null;
  const duration = (endMinutes - startMinutes + 1_440) % 1_440;
  return duration <= maximum ? duration : null;
}

function coverageLines(
  entities: readonly MentorEntity[],
  start: LocalDate,
  end: LocalDate,
): string[] {
  const windowDays = calendarDayCount(start, end);
  const days = new Set(entities.map(({ localDate }) => localDate)).size;
  return [
    `Cobertura: n=${entities.length} registro(s); ${days}/${windowDays} dia(s) com registro; ${windowDays - days} dia(s) sem registro.`,
  ];
}

function sleepSection(entities: readonly MentorEntity[], start: LocalDate, end: LocalDate): string[] {
  const facts = entities.map((entity) => {
    const payload = entity.payload;
    const bed = knownString(payload, ["chronology.wentToBedLocal", "wentToBedLocal", "bedTime"]);
    const onset = knownString(payload, ["chronology.sleepOnsetLocal", "sleepOnsetLocal", "sleepOnset"]);
    const wake = knownString(payload, ["chronology.finalWakeLocal", "finalWakeLocal", "wakeTime"]);
    const left = knownString(payload, ["chronology.leftBedLocal", "leftBedLocal"]);
    const awake = boundedInteger(payload, ["awakeMinutes", "wakeAfterSleepOnsetMinutes"], 0, 1_200);
    const period = forwardClockDuration(onset, wake, 1_200);
    const total = period !== null && awake !== null && awake <= period
      ? period - awake
      : boundedInteger(payload, ["durationMinutes", "sleepMinutes"], 0, 1_200);
    const timeInBed = forwardClockDuration(bed, left, 1_200);
    const latency = forwardClockDuration(bed, onset, 720);
    return { entity, payload, bed, onset, wake, left, awake, period, total, timeInBed, latency };
  });
  const efficiency = facts.map(({ total, timeInBed }) =>
    total !== null && timeInBed !== null && timeInBed > 0 && total <= timeInBed
      ? total / timeInBed * 100
      : null);
  const quality = facts.map(({ payload }) => boundedNumber(payload, ["perceivedQuality", "quality", "sleep.quality"], 1, 5));
  const restorative = facts.map(({ payload }) => truth(payload, ["restorative", "restorativeSleep"])).filter((value): value is boolean => value !== null);
  const summary = [
    `Resumo descritivo: sono total estimado médio ${formatAverage(average(facts.map(({ total }) => total)), " min")}; latência média ${formatAverage(average(facts.map(({ latency }) => latency)), " min")}; eficiência média ${formatAverage(average(efficiency), "%")}.`,
    `Qualidade percebida média ${formatAverage(average(quality), "/5")}; restaurador confirmado em ${restorative.filter(Boolean).length}/${restorative.length || 0} registro(s) respondido(s).`,
    "Legenda: qualidade percebida 1=muito ruim e 5=excelente. Eficiência usa apenas registros completos: sono total estimado ÷ tempo no leito.",
    "Cronologia factual:",
  ];
  const timeline = facts.map(({ entity, payload, bed, onset, wake, left, total }) => {
    const awakenings = boundedInteger(payload, ["awakenings"], 0, 100);
    const awakeMinutes = boundedInteger(payload, ["awakeMinutes"], 0, 1_200);
    const napMinutes = boundedInteger(payload, ["napMinutes"], 0, 1_200);
    const perceivedQuality = boundedNumber(payload, ["perceivedQuality", "quality"], 1, 5);
    return `${entity.localDate} — ${joinFacts([
    `cama ${formatClock(bed)}`,
    `início estimado ${formatClock(onset)}`,
    `despertar final ${formatClock(wake)}`,
    `saída da cama ${formatClock(left)}`,
    total !== null ? `sono total estimado ${total} min` : "sono total não calculável",
    awakenings !== null ? `${awakenings} despertar(es)` : null,
    awakeMinutes !== null ? `${awakeMinutes} min acordado` : null,
    napMinutes !== null ? `cochilo ${napMinutes} min` : null,
    perceivedQuality !== null ? `qualidade ${perceivedQuality}/5` : null,
    truth(payload, ["restorative"]) !== null ? `restaurador ${truth(payload, ["restorative"]) ? "sim" : "não (confirmado)"}` : null,
  ])}`;
  });
  return [...coverageLines(entities, start, end), ...summary, ...(timeline.length ? timeline : ["Sem cronologia registrada neste período."])];
}

function nutritionSection(entities: readonly MentorEntity[], start: LocalDate, end: LocalDate): string[] {
  const mealKinds = new Map<string, number>();
  for (const entity of entities) {
    const kind = knownString(entity.payload, ["meal.kind", "mealKind", "mealType"]);
    if (kind) mealKinds.set(kind, (mealKinds.get(kind) ?? 0) + 1);
  }
  const hunger = entities.map(({ payload }) => boundedNumber(payload, ["hungerBefore", "hunger"], 0, 5));
  const fullness = entities.map(({ payload }) => boundedNumber(payload, ["fullnessAfter", "fullness", "satiety"], 0, 5));
  const water = entities.map(({ payload }) => boundedNumber(payload, ["waterMl", "hydrationMl"], 0, 20_000));
  const caffeine = entities.map(({ payload }) => boundedNumber(payload, ["caffeine.servings", "caffeineServings"], 0, 100));
  const distribution = [...mealKinds.entries()].map(([kind, count]) => `${kind}: ${count}`).join("; ") || "tipos não registrados";
  const timeline = entities.map((entity) => {
    const payload = entity.payload;
    const waterMl = boundedNumber(payload, ["waterMl", "hydrationMl"], 0, 20_000);
    const caffeineServings = boundedNumber(payload, ["caffeine.servings", "caffeineServings"], 0, 100);
    const hungerBefore = boundedNumber(payload, ["hungerBefore", "hunger"], 0, 5);
    const fullnessAfter = boundedNumber(payload, ["fullnessAfter", "fullness", "satiety"], 0, 5);
    return `${entity.localDate} — ${joinFacts([
      knownString(payload, ["meal.kind", "mealKind", "mealType"]) ?? "refeição sem tipo registrado",
      `horário ${formatClock(knownString(payload, ["meal.timeLocal", "mealTimeLocal", "timeLocal"]))}`,
      knownString(payload, ["meal.composition", "composition"]) ? `composição: ${knownString(payload, ["meal.composition", "composition"])}` : null,
      knownString(payload, ["meal.context", "context"]) ? `contexto: ${knownString(payload, ["meal.context", "context"])}` : null,
      waterMl !== null ? `água informada ${waterMl} mL` : null,
      caffeineServings !== null ? `cafeína ${caffeineServings} porção(ões)` : null,
      knownString(payload, ["caffeine.lastUseLocal"]) ? `último uso ${formatClock(knownString(payload, ["caffeine.lastUseLocal"]))}` : null,
      hungerBefore !== null ? `fome ${hungerBefore}/5` : null,
      fullnessAfter !== null ? `saciedade ${fullnessAfter}/5` : null,
    ])}`;
  });
  return [
    ...coverageLines(entities, start, end),
    `Resumo descritivo: tipos registrados — ${distribution}.`,
    `Fome média ${formatAverage(average(hunger), "/5")}; saciedade média ${formatAverage(average(fullness), "/5")}; água informada por registro ${formatAverage(average(water), " mL")}; cafeína informada por registro ${formatAverage(average(caffeine), " porção(ões)")}.`,
    "Legenda: fome e saciedade usam escala autorreferida 0–5. Volumes e porções são reproduzidos como informados e não representam prescrição ou meta.",
    "Cronologia factual:",
    ...(timeline.length ? timeline : ["Sem alimentação registrada neste período."]),
  ];
}

const MOOD_FIELDS = [
  ["mood", "Humor", "-2 a +2", -2, 2],
  ["energy", "Energia funcional", "0 a 4", 0, 4],
  ["anxiety", "Ansiedade", "0 a 4", 0, 4],
  ["irritability", "Irritabilidade", "0 a 4", 0, 4],
  ["impulsivity", "Impulsividade", "0 a 4", 0, 4],
  ["thoughtSpeed", "Velocidade do pensamento", "-2 a +2", -2, 2],
  ["function", "Funcionamento", "0 a 4", 0, 4],
] as const;

const SLEEP_NEED_LABELS: Record<string, string> = {
  less_than_usual: "menor que o habitual",
  usual: "parecida com o habitual",
  more_than_usual: "maior que o habitual",
};

const BASELINE_CHANGE_LABELS: Record<string, string> = {
  below_usual: "abaixo do habitual",
  usual: "sem mudança percebida",
  above_usual: "acima do habitual",
  different_unclear: "mudou de outro modo",
};

type MoodScaleFamily = "quick" | "functional" | "legacy" | "unclassified";
type MoodField = (typeof MOOD_FIELDS)[number][0];

/** O tipo canônico tem precedência; um metadado contraditório não duplica a família. */
function moodScaleFamily(entity: MentorEntity): MoodScaleFamily {
  if (entity.type === "humor.energy-check-in") return "quick";
  switch (eventKind(entity)) {
    case "energy-check-in": return "quick";
    case "mood-functional-check-in": return "functional";
    case "mood-check-in": return "legacy";
    default: return "unclassified";
  }
}

function moodScaleReading(entity: MentorEntity, field: MoodField): ReturnType<typeof scaledReading> {
  const family = moodScaleFamily(entity);
  if (family === "quick" && field === "energy") {
    const result = scaledReading(entity, [field], 1, 5);
    // A energia rápida canônica usa os cinco inteiros definidos pelo próprio registro.
    return entity.type === "humor.energy-check-in" && result.state === "known" && !Number.isInteger(result.value)
      ? { state: "invalid" } : result;
  }
  if (family === "legacy" && field === "mood") return scaledReading(entity, [field], 1, 5);
  if (family === "functional") {
    const descriptor = MOOD_FIELDS.find(([key]) => key === field)!;
    return scaledReading(entity, [field], descriptor[3], descriptor[4]);
  }
  // scaledReading não classifica kinds desconhecidos: este filtro precede toda média.
  return { state: "unknown" };
}

function moodScaleNumbers(entities: readonly MentorEntity[], field: MoodField): Array<number | null> {
  return entities.map((entity) => {
    const reading = moodScaleReading(entity, field);
    return reading.state === "known" ? reading.value ?? null : null;
  });
}

function moodScaleFacts(entity: MentorEntity): Array<string | null> {
  const family = moodScaleFamily(entity);
  const fields: ReadonlyArray<readonly [MoodField, string]> = family === "quick"
    ? [["energy", "Energia rápida"]]
    : family === "legacy" ? [["mood", "Humor legado"]]
      : MOOD_FIELDS.map(([key, label]) => [key, family === "unclassified" && key === "energy" ? "Energia" : label] as const);
  return fields.map(([key, label]) => {
    const raw = knownNumber(entity.payload, [key]);
    if (raw === null) return null;
    const reading = moodScaleReading(entity, key);
    if (reading.state !== "known") {
      return `${label.toLocaleLowerCase("pt-BR")} ${raw} (valor bruto; escala não confirmada ou valor incompatível, fora das médias)`;
    }
    const signed = family === "functional" && (key === "mood" || key === "thoughtSpeed");
    const value = `${signed && raw > 0 ? "+" : ""}${raw}`;
    const suffix = family === "quick" || family === "legacy" ? "/5"
      : signed ? " (-2 a +2)" : "/4";
    return `${label.toLocaleLowerCase("pt-BR")} ${value}${suffix}`;
  });
}

function knownEnumLabel(
  root: unknown,
  paths: readonly string[],
  labels: Readonly<Record<string, string>>,
): string | null {
  const value = knownString(root, paths);
  return value && Object.hasOwn(labels, value) ? labels[value] : null;
}

function moodSection(entities: readonly MentorEntity[], start: LocalDate, end: LocalDate): string[] {
  const functionalEntities = entities.filter((entity) =>
    moodScaleFamily(entity) === "functional"
  );
  const quickEntities = entities.filter((entity) => moodScaleFamily(entity) === "quick");
  const legacyEntities = entities.filter((entity) => moodScaleFamily(entity) === "legacy");
  const summaries = MOOD_FIELDS.map(([key, label, scale]) =>
    `${label}: ${formatAverage(average(moodScaleNumbers(functionalEntities, key)), ` (${scale})`)}`);
  const contextualCoverage = {
    sleepNeed: functionalEntities.filter(({ payload }) =>
      knownEnumLabel(payload, ["perceivedSleepNeed"], SLEEP_NEED_LABELS)).length,
    baseline: functionalEntities.filter(({ payload }) =>
      knownEnumLabel(payload, ["perceivedBaselineChange"], BASELINE_CHANGE_LABELS)).length,
    protective: functionalEntities.filter(({ payload }) =>
      (knownList(payload, ["protectiveFactors"])?.length ?? 0) > 0 ||
        Boolean(knownString(payload, ["protectiveFactorsNote"]))).length,
    medicationChange: functionalEntities.filter(({ payload }) =>
      truth(payload, ["medicationChangeConfirmed"]) !== null).length,
    safeNow: functionalEntities.filter(({ payload }) =>
      truth(payload, ["safeNow"]) !== null).length,
  };
  const timeline = entities.map((entity) => `${entity.localDate} — ${joinFacts([
    ...moodScaleFacts(entity),
    knownEnumLabel(entity.payload, ["perceivedSleepNeed"], SLEEP_NEED_LABELS)
      ? `necessidade percebida de sono ${knownEnumLabel(entity.payload, ["perceivedSleepNeed"], SLEEP_NEED_LABELS)}`
      : null,
    knownEnumLabel(entity.payload, ["perceivedBaselineChange"], BASELINE_CHANGE_LABELS)
      ? `mudança percebida do basal: ${knownEnumLabel(entity.payload, ["perceivedBaselineChange"], BASELINE_CHANGE_LABELS)}`
      : null,
    (knownList(entity.payload, ["protectiveFactors"])?.length ?? 0) > 0
      ? `apoios percebidos: ${knownList(entity.payload, ["protectiveFactors"])!.join(", ")}`
      : null,
    knownString(entity.payload, ["protectiveFactorsNote"])
      ? `outro apoio informado: ${knownString(entity.payload, ["protectiveFactorsNote"])}`
      : null,
    truth(entity.payload, ["medicationChangeConfirmed"]) === true
      ? `mudança medicamentosa confirmada pelo usuário${knownString(entity.payload, ["medicationChangeNote"]) ? `: ${knownString(entity.payload, ["medicationChangeNote"])}` : " (sem detalhe registrado)"}`
      : truth(entity.payload, ["medicationChangeConfirmed"]) === false
        ? "nenhuma mudança medicamentosa informada (resposta do usuário)"
        : null,
    truth(entity.payload, ["safeNow"]) !== null
      ? `segurança no momento do registro: ${truth(entity.payload, ["safeNow"]) ? "sim" : "não"} (resposta do usuário)`
      : null,
    knownString(entity.payload, ["context", "note"]) ? `contexto: ${knownString(entity.payload, ["context", "note"])}` : null,
  ]) || "sem valor numérico ou contexto confirmado; confira o registro original"}`);
  return [
    ...coverageLines(entities, start, end),
    `Check-in rápido — Energia rápida: ${formatAverage(average(moodScaleNumbers(quickEntities, "energy")), " (1 a 5)")}.`,
    `Matriz funcional — médias por registro com escala confirmada: ${summaries.join("; ")}.`,
    `Humor legado: ${formatAverage(average(moodScaleNumbers(legacyEntities, "mood")), " (1 a 5)")}.`,
    "As famílias e escalas permanecem separadas, sem conversão. Versão ausente ou incompatível não entra nas médias; valores numéricos brutos continuam identificados na cronologia. n conta registros válidos, não dias.",
    `Cobertura contextual nos ${functionalEntities.length} check-in(s) funcional(is): necessidade percebida de sono ${contextualCoverage.sleepNeed}/${functionalEntities.length}; mudança percebida do basal ${contextualCoverage.baseline}/${functionalEntities.length}; apoios percebidos ${contextualCoverage.protective}/${functionalEntities.length}; mudança medicamentosa ${contextualCoverage.medicationChange}/${functionalEntities.length}; segurança no momento ${contextualCoverage.safeNow}/${functionalEntities.length}. Campos sem resposta permanecem desconhecidos.`,
    "Legenda da matriz funcional: humor -2=muito baixo, 0=centro da escala e +2=muito elevado; velocidade do pensamento -2=mais lenta e +2=mais acelerada; energia, ansiedade, irritabilidade, impulsividade e funcionamento usam 0–4 conforme a percepção do usuário. Check-in rápido de energia e humor legado identificado usam 1–5, cada um em sua família.",
    "As escalas descrevem o momento registrado; não classificam depressão, mania, hipomania ou outro diagnóstico.",
    "Mudanças medicamentosas e segurança no momento são transcrições da resposta do usuário. Responder ‘sim’ à pergunta de segurança não prova ausência de risco, e responder ‘não’ não constitui diagnóstico. O relatório não recomenda conduta, não calcula risco, não monitora continuamente e não envia alertas.",
    "Cronologia factual:",
    ...(timeline.length ? timeline : ["Sem check-ins de humor registrados neste período."]),
  ];
}

function headacheSection(entities: readonly MentorEntity[], start: LocalDate, end: LocalDate): string[] {
  const presence = entities.map(({ payload }) => truth(payload, ["presence", "headachePresent"]));
  const present = presence.filter((value) => value === true).length;
  const absent = presence.filter((value) => value === false).length;
  const peak = entities.map(({ payload }) => boundedNumber(payload, ["intensityPeak", "peakIntensity", "intensity"], 0, 10));
  const response = entities.map(({ payload }) => boundedNumber(payload, ["response", "rescueResponse"], 0, 4));
  const triggers = new Map<string, number>();
  for (const entity of entities) {
    for (const trigger of knownList(entity.payload, ["suspectedTriggers", "triggers"]) ?? []) {
      triggers.set(trigger, (triggers.get(trigger) ?? 0) + 1);
    }
  }
  const timeline = entities.map((entity) => {
    const payload = entity.payload;
    const recordedPresence = truth(payload, ["presence", "headachePresent"]);
    if (recordedPresence === false) return `${entity.localDate} — ausência de cefaleia confirmada pelo usuário.`;
    const currentIntensity = boundedNumber(payload, ["intensityCurrent", "intensity"], 0, 10);
    const peakIntensity = boundedNumber(payload, ["intensityPeak", "peakIntensity"], 0, 10);
    const rescueResponse = boundedNumber(payload, ["response", "rescueResponse"], 0, 4);
    return `${entity.localDate} — ${joinFacts([
      recordedPresence === true ? "cefaleia confirmada" : "presença não registrada",
      knownString(payload, ["onsetLocal", "startTime"]) ? `início ${formatClock(knownString(payload, ["onsetLocal", "startTime"]))}` : null,
      knownString(payload, ["endedLocal", "endTime"]) ? `fim ${formatClock(knownString(payload, ["endedLocal", "endTime"]))}` : null,
      currentIntensity !== null ? `intensidade ${currentIntensity}/10` : null,
      peakIntensity !== null ? `pico ${peakIntensity}/10` : null,
      knownList(payload, ["locations"])?.length ? `local: ${knownList(payload, ["locations"])!.join(", ")}` : null,
      knownList(payload, ["qualities"])?.length ? `qualidade: ${knownList(payload, ["qualities"])!.join(", ")}` : null,
      knownList(payload, ["associatedSymptoms", "symptoms"])?.length ? `associados: ${knownList(payload, ["associatedSymptoms", "symptoms"])!.join(", ")}` : null,
      knownList(payload, ["suspectedTriggers", "triggers"])?.length ? `gatilhos suspeitos anotados: ${knownList(payload, ["suspectedTriggers", "triggers"])!.join(", ")}` : null,
      knownString(payload, ["rescueUsed", "rescue"]) ? `medida usada: ${knownString(payload, ["rescueUsed", "rescue"])}` : null,
      rescueResponse !== null ? `resposta ${rescueResponse}/4` : null,
    ])}`;
  });
  const triggerSummary = [...triggers.entries()].map(([item, count]) => `${item} (${count})`).join(", ") || "nenhum anotado";
  return [
    ...coverageLines(entities, start, end),
    `Resumo descritivo: cefaleia confirmada em ${present} registro(s); ausência confirmada em ${absent}; presença desconhecida em ${presence.length - present - absent}. Pico médio ${formatAverage(average(peak), "/10")}; resposta percebida média ${formatAverage(average(response), "/4")}.`,
    `Gatilhos suspeitos anotados pelo usuário: ${triggerSummary}. Esta lista não estabelece causalidade.`,
    "Legenda: intensidade 0–10; resposta percebida à medida usada 0=nenhuma e 4=completa. Ausência só aparece quando foi explicitamente confirmada.",
    "Cronologia factual:",
    ...(timeline.length ? timeline : ["Sem registros de cefaleia neste período."]),
  ];
}

const BRUX_FIELDS = [
  ["jawPain", "dor mandibular"],
  ["templePain", "dor temporal"],
  ["stiffness", "rigidez/cansaço"],
  ["dentalSensitivity", "sensibilidade dentária"],
] as const;

function bruxismSection(entities: readonly MentorEntity[], start: LocalDate, end: LocalDate): string[] {
  const periodSummary = (period: "morning" | "evening") => BRUX_FIELDS.map(([key, label]) => {
    const paths = period === "morning" && key === "jawPain"
      ? [`${period}.${key}`, "jawPainIntensity"]
      : [`${period}.${key}`];
    return `${label} ${formatAverage(average(entities.map(({ payload }) => boundedNumber(payload, paths, 0, 4))), "/4")}`;
  }).join("; ");
  const guard = entities.map(({ payload }) => truth(payload, ["guardUsed", "splintUsed"])).filter((value): value is boolean => value !== null);
  const clenching = entities.map(({ payload }) => truth(payload, ["daytimeClenching", "clenching"])).filter((value): value is boolean => value !== null);
  const timeline = entities.map((entity) => `${entity.localDate} — ${joinFacts([
    ...BRUX_FIELDS.map(([key, label]) => {
      const morning = boundedNumber(entity.payload, [`morning.${key}`, key === "jawPain" ? "jawPainIntensity" : key], 0, 4);
      const evening = boundedNumber(entity.payload, [`evening.${key}`], 0, 4);
      return morning !== null || evening !== null ? `${label} manhã ${morning ?? "n/r"}/4, noite ${evening ?? "n/r"}/4` : null;
    }),
    truth(entity.payload, ["daytimeClenching"]) !== null ? `aperto diurno ${truth(entity.payload, ["daytimeClenching"]) ? "sim" : "não (confirmado)"}` : null,
    truth(entity.payload, ["grindingReported"]) !== null ? `ranger relatado ${truth(entity.payload, ["grindingReported"]) ? "sim" : "não (confirmado)"}` : null,
    truth(entity.payload, ["guardUsed", "splintUsed"]) !== null ? `placa usada ${truth(entity.payload, ["guardUsed", "splintUsed"]) ? "sim" : "não (confirmado)"}` : null,
    knownString(entity.payload, ["note"]) ? `contexto: ${knownString(entity.payload, ["note"])}` : null,
  ])}`);
  return [
    ...coverageLines(entities, start, end),
    `Resumo descritivo — ao acordar: ${periodSummary("morning")}.`,
    `Resumo descritivo — fim do dia: ${periodSummary("evening")}.`,
    `Uso de placa confirmado em ${guard.filter(Boolean).length}/${guard.length || 0} registro(s) respondido(s); aperto diurno confirmado em ${clenching.filter(Boolean).length}/${clenching.length || 0}.`,
    "Legenda: sintomas usam escala autorreferida 0–4; valores maiores indicam maior intensidade percebida. Uso de placa é apenas um fato informado, não uma medida de adesão.",
    "Cronologia factual:",
    ...(timeline.length ? timeline : ["Sem registros de bruxismo/ATM neste período."]),
  ];
}

function medicationStatus(value: string | null): string {
  const labels: Record<string, string> = {
    active_confirmed: "ativo, confirmado pelo usuário",
    paused_confirmed: "pausado, confirmado pelo usuário",
    finished_confirmed: "encerrado, confirmado pelo usuário",
    active: "ativo, informado pelo usuário",
    paused: "pausado, informado pelo usuário",
    finished: "encerrado, informado pelo usuário",
  };
  return value ? labels[value] ?? "status não reconhecido (valor omitido)" : "status não registrado";
}

function doseState(value: string | null): string {
  const labels: Record<string, string> = {
    taken_time_recorded: "tomada com horário real registrado",
    taken_time_unknown: "tomada confirmada, horário real não registrado",
    taken_on_time: "tomada no horário, conforme registro legado",
    taken_late: "tomada após o horário, conforme registro legado",
    skipped_confirmed: "dose pulada confirmada pelo usuário",
  };
  return value ? labels[value] ?? "estado não reconhecido (valor omitido)" : "estado não registrado";
}

function regimenLines(
  selected: readonly MentorEntity[],
): string[] {
  // Least privilege: only records selected by the same date/domain filter as
  // the preview are rendered. A regimen that started outside the chosen
  // window is not silently pulled into the plaintext report.
  const candidates = selected.filter((entity) => eventKind(entity) === "medication-regimen");
  const consolidated = new Map<string, string>();
  for (const entity of candidates) {
    const payload = entity.payload;
    const name = knownString(payload, ["medicationName", "name"]) ?? "nome não registrado";
    const dose = knownString(payload, ["doseLabel", "dose"]) ?? "dose não registrada";
    const scheduleList = read(payload, ["scheduledTimesLocal"]);
    const schedule = scheduleList.state === "known" && Array.isArray(scheduleList.value)
      ? scheduleList.value.join(", ")
      : knownString(payload, ["schedule"]) ?? "horários não registrados";
    const status = medicationStatus(knownString(payload, ["status", "regimenStatus"]));
    const from = knownString(payload, ["activeFromLocalDate"]) ?? entity.localDate;
    const through = knownString(payload, ["activeThroughLocalDate"]);
    const key = `${name.toLocaleLowerCase("pt-BR")}|${dose.toLocaleLowerCase("pt-BR")}|${schedule.toLocaleLowerCase("pt-BR")}`;
    consolidated.set(key, `${name} — dose transcrita: ${dose}; horários informados: ${schedule}; vigência informada: ${from} a ${through ?? "fim não registrado"}; ${status}.`);
  }
  return [...consolidated.values()];
}

function medicationSection(
  entities: readonly MentorEntity[],
  start: LocalDate,
  end: LocalDate,
): string[] {
  const regimens = regimenLines(entities);
  const doseEntities = entities.filter((entity) => eventKind(entity) === "medication-dose");
  const doseCounts = new Map<string, number>();
  for (const entity of doseEntities) {
    const status = knownString(entity.payload, ["confirmation", "status"]);
    const label = doseState(status);
    doseCounts.set(label, (doseCounts.get(label) ?? 0) + 1);
  }
  const timeline = entities
    .filter((entity) => eventKind(entity) !== "medication-regimen")
    .map((entity) => {
      const payload = entity.payload;
      const kind = eventKind(entity);
      const name = knownString(payload, ["medicationName", "name"]) ?? "medicamento sem nome registrado";
      if (kind === "medication-dose") return `${entity.localDate} — ${joinFacts([
        name,
        knownString(payload, ["doseLabel", "dose"]) ? `dose transcrita ${knownString(payload, ["doseLabel", "dose"])}` : null,
        knownString(payload, ["scheduledTimeLocal"]) ? `previsto ${formatClock(knownString(payload, ["scheduledTimeLocal"]))}` : null,
        knownString(payload, ["actualTimeLocal"]) ? `real ${formatClock(knownString(payload, ["actualTimeLocal"]))}` : null,
        doseState(knownString(payload, ["confirmation", "status"])),
      ])}.`;
      if (kind === "medication-stock") return `${entity.localDate} — ${joinFacts([
        `estoque de ${name}`,
        boundedNumber(payload, ["stock.quantity", "quantity"], 0, 1_000_000_000) !== null ? `quantidade ${boundedNumber(payload, ["stock.quantity", "quantity"], 0, 1_000_000_000)}` : "quantidade não registrada",
        knownString(payload, ["stock.unit", "unit"]) ? `unidade ${knownString(payload, ["stock.unit", "unit"])}` : null,
        boundedNumber(payload, ["stock.refillAt", "refillAt"], 0, 1_000_000_000) !== null ? `reposição sinalizada em ${boundedNumber(payload, ["stock.refillAt", "refillAt"], 0, 1_000_000_000)}` : null,
      ])}.`;
      if (kind === "medication-sos") return `${entity.localDate} — ${joinFacts([
        `uso SOS informado: ${name}`,
        knownString(payload, ["doseLabel", "dose"]) ? `dose transcrita ${knownString(payload, ["doseLabel", "dose"])}` : null,
        knownString(payload, ["sos.reason", "reason"]) ? `motivo informado ${knownString(payload, ["sos.reason", "reason"])}` : null,
        knownString(payload, ["sos.takenAtLocal", "takenAtLocal"]) ? `horário ${formatClock(knownString(payload, ["sos.takenAtLocal", "takenAtLocal"]))}` : null,
        boundedNumber(payload, ["sos.response", "response"], 0, 4) !== null ? `resposta percebida ${boundedNumber(payload, ["sos.response", "response"], 0, 4)}/4` : null,
      ])}.`;
      return `${entity.localDate} — registro de medicamento sem categoria legível.`;
    });
  const doseSummary = [...doseCounts.entries()].map(([label, count]) => `${label}: ${count}`).join("; ") || "nenhuma confirmação de dose no período";
  return [
    ...coverageLines(entities, start, end),
    "Regimes consolidados (transcrição do que foi informado; não é prescrição):",
    ...(regimens.length ? regimens : ["Nenhum regime com vigência sobreposta foi encontrado."]),
    "Minimização: esquemas datados fora da janela escolhida não foram incorporados automaticamente ao arquivo.",
    `Resumo das confirmações no período: ${doseSummary}.`,
    "Legenda: horário previsto e horário real permanecem fatos separados. “Não registrado” não significa dose omitida; “dose pulada” só aparece quando foi explicitamente confirmada.",
    "Cronologia factual:",
    ...(timeline.length ? timeline : ["Sem confirmações de dose, estoque ou uso SOS neste período."]),
  ];
}

function laboratorySection(entities: readonly MentorEntity[]): string[] {
  const panels = entities.filter(isLaboratoryPanelEntity);
  if (!panels.length) return ["Sem coletas laboratoriais registradas no período."];
  const lines = ["Resultados transcritos do laudo. Referências dependem do método e do contexto clínico; nenhuma interpretação automática."];
  const symbols = { eq: "", lt: "< ", le: "≤ ", gt: "> ", ge: "≥ " };
  for (const { payload } of panels) {
    lines.push(`Coleta ${payload.collectedOn} — ${payload.title.state === "known" ? payload.title.value : "Painel"}`);
    for (const result of payload.results) {
      const recorded = result.value.state === "known" ? result.value.value : null;
      const value = recorded?.kind === "numeric" ? `${symbols[recorded.comparator]}${formatLaboratoryNumber(recorded.value)}` : recorded?.kind === "text" ? recorded.value : "não informado";
      const unit = result.unit.state === "known" ? result.unit.value : "unidade não informada";
      const reference = formatLaboratoryReference(result);
      lines.push(`  ${result.analyte}: ${value} ${unit}. Referência transcrita: ${reference}.`);
    }
    if (payload.note.state === "known") lines.push(`  Observação informada: ${payload.note.value}`);
    lines.push(`  Documentos originais guardados: ${payload.attachments.length}. Os arquivos não são incorporados a este relatório textual.`);
  }
  return lines;
}

export function renderClinicianReviewText(
  selectedEntities: readonly MentorEntity[],
  options: ClinicianReportOptions,
): string {
  const start = options.startLocalDate;
  const end = options.endLocalDate;
  const days = new Set(selectedEntities.map(({ localDate }) => localDate)).size;
  const lines = [
    options.title?.trim() || "Resumo pessoal para revisão com profissional de saúde",
    "Bauer Vieira",
    `Período: ${start} a ${end}`,
    `Cobertura geral: n=${selectedEntities.length} registro(s) em ${days} dia(s) com algum dado.`,
    "Como ler: n é a quantidade de registros ou valores completos indicada em cada cálculo. Dia sem registro permanece desconhecido.",
    "Este documento organiza fatos informados pelo usuário. Não estabelece diagnóstico, causalidade, prescrição, recomendação de dose ou conduta.",
    "Ausência de registro não significa ausência de sintoma ou não adesão. Ausência só é descrita quando foi explicitamente confirmada.",
    CLINICIAN_REPORT_PLAINTEXT_WARNING,
    "",
  ];
  for (const domain of options.domains) {
    const domainEntities = selectedEntities
      .filter((entity) => entity.domain === domain)
      .sort((left, right) => left.localDate === right.localDate
        ? left.occurredAtUTC.localeCompare(right.occurredAtUTC)
        : left.localDate.localeCompare(right.localDate));
    lines.push(DOMAIN_LABELS[domain].toUpperCase());
    const section = domain === "sono" ? sleepSection(domainEntities, start, end)
      : domain === "alimentacao" ? nutritionSection(domainEntities, start, end)
      : domain === "humor" ? moodSection(domainEntities, start, end)
      : domain === "cefaleia" ? headacheSection(domainEntities, start, end)
      : domain === "bruxismo" ? bruxismSection(domainEntities, start, end)
      : domain === "exames" ? laboratorySection(domainEntities)
      : medicationSection(domainEntities, start, end);
    lines.push(...section, "");
  }
  lines.push("Antes de compartilhar: confira datas, transcrições, escalas e registros incompletos com o profissional.");
  return lines.join("\n");
}
