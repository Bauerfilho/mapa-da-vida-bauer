import type { SettingRecord } from "../domain";

export const MENTOR_PREFERENCES_SETTING_KEY = "mentor.preferences.v1";

export const ACCESSIBILITY_CLASS_NAMES = [
  "mentor-text-large",
  "mentor-reduced-motion",
  "mentor-high-contrast",
] as const;

export interface MentorPreferences {
  schema: "mentor-preferences-v1";
  studyGoals: {
    baseMinutes: number | null;
    goodMinutes: number | null;
    goldMinutes: number | null;
  };
  sleepGoal: {
    targetMinutes: number | null;
    minimumMinutes: number | null;
    maximumMinutes: number | null;
  };
  accessibility: {
    largerText: boolean;
    reducedMotion: boolean;
    highContrast: boolean;
  };
}

export interface PreferenceValidationResult {
  valid: boolean;
  errors: string[];
}

export const EMPTY_MENTOR_PREFERENCES: MentorPreferences = {
  schema: "mentor-preferences-v1",
  studyGoals: {
    baseMinutes: null,
    goodMinutes: null,
    goldMinutes: null,
  },
  sleepGoal: {
    targetMinutes: null,
    minimumMinutes: null,
    maximumMinutes: null,
  },
  accessibility: {
    largerText: false,
    reducedMotion: false,
    highContrast: false,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableMinute(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 1_440
    ? Number(value)
    : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

export function normalizeMentorPreferences(value: unknown): MentorPreferences {
  if (!isRecord(value)) return structuredClone(EMPTY_MENTOR_PREFERENCES);

  const studyGoals = isRecord(value.studyGoals) ? value.studyGoals : {};
  const sleepGoal = isRecord(value.sleepGoal) ? value.sleepGoal : {};
  const accessibility = isRecord(value.accessibility) ? value.accessibility : {};

  return {
    schema: "mentor-preferences-v1",
    studyGoals: {
      baseMinutes: nullableMinute(studyGoals.baseMinutes),
      goodMinutes: nullableMinute(studyGoals.goodMinutes),
      goldMinutes: nullableMinute(studyGoals.goldMinutes),
    },
    sleepGoal: {
      targetMinutes: nullableMinute(sleepGoal.targetMinutes),
      minimumMinutes: nullableMinute(sleepGoal.minimumMinutes),
      maximumMinutes: nullableMinute(sleepGoal.maximumMinutes),
    },
    accessibility: {
      largerText: booleanValue(accessibility.largerText),
      reducedMotion: booleanValue(accessibility.reducedMotion),
      highContrast: booleanValue(accessibility.highContrast),
    },
  };
}

export function mentorPreferencesFromSettings(
  settings: readonly SettingRecord[],
): MentorPreferences {
  const record = settings.find(
    (setting) => setting.key === MENTOR_PREFERENCES_SETTING_KEY,
  );
  return normalizeMentorPreferences(record?.value);
}

export function validateMentorPreferences(
  preferences: MentorPreferences,
): PreferenceValidationResult {
  const errors: string[] = [];
  const { baseMinutes, goodMinutes, goldMinutes } = preferences.studyGoals;
  const studyValues = [baseMinutes, goodMinutes, goldMinutes].filter(
    (value): value is number => value !== null,
  );
  if (studyValues.some((value) => !Number.isInteger(value) || value < 1 || value > 1_440)) {
    errors.push("Cada meta de estudo precisa estar entre 1 e 1.440 minutos.");
  }
  if (baseMinutes !== null && goodMinutes !== null && baseMinutes > goodMinutes) {
    errors.push("A meta Base não pode ser maior que a meta Boa.");
  }
  if (goodMinutes !== null && goldMinutes !== null && goodMinutes > goldMinutes) {
    errors.push("A meta Boa não pode ser maior que a meta Ouro.");
  }
  if (baseMinutes !== null && goldMinutes !== null && baseMinutes > goldMinutes) {
    errors.push("A meta Base não pode ser maior que a meta Ouro.");
  }

  const { targetMinutes, minimumMinutes, maximumMinutes } = preferences.sleepGoal;
  const sleepValues = [targetMinutes, minimumMinutes, maximumMinutes].filter(
    (value): value is number => value !== null,
  );
  if (sleepValues.some((value) => !Number.isInteger(value) || value < 60 || value > 1_440)) {
    errors.push("A meta de sono precisa estar entre 60 e 1.440 minutos.");
  }
  if (minimumMinutes !== null && maximumMinutes !== null && minimumMinutes > maximumMinutes) {
    errors.push("O início da faixa de sono não pode superar o fim.");
  }
  if (targetMinutes !== null && minimumMinutes !== null && targetMinutes < minimumMinutes) {
    errors.push("A meta central de sono precisa ficar dentro da faixa escolhida.");
  }
  if (targetMinutes !== null && maximumMinutes !== null && targetMinutes > maximumMinutes) {
    errors.push("A meta central de sono precisa ficar dentro da faixa escolhida.");
  }

  return { valid: errors.length === 0, errors };
}

export function accessibilityClassNames(
  accessibility: MentorPreferences["accessibility"],
): string[] {
  const classNames: string[] = [];
  if (accessibility.largerText) classNames.push(ACCESSIBILITY_CLASS_NAMES[0]);
  if (accessibility.reducedMotion) classNames.push(ACCESSIBILITY_CLASS_NAMES[1]);
  if (accessibility.highContrast) classNames.push(ACCESSIBILITY_CLASS_NAMES[2]);
  return classNames;
}

export function mentorPreferencesEqual(
  left: MentorPreferences,
  right: MentorPreferences,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
