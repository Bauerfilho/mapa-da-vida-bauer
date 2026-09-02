import { expect, test } from "@playwright/test";
import type { SettingRecord } from "../src/domain";
import {
  PREFERENCES_BACKUP_SETTING_KEY,
  isMentorPreferencesBackupValue,
  isSupportedBackupSettingValue,
} from "../src/data/preferenceBackup";
import {
  MENTOR_PREFERENCES_SETTING_KEY,
  mentorPreferencesFromSettings,
} from "../src/features/preferencesModel";

const unknownPreferences = {
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
} as const;

test("contrato de backup usa a mesma chave canônica das preferências", () => {
  expect(PREFERENCES_BACKUP_SETTING_KEY).toBe(MENTOR_PREFERENCES_SETTING_KEY);
});

test("round-trip JSON preserva metas desconhecidas sem inventar números", () => {
  const source: SettingRecord = {
    id: `dataset:${PREFERENCES_BACKUP_SETTING_KEY}`,
    datasetId: "dataset",
    key: PREFERENCES_BACKUP_SETTING_KEY,
    value: unknownPreferences,
    updatedAt: "2026-09-01T12:00:00.000Z",
  };
  const restored = JSON.parse(JSON.stringify(source)) as SettingRecord;

  expect(isMentorPreferencesBackupValue(restored.value)).toBe(true);
  expect(mentorPreferencesFromSettings([restored])).toEqual(unknownPreferences);
  expect(restored.value).toEqual(source.value);
});

test("contrato aceita somente a estrutura completa confirmada pelo usuário", () => {
  const confirmed = {
    schema: "mentor-preferences-v1",
    studyGoals: { baseMinutes: 20, goodMinutes: 40, goldMinutes: 70 },
    sleepGoal: { targetMinutes: 480, minimumMinutes: 420, maximumMinutes: 540 },
    accessibility: { largerText: true, reducedMotion: true, highContrast: false },
  };

  expect(isMentorPreferencesBackupValue(confirmed)).toBe(true);
  expect(isSupportedBackupSettingValue(PREFERENCES_BACKUP_SETTING_KEY, confirmed)).toBe(true);
});

test("restore rejeita preferências parciais, extras ou semanticamente inválidas", () => {
  const cases: unknown[] = [
    null,
    {},
    { ...unknownPreferences, schema: "mentor-preferences-v2" },
    {
      ...unknownPreferences,
      studyGoals: { baseMinutes: 20, goodMinutes: null },
    },
    {
      ...unknownPreferences,
      studyGoals: { baseMinutes: 60, goodMinutes: 40, goldMinutes: 20 },
    },
    {
      ...unknownPreferences,
      sleepGoal: { targetMinutes: 360, minimumMinutes: 420, maximumMinutes: 540 },
    },
    {
      ...unknownPreferences,
      accessibility: { largerText: "sim", reducedMotion: false, highContrast: false },
    },
    { ...unknownPreferences, unexpected: true },
  ];

  for (const value of cases) {
    expect(isMentorPreferencesBackupValue(value)).toBe(false);
    expect(isSupportedBackupSettingValue(PREFERENCES_BACKUP_SETTING_KEY, value)).toBe(false);
  }
});

test("validação específica não cria política nova para outras settings", () => {
  expect(isSupportedBackupSettingValue("retention", { rawHistoryDays: 365 })).toBe(true);
});
