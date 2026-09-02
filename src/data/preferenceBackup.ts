/**
 * Backup contract for the only user-editable preference record in v1.
 *
 * This validator is intentionally independent from the UI normalizer: restore
 * must preserve the exact confirmed values from a backup and must never turn a
 * malformed or incomplete record into plausible-looking defaults.
 */
export const PREFERENCES_BACKUP_SETTING_KEY = "mentor.preferences.v1" as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isNullableMinute(value: unknown, minimum: number): boolean {
  return value === null || (
    Number.isInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= 1_440
  );
}

function orderedNullableValues(
  first: unknown,
  second: unknown,
): boolean {
  return first === null || second === null || Number(first) <= Number(second);
}

/** @internal Pure schema guard used by encrypted-backup validation and tests. */
export function isMentorPreferencesBackupValue(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ["schema", "studyGoals", "sleepGoal", "accessibility"]) ||
    value.schema !== "mentor-preferences-v1" ||
    !isRecord(value.studyGoals) ||
    !isRecord(value.sleepGoal) ||
    !isRecord(value.accessibility)
  ) {
    return false;
  }

  const study = value.studyGoals;
  const sleep = value.sleepGoal;
  const accessibility = value.accessibility;
  if (
    !hasExactlyKeys(study, ["baseMinutes", "goodMinutes", "goldMinutes"]) ||
    !hasExactlyKeys(sleep, ["targetMinutes", "minimumMinutes", "maximumMinutes"]) ||
    !hasExactlyKeys(accessibility, ["largerText", "reducedMotion", "highContrast"]) ||
    !isNullableMinute(study.baseMinutes, 1) ||
    !isNullableMinute(study.goodMinutes, 1) ||
    !isNullableMinute(study.goldMinutes, 1) ||
    !isNullableMinute(sleep.targetMinutes, 60) ||
    !isNullableMinute(sleep.minimumMinutes, 60) ||
    !isNullableMinute(sleep.maximumMinutes, 60) ||
    typeof accessibility.largerText !== "boolean" ||
    typeof accessibility.reducedMotion !== "boolean" ||
    typeof accessibility.highContrast !== "boolean"
  ) {
    return false;
  }

  return (
    orderedNullableValues(study.baseMinutes, study.goodMinutes) &&
    orderedNullableValues(study.goodMinutes, study.goldMinutes) &&
    orderedNullableValues(study.baseMinutes, study.goldMinutes) &&
    orderedNullableValues(sleep.minimumMinutes, sleep.maximumMinutes) &&
    (sleep.targetMinutes === null || sleep.minimumMinutes === null ||
      Number(sleep.targetMinutes) >= Number(sleep.minimumMinutes)) &&
    (sleep.targetMinutes === null || sleep.maximumMinutes === null ||
      Number(sleep.targetMinutes) <= Number(sleep.maximumMinutes))
  );
}

/**
 * Other settings keep their existing format-specific validation. The canonical
 * preference key receives a strict contract because its values directly alter
 * study targets, sleep references and accessibility.
 */
export function isSupportedBackupSettingValue(key: string, value: unknown): boolean {
  return key !== PREFERENCES_BACKUP_SETTING_KEY || isMentorPreferencesBackupValue(value);
}
