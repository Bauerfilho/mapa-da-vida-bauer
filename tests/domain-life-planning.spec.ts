import { expect, test } from "@playwright/test";
import {
  explicitClockSpanMinutes,
  summarizeRoutineEvidence,
  summarizeStudyEvidence,
} from "../src/domain";

test.describe("evidências de estudo", () => {
  test("mantém campos sem amostra como desconhecidos", () => {
    expect(summarizeStudyEvidence([])).toEqual({
      plannedMinutes: null,
      actualMinutes: null,
      estimateDeltaMinutes: null,
      questionAccuracyPercent: null,
      questionCount: 0,
      reviewsDue: null,
    });
  });

  test("preserva zeros explícitos sem criar acurácia para zero questões", () => {
    expect(summarizeStudyEvidence([{
      plannedMinutes: 0,
      actualMinutes: 0,
      attemptedQuestions: 0,
      correctQuestions: 0,
      reviewDue: false,
    }])).toEqual({
      plannedMinutes: 0,
      actualMinutes: 0,
      estimateDeltaMinutes: 0,
      questionAccuracyPercent: null,
      questionCount: 0,
      reviewsDue: 0,
    });
  });

  test("agrega somente pares de questões válidos e durações comparáveis", () => {
    expect(summarizeStudyEvidence([
      {
        plannedMinutes: 20,
        actualMinutes: 25,
        attemptedQuestions: 10,
        correctQuestions: 8,
        reviewDue: true,
      },
      {
        plannedMinutes: 40,
        actualMinutes: null,
        attemptedQuestions: 4,
        correctQuestions: 5,
        reviewDue: null,
      },
      {
        plannedMinutes: null,
        actualMinutes: 30,
        attemptedQuestions: 10,
        correctQuestions: 7,
        reviewDue: false,
      },
    ])).toEqual({
      plannedMinutes: 60,
      actualMinutes: 55,
      estimateDeltaMinutes: 5,
      questionAccuracyPercent: 75,
      questionCount: 20,
      reviewsDue: 1,
    });
  });
});

test.describe("evidências de rotina", () => {
  test("não converte ausência de blocos em zero", () => {
    expect(summarizeRoutineEvidence([])).toEqual({
      plannedMinutes: null,
      actualMinutes: null,
      estimateDeltaMinutes: null,
      completionPercent: null,
      completionCount: 0,
      replannedBlocks: null,
    });
  });

  test("distingue confirmação negativa de dado ausente", () => {
    expect(summarizeRoutineEvidence([{
      plannedMinutes: 0,
      actualMinutes: 0,
      completed: false,
      replanned: false,
    }])).toEqual({
      plannedMinutes: 0,
      actualMinutes: 0,
      estimateDeltaMinutes: 0,
      completionPercent: 0,
      completionCount: 1,
      replannedBlocks: 0,
    });
  });

  test("calibra conclusão e replanejamento apenas com confirmações explícitas", () => {
    expect(summarizeRoutineEvidence([
      { plannedMinutes: 60, actualMinutes: 50, completed: true, replanned: false },
      { plannedMinutes: 30, actualMinutes: 45, completed: false, replanned: true },
      { plannedMinutes: 20, actualMinutes: null, completed: null, replanned: null },
    ])).toEqual({
      plannedMinutes: 110,
      actualMinutes: 95,
      estimateDeltaMinutes: 5,
      completionPercent: 50,
      completionCount: 2,
      replannedBlocks: 1,
    });
  });
});

test.describe("intervalos de relógio explícitos", () => {
  test("calcula blocos normais e preserva zero explícito", () => {
    expect(explicitClockSpanMinutes("08:15", "09:00", false)).toBe(45);
    expect(explicitClockSpanMinutes("12:00", "12:00", false)).toBe(0);
    expect(explicitClockSpanMinutes("", "", false)).toBeNull();
  });

  test("só atravessa a meia-noite quando o usuário confirma", () => {
    expect(explicitClockSpanMinutes("23:30", "00:15", true)).toBe(45);
    expect(() => explicitClockSpanMinutes("23:30", "00:15", false)).toThrow(
      "Marque que o bloco cruza a meia-noite",
    );
  });

  test("rejeita pares incompletos ou horários inválidos", () => {
    expect(() => explicitClockSpanMinutes("08:00", "", false)).toThrow(
      "Início e fim precisam usar HH:mm",
    );
    expect(() => explicitClockSpanMinutes("24:00", "01:00", true)).toThrow(
      "Início e fim precisam usar HH:mm",
    );
  });
});
