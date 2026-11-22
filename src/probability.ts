// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * Probability math of the experiment.
 *
 * A provider reports natural-log probabilities. The functions convert one report to a normalized
 * distribution, align two distributions on their shared token set, and compute the divergences.
 * A token that one side does not report receives a floor probability, so a divergence stays
 * finite. Both sides are renormalized after the floor, so each side sums to one.
 */

import { PROBABILITY_FLOOR } from "./constants.js";
import type { ProbabilityEntry, TokenDistribution } from "./types.js";
import { ExperimentError } from "./errors.js";

/** One pair of aligned probability vectors over a shared token list. */
export interface AlignedDistributions {
  readonly tokens: readonly string[];
  readonly left: readonly number[];
  readonly right: readonly number[];
}

/**
 * Normalize one token for comparison.
 *
 * The normalization applies NFKC and trims the ends. Two reports that differ only in width or
 * surrounding space name the same token.
 *
 * @param token - the token as the provider reported it.
 * @returns the normalized token.
 */
export function normalizeToken(token: string): string {
  return token.normalize("NFKC").trim();
}

/**
 * Build one normalized distribution from a raw entry list.
 *
 * Duplicate tokens are aggregated, each probability is `exp(logProbability)`, and the total is
 * normalized to one. A non-finite log probability is an error.
 *
 * @param entries - the raw entries of one answer.
 * @returns the normalized distribution.
 * @throws ExperimentError when the list is empty or holds an invalid number.
 */
export function buildDistribution(entries: readonly ProbabilityEntry[]): TokenDistribution {
  if (entries.length === 0) {
    throw new ExperimentError("INVALID_RESPONSE", "The probability table is empty.");
  }
  const aggregated = new Map<string, number>();
  for (const entry of entries) {
    const token = normalizeToken(entry.token);
    if (token === "") {
      continue;
    }
    if (!Number.isFinite(entry.logProbability)) {
      throw new ExperimentError(
        "INVALID_RESPONSE",
        `The token ${JSON.stringify(entry.token)} has a non-finite log probability.`,
      );
    }
    const probability = Math.exp(entry.logProbability);
    aggregated.set(token, (aggregated.get(token) ?? 0) + probability);
  }
  if (aggregated.size === 0) {
    throw new ExperimentError("INVALID_RESPONSE", "The probability table holds no token.");
  }
  let total = 0;
  for (const probability of aggregated.values()) {
    total += probability;
  }
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new ExperimentError("INVALID_RESPONSE", "The probability table has a zero total.");
  }
  const normalized: ProbabilityEntry[] = [];
  for (const [token, probability] of aggregated.entries()) {
    normalized.push({ token, logProbability: Math.log(probability / total) });
  }
  normalized.sort((left, right) => right.logProbability - left.logProbability);
  const top = normalized[0] as ProbabilityEntry;
  return {
    entries: normalized,
    supportSize: normalized.length,
    totalProbability: 1,
    topToken: top.token,
    topProbability: Math.exp(top.logProbability),
  };
}

/**
 * Convert one normalized distribution to a token-to-probability map.
 *
 * @param distribution - the normalized distribution.
 * @returns a new map with one probability for each support token.
 */
export function distributionToProbabilities(
  distribution: TokenDistribution,
): Map<string, number> {
  const probabilities = new Map<string, number>();
  for (const entry of distribution.entries) {
    probabilities.set(entry.token, Math.exp(entry.logProbability));
  }
  return probabilities;
}

/**
 * Align two distributions on the union of their support tokens.
 *
 * A missing token receives {@link PROBABILITY_FLOOR}. Each side is renormalized after the floor.
 *
 * @param left - the first distribution.
 * @param right - the second distribution.
 * @returns the shared token list and the two probability vectors.
 */
export function alignDistributions(
  left: TokenDistribution,
  right: TokenDistribution,
): AlignedDistributions {
  const leftProbabilities = distributionToProbabilities(left);
  const rightProbabilities = distributionToProbabilities(right);
  const tokens = [...new Set([...leftProbabilities.keys(), ...rightProbabilities.keys()])].sort();
  const leftVector: number[] = [];
  const rightVector: number[] = [];
  let leftTotal = 0;
  let rightTotal = 0;
  for (const token of tokens) {
    const leftValue = Math.max(leftProbabilities.get(token) ?? 0, PROBABILITY_FLOOR);
    const rightValue = Math.max(rightProbabilities.get(token) ?? 0, PROBABILITY_FLOOR);
    leftVector.push(leftValue);
    rightVector.push(rightValue);
    leftTotal += leftValue;
    rightTotal += rightValue;
  }
  return {
    tokens,
    left: leftVector.map((value) => value / leftTotal),
    right: rightVector.map((value) => value / rightTotal),
  };
}

/**
 * Compute one Kullback-Leibler divergence in nats.
 *
 * @param source - the first probability vector.
 * @param target - the second probability vector, with the same length.
 * @returns `sum(source[i] * ln(source[i] / target[i]))`.
 */
export function klDivergence(
  source: readonly number[],
  target: readonly number[],
): number {
  let total = 0;
  for (let index = 0; index < source.length; index += 1) {
    const p = source[index] ?? 0;
    const q = target[index] ?? 0;
    if (p > 0 && q > 0) {
      total += p * Math.log(p / q);
    }
  }
  return total < 0 ? 0 : total;
}

/**
 * Compute one symmetric Kullback-Leibler divergence.
 *
 * @param source - the first probability vector.
 * @param target - the second probability vector.
 * @returns the mean of both directed divergences.
 */
export function symmetricKlDivergence(
  source: readonly number[],
  target: readonly number[],
): number {
  return (klDivergence(source, target) + klDivergence(target, source)) / 2;
}

/**
 * Compute one Jensen-Shannon divergence in nats.
 *
 * @param source - the first probability vector.
 * @param target - the second probability vector.
 * @returns a value in `[0, ln 2]`.
 */
export function jensenShannonDivergence(
  source: readonly number[],
  target: readonly number[],
): number {
  const middle = source.map((value, index) => (value + (target[index] ?? 0)) / 2);
  return (klDivergence(source, middle) + klDivergence(target, middle)) / 2;
}

/**
 * Compute one total-variation distance.
 *
 * @param source - the first probability vector.
 * @param target - the second probability vector.
 * @returns a value in `[0, 1]`.
 */
export function totalVariationDistance(
  source: readonly number[],
  target: readonly number[],
): number {
  let total = 0;
  for (let index = 0; index < source.length; index += 1) {
    total += Math.abs((source[index] ?? 0) - (target[index] ?? 0));
  }
  return total / 2;
}

/**
 * Report whether two distributions share their top token.
 *
 * @param left - the first distribution.
 * @param right - the second distribution.
 * @returns true when the top tokens are equal after normalization.
 */
export function topTokenAgreement(left: TokenDistribution, right: TokenDistribution): boolean {
  return normalizeToken(left.topToken) === normalizeToken(right.topToken);
}

/**
 * Compute the probability that one distribution gives to the support of another distribution.
 *
 * @param measured - the distribution whose mass is summed.
 * @param support - the distribution that defines the support tokens.
 * @returns the summed probability of `measured` over the support of `support`.
 */
export function coverage(measured: TokenDistribution, support: TokenDistribution): number {
  const measuredProbabilities = distributionToProbabilities(measured);
  let total = 0;
  for (const entry of support.entries) {
    total += measuredProbabilities.get(entry.token) ?? 0;
  }
  return Math.min(1, total);
}

/**
 * Compute the arithmetic mean of one list.
 *
 * @param values - the values to average.
 * @returns the mean, or 0 for an empty list.
 */
export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}

/**
 * Compute the median of one list.
 *
 * @param values - the values to sort.
 * @returns the median, or 0 for an empty list.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Compute one quantile with linear interpolation.
 *
 * @param values - the values to sort.
 * @param fraction - the quantile in `[0, 1]`.
 * @returns the quantile, or 0 for an empty list.
 */
export function quantile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.min(1, Math.max(0, fraction)) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}
