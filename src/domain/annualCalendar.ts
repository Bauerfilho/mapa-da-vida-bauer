import { APP_TIME_ZONE, type LocalDate, type MentorEntity } from "./model";
import { assertLocalDate, shiftLocalDate } from "./dates";
import { projectAnnualDates } from "./annualDates";

// Serializador autoral a partir dos contratos de intercâmbio RFC 5545 e RFC 7986.
// Não há conexão com calendário, conta, notificações push ou serviço de sincronização.
export function calendarText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}
export function foldCalendarLine(value: string): string {
  const encoder = new TextEncoder(); const lines: string[] = []; let line = ""; let bytes = 0;
  for (const character of value) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) { lines.push(line); line = " "; bytes = 1; }
    line += character; bytes += size;
  }
  lines.push(line); return lines.join("\r\n");
}
function calendarInstant(instant: string | number): string {
  const date = new Date(instant); if (!Number.isFinite(date.getTime())) throw new Error("A revisão precisa de um instante válido para exportar.");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// Converte 09h civis do fuso escolhido em um instante UTC; não soma nove horas a uma meia-noite.
export function calendarAlarmUTC(date: LocalDate, timeZone: string = APP_TIME_ZONE): string {
  assertLocalDate(date); const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, 9);
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  let candidate = target;
  for (let iteration = 0; iteration < 4; iteration++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    if (observed === target) return calendarInstant(candidate);
    candidate += target - observed;
  }
  throw new Error("O calendário não conseguiu resolver 09h neste fuso e nesta data.");
}
async function calendarUID(datasetId: string, entityId: string, year: number): Promise<string> {
  // Identificador estável e opaco: não expõe nomes nem os identificadores internos no arquivo.
  const bytes = new TextEncoder().encode(JSON.stringify([datasetId, entityId]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}-${year}`;
}
export async function buildAnnualCalendar(entities: readonly MentorEntity[], options: { start: LocalDate; end: LocalDate; timeZone?: string }) {
  const projection = projectAnnualDates(entities, options.start, options.end);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mentor Bauer//Datas anuais//PT-BR", "CALSCALE:GREGORIAN"];
  let pastAlarmsOmitted = 0;
  for (const item of projection.occurrences) {
    const uid = await calendarUID(item.datasetId, item.entityId, item.year);
    const stamp = calendarInstant(item.updatedAt);
    lines.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`, `SEQUENCE:${Math.max(0, item.sourceRevision - 1)}`, `DTSTART;VALUE=DATE:${item.localDate.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${shiftLocalDate(item.localDate, 1).replace(/-/g, "")}`, "TRANSP:TRANSPARENT", "CLASS:PRIVATE", `SUMMARY:${calendarText(item.title)}`);
    if (item.noticeDate && item.noticeDate >= options.start) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER;VALUE=DATE-TIME:${calendarAlarmUTC(item.noticeDate, options.timeZone ?? APP_TIME_ZONE)}`, `DESCRIPTION:${calendarText(item.title)}`, "END:VALARM");
    else if (item.noticeDate) pastAlarmsOmitted++;
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const text = lines.map(foldCalendarLine).join("\r\n") + "\r\n";
  if (new TextEncoder().encode(text).length > 1_000_000) throw new Error("O calendário excedeu 1 MB. Exporte uma janela menor.");
  return { text, count: projection.occurrences.length, pending: projection.pending, pastAlarmsOmitted, start: options.start, end: options.end };
}
