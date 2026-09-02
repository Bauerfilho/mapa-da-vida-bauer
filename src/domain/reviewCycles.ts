import { assertLocalDate, calendarDayCount, inclusiveDateWindow, shiftLocalDate } from "./dates";
import type { InclusiveDateWindow, LocalDate } from "./model";

export interface ReviewCycle { id: string; label: string; periodStart: LocalDate; periodEnd: LocalDate; totalDays: number; elapsedDays: number; current: boolean; clipped: boolean; window: InclusiveDateWindow; }
const shortMonths = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function cycleStart(index: number): LocalDate { const year = Math.floor(index / 6); const month = (index - year * 6) * 2 + 1; const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01` as LocalDate; assertLocalDate(date); return date; }

// Bimestres civis são estáveis entre aparelhos e backups; nenhum registro é zerado ou regravado.
export function reviewCycles(reference: LocalDate): ReviewCycle[] {
  assertLocalDate(reference);
  const [year, month] = reference.split("-").map(Number);
  const index = year * 6 + Math.floor((month - 1) / 2);
  const retained = inclusiveDateWindow(reference, 365);
  const cycles: ReviewCycle[] = [];
  for (let offset = 0; offset <= 6; offset++) {
    const periodStart = cycleStart(index - offset); const periodEnd = shiftLocalDate(cycleStart(index - offset + 1), -1);
    if (periodEnd < retained.start) continue;
    const start = periodStart < retained.start ? retained.start : periodStart;
    const end = periodEnd > reference ? reference : periodEnd;
    const targetMonth = Number(periodStart.slice(5, 7));
    cycles.push({ id: periodStart.slice(0, 7), label: `${shortMonths[targetMonth - 1]}–${shortMonths[targetMonth]} ${periodStart.slice(0, 4)}`, periodStart, periodEnd, totalDays: calendarDayCount(periodStart, periodEnd), elapsedDays: calendarDayCount(periodStart, end), current: offset === 0, clipped: start !== periodStart, window: { start, end, days: calendarDayCount(start, end) } });
  }
  return cycles;
}
