import type { ComparisonMetrics, ComparisonName, ComparisonSummary, ConditionName, ConfidenceInterval, PredictionRecord, ProviderResult, SessionMetrics, Task, TaskRecord, TokenDistribution, Verdict } from "./types.js";
/**
 * Compute one comparison of two tables.
 *
 * @param actual - the actual table.
 * @param predicted - the predicted table.
 * @param actualRepetition - the repetition number of the actual table.
 * @param predictedRepetition - the repetition number of the predicted table.
 * @returns the comparison metrics.
 */
export declare function computeComparisonMetrics(actual: TokenDistribution, predicted: TokenDistribution, actualRepetition: number, predictedRepetition: number): ComparisonMetrics;
/**
 * Summarize one list of comparisons without a confidence interval.
 *
 * @param comparison - the comparison name.
 * @param values - the comparisons.
 * @returns the summary with a zero-width interval.
 */
export declare function summarizeComparisons(comparison: ComparisonName, values: readonly ComparisonMetrics[]): ComparisonSummary;
/**
 * Build one task record.
 *
 * @param task - the task.
 * @param providerKey - the expanded provider key.
 * @param providerLabel - the display label.
 * @param model - the model name.
 * @param predictions - the predictions of each condition.
 * @param errors - the errors of the task.
 * @returns the task record.
 */
export declare function buildTaskRecord(task: Task, providerKey: string, providerLabel: string, model: string, predictions: Readonly<Record<ConditionName, readonly PredictionRecord[]>>, errors: readonly string[]): TaskRecord;
/**
 * Create one deterministic random number generator.
 *
 * @param seed - the seed.
 * @returns a function that returns a value in the range from zero to one.
 */
export declare function createRandomGenerator(seed: number): () => number;
/**
 * Compute one bootstrap confidence interval of the mean.
 *
 * @param values - the observed values.
 * @param options - the resample count, the seed, and the confidence level.
 * @returns the interval.
 */
export declare function bootstrapConfidenceInterval(values: readonly number[], options?: {
    sampleCount?: number;
    randomSeed?: number;
    confidenceLevel?: number;
}): ConfidenceInterval;
/**
 * Decide the verdict of one comparison.
 *
 * @param interval - the interval of the mean symmetric divergence.
 * @param toleranceNats - the tolerance.
 * @param pairCount - the number of compared pairs.
 * @returns the verdict.
 */
export declare function decideVerdict(interval: ConfidenceInterval, toleranceNats: number, pairCount: number): Verdict;
/**
 * Compute the result of one model.
 *
 * @param records - the task records of the model.
 * @param toleranceNats - the tolerance.
 * @param randomSeed - the seed of the intervals.
 * @param sampleCount - the resample count of the intervals.
 * @returns the provider result.
 */
export declare function computeProviderResult(records: readonly TaskRecord[], toleranceNats: number, randomSeed: number, sampleCount?: number): ProviderResult;
/**
 * Compute the metrics of one run.
 *
 * @param options - the run identity, the records, and the settings.
 * @returns the session metrics.
 */
export declare function computeSessionMetrics(options: {
    readonly xid: string;
    readonly datasetIds: readonly string[];
    readonly languages: readonly string[];
    readonly records: readonly TaskRecord[];
    readonly toleranceNats: number;
    readonly repetitionCount: number;
    readonly topLogprobsCount: number;
    readonly randomSeed: number;
    readonly generatedAt: string;
    readonly taskCount: number;
    readonly sampleCount?: number;
}): SessionMetrics;
