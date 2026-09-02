import type { LocalDate, MentorEntity } from "./model";

// Uma definição pode começar antes do painel e continuar produzindo horários ou obrigações.
// A seleção mantém a definição; quem a consome ainda precisa conferir seu estado e vigência.
const durableTypes = new Set([
  "financas.account", "financas.bill", "financas.debt", "financas.budget",
  "financas.goal", "financas.card", "agenda.task", "agenda.goal-set",
]);

export function isOperationalDefinition(entity: MentorEntity): boolean {
  if (durableTypes.has(entity.type)) return true;
  if (entity.type !== "generic.event") return false;
  const payload = entity.payload as Record<string, unknown>;
  return (entity.domain === "medicamentos" && payload.eventKind === "medication-regimen") ||
    (entity.domain === "financas" && ["finance-subscription", "finance-bill", "finance-debt"].includes(String(payload.eventKind))) ||
    (entity.domain === "agenda" && payload.schema === "agenda-annual-date-v1") ||
    (entity.domain === "conhecimento" && payload.schema === "clinical-reference-personal-v1");
}

// Fatos antigos continuam fora do período; definições vigentes não são apagadas pelo filtro.
export function selectOperationalWindow(
  entities: readonly MentorEntity[], start: LocalDate, end?: LocalDate,
): MentorEntity[] {
  return entities.filter((entity) => entity.status === "active" && (
    (entity.localDate >= start && (end === undefined || entity.localDate <= end)) ||
    isOperationalDefinition(entity)
  ));
}
