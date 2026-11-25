import type { ProbabilityEntry, TokenDistribution } from "./types.js";
/** One pair of aligned probability vectors over a shared token list. */
export interface AlignedDistributions {
    /** The tokens of the union of both supports, in order. */
    readonly tokens: readonly string[];
    /** The probability of the left side, one value for each token. */
    readonly left: readonly number[];
    /** The probability of the right side, one value for each token. */
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
export declare function normalizeToken(token: string): string;
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
export declare function buildDistribution(entries: readonly ProbabilityEntry[]): TokenDistribution;
/**
 * Convert one normalized distribution to a token-to-probability map.
 *
 * @param distribution - the normalized distribution.
 * @returns a new map with one probability for each support token.
 */
export declare function distributionToProbabilities(distribution: TokenDistribution): Map<string, number>;
/**
 * Align two distributions on the union of their support tokens.
 *
 * A missing token receives {@link PROBABILITY_FLOOR}. Each side is renormalized after the floor.
 *
 * @param left - the first distribution.
 * @param right - the second distribution.
 * @returns the shared token list and the two probability vectors.
 */
export declare function alignDistributions(left: TokenDistribution, right: TokenDistribution): AlignedDistributions;
/**
 * Compute one Kullback-Leibler divergence in nats.
 *
 * @param source - the first probability vector.
 * @param target - the second probability vector, with the same length.
 * @returns `sum(source[i] * ln(source[i] / target[i]))`.
 */
export declare function klDivergence(source: readonly number[], target: readonly number[]): number;
/**
 * Compute one symmetric Kullback-Leibler divergence.
 *
 * @param source - the first probability vector.
 * @param target - the second probability vector.
 * @returns the mean of both directed divergences.
 */
export declare function symmetricKlDivergence(source: readonly number[], target: readonly number[]): number;
/**
 * Compute one Jensen-Shannon divergence in nats.
 *
 * @param source - the first probability vector.
 * @param target - the second probability vector.
 * @returns a value in `[0, ln 2]`.
 */
export declare function jensenShannonDivergence(source: readonly number[], target: readonly number[]): number;
/**
 * Compute one total-variation distance.
 *
 * @param source - the first probability vector.
 * @param target - the second probability vector.
 * @returns a value in `[0, 1]`.
 */
export declare function totalVariationDistance(source: readonly number[], target: readonly number[]): number;
/**
 * Report whether two distributions share their top token.
 *
 * @param left - the first distribution.
 * @param right - the second distribution.
 * @returns true when the top tokens are equal after normalization.
 */
export declare function topTokenAgreement(left: TokenDistribution, right: TokenDistribution): boolean;
/**
 * Compute the probability that one distribution gives to the support of another distribution.
 *
 * @param measured - the distribution whose mass is summed.
 * @param support - the distribution that defines the support tokens.
 * @returns the summed probability of `measured` over the support of `support`.
 */
export declare function coverage(measured: TokenDistribution, support: TokenDistribution): number;
/**
 * Compute the arithmetic mean of one list.
 *
 * @param values - the values to average.
 * @returns the mean, or 0 for an empty list.
 */
export declare function mean(values: readonly number[]): number;
/**
 * Compute the median of one list.
 *
 * @param values - the values to sort.
 * @returns the median, or 0 for an empty list.
 */
export declare function median(values: readonly number[]): number;
/**
 * Compute one quantile with linear interpolation.
 *
 * @param values - the values to sort.
 * @param fraction - the quantile in `[0, 1]`.
 * @returns the quantile, or 0 for an empty list.
 */
export declare function quantile(values: readonly number[], fraction: number): number;
