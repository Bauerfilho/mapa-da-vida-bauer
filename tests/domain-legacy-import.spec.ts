import { expect, test } from "@playwright/test";
import {
  buildLegacyImportPlan,
  detectLegacyImportSource,
  normalizeLegacyImport,
  sha256Hex,
  stableSerialize,
  type DatasetRecord,
  type MentorEntity,
} from "../src/domain";

const DATASET: DatasetRecord = {
  id: "bauer-personal-primary",
  name: "Mentor Bauer — dados pessoais",
  status: "active",
  ownerIdentity: {
    displayName: "Bauer Vieira",
    studentNumber: 7,
    institution: "UNIFIMES",
  },
  dataSchemaVersion: 1,
  nextOperationSequence: 4,
  dataRevision: 4,
  settingsRevision: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const OBST_STATE = {
  shifts: [
    { date: "2026-09-03", type: "noturno", tin: "19:00", tout: "07:00" },
  ],
  days: {
    "2026-09-03": {
      arr: "18:52",
      lunchIn: "00:10",
      lunchOut: "00:40",
      out: "07:08",
      broncas: [{ area: "Tocografia", note: "Rever contagem" }],
      topics: ["Cardiotocografia: leitura básica"],
      mood: { humor: 7, energia: 6, ansiedade: 2, foco: 4, sono: 5.5, meds: "parcial" },
      study: 45,
      note: "Pérola do plantão",
      saved: true,
    },
  },
  notes: [],
  reviewed: {},
  goals: { min: 45, good: 90, gold: 150, off: 120 },
};

const CEFALEIA_STORAGE = {
  entries: [
    {
      id: 1,
      data: "2026-08-25",
      cef: null,
      ot: null,
      brDia: "Moderado",
      brPeriodo: ["Tarde"],
      brAcordar: ["Mandíbula dolorida"],
      seca: 3,
      inq: "Leve",
      opt: "2 a 6h",
      tela: "8 a 12h",
      sonoH: "6.5",
      sonoD: "2",
      sonoQ: "Regular",
      lis1: "08:10",
      lis2: "",
      analg: false,
      analgQual: "",
      notas: "Dia de muita tela",
    },
  ],
  marcos: [{ data: "2026-08-24", texto: "Topiramato — mudança anotada literalmente" }],
};

test("detecta somente os quatro formatos JSON legados explícitos", () => {
  expect(detectLegacyImportSource({
    schemaVersion: 2,
    exportedAt: 1_788_131_200_000,
    state: OBST_STATE,
  }).format).toBe("obstetricia-v2-envelope");
  expect(detectLegacyImportSource(OBST_STATE).format).toBe("obstetricia-v1-state");
  expect(detectLegacyImportSource(CEFALEIA_STORAGE).format).toBe("cefaleia-v1-object");
  expect(detectLegacyImportSource(CEFALEIA_STORAGE.entries).format)
    .toBe("cefaleia-v1-entry-array");
  expect(() => detectLegacyImportSource([])).toThrow(/Formato legado não reconhecido/);
  expect(() => detectLegacyImportSource("relatório copiado como texto"))
    .toThrow(/não contém JSON válido/);
});

test("normaliza o diário obstétrico sem inferir presença, conclusão ou converter a escala 1–7", () => {
  const normalized = normalizeLegacyImport(OBST_STATE);
  expect(normalized.family).toBe("legacy-obstetricia");
  expect(normalized.shifts).toHaveLength(1);
  expect(normalized.shifts[0]).toMatchObject({
    scheduledStartLocal: "2026-09-03T19:00:00",
    scheduledEndLocal: "2026-09-04T07:00:00",
    arrivalLocal: "2026-09-03T18:52:00",
    departureLocal: "2026-09-04T07:08:00",
    breakStartLocal: "2026-09-04T00:10:00",
    breakEndLocal: "2026-09-04T00:40:00",
  });
  const mood = normalized.entities.find((entity) => entity.domain === "humor");
  expect(mood?.payload).toMatchObject({
    eventKind: "legacy-mood-check-in-1-7",
    legacyScaleVersion: "obstetricia-mood-1-7-v1",
    legacyValues: {
      humor: { state: "known", value: 7, source: "imported" },
    },
  });
  expect(mood?.payload).not.toHaveProperty("mood");
  const study = normalized.entities.find((entity) => entity.domain === "estudos");
  expect(study?.payload).toMatchObject({
    minutes: { state: "known", value: 45 },
    completed: { state: "unknown", reason: "legacy_ambiguous" },
  });
  expect(normalized.warnings.some((warning) =>
    warning.code === "legacy_free_text_review_required" && warning.requiresAcknowledgement
  )).toBe(true);
});

test("mantém ausência de cefaleia desconhecida e categorias de bruxismo sem fabricar escore", () => {
  const normalized = normalizeLegacyImport(CEFALEIA_STORAGE);
  const headache = normalized.entities.find((entity) => entity.domain === "cefaleia");
  expect(headache?.payload.presence).toEqual({
    state: "unknown",
    reason: "legacy_ambiguous",
  });
  const bruxism = normalized.entities.find((entity) => entity.domain === "bruxismo");
  expect(bruxism?.payload).toMatchObject({
    daytimeClenching: { state: "known", value: true, source: "imported" },
    legacySeverity: { state: "known", value: "Moderado", source: "imported" },
    morning: {
      jawPain: { state: "unknown", reason: "legacy_ambiguous" },
    },
  });
  const sleep = normalized.entities.find((entity) => entity.domain === "sono");
  expect(sleep?.payload.totalSleepMinutes).toEqual({
    state: "known",
    value: 390,
    source: "imported",
  });
  const medication = normalized.entities.find((entity) =>
    entity.domain === "medicamentos" && entity.payload.eventKind === "legacy-medication-day"
  );
  expect(medication?.payload).toMatchObject({
    stimulantDoseTimes: {
      first: { state: "known", value: "08:10" },
    },
    analgesicUsed: { state: "unknown", reason: "legacy_ambiguous" },
  });
});

test("planeja atualização segura da jornada canônica e denuncia conflito de horário real", async () => {
  const seedShift: MentorEntity<"internato.shift"> = {
    id: "seed-shift-2026-09-03-1900",
    datasetId: DATASET.id,
    domain: "internato",
    type: "internato.shift",
    localDate: "2026-09-03",
    occurredAtUTC: "2026-09-03T22:00:00.000Z",
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision: 1,
    source: "seed",
    status: "active",
    createdAt: DATASET.createdAt,
    updatedAt: DATASET.updatedAt,
    payload: {
      scheduleState: "confirmed_planned",
      scheduledStartLocal: "2026-09-03T19:00:00",
      scheduledEndLocal: "2026-09-04T07:00:00",
      assignment: { state: "unknown", reason: "not_confirmed" },
      location: { state: "unknown", reason: "not_confirmed" },
      attendance: { state: "unknown", reason: "not_recorded" },
      arrivalLocal: { state: "unknown", reason: "not_recorded" },
      departureLocal: { state: "unknown", reason: "not_recorded" },
      breakStartLocal: { state: "unknown", reason: "not_recorded" },
      breakEndLocal: { state: "unknown", reason: "not_recorded" },
    },
  };
  const normalized = normalizeLegacyImport(OBST_STATE);
  const plan = await buildLegacyImportPlan(normalized, {
    dataset: DATASET,
    existingEntities: [seedShift],
    existingSettings: [],
    importedAt: "2026-09-01T12:00:00.000Z",
  });
  const shiftUpdate = plan.actions.find((action) => action.kind === "update-entity");
  expect(shiftUpdate).toMatchObject({
    kind: "update-entity",
    entity: {
      id: seedShift.id,
      revision: 2,
      payload: {
        attendance: { state: "unknown", reason: "not_recorded" },
        arrivalLocal: { state: "known", value: "2026-09-03T18:52:00" },
      },
    },
  });

  const changedShift: MentorEntity<"internato.shift"> = {
    ...seedShift,
    payload: {
      ...seedShift.payload,
      arrivalLocal: {
        state: "known",
        value: "2026-09-03T19:20:00",
        source: "user",
      },
    },
  };
  const conflictPlan = await buildLegacyImportPlan(normalized, {
    dataset: DATASET,
    existingEntities: [changedShift],
    existingSettings: [],
    importedAt: "2026-09-01T12:00:00.000Z",
  });
  expect(conflictPlan.conflicts).toContainEqual(expect.objectContaining({
    subjectKind: "shift",
    key: seedShift.id,
    reason: "recorded_shift_actual_differs",
  }));
  expect(conflictPlan.actions.some((action) =>
    action.kind === "update-entity" && action.entity.id === seedShift.id
  )).toBe(false);
});

test("serialização e checksums são estáveis sem confundir referências repetidas com ciclo", async () => {
  const shared = { state: "known", value: 1 };
  const value = { z: shared, a: shared };
  expect(stableSerialize(value)).toBe(
    '{"a":{"state":"known","value":1},"z":{"state":"known","value":1}}',
  );
  expect(await sha256Hex(stableSerialize(value)))
    .toBe(await sha256Hex(stableSerialize({ a: shared, z: shared })));
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(() => stableSerialize(cyclic)).toThrow(/referência circular/);
});
