import { expect, test } from "@playwright/test";
import {
  ENTITY_USER_EDIT_REASON,
  EntityRevisionConflictError,
  MAX_ENTITY_REVISION_SUMMARY_LENGTH,
  MAX_REVISION_PATCH_LEAVES,
  MAX_REVISION_TEXT_LENGTH,
  isEntityRevisionConflictError,
  isRevisionLocalDateEditable,
  known,
  mergePreservingUnknown,
  revisionConflictMessage,
  unknown,
  validateRevisionPayloadPatch,
  type MentorEntity,
} from "../src/domain";

test("recursive edits preserve unknown fields and replace arrays atomically", () => {
  const current = {
    title: "antes",
    nested: {
      editable: "antes",
      futureField: { version: 3, enabled: true },
    },
    futureTopLevel: "preservar",
    tags: ["a", "b"],
  };

  const merged = mergePreservingUnknown(current, {
    title: "depois",
    nested: { editable: "depois" },
    tags: ["nova"],
  });

  expect(merged).toEqual({
    title: "depois",
    nested: {
      editable: "depois",
      futureField: { version: 3, enabled: true },
    },
    futureTopLevel: "preservar",
    tags: ["nova"],
  });
  expect(current.title).toBe("antes");
  expect(current.tags).toEqual(["a", "b"]);
});

test("knowledge states are replaced as complete facts instead of mixed", () => {
  const current = {
    answer: known("valor antigo", "user", "2026-09-01T12:00:00.000Z"),
    untouched: unknown<string>("not_recorded"),
  };

  const merged = mergePreservingUnknown(current, {
    answer: unknown<string>("withheld"),
  });

  expect(merged.answer).toEqual({ state: "unknown", reason: "withheld" });
  expect(merged.answer).not.toHaveProperty("value");
  expect(merged.untouched).toEqual(current.untouched);
});

test("revision conflicts carry the stored entity and an explicit no-overwrite message", () => {
  const entity = {
    id: "record-1",
    revision: 5,
  } as MentorEntity;
  const conflict = new EntityRevisionConflictError("record-1", 4, 5, entity);

  expect(isEntityRevisionConflictError(conflict)).toBe(true);
  expect(conflict.expectedRevision).toBe(4);
  expect(conflict.actualRevision).toBe(5);
  expect(conflict.currentEntity).toBe(entity);
  expect(revisionConflictMessage(conflict)).toContain("Nada foi sobrescrito");
});

test("revision policy accepts narrative corrections and preserves the canonical reason", () => {
  const generic = {
    eventKind: "knowledge-note",
    title: "Antes",
    note: known("Texto original"),
    intensity: 3,
  };
  const genericResult = validateRevisionPayloadPatch("generic.event", generic, {
    title: "Depois",
    note: { value: "Texto corrigido" },
  });
  const cardResult = validateRevisionPayloadPatch("financas.card", {
    label: "Cartão principal",
    note: known("Conferido"),
  }, {
    label: "Cartão pessoal",
  });

  expect(genericResult).toEqual({ valid: true, changed: true });
  expect(cardResult).toEqual({ valid: true, changed: true });
  expect(ENTITY_USER_EDIT_REASON).toBe("entity_user_edit");
  expect(isRevisionLocalDateEditable("generic.event")).toBe(false);
  expect(isRevisionLocalDateEditable("financas.card")).toBe(false);
});

test("revision policy rejects measurements, enums, dates and structural replacements", () => {
  const energy = validateRevisionPayloadPatch("humor.energy-check-in", {
    energy: 3,
    note: unknown<string>("not_recorded"),
  }, { energy: 99 });
  const medication = validateRevisionPayloadPatch("medicamentos.confirmation", {
    confirmation: "taken_time_recorded",
    note: known("sem intercorrência"),
  }, { confirmation: "inventado" });
  const cardDate = validateRevisionPayloadPatch("financas.card", {
    label: "Cartão",
    dueDate: known("2026-09-10"),
  }, { dueDate: { value: "2026-09-01" } });
  const replacedKnowledge = validateRevisionPayloadPatch("generic.event", {
    note: known("original"),
  }, { note: unknown<string>("withheld") });

  for (const result of [energy, medication, cardDate, replacedKnowledge]) {
    expect(result.valid).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.error).toContain("editor específico");
  }
});

test("revision policy keeps clinical identity and generic topics out of the generic editor", () => {
  const genericTopics = validateRevisionPayloadPatch("generic.event", {
    topics: ["Cardiotocografia"],
    topic: "Pré-natal",
    note: "Observação segura",
  }, {
    topics: ["Puerpério"],
  });
  const genericMedicationIdentity = validateRevisionPayloadPatch("generic.event", {
    medicationName: "Medicamento A",
  }, {
    medicationName: "Medicamento B",
  });
  const medicationName = validateRevisionPayloadPatch("medicamentos.confirmation", {
    medicationName: known("Medicamento A"),
    doseLabel: known("10 mg"),
    note: known("Após o café"),
  }, {
    medicationName: { value: "Medicamento B" },
  });
  const medicationDose = validateRevisionPayloadPatch("medicamentos.confirmation", {
    medicationName: known("Medicamento A"),
    doseLabel: known("10 mg"),
    note: known("Após o café"),
  }, {
    doseLabel: { value: "20 mg" },
  });
  const medicationNote = validateRevisionPayloadPatch("medicamentos.confirmation", {
    medicationName: known("Medicamento A"),
    doseLabel: known("10 mg"),
    note: known("Após o café"),
  }, {
    note: { value: "Após o almoço" },
  });

  expect(genericTopics.valid).toBe(false);
  expect(genericMedicationIdentity.valid).toBe(false);
  expect(medicationName.valid).toBe(false);
  expect(medicationDose.valid).toBe(false);
  expect(medicationNote).toEqual({ valid: true, changed: true });
});

test("revision validation rejects empty lists and bounded-input violations", () => {
  const emptyList = validateRevisionPayloadPatch("generic.event", {
    tags: ["importante"],
  }, { tags: [] });
  const oversizedText = validateRevisionPayloadPatch("generic.event", {
    title: "Título",
  }, { title: "x".repeat(MAX_REVISION_TEXT_LENGTH + 1) });
  const tooManyLeaves = Object.fromEntries(
    Array.from({ length: MAX_REVISION_PATCH_LEAVES + 1 }, (_, index) => [
      `note${index}`,
      "alterado",
    ]),
  );
  const leafOverflow = validateRevisionPayloadPatch(
    "generic.event",
    Object.fromEntries(Object.keys(tooManyLeaves).map((key) => [key, "original"])),
    tooManyLeaves,
  );

  expect(emptyList.valid).toBe(false);
  expect(emptyList.error).toContain("pelo menos um item");
  expect(oversizedText.valid).toBe(false);
  expect(oversizedText.error).toContain("texto seguro");
  expect(leafOverflow.valid).toBe(false);
  expect(leafOverflow.error).toContain(`no máximo ${MAX_REVISION_PATCH_LEAVES}`);
  expect(MAX_ENTITY_REVISION_SUMMARY_LENGTH).toBe(240);
});

test("revision validation rejects sparse arrays and arrays with hidden fields", () => {
  const sparseTags = new Array<string>(1);
  const taggedWithExtraField = ["importante"] as string[] & {
    credential?: string;
  };
  taggedWithExtraField.credential = "não permitido";

  const sparseResult = validateRevisionPayloadPatch("generic.event", {
    tags: ["original"],
  }, { tags: sparseTags });
  const extraFieldResult = validateRevisionPayloadPatch("generic.event", {
    tags: ["original"],
  }, { tags: taggedWithExtraField });

  expect(sparseResult.valid).toBe(false);
  expect(extraFieldResult.valid).toBe(false);
  expect(() => mergePreservingUnknown({ tags: ["original"] }, {
    tags: sparseTags,
  })).toThrow(/lista esparsa/i);
  expect(() => mergePreservingUnknown({ tags: ["original"] }, {
    tags: taggedWithExtraField,
  })).toThrow(/campos não permitidos/i);
});

test("revision traversal rejects deep, cyclic and reserved-key patches without pollution", () => {
  const tooDeep = { title: "corrigido" } as Record<string, unknown>;
  for (let depth = 0; depth < 7; depth += 1) {
    const previous = { ...tooDeep };
    for (const key of Object.keys(tooDeep)) delete tooDeep[key];
    tooDeep[`level${depth}`] = previous;
  }
  const cyclic: Record<string, unknown> = { title: "corrigido" };
  cyclic.self = cyclic;
  const reserved = JSON.parse(
    '{"title":"corrigido","__proto__":{"polluted":"sim"}}',
  ) as Record<string, unknown>;

  const deepResult = validateRevisionPayloadPatch("generic.event", {}, tooDeep);
  const cycleResult = validateRevisionPayloadPatch("generic.event", {}, cyclic);
  const reservedResult = validateRevisionPayloadPatch("generic.event", {
    title: "original",
  }, reserved);

  expect(deepResult.valid).toBe(false);
  expect(deepResult.error).toContain("níveis");
  expect(cycleResult.valid).toBe(false);
  expect(cycleResult.error).toContain("circular");
  expect(reservedResult.valid).toBe(false);
  expect(reservedResult.error).toContain("reservado");
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(() => mergePreservingUnknown({}, reserved)).toThrow(/reservado/);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});
