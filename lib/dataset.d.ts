import type { Dataset, Task } from "./types.js";
/** The merged dataset of one run. */
export interface LoadedDataset {
    /** The dataset files in canonical order. */
    readonly datasets: readonly Dataset[];
    /** The merged tasks in file order. */
    readonly tasks: readonly Task[];
    /** The comma-separated dataset identifiers. */
    readonly datasetIds: readonly string[];
    /** The language tags in file order. */
    readonly languages: readonly string[];
    /** The digest of the merged task list. */
    readonly hash: string;
}
/**
 * Validate one task.
 *
 * @param value - the value to check.
 * @param index - the position of the task in the file.
 * @returns the validated task.
 * @throws ExperimentError when the value is not a valid task.
 */
export declare function validateTask(value: unknown, index: number): Task;
/**
 * Validate one dataset file.
 *
 * @param value - the parsed file value.
 * @returns the validated dataset.
 * @throws ExperimentError when the value is not a valid dataset.
 */
export declare function validateDataset(value: unknown): Dataset;
/**
 * Compute the digest of one task list.
 *
 * @param tasks - the tasks to hash.
 * @returns the SHA-256 digest as lowercase hexadecimal.
 */
export declare function computeDatasetHash(tasks: readonly Task[]): string;
/**
 * Resolve the testing dataset directory of one workspace.
 *
 * A workspace copy wins over the packaged copy.
 *
 * @param workspace - the absolute workspace directory.
 * @param directoryName - the directory name below the inputs directory.
 * @returns the absolute directory path of the copy to read.
 */
export declare function resolveDatasetDirectory(workspace: string, directoryName: string): Promise<string>;
/**
 * Load and merge the dataset files of one directory.
 *
 * @param directory - the directory that holds the dataset files.
 * @returns the merged dataset.
 * @throws ExperimentError when the directory holds no dataset file.
 */
export declare function loadDatasets(directory: string): Promise<LoadedDataset>;
/**
 * Select the requested tasks.
 *
 * @param tasks - the tasks in file order.
 * @param taskIds - the requested identifiers; an empty list selects every task.
 * @returns the selected tasks in file order.
 * @throws ExperimentError when a requested identifier is absent.
 */
export declare function selectTasks(tasks: readonly Task[], taskIds: readonly string[]): Task[];
/**
 * Count the tasks of each category.
 *
 * @param tasks - the tasks to count.
 * @returns a map from the category name to the task count, in first-seen order.
 */
export declare function countByCategory(tasks: readonly Task[]): Map<string, number>;
