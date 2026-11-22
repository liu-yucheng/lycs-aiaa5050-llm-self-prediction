// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

import assert from "node:assert/strict";
import test from "node:test";

import {
  alignDistributions,
  buildDistribution,
  coverage,
  jensenShannonDivergence,
  klDivergence,
  symmetricKlDivergence,
  topTokenAgreement,
  totalVariationDistance,
} from "../lib/probability.js";

/**
 * Build one table from a list of token and probability pairs.
 *
 * @param {readonly (readonly [string, number])[]} pairs - the token and probability pairs.
 * @returns {import("../lib/types.js").ProbabilityEntry[]} the entries.
 */
function entriesOf(pairs) {
  return pairs.map(([token, probability]) => ({ token, logProbability: Math.log(probability) }));
}

test("buildDistribution normalizes the table and aggregates a duplicate token", () => {
  const distribution = buildDistribution([
    { token: "霜", logProbability: Math.log(0.5) },
    { token: " 霜 ", logProbability: Math.log(0.25) },
    { token: "月", logProbability: Math.log(0.25) },
  ]);
  assert.equal(distribution.supportSize, 2);
  assert.ok(Math.abs(distribution.totalProbability - 1) < 1e-12);
  const first = distribution.entries[0];
  assert.ok(first !== undefined);
  assert.equal(first.token, "霜");
  assert.ok(Math.abs(Math.exp(first.logProbability) - 0.75) < 1e-12);
});

test("klDivergence reports zero for one table and a known value for another", () => {
  const left = buildDistribution(entriesOf([["a", 0.5], ["b", 0.3], ["c", 0.2]]));
  const same = buildDistribution(entriesOf([["a", 0.5], ["b", 0.3], ["c", 0.2]]));
  const other = buildDistribution(entriesOf([["a", 0.4], ["b", 0.4], ["c", 0.2]]));
  const identical = alignDistributions(left, same);
  assert.equal(klDivergence(identical.left, identical.right), 0);
  const changed = alignDistributions(left, other);
  const expected = 0.5 * Math.log(0.5 / 0.4) + 0.3 * Math.log(0.3 / 0.4);
  assert.ok(Math.abs(klDivergence(changed.left, changed.right) - expected) < 1e-9);
});

test("the distance measures obey their bounds for one known pair", () => {
  const left = buildDistribution(entriesOf([["a", 0.6], ["b", 0.4]]));
  const right = buildDistribution(entriesOf([["a", 0.2], ["b", 0.8]]));
  const aligned = alignDistributions(left, right);
  const forward = klDivergence(aligned.left, aligned.right);
  const backward = klDivergence(aligned.right, aligned.left);
  assert.ok(Math.abs(symmetricKlDivergence(aligned.left, aligned.right) - (forward + backward) / 2) < 1e-12);
  const jensenShannon = jensenShannonDivergence(aligned.left, aligned.right);
  assert.ok(jensenShannon > 0);
  assert.ok(jensenShannon < symmetricKlDivergence(aligned.left, aligned.right));
  assert.ok(Math.abs(totalVariationDistance(aligned.left, aligned.right) - 0.4) < 1e-9);
});

test("alignDistributions covers the token union and renormalizes each side", () => {
  const left = buildDistribution(entriesOf([["a", 0.9], ["b", 0.1]]));
  const right = buildDistribution(entriesOf([["b", 0.7], ["c", 0.3]]));
  const aligned = alignDistributions(left, right);
  assert.deepEqual([...aligned.tokens], ["a", "b", "c"]);
  const leftTotal = aligned.left.reduce((total, value) => total + value, 0);
  const rightTotal = aligned.right.reduce((total, value) => total + value, 0);
  assert.ok(Math.abs(leftTotal - 1) < 1e-12);
  assert.ok(Math.abs(rightTotal - 1) < 1e-12);
  assert.ok(Math.abs(coverage(left, right) - 0.1) < 1e-12);
  assert.equal(topTokenAgreement(left, right), false);
});
