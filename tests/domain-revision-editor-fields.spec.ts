import { expect, test } from "@playwright/test";
import {
  known,
  MAX_REVISION_PATCH_LEAVES,
  MAX_REVISION_TEXT_LENGTH,
  mergePreservingUnknown,
  unknown,
} from "../src/domain";
import {
  collectEditablePayloadLeaves,
  editableLeafDraftValue,
  isStructuralRevisionField,
  planEditablePayloadPatch,
} from "../src/features/entityRevisionFields";

test("shows only safely editable known leaves and hides structural data", () => {
  const payload = {
    schema: "sleep-v4",
    eventKind: "sleep-chronology",
    recordMode: "manual",
    status: "active",
    title: "Noite",
    awakenings: 2,
    restorative: false,
    note: known("acordei cedo", "user", "2026-09-01T10:00:00.000Z"),
    withheld: unknown<string>("withheld"),
    nested: { topic: "CTG" },
    tags: ["sono", "plantão"],
    longList: Array.from({ length: 13 }, (_, index) => String(index)),
    mixedList: ["um", 2],
    opaque: { deeply: { unsupported: { value: { object: true } } } },
  };

  const leaves = collectEditablePayloadLeaves("generic.event", payload);
  const paths = leaves.map((leaf) => leaf.path.join("."));

  expect(paths).toContain("title");
  expect(paths).not.toContain("awakenings");
  expect(paths).not.toContain("restorative");
  expect(paths).toContain("note.value");
  expect(paths).not.toContain("nested.topic");
  expect(paths).toContain("tags");
  expect(paths).not.toContain("schema");
  expect(paths).not.toContain("eventKind");
  expect(paths).not.toContain("recordMode");
  expect(paths).not.toContain("status");
  expect(paths).not.toContain("withheld.value");
  expect(paths).not.toContain("longList");
  expect(paths).not.toContain("mixedList");
  expect(isStructuralRevisionField("event_kind")).toBe(true);
});

test("builds a minimal patch and a before/after comparison", () => {
  const payload = {
    schema: "test-v1",
    title: "Antes",
    count: 2,
    active: false,
    note: known("original", "user", "2026-09-01T10:00:00.000Z"),
    tags: ["um", "dois"],
    futureField: { version: 7 },
  };
  const leaves = collectEditablePayloadLeaves("generic.event", payload);
  const drafts = Object.fromEntries(
    leaves.map((leaf) => [leaf.id, editableLeafDraftValue(leaf)]),
  );
  const byPath = new Map(leaves.map((leaf) => [leaf.path.join("."), leaf]));
  drafts[byPath.get("title")!.id] = "Depois";
  drafts[byPath.get("note.value")!.id] = "revisto";
  drafts[byPath.get("tags")!.id] = "um\ntrês";

  const plan = planEditablePayloadPatch(leaves, drafts);
  expect(plan.errors).toEqual({});
  expect(plan.payloadPatch).toEqual({
    note: { value: "revisto" },
    tags: ["um", "três"],
    title: "Depois",
  });
  expect(plan.changes.map((change) => change.label)).toEqual(
    expect.arrayContaining(["Título", "Observação", "Marcadores"]),
  );

  const merged = mergePreservingUnknown(payload, plan.payloadPatch);
  expect(merged.futureField).toEqual({ version: 7 });
  expect(merged.schema).toBe("test-v1");
  expect(merged.note).toEqual({
    state: "known",
    value: "revisto",
    source: "user",
    recordedAt: "2026-09-01T10:00:00.000Z",
  });
});

test("hides numeric measurements and rejects empty text or oversized lists", () => {
  const leaves = collectEditablePayloadLeaves("generic.event", {
    count: 2,
    tags: ["a"],
    title: "Título",
  });
  expect(leaves.some((leaf) => leaf.path.join(".") === "count")).toBe(false);
  const tags = leaves.find((leaf) => leaf.path.join(".") === "tags")!;
  const title = leaves.find((leaf) => leaf.path.join(".") === "title")!;
  const plan = planEditablePayloadPatch(leaves, {
    [tags.id]: Array.from({ length: 13 }, (_, index) => String(index)).join("\n"),
    [title.id]: "   ",
  });

  expect(plan.errors[tags.id]).toContain("no máximo 12");
  expect(plan.errors[title.id]).toContain("não pode ficar vazio");
  expect(plan.changes).toEqual([]);

  const emptyList = planEditablePayloadPatch(leaves, {
    [tags.id]: "  \n ",
    [title.id]: "Título",
  });
  expect(emptyList.errors[tags.id]).toContain("pelo menos um item");
});

test("hides generic topics and medication identity while retaining safe medication notes", () => {
  const generic = collectEditablePayloadLeaves("generic.event", {
    title: "Registro",
    topic: "Cardiotocografia",
    topics: ["Cardiotocografia", "Puerpério"],
    note: "Observação",
  });
  const medication = collectEditablePayloadLeaves("medicamentos.confirmation", {
    medicationName: known("Medicamento A"),
    doseLabel: known("10 mg"),
    note: known("Após o café"),
  });

  expect(generic.map((leaf) => leaf.path.join("."))).toEqual([
    "note",
    "title",
  ]);
  expect(medication.map((leaf) => leaf.path.join("."))).toEqual(["note.value"]);
});

test("collector and planner fail closed on cycles, reserved paths and oversized text", () => {
  const cyclic: Record<string, unknown> = { title: "Seguro" };
  cyclic.self = cyclic;
  const reserved = JSON.parse(
    '{"title":"Seguro","constructor":{"note":"não expor"}}',
  ) as Record<string, unknown>;
  expect(collectEditablePayloadLeaves("generic.event", cyclic)).toEqual([]);
  expect(collectEditablePayloadLeaves("generic.event", reserved)).toEqual([]);
  expect(isStructuralRevisionField("__proto__")).toBe(true);
  expect(isStructuralRevisionField("prototype")).toBe(true);
  expect(isStructuralRevisionField("constructor")).toBe(true);

  const unsafeLeaf = {
    id: "unsafe",
    path: ["__proto__", "polluted"],
    label: "Inseguro",
    kind: "string" as const,
    value: "antes",
    multiline: false,
  };
  const oversizedLeaf = {
    id: "long",
    path: ["title"],
    label: "Título",
    kind: "string" as const,
    value: "antes",
    multiline: false,
  };
  const plan = planEditablePayloadPatch([unsafeLeaf, oversizedLeaf], {
    unsafe: "depois",
    long: "x".repeat(MAX_REVISION_TEXT_LENGTH + 1),
  });
  expect(plan.errors.unsafe).toContain("caminho seguro");
  expect(plan.errors.long).toContain(`no máximo ${MAX_REVISION_TEXT_LENGTH}`);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

test("collector and planner cap editable leaf work", () => {
  const payload = Object.fromEntries(
    Array.from({ length: MAX_REVISION_PATCH_LEAVES + 10 }, (_, index) => [
      `group${index}`,
      { note: `nota ${index}` },
    ]),
  );
  const leaves = collectEditablePayloadLeaves("generic.event", payload);
  expect(leaves).toHaveLength(MAX_REVISION_PATCH_LEAVES);

  const duplicated = Array.from(
    { length: MAX_REVISION_PATCH_LEAVES + 1 },
    (_, index) => ({
      ...leaves[0]!,
      id: `leaf-${index}`,
      path: [`group-${index}`, "note"],
    }),
  );
  const plan = planEditablePayloadPatch(
    duplicated,
    Object.fromEntries(duplicated.map((leaf) => [leaf.id, "alterada"])),
  );
  expect(plan.errors.$payload).toContain(`no máximo ${MAX_REVISION_PATCH_LEAVES}`);
});
