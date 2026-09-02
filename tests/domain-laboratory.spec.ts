import { expect, test } from "@playwright/test";
import {
  buildLaboratoryPanel, buildLaboratorySeries, isLaboratoryPanelPayload,
  laboratorySearchText, verifyLaboratoryAttachments,
  formatLaboratoryNumber,
  formatLaboratoryReference,
} from "../src/domain/laboratory";
import type { MentorEntity } from "../src/domain/model";

const example = () => ({
  title: "Controle sintético", collectedOn: "2026-09-01", referenceDate: "2026-09-02",
  results: [{ analyte: "Hemoglobina", value: "12,8", kind: "numeric" as const, unit: "g/dL", referenceLow: "12", referenceHigh: "16" }],
});

test("resultado numérico preserva vírgula, unidade e referência informada", () => {
  const panel = buildLaboratoryPanel(example());
  expect(panel.results[0].value).toEqual({ state: "known", value: { kind: "numeric", value: 12.8, comparator: "eq" }, source: "user" });
  expect(panel.results[0].unit).toEqual({ state: "known", value: "g/dL", source: "user" });
  expect(panel.collectedOn).toBe("2026-09-01");
  expect(isLaboratoryPanelPayload(panel)).toBe(true);
});

test("vazio continua desconhecido e zero explícito continua zero", () => {
  const panel = buildLaboratoryPanel({ ...example(), results: [
    { analyte: "A", value: "", kind: "numeric" },
    { analyte: "B", value: "0", kind: "numeric", unit: "mg/L" },
  ] });
  expect(panel.results[0].value.state).toBe("unknown");
  expect(panel.results[0].unit.state).toBe("unknown");
  expect(panel.results[1].value).toMatchObject({ state: "known", value: { value: 0 } });
});

test("comparador é preservado sem converter limite em valor exato", () => {
  const panel = buildLaboratoryPanel({ ...example(), results: [{ analyte: "A", kind: "numeric", value: "< 0,5", unit: "mg/L" }] });
  expect(panel.results[0].value).toMatchObject({ value: { value: 0.5, comparator: "lt" } });
});

test("resultado textual não é promovido a número ou diagnóstico", () => {
  const panel = buildLaboratoryPanel({ ...example(), results: [{ analyte: "Cultura", value: "Não houve crescimento", kind: "text" }] });
  expect(panel.results[0].value).toMatchObject({ state: "known", value: { kind: "text", value: "Não houve crescimento" } });
});

for (const invalid of ["NaN", "Infinity", "1,2,3", "1.234,50", "1e999"]) {
  test(`rejeita número ambíguo ou inválido: ${invalid}`, () => {
    expect(() => buildLaboratoryPanel({ ...example(), results: [{ analyte: "A", value: invalid, kind: "numeric" }] })).toThrow();
  });
}

test("coleta inválida ou futura não é corrigida pelo calendário", () => {
  expect(() => buildLaboratoryPanel({ ...example(), collectedOn: "2026-02-30" })).toThrow();
  expect(() => buildLaboratoryPanel({ ...example(), collectedOn: "2026-09-03" })).toThrow();
});

test("emissão não pode anteceder a coleta nem estar no futuro", () => {
  expect(() => buildLaboratoryPanel({ ...example(), reportedOn: "2026-08-31" })).toThrow();
  expect(() => buildLaboratoryPanel({ ...example(), reportedOn: "2026-09-03" })).toThrow();
});

test("não aceita intervalo invertido nem painel vazio", () => {
  expect(() => buildLaboratoryPanel({ ...example(), results: [{ ...example().results[0], referenceLow: "17", referenceHigh: "12" }] })).toThrow();
  expect(() => buildLaboratoryPanel({ ...example(), results: [] })).toThrow();
});

test("laudo original pode ser guardado antes de transcrever os analitos", () => {
  const panel = buildLaboratoryPanel({ ...example(), results: [], attachments: [{ id: "a", name: "teste.pdf", mimeType: "application/pdf", size: 8, dataBase64: "JVBERi0xLjQ=", sha256: "0".repeat(64) }] });
  expect(panel.results).toEqual([]);
  expect(panel.attachments).toHaveLength(1);
});

test("payload restaurado é validado sem coerção de tipos", () => {
  const panel = buildLaboratoryPanel(example());
  expect(isLaboratoryPanelPayload({ ...panel, collectedOn: "2026-02-30" })).toBe(false);
  expect(isLaboratoryPanelPayload({ ...panel, results: [panel.results[0], panel.results[0]] })).toBe(false);
  expect(isLaboratoryPanelPayload({ ...panel, attachments: [{ data: {} }] })).toBe(false);
});

test("campos extras não escapam do contrato JSON-safe de laboratório", () => {
  const panel = buildLaboratoryPanel(example());
  expect(isLaboratoryPanelPayload({ ...panel, extraFile: new Blob(["não serializável"]) })).toBe(false);
  expect(isLaboratoryPanelPayload({ ...panel, results: [{ ...panel.results[0], rawFile: {} }] })).toBe(false);
});

function entity(id: string, date: string, value: string, unit = "g/dL"): MentorEntity {
  return {
    id, datasetId: "synthetic-lab", domain: "exames", type: "generic.event", localDate: date,
    occurredAtUTC: `${date}T12:00:00Z`, createdAt: `${date}T12:00:00Z`, updatedAt: `${date}T12:00:00Z`,
    timezone: "America/Sao_Paulo", schemaVersion: 1, revision: 1, status: "active", source: "manual",
    payload: buildLaboratoryPanel({ ...example(), collectedOn: date, results: [{ analyte: "Hemoglobina", kind: "numeric", value, unit }] }),
  } as MentorEntity;
}

test("série deixa lacunas reais e não mistura unidades nem valores censurados", () => {
  const series = buildLaboratorySeries([
    entity("a", "2026-08-31", "12,0"), entity("b", "2026-09-02", "13,0"),
    entity("c", "2026-09-01", "120", "g/L"), entity("d", "2026-09-01", "<12"),
  ], { analyte: "hemoglobina", unit: "g/dL", endLocalDate: "2026-09-02", days: 3 });
  expect(series.points.map((point) => point.value)).toEqual([12, null, 13]);
  expect(series.sampleSize).toBe(2);
  expect(series.missingDays).toBe(1);
  expect(series.excludedCensored).toBe(1);
  expect(series.points[0].entityIds).toEqual(["a"]);
});

test("série exclui registros apagados, outra pessoa/conjunto e revisão superada", () => {
  const first = entity("a", "2026-09-01", "12");
  const current = { ...entity("a", "2026-09-01", "13"), revision: 2 };
  const deleted = { ...entity("b", "2026-09-02", "14"), status: "deleted" as const };
  const other = { ...entity("c", "2026-09-02", "15"), datasetId: "other" };
  const series = buildLaboratorySeries([first, current, deleted, other], { analyte: "Hemoglobina", unit: "g/dL", endLocalDate: "2026-09-02", days: 2, datasetId: "synthetic-lab" });
  expect(series.sampleSize).toBe(1);
  expect(series.points.map((point) => point.value)).toEqual([13, null]);
});

test("maiúsculas da unidade não são confundidas com prefixos de outra escala", () => {
  const series = buildLaboratorySeries([entity("a", "2026-09-01", "2", "mIU/L"), entity("b", "2026-09-01", "3", "MIU/L")], { analyte: "Hemoglobina", unit: "mIU/L", endLocalDate: "2026-09-02", days: 2 });
  expect(series.sampleSize).toBe(1);
  expect(series.points[0].value).toBe(2);
});

test("número pequeno não vira zero e sua forma editável faz round-trip", () => {
  const value = formatLaboratoryNumber(0.0000004);
  expect(value).toBe("0,0000004");
  const panel = buildLaboratoryPanel({ ...example(), results: [{ analyte: "Teste de precisão", kind: "numeric", value, unit: "u" }] });
  expect(panel.results[0].value).toMatchObject({ value: { value: 0.0000004 } });
});

test("referências unilaterais permanecem visíveis sem inventar outra extremidade", () => {
  const upper = buildLaboratoryPanel({ ...example(), results: [{ analyte: "A", value: "1", kind: "numeric", referenceHigh: "15" }] });
  const lower = buildLaboratoryPanel({ ...example(), results: [{ analyte: "B", value: "1", kind: "numeric", referenceLow: "0,0000004" }] });
  expect(formatLaboratoryReference(upper.results[0])).toContain("superior informado: 15");
  expect(formatLaboratoryReference(lower.results[0])).toContain("inferior informado: 0,0000004");
});

test("pesquisa indexa metadados do laudo, nunca os bytes base64", () => {
  const panel = buildLaboratoryPanel(example());
  const text = laboratorySearchText(panel);
  expect(text).toContain("Hemoglobina");
  expect(text).toContain("Controle sintético");
  expect(text).not.toContain("dataBase64");
});

test("hash adulterado de anexo impede aprovação dos bytes", async () => {
  const panel = buildLaboratoryPanel(example());
  panel.attachments.push({ id: "a", name: "teste.pdf", mimeType: "application/pdf", size: 8, dataBase64: "JVBERi0xLjQ=", sha256: "0".repeat(64) });
  expect(isLaboratoryPanelPayload(panel)).toBe(true);
  await expect(verifyLaboratoryAttachments(panel)).rejects.toThrow(/integridade/i);
});
