import { expect, test } from "@playwright/test";
import {
  rememberPendingDeliveryReceipt,
  type BackupDeliveryReceipt,
} from "../src/data/backup";
import { abortTransactionSafely } from "../src/data/transactionSafety";

test("collision exhaustion aborts once and consumes the rejected transaction completion", async () => {
  let abortCalls = 0;
  let rejectionObserverInstalled = false;
  const done = {
    then<TResult1 = unknown, TResult2 = never>(
      onFulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      rejectionObserverInstalled = true;
      return Promise.reject(new Error("AbortError")).then(onFulfilled, onRejected);
    },
  } as unknown as Promise<unknown>;
  const transaction = {
    abort() {
      expect(rejectionObserverInstalled).toBe(true);
      abortCalls += 1;
    },
    done,
  };

  await expect(abortTransactionSafely(transaction)).resolves.toBeUndefined();
  expect(abortCalls).toBe(1);
});

test("backup delivery receipts remain confirmable out of order within a bounded window", () => {
  const receipts = new Map<string, BackupDeliveryReceipt>();
  const makeReceipt = (
    datasetId: string,
    sequence: number,
  ): BackupDeliveryReceipt => ({
    datasetId,
    exportedAt: `2026-09-01T12:00:0${sequence}.000Z`,
    checksumSHA256: sequence.toString(16).padStart(64, datasetId === "dataset-a" ? "a" : "b"),
  });

  const older = makeReceipt("dataset-a", 1);
  const newer = makeReceipt("dataset-a", 2);
  rememberPendingDeliveryReceipt(receipts, older, 2);
  rememberPendingDeliveryReceipt(receipts, newer, 2);
  rememberPendingDeliveryReceipt(receipts, makeReceipt("dataset-b", 1), 2);

  expect(receipts.has(older.checksumSHA256)).toBe(true);
  expect(receipts.has(newer.checksumSHA256)).toBe(true);

  const newest = makeReceipt("dataset-a", 3);
  rememberPendingDeliveryReceipt(receipts, newest, 2);
  expect(receipts.has(older.checksumSHA256)).toBe(false);
  expect(receipts.has(newer.checksumSHA256)).toBe(true);
  expect(receipts.has(newest.checksumSHA256)).toBe(true);
  expect(Array.from(receipts.values()).some((receipt) => receipt.datasetId === "dataset-b"))
    .toBe(true);
});
