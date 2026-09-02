import { expect, test } from "@playwright/test";
import { assertMedicationSlotsAvailable, medicationSlotKey, MedicationSlotConflictError } from "../src/domain/medicationUniqueness";
import { known, unknown, type MentorEntity } from "../src/domain/model";

function dose(id: string, time = "08:00"): MentorEntity<"medicamentos.confirmation"> {
  return { id, datasetId: "fixture", domain: "medicamentos", type: "medicamentos.confirmation", localDate: "2026-09-02", occurredAtUTC: "2026-09-02T12:00:00Z", timezone: "America/Sao_Paulo", schemaVersion: 1, revision: 1, source: "manual", status: "active", createdAt: "2026-09-02T12:00:00Z", updatedAt: "2026-09-02T12:00:00Z", payload: { regimenId: known("regime-a"), medicationName: known("Sintético"), scheduledTimeLocal: known(time), actualTimeLocal: unknown("not_recorded"), confirmation: "taken_time_unknown", note: unknown("not_recorded") } };
}

test("segundos no mesmo minuto não criam uma nova dose", () => {
  expect(medicationSlotKey(dose("a"))).toBe(medicationSlotKey(dose("b", "08:00:59")));
  expect(() => assertMedicationSlotsAvailable([dose("b", "08:00:00")], [dose("a")])).toThrow(MedicationSlotConflictError);
});

test("minuto, regime, dia e conjunto diferentes permanecem distintos", () => {
  const a = dose("a");
  const otherRegimen = dose("c"); otherRegimen.payload.regimenId = known("regime-b");
  const incoming = [dose("b", "08:01"), otherRegimen, { ...dose("d"), localDate: "2026-09-03" }, { ...dose("e"), datasetId: "outro" }];
  expect(() => assertMedicationSlotsAvailable(incoming, [a])).not.toThrow();
});

test("legados sem vínculo conhecido nunca são fundidos por nome ou horário", () => {
  const absent = dose("a"); delete absent.payload.regimenId;
  const unclear = dose("b"); unclear.payload.regimenId = unknown("not_recorded");
  const unscheduled = dose("c"); unscheduled.payload.scheduledTimeLocal = unknown("not_recorded");
  for (const entry of [absent, unclear, unscheduled]) expect(medicationSlotKey(entry)).toBeNull();
  expect(() => assertMedicationSlotsAvailable([absent, unclear, unscheduled], [dose("d")])).not.toThrow();
});

test("excluídos não ocupam o horário e nova revisão do mesmo ID é permitida", () => {
  const deleted = { ...dose("a"), status: "deleted" as const };
  expect(medicationSlotKey(deleted)).toBeNull();
  expect(() => assertMedicationSlotsAvailable([dose("b")], [deleted])).not.toThrow();
  expect(() => assertMedicationSlotsAvailable([{ ...dose("a"), revision: 2 }], [dose("a")])).not.toThrow();
});

test("conflito entre candidatos do próprio lote não depende da ordem", () => {
  for (const entries of [[dose("a"), dose("b")], [dose("b"), dose("a")]]) {
    expect(() => assertMedicationSlotsAvailable(entries, [])).toThrow(MedicationSlotConflictError);
  }
});

test("uma revisão própria não ignora outro ID que ocupa o mesmo horário", () => {
  expect(() => assertMedicationSlotsAvailable([{ ...dose("a"), revision: 2 }], [dose("a"), dose("b")])).toThrow(MedicationSlotConflictError);
});

test("horário conhecido inválido é recusado antes de cortar os segundos", () => {
  for (const time of ["8:00", "08:00:60", "24:00", "08:99", "08:00lixo"]) {
    expect(() => medicationSlotKey(dose("a", time))).toThrow("horário agendado");
  }
});

test("delimitadores nos IDs não colidem e o lote não modifica os originais", () => {
  const a = dose("a"); a.datasetId = "x:y"; a.payload.regimenId = known("z");
  const b = dose("b"); b.datasetId = "x"; b.payload.regimenId = known("y:z");
  const before = JSON.stringify([a, b]);
  expect(medicationSlotKey(a)).not.toBe(medicationSlotKey(b));
  assertMedicationSlotsAvailable([a, b], []);
  expect(JSON.stringify([a, b])).toBe(before);
});
