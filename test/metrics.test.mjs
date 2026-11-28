// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

import test from "node:test";
import assert from "node:assert/strict";

import {
  bootstrapConfidenceInterval,
  buildTaskRecord,
  computeComparisonMetrics,
  computeSessionMetrics,
  createRandomGenerator,
  decideSessionHypothesis,
  decideVerdict,
} from "../lib/metrics.js";
import { buildDistribution } from "../lib/probability.js";

/** Build one table from probabilities. */
function table(pairs) {
  return buildDistribution(
    pairs.map(([token, probability]) => ({ token, logProbability: Math.log(probability) })),
  );
}

/** Build one prediction record. */
function prediction(condition, repetition, pairs) {
  return {
    condition,
    repetition,
    requestedAt: "2026-11-25T09:00:00.000Z",
    elapsedMilliseconds: 120,
    token: pairs[0][0],
    distribution: table(pairs),
    source: condition === "actual" || condition === "actual_injected_actual"
      ? "provider_logprobs"
      : "self_report",
    rawFileNames: [`${condition}-r${repetition}-call1.json`],
    endpoint: "mock://local",
    requestBody: {},
  };
}

const task = {
  id: "Z001",
  category: "poetry",
  language: "zh-Hans",
  prefix: "床前明月光，疑是地上",
  referenceToken: "霜",
};

const identical = [
  ["a", 0.6],
  ["b", 0.4],
];

const shifted = [
  ["a", 0.3],
  ["b", 0.7],
];

test("the same table gives a zero divergence and a top-1 agreement", () => {
  const value = computeComparisonMetrics(table(identical), table(identical), 1, 2);
  assert.equal(value.actualRepetition, 1);
  assert.equal(value.predictedRepetition, 2);
  assert.ok(value.symmetricKl < 1e-12);
  assert.equal(value.topTokenAgreement, true);
  assert.equal(value.coveragePredictedByActual, 1);
  assert.equal(value.unionSupportSize, 2);
});

test("a shifted table gives a positive divergence and no agreement", () => {
  const value = computeComparisonMetrics(table(identical), table(shifted), 1, 1);
  assert.ok(value.symmetricKl > 0.1);
  assert.equal(value.topTokenAgreement, false);
  assert.ok(Math.abs(value.klActualPredicted - value.klPredictedActual) > 1e-6);
});

test("a task record pairs each actual repetition with each predicted repetition", () => {
  const record = buildTaskRecord(
    task,
    "mock",
    "Mock",
    "mock-model",
    {
      actual: [prediction("actual", 1, identical), prediction("actual", 2, identical)],
      self: [prediction("self", 1, shifted), prediction("self", 2, identical)],
      actual_injected_self: [prediction("actual_injected_self", 1, identical)],
      actual_injected_actual: [],
    },
    [],
  );
  assert.equal(record.comparisons.self.length, 4);
  assert.equal(record.comparisons.actual_injected_self.length, 2);
  assert.equal(record.comparisons.actual_injected_actual.length, 0);
  assert.equal(record.comparisons.self[0].actualRepetition, 1);
  assert.equal(record.comparisons.self[1].predictedRepetition, 2);
});

test("the random generator repeats a sequence for one seed", () => {
  const left = createRandomGenerator(20260815);
  const right = createRandomGenerator(20260815);
  const leftValues = [left(), left(), left()];
  const rightValues = [right(), right(), right()];
  assert.deepEqual(leftValues, rightValues);
  assert.notDeepEqual(leftValues, [createRandomGenerator(7)(), 0, 0]);
});

test("the bootstrap interval holds the mean of a constant list", () => {
  const interval = bootstrapConfidenceInterval([0.2, 0.2, 0.2], {
    sampleCount: 200,
    randomSeed: 5,
  });
  assert.ok(Math.abs(interval.lower - 0.2) < 1e-12);
  assert.ok(Math.abs(interval.upper - 0.2) < 1e-12);
  assert.equal(interval.sampleCount, 200);
});

test("the bootstrap interval widens with a spread list", () => {
  const interval = bootstrapConfidenceInterval([0, 1], { sampleCount: 500, randomSeed: 11 });
  assert.ok(interval.lower < 0.5);
  assert.ok(interval.upper > 0.5);
  assert.ok(interval.lower >= 0);
  assert.ok(interval.upper <= 1);
});

test("a verdict follows the tolerance against the interval", () => {
  const below = { lower: 0.001, upper: 0.01, confidenceLevel: 0.95, sampleCount: 10, randomSeed: 1 };
  const above = { lower: 0.4, upper: 0.9, confidenceLevel: 0.95, sampleCount: 10, randomSeed: 1 };
  const across = { lower: 0.01, upper: 0.4, confidenceLevel: 0.95, sampleCount: 10, randomSeed: 1 };
  assert.equal(decideVerdict(below, 0.05, 9), "indistinguishable");
  assert.equal(decideVerdict(above, 0.05, 9), "separated");
  assert.equal(decideVerdict(across, 0.05, 9), "inconclusive");
  assert.equal(decideVerdict(below, 0.05, 0), "inconclusive");
});

test("the session metrics hold one result for each provider and comparison", () => {
  const records = [
    buildTaskRecord(
      { ...task, id: "Z001" },
      "mock",
      "Mock",
      "mock-model",
      {
        actual: [prediction("actual", 1, identical)],
        self: [prediction("self", 1, identical)],
        actual_injected_self: [prediction("actual_injected_self", 1, shifted)],
        actual_injected_actual: [prediction("actual_injected_actual", 1, identical)],
      },
      [],
    ),
    buildTaskRecord(
      { ...task, id: "Z002" },
      "mock",
      "Mock",
      "mock-model",
      {
        actual: [prediction("actual", 1, identical)],
        self: [prediction("self", 1, shifted)],
        actual_injected_self: [prediction("actual_injected_self", 1, shifted)],
        actual_injected_actual: [prediction("actual_injected_actual", 1, shifted)],
      },
      [],
    ),
  ];
  const metrics = computeSessionMetrics({
    xid: "20261125T090000Z_abc123",
    protocolVersion: "2.0.0",
    datasetIds: ["test"],
    languages: ["zh-Hans"],
    records,
    toleranceNats: 0.05,
    repetitionCount: 1,
    topLogprobsCount: 20,
    randomSeed: 20260815,
    generatedAt: "2026-11-25T09:10:00.000Z",
    taskCount: 2,
    sampleCount: 200,
  });
  assert.equal(metrics.providers.length, 1);
  const provider = metrics.providers[0];
  assert.equal(provider.comparisons.length, 3);
  assert.equal(provider.comparisons[0].pairCount, 2);
  assert.equal(provider.verdicts.length, 3);
  assert.equal(metrics.verdicts.length, 1);
  assert.equal(provider.comparisons[0].hypothesis.testName, "wilcoxon_signed_rank");
  assert.equal(metrics.hypothesis.alpha, 0.05);
  assert.equal(["alternative", "null", "mixed"].includes(metrics.hypothesis.verdict), true);
  assert.equal(provider.categories.length, 1);
  assert.equal(provider.languages.length, 1);
});

test("the control comparison gates the session verdict", () => {
  const makeTest = (comparison, median, rejected) => ({
    testName: "wilcoxon_signed_rank",
    comparison,
    sampleCount: 8,
    nullValue: 0,
    median,
    statistic: 30,
    zScore: 2.5,
    pValue: rejected ? 0.001 : 0.5,
    alpha: 0.05,
    rejectsNull: rejected,
  });
  const alternative = decideSessionHypothesis(
    [
      makeTest("self", 3.5, true),
      makeTest("actual_injected_self", 1.5, true),
      makeTest("actual_injected_actual", 0.001, true),
    ],
    0.05,
  );
  assert.equal(alternative.verdict, "alternative");
  assert.equal(alternative.alternativeHolds, true);
  assert.equal(alternative.testCount, 2);
  assert.equal(alternative.controlTestCount, 1);
  assert.equal(alternative.controlViolationCount, 0);

  const mixed = decideSessionHypothesis(
    [
      makeTest("self", 3.5, true),
      makeTest("actual_injected_self", 1.5, true),
      makeTest("actual_injected_actual", 4.5, true),
    ],
    0.05,
  );
  assert.equal(mixed.verdict, "mixed");
  assert.equal(mixed.controlViolationCount, 1);
  assert.equal(mixed.controlMedianMaximum, 4.5);

  const nullResult = decideSessionHypothesis(
    [
      makeTest("self", 0.01, false),
      makeTest("actual_injected_self", 0.02, false),
      makeTest("actual_injected_actual", 0.001, false),
    ],
    0.05,
  );
  assert.equal(nullResult.verdict, "null");
  assert.equal(nullResult.rejectedCount, 0);
});
