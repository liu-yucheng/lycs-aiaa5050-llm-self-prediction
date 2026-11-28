// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * Metrics of the experiment.
 *
 * One comparison pairs one predicted table with one actual table. One task record holds every
 * combination of a predicted repetition and an actual repetition. One provider result aggregates
 * the task records and gives one bootstrap interval, one hypothesis test, and one verdict for each
 * comparison.
 */
import { COMPARISON_NAMES, CONDITION_ACTUAL_INJECTED_ACTUAL, DEFAULT_ALPHA, DEFAULT_BOOTSTRAP_SAMPLE_COUNT, } from "./constants.js";
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
 * Compute the standard normal distribution function.
 *
 * @param value - the score.
 * @returns the probability that a standard normal variable is at most the score.
 */
function standardNormalDistribution(value) {
    return 0.5 * (1 + erf(value / Math.SQRT2));
}
/**
 * Compute the error function with the Abramowitz and Stegun series 7.1.26.
 *
 * The maximum absolute error is 1.5e-7, which is far below the precision that a p-value report
 * needs.
 *
 * @param value - the argument.
 * @returns the error function of the argument.
 */
function erf(value) {
    const sign = value < 0 ? -1 : 1;
    const x = Math.abs(value);
    const t = 1 / (1 + 0.3275911 * x);
    const polynomial = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    return sign * (1 - polynomial * Math.exp(-x * x));
}
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
export function wilcoxonSignedRankTest(values, nullValue, comparison, alpha = DEFAULT_ALPHA) {
    const differences = values
        .map((value) => value - nullValue)
        .filter((difference) => difference !== 0 && Number.isFinite(difference));
    const ranks = rankAbsoluteValues(differences.map((difference) => Math.abs(difference)));
    let positiveRankSum = 0;
    let tieCorrection = 0;
    for (let index = 0; index < differences.length; index += 1) {
        if ((differences[index] ?? 0) > 0) {
            positiveRankSum += ranks[index] ?? 0;
        }
    }
    for (const group of countRanks(ranks)) {
        tieCorrection += group ** 3 - group;
    }
    const count = differences.length;
    const meanSum = (count * (count + 1)) / 4;
    const variance = (count * (count + 1) * (2 * count + 1) - tieCorrection) / 24;
    const zScore = count === 0 || variance <= 0 ? 0 : (positiveRankSum - meanSum) / Math.sqrt(variance);
    const pValue = count === 0 ? 1 : 1 - standardNormalDistribution(zScore);
    return {
        testName: "wilcoxon_signed_rank",
        comparison,
        sampleCount: count,
        nullValue,
        median: median(values),
        statistic: positiveRankSum,
        zScore,
        pValue,
        alpha,
        rejectsNull: count > 0 && pValue < alpha,
    };
}
/**
 * Rank the absolute values of one list and give each tie the average rank.
 *
 * @param magnitudes - the non-negative magnitudes.
 * @returns the ranks in input order, starting at one.
 */
function rankAbsoluteValues(magnitudes) {
    const order = magnitudes
        .map((magnitude, index) => ({ magnitude, index }))
        .sort((left, right) => left.magnitude - right.magnitude);
    const ranks = new Array(magnitudes.length).fill(0);
    let position = 0;
    while (position < order.length) {
        let end = position;
        while (end + 1 < order.length &&
            (order[end + 1]?.magnitude ?? 0) === (order[position]?.magnitude ?? 0)) {
            end += 1;
        }
        const averageRank = (position + end) / 2 + 1;
        for (let index = position; index <= end; index += 1) {
            ranks[order[index]?.index ?? 0] = averageRank;
        }
        position = end + 1;
    }
    return ranks;
}
/**
 * Count the entries of each rank value.
 *
 * @param ranks - the rank list.
 * @returns the counts in first-seen order.
 */
function countRanks(ranks) {
    const counts = new Map();
    for (const rank of ranks) {
        counts.set(rank, (counts.get(rank) ?? 0) + 1);
    }
    return [...counts.values()];
}
/**
 * Summarize one list of comparisons without a confidence interval.
 *
 * @param comparison - the comparison name.
 * @param values - the comparisons.
 * @param taskMeans - the mean symmetric divergence of each task, which the hypothesis test reads.
 * @param alpha - the significance level of the hypothesis test.
 * @returns the summary with a zero-width interval.
 */
export function summarizeComparisons(comparison, values, taskMeans = [], alpha = DEFAULT_ALPHA) {
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
        hypothesis: wilcoxonSignedRankTest(taskMeans, 0, comparison, alpha),
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
    const actual = predictions.actual;
    const comparisons = {
        self: pairAll(actual, predictions.self),
        actual_injected_self: pairAll(actual, predictions.actual_injected_self),
        actual_injected_actual: pairAll(actual, predictions.actual_injected_actual),
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
 * @param alpha - the significance level of the hypothesis test.
 * @returns the summary with its interval and its hypothesis test.
 */
function summarizeRecords(records, comparison, randomSeed, sampleCount, alpha) {
    const values = records.flatMap((record) => record.comparisons[comparison]);
    const taskMeans = records
        .map((record) => record.comparisons[comparison])
        .filter((entries) => entries.length > 0)
        .map((entries) => mean(entries.map((entry) => entry.symmetricKl)));
    const base = summarizeComparisons(comparison, values, taskMeans, alpha);
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
function groupRecords(records, keyOf, randomSeed, sampleCount, alpha) {
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
            comparisons: COMPARISON_NAMES.map((comparison) => summarizeRecords(bucket, comparison, randomSeed, sampleCount, alpha)),
        });
    }
    return results;
}
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
export function decideSessionHypothesis(allTests, toleranceNats) {
    const tests = allTests.filter((test) => test.comparison !== CONDITION_ACTUAL_INJECTED_ACTUAL);
    const controls = allTests.filter((test) => test.comparison === CONDITION_ACTUAL_INJECTED_ACTUAL);
    const rejectedCount = tests.filter((test) => test.rejectsNull).length;
    const separatedCount = tests.filter((test) => test.rejectsNull && test.median > toleranceNats).length;
    const controlViolationCount = controls.filter((test) => test.median > toleranceNats).length;
    const controlMedianMaximum = controls.length === 0
        ? 0
        : Math.max(...controls.map((test) => test.median));
    const controlsAreConsistent = controlViolationCount === 0;
    const smallestPValue = allTests.length === 0
        ? 1
        : Math.min(...allTests.map((test) => test.pValue));
    const verdict = tests.length === 0 || controls.length === 0
        ? "null"
        : separatedCount === tests.length && controlsAreConsistent
            ? "alternative"
            : rejectedCount === 0 ||
                (controlViolationCount === 0 &&
                    tests.every((test) => test.median <= toleranceNats))
                ? "null"
                : "mixed";
    return {
        alternativeHolds: verdict === "alternative",
        rejectedCount,
        testCount: tests.length,
        smallestPValue,
        alpha: allTests[0]?.alpha ?? DEFAULT_ALPHA,
        verdict,
        controlMedianMaximum,
        controlViolationCount,
        controlTestCount: controls.length,
    };
}
/**
 * Decide the hypothesis verdict of one run.
 *
 * The verdict comes from the hypothesis tests of every provider of the run.
 *
 * @param providers - the provider results.
 * @param toleranceNats - the practical tolerance.
 * @returns the session hypothesis.
 */
export function computeSessionHypothesis(providers, toleranceNats) {
    const allTests = providers.flatMap((provider) => provider.comparisons.map((summary) => summary.hypothesis));
    return decideSessionHypothesis(allTests, toleranceNats);
}
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
export function computeProviderResult(records, toleranceNats, randomSeed, sampleCount = DEFAULT_BOOTSTRAP_SAMPLE_COUNT, alpha = DEFAULT_ALPHA) {
    const first = records[0];
    if (first === undefined) {
        throw new Error("The provider result needs at least one task record.");
    }
    const summaries = COMPARISON_NAMES.map((comparison) => summarizeRecords(records, comparison, randomSeed, sampleCount, alpha));
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
        languages: groupRecords(records, (record) => record.task.language ?? "unknown", randomSeed, sampleCount, alpha),
        categories: groupRecords(records, (record) => record.task.category, randomSeed, sampleCount, alpha),
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
    const alpha = options.alpha ?? DEFAULT_ALPHA;
    const byProvider = new Map();
    for (const record of options.records) {
        const bucket = byProvider.get(record.providerKey) ?? [];
        bucket.push(record);
        byProvider.set(record.providerKey, bucket);
    }
    const providers = [];
    for (const bucket of byProvider.values()) {
        providers.push(computeProviderResult(bucket, options.toleranceNats, options.randomSeed, options.sampleCount ?? DEFAULT_BOOTSTRAP_SAMPLE_COUNT, alpha));
    }
    return {
        xid: options.xid,
        protocolVersion: options.protocolVersion,
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
        hypothesis: computeSessionHypothesis(providers, options.toleranceNats),
    };
}
