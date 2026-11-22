import type { Dataset, Task } from "./types.js";
/**
 * Validate one dataset value.
 *
 * @param value - the parsed JSON value.
 * @returns the validated dataset.
 * @throws ExperimentError when a field is absent or inconsistent.
 */
export declare function validateDataset(value: unknown): Dataset;
/**
 * Load the bundled dataset.
 *
 * @param filePath - the path of the dataset file. The default is the packaged file.
 * @returns the validated dataset.
 */
export declare function loadDataset(filePath?: string): Promise<Dataset>;
/**
 * Compute the SHA-256 digest of the canonical dataset text.
 *
 * The digest identifies the exact tasks of one session.
 *
 * @param dataset - the validated dataset.
 * @returns the digest as lowercase hexadecimal.
 */
export declare function computeDatasetHash(dataset: Dataset): string;
/**
 * Select the tasks of one run.
 *
 * @param dataset - the validated dataset.
 * @param taskIds - the requested identifiers; an empty list selects every task.
 * @param limit - the maximum number of tasks; a value of 0 keeps every selected task.
 * @returns the selected tasks in dataset order.
 * @throws ExperimentError when a requested identifier is absent.
 */
export declare function selectTasks(dataset: Dataset, taskIds: readonly string[], limit: number): Task[];
/**
 * Group the tasks by category and count each group.
 *
 * @param tasks - the tasks to group.
 * @returns the category names in sorted order with their counts.
 */
export declare function countByCategory(tasks: readonly Task[]): Record<string, number>;
