// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

import test from "node:test";
import assert from "node:assert/strict";

import {
  alignDistributions,
  buildDistribution,
  coverage,
  distributionToProbabilities,
  jensenShannonDivergence,
  klDivergence,
  normalizeToken,
  symmetricKlDivergence,
  topTokenAgreement,
  totalVariationDistance,
} from "../lib/probability.js";

/** The log probability of one entry, from a probability. */
function logOf(probability) {
  return Math.log(probability);
}

const first = buildDistribution([
  { token: "a", logProbability: logOf(0.5) },
  { token: "b", logProbability: logOf(0.3) },
  { token: "c", logProbability: logOf(0.2) },
]);

const second = buildDistribution([
  { token: "a", logProbability: logOf(0.2) },
  { token: "b", logProbability: logOf(0.3) },
  { token: "c", logProbability: logOf(0.5) },
]);

test("the token normalizer trims the token and applies NFKC", () => {
  assert.equal(normalizeToken("  word "), "word");
  assert.equal(normalizeToken("ｗｏｒｄ"), "word");
});

test("the distribution normalizes its entries to sum to one", () => {
  const distribution = buildDistribution([
    { token: "a", logProbability: logOf(2) },
    { token: "b", logProbability: logOf(2) },
  ]);
  const probabilities = distributionToProbabilities(distribution);
  assert.equal(probabilities.get("a"), 0.5);
  assert.equal(distribution.supportSize, 2);
  assert.equal(distribution.topToken, "a");
});

test("the distribution aggregates a duplicated token", () => {
  const distribution = buildDistribution([
    { token: "a", logProbability: logOf(0.25) },
    { token: "a", logProbability: logOf(0.25) },
    { token: "b", logProbability: logOf(0.5) },
  ]);
  assert.equal(distribution.supportSize, 2);
  assert.equal(distributionToProbabilities(distribution).get("a"), 0.5);
});

test("an empty table is rejected", () => {
  assert.throws(() => buildDistribution([]), /empty/u);
  assert.throws(
    () => buildDistribution([{ token: "", logProbability: 0 }]),
    /empty|no token/u,
  );
});

test("the divergence is zero for equal distributions", () => {
  const aligned = alignDistributions(first, first);
  assert.equal(klDivergence(aligned.left, aligned.right), 0);
  assert.equal(symmetricKlDivergence(aligned.left, aligned.right), 0);
  assert.equal(jensenShannonDivergence(aligned.left, aligned.right), 0);
  assert.equal(totalVariationDistance(aligned.left, aligned.right), 0);
});

test("the divergence is positive and asymmetric for different distributions", () => {
  const skewed = buildDistribution([
    { token: "a", logProbability: logOf(0.8) },
    { token: "b", logProbability: logOf(0.1) },
    { token: "c", logProbability: logOf(0.1) },
  ]);
  const aligned = alignDistributions(first, skewed);
  const forward = klDivergence(aligned.left, aligned.right);
  const backward = klDivergence(aligned.right, aligned.left);
  assert.ok(forward > 0);
  assert.ok(backward > 0);
  assert.ok(Math.abs(forward - backward) > 1e-9);
  assert.ok(
    Math.abs(symmetricKlDivergence(aligned.left, aligned.right) - (forward + backward) / 2) <
      1e-12,
  );
});

test("the divergence against a uniform table matches the entropy", () => {
  const uniform = buildDistribution([
    { token: "a", logProbability: logOf(1 / 3) },
    { token: "b", logProbability: logOf(1 / 3) },
    { token: "c", logProbability: logOf(1 / 3) },
  ]);
  const aligned = alignDistributions(first, uniform);
  const divergence = klDivergence(aligned.left, aligned.right);
  const entropy = -(0.5 * Math.log(0.5) + 0.3 * Math.log(0.3) + 0.2 * Math.log(0.2));
  assert.ok(Math.abs(divergence - (Math.log(3) - entropy)) < 1e-12);
});

test("one missing token takes the probability floor and adds a large value", () => {
  const wide = buildDistribution([
    { token: "a", logProbability: logOf(0.5) },
    { token: "b", logProbability: logOf(0.5) },
  ]);
  const narrow = buildDistribution([{ token: "a", logProbability: logOf(1) }]);
  const aligned = alignDistributions(wide, narrow);
  const divergence = klDivergence(aligned.left, aligned.right);
  assert.ok(divergence > 10);
  assert.ok(divergence < 14);
  assert.deepEqual(aligned.tokens, ["a", "b"]);
});

test("the coverage counts the support that both distributions share", () => {
  const wide = buildDistribution([
    { token: "a", logProbability: logOf(0.4) },
    { token: "b", logProbability: logOf(0.4) },
    { token: "c", logProbability: logOf(0.2) },
  ]);
  const narrow = buildDistribution([
    { token: "a", logProbability: logOf(0.7) },
    { token: "b", logProbability: logOf(0.3) },
  ]);
  assert.equal(coverage(narrow, wide), 1);
  assert.ok(Math.abs(coverage(wide, narrow) - 0.8) < 1e-9);
});

test("the top token agreement compares the most likely token", () => {
  assert.equal(topTokenAgreement(first, first), true);
  assert.equal(topTokenAgreement(first, second), false);
});
