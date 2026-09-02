import { expect, test } from "@playwright/test";
import { createAnnualDate, isAnnualDatePayload, projectAnnualDates, annualDateAlerts, type AnnualDateInput } from "../src/domain/annualDates";
import { known, type LocalDate, type MentorEntity } from "../src/domain/model";
import { selectOperationalWindow } from "../src/domain/operationalState";

// Datas e nomes sintéticos; nenhuma data pessoal é necessária para provar a recorrência.
const input: AnnualDateInput = { kind: "birthday", label: "Amizade de teste", month: 9, day: 2, reminderLeadDays: 2 };
function entity(overrides: Partial<AnnualDateInput> = {}, envelope: Partial<MentorEntity<"generic.event">> = {}): MentorEntity<"generic.event"> {
  return { id: "annual-test-a", datasetId: "test", type: "generic.event", domain: "agenda", localDate: "2024-01-01", occurredAtUTC: "2024-01-01T12:00:00.000Z", timezone: "America/Sao_Paulo", schemaVersion: 1, revision: 1, source: "manual", status: "active", createdAt: "2024-01-01T12:00:00.000Z", updatedAt: "2024-01-01T12:00:00.000Z", payload: createAnnualDate({ ...input, ...overrides }), ...envelope };
}

for (const [month, day] of [[4, 31], [2, 30], [0, 2], [13, 2], [2.5, 2], [9, 0]]) {
  test(`rejeita data anual inexistente ${day}/${month}`, () => expect(() => createAnnualDate({ ...input, month, day })).toThrow());
}
test("zero de antecedência não vira ausência e campo vazio não vira zero", () => {
  expect(createAnnualDate({ ...input, reminderLeadDays: 0 }).reminderLeadDays).toEqual(known(0));
  expect(createAnnualDate({ ...input, reminderLeadDays: undefined }).reminderLeadDays.state).toBe("unknown");
  expect(createAnnualDate({ ...input, reminderLeadDays: null }).reminderLeadDays.state).toBe("not_applicable");
  expect(() => createAnnualDate({ ...input, reminderLeadDays: -1 })).toThrow();
  expect(() => createAnnualDate({ ...input, reminderLeadDays: 366 })).toThrow();
});
test("aniversário reaparece todo ano sem alterar a data de criação ou criar eventos", () => {
  const original = entity(); const before = JSON.stringify(original);
  const projection = projectAnnualDates([original], "2026-09-02", "2027-09-02");
  expect(projection.occurrences.map((item) => item.localDate)).toEqual(["2026-09-02", "2027-09-02"]);
  expect(projection.occurrences.every((item) => item.allDay && !item.blocksTime)).toBe(true);
  expect(projection.occurrences.map((item) => JSON.parse(item.key))).toEqual([["test", "annual-test-a", 2026], ["test", "annual-test-a", 2027]]);
  expect(JSON.stringify(original)).toBe(before);
});
test("as duas bordas da janela são inclusivas", () => {
  const sources = [entity({}, { id: "first" }), entity({ day: 3 }, { id: "second" }), entity({ day: 4 }, { id: "outside" })];
  expect(projectAnnualDates(sources, "2026-09-02", "2026-09-03").occurrences.map((item) => item.entityId)).toEqual(["first", "second"]);
});
test("o aviso de janeiro pode começar em dezembro sem alterar o aniversário", () => {
  const original = entity({ month: 1, day: 5, reminderLeadDays: 7 });
  const projected = projectAnnualDates([original], "2026-12-29", "2027-01-05").occurrences[0];
  expect(projected.localDate).toBe("2027-01-05"); expect(projected.noticeDate).toBe("2026-12-29");
  expect(annualDateAlerts([original], "2026-12-29")).toHaveLength(1);
  expect(annualDateAlerts([original], "2026-12-28")).toEqual([]);
  expect(annualDateAlerts([original], "2027-01-06")).toEqual([]);
});
test("29/02 distingue os séculos 1900, 2000 e 2100", () => {
  const leap = entity({ month: 2, day: 29, nonLeapYearPolicy: "mar01" });
  for (const [year, expected] of [[1900, "1900-03-01"], [2000, "2000-02-29"], [2100, "2100-03-01"]] as const) {
    expect(projectAnnualDates([leap], `${year}-01-01` as LocalDate, `${year}-12-31` as LocalDate).occurrences[0].localDate).toBe(expected);
  }
});
test("29/02 sem escolha permanece pendente em ano comum", () => {
  const leap = entity({ month: 2, day: 29, nonLeapYearPolicy: undefined });
  const common = projectAnnualDates([leap], "2027-01-01", "2027-12-31");
  expect(common.occurrences).toEqual([]); expect(common.pending.map((item) => item.year)).toEqual([2027]);
  expect(projectAnnualDates([leap], "2028-01-01", "2028-12-31").occurrences[0].localDate).toBe("2028-02-29");
  expect(annualDateAlerts([leap], "2027-02-28")).toEqual([]);
});
test("a escolha 28/02 é explícita e não modifica a definição", () => {
  const leap = entity({ month: 2, day: 29, nonLeapYearPolicy: "feb28" });
  const occurrence = projectAnnualDates([leap], "2027-01-01", "2027-12-31").occurrences[0];
  expect(occurrence.localDate).toBe("2027-02-28"); expect(occurrence.leapAdjusted).toBe(true);
  expect(leap.payload.day).toBe(29);
});
test("pausa, exclusão e domínio trocado não produzem ocorrências", () => {
  const sources = [entity({ recurrenceStatus: "paused" }), entity({}, { status: "deleted" }), entity({}, { domain: "sono" })];
  expect(projectAnnualDates(sources, "2026-01-01", "2026-12-31").occurrences).toEqual([]);
});
test("a última revisão vence mesmo quando ela desativa a data", () => {
  const original = entity(); const paused = entity({ recurrenceStatus: "paused" }, { revision: 2 });
  expect(projectAnnualDates([paused, original], "2026-01-01", "2026-12-31").occurrences).toEqual([]);
  expect(projectAnnualDates([original, paused], "2026-01-01", "2026-12-31").occurrences).toEqual([]);
});
test("datas simultâneas ficam separadas e não bloqueiam tempo", () => {
  const sources = [entity(), entity({ kind: "annual_commitment", label: "Compromisso sintético" }, { id: "annual-test-b" })];
  const occurrences = projectAnnualDates(sources, "2026-09-02", "2026-09-02").occurrences;
  expect(occurrences).toHaveLength(2); expect(occurrences.every((item) => item.blocksTime === false)).toBe(true);
});
test("definição anterior a um ano permanece operacional", () => {
  expect(selectOperationalWindow([entity()], "2025-09-03", "2026-09-02")).toHaveLength(1);
});
test("parser rejeita campos extras, texto excessivo e Knowledge adulterado", () => {
  const payload = createAnnualDate(input);
  expect(isAnnualDatePayload(payload)).toBe(true);
  expect(isAnnualDatePayload({ ...payload, privateBlob: {} })).toBe(false);
  expect(isAnnualDatePayload({ ...payload, label: "a".repeat(121) })).toBe(false);
  expect(isAnnualDatePayload({ ...payload, reminderLeadDays: { state: "known", value: 0, source: "user", callback: () => {} } })).toBe(false);
  expect(isAnnualDatePayload({ ...payload, note: { state: "known", source: "user", value: "a".repeat(1001) } })).toBe(false);
});
test("janela invertida, data inválida ou projeção sem limite é rejeitada", () => {
  expect(() => projectAnnualDates([entity()], "2026-09-03", "2026-09-02")).toThrow();
  expect(() => projectAnnualDates([entity()], "2026-02-30", "2026-09-02")).toThrow();
  expect(() => projectAnnualDates([entity()], "2020-01-01", "2040-01-01")).toThrow();
});
test("arrays não podem fingir ser enums ou estados de conhecimento", () => {
  const payload = createAnnualDate(input);
  for (const patch of [{ recurrenceStatus: ["active"] }, { kind: ["birthday"] }, { reminderLeadDays: { state: "known", source: ["user"], value: 0 } }, { reminderLeadDays: { state: "unknown", reason: ["not_provided"] } }]) expect(isAnnualDatePayload({ ...payload, ...patch })).toBe(false);
});
test("IDs com separador e datasets distintos não colidem", () => {
  const a = entity({}, { datasetId: "a:b", id: "c" }); const b = entity({}, { datasetId: "a", id: "b:c" });
  expect(projectAnnualDates([a, b], "2026-09-02", "2026-09-02").occurrences).toHaveLength(2);
  const sameIdOtherDataset = entity({}, { datasetId: "other", id: a.id });
  const keys = projectAnnualDates([a, sameIdOtherDataset], "2026-09-02", "2026-09-02").occurrences.map((item) => item.key);
  expect(new Set(keys).size).toBe(2);
});
