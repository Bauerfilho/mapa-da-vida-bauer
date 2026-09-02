import { expect, test } from "@playwright/test";
import type { SettingRecord } from "../src/domain";
import {
  MENTOR_PREFERENCES_SETTING_KEY,
  accessibilityClassNames,
  mentorPreferencesFromSettings,
  normalizeMentorPreferences,
  validateMentorPreferences,
} from "../src/features/preferencesModel";

test("preferências ausentes continuam desconhecidas em vez de inventar metas", () => {
  const preferences = normalizeMentorPreferences(null);

  expect(preferences.studyGoals).toEqual({
    baseMinutes: null,
    goodMinutes: null,
    goldMinutes: null,
  });
  expect(preferences.sleepGoal).toEqual({
    targetMinutes: null,
    minimumMinutes: null,
    maximumMinutes: null,
  });
  expect(preferences).not.toHaveProperty("retention");
});

test("lê apenas a configuração canônica do conjunto de dados", () => {
  const settings: SettingRecord[] = [
    {
      id: "dataset:retention",
      datasetId: "dataset",
      key: "retention",
      value: { rawHistoryDays: 2 },
      updatedAt: "2026-09-01T12:00:00.000Z",
    },
    {
      id: `dataset:${MENTOR_PREFERENCES_SETTING_KEY}`,
      datasetId: "dataset",
      key: MENTOR_PREFERENCES_SETTING_KEY,
      value: {
        schema: "mentor-preferences-v1",
        studyGoals: { baseMinutes: 20, goodMinutes: 40, goldMinutes: 70 },
        sleepGoal: { targetMinutes: 480, minimumMinutes: 420, maximumMinutes: 540 },
        accessibility: { largerText: true, reducedMotion: false, highContrast: true },
      },
      updatedAt: "2026-09-01T12:00:00.000Z",
    },
  ];

  const preferences = mentorPreferencesFromSettings(settings);
  expect(preferences.studyGoals.goldMinutes).toBe(70);
  expect(preferences.sleepGoal.minimumMinutes).toBe(420);
  expect(accessibilityClassNames(preferences.accessibility)).toEqual([
    "mentor-text-large",
    "mentor-high-contrast",
  ]);
});

test("rejeita escadas invertidas e metas de sono fora da faixa", () => {
  const preferences = normalizeMentorPreferences({
    studyGoals: { baseMinutes: 60, goodMinutes: 40, goldMinutes: 20 },
    sleepGoal: { targetMinutes: 360, minimumMinutes: 420, maximumMinutes: 540 },
    accessibility: {},
  });
  const result = validateMentorPreferences(preferences);

  expect(result.valid).toBe(false);
  expect(result.errors).toContain("A meta Base não pode ser maior que a meta Boa.");
  expect(result.errors).toContain("A meta Boa não pode ser maior que a meta Ouro.");
  expect(result.errors).toContain("A meta central de sono precisa ficar dentro da faixa escolhida.");
});

test("aceita metas parciais sem transformar campos vazios em zero", () => {
  const preferences = normalizeMentorPreferences({
    studyGoals: { baseMinutes: 25 },
    sleepGoal: { targetMinutes: 480 },
    accessibility: { reducedMotion: true },
  });
  const result = validateMentorPreferences(preferences);

  expect(result).toEqual({ valid: true, errors: [] });
  expect(preferences.studyGoals.goodMinutes).toBeNull();
  expect(preferences.sleepGoal.maximumMinutes).toBeNull();
  expect(accessibilityClassNames(preferences.accessibility)).toEqual([
    "mentor-reduced-motion",
  ]);
});
