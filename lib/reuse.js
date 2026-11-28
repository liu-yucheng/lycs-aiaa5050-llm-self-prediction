// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * Reuse of the intermediate data of an earlier run.
 *
 * A revise pass reads the raw files of one run folder and rebuilds the table of each condition. The
 * pass requests only the tables that the folder does not hold. The scan also lists each raw file
 * that the current protocol does not read, and the caller removes that file and records the
 * removal in the revision record.
 *
 * The scan reads a file of the current protocol first. When that file is absent, the scan reads the
 * file of the earlier protocol whose prompt asked the same question in the same words.
 */
import path from "node:path";
import { CONDITION_ACTUAL, CONDITION_ACTUAL_INJECTED_ACTUAL, CONDITION_ACTUAL_INJECTED_SELF, CONDITION_NAMES, CONDITION_SELF, OBSOLETE_CONDITION_PREFIXES, REUSABLE_CONDITION_PREFIXES, } from "./constants.js";
import { isRecord } from "./errors.js";
import { listChildDirectories, listChildFiles, readJsonFile, removeFile } from "./files.js";
import { readRecordedPrediction } from "./providers.js";
/**
 * Read the condition, the repetition, and the call number of one raw file name.
 *
 * @param fileName - the base name of the file.
 * @returns the parsed name, or undefined when the name is not a raw file name.
 */
function matchRawFileName(fileName) {
    const pattern = /^(.+)-r(\d+)-call(\d+)\.json$/u;
    const found = pattern.exec(fileName);
    if (found === null) {
        return undefined;
    }
    const prefix = found[1] ?? "";
    const repetition = Number.parseInt(found[2] ?? "", 10);
    const call = Number.parseInt(found[3] ?? "", 10);
    if (!Number.isInteger(repetition) || !Number.isInteger(call)) {
        return undefined;
    }
    for (const condition of CONDITION_NAMES) {
        const prefixes = REUSABLE_CONDITION_PREFIXES[condition] ?? [condition];
        if (prefixes.includes(prefix)) {
            return { condition, repetition, call };
        }
    }
    return undefined;
}
/**
 * Report whether one condition records the second call of the repetition.
 *
 * @param condition - the condition name.
 * @returns true when the condition records the second call.
 */
function recordsSecondCall(condition) {
    return condition === CONDITION_ACTUAL_INJECTED_ACTUAL;
}
/**
 * Report whether one raw file holds the marker of a reused first call.
 *
 * @param value - the parsed file value.
 * @returns true when the file is a marker.
 */
function isReuseMarker(value) {
    return isRecord(value) && value["reused"] === true;
}
/**
 * Report whether one file name carries an obsolete condition prefix.
 *
 * @param fileName - the base name of the file.
 * @returns true when the prefix belongs to a condition that the current protocol does not read.
 */
function hasObsoletePrefix(fileName) {
    return OBSOLETE_CONDITION_PREFIXES.some((prefix) => fileName.startsWith(`${prefix}-r`));
}
/**
 * Scan one run folder for reusable data.
 *
 * @param options - the intermediate directory, the provider directory names, the task identifiers,
 * the repetition count, and the table entry count.
 * @returns the scan result.
 */
export async function scanReusableData(options) {
    const tasks = new Map();
    const droppedFileNames = [];
    const existingProviders = new Set((await listChildDirectories(options.intermediateDirectory)).map((entry) => path.basename(entry)));
    let reusedRecordCount = 0;
    for (const providerName of options.providerDirectoryNames) {
        if (!existingProviders.has(providerName)) {
            continue;
        }
        const providerDirectory = path.join(options.intermediateDirectory, providerName);
        const existingTasks = new Set((await listChildDirectories(providerDirectory)).map((entry) => path.basename(entry)));
        for (const taskId of options.taskIds) {
            if (!existingTasks.has(taskId)) {
                continue;
            }
            const taskDirectory = path.join(providerDirectory, taskId);
            const data = await scanTaskDirectory({
                taskDirectory,
                providerName,
                taskId,
                repetitionCount: options.repetitionCount,
                topLogprobsCount: options.topLogprobsCount,
                droppedFileNames,
            });
            reusedRecordCount += countRecords(data);
            const providerBucket = tasks.get(providerName) ?? new Map();
            providerBucket.set(taskId, data);
            tasks.set(providerName, providerBucket);
        }
    }
    return { tasks, droppedFileNames, reusedRecordCount };
}
/**
 * Scan one task directory.
 *
 * @param options - the task directory, the identity of the task, the repetition count, the entry
 * count, and the list that collects the dropped file names.
 * @returns the reused data of the task.
 */
async function scanTaskDirectory(options) {
    const records = {};
    const files = await listChildFiles(options.taskDirectory);
    for (const file of files) {
        const fileName = path.basename(file);
        const relativeName = [options.providerName, options.taskId, fileName].join("/");
        if (hasObsoletePrefix(fileName)) {
            await removeFile(file);
            options.droppedFileNames.push(relativeName);
            continue;
        }
        const match = matchRawFileName(fileName);
        if (match === undefined) {
            continue;
        }
        if (match.repetition > options.repetitionCount) {
            await removeFile(file);
            options.droppedFileNames.push(relativeName);
            continue;
        }
        const wantedCall = recordsSecondCall(match.condition) ? 2 : 1;
        if (match.call !== wantedCall) {
            if (match.condition === CONDITION_ACTUAL_INJECTED_ACTUAL && match.call === 1) {
                const value = await readJsonFile(file).catch(() => undefined);
                if (!isReuseMarker(value)) {
                    await removeFile(file);
                    options.droppedFileNames.push(relativeName);
                }
            }
            continue;
        }
        let value;
        try {
            value = await readJsonFile(file);
        }
        catch {
            await removeFile(file);
            options.droppedFileNames.push(relativeName);
            continue;
        }
        try {
            const record = readRecordedPrediction({
                condition: match.condition,
                repetition: match.repetition,
                fileName,
                value,
                topLogprobsCount: options.topLogprobsCount,
            });
            const bucket = records[match.condition] ?? [];
            bucket.push(record);
            records[match.condition] = bucket;
        }
        catch {
            await removeFile(file);
            options.droppedFileNames.push(relativeName);
        }
    }
    for (const condition of CONDITION_NAMES) {
        const bucket = records[condition];
        if (bucket !== undefined) {
            bucket.sort((left, right) => left.repetition - right.repetition);
        }
    }
    return { records };
}
/**
 * Count the reused records of one task.
 *
 * @param data - the reused data of the task.
 * @returns the record count.
 */
function countRecords(data) {
    let count = 0;
    for (const condition of CONDITION_NAMES) {
        count += data.records[condition]?.length ?? 0;
    }
    return count;
}
/**
 * Read one reused record of one condition and repetition.
 *
 * @param data - the reused data of the task.
 * @param condition - the condition name.
 * @param repetition - the repetition number.
 * @returns the record, or undefined when the folder holds no record.
 */
export function findReusedRecord(data, condition, repetition) {
    return data?.records[condition]?.find((record) => record.repetition === repetition);
}
/**
 * Read the reused record list of one condition.
 *
 * @param data - the reused data of the task.
 * @param condition - the condition name.
 * @returns the records in repetition order.
 */
export function readReusedRecords(data, condition) {
    return [...(data?.records[condition] ?? [])];
}
/**
 * Build the marker file of one reused first call.
 *
 * The marker keeps the folder self-describing. A reader learns that the first read of the condition
 * came from the `actual` condition of the same repetition, and the marker holds no payload.
 *
 * @param options - the condition, the repetition, and the source file name.
 * @returns the marker value.
 */
export function buildFirstCallMarker(options) {
    return {
        reused: true,
        condition: CONDITION_ACTUAL_INJECTED_ACTUAL,
        repetition: options.repetition,
        reusedFrom: options.reusedFrom,
    };
}
/**
 * Report the condition names that the scan keeps.
 *
 * @returns the condition names of the current protocol.
 */
export function listScannedConditions() {
    return [CONDITION_ACTUAL, CONDITION_SELF, CONDITION_ACTUAL_INJECTED_SELF, CONDITION_ACTUAL_INJECTED_ACTUAL];
}
