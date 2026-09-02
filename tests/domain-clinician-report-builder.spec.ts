import { expect, test } from "@playwright/test";
import {
  confirmedAbsent,
  known,
  unknown,
  type Domain,
  type LocalDate,
  type MentorEntity,
} from "../src/domain";
import {
  buildClinicianReportPreview,
  CLINICIAN_REPORT_DEFAULT_DOMAINS,
  CLINICIAN_REPORT_WINDOWS,
  createConfirmedClinicianReport,
  type ClinicianReportSelection,
  type ClinicianReportWindowDays,
} from "../src/features/clinicianReportPlanning";

function entity(
  id: string,
  domain: Domain,
  localDate: LocalDate,
  payload: Record<string, unknown>,
  status: MentorEntity["status"] = "active",
): MentorEntity<"generic.event"> {
  return {
    id,
    datasetId: "private-bauer",
    domain,
    type: "generic.event",
    localDate,
    occurredAtUTC: `${localDate}T12:00:00.000Z`,
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision: 1,
    source: "manual",
    status,
    createdAt: `${localDate}T12:00:00.000Z`,
    updatedAt: `${localDate}T12:00:00.000Z`,
    payload,
  };
}

function selection(
  windowDays: ClinicianReportWindowDays = 7,
  domains: ClinicianReportSelection["domains"] = ["sono", "humor"],
): ClinicianReportSelection {
  return {
    referenceLocalDate: "2026-09-01",
    windowDays,
    domains,
  };
}

test("supports only the five explicit inclusive clinician windows", () => {
  const expectedStarts: Record<ClinicianReportWindowDays, LocalDate> = {
    7: "2026-08-26",
    30: "2026-08-03",
    60: "2026-07-04",
    180: "2026-03-06",
    365: "2025-09-02",
  };

  expect(CLINICIAN_REPORT_WINDOWS).toEqual([7, 30, 60, 180, 365]);
  for (const windowDays of CLINICIAN_REPORT_WINDOWS) {
    const preview = buildClinicianReportPreview([], selection(windowDays));
    expect(preview.startLocalDate).toBe(expectedStarts[windowDays]);
    expect(preview.endLocalDate).toBe("2026-09-01");
    expect(preview.daysWithoutAnySelectedRecord).toBe(windowDays);
  }
  expect(() => buildClinicianReportPreview([], selection(14 as ClinicianReportWindowDays))).toThrow(
    "precisa ser 7, 30, 60, 180 ou 365",
  );
});

test("starts with no clinician domain selected", () => {
  expect(CLINICIAN_REPORT_DEFAULT_DOMAINS).toEqual([]);
});

test("previews records and record-free days without calling missing days absence", () => {
  const payload = {
    duration: known(420),
    nested: [{ quality: known(4) }],
  };
  const preview = buildClinicianReportPreview([
    entity("sleep", "sono", "2026-09-01", payload),
    entity("mood", "humor", "2026-09-01", { mood: known(3) }),
    entity("outside", "sono", "2026-08-25", { duration: known(400) }),
    entity("deleted", "sono", "2026-08-31", { duration: known(390) }, "deleted"),
    entity("food", "alimentacao", "2026-08-31", { meal: known("almoço") }),
  ], selection());

  expect(preview.recordCount).toBe(2);
  expect(preview.daysWithAnyRecord).toBe(1);
  expect(preview.daysWithoutAnySelectedRecord).toBe(6);
  expect(preview.hasExportableData).toBe(true);
  expect(preview.byDomain).toEqual([
    expect.objectContaining({
      domain: "sono",
      recordCount: 1,
      daysWithRecords: 1,
      daysWithoutRecords: 6,
    }),
    expect.objectContaining({
      domain: "humor",
      recordCount: 1,
      daysWithRecords: 1,
      daysWithoutRecords: 6,
    }),
  ]);
});

test("requires explicit confirmation and at least one selected domain", () => {
  expect(() => createConfirmedClinicianReport([], selection(), false)).toThrow(
    "Confirme a revisão de privacidade",
  );
  expect(() => createConfirmedClinicianReport([], selection(7, []), true)).toThrow(
    "Selecione pelo menos um domínio",
  );
  expect(() => createConfirmedClinicianReport([], selection(), true)).toThrow(
    "Não há registros",
  );
});

test("generates a local blob with the chosen title and domains only", async () => {
  const entities = [
    entity("food", "alimentacao", "2026-09-01", { meal: known("almoço") }),
    entity("finance", "financas", "2026-09-01", { balance: known("segredo") }),
  ];
  const report = createConfirmedClinicianReport(entities, {
    ...selection(30, ["alimentacao"]),
    title: "  Resumo para consulta  ",
  }, true);
  const text = await report.blob.text();

  expect(report.fileName).toBe("mentor-bauer-relatorio-2026-09-01-30d.txt");
  expect(report.options).toEqual({
    startLocalDate: "2026-08-03",
    endLocalDate: "2026-09-01",
    domains: ["alimentacao"],
    title: "Resumo para consulta",
  });
  expect(report.preview.recordCount).toBe(1);
  expect(text).toContain("Resumo para consulta");
  expect(text).toContain("ALIMENTAÇÃO");
  expect(text).toContain("Ausência de registro não significa ausência de sintoma");
  expect(text).not.toContain("FINANÇAS");
  expect(text).not.toContain("segredo");
});

test("renders clinician-readable summaries, scale legends and factual timelines without raw payload keys", async () => {
  const entities = [
    entity("regimen", "medicamentos", "2026-07-15", {
      schema: "medication-regimen-v2",
      eventKind: "medication-regimen",
      medicationName: known("Medicamento A"),
      doseLabel: known("50 mg"),
      scheduledTimesLocal: known(["08:00", "20:00"]),
      status: "active_confirmed",
      activeFromLocalDate: known("2026-07-15"),
      activeThroughLocalDate: known("2026-12-31"),
    }),
    entity("dose", "medicamentos", "2026-09-01", {
      eventKind: "medication-dose",
      medicationName: known("Medicamento A"),
      doseLabel: known("50 mg"),
      scheduledTimeLocal: known("08:00"),
      actualTimeLocal: known("08:05"),
      confirmation: "taken_time_recorded",
    }),
    entity("sleep", "sono", "2026-09-01", {
      eventKind: "sleep-chronology",
      chronology: {
        wentToBedLocal: known("22:30"),
        sleepOnsetLocal: known("23:00"),
        finalWakeLocal: known("07:00"),
        leftBedLocal: known("07:15"),
      },
      awakeMinutes: known(20),
      awakenings: known(2),
      napMinutes: known(0),
      perceivedQuality: known(4),
      restorative: known(true),
    }),
    entity("food", "alimentacao", "2026-09-01", {
      eventKind: "nutrition-log",
      meal: { kind: known("Almoço"), timeLocal: known("12:30"), composition: known("arroz, feijão e proteína") },
      waterMl: known(1_500),
      hungerBefore: known(3),
      fullnessAfter: known(4),
    }),
    entity("mood", "humor", "2026-09-01", {
      eventKind: "mood-functional-check-in",
      mood: known(-1),
      energy: known(2),
      anxiety: known(3),
      function: known(2),
      perceivedSleepNeed: known("more_than_usual"),
      perceivedBaselineChange: known("below_usual"),
      protectiveFactors: known(["Pessoa de confiança", "Ambiente seguro"]),
      protectiveFactorsNote: known("consulta já combinada"),
      medicationChangeConfirmed: known(true),
      medicationChangeNote: known("mudança informada pelo usuário"),
      safeNow: known(false),
      context: known("após plantão"),
    }),
    entity("headache", "cefaleia", "2026-09-01", {
      eventKind: "headache-crisis",
      presence: known(true),
      onsetLocal: known("14:00"),
      endedLocal: known("16:00"),
      intensityCurrent: known(4),
      intensityPeak: known(7),
      suspectedTriggers: known(["sono curto"]),
      rescueUsed: known("medida informada pelo usuário"),
      response: known(2),
    }),
    entity("headache-absent", "cefaleia", "2026-08-31", {
      eventKind: "headache-crisis",
      presence: confirmedAbsent("headache_absence_confirmed"),
    }),
    entity("brux", "bruxismo", "2026-09-01", {
      eventKind: "bruxism-am-pm",
      morning: { jawPain: known(2), templePain: known(1), stiffness: known(3), dentalSensitivity: known(0) },
      evening: { jawPain: known(1), templePain: known(0), stiffness: known(2), dentalSensitivity: known(0) },
      daytimeClenching: known(true),
      guardUsed: confirmedAbsent("guard_not_used_confirmed"),
    }),
  ];
  const report = createConfirmedClinicianReport(entities, {
    referenceLocalDate: "2026-09-01",
    windowDays: 60,
    domains: ["medicamentos", "sono", "alimentacao", "humor", "cefaleia", "bruxismo"],
  }, true);
  const text = await report.blob.text();

  expect(text).toContain("Como ler: n é a quantidade de registros");
  expect(text).toContain("Regimes consolidados");
  expect(text).toContain("Medicamento A — dose transcrita: 50 mg; horários informados: 08:00, 20:00");
  expect(text).toContain("tomada com horário real registrado");
  expect(text).toContain("sono total estimado 460 min");
  expect(text).toContain("Eficiência usa apenas registros completos");
  expect(text).toContain("fome e saciedade usam escala autorreferida 0–5");
  expect(text).toContain("humor -2=muito baixo");
  expect(text).toContain("não classificam depressão, mania, hipomania");
  expect(text).toContain("necessidade percebida de sono maior que o habitual");
  expect(text).toContain("mudança percebida do basal: abaixo do habitual");
  expect(text).toContain("apoios percebidos: Pessoa de confiança, Ambiente seguro");
  expect(text).toContain("mudança medicamentosa confirmada pelo usuário: mudança informada pelo usuário");
  expect(text).toContain("segurança no momento do registro: não (resposta do usuário)");
  expect(text).toContain("Responder ‘sim’ à pergunta de segurança não prova ausência de risco");
  expect(text).toContain("responder ‘não’ não constitui diagnóstico");
  expect(text).toContain("não monitora continuamente e não envia alertas");
  expect(text).toContain("Gatilhos suspeitos anotados pelo usuário: sono curto (1). Esta lista não estabelece causalidade.");
  expect(text).toContain("ausência de cefaleia confirmada pelo usuário");
  expect(text).toContain("Uso de placa é apenas um fato informado, não uma medida de adesão");
  expect(text).toContain("Cronologia factual:");
  expect(text).not.toContain("chronology.wentToBedLocal");
  expect(text).not.toContain("eventKind");
  expect(text).not.toContain("confirmed_absent");
  expect(text).not.toContain("[object Object]");
});

test("uses the exact reviewed plaintext for the confirmed blob", async () => {
  const entities = [
    entity("sleep", "sono", "2026-09-01", {
      eventKind: "sleep-chronology",
      durationMinutes: known(420),
      perceivedQuality: known(4),
    }),
  ];
  const selected = selection(7, ["sono"]);
  const preview = buildClinicianReportPreview(entities, selected);
  const report = createConfirmedClinicianReport(entities, selected, true);

  expect(await report.blob.text()).toBe(preview.contentText);
  expect(preview.contentText).toContain("Bauer Vieira");
  expect(preview.contentText).toContain("Período: 2026-08-26 a 2026-09-01");
  expect(preview.contentText).toContain("texto sem criptografia");
  expect(preview.contentText).toContain("pode armazenar ou sincronizar uma cópia");
});

test("canonical unknown values block later legacy aliases from entering plaintext", () => {
  const legacySecret = "SEGREDO_ALIAS_LEGADO_NAO_EXPORTAR";
  const preview = buildClinicianReportPreview([
    entity("sleep", "sono", "2026-09-01", {
      eventKind: "sleep-chronology",
      chronology: {
        sleepOnsetLocal: unknown("not_recorded"),
      },
      sleepOnsetLocal: known(legacySecret),
      perceivedQuality: unknown("not_recorded"),
      quality: known(5),
    }),
  ], selection(7, ["sono"]));

  expect(preview.contentText).not.toContain(legacySecret);
  expect(preview.contentText).not.toContain("Qualidade percebida média 5,0/5");
});

test("excludes medication regimens dated outside the selected window", async () => {
  const outsideName = "REGIME_ANTIGO_FORA_DA_JANELA";
  const entities = [
    entity("old-regimen", "medicamentos", "2026-07-01", {
      schema: "medication-regimen-v2",
      eventKind: "medication-regimen",
      medicationName: known(outsideName),
      activeFromLocalDate: known("2026-07-01"),
      activeThroughLocalDate: known("2026-12-31"),
      status: "active_confirmed",
    }),
    entity("dose", "medicamentos", "2026-09-01", {
      eventKind: "medication-dose",
      medicationName: known("Medicamento dentro da janela"),
      confirmation: "taken_time_unknown",
    }),
  ];
  const selected = selection(7, ["medicamentos"]);
  const preview = buildClinicianReportPreview(entities, selected);
  const report = createConfirmedClinicianReport(entities, selected, true);

  expect(preview.recordCount).toBe(1);
  expect(preview.contentText).not.toContain(outsideName);
  expect(await report.blob.text()).toBe(preview.contentText);
  expect(preview.contentText).toContain("esquemas datados fora da janela escolhida não foram incorporados");
});

test("omits out-of-range values and unknown enum tokens", () => {
  const unknownEnum = "ENUM_INTERNO_SECRETO";
  const preview = buildClinicianReportPreview([
    entity("mood", "humor", "2026-09-01", {
      eventKind: "mood-functional-check-in",
      mood: known(99),
      energy: known(-5),
      perceivedSleepNeed: known(unknownEnum),
    }),
    entity("headache", "cefaleia", "2026-09-01", {
      eventKind: "headache-crisis",
      presence: known(true),
      intensityCurrent: known(99),
      intensityPeak: known(-1),
      response: known(12),
    }),
    entity("dose", "medicamentos", "2026-09-01", {
      eventKind: "medication-dose",
      medicationName: known("Medicamento A"),
      confirmation: unknownEnum,
    }),
  ], selection(7, ["humor", "cefaleia", "medicamentos"]));

  expect(preview.contentText).not.toContain("humor +99");
  expect(preview.contentText).not.toContain("energia -5");
  expect(preview.contentText).not.toContain("99/10");
  expect(preview.contentText).not.toContain("-1/10");
  expect(preview.contentText).not.toContain("12/4");
  expect(preview.contentText).not.toContain(unknownEnum);
  expect(preview.contentText).toContain("necessidade percebida de sono 0/1");
  expect(preview.contentText).toContain("valor omitido");
});

test("renders safety yes/no as user reports while v1 and unanswered stay unknown", () => {
  const preview = buildClinicianReportPreview([
    entity("yes", "humor", "2026-08-29", {
      schema: "mood-functional-check-in-v2",
      eventKind: "mood-functional-check-in",
      medicationChangeConfirmed: known(true),
      safeNow: known(true),
    }),
    entity("no", "humor", "2026-08-30", {
      schema: "mood-functional-check-in-v2",
      eventKind: "mood-functional-check-in",
      medicationChangeConfirmed: known(false),
      safeNow: known(false),
    }),
    entity("unknown", "humor", "2026-08-31", {
      schema: "mood-functional-check-in-v2",
      eventKind: "mood-functional-check-in",
      medicationChangeConfirmed: unknown("not_confirmed"),
      safeNow: unknown("not_confirmed"),
    }),
    entity("historical", "humor", "2026-09-01", {
      schema: "mood-functional-check-in-v1",
      eventKind: "mood-functional-check-in",
    }),
  ], selection(7, ["humor"]));

  expect(preview.contentText).toContain("segurança no momento do registro: sim (resposta do usuário)");
  expect(preview.contentText).toContain("segurança no momento do registro: não (resposta do usuário)");
  expect(preview.contentText).toContain("segurança no momento 2/4");
  expect(preview.contentText).toContain("mudança medicamentosa confirmada pelo usuário (sem detalhe registrado)");
  expect(preview.contentText).toContain("nenhuma mudança medicamentosa informada (resposta do usuário)");
  expect(preview.contentText).toContain("Responder ‘sim’ à pergunta de segurança não prova ausência de risco");
  expect(preview.contentText).not.toContain("2026-08-31 — segurança no momento");
  expect(preview.contentText).not.toContain("2026-09-01 — segurança no momento");
});
