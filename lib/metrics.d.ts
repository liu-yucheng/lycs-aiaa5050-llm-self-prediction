import type { BaselinePairMetrics, ConfidenceInterval, MetricSummary, PairMetrics, PredictionAnswer, ProviderDefinition, ProviderMetrics, SessionMetrics, Task, TaskRecord, Verdict } from "./types.js";
/**
 * Compute the metrics of one actual-versus-self pair.
 *
 * @param actual - the actual prediction.
 * @param self - the self prediction.
 * @returns the pair metrics.
 */
export declare function computePairMetrics(actual: PredictionAnswer, self: PredictionAnswer): PairMetrics;
/**
 * Compute the metrics of one pair of the same prediction mode.
 *
 * @param first - the first prediction.
 * @param second - the second prediction.
 * @returns the baseline pair metrics.
 */
export declare function computeBaselinePairMetrics(first: PredictionAnswer, second: PredictionAnswer): BaselinePairMetrics;
/**
 * Compute the summary of one set of pair metrics.
 *
 * @param pairs - the pair metrics.
 * @returns the summary; an empty list gives zeros.
 */
export declare function summarizePairs(pairs: readonly PairMetrics[]): MetricSummary;
/**
 * Build the record of one task and one provider.
 *
 * A missing side gives an empty pair list and keeps the error text. The function never invents an
 * answer for a failed call.
 *
 * @param task - the task.
 * @param provider - the provider definition.
 * @param actual - the successful actual predictions.
 * @param self - the successful self predictions.
 * @param errors - the failure texts of this task and provider.
 * @returns the task record.
 */
export declare function buildTaskRecord(task: Task, provider: ProviderDefinition, actual: readonly PredictionAnswer[], self: readonly PredictionAnswer[], errors: readonly string[]): TaskRecord;
/**
 * Create one deterministic pseudo-random number generator.
 *
 * @param seed - the seed.
 * @returns a function that returns a value in `[0, 1)`.
 */
export declare function createRandomGenerator(seed: number): () => number;
/**
 * Compute one bootstrap confidence interval of a mean.
 *
 * @param values - the observed values.
 * @param options - the sample count, the seed, and the confidence level.
 * @returns the interval; an empty list gives a zero interval.
 */
export declare function bootstrapConfidenceInterval(values: readonly number[], options?: {
    readonly sampleCount?: number;
    readonly randomSeed?: number;
    readonly confidenceLevel?: number;
}): ConfidenceInterval;
/**
 * Decide the verdict of one provider.
 *
 * The null hypothesis says that the symmetric divergence is above the tolerance. The alternative
 * says that it is below the tolerance. A confidence interval that lies below the tolerance
 * supports the alternative, one that lies above supports the null, and one that crosses the
 * tolerance leaves the question open.
 *
 * @param summary - the provider summary.
 * @param interval - the confidence interval of the mean symmetric divergence.
 * @param toleranceNats - the tolerance in nats.
 * @returns the verdict.
 */
export declare function decideVerdict(summary: MetricSummary, interval: ConfidenceInterval, toleranceNats: number): Verdict;
/**
 * Aggregate the task records of one provider.
 *
 * @param records - the records of one provider.
 * @param provider - the provider definition.
 * @param toleranceNats - the tolerance in nats.
 * @param randomSeed - the seed of the confidence interval.
 * @returns the provider metrics.
 */
export declare function computeProviderMetrics(records: readonly TaskRecord[], provider: ProviderDefinition, toleranceNats: number, randomSeed: number): ProviderMetrics;
/**
 * Build the metrics file of one session.
 *
 * @param options - the session code, dataset, records, tolerance, repetition count, table size,
 *   seed, and generation time.
 * @returns the session metrics.
 */
export declare function computeSessionMetrics(options: {
    readonly sessionCode: string;
    readonly datasetId: string;
    readonly records: readonly TaskRecord[];
    readonly toleranceNats: number;
    readonly repetitionCount: number;
    readonly topLogprobsCount: number;
    readonly randomSeed: number;
    readonly generatedAt: string;
    readonly taskCount: number;
    readonly providers: readonly ProviderDefinition[];
}): SessionMetrics;
/**
 * Read the default tolerance of one run.
 *
 * @param value - the requested tolerance.
 * @returns the requested value when it is positive, else the default.
 */
export declare function resolveTolerance(value: number | undefined): number;
