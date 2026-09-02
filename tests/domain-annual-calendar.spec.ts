import { expect, test } from "@playwright/test";
import { buildAnnualCalendar, foldCalendarLine, calendarText, calendarAlarmUTC } from "../src/domain/annualCalendar";
import { createAnnualDate } from "../src/domain/annualDates";
import type { MentorEntity } from "../src/domain/model";

const source = (): MentorEntity<"generic.event"> => ({ id: "event-7b4d04c0-928b-4d76-9ca1-3dc2e4da0000", datasetId: "synthetic", domain: "agenda", type: "generic.event", localDate: "2026-09-02", occurredAtUTC: "2026-09-02T12:00:00.000Z", timezone: "America/Sao_Paulo", schemaVersion: 1, revision: 1, source: "manual", status: "active", createdAt: "2026-09-02T12:00:00.000Z", updatedAt: "2026-09-02T12:00:00.000Z", payload: createAnnualDate({ kind: "birthday", label: "Pessoa sintética", month: 12, day: 31, reminderLeadDays: 7, note: "Nota privada que não vai ao calendário." }) });
test("evento de dia inteiro termina no dia seguinte sem bloquear horário", async () => {
  const result = await buildAnnualCalendar([source()], { start: "2026-09-02", end: "2027-09-02" });
  expect(result.count).toBe(1);
  expect(result.text).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101");
  expect(result.text).toContain("TRANSP:TRANSPARENT"); expect(result.text).not.toContain("RRULE");
  expect(result.text).not.toContain("Nota privada"); expect(result.text).not.toContain("TZID=");
});
test("alarmes absolutos correspondem a 09h de Brasília na data escolhida", async () => {
  expect(calendarAlarmUTC("2026-12-24", "America/Sao_Paulo")).toBe("20261224T120000Z");
  const result = await buildAnnualCalendar([source()], { start: "2026-09-02", end: "2027-09-02" });
  expect(result.text).toContain("TRIGGER;VALUE=DATE-TIME:20261224T120000Z");
  expect(result.text).toContain("ACTION:DISPLAY"); expect(result.text).toContain("DESCRIPTION:Pessoa sintética");
  expect(result.text).not.toContain("RELATED=");
});
test("fuso com transição calcula nove horas civis, não nove horas após meia-noite", () => {
  expect(calendarAlarmUTC("2026-03-07", "America/New_York")).toBe("20260307T140000Z");
  expect(calendarAlarmUTC("2026-03-08", "America/New_York")).toBe("20260308T130000Z");
  expect(() => calendarAlarmUTC("2026-09-02", "fuso/inexistente")).toThrow();
});
test("aviso desconhecido ou desativado não cria VALARM", async () => {
  for (const reminderLeadDays of [undefined, null]) {
    const item = source(); item.payload = createAnnualDate({ kind: "birthday", label: "Teste", month: 9, day: 2, reminderLeadDays });
    expect((await buildAnnualCalendar([item], { start: "2026-09-02", end: "2026-09-02" })).text).not.toContain("VALARM");
  }
});
test("dois downloads sem alteração preservam UID, sequência e DTSTAMP", async () => {
  const item = source(); const options = { start: "2026-09-02", end: "2027-09-02" } as const;
  const first = await buildAnnualCalendar([item], options); const second = await buildAnnualCalendar([item], options);
  expect(first).toEqual(second); expect(first.text).toContain("SEQUENCE:0"); expect(first.text).toContain("DTSTAMP:20260902T120000Z");
  item.revision = 2; item.updatedAt = "2026-09-03T18:22:00.000Z";
  const revised = await buildAnnualCalendar([item], options);
  expect(first.text.match(/^UID:(.+)$/m)?.[1]).toBe(revised.text.match(/^UID:(.+)$/m)?.[1]);
  expect(revised.text).toContain("SEQUENCE:1"); expect(revised.text).toContain("DTSTAMP:20260903T182200Z");
  expect(revised.text).not.toContain(item.id); expect(revised.text).not.toContain(item.datasetId);
});
test("homônimos não dividem o identificador", async () => {
  const first = source(); const second = { ...source(), id: "different-id" };
  const { text } = await buildAnnualCalendar([first, second], { start: "2026-09-02", end: "2027-09-02" });
  const ids = [...text.matchAll(/^UID:(.+)$/gm)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(2);
});
test("escapes evitam injeção de eventos sem apagar pontuação", () => {
  expect(calendarText("A\\B,C;D:E\r\nBEGIN:VEVENT")).toBe("A\\\\B\\,C\\;D:E\\nBEGIN:VEVENT");
});
test("folding respeita 75 octetos sem dividir Unicode", () => {
  for (const value of ["A".repeat(75), "A".repeat(76), "SUMMARY:" + "Olá ✨".repeat(40)]) {
    const folded = foldCalendarLine(value);
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(value);
    expect(folded).not.toContain("�");
  }
});
test("29/02 só exporta substituição previamente escolhida", async () => {
  const item = source(); item.payload = createAnnualDate({ kind: "birthday", label: "Bissexto", month: 2, day: 29 });
  const pending = await buildAnnualCalendar([item], { start: "2027-01-01", end: "2028-12-31" });
  expect(pending.pending).toHaveLength(1); expect(pending.count).toBe(1); expect(pending.text).toContain("DTSTART;VALUE=DATE:20280229");
  item.payload = createAnnualDate({ kind: "birthday", label: "Bissexto", month: 2, day: 29, nonLeapYearPolicy: "feb28" });
  const complete = await buildAnnualCalendar([item], { start: "2027-01-01", end: "2028-12-31" });
  expect(complete.count).toBe(2); expect(complete.text).toContain("DTSTART;VALUE=DATE:20270228");
});
