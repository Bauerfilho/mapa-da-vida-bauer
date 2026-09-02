import type { MentorEntity } from "./model";

/** Identifica o conflito sem confundir duas doses pelo nome ou por uma estimativa. */
export class MedicationSlotConflictError extends Error {
  readonly code = "MEDICATION_SLOT_CONFLICT";
  constructor(readonly incomingId: string, readonly occupyingId: string) {
    super("Esta dose já possui um registro. Abra o histórico para corrigi-lo.");
    this.name = "MedicationSlotConflictError";
  }
}

/** Só vínculo e horário explicitamente conhecidos ocupam um minuto do regime. */
export function medicationSlotKey(entity: MentorEntity): string | null {
  if (entity.type !== "medicamentos.confirmation" || entity.status !== "active") return null;
  const dose = entity as MentorEntity<"medicamentos.confirmation">;
  const regimen = dose.payload.regimenId;
  const scheduled = dose.payload.scheduledTimeLocal;
  if (regimen?.state !== "known" || scheduled?.state !== "known") return null;
  if (typeof regimen.value !== "string" || !regimen.value.trim() ||
      typeof scheduled.value !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(scheduled.value)) {
    throw new Error("O vínculo ou horário agendado da dose está inválido; nenhuma gravação foi aplicada.");
  }
  // A tupla serializada evita colisão entre IDs que contêm delimitadores.
  return JSON.stringify([entity.datasetId, regimen.value, entity.localDate, scheduled.value.slice(0, 5)]);
}

/** Valida o resultado do lote sem escolher arbitrariamente uma das confirmações. */
export function assertMedicationSlotsAvailable(
  incoming: readonly MentorEntity[],
  surviving: readonly MentorEntity[],
): void {
  const occupants = new Map<string, Set<string>>();
  for (const entity of surviving) {
    const key = medicationSlotKey(entity);
    if (key === null) continue;
    const ids = occupants.get(key) ?? new Set<string>();
    ids.add(entity.id);
    occupants.set(key, ids);
  }
  for (const entity of incoming) {
    const key = medicationSlotKey(entity);
    if (key === null) continue;
    const ids = occupants.get(key) ?? new Set<string>();
    const otherId = [...ids].find((id) => id !== entity.id);
    if (otherId !== undefined) throw new MedicationSlotConflictError(entity.id, otherId);
    ids.add(entity.id);
    occupants.set(key, ids);
  }
}
