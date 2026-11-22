import type { Agent, Logger } from "./dsh.js";
import type { RunResult } from "./types.js";
/** One run request from a tool or a command. */
export interface RunRequest {
    readonly providerKeys?: readonly string[];
    readonly taskIds?: readonly string[];
    readonly limit?: number;
    readonly repetitions?: number;
    readonly toleranceNats?: number;
    readonly outputDirectory?: string;
    readonly randomSeed?: number;
    readonly maxConcurrency?: number;
    readonly dryRun?: boolean;
}
/** The status of one session. */
export interface SessionStatus {
    readonly sessionCode: string;
    readonly directory: string;
    readonly status: string;
    readonly createdAt: string;
    readonly taskCount: number;
    readonly verdicts: Readonly<Record<string, string>>;
    readonly failures: number;
}
/** The summary of one dataset. */
export interface DatasetSummary {
    readonly datasetId: string;
    readonly language: string;
    readonly taskCount: number;
    readonly categories: Readonly<Record<string, number>>;
    readonly firstTaskIds: readonly string[];
}
/** The dependencies of the service. */
export interface ExperimentServiceOptions {
    /** Resolve the workspace directory of one tool call. */
    readonly resolveWorkspace: (agent: Agent | undefined, signal: AbortSignal) => Promise<string>;
    /** Read the configured output root. */
    readonly outputRoot: () => string;
    /** The host logger. */
    readonly logger?: Logger;
    /** The configured default of the job limit. */
    readonly defaultMaxConcurrency?: number;
}
/** The service that a tool, a command, and the CLI share. */
export declare class ExperimentService {
    private readonly options;
    /**
     * Create one service.
     *
     * @param options - the workspace resolver, the output root reader, and the logger.
     */
    constructor(options: ExperimentServiceOptions);
    /**
     * Run one experiment and write one session directory.
     *
     * @param agent - the agent of the tool call.
     * @param request - the run request.
     * @param signal - the cancellation signal of the call.
     * @returns the result of the run.
     */
    run(agent: Agent | undefined, request: RunRequest, signal: AbortSignal): Promise<RunResult>;
    /**
     * Run every task and provider pair with a bounded number of concurrent jobs.
     *
     * @param directory - the session directory.
     * @param tasks - the selected tasks.
     * @param clients - the provider clients.
     * @param repetitionCount - the repetition count.
     * @param maxConcurrency - the job limit.
     * @param signal - the cancellation signal.
     * @returns the task records in dataset order.
     */
    private runJobs;
    /**
     * Run the repetitions of one task and one provider.
     *
     * @param directory - the session directory.
     * @param task - the task.
     * @param client - the provider client.
     * @param repetitionCount - the repetition count.
     * @returns the task record.
     */
    private runOneTask;
    /**
     * Report the state of the latest session.
     *
     * @param agent - the agent of the tool call.
     * @param signal - the cancellation signal of the call.
     * @returns the status, or undefined when the output root holds no session.
     */
    status(agent: Agent | undefined, signal: AbortSignal): Promise<SessionStatus | undefined>;
    /**
     * List the sessions below one output root, newest first.
     *
     * @param agent - the agent of the tool call.
     * @param signal - the cancellation signal of the call.
     * @param limit - the maximum number of sessions.
     * @returns the session states.
     */
    listSessions(agent: Agent | undefined, signal: AbortSignal, limit: number): Promise<SessionStatus[]>;
    /**
     * Read one session report.
     *
     * @param agent - the agent of the tool call.
     * @param signal - the cancellation signal of the call.
     * @param sessionCode - the session code, or an empty string for the latest session.
     * @returns the report text and its path.
     */
    report(agent: Agent | undefined, signal: AbortSignal, sessionCode: string): Promise<{
        readonly sessionCode: string;
        readonly path: string;
        readonly text: string;
    }>;
    /**
     * Resolve one session directory.
     *
     * @param agent - the agent of the tool call.
     * @param signal - the cancellation signal of the call.
     * @param sessionCode - the session code, or an empty string for the latest session.
     * @returns the absolute session directory.
     */
    private sessionDirectory;
    /**
     * Summarize the bundled dataset.
     *
     * @returns the dataset summary.
     */
    datasetSummary(): Promise<DatasetSummary>;
}
/**
 * Read the state of one session directory.
 *
 * @param directory - the absolute session directory.
 * @returns the session state.
 */
export declare function readSessionStatus(directory: string): Promise<SessionStatus>;
/**
 * Limit one correction-table request to the accepted size.
 *
 * @param value - the requested size.
 * @returns the accepted size.
 */
export declare function clampEntryCount(value: number): number;
