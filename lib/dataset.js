// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * Loading and validation of the bundled dataset.
 *
 * The dataset is read-only input. The loader checks every field before a run uses the tasks, so a
 * damaged file fails at the start of a run and not in the middle of one.
 */
import { DATASET_FILE_NAME } from "./constants.js";
import { ExperimentError, isRecord } from "./errors.js";
import { packagedPath, readJsonFile, sha256Text } from "./files.js";
/**
 * Validate one dataset value.
 *
 * @param value - the parsed JSON value.
 * @returns the validated dataset.
 * @throws ExperimentError when a field is absent or inconsistent.
 */
export function validateDataset(value) {
    if (!isRecord(value)) {
        throw new ExperimentError("INVALID_DATASET", "The dataset is not a JSON object.");
    }
    const datasetId = readString(value, "datasetId");
    const language = readString(value, "language");
    const description = readString(value, "description");
    const rawTasks = value["tasks"];
    if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
        throw new ExperimentError("INVALID_DATASET", "The dataset holds no task.");
    }
    const tasks = [];
    const identifiers = new Set();
    for (const rawTask of rawTasks) {
        const task = validateTask(rawTask);
        if (identifiers.has(task.id)) {
            throw new ExperimentError("INVALID_DATASET", `The task identifier ${task.id} repeats.`);
        }
        identifiers.add(task.id);
        tasks.push(task);
    }
    const rawLanguages = value["languages"];
    const languages = Array.isArray(rawLanguages) && rawLanguages.every((entry) => typeof entry === "string")
        ? rawLanguages
        : undefined;
    const taskCount = value["taskCount"];
    if (typeof taskCount === "number" && taskCount !== tasks.length) {
        throw new ExperimentError("INVALID_DATASET", `The task count ${taskCount} does not match the ${tasks.length} tasks.`);
    }
    return {
        datasetId,
        language,
        ...(languages === undefined ? {} : { languages }),
        description,
        taskCount: tasks.length,
        tasks,
    };
}
/**
 * Validate one task value.
 *
 * @param value - the parsed JSON value of one task.
 * @returns the validated task.
 */
function validateTask(value) {
    if (!isRecord(value)) {
        throw new ExperimentError("INVALID_DATASET", "One task is not a JSON object.");
    }
    const id = readString(value, "id");
    const category = readString(value, "category");
    const rawLanguage = value["language"];
    const language = typeof rawLanguage === "string" ? rawLanguage.trim() : "";
    const prefix = readString(value, "prefix");
    const referenceToken = readString(value, "referenceToken");
    if (prefix.trim() === "") {
        throw new ExperimentError("INVALID_DATASET", `The task ${id} has an empty prefix.`);
    }
    if (referenceToken.trim() === "") {
        throw new ExperimentError("INVALID_DATASET", `The task ${id} has an empty reference token.`);
    }
    if (prefix.endsWith(referenceToken)) {
        throw new ExperimentError("INVALID_DATASET", `The task ${id} already ends with its reference token.`);
    }
    return {
        id,
        category,
        ...(language === "" ? {} : { language }),
        prefix,
        referenceToken,
    };
}
/**
 * Read one required string field.
 *
 * @param value - the record that holds the field.
 * @param field - the field name.
 * @returns the field value.
 */
function readString(value, field) {
    const raw = value[field];
    if (typeof raw !== "string" || raw.trim() === "") {
        throw new ExperimentError("INVALID_DATASET", `The dataset field ${field} is absent or empty.`);
    }
    return raw;
}
/**
 * Load the bundled dataset.
 *
 * @param filePath - the path of the dataset file. The default is the packaged file.
 * @returns the validated dataset.
 */
export async function loadDataset(filePath) {
    const target = filePath ?? packagedPath(`inputs/${DATASET_FILE_NAME}`);
    return validateDataset(await readJsonFile(target));
}
/**
 * Compute the SHA-256 digest of the canonical dataset text.
 *
 * The digest identifies the exact tasks of one session.
 *
 * @param dataset - the validated dataset.
 * @returns the digest as lowercase hexadecimal.
 */
export function computeDatasetHash(dataset) {
    return sha256Text(JSON.stringify(dataset.tasks));
}
/**
 * Select the tasks of one run.
 *
 * @param dataset - the validated dataset.
 * @param taskIds - the requested identifiers; an empty list selects every task.
 * @param limit - the maximum number of tasks; a value of 0 keeps every selected task.
 * @returns the selected tasks in dataset order.
 * @throws ExperimentError when a requested identifier is absent.
 */
export function selectTasks(dataset, taskIds, limit) {
    const requested = new Set(taskIds);
    if (requested.size > 0) {
        for (const identifier of requested) {
            if (!dataset.tasks.some((task) => task.id === identifier)) {
                throw new ExperimentError("INVALID_DATASET", `The dataset has no task with the identifier ${identifier}.`);
            }
        }
    }
    const selected = requested.size === 0
        ? [...dataset.tasks]
        : dataset.tasks.filter((task) => requested.has(task.id));
    if (limit > 0 && selected.length > limit) {
        return selected.slice(0, limit);
    }
    return selected;
}
/**
 * Group the tasks by category and count each group.
 *
 * @param tasks - the tasks to group.
 * @returns the category names in sorted order with their counts.
 */
export function countByCategory(tasks) {
    const counts = {};
    for (const task of tasks) {
        counts[task.category] = (counts[task.category] ?? 0) + 1;
    }
    return counts;
}
