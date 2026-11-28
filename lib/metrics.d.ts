import type { ComparisonMetrics, ComparisonName, ComparisonSummary, ConditionName, ConfidenceInterval, HypothesisTest, PredictionRecord, ProviderResult, SessionHypothesis, SessionMetrics, Task, TaskRecord, TokenDistribution, Verdict } from "./types.js";
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
 * Test one list of task values against a null value with the one-sided Wilcoxon signed-rank test.
 *
 * The alternative hypothesis states that a task value is above the null value. The test uses the
 * normal approximation with a tie correction, and the p-value counts the zero differences as
 * evidence for neither side.
 *
 * @param values - the task values, one value for one task.
 * @param nullValue - the value that the null hypothesis names.
 * @param comparison - the comparison name of the values.
 * @param alpha - the significance level.
 * @returns the hypothesis test.
 */
export declare function wilcoxonSignedRankTest(values: readonly number[], nullValue: number, comparison: ComparisonName, alpha?: number): HypothesisTest;
/**
 * Summarize one list of comparisons without a confidence interval.
 *
 * @param comparison - the comparison name.
 * @param values - the comparisons.
 * @param taskMeans - the mean symmetric divergence of each task, which the hypothesis test reads.
 * @param alpha - the significance level of the hypothesis test.
 * @returns the summary with a zero-width interval.
 */
export declare function summarizeComparisons(comparison: ComparisonName, values: readonly ComparisonMetrics[], taskMeans?: readonly number[], alpha?: number): ComparisonSummary;
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
 * Decide the hypothesis verdict from the hypothesis tests of one run.
 *
 * The alternative hypothesis holds when every self-prediction test rejects the null hypothesis,
 * every self-prediction median exceeds the practical tolerance, and every control median stays at
 * or below the tolerance. The null hypothesis holds when no self-prediction test rejects the null
 * hypothesis, or when every self-prediction median stays at or below the tolerance and the
 * control holds. Every other result is mixed.
 *
 * @param allTests - the hypothesis tests of the run.
 * @param toleranceNats - the practical tolerance.
 * @returns the session hypothesis.
 */
export declare function decideSessionHypothesis(allTests: readonly HypothesisTest[], toleranceNats: number): SessionHypothesis;
/**
 * Decide the hypothesis verdict of one run.
 *
 * The verdict comes from the hypothesis tests of every provider of the run.
 *
 * @param providers - the provider results.
 * @param toleranceNats - the practical tolerance.
 * @returns the session hypothesis.
 */
export declare function computeSessionHypothesis(providers: readonly ProviderResult[], toleranceNats: number): SessionHypothesis;
/**
 * Compute the result of one model.
 *
 * @param records - the task records of the model.
 * @param toleranceNats - the tolerance.
 * @param randomSeed - the seed of the intervals.
 * @param sampleCount - the resample count of the intervals.
 * @param alpha - the significance level of the hypothesis tests.
 * @returns the provider result.
 */
export declare function computeProviderResult(records: readonly TaskRecord[], toleranceNats: number, randomSeed: number, sampleCount?: number, alpha?: number): ProviderResult;
/**
 * Compute the metrics of one run.
 *
 * @param options - the run identity, the records, and the settings.
 * @returns the session metrics.
 */
export declare function computeSessionMetrics(options: {
    readonly xid: string;
    readonly protocolVersion: string;
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
    readonly alpha?: number;
}): SessionMetrics;
