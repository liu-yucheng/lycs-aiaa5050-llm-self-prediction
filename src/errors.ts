// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * Typed errors of the plugin.
 *
 * A command reports the message of one error. The code classifies the failure for a report and
 * for a test.
 */

/** The failure classes of the plugin. */
export type ExperimentErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_DATASET"
  | "INVALID_PROVIDER"
  | "MISSING_CREDENTIAL"
  | "PROVIDER_FAILURE"
  | "INVALID_RESPONSE"
  | "MISSING_SESSION"
  | "FILE_FAILURE";

/** One failure with a stable code and a human-readable message. */
export class ExperimentError extends Error {
  /** The failure class. */
  public readonly code: ExperimentErrorCode;

  /**
   * Create one failure.
   *
   * @param code - the failure class.
   * @param message - the human-readable message, without a final period.
   */
  public constructor(code: ExperimentErrorCode, message: string) {
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
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the message of an unknown error.
 *
 * @param error - the value that a catch block received.
 * @returns the message of an Error, or a fixed sentence for another value.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "The operation failed with a non-error value.";
}
