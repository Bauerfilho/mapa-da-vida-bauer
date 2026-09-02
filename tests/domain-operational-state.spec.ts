import { expect, test } from "@playwright/test";
import { buildAnalyticsReport } from "../src/domain/analytics";
import { selectOperationalWindow } from "../src/domain/operationalState";
import { known, type MentorEntity } from "../src/domain/model";

function oldEntity(id: string, type: MentorEntity["type"], payload: Record<string, unknown>): MentorEntity {
  return { id, type, payload, datasetId: "synthetic", domain: "financas", localDate: "2024-01-01", occurredAtUTC: "2024-01-01T12:00:00Z", createdAt: "2024-01-01T12:00:00Z", updatedAt: "2024-01-01T12:00:00Z", revision: 1, schemaVersion: 1, source: "manual", status: "active", timezone: "America/Sao_Paulo" } as MentorEntity;
}

test("obrigações canônica e legada antigas seguem vivas, sem virar fluxo ou atividade", () => {
  const entities = [
    oldEntity("canonical", "financas.bill", { title: "Teste A", amount: known({ amountMinor: 2000, currency: "BRL" }), dueDate: known("2026-09-04"), status: "open" }),
    oldEntity("legacy", "generic.event", { eventKind: "finance-bill", amount: known({ amountMinor: 1234, currency: "BRL" }), dueDate: known("2026-09-04"), status: "open" }),
    oldEntity("past-spending", "generic.event", { eventKind: "finance-transaction", movementKind: "expense", amount: known({ amountMinor: 999999, currency: "BRL" }) }),
  ];
  const selected = selectOperationalWindow(entities, "2026-07-05", "2026-09-02");
  const report = buildAnalyticsReport(selected, { endLocalDate: "2026-09-02", days: 60 });
  expect(report.domains.financas.metrics.find((metric) => metric.key === "obligations_30d_minor")?.value).toBe(3234);
  expect(report.n).toBe(0);
  expect(report.activity.weekly).toEqual([]);
  expect(selected.some((entity) => entity.id === "past-spending")).toBe(false);
});

test("quitação explícita de obrigação legada exclui o valor futuro", () => {
  const paid = oldEntity("paid", "generic.event", { eventKind: "finance-bill", amount: known({ amountMinor: 1234, currency: "BRL" }), dueDate: known("2026-09-04"), status: "paid" });
  const report = buildAnalyticsReport([paid], { endLocalDate: "2026-09-02", days: 60 });
  expect(report.domains.financas.metrics.find((metric) => metric.key === "obligations_30d_minor")?.n).toBe(0);
});

test("regimes fora da vigência não criam horários desconhecidos", () => {
  const base = { ...oldEntity("regimen", "generic.event", {}), domain: "medicamentos" as const };
  const make = (id: string, status: string, from: string, through?: string) => ({ ...base, id, payload: {
    schema: "medication-regimen-v2", eventKind: "medication-regimen", status,
    medicationName: known("Registro sintético"), doseLabel: known("dose de teste"), scheduledTimesLocal: known(["08:00"]),
    activeFromLocalDate: known(from), activeThroughLocalDate: through ? known(through) : { state: "unknown", reason: "not_provided" }, note: { state: "unknown", reason: "not_recorded" },
  } }) as MentorEntity;
  for (const regimen of [make("ended", "finished_confirmed", "2024-01-01", "2025-01-01"), make("paused", "paused_confirmed", "2024-01-01"), make("future", "active_confirmed", "2027-01-01")]) {
    const report = buildAnalyticsReport([regimen], { endLocalDate: "2026-09-02", days: 60 });
    expect(report.domains.medicamentos.metrics.find((metric) => metric.key === "planned_dose_slots")?.n).toBe(0);
  }
});
