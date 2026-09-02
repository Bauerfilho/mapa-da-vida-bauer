import { inclusiveDateWindow } from "./dates";
import type {
  EnergyMetricSummary,
  LocalDate,
  MentorEntity,
} from "./model";

/**
 * Summarizes only recorded values. Missing calendar days remain missing and are
 * never converted into a zero-energy observation.
 */
export function summarizeEnergy(
  entities: Array<MentorEntity<"humor.energy-check-in">>,
  endLocalDate: LocalDate,
  days = 60,
): EnergyMetricSummary {
  const window = inclusiveDateWindow(endLocalDate, days);
  const latestByDay = new Map<LocalDate, MentorEntity<"humor.energy-check-in">>();

  for (const entity of entities) {
    if (
      entity.status !== "active" ||
      entity.localDate < window.start ||
      entity.localDate > window.end
    ) {
      continue;
    }
    const previous = latestByDay.get(entity.localDate);
    if (!previous || previous.occurredAtUTC < entity.occurredAtUTC) {
      latestByDay.set(entity.localDate, entity);
    }
  }

  const values = [...latestByDay.values()]
    .map((entity) => ({
      localDate: entity.localDate,
      value: entity.payload.energy,
    }))
    .sort((left, right) => left.localDate.localeCompare(right.localDate));
  const observationCount = values.length;
  const average = observationCount
    ? values.reduce((sum, item) => sum + item.value, 0) / observationCount
    : null;

  return {
    window,
    observationCount,
    missingDays: Math.max(0, days - observationCount),
    average,
    state:
      observationCount >= 30
        ? "preferred"
        : observationCount >= 14
          ? "emerging"
          : "insufficient",
    values,
  };
}

