// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * Dataset loading and validation.
 *
 * The protocol stores one dataset file for each language below the testing dataset directory. The
 * loader reads the present files in the canonical order, merges their tasks, and reports a digest
 * of the merged task list.
 */
import path from "node:path";
import { DATASET_FILE_NAMES } from "./constants.js";
import { ExperimentError, isRecord } from "./errors.js";
import { packagedPath, pathExists, readJsonFile, sha256Text } from "./files.js";
/**
 * Read one string field of one record.
 *
 * @param record - the record to read.
 * @param field - the field name.
 * @param context - the description of the record for one error message.
 * @returns the trimmed value.
 * @throws ExperimentError when the field is absent or not a string.
 */
function readString(record, field, context) {
    const value = record[field];
    if (typeof value !== "string" || value.trim() === "") {
        throw new ExperimentError("INVALID_DATASET", `The ${context} field ${JSON.stringify(field)} must be a non-empty string.`);
    }
    return value.trim();
}
/**
 * Validate one task.
 *
 * @param value - the value to check.
 * @param index - the position of the task in the file.
 * @returns the validated task.
 * @throws ExperimentError when the value is not a valid task.
 */
export function validateTask(value, index) {
    if (!isRecord(value)) {
        throw new ExperimentError("INVALID_DATASET", `The task at index ${index} is not an object.`);
    }
    const context = `task at index ${index}`;
    const id = readString(value, "id", context);
    const category = readString(value, "category", context);
    const prefix = readString(value, "prefix", context);
    const referenceToken = readString(value, "referenceToken", context);
    if (prefix.endsWith(referenceToken)) {
        throw new ExperimentError("INVALID_DATASET", `The task ${id} already ends with its reference token. The reference token must lie ahead.`);
    }
    const rawLanguage = value["language"];
    const language = typeof rawLanguage === "string" && rawLanguage.trim() !== ""
        ? rawLanguage.trim()
        : undefined;
    return { id, category, language, prefix, referenceToken };
}
/**
 * Validate one dataset file.
 *
 * @param value - the parsed file value.
 * @returns the validated dataset.
 * @throws ExperimentError when the value is not a valid dataset.
 */
export function validateDataset(value) {
    if (!isRecord(value)) {
        throw new ExperimentError("INVALID_DATASET", "The dataset file must hold one JSON object.");
    }
    const datasetId = readString(value, "datasetId", "dataset");
    const language = readString(value, "language", "dataset");
    const description = readString(value, "description", "dataset");
    const rawTasks = value["tasks"];
    if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
        throw new ExperimentError("INVALID_DATASET", "The dataset must hold at least one task.");
    }
    const tasks = [];
    const identifiers = new Set();
    for (let index = 0; index < rawTasks.length; index += 1) {
        const task = validateTask(rawTasks[index], index);
        if (identifiers.has(task.id)) {
            throw new ExperimentError("INVALID_DATASET", `The dataset repeats the task ${task.id}.`);
        }
        identifiers.add(task.id);
        tasks.push(task);
    }
    const rawTaskCount = value["taskCount"];
    if (typeof rawTaskCount === "number" && rawTaskCount !== tasks.length) {
        throw new ExperimentError("INVALID_DATASET", `The dataset ${datasetId} reports ${rawTaskCount} tasks and holds ${tasks.length}.`);
    }
    return { datasetId, language, description, taskCount: tasks.length, tasks };
}
/**
 * Compute the digest of one task list.
 *
 * @param tasks - the tasks to hash.
 * @returns the SHA-256 digest as lowercase hexadecimal.
 */
export function computeDatasetHash(tasks) {
    const body = tasks.map((task) => ({
        id: task.id,
        category: task.category,
        language: task.language ?? "",
        prefix: task.prefix,
        referenceToken: task.referenceToken,
    }));
    return sha256Text(JSON.stringify(body));
}
/**
 * Resolve the testing dataset directory of one workspace.
 *
 * A workspace copy wins over the packaged copy.
 *
 * @param workspace - the absolute workspace directory.
 * @param directoryName - the directory name below the inputs directory.
 * @returns the absolute directory path of the copy to read.
 */
export async function resolveDatasetDirectory(workspace, directoryName) {
    const workspaceDirectory = path.join(workspace, "inputs", directoryName);
    if (await pathExists(workspaceDirectory)) {
        return workspaceDirectory;
    }
    return packagedPath(path.join("inputs", directoryName));
}
/**
 * Load and merge the dataset files of one directory.
 *
 * @param directory - the directory that holds the dataset files.
 * @returns the merged dataset.
 * @throws ExperimentError when the directory holds no dataset file.
 */
export async function loadDatasets(directory) {
    const datasets = [];
    for (const fileName of DATASET_FILE_NAMES) {
        const filePath = path.join(directory, fileName);
        if (!(await pathExists(filePath))) {
            continue;
        }
        datasets.push(validateDataset(await readJsonFile(filePath)));
    }
    if (datasets.length === 0) {
        throw new ExperimentError("INVALID_DATASET", `The directory ${directory} holds no dataset file: ${DATASET_FILE_NAMES.join(", ")}.`);
    }
    const tasks = [];
    const identifiers = new Set();
    for (const dataset of datasets) {
        for (const task of dataset.tasks) {
            if (identifiers.has(task.id)) {
                throw new ExperimentError("INVALID_DATASET", `The dataset repeats the task ${task.id}.`);
            }
            identifiers.add(task.id);
            tasks.push(task);
        }
    }
    return {
        datasets,
        tasks,
        datasetIds: datasets.map((dataset) => dataset.datasetId),
        languages: datasets.map((dataset) => dataset.language),
        hash: computeDatasetHash(tasks),
    };
}
/**
 * Select the requested tasks.
 *
 * @param tasks - the tasks in file order.
 * @param taskIds - the requested identifiers; an empty list selects every task.
 * @returns the selected tasks in file order.
 * @throws ExperimentError when a requested identifier is absent.
 */
export function selectTasks(tasks, taskIds) {
    if (taskIds.length === 0) {
        return [...tasks];
    }
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const selected = [];
    const missing = [];
    for (const taskId of taskIds) {
        const task = byId.get(taskId);
        if (task === undefined) {
            missing.push(taskId);
            continue;
        }
        selected.push(task);
    }
    if (missing.length > 0) {
        throw new ExperimentError("INVALID_ARGUMENT", `The dataset holds no task ${missing.join(", ")}.`);
    }
    return selected;
}
/**
 * Count the tasks of each category.
 *
 * @param tasks - the tasks to count.
 * @returns a map from the category name to the task count, in first-seen order.
 */
export function countByCategory(tasks) {
    const counts = new Map();
    for (const task of tasks) {
        counts.set(task.category, (counts.get(task.category) ?? 0) + 1);
    }
    return counts;
}
