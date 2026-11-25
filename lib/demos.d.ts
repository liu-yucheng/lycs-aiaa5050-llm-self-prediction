import type { SessionEnvironment, SessionMetrics, TaskRecord } from "./types.js";
/** The description of one dataset, as the demos show it. */
export interface DemoDatasetDescription {
    /** The identifiers of the datasets of the run. */
    readonly datasetIds: readonly string[];
    /** The languages of the run. */
    readonly languages: readonly string[];
    /** The task count of the run. */
    readonly taskCount: number;
    /** The task count of each category. */
    readonly categories: readonly {
        readonly name: string;
        readonly count: number;
    }[];
}
/** The options of the demonstration website. */
export interface DemoOptions {
    /** The demos directory. */
    readonly directory: string;
    /** The session metrics. */
    readonly metrics: SessionMetrics;
    /** The task records. */
    readonly records: readonly TaskRecord[];
    /** The run environment. */
    readonly environment: SessionEnvironment;
    /** The dataset description. */
    readonly dataset: DemoDatasetDescription;
}
/**
 * Write the demonstration website of one run.
 *
 * @param options - the demo options.
 * @returns the path of the entry page.
 */
export declare function renderDemos(options: DemoOptions): Promise<string>;
