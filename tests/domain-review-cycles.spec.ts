import { expect, test } from "@playwright/test";
import { reviewCycles } from "../src/domain/reviewCycles";

test("bimestre atual vai do primeiro dia até hoje, sem inventar dias futuros", () => {
  const current = reviewCycles("2026-09-02")[0];
  expect(current).toMatchObject({ id: "2026-09", periodStart: "2026-09-01", periodEnd: "2026-10-31", totalDays: 61, elapsedDays: 2, current: true, window: { start: "2026-09-01", end: "2026-09-02", days: 2 } });
});
test("a virada bimestral inicia uma janela nova, preservando ciclos anteriores", () => {
  expect(reviewCycles("2026-10-31")[0].window.days).toBe(61);
  const next = reviewCycles("2026-11-01");
  expect(next[0]).toMatchObject({ id: "2026-11", window: { start: "2026-11-01", end: "2026-11-01", days: 1 } });
  expect(next.find((cycle) => cycle.id === "2026-09")?.window.days).toBe(61);
});
test("janeiro-fevereiro respeita anos comuns e bissextos", () => {
  expect(reviewCycles("2027-02-28")[0].totalDays).toBe(59);
  expect(reviewCycles("2028-02-29")[0].totalDays).toBe(60);
  expect(reviewCycles("2100-02-28")[0].totalDays).toBe(59);
});
test("ciclo antigo respeita exatamente a janela disponível de 365 dias", () => {
  const cycles = reviewCycles("2026-09-02");
  const oldest = cycles.at(-1)!;
  expect(oldest).toMatchObject({ id: "2025-09", clipped: true, window: { start: "2025-09-03", end: "2025-10-31", days: 59 } });
  expect(cycles.every((cycle) => cycle.window.start >= "2025-09-03" && cycle.window.end <= "2026-09-02")).toBe(true);
});
test("virada de ano mantém os identificadores e rótulos do ano correto", () => {
  const cycles = reviewCycles("2027-01-01");
  expect(cycles[0].id).toBe("2027-01"); expect(cycles[1].id).toBe("2026-11");
  expect(cycles[0].label).toContain("2027"); expect(cycles[1].label).toContain("2026");
});
test("consulta determinística não depende do relógio da máquina", () => {
  expect(reviewCycles("2026-09-02")).toEqual(reviewCycles("2026-09-02"));
  expect(() => reviewCycles("2026-02-30")).toThrow();
});
