// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/** One failure with a stable code and a human-readable message. */
export class ExperimentError extends Error {
    /** The failure class. */
    code;
    /**
     * Create one failure.
     *
     * @param code - the failure class.
     * @param message - the human-readable message, without a final period.
     */
    constructor(code, message) {
        super(message);
        this.name = "ExperimentError";
        this.code = code;
    }
}
/**
 * Report whether a value is a plain record.
 *
 * @param value - the value to test.
 * @returns true when the value is a non-null object and not an array.
 */
export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * Read the message of an unknown error.
 *
 * @param error - the value that a catch block received.
 * @returns the message of an Error, or a fixed sentence for another value.
 */
export function errorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return "The operation failed with a non-error value.";
}
