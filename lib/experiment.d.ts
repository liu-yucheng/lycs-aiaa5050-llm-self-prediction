import type { DatasetSummary, RunResult, SessionStatus } from "./types.js";
/** The request of one run. */
export interface RunRequest {
    /** The requested provider keys or model keys. */
    readonly providerKeys?: readonly string[];
    /** The requested task identifiers. */
    readonly taskIds?: readonly string[];
    /** The repetition count of one condition. */
    readonly repetitions?: number;
    /** The divergence tolerance in nats. */
    readonly toleranceNats?: number;
    /** The output root. */
    readonly outputDirectory?: string;
    /** The random seed. */
    readonly randomSeed?: number;
    /** The number of tasks that run at the same time. */
    readonly maxConcurrency?: number;
    /** The requested table entry count. */
    readonly topLogprobsCount?: number;
    /** True to use the mock provider and no network. */
    readonly dryRun?: boolean;
}
/** The options of the experiment service. */
export interface ExperimentServiceOptions {
    /** Resolve the workspace directory of one agent. */
    readonly resolveWorkspace: (agent?: {
        readonly id?: string;
    }, signal?: AbortSignal) => Promise<string>;
    /** The configured output root. */
    readonly outputRoot: () => string;
    /** The configured maximum concurrency. */
    readonly defaultMaxConcurrency?: number;
    /** The logger of the host. */
    readonly logger?: {
        info: (message: string) => void;
        warn: (message: string) => void;
        error: (message: string) => void;
    };
}
/**
 * Build one run identifier from the start time.
 *
 * The identifier has the shape `<timestamp>_<short-unique-id>`.
 *
 * @param startedAt - the start time of the run.
 * @returns the run identifier.
 */
export declare function createRunId(startedAt: Date): string;
/**
 * The service that runs the experiment.
 */
export declare class ExperimentService {
    /** The options of the service. */
    private readonly options;
    /**
     * Create one service.
     *
     * @param options - the options of the service.
     */
    constructor(options: ExperimentServiceOptions);
    /**
     * Run one experiment.
     *
     * @param agent - the agent that asks for the run.
     * @param request - the run request.
     * @param signal - the cancellation signal.
     * @returns the run result.
     */
    run(agent: {
        readonly id?: string;
    } | undefined, request: RunRequest, signal?: AbortSignal): Promise<RunResult>;
    /**
     * List the status of each run below the output root.
     *
     * @param agent - the agent that asks.
     * @param signal - the cancellation signal.
     * @param limit - the number of runs to report.
     * @returns the statuses, newest first.
     */
    status(agent: {
        readonly id?: string;
    } | undefined, signal?: AbortSignal, limit?: number): Promise<SessionStatus[]>;
    /**
     * Read the task count and the verdicts of one run directory.
     *
     * @param directory - the run directory.
     * @returns the task count and the verdicts; both are empty when the metrics file is absent.
     */
    private readRunDetails;
    /**
     * Read one run report.
     *
     * @param agent - the agent that asks.
     * @param signal - the cancellation signal.
     * @param xid - the run identifier, or an empty string for the newest run.
     * @returns the report text and the run directory.
     */
    report(agent: {
        readonly id?: string;
    } | undefined, signal?: AbortSignal, xid?: string): Promise<{
        xid: string;
        directory: string;
        report: string;
    }>;
    /**
     * Write the demonstration website of one run again.
     *
     * The method reads the recorded metrics, records, and environment of the run. It writes the
     * seven pages and the assets from the current templates, so a template change reaches a run
     * that is already complete.
     *
     * @param agent - the agent that asks.
     * @param signal - the cancellation signal.
     * @param xid - the run identifier, or an empty string for the newest run.
     * @returns the run identifier and the path of the entry page.
     */
    rewriteDemos(agent: {
        readonly id?: string;
    } | undefined, signal?: AbortSignal, xid?: string): Promise<{
        xid: string;
        directory: string;
        entryPath: string;
    }>;
    /**
     * Describe the dataset of one workspace.
     *
     * @param agent - the agent that asks.
     * @param signal - the cancellation signal.
     * @param sampleSize - the number of tasks to show per file.
     * @returns the dataset summaries.
     */
    datasetSummary(agent: {
        readonly id?: string;
    } | undefined, signal?: AbortSignal, sampleSize?: number): Promise<DatasetSummary[]>;
    /**
     * Run each task of each model.
     *
     * @param clients - the active clients.
     * @param tasks - the selected tasks.
     * @param repetitionCount - the repetition count of one condition.
     * @param intermediateDirectory - the intermediate directory.
     * @param resultsDirectory - the results directory.
     * @param maxConcurrency - the number of tasks that run at the same time.
     * @param signal - the cancellation signal.
     * @returns the task records.
     */
    private runJobs;
    /**
     * Run one task on one model.
     *
     * @param client - the client.
     * @param task - the task.
     * @param repetitionCount - the repetition count of one condition.
     * @param intermediateDirectory - the intermediate directory.
     * @param resultsDirectory - the results directory.
     * @param signal - the cancellation signal.
     * @returns the task record.
     */
    private runOneTask;
    /**
     * Write one outcome and build its record.
     *
     * @param outcome - the outcome to write.
     * @param taskDirectory - the intermediate task directory.
     * @param callNumber - the call number of the condition.
     * @returns the prediction record.
     */
    private recordOutcome;
    /**
     * Write the raw exchanges of one prediction.
     *
     * @param outcome - the prediction outcome.
     * @param taskDirectory - the directory of the task.
     * @param callNumber - the number of the first call of the outcome.
     * @returns the raw file names relative to the run directory.
     */
    private writeExchanges;
}
