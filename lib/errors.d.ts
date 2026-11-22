/**
 * Typed errors of the plugin.
 *
 * A command reports the message of one error. The code classifies the failure for a report and
 * for a test.
 */
/** The failure classes of the plugin. */
export type ExperimentErrorCode = "INVALID_ARGUMENT" | "INVALID_DATASET" | "INVALID_PROVIDER" | "MISSING_CREDENTIAL" | "PROVIDER_FAILURE" | "INVALID_RESPONSE" | "MISSING_SESSION" | "FILE_FAILURE";
/** One failure with a stable code and a human-readable message. */
export declare class ExperimentError extends Error {
    /** The failure class. */
    readonly code: ExperimentErrorCode;
    /**
     * Create one failure.
     *
     * @param code - the failure class.
     * @param message - the human-readable message, without a final period.
     */
    constructor(code: ExperimentErrorCode, message: string);
}
/**
 * Report whether a value is a plain record.
 *
 * @param value - the value to test.
 * @returns true when the value is a non-null object and not an array.
 */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/**
 * Read the message of an unknown error.
 *
 * @param error - the value that a catch block received.
 * @returns the message of an Error, or a fixed sentence for another value.
 */
export declare function errorMessage(error: unknown): string;
