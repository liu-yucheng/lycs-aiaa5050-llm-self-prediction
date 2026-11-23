/**
 * Data types of the experiment.
 *
 * The types separate the read-only inputs, the raw provider answers, the parsed distributions,
 * the derived metrics, and the written session files.
 */
/** One next-token task of the bundled dataset. */
export interface Task {
    readonly id: string;
    readonly category: string;
    /** The language tag of the task, such as zh-Hans or en-US. */
    readonly language?: string;
    readonly prefix: string;
    readonly referenceToken: string;
}
/** The bundled dataset. */
export interface Dataset {
    readonly datasetId: string;
    readonly language: string;
    /** The language tags that the dataset declares. */
    readonly languages?: readonly string[];
    readonly description: string;
    readonly taskCount: number;
    readonly tasks: readonly Task[];
}
/** One provider definition of the provider catalog. */
export interface ProviderDefinition {
    readonly key: string;
    readonly label: string;
    readonly baseUrl: string;
    readonly model: string;
    /** The model identifiers that the provider expands into. */
    readonly models?: readonly string[];
    readonly apiKeyEnvironmentVariable: string;
    readonly environmentPrefix?: string;
    readonly topLogprobsCount?: number;
    readonly thinking?: string;
    /** The reasoning switch: `disabled` turns reasoning off. */
    readonly reasoning?: string;
    readonly enabled: boolean;
}
/** The provider catalog. */
export interface ProviderCatalog {
    readonly schemaVersion: number;
    readonly description: string;
    readonly providers: readonly ProviderDefinition[];
}
/** One token with a natural-log probability. */
export interface ProbabilityEntry {
    readonly token: string;
    readonly logProbability: number;
}
/** One parsed distribution over the reported top tokens. */
export interface TokenDistribution {
    readonly entries: readonly ProbabilityEntry[];
    readonly supportSize: number;
    readonly totalProbability: number;
    readonly topToken: string;
    readonly topProbability: number;
}
/** One raw prediction answer of one provider. */
export interface PredictionAnswer {
    readonly mode: "actual" | "self";
    readonly repetition: number;
    readonly requestedAt: string;
    readonly elapsedMilliseconds: number;
    readonly token: string;
    readonly distribution: TokenDistribution;
    readonly raw: unknown;
    readonly rawFileName: string;
    readonly endpoint: string;
    readonly requestBody: unknown;
    readonly warning?: string;
}
/** The divergence metrics of one actual-versus-self pair. */
export interface PairMetrics {
    readonly actualRepetition: number;
    readonly selfRepetition: number;
    readonly klActualSelf: number;
    readonly klSelfActual: number;
    readonly symmetricKl: number;
    readonly jensenShannon: number;
    readonly totalVariation: number;
    readonly topTokenAgreement: boolean;
    readonly coverageSelfByActual: number;
    readonly coverageActualBySelf: number;
    readonly unionSupportSize: number;
}
/** The metrics of one self-versus-self or actual-versus-actual baseline pair. */
export interface BaselinePairMetrics {
    readonly firstRepetition: number;
    readonly secondRepetition: number;
    readonly symmetricKl: number;
    readonly jensenShannon: number;
    readonly totalVariation: number;
    readonly topTokenAgreement: boolean;
}
/** The summary of one set of pair metrics. */
export interface MetricSummary {
    readonly pairCount: number;
    readonly meanKlActualSelf: number;
    readonly meanKlSelfActual: number;
    readonly meanSymmetricKl: number;
    readonly medianSymmetricKl: number;
    readonly meanJensenShannon: number;
    readonly meanTotalVariation: number;
    readonly topTokenAgreementRate: number;
    readonly meanCoverageSelfByActual: number;
    readonly meanCoverageActualBySelf: number;
    readonly meanUnionSupportSize: number;
}
/** The record of one task and one provider. */
export interface TaskRecord {
    readonly task: Task;
    readonly providerKey: string;
    readonly provider: ProviderDefinition;
    readonly actual: readonly PredictionAnswer[];
    readonly self: readonly PredictionAnswer[];
    readonly pairs: readonly PairMetrics[];
    readonly actualBaseline: readonly BaselinePairMetrics[];
    readonly selfBaseline: readonly BaselinePairMetrics[];
    readonly summary: MetricSummary;
    readonly baselineSymmetricKl: number;
    readonly warnings: readonly string[];
    readonly errors: readonly string[];
}
/** One confidence interval of a mean. */
export interface ConfidenceInterval {
    readonly lower: number;
    readonly upper: number;
    readonly confidenceLevel: number;
    readonly sampleCount: number;
    readonly randomSeed: number;
}
/** The verdict of one model against the null hypothesis. */
export type Verdict = "separated" | "indistinguishable" | "inconclusive";
/** The aggregate metrics of one provider over the tasks. */
export interface ProviderMetrics {
    readonly providerKey: string;
    readonly provider: ProviderDefinition;
    readonly taskCount: number;
    readonly pairCount: number;
    readonly summary: MetricSummary;
    readonly confidenceInterval: ConfidenceInterval;
    readonly baselineSymmetricKl: number;
    readonly separatedFraction: number;
    readonly verdict: Verdict;
    readonly categories: Readonly<Record<string, MetricSummary>>;
    /** The summary of each declared language tag. */
    readonly languages: Readonly<Record<string, MetricSummary>>;
    readonly warnings: readonly string[];
}
/** The whole metrics file of one session. */
export interface SessionMetrics {
    readonly sessionCode: string;
    readonly datasetId: string;
    /** The language tags of the dataset, such as zh-Hans, en-US. */
    readonly datasetLanguage: string;
    readonly generatedAt: string;
    readonly toleranceNats: number;
    readonly repetitionCount: number;
    readonly topLogprobsCount: number;
    readonly randomSeed: number;
    readonly taskCount: number;
    readonly providers: readonly ProviderMetrics[];
    readonly verdicts: Readonly<Record<string, Verdict>>;
}
/** The environment facts that a session records. */
export interface SessionEnvironment {
    readonly nodeVersion: string;
    readonly platform: string;
    readonly pluginName: string;
    readonly pluginVersion: string;
    readonly randomSeed: number;
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly elapsedSeconds: number;
    readonly environmentFile?: string;
    readonly environmentFileCreated?: boolean;
}
/** The options of one experiment run. */
export interface RunOptions {
    readonly providerKeys: readonly string[];
    readonly taskIds: readonly string[];
    readonly repetitionCount: number;
    readonly toleranceNats: number;
    readonly outputDirectory: string;
    readonly randomSeed: number;
    readonly maxConcurrency: number;
    readonly topLogprobsCount: number;
    readonly dryRun: boolean;
}
/** The session file of one run. */
export interface SessionManifest {
    readonly sessionCode: string;
    readonly datasetId: string;
    readonly datasetHash: string;
    readonly createdAt: string;
    readonly options: RunOptions;
    readonly providers: readonly ProviderDefinition[];
    readonly environment: SessionEnvironment;
    readonly status: "running" | "complete" | "failed";
    readonly failure?: string;
}
/** The result of one experiment run. */
export interface RunResult {
    readonly sessionCode: string;
    readonly outputDirectory: string;
    readonly metrics: SessionMetrics;
    readonly reportPath: string;
    readonly warnings: readonly string[];
}
