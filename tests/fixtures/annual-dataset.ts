import {
  ANALYTICS_DOMAINS,
  confirmedAbsent,
  known,
  shiftLocalDate,
  unknown,
  type Domain,
  type GenericPayload,
  type LocalDate,
  type MentorEntity,
} from "../../src/domain";
import { buildLaboratoryPanel } from "../../src/domain/laboratory";

export const ANNUAL_DATASET_ID = "qa-annual-2026";
export const ANNUAL_START_DATE = "2026-01-01" as LocalDate;
export const ANNUAL_END_DATE = "2026-12-31" as LocalDate;
export const ANNUAL_DAY_COUNT = 365;

function payloadFor(domain: Domain, localDate: LocalDate, dayIndex: number): GenericPayload {
  const hour = (value: string) => known(`${localDate}T${value}`);
  const money = (amountMinor: number) => known({ amountMinor, currency: "BRL" });

  switch (domain) {
    case "exames": return buildLaboratoryPanel({ title: "Painel sintético anual", collectedOn: localDate, referenceDate: localDate, results: [{ analyte: "Analito de teste", value: String(10 + dayIndex % 4), kind: "numeric", unit: "unidade de teste" }] });
    case "internato":
      return {
        eventKind: "internship-shift",
        scheduledStartLocal: hour("07:00:00"),
        scheduledEndLocal: hour("13:00:00"),
        attendance: known("present"),
        arrivalLocal: hour(dayIndex % 4 === 0 ? "07:05:00" : "06:55:00"),
        departureLocal: hour("13:05:00"),
        breakStartLocal: hour("11:30:00"),
        breakEndLocal: hour("12:00:00"),
        topicsSeen: known(["Obstetrícia", `tema-${dayIndex % 12}`]),
      };
    case "estudos":
      return {
        eventKind: "study-session",
        actualDurationMinutes: known(35 + (dayIndex % 4) * 5),
        plannedDurationMinutes: known(40),
        completed: known(dayIndex % 9 !== 0),
        questions: { attempted: known(10), correct: known(6 + (dayIndex % 5)) },
      };
    case "medicamentos":
      return {
        eventKind: "medication-dose",
        confirmation: dayIndex % 17 === 0 ? "skipped_confirmed" : "taken_on_time",
        scheduledTimeLocal: known("08:00"),
        actualTimeLocal: dayIndex % 17 === 0 ? confirmedAbsent("skipped_confirmed") : known("08:04"),
        regimenId: known("qa-regimen-1"),
      };
    case "sono":
      return {
        eventKind: "sleep-chronology",
        chronology: {
          wentToBedLocal: known("22:30"),
          sleepOnsetLocal: known("23:00"),
          finalWakeLocal: known("06:30"),
          leftBedLocal: known("06:45"),
        },
        awakenings: known(1),
        awakeMinutes: known(20),
        napMinutes: known(dayIndex % 8 === 0 ? 25 : 0),
        perceivedQuality: known(3 + (dayIndex % 3)),
        restorative: known(dayIndex % 5 !== 0),
      };
    case "alimentacao":
      return {
        eventKind: "nutrition-log",
        presence: known(true),
        meal: { presence: known(true), kind: known("Almoço"), timeLocal: known("12:30") },
        waterMl: known(500 + (dayIndex % 4) * 250),
        caffeine: { servings: known(1), lastUseLocal: known("10:00") },
      };
    case "humor":
      return {
        eventKind: "mood-functional-check-in",
        scaleVersion: "mentor-functional-scales-v1",
        mood: known((dayIndex % 5) - 2),
        energy: dayIndex % 10 === 0 ? unknown("not_recorded") : known(dayIndex % 5),
        anxiety: known(dayIndex % 5),
        irritability: known(dayIndex % 4),
        impulsivity: known(dayIndex % 3),
        thoughtSpeed: known((dayIndex % 5) - 2),
        function: known(dayIndex % 5),
      };
    case "cefaleia": {
      const present = dayIndex % 7 === 0;
      return {
        eventKind: "headache-crisis",
        presence: present ? known(true) : confirmedAbsent("headache_absence_confirmed"),
        onsetLocal: present ? known("15:00") : confirmedAbsent("headache_absence_confirmed"),
        endedLocal: present ? known("16:30") : confirmedAbsent("headache_absence_confirmed"),
        intensityPeak: present ? known(4 + (dayIndex % 4)) : confirmedAbsent("headache_absence_confirmed"),
        disabilityMinutes: present ? known(30) : confirmedAbsent("headache_absence_confirmed"),
      };
    }
    case "bruxismo":
      return {
        eventKind: "bruxism-am-pm",
        morning: { jawPain: known(dayIndex % 5), stiffness: known(dayIndex % 4) },
        evening: { jawPain: known((dayIndex + 1) % 5), stiffness: known(dayIndex % 3) },
        morningSymptoms: known(dayIndex % 4 !== 0),
        functionalLimitation: known(dayIndex % 11 === 0),
        splintUsed: known(dayIndex % 2 === 0),
      };
    case "financas":
      return {
        eventKind: "finance-transaction",
        movementKind: known(dayIndex % 5 === 0 ? "income" : "expense"),
        amount: money(dayIndex % 5 === 0 ? 250_000 : 2_500 + (dayIndex % 20) * 100),
        institution: known(["Mercado Pago", "Banco do Brasil", "PicPay"][dayIndex % 3]),
      };
    case "rotina":
      return {
        eventKind: "routine-day-plan",
        anchors: [
          { kind: "wake", timeLocal: known("06:30"), completed: known(true) },
          { kind: "study", timeLocal: known("19:00"), completed: known(dayIndex % 6 !== 0) },
        ],
        blocks: [{ plannedMinutes: known(45), actualMinutes: known(40 + (dayIndex % 3) * 5), completed: known(true), replanned: known(dayIndex % 9 === 0) }],
        closure: { state: known("closed") },
      };
    case "agenda":
      return {
        eventKind: "agenda-event",
        plannedStartLocal: known(`${localDate}T14:00`),
        plannedEndLocal: known(`${localDate}T15:00`),
        bufferBeforeMinutes: known(10),
        bufferAfterMinutes: known(10),
        status: known("confirmed"),
      };
    case "ia":
      return {
        eventKind: "ai-tool-portfolio",
        toolName: known(`Ferramenta ${dayIndex % 6}`),
        project: known(`Projeto ${dayIndex % 4}`),
        subscription: { price: money(9_900), renewalDate: known(localDate) },
        deliveries: known(1 + (dayIndex % 3)),
        useCount: known(dayIndex % 8),
      };
    case "conhecimento":
      return {
        eventKind: "knowledge-capture",
        title: known(`Pérola ${dayIndex}`),
        capture: known("Conteúdo sintético sem informação de paciente."),
        nextReviewDate: known(localDate),
        reviewed: known(dayIndex % 3 !== 0),
        convertedToQuestion: known(dayIndex % 4 === 0),
      };
  }
}

export function buildDeterministicAnnualDataset(): MentorEntity<"generic.event">[] {
  const entities: MentorEntity<"generic.event">[] = [];
  for (let dayIndex = 0; dayIndex < ANNUAL_DAY_COUNT; dayIndex += 1) {
    const localDate = shiftLocalDate(ANNUAL_START_DATE, dayIndex);
    ANALYTICS_DOMAINS.forEach((domain, domainIndex) => {
      const occurredAtUTC = `${localDate}T${String(10 + (domainIndex % 10)).padStart(2, "0")}:00:00.000Z`;
      entities.push({
        id: `qa-${localDate}-${domain}`,
        datasetId: ANNUAL_DATASET_ID,
        domain,
        type: "generic.event",
        localDate,
        occurredAtUTC,
        timezone: "America/Sao_Paulo",
        schemaVersion: 1,
        revision: 1,
        source: "manual",
        status: "active",
        createdAt: occurredAtUTC,
        updatedAt: occurredAtUTC,
        payload: payloadFor(domain, localDate, dayIndex),
      });
    });
  }
  return entities;
}
