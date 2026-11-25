// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * Metrics of the experiment.
 *
 * One comparison pairs one predicted table with one actual table. One task record holds every
 * combination of a predicted repetition and an actual repetition. One provider result aggregates
 * the task records and gives one bootstrap interval and one verdict for each comparison.
 */
import { COMPARISON_NAMES, DEFAULT_BOOTSTRAP_SAMPLE_COUNT } from "./constants.js";
import { alignDistributions, coverage, jensenShannonDivergence, klDivergence, mean, median, quantile, symmetricKlDivergence, topTokenAgreement, totalVariationDistance, } from "./probability.js";
/**
 * Compute one comparison of two tables.
 *
 * @param actual - the actual table.
 * @param predicted - the predicted table.
 * @param actualRepetition - the repetition number of the actual table.
 * @param predictedRepetition - the repetition number of the predicted table.
 * @returns the comparison metrics.
 */
export function computeComparisonMetrics(actual, predicted, actualRepetition, predictedRepetition) {
    const aligned = alignDistributions(predicted, actual);
    return {
        actualRepetition,
        predictedRepetition,
        klActualPredicted: klDivergence(aligned.right, aligned.left),
        klPredictedActual: klDivergence(aligned.left, aligned.right),
        symmetricKl: symmetricKlDivergence(aligned.left, aligned.right),
        jensenShannon: jensenShannonDivergence(aligned.left, aligned.right),
        totalVariation: totalVariationDistance(aligned.left, aligned.right),
        topTokenAgreement: topTokenAgreement(predicted, actual),
        coveragePredictedByActual: coverage(predicted, actual),
        coverageActualByPredicted: coverage(actual, predicted),
        unionSupportSize: aligned.tokens.length,
    };
}
/**
 * Summarize one list of comparisons without a confidence interval.
 *
 * @param comparison - the comparison name.
 * @param values - the comparisons.
 * @returns the summary with a zero-width interval.
 */
export function summarizeComparisons(comparison, values) {
    return {
        comparison,
        pairCount: values.length,
        meanKlActualPredicted: mean(values.map((value) => value.klActualPredicted)),
        meanKlPredictedActual: mean(values.map((value) => value.klPredictedActual)),
        meanSymmetricKl: mean(values.map((value) => value.symmetricKl)),
        medianSymmetricKl: median(values.map((value) => value.symmetricKl)),
        meanJensenShannon: mean(values.map((value) => value.jensenShannon)),
        meanTotalVariation: mean(values.map((value) => value.totalVariation)),
        topTokenAgreementRate: mean(values.map((value) => (value.topTokenAgreement ? 1 : 0))),
        meanCoveragePredictedByActual: mean(values.map((value) => value.coveragePredictedByActual)),
        meanCoverageActualByPredicted: mean(values.map((value) => value.coverageActualByPredicted)),
        meanUnionSupportSize: mean(values.map((value) => value.unionSupportSize)),
        confidenceInterval: {
            lower: 0,
            upper: 0,
            confidenceLevel: 0.95,
            sampleCount: 0,
            randomSeed: 0,
        },
    };
}
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
export function buildTaskRecord(task, providerKey, providerLabel, model, predictions, errors) {
    const actual = predictions.plain_actual;
    const comparisons = {
        plain_self: pairAll(actual, predictions.plain_self),
        injected_self: pairAll(actual, predictions.injected_self),
        injected_actual: pairAll(actual, predictions.injected_actual),
    };
    const warnings = [];
    for (const condition of Object.values(predictions)) {
        for (const record of condition) {
            if (record.warning !== undefined) {
                warnings.push(`${record.condition} repetition ${record.repetition}: ${record.warning}`);
            }
        }
    }
    return {
        task,
        providerKey,
        providerLabel,
        model,
        predictions,
        comparisons,
        warnings,
        errors,
    };
}
/**
 * Pair every predicted repetition with every actual repetition.
 *
 * @param actual - the actual records.
 * @param predicted - the predicted records.
 * @returns the comparisons in repetition order.
 */
function pairAll(actual, predicted) {
    const comparisons = [];
    for (const actualRecord of actual) {
        for (const predictedRecord of predicted) {
            comparisons.push(computeComparisonMetrics(actualRecord.distribution, predictedRecord.distribution, actualRecord.repetition, predictedRecord.repetition));
        }
    }
    return comparisons;
}
/**
 * Create one deterministic random number generator.
 *
 * @param seed - the seed.
 * @returns a function that returns a value in the range from zero to one.
 */
export function createRandomGenerator(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}
/**
 * Compute one bootstrap confidence interval of the mean.
 *
 * @param values - the observed values.
 * @param options - the resample count, the seed, and the confidence level.
 * @returns the interval.
 */
export function bootstrapConfidenceInterval(values, options = {}) {
    const sampleCount = options.sampleCount ?? DEFAULT_BOOTSTRAP_SAMPLE_COUNT;
    const randomSeed = options.randomSeed ?? 0;
    const confidenceLevel = options.confidenceLevel ?? 0.95;
    if (values.length === 0) {
        return { lower: 0, upper: 0, confidenceLevel, sampleCount, randomSeed };
    }
    const random = createRandomGenerator(randomSeed);
    const means = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
        let total = 0;
        for (let index = 0; index < values.length; index += 1) {
            const position = Math.floor(random() * values.length);
            total += values[position] ?? 0;
        }
        means.push(total / values.length);
    }
    const alpha = (1 - confidenceLevel) / 2;
    return {
        lower: quantile(means, alpha),
        upper: quantile(means, 1 - alpha),
        confidenceLevel,
        sampleCount,
        randomSeed,
    };
}
/**
 * Decide the verdict of one comparison.
 *
 * @param interval - the interval of the mean symmetric divergence.
 * @param toleranceNats - the tolerance.
 * @param pairCount - the number of compared pairs.
 * @returns the verdict.
 */
export function decideVerdict(interval, toleranceNats, pairCount) {
    if (pairCount === 0) {
        return "inconclusive";
    }
    if (interval.upper < toleranceNats) {
        return "indistinguishable";
    }
    if (interval.lower > toleranceNats) {
        return "separated";
    }
    return "inconclusive";
}
/**
 * Compute the summary of one comparison over a task list.
 *
 * @param records - the task records.
 * @param comparison - the comparison name.
 * @param randomSeed - the seed of the interval.
 * @param sampleCount - the resample count of the interval.
 * @returns the summary with its interval.
 */
function summarizeRecords(records, comparison, randomSeed, sampleCount) {
    const values = records.flatMap((record) => record.comparisons[comparison]);
    const base = summarizeComparisons(comparison, values);
    const taskMeans = records
        .map((record) => record.comparisons[comparison])
        .filter((entries) => entries.length > 0)
        .map((entries) => mean(entries.map((entry) => entry.symmetricKl)));
    const interval = bootstrapConfidenceInterval(taskMeans, {
        sampleCount,
        randomSeed,
        confidenceLevel: 0.95,
    });
    return { ...base, confidenceInterval: interval };
}
/**
 * Group the task records by one key.
 *
 * @param records - the task records.
 * @param keyOf - the grouping function.
 * @returns the groups in first-seen order.
 */
function groupRecords(records, keyOf, randomSeed, sampleCount) {
    const groups = new Map();
    for (const record of records) {
        const key = keyOf(record);
        const bucket = groups.get(key) ?? [];
        bucket.push(record);
        groups.set(key, bucket);
    }
    const results = [];
    for (const [name, bucket] of groups.entries()) {
        results.push({
            name,
            taskCount: bucket.length,
            comparisons: COMPARISON_NAMES.map((comparison) => summarizeRecords(bucket, comparison, randomSeed, sampleCount)),
        });
    }
    return results;
}
/**
 * Compute the result of one model.
 *
 * @param records - the task records of the model.
 * @param toleranceNats - the tolerance.
 * @param randomSeed - the seed of the intervals.
 * @param sampleCount - the resample count of the intervals.
 * @returns the provider result.
 */
export function computeProviderResult(records, toleranceNats, randomSeed, sampleCount = DEFAULT_BOOTSTRAP_SAMPLE_COUNT) {
    const first = records[0];
    if (first === undefined) {
        throw new Error("The provider result needs at least one task record.");
    }
    const summaries = COMPARISON_NAMES.map((comparison) => summarizeRecords(records, comparison, randomSeed, sampleCount));
    const verdicts = summaries.map((summary) => ({
        comparison: summary.comparison,
        verdict: decideVerdict(summary.confidenceInterval, toleranceNats, summary.pairCount),
        intervalLower: summary.confidenceInterval.lower,
        intervalUpper: summary.confidenceInterval.upper,
    }));
    const warnings = [];
    for (const record of records) {
        warnings.push(...record.warnings.map((warning) => `${record.task.id}: ${warning}`));
    }
    return {
        providerKey: first.providerKey,
        providerLabel: first.providerLabel,
        model: first.model,
        taskCount: records.length,
        comparisons: summaries,
        verdicts,
        languages: groupRecords(records, (record) => record.task.language ?? "unknown", randomSeed, sampleCount),
        categories: groupRecords(records, (record) => record.task.category, randomSeed, sampleCount),
        warnings,
    };
}
/**
 * Compute the metrics of one run.
 *
 * @param options - the run identity, the records, and the settings.
 * @returns the session metrics.
 */
export function computeSessionMetrics(options) {
    const byProvider = new Map();
    for (const record of options.records) {
        const bucket = byProvider.get(record.providerKey) ?? [];
        bucket.push(record);
        byProvider.set(record.providerKey, bucket);
    }
    const providers = [];
    for (const bucket of byProvider.values()) {
        providers.push(computeProviderResult(bucket, options.toleranceNats, options.randomSeed, options.sampleCount ?? DEFAULT_BOOTSTRAP_SAMPLE_COUNT));
    }
    return {
        xid: options.xid,
        datasetIds: options.datasetIds,
        languages: options.languages,
        generatedAt: options.generatedAt,
        toleranceNats: options.toleranceNats,
        repetitionCount: options.repetitionCount,
        topLogprobsCount: options.topLogprobsCount,
        randomSeed: options.randomSeed,
        taskCount: options.taskCount,
        providers,
        verdicts: providers.map((provider) => ({
            providerKey: provider.providerKey,
            model: provider.model,
            verdicts: provider.verdicts,
        })),
    };
}
