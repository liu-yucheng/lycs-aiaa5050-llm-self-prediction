import type { SessionEnvironment, SessionMetrics, TaskRecord } from "./types.js";
/** The description of the datasets of one run. */
export interface DemoDatasetDescription {
    /** The dataset identifiers. */
    readonly datasetIds: readonly string[];
    /** The language of each dataset. */
    readonly languages: readonly string[];
    /** The task count. */
    readonly taskCount: number;
    /** The task count of each category. */
    readonly categories: readonly {
        readonly name: string;
        readonly count: number;
    }[];
}
/** The options of one demonstration site. */
export interface DemoOptions {
    /** The demos directory of the run. */
    readonly directory: string;
    /** The metrics of the run. */
    readonly metrics: SessionMetrics;
    /** The task records of the run. */
    readonly records: readonly TaskRecord[];
    /** The recorded environment of the run. */
    readonly environment: SessionEnvironment;
    /** The description of the datasets of the run. */
    readonly dataset: DemoDatasetDescription;
}
/**
 * Read the options of one demonstration site from a run directory.
 *
 * The function reads the metrics, the records, and the environment of the run. It rebuilds the
 * dataset description from the metrics and the records, so a reader can render the site again
 * without the dataset files.
 *
 * @param runDirectory - the directory of one run.
 * @returns the demo options.
 */
export declare function readDemoOptions(runDirectory: string): Promise<DemoOptions>;
/**
 * Write the demonstration website of one run.
 *
 * @param options - the demo options.
 * @returns the path of the entry page.
 */
export declare function renderDemos(options: DemoOptions): Promise<string>;
