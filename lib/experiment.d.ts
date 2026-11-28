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
    /** The significance level of each hypothesis test. */
    readonly alpha?: number;
    /** The output root. */
    readonly outputDirectory?: string;
    /** The one folder of this run, as a name below the output root or as an absolute path. */
    readonly folder?: string;
    /** True to rename the folder at the end of the run. */
    readonly renameFolder?: boolean;
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
        /** Write one information line. */
        info: (message: string) => void;
        /** Write one warning line. */
        warn: (message: string) => void;
        /** Write one error line. */
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
 * Resolve the one output folder of one run.
 *
 * A request that names no folder gets a fresh folder. A request that names a path gets that path. A
 * request that names a bare folder name gets the folder below the output root.
 *
 * @param options - the output root and the requested folder.
 * @returns the absolute folder path and the folder name.
 */
export declare function resolveRunFolder(options: {
    readonly outputRoot: string;
    readonly folder: string;
    readonly startedAt: Date;
}): {
    directory: string;
    name: string;
};
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
     * Run one experiment on one output folder.
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
     * Rename one output folder to a fresh identifier.
     *
     * The method moves the folder, rewrites the identifier in the manifest and in the metrics, and
     * writes the demos again, so each page names the folder that holds it.
     *
     * @param agent - the agent that asks.
     * @param signal - the cancellation signal.
     * @param folder - the folder name, or an empty string for the newest folder.
     * @returns the previous identifier, the new identifier, and the new directory.
     */
    rename(agent: {
        readonly id?: string;
    } | undefined, signal?: AbortSignal, folder?: string): Promise<{
        previousXid: string;
        xid: string;
        directory: string;
    }>;
    /**
     * Move one folder to a fresh identifier and rewrite the recorded identity.
     *
     * @param options - the output root, the current directory, and the current manifest.
     * @returns the new identifier and the new directory.
     */
    private applyRename;
    /**
     * Write the demos of one folder again from the recorded files.
     *
     * @param directory - the folder.
     */
    private rewriteDemosFor;
    /**
     * Resolve one existing folder below the output root.
     *
     * @param outputRoot - the output root.
     * @param folder - the folder name, or an empty string for the newest folder.
     * @returns the folder path.
     */
    private resolveExistingFolder;
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
     * pages and the assets from the current templates, so a template change reaches a run that is
     * already complete.
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
     * @param scan - the reuse scan of the folder.
     * @param counter - the record counter of the run.
     * @param signal - the cancellation signal.
     * @returns the task records.
     */
    private runJobs;
    /**
     * Run one task on one model.
     *
     * @param options - the client, the task, the repetition count, the directories, the reused data,
     * the counter, and the signal.
     * @returns the task record.
     */
    private runOneTask;
    /**
     * Write the marker of one reused first call of `actual_injected_actual`.
     *
     * @param taskDirectory - the intermediate task directory.
     * @param repetition - the repetition number.
     */
    private ensureFirstCallMarker;
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
