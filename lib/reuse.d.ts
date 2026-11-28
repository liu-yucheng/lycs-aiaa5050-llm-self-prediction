import type { ConditionName, PredictionRecord } from "./types.js";
/** The reused data of one task. */
export interface ReusedTaskData {
    /** The reused records of each condition, in repetition order. */
    readonly records: Partial<Record<ConditionName, PredictionRecord[]>>;
}
/** The result of one reuse scan. */
export interface ReuseScan {
    /** The reused data, keyed by the provider directory name and the task identifier. */
    readonly tasks: Map<string, Map<string, ReusedTaskData>>;
    /** The raw files that the current protocol does not read, relative to the run folder. */
    readonly droppedFileNames: string[];
    /** The number of reused prediction records. */
    readonly reusedRecordCount: number;
}
/**
 * Scan one run folder for reusable data.
 *
 * @param options - the intermediate directory, the provider directory names, the task identifiers,
 * the repetition count, and the table entry count.
 * @returns the scan result.
 */
export declare function scanReusableData(options: {
    readonly intermediateDirectory: string;
    readonly providerDirectoryNames: readonly string[];
    readonly taskIds: readonly string[];
    readonly repetitionCount: number;
    readonly topLogprobsCount: number;
}): Promise<ReuseScan>;
/**
 * Read one reused record of one condition and repetition.
 *
 * @param data - the reused data of the task.
 * @param condition - the condition name.
 * @param repetition - the repetition number.
 * @returns the record, or undefined when the folder holds no record.
 */
export declare function findReusedRecord(data: ReusedTaskData | undefined, condition: ConditionName, repetition: number): PredictionRecord | undefined;
/**
 * Read the reused record list of one condition.
 *
 * @param data - the reused data of the task.
 * @param condition - the condition name.
 * @returns the records in repetition order.
 */
export declare function readReusedRecords(data: ReusedTaskData | undefined, condition: ConditionName): PredictionRecord[];
/**
 * Build the marker file of one reused first call.
 *
 * The marker keeps the folder self-describing. A reader learns that the first read of the condition
 * came from the `actual` condition of the same repetition, and the marker holds no payload.
 *
 * @param options - the condition, the repetition, and the source file name.
 * @returns the marker value.
 */
export declare function buildFirstCallMarker(options: {
    readonly repetition: number;
    readonly reusedFrom: string;
}): Record<string, unknown>;
/**
 * Report the condition names that the scan keeps.
 *
 * @returns the condition names of the current protocol.
 */
export declare function listScannedConditions(): readonly ConditionName[];
