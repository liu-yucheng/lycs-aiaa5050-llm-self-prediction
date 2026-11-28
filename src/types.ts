// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * Data model of the experiment.
 *
 * One task holds a sentence prefix. One prediction record holds the table of one condition. One
 * task record holds every prediction of one task on one model, and the three comparisons that the
 * protocol defines. One provider result aggregates the task records of one model.
 */

import type { COMPARISON_NAMES, CONDITION_NAMES } from "./constants.js";

/** One next-token task. */
export interface Task {
  /** The stable identifier, as in `Z001`. */
  readonly id: string;
  /** The topic of the task, as in `poetry`. */
  readonly category: string;
  /** The language tag, as in `zh-Hans` or `en-US`. */
  readonly language?: string;
  /** The text before the target position. */
  readonly prefix: string;
  /** The token that a person expects. It is a sanity label and does not enter a metric. */
  readonly referenceToken: string;
}

/** One dataset file. */
export interface Dataset {
  /** The identifier of the dataset. */
  readonly datasetId: string;
  /** The language tag of the tasks, or a comma-separated list of tags. */
  readonly language: string;
  /** The description of the dataset. */
  readonly description: string;
  /** The number of tasks. */
  readonly taskCount: number;
  /** The tasks in file order. */
  readonly tasks: readonly Task[];
}

/** One provider definition of the catalog. */
export interface ProviderDefinition {
  /** The provider key, as in `huggingface`. */
  readonly key: string;
  /** The display label. */
  readonly label: string;
  /** The base URL of the OpenAI-compatible endpoint. */
  readonly baseUrl: string;
  /** The default model. */
  readonly model: string;
  /** The model list. The plugin expands the list into one provider per model. */
  readonly models?: readonly string[];
  /** The name of the environment variable that holds the API key. */
  readonly apiKeyEnvironmentVariable: string;
  /** The section name of the environment file. */
  readonly environmentPrefix?: string;
  /** The table entry count of the provider. */
  readonly topLogprobsCount?: number;
  /**
   * The lower table entry counts that the provider may accept.
   *
   * An endpoint can cap the entry count. The client requests the configured count and retries
   * with the next lower count of this list when the endpoint denies the request.
   */
  readonly topLogprobsFallbackCounts?: readonly number[];
  /**
   * The name of the completion budget field.
   *
   * A value of `max_tokens` is the classic field. A value of `max_completion_tokens` is the field
   * of a reasoning endpoint, which denies the classic field.
   */
  readonly completionTokenField?: "max_tokens" | "max_completion_tokens";
  /**
   * The completion budget of one served table request.
   *
   * A reasoning endpoint spends the budget on its reasoning before it writes the table, so such
   * an endpoint needs a budget above one.
   */
  readonly servedTableTokenBudget?: number;
  /**
   * The request temperature.
   *
   * A number sets the field of every request. A value of `default` omits the field, so the
   * endpoint uses its own default value. A reasoning endpoint can deny a value of zero.
   */
  readonly temperature?: number | "default";
  /**
   * The shape of the served distribution.
   *
   * A value of full means that the endpoint serves a real table of candidate tokens. A value of
   * chosen-only means that the endpoint serves the chosen token only and fills every other entry
   * with a placeholder.
   */
  readonly distribution?: "full" | "chosen-only";
  /** The network edge that carries a request when the base URL host is blocked. */
  readonly edgeHost?: string;
  /** The `thinking` switch, as in `disabled`. */
  readonly thinking?: string;
  /** The `reasoning` switch, as in `disabled`. */
  readonly reasoning?: string;
  /** True when the provider is enabled by the catalog. */
  readonly enabled: boolean;
}

/** One provider catalog file. */
export interface ProviderCatalog {
  /** The schema version of the file. */
  readonly schemaVersion: number;
  /** The description of the file. */
  readonly description: string;
  /** The providers in file order. */
  readonly providers: readonly ProviderDefinition[];
}

/** One token with its natural-log probability. */
export interface ProbabilityEntry {
  /** The token as the provider or the model reported it. */
  readonly token: string;
  /** The natural-log probability of the token. */
  readonly logProbability: number;
}

/** One normalized probability table. */
export interface TokenDistribution {
  /** The entries sorted from the highest probability to the lowest. */
  readonly entries: readonly ProbabilityEntry[];
  /** The number of distinct tokens. */
  readonly supportSize: number;
  /** The total probability, which is one after normalization. */
  readonly totalProbability: number;
  /** The token with the highest probability. */
  readonly topToken: string;
  /** The probability of the top token. */
  readonly topProbability: number;
}

/** The name of one condition of the protocol. */
export type ConditionName = (typeof CONDITION_NAMES)[number];

/** The name of one comparison of the protocol. */
export type ComparisonName = (typeof COMPARISON_NAMES)[number];

/** One prediction record. */
export interface PredictionRecord {
  /** The condition that produced the record. */
  readonly condition: ConditionName;
  /** The repetition number, which starts at one. */
  readonly repetition: number;
  /** The ISO timestamp of the request. */
  readonly requestedAt: string;
  /** The elapsed time of the request in milliseconds. */
  readonly elapsedMilliseconds: number;
  /** The chosen token of a served table; absent for a self report. */
  readonly token?: string;
  /** The normalized table of the record. */
  readonly distribution: TokenDistribution;
  /** The origin of the table. */
  readonly source: "provider_logprobs" | "self_report";
  /** The raw file names of the record, relative to the run directory. */
  readonly rawFileNames: readonly string[];
  /** The endpoint of the request. */
  readonly endpoint: string;
  /** The request body without the API key. */
  readonly requestBody: unknown;
  /** A warning about the record, for example a slow request. */
  readonly warning?: string;
}

/** The comparison of one predicted table with one actual table. */
export interface ComparisonMetrics {
  /** The repetition number of the actual table. */
  readonly actualRepetition: number;
  /** The repetition number of the predicted table. */
  readonly predictedRepetition: number;
  /** The divergence from the actual table to the predicted table, in nats. */
  readonly klActualPredicted: number;
  /** The divergence from the predicted table to the actual table, in nats. */
  readonly klPredictedActual: number;
  /** The mean of the two directed divergences, in nats. */
  readonly symmetricKl: number;
  /** The Jensen-Shannon divergence, in nats. */
  readonly jensenShannon: number;
  /** The total-variation distance, in the range from zero to one. */
  readonly totalVariation: number;
  /** True when both tables share their top token. */
  readonly topTokenAgreement: boolean;
  /** The probability that the predicted table gives to the support of the actual table. */
  readonly coveragePredictedByActual: number;
  /** The probability that the actual table gives to the support of the predicted table. */
  readonly coverageActualByPredicted: number;
  /** The number of distinct tokens in the union of both supports. */
  readonly unionSupportSize: number;
}

/** The result of one one-sided hypothesis test over the tasks of one model. */
export interface HypothesisTest {
  /** The name of the test, as in `wilcoxon_signed_rank`. */
  readonly testName: string;
  /** The name of the comparison that the test reads. */
  readonly comparison: ComparisonName;
  /** The number of task values in the test. */
  readonly sampleCount: number;
  /** The value that the null hypothesis names, in nats. */
  readonly nullValue: number;
  /** The median of the task values, in nats. */
  readonly median: number;
  /** The sum of the ranks of the positive differences. */
  readonly statistic: number;
  /** The normal-approximation score of the statistic. */
  readonly zScore: number;
  /** The one-sided p-value of the score. */
  readonly pValue: number;
  /** The significance level of the test. */
  readonly alpha: number;
  /** True when the test rejects the null hypothesis at the significance level. */
  readonly rejectsNull: boolean;
}

/** The summary of one comparison over every pair of one model. */
export interface ComparisonSummary {
  /** The name of the comparison. */
  readonly comparison: ComparisonName;
  /** The number of compared pairs. */
  readonly pairCount: number;
  /** The mean divergence from the actual table to the predicted table. */
  readonly meanKlActualPredicted: number;
  /** The mean divergence from the predicted table to the actual table. */
  readonly meanKlPredictedActual: number;
  /** The mean symmetric divergence. */
  readonly meanSymmetricKl: number;
  /** The median symmetric divergence. */
  readonly medianSymmetricKl: number;
  /** The mean Jensen-Shannon divergence. */
  readonly meanJensenShannon: number;
  /** The mean total-variation distance. */
  readonly meanTotalVariation: number;
  /** The fraction of pairs that share their top token. */
  readonly topTokenAgreementRate: number;
  /** The mean coverage of the predicted table by the actual support. */
  readonly meanCoveragePredictedByActual: number;
  /** The mean coverage of the actual table by the predicted support. */
  readonly meanCoverageActualByPredicted: number;
  /** The mean size of the union support. */
  readonly meanUnionSupportSize: number;
  /** The bootstrap interval of the mean symmetric divergence over tasks. */
  readonly confidenceInterval: ConfidenceInterval;
  /** The one-sided hypothesis test of the task values against the tolerance. */
  readonly hypothesis: HypothesisTest;
}

/** One bootstrap confidence interval. */
export interface ConfidenceInterval {
  /** The lower bound. */
  readonly lower: number;
  /** The upper bound. */
  readonly upper: number;
  /** The confidence level. */
  readonly confidenceLevel: number;
  /** The number of resamples. */
  readonly sampleCount: number;
  /** The random seed of the resampling. */
  readonly randomSeed: number;
}

/** The verdict about one comparison of one model. */
export type Verdict = "separated" | "indistinguishable" | "inconclusive";

/** One combination of a comparison name and a verdict. */
export interface VerdictEntry {
  /** The name of the comparison. */
  readonly comparison: ComparisonName;
  /** The verdict. */
  readonly verdict: Verdict;
  /** The lower bound of the interval. */
  readonly intervalLower: number;
  /** The upper bound of the interval. */
  readonly intervalUpper: number;
}

/** The records and the comparisons of one task on one model. */
export interface TaskRecord {
  /** The task. */
  readonly task: Task;
  /** The provider key of the model, as in `huggingface-Qwen-Qwen3-Coder-Next`. */
  readonly providerKey: string;
  /** The display label of the provider. */
  readonly providerLabel: string;
  /** The model name. */
  readonly model: string;
  /** The predictions of each condition in repetition order. */
  readonly predictions: Readonly<Record<ConditionName, readonly PredictionRecord[]>>;
  /** The comparisons in canonical order. */
  readonly comparisons: Readonly<Record<ComparisonName, readonly ComparisonMetrics[]>>;
  /** The warnings of the task. */
  readonly warnings: readonly string[];
  /** The errors of the task. */
  readonly errors: readonly string[];
}

/** The aggregated result of one model. */
export interface ProviderResult {
  /** The provider key of the model. */
  readonly providerKey: string;
  /** The display label of the provider. */
  readonly providerLabel: string;
  /** The model name. */
  readonly model: string;
  /** The number of tasks that hold a result. */
  readonly taskCount: number;
  /** The summaries in canonical order. */
  readonly comparisons: readonly ComparisonSummary[];
  /** The verdicts in canonical order. */
  readonly verdicts: readonly VerdictEntry[];
  /** The result grouped by language tag. */
  readonly languages: readonly GroupResult[];
  /** The result grouped by task category. */
  readonly categories: readonly GroupResult[];
  /** The warnings of the model. */
  readonly warnings: readonly string[];
}

/** The aggregated result of one group of tasks, for example one language. */
export interface GroupResult {
  /** The group name. */
  readonly name: string;
  /** The number of tasks in the group. */
  readonly taskCount: number;
  /** The summaries in canonical order. */
  readonly comparisons: readonly ComparisonSummary[];
}

/** The summary of one hypothesis test over every model of a run. */
export interface SessionHypothesis {
  /** True when the alternative hypothesis holds for the run. */
  readonly alternativeHolds: boolean;
  /** The number of tests that reject the null hypothesis at the significance level. */
  readonly rejectedCount: number;
  /** The number of tests in the run. */
  readonly testCount: number;
  /** The smallest p-value of the run. */
  readonly smallestPValue: number;
  /** The significance level of the run. */
  readonly alpha: number;
  /** The short statement of the verdict, as in `alternative`. */
  readonly verdict: "alternative" | "null" | "mixed";
  /** The largest control median of the run, in nats. */
  readonly controlMedianMaximum: number;
  /** The number of control tests that stand above the tolerance. */
  readonly controlViolationCount: number;
  /** The number of control tests in the run. */
  readonly controlTestCount: number;
}

/** The metrics of one run. */
export interface SessionMetrics {
  /** The run identifier. */
  readonly xid: string;
  /** The protocol version of the run. */
  readonly protocolVersion: string;
  /** The dataset identifiers. */
  readonly datasetIds: readonly string[];
  /** The language tags of the dataset. */
  readonly languages: readonly string[];
  /** The ISO timestamp of the generation. */
  readonly generatedAt: string;
  /** The divergence in nats below which two tables count as the same table. */
  readonly toleranceNats: number;
  /** The number of repetitions of one condition. */
  readonly repetitionCount: number;
  /** The number of requested table entries. */
  readonly topLogprobsCount: number;
  /** The random seed of the run. */
  readonly randomSeed: number;
  /** The number of tasks. */
  readonly taskCount: number;
  /** The results in provider order. */
  readonly providers: readonly ProviderResult[];
  /** The verdicts of every provider and comparison. */
  readonly verdicts: readonly ProviderVerdict[];
  /** The verdict of the hypothesis test of the run. */
  readonly hypothesis: SessionHypothesis;
}

/** One verdict of one provider. */
export interface ProviderVerdict {
  /** The provider key. */
  readonly providerKey: string;
  /** The model name. */
  readonly model: string;
  /** The verdict entries in canonical order. */
  readonly verdicts: readonly VerdictEntry[];
}

/** The options of one run. */
export interface RunOptions {
  /** The requested provider keys, or an empty list for every enabled provider. */
  readonly providerKeys: readonly string[];
  /** The requested task identifiers, or an empty list for every task. */
  readonly taskIds: readonly string[];
  /** The repetition count of one condition. */
  readonly repetitionCount: number;
  /** The divergence tolerance in nats. */
  readonly toleranceNats: number;
  /** The output root. */
  readonly outputDirectory: string;
  /** The one run folder of the run. */
  readonly folder: string;
  /** True when the run revises an existing folder. */
  readonly revise: boolean;
  /** The random seed. */
  readonly randomSeed: number;
  /** The number of tasks that run at the same time. */
  readonly maxConcurrency: number;
  /** The requested table entry count. */
  readonly topLogprobsCount: number;
  /** True when the run uses the mock provider and no network. */
  readonly dryRun: boolean;
}

/** The reused and the requested record counts of one run. */
export interface ReuseSummary {
  /** The number of prediction records that the run read from the intermediate directory. */
  readonly reusedRecordCount: number;
  /** The number of prediction records that the run requested. */
  readonly requestedRecordCount: number;
  /** The number of raw files that a revise pass removed. */
  readonly droppedFileCount: number;
}

/** One revision of one run folder. */
export interface RevisionRecord {
  /** The ISO timestamp of the revision. */
  readonly revisedAt: string;
  /** The plugin version of the revision. */
  readonly pluginVersion: string;
  /** The protocol version of the revision. */
  readonly protocolVersion: string;
  /** The repetition count of the revision. */
  readonly repetitionCount: number;
  /** The providers of the revision. */
  readonly providers: readonly string[];
  /** The reused and the requested record counts. */
  readonly reuse: ReuseSummary;
  /** The raw files that the revision removed, relative to the run folder. */
  readonly droppedFileNames: readonly string[];
}

/** The environment record of one run. */
export interface SessionEnvironment {
  /** The Node.js version. */
  readonly nodeVersion: string;
  /** The platform identifier. */
  readonly platform: string;
  /** The plugin name. */
  readonly pluginName: string;
  /** The plugin version. */
  readonly pluginVersion: string;
  /** The protocol version. */
  readonly protocolVersion: string;
  /** The random seed. */
  readonly randomSeed: number;
  /** The ISO timestamp of the start. */
  readonly startedAt: string;
  /** The ISO timestamp of the end. */
  readonly finishedAt: string;
  /** The elapsed time in seconds. */
  readonly elapsedSeconds: number;
  /** The path of the environment file. */
  readonly environmentFile?: string;
  /** True when the run created the environment file. */
  readonly environmentFileCreated?: boolean;
  /** The path of the public configuration file. */
  readonly configFile?: string;
}

/** The manifest of one run. */
export interface SessionManifest {
  /** The run identifier. */
  readonly xid: string;
  /** The protocol version of the run. */
  readonly protocolVersion: string;
  /** The run identifier of the folder that this run revised. */
  readonly previousXid?: string;
  /** The revisions of the run folder, oldest first. */
  readonly revisions?: readonly RevisionRecord[];
  /** The dataset identifiers. */
  readonly datasetIds: readonly string[];
  /** The digest of the task list. */
  readonly datasetHash: string;
  /** The ISO timestamp of the creation. */
  readonly createdAt: string;
  /** The options of the run. */
  readonly options: RunOptions;
  /** The provider keys of the run. */
  readonly providers: readonly string[];
  /** The environment record. */
  readonly environment: SessionEnvironment;
  /** The status of the run. */
  readonly status: "running" | "complete" | "failed";
  /** The failure message. */
  readonly failure?: string;
}

/** The result of one run. */
export interface RunResult {
  /** The run identifier. */
  readonly xid: string;
  /** The run directory. */
  readonly directory: string;
  /** The metrics of the run. */
  readonly metrics: SessionMetrics;
  /** The path of the Markdown report. */
  readonly reportPath: string;
  /** The path of the overview webpage. */
  readonly demosPath: string;
  /** The reused and the requested record counts. */
  readonly reuse: ReuseSummary;
  /** The warnings of the run. */
  readonly warnings: readonly string[];
}

/** The status of one run directory. */
export interface SessionStatus {
  /** The run identifier. */
  readonly xid: string;
  /** The run directory. */
  readonly directory: string;
  /** The status of the run. */
  readonly status: "running" | "complete" | "failed";
  /** The ISO timestamp of the creation. */
  readonly createdAt: string;
  /** The number of tasks. */
  readonly taskCount: number;
  /** The verdicts of the run. */
  readonly verdicts: readonly ProviderVerdict[];
  /** The failure message. */
  readonly failures: readonly string[];
}

/** The summary of one dataset file. */
export interface DatasetSummary {
  /** The dataset identifier. */
  readonly datasetId: string;
  /** The language tag. */
  readonly language: string;
  /** The description. */
  readonly description: string;
  /** The number of tasks. */
  readonly taskCount: number;
  /** The first tasks, for a short display. */
  readonly sample: readonly Task[];
}
