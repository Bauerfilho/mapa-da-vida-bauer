export interface AbortableTransaction {
  abort: () => void;
  done: Promise<unknown>;
}

export type TransactionCompletionObservation = Promise<
  | { status: "fulfilled" }
  | { status: "rejected"; reason: unknown }
>;

/**
 * Observes `transaction.done` immediately and never rejects by itself. This
 * prevents a late IndexedDB request failure from becoming a second,
 * unhandled rejection while the original request error is propagated.
 */
export function observeTransactionCompletion(
  transaction: AbortableTransaction,
): TransactionCompletionObservation {
  return transaction.done.then(
    () => ({ status: "fulfilled" }) as const,
    (reason: unknown) => ({ status: "rejected", reason }) as const,
  );
}

export async function assertObservedTransactionCompleted(
  completion: TransactionCompletionObservation,
): Promise<void> {
  const result = await completion;
  if (result.status === "rejected") throw result.reason;
}

/**
 * Aborts an IndexedDB transaction atomically while consuming the expected
 * rejected completion promise. The rejection handler is installed before
 * `abort()` so browsers cannot surface a transient `unhandledrejection`.
 */
export async function abortTransactionSafely(
  transaction: AbortableTransaction,
  observedCompletion?: TransactionCompletionObservation,
): Promise<void> {
  const completion = observedCompletion ?? observeTransactionCompletion(transaction);
  transaction.abort();
  await completion;
}
