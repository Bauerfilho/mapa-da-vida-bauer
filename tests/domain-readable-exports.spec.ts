import { expect, test } from "@playwright/test";
import { createJsonExport, createCsvExport, csvCell } from "../src/data/exports";
import { isMentorEntityCandidate } from "../src/data/backup";
import { buildClinicianReportPreview, createConfirmedClinicianReport } from "../src/features/clinicianReportPlanning";
import { createLaboratoryAttachment, buildLaboratoryPanel, verifyLaboratoryAttachments } from "../src/domain/laboratory";
import { known, unknown, type Domain, type MentorEntity } from "../src/domain";

const datasetId = "export-synthetic";
const filter = { startLocalDate: "2026-08-26", endLocalDate: "2026-09-01", domains: ["humor"] as Domain[] };
const selection = { referenceLocalDate: "2026-09-01", windowDays: 7 as const, domains: ["humor"] as const };

function entity(id: string, domain: Domain, payload: Record<string, unknown>, localDate = "2026-09-01"): MentorEntity {
  return {
    id, datasetId, domain, type: "generic.event", localDate,
    occurredAtUTC: `${localDate}T12:00:00.000Z`, timezone: "America/Sao_Paulo",
    schemaVersion: 1, revision: 1, source: "manual", status: "active",
    createdAt: `${localDate}T12:00:00.000Z`, updatedAt: `${localDate}T12:00:00.000Z`, payload,
  } as MentorEntity;
}

// Leitor diagnóstico próprio: separadores dentro de aspas continuam na mesma célula.
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\r" || char === "\n") {
      row.push(cell); rows.push(row); row = []; cell = "";
      if (char === "\r" && source[index + 1] === "\n") index += 1;
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  expect(quoted).toBe(false);
  return rows;
}

async function laboratoryEntity() {
  const attachment = await createLaboratoryAttachment(new File([
    "%PDF-1.4\n%ANEXO_EXCLUSIVAMENTE_SINTETICO_EXPORTACAO\n",
  ], "anexo-sintetico.pdf", { type: "application/pdf" }));
  const payload = buildLaboratoryPanel({
    title: "Painel sintético", collectedOn: "2026-09-01", referenceDate: "2026-09-02",
    results: [{ analyte: "Analito sintético", value: "0,0000004", kind: "numeric", unit: "u/L" }],
    attachments: [attachment],
  });
  await verifyLaboratoryAttachments(payload);
  const record = entity("laboratory", "exames", payload);
  expect(isMentorEntityCandidate(record, datasetId)).toBe(true);
  return { record, attachment };
}

test("controle: filtros inclusivos, domínio e exclusão preservam o original", async () => {
  const rows = [
    entity("inside", "humor", { eventKind: "mood-functional-check-in", context: known("dentro") }),
    entity("boundary", "humor", { context: known("borda") }, "2026-08-26"),
    entity("outside", "humor", { context: known("fora") }, "2026-08-25"),
    entity("finance", "financas", { note: known("NAO_SELECIONADO") }),
    { ...entity("deleted", "humor", { context: known("EXCLUIDO") }), status: "deleted" as const },
  ];
  const before = JSON.stringify(rows);
  const json = JSON.parse(await createJsonExport(rows, filter).text());
  expect(json.recordCount).toBe(2);
  expect(json.records.map((row: { date: string }) => row.date).sort()).toEqual(["2026-08-26", "2026-09-01"]);
  expect(csvRows(await createCsvExport(rows, filter).text())).toHaveLength(3);
  expect(JSON.stringify(json)).not.toContain("NAO_SELECIONADO");
  expect(JSON.stringify(json)).not.toContain("EXCLUIDO");
  expect(JSON.stringify(rows)).toBe(before);
});

test("controle: CSV mantém aspas, vírgula, quebra de linha e fórmula dentro de JSON", async () => {
  const text = '=1+1, "aspas"\r\n<img src=x onerror=alert(1)>';
  const rows = [entity("quoting", "humor", { eventKind: "mood-functional-check-in", context: known(text) })];
  const parsed = csvRows(await createCsvExport(rows, filter).text());
  expect(parsed).toHaveLength(2);
  expect(parsed[1]).toHaveLength(7);
  expect(parsed[1][6]).toMatch(/^\{/);
  expect(JSON.parse(parsed[1][6]).context).toBe(text);
  expect(JSON.parse(await createJsonExport(rows, filter).text()).records[0].values.context).toBe(text);
});

test("controle: relatório usa texto idêntico à prévia e declara ausência de cifra", async () => {
  const rows = [entity("plain", "humor", { eventKind: "mood-functional-check-in", energy: known(2), context: known("<b>texto literal</b>") })];
  const preview = buildClinicianReportPreview(rows, selection);
  const report = createConfirmedClinicianReport(rows, selection, true);
  expect(report.blob.type).toBe("text/plain;charset=utf-8");
  expect(await report.blob.text()).toBe(preview.contentText);
  expect(preview.contentText).toContain("texto sem criptografia");
  expect(preview.contentText).toContain("<b>texto literal</b>");
  expect(() => createConfirmedClinicianReport(rows, selection, false)).toThrow();
});

test("controle: relatório TXT não incorpora o corpo do anexo", async () => {
  const { record, attachment } = await laboratoryEntity();
  const report = createConfirmedClinicianReport([record], { ...selection, domains: ["exames"] }, true);
  const text = await report.blob.text();
  expect(text).toContain("Documentos originais guardados: 1");
  expect(text).not.toContain(attachment.dataBase64);
  expect(text).not.toContain("ANEXO_EXCLUSIVAMENTE_SINTETICO_EXPORTACAO");
  expect(typeof globalThis.indexedDB).toBe("undefined");
});

test("exports legíveis preservam os anexos e declaram a ausência de cifra", async () => {
  const { record, attachment } = await laboratoryEntity();
  const json = JSON.parse(await createJsonExport([record]).text());
  const csv = csvRows(await createCsvExport([record]).text());
  const csvPayload = JSON.parse(csv[1][6]);
  expect(json.records[0].values.attachments[0]).toHaveProperty("dataBase64", attachment.dataBase64);
  expect(json.note).toContain("sem criptografia");
  expect(json.note).toContain("documentos");
  expect(csvPayload.attachments[0]).toHaveProperty("dataBase64", attachment.dataBase64);
});

test("payload genérico válido não vira fórmula no CSV nem perde campos no JSON", async () => {
  const record = entity("root-state", "conhecimento", {
    eventKind: "knowledge-note", summary: known("Nota sintética"), state: "known", value: "=1+1",
  });
  expect(isMentorEntityCandidate(record, datasetId)).toBe(true);
  const csv = csvRows(await createCsvExport([record]).text());
  expect.soft(csv[1][6]).not.toMatch(/^[=+@-]/);
  const json = JSON.parse(await createJsonExport([record]).text());
  expect.soft(json.records[0].values).toHaveProperty("eventKind", "knowledge-note");
});

test("relatório não mistura check-in de energia 1–5 com funcional 0–4", async () => {
  const standard = [4, 5].map((energy) => ({
    ...entity(`energy-${energy}`, "humor", { energy, scaleVersion: "energy-1-5-v1", note: unknown("not_recorded") }),
    type: "humor.energy-check-in" as const,
  } as MentorEntity));
  for (const record of standard) expect(isMentorEntityCandidate(record, datasetId)).toBe(true);
  const functional = entity("functional", "humor", { eventKind: "mood-functional-check-in", scaleVersion: "mentor-functional-scales-v1", energy: known(2) });
  const preview = buildClinicianReportPreview([...standard, functional], selection);
  expect(preview.recordCount).toBe(3);
  expect.soft(preview.contentText).not.toContain("Energia: 3,0 (0 a 4) (n=2)");
  expect(preview.contentText).toContain("Energia rápida: 4,5 (1 a 5) (n=2)");
  expect(preview.contentText).toContain("Energia funcional: 2,0 (0 a 4) (n=1)");
  expect(preview.contentText).toContain("energia rápida 5/5");
  expect(preview.contentText).toContain("energia funcional 2/4");
});

test("objetos com state, metadados adicionais e raiz parecida com Knowledge não perdem campos", async () => {
  const rows = [entity("business", "conhecimento", {
    state: "known", value: "=1+1", eventKind: "knowledge-note", extra: "preservado",
    nested: { state: "active", total: 4 },
    future: { state: "known", value: "texto", evidence: "não perder" },
    ordinary: known("valor legível"),
  }), entity("bare", "conhecimento", { state: "known", value: "=2+2" })];
  const before = JSON.stringify(rows);
  const exported = JSON.parse(await createJsonExport(rows).text()).records;
  expect(exported[0].values).toMatchObject({ state: "known", value: "=1+1", extra: "preservado", nested: { state: "active", total: 4 }, future: { state: "known", value: "texto", evidence: "não perder" }, ordinary: "valor legível" });
  expect(exported[1].values).toEqual({ state: "known", value: "=2+2" });
  expect(JSON.stringify(rows)).toBe(before);
});

test("codificador CSV neutraliza fórmulas textuais sem mudar negativos numéricos ou aspas", () => {
  for (const text of ["=1+1", "+SUM(A1)", "-2+3", "@SUM(A1)", "\t=1+1", "\r=1+1", "  =1+1", "\ufeff=1+1", "\u00a0+SUM(A1)"]) {
    expect(csvRows(csvCell(text))[0][0]).toBe(`'${text}`);
  }
  expect(csvRows(csvCell(-2))[0][0]).toBe("-2");
  expect(csvRows(csvCell('Texto, "literal"\r\nlinha'))[0][0]).toBe('Texto, "literal"\r\nlinha');
});

test("estado não conhecido de um envelope não ressuscita valor legado residual", async () => {
  const secret = "VALOR_RESIDUAL_SINTETICO_NAO_EXPORTAR";
  const record = entity("residual", "conhecimento", { eventKind: "knowledge-note", note: { state: "unknown", reason: "not_recorded", value: secret, source: "user" }, obsolete: { state: "not_applicable", reasonCode: "not_used", value: secret } });
  const json = await createJsonExport([record]).text(); const csv = await createCsvExport([record]).text();
  expect(json).not.toContain(secret); expect(csv).not.toContain(secret);
  expect(JSON.parse(json).records[0].values.note).toBe("não registrado");
});

for (const [state, leftovers] of [
  ["unknown", { reason: "withheld", reasonCode: "estado_anterior" }],
  ["confirmed_absent", { reasonCode: "ausencia", reason: "estado_anterior" }],
  ["not_applicable", { reasonCode: "nao_se_aplica", issueCodes: ["estado_anterior"] }],
  ["invalid", { issueCodes: ["invalido"], reason: "estado_anterior" }],
] as const) {
  test(`estado ${state} prevalece sobre sobras reconhecidas de outros estados`, async () => {
    const secret = `RESIDUAL_SINTETICO_${state}`;
    const record = entity("cross-state", "humor", { eventKind: "mood-functional-check-in", scaleVersion: "mentor-functional-scales-v1", context: { state, ...leftovers, value: secret, source: "user" } });
    expect(isMentorEntityCandidate(record, datasetId)).toBe(true);
    expect(await createJsonExport([record]).text()).not.toContain(secret);
    expect(await createCsvExport([record]).text()).not.toContain(secret);
  });
}

test("envelope não conhecido ambíguo bloqueia a saída legível sem apagar o original", () => {
  const record = entity("ambiguous", "humor", { eventKind: "mood-functional-check-in", context: { state: "unknown", reason: "withheld", value: "RESIDUAL_SINTETICO", futureMetadata: "não classificada" } });
  const before = JSON.stringify(record);
  expect(() => createJsonExport([record])).toThrow("ambíguo");
  expect(() => createCsvExport([record])).toThrow("ambíguo");
  expect(JSON.stringify(record)).toBe(before);
});

test("rótulos reservados de protótipo não viram função nem somem do export", async () => {
  const record = entity("reserved", "conhecimento", { eventKind: "constructor", text: known("texto sintético") });
  const json = JSON.parse(await createJsonExport([record]).text());
  expect(json.records[0].event).toBe("Conhecimento");
  expect(csvRows(await createCsvExport([record]).text())[1][3]).toBe("Conhecimento");
});

test("legado, versão ausente e metadados contraditórios não entram em média de outra escala", () => {
  const functional = entity("functional-zero", "humor", { eventKind: "mood-functional-check-in", scaleVersion: "mentor-functional-scales-v1", energy: known(0), mood: known(-2) });
  const legacy = entity("legacy", "humor", { eventKind: "mood-check-in", scaleVersion: "mood-1-5-v1", mood: known(5) });
  const missing = entity("missing", "humor", { eventKind: "mood-functional-check-in", energy: known(4), mood: known(2) });
  const quick = { ...entity("quick", "humor", { eventKind: "mood-functional-check-in", scaleVersion: "energy-1-5-v1", energy: 5 }), type: "humor.energy-check-in" as const } as MentorEntity;
  const wrongVersion = { ...entity("wrong-version", "humor", { scaleVersion: "mentor-functional-scales-v1", energy: 4 }), type: "humor.energy-check-in" as const } as MentorEntity;
  const unclassified = entity("unclassified", "humor", { eventKind: "other-check-in", energy: known(3) });
  const text = buildClinicianReportPreview([functional, legacy, missing, quick, wrongVersion, unclassified], selection).contentText;
  expect(text).toContain("Energia rápida: 5,0 (1 a 5) (n=1)");
  expect(text).toContain("Energia funcional: 0,0 (0 a 4) (n=1)");
  expect(text).toContain("Humor: -2,0 (-2 a +2) (n=1)");
  expect(text).toContain("Humor legado: 5,0 (1 a 5) (n=1)");
  expect(text).toContain("energia funcional 4 (valor bruto; escala não confirmada");
  expect(text).toContain("humor legado 5/5");
  expect(text).toContain("energia rápida 4 (valor bruto; escala não confirmada");
  expect(text).toContain("energia 3 (valor bruto; escala não confirmada");
});
