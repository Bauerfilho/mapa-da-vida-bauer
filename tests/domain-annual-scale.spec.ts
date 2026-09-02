import { expect, test } from "@playwright/test";
import { ANALYTICS_DOMAINS, buildAnalyticsReport } from "../src/domain";
import {
  ANNUAL_DATASET_ID,
  ANNUAL_DAY_COUNT,
  ANNUAL_END_DATE,
  ANNUAL_START_DATE,
  buildDeterministicAnnualDataset,
} from "./fixtures/annual-dataset";

const MEBIBYTE = 1024 * 1024;
const MAX_ANALYTICS_MILLISECONDS = 1_500;
const MAX_HEAP_GROWTH_BYTES = 128 * MEBIBYTE;
const MAX_DATASET_JSON_BYTES = 16 * MEBIBYTE;
const MAX_REPORT_JSON_BYTES = 4 * MEBIBYTE;

function metric(report: ReturnType<typeof buildAnalyticsReport>, domain: string, key: string) {
  const summary = report.domains[domain as keyof typeof report.domains];
  const result = summary.metrics.find((candidate) => candidate.key === key);
  if (!result) throw new Error(`Métrica ausente: ${domain}.${key}`);
  return result;
}

test("fixture anual é determinística, limitada e cobre os 13 domínios", () => {
  const first = buildDeterministicAnnualDataset();
  const second = buildDeterministicAnnualDataset();

  expect(first).toEqual(second);
  expect(first).toHaveLength(ANNUAL_DAY_COUNT * ANALYTICS_DOMAINS.length);
  expect(new Set(first.map(({ localDate }) => localDate)).size).toBe(ANNUAL_DAY_COUNT);
  expect(new Set(first.map(({ domain }) => domain)).size).toBe(ANALYTICS_DOMAINS.length);
  expect(first.at(0)?.localDate).toBe(ANNUAL_START_DATE);
  expect(first.at(-1)?.localDate).toBe(ANNUAL_END_DATE);
  expect(Buffer.byteLength(JSON.stringify(first), "utf8")).toBeLessThan(MAX_DATASET_JSON_BYTES);
});

test("analytics processa 365 dias com janela, n, missing, tempo e memória limitados", () => {
  const entities = buildDeterministicAnnualDataset();

  // Warm-up removes module/JIT initialization from the measured operation.
  buildAnalyticsReport(entities, {
    datasetId: ANNUAL_DATASET_ID,
    endLocalDate: ANNUAL_END_DATE,
    days: 7,
  });

  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const report = buildAnalyticsReport(entities, {
    datasetId: ANNUAL_DATASET_ID,
    endLocalDate: ANNUAL_END_DATE,
    days: 365,
  });
  const elapsedMilliseconds = performance.now() - startedAt;
  const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - heapBefore);

  expect(report.window).toEqual({ start: ANNUAL_START_DATE, end: ANNUAL_END_DATE, days: 365 });
  expect(report.n).toBe(ANNUAL_DAY_COUNT * ANALYTICS_DOMAINS.length);
  expect(report.observedDays).toBe(ANNUAL_DAY_COUNT);
  expect(report.missingDays).toBe(0);
  expect(Object.keys(report.domains)).toEqual([...ANALYTICS_DOMAINS]);

  for (const domain of ANALYTICS_DOMAINS) {
    expect(report.domains[domain]).toMatchObject({
      n: ANNUAL_DAY_COUNT,
      observedDays: ANNUAL_DAY_COUNT,
      missingDays: 0,
    });
  }

  // Energy is deliberately left unknown every tenth day: 37 missing, 328 known.
  expect(metric(report, "humor", "energy_average")).toMatchObject({ n: 328, missing: 37 });
  expect(metric(report, "humor", "short_sleep_high_energy_cooccurrence")).toMatchObject({
    n: 328,
    missing: 37,
  });

  expect(elapsedMilliseconds).toBeLessThan(MAX_ANALYTICS_MILLISECONDS);
  expect(heapGrowth).toBeLessThan(MAX_HEAP_GROWTH_BYTES);
  expect(Buffer.byteLength(JSON.stringify(report), "utf8")).toBeLessThan(MAX_REPORT_JSON_BYTES);
});

test("janela padrão de 60 dias não deixa registros anuais vazarem", () => {
  const report = buildAnalyticsReport(buildDeterministicAnnualDataset(), {
    datasetId: ANNUAL_DATASET_ID,
    endLocalDate: ANNUAL_END_DATE,
    days: 60,
  });

  expect(report.window).toEqual({ start: "2026-11-02", end: ANNUAL_END_DATE, days: 60 });
  expect(report.n).toBe(60 * ANALYTICS_DOMAINS.length);
  expect(report.observedDays).toBe(60);
  expect(report.missingDays).toBe(0);
  for (const domain of ANALYTICS_DOMAINS) {
    expect(report.domains[domain]).toMatchObject({ n: 60, observedDays: 60, missingDays: 0 });
  }
  expect(metric(report, "humor", "energy_average")).toMatchObject({ n: 54, missing: 6 });
});
