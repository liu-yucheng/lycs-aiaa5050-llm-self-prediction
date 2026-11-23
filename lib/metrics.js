// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * Metrics of the experiment.
 *
 * One task and one provider give four actual predictions and four self predictions, so there are
 * sixteen actual-versus-self pairs. Every pair reports both directed divergences, their mean, the
 * Jensen-Shannon divergence, and the total-variation distance. Two baseline sets show the width of
 * the sampling noise of each mode alone.
 */
import { DEFAULT_BOOTSTRAP_SAMPLE_COUNT, DEFAULT_RANDOM_SEED, DEFAULT_TOLERANCE_NATS, } from "./constants.js";
import { alignDistributions, coverage, jensenShannonDivergence, klDivergence, mean, median, symmetricKlDivergence, topTokenAgreement, totalVariationDistance, } from "./probability.js";
/**
 * Compute the metrics of one actual-versus-self pair.
 *
 * @param actual - the actual prediction.
 * @param self - the self prediction.
 * @returns the pair metrics.
 */
export function computePairMetrics(actual, self) {
    const aligned = alignDistributions(actual.distribution, self.distribution);
    return {
        actualRepetition: actual.repetition,
        selfRepetition: self.repetition,
        klActualSelf: klDivergence(aligned.left, aligned.right),
        klSelfActual: klDivergence(aligned.right, aligned.left),
        symmetricKl: symmetricKlDivergence(aligned.left, aligned.right),
        jensenShannon: jensenShannonDivergence(aligned.left, aligned.right),
        totalVariation: totalVariationDistance(aligned.left, aligned.right),
        topTokenAgreement: topTokenAgreement(actual.distribution, self.distribution),
        coverageSelfByActual: coverage(self.distribution, actual.distribution),
        coverageActualBySelf: coverage(actual.distribution, self.distribution),
        unionSupportSize: aligned.tokens.length,
    };
}
/**
 * Compute the metrics of one pair of the same prediction mode.
 *
 * @param first - the first prediction.
 * @param second - the second prediction.
 * @returns the baseline pair metrics.
 */
export function computeBaselinePairMetrics(first, second) {
    const aligned = alignDistributions(first.distribution, second.distribution);
    return {
        firstRepetition: first.repetition,
        secondRepetition: second.repetition,
        symmetricKl: symmetricKlDivergence(aligned.left, aligned.right),
        jensenShannon: jensenShannonDivergence(aligned.left, aligned.right),
        totalVariation: totalVariationDistance(aligned.left, aligned.right),
        topTokenAgreement: topTokenAgreement(first.distribution, second.distribution),
    };
}
/**
 * Compute the summary of one set of pair metrics.
 *
 * @param pairs - the pair metrics.
 * @returns the summary; an empty list gives zeros.
 */
export function summarizePairs(pairs) {
    return {
        pairCount: pairs.length,
        meanKlActualSelf: mean(pairs.map((pair) => pair.klActualSelf)),
        meanKlSelfActual: mean(pairs.map((pair) => pair.klSelfActual)),
        meanSymmetricKl: mean(pairs.map((pair) => pair.symmetricKl)),
        medianSymmetricKl: median(pairs.map((pair) => pair.symmetricKl)),
        meanJensenShannon: mean(pairs.map((pair) => pair.jensenShannon)),
        meanTotalVariation: mean(pairs.map((pair) => pair.totalVariation)),
        topTokenAgreementRate: mean(pairs.map((pair) => (pair.topTokenAgreement ? 1 : 0))),
        meanCoverageSelfByActual: mean(pairs.map((pair) => pair.coverageSelfByActual)),
        meanCoverageActualBySelf: mean(pairs.map((pair) => pair.coverageActualBySelf)),
        meanUnionSupportSize: mean(pairs.map((pair) => pair.unionSupportSize)),
    };
}
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
export function buildTaskRecord(task, provider, actual, self, errors) {
    const pairs = [];
    for (const actualAnswer of actual) {
        for (const selfAnswer of self) {
            pairs.push(computePairMetrics(actualAnswer, selfAnswer));
        }
    }
    const actualBaseline = [];
    for (let first = 0; first < actual.length; first += 1) {
        for (let second = first + 1; second < actual.length; second += 1) {
            const left = actual[first];
            const right = actual[second];
            if (left !== undefined && right !== undefined) {
                actualBaseline.push(computeBaselinePairMetrics(left, right));
            }
        }
    }
    const selfBaseline = [];
    for (let first = 0; first < self.length; first += 1) {
        for (let second = first + 1; second < self.length; second += 1) {
            const left = self[first];
            const right = self[second];
            if (left !== undefined && right !== undefined) {
                selfBaseline.push(computeBaselinePairMetrics(left, right));
            }
        }
    }
    const warnings = [];
    for (const answer of [...actual, ...self]) {
        if (answer.warning !== undefined) {
            warnings.push(`${answer.rawFileName}: ${answer.warning}`);
        }
    }
    const baselineSymmetricKl = (mean(actualBaseline.map((pair) => pair.symmetricKl)) +
        mean(selfBaseline.map((pair) => pair.symmetricKl))) /
        2;
    return {
        task,
        providerKey: provider.key,
        provider,
        actual,
        self,
        pairs,
        actualBaseline,
        selfBaseline,
        summary: summarizePairs(pairs),
        baselineSymmetricKl,
        warnings,
        errors,
    };
}
/**
 * Create one deterministic pseudo-random number generator.
 *
 * @param seed - the seed.
 * @returns a function that returns a value in `[0, 1)`.
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
 * Compute one bootstrap confidence interval of a mean.
 *
 * @param values - the observed values.
 * @param options - the sample count, the seed, and the confidence level.
 * @returns the interval; an empty list gives a zero interval.
 */
export function bootstrapConfidenceInterval(values, options = {}) {
    const sampleCount = options.sampleCount ?? DEFAULT_BOOTSTRAP_SAMPLE_COUNT;
    const randomSeed = options.randomSeed ?? DEFAULT_RANDOM_SEED;
    const confidenceLevel = options.confidenceLevel ?? 0.95;
    if (values.length === 0) {
        return { lower: 0, upper: 0, confidenceLevel, sampleCount, randomSeed };
    }
    const random = createRandomGenerator(randomSeed);
    const means = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
        let total = 0;
        for (let index = 0; index < values.length; index += 1) {
            const pick = Math.floor(random() * values.length);
            total += values[pick] ?? 0;
        }
        means.push(total / values.length);
    }
    means.sort((left, right) => left - right);
    const tail = (1 - confidenceLevel) / 2;
    const lowerIndex = Math.max(0, Math.floor(tail * (means.length - 1)));
    const upperIndex = Math.min(means.length - 1, Math.ceil((1 - tail) * (means.length - 1)));
    return {
        lower: means[lowerIndex] ?? 0,
        upper: means[upperIndex] ?? 0,
        confidenceLevel,
        sampleCount,
        randomSeed,
    };
}
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
export function decideVerdict(summary, interval, toleranceNats) {
    if (summary.pairCount === 0) {
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
 * Aggregate the task records of one provider.
 *
 * @param records - the records of one provider.
 * @param provider - the provider definition.
 * @param toleranceNats - the tolerance in nats.
 * @param randomSeed - the seed of the confidence interval.
 * @returns the provider metrics.
 */
export function computeProviderMetrics(records, provider, toleranceNats, randomSeed) {
    const pairs = records.flatMap((record) => record.pairs);
    const summary = summarizePairs(pairs);
    const interval = bootstrapConfidenceInterval(pairs.map((pair) => pair.symmetricKl), { randomSeed });
    const categories = {};
    const categoryNames = [...new Set(records.map((record) => record.task.category))].sort();
    for (const category of categoryNames) {
        const categoryPairs = records
            .filter((record) => record.task.category === category)
            .flatMap((record) => record.pairs);
        categories[category] = summarizePairs(categoryPairs);
    }
    const languages = {};
    const languageNames = [...new Set(records.map((record) => record.task.language ?? "unknown"))]
        .sort();
    for (const language of languageNames) {
        const languagePairs = records
            .filter((record) => (record.task.language ?? "unknown") === language)
            .flatMap((record) => record.pairs);
        languages[language] = summarizePairs(languagePairs);
    }
    const warnings = records.flatMap((record) => record.warnings);
    const separatedFraction = pairs.length === 0
        ? 0
        : pairs.filter((pair) => pair.symmetricKl > toleranceNats).length / pairs.length;
    return {
        providerKey: provider.key,
        provider,
        taskCount: records.length,
        pairCount: pairs.length,
        summary,
        confidenceInterval: interval,
        baselineSymmetricKl: mean(records.map((record) => record.baselineSymmetricKl)),
        separatedFraction,
        verdict: decideVerdict(summary, interval, toleranceNats),
        categories,
        languages,
        warnings,
    };
}
/**
 * Build the metrics file of one session.
 *
 * @param options - the session code, dataset, records, tolerance, repetition count, table size,
 *   seed, and generation time.
 * @returns the session metrics.
 */
export function computeSessionMetrics(options) {
    const providerMetrics = [];
    const verdicts = {};
    for (const provider of options.providers) {
        const records = options.records.filter((record) => record.providerKey === provider.key);
        const metrics = computeProviderMetrics(records, provider, options.toleranceNats, options.randomSeed);
        providerMetrics.push(metrics);
        verdicts[provider.key] = metrics.verdict;
    }
    return {
        sessionCode: options.sessionCode,
        datasetId: options.datasetId,
        datasetLanguage: options.datasetLanguage ??
            [...new Set(options.records.map((record) => record.task.language ?? "unknown"))].join(", "),
        generatedAt: options.generatedAt,
        toleranceNats: options.toleranceNats,
        repetitionCount: options.repetitionCount,
        topLogprobsCount: options.topLogprobsCount,
        randomSeed: options.randomSeed,
        taskCount: options.taskCount,
        providers: providerMetrics,
        verdicts,
    };
}
/**
 * Read the default tolerance of one run.
 *
 * @param value - the requested tolerance.
 * @returns the requested value when it is positive, else the default.
 */
export function resolveTolerance(value) {
    if (value === undefined || !Number.isFinite(value) || value <= 0) {
        return DEFAULT_TOLERANCE_NATS;
    }
    return value;
}
