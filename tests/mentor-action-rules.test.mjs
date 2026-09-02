import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, "..");
const outputDirectory = mkdtempSync(join(tmpdir(), "mentor-action-rules-"));

execFileSync(join(projectRoot, "node_modules", ".bin", "tsc"), [
  "--ignoreConfig",
  "--target", "ES2022",
  "--module", "commonjs",
  "--strict",
  "--skipLibCheck",
  "--outDir", outputDirectory,
  join(projectRoot, "src", "domain", "model.ts"),
  join(projectRoot, "src", "domain", "dates.ts"),
  join(projectRoot, "src", "domain", "analytics.ts"),
], { cwd: projectRoot, stdio: "pipe" });

const require = createRequire(import.meta.url);
const analytics = require(join(outputDirectory, "analytics.js"));

test.after(() => rmSync(outputDirectory, { recursive: true, force: true }));

const known = (value) => ({ state: "known", value, source: "user" });
const unknown = (reason = "not_recorded") => ({ state: "unknown", reason });

let sequence = 0;
function entity({
  domain,
  type = "generic.event",
  localDate = "2026-09-01",
  payload,
}) {
  const occurredAtUTC = `${localDate}T12:00:00.000Z`;
  return {
    id: `mentor-action-${++sequence}`,
    datasetId: "bauer-personal-primary",
    domain,
    type,
    localDate,
    occurredAtUTC,
    timezone: "America/Sao_Paulo",
    schemaVersion: 1,
    revision: 1,
    source: "manual",
    status: "active",
    createdAt: occurredAtUTC,
    updatedAt: occurredAtUTC,
    payload,
  };
}

function septemberDate(day) {
  return `2026-09-${String(day).padStart(2, "0")}`;
}

function actionsFor(entities, days = 30, endLocalDate = "2026-09-30") {
  return analytics.buildAnalyticsReport(entities, {
    endLocalDate,
    days,
    datasetId: "bauer-personal-primary",
  }).nextActions;
}

function actionByDomain(actions, domain, metricKey) {
  return actions.find((action) =>
    action.domain === domain && action.evidence.metricKey === metricKey
  );
}

function assertInspectableEvidence(action) {
  assert.ok(action, "expected next action");
  assert.ok(action.evidence.window.days > 0);
  assert.ok(Number.isInteger(action.evidence.n));
  assert.ok(Number.isInteger(action.evidence.missing));
  assert.ok(Array.isArray(action.evidence.inferences));
  assert.ok(action.evidence.inferences.length > 0);
  assert.equal(
    action.evidence.limits,
    "no_diagnosis_no_causality_no_medication_change",
  );
  assert.match(action.reason, /Limite de inferência:/);
}

test("nutrition action requires a repeated, timestamped operational pattern", () => {
  const caffeine = [19, 20, 15].map((hour, index) => entity({
    domain: "alimentacao",
    localDate: septemberDate(index + 1),
    payload: {
      eventKind: "caffeine-entry",
      caffeine: { timeLocal: known(`${String(hour).padStart(2, "0")}:00`) },
    },
  }));
  const action = actionByDomain(
    actionsFor(caffeine),
    "alimentacao",
    "late_caffeine_events",
  );
  assertInspectableEvidence(action);
  assert.deepEqual(
    { value: action.evidence.value, n: action.evidence.n, missing: action.evidence.missing },
    { value: 2, n: 3, missing: 0 },
  );

  const insufficient = actionByDomain(
    actionsFor(caffeine.slice(0, 2)),
    "alimentacao",
    "late_caffeine_events",
  );
  assert.equal(insufficient, undefined);
});

test("mood action is gated at fourteen paired sleep-energy days and stays non-causal", () => {
  const paired = Array.from({ length: 14 }, (_, index) => {
    const localDate = septemberDate(index + 1);
    return [
      entity({
        domain: "sono",
        localDate,
        payload: { eventKind: "sleep-episode", totalSleepMinutes: known(330) },
      }),
      entity({
        domain: "humor",
        type: "humor.energy-check-in",
        localDate,
        payload: {
          eventKind: "energy-check-in",
          scaleVersion: "energy-1-5-v1",
          energy: known(index < 2 ? 4 : 2),
        },
      }),
    ];
  }).flat();

  const action = actionByDomain(
    actionsFor(paired, 14, "2026-09-14"),
    "humor",
    "short_sleep_high_energy_cooccurrence",
  );
  assertInspectableEvidence(action);
  assert.equal(action.evidence.n, 14);
  assert.equal(action.evidence.value, 2);
  assert.match(action.reason, /não é diagnóstico, causalidade nem indica ajuste de medicação/);

  const insufficient = actionByDomain(
    actionsFor(paired.slice(0, 26), 14, "2026-09-14"),
    "humor",
    "short_sleep_high_energy_cooccurrence",
  );
  assert.equal(insufficient, undefined);
});

test("headache and bruxism actions organize review without clinical interpretation", () => {
  const headaches = [1, 2, 3].map((day) => entity({
    domain: "cefaleia",
    localDate: septemberDate(day),
    payload: {
      eventKind: "headache-crisis",
      presence: known(true),
      intensityPeak: known(6),
      durationMinutes: unknown(),
    },
  }));
  const headacheAction = actionByDomain(
    actionsFor(headaches),
    "cefaleia",
    "headache_episodes",
  );
  assertInspectableEvidence(headacheAction);
  assert.equal(headacheAction.evidence.n, 3);
  assert.match(headacheAction.reason, /não determina causa, diagnóstico ou tratamento/);

  const bruxism = Array.from({ length: 7 }, (_, index) => entity({
    domain: "bruxismo",
    localDate: septemberDate(index + 1),
    payload: {
      eventKind: "bruxism-am-pm",
      presence: known(index < 3),
      morning: { jawPain: known(index < 3 ? 2 : 0) },
      evening: { jawPain: known(index < 3 ? 1 : 0) },
    },
  }));
  const bruxismAction = actionByDomain(
    actionsFor(bruxism),
    "bruxismo",
    "bruxism_days",
  );
  assertInspectableEvidence(bruxismAction);
  assert.deepEqual(
    {
      value: bruxismAction.evidence.value,
      n: bruxismAction.evidence.n,
      confirmedAbsences: bruxismAction.evidence.confirmedAbsences,
    },
    { value: 3, n: 7, confirmedAbsences: 4 },
  );
});

test("routine action needs five known states and never moralizes postponement", () => {
  const routine = entity({
    domain: "rotina",
    payload: {
      eventKind: "routine-day-plan",
      tasks: [
        { title: known("A"), status: known("deferred") },
        { title: known("B"), status: known("deferred") },
        { title: known("C"), status: known("done") },
        { title: known("D"), status: known("planned") },
        { title: known("E"), status: known("planned") },
      ],
      anchors: [],
      closure: { state: unknown() },
    },
  });
  const action = actionByDomain(
    actionsFor([routine]),
    "rotina",
    "deferred_tasks",
  );
  assertInspectableEvidence(action);
  assert.deepEqual(
    { value: action.evidence.value, n: action.evidence.n, missing: action.evidence.missing },
    { value: 2, n: 5, missing: 0 },
  );
  assert.match(action.reason, /não uma avaliação de disciplina ou saúde/);
});

test("AI actions distinguish explicit zero use from unknown and never auto-cancel", () => {
  const tools = [
    { useCount: known(0), renewalDate: known("2026-09-30") },
    { useCount: known(1), renewalDate: unknown() },
    { useCount: known(2), renewalDate: unknown() },
    { useCount: unknown(), renewalDate: unknown() },
  ].map((facts, index) => entity({
    domain: "ia",
    localDate: septemberDate(index + 1),
    payload: {
      eventKind: "ai-tool-portfolio",
      toolName: known(`Ferramenta ${index + 1}`),
      useCount: facts.useCount,
      subscription: {
        price: unknown(),
        cadence: unknown(),
        renewalDate: facts.renewalDate,
      },
    },
  }));
  const actions = actionsFor(tools);
  const renewalAction = actionByDomain(actions, "ia", "renewals_7d");
  const noUseAction = actionByDomain(actions, "ia", "tools_with_confirmed_no_use");
  assertInspectableEvidence(renewalAction);
  assertInspectableEvidence(noUseAction);
  assert.deepEqual(
    { value: noUseAction.evidence.value, n: noUseAction.evidence.n, missing: noUseAction.evidence.missing },
    { value: 1, n: 3, missing: 1 },
  );
  assert.match(renewalAction.reason, /nenhuma assinatura é cancelada ou julgada automaticamente/i);

  const unknownOnly = tools.map((item) => ({
    ...item,
    id: `${item.id}-unknown`,
    payload: {
      ...item.payload,
      useCount: unknown(),
      subscription: { ...item.payload.subscription, renewalDate: unknown() },
    },
  }));
  const unknownActions = actionsFor(unknownOnly);
  assert.equal(
    actionByDomain(unknownActions, "ia", "tools_with_confirmed_no_use"),
    undefined,
  );
  const unknownMetric = analytics
    .buildAnalyticsReport(unknownOnly, {
      endLocalDate: "2026-09-30",
      days: 30,
      datasetId: "bauer-personal-primary",
    })
    .domains.ia.metrics.find(({ key }) => key === "tools_with_confirmed_no_use");
  assert.equal(unknownMetric.value, null);
  assert.equal(unknownMetric.n, 0);
  assert.equal(unknownMetric.missing, 4);
});
