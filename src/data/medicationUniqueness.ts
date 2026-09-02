import type { MentorEntity } from "../domain";
import { assertMedicationSlotsAvailable, medicationSlotKey } from "../domain/medicationUniqueness";
import { abortTransactionSafely, type AbortableTransaction } from "./transactionSafety";

/** Aceita a transação do chamador: nunca abre uma leitura fora da escrita protegida. */
interface MedicationWriteTransaction extends AbortableTransaction {
  objectStore(name: "entities"): {
    index(name: "by_dataset_type_date"): {
      getAll(key: [string, "medicamentos.confirmation", string]): Promise<MentorEntity[]>;
    };
  };
}

/** Barreira comum à gravação, edição, restauração, desfazer e importação. */
export async function assertMedicationSlotInTransaction(
  transaction: MedicationWriteTransaction,
  entity: MentorEntity,
): Promise<void> {
  try {
    if (medicationSlotKey(entity) === null) return;
    const occupants = await transaction.objectStore("entities").index("by_dataset_type_date")
      .getAll([entity.datasetId, "medicamentos.confirmation", entity.localDate]);
    assertMedicationSlotsAvailable([entity], occupants);
  } catch (error) {
    // Lançar uma exceção JS não desfaz inserções já enfileiradas no mesmo lote.
    try { await abortTransactionSafely(transaction); }
    catch (abortError) {
      // Um erro nativo de IndexedDB pode ter abortado a transação antes desta proteção.
      if (!(abortError instanceof DOMException && abortError.name === "InvalidStateError")) throw abortError;
      await transaction.done.catch(() => undefined);
    }
    throw error;
  }
}
