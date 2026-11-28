import type { RevisionRecord, SessionEnvironment, SessionMetrics, TaskRecord } from "./types.js";
/**
 * Format one number with a fixed digit count.
 *
 * @param value - the number.
 * @param digits - the digit count after the decimal point.
 * @returns the text of the number, or `n/a` for a missing value.
 */
export declare function formatNumber(value: number | undefined, digits?: number): string;
/**
 * Format one p-value for the report.
 *
 * A p-value below 0.001 keeps three significant digits, because the exact size matters for a
 * strong rejection. A larger p-value keeps four digits after the decimal point.
 *
 * @param value - the p-value.
 * @returns the text of the p-value, or `n/a` for a missing value.
 */
export declare function formatPValue(value: number | undefined): string;
/**
 * Render the report of one run.
 *
 * @param metrics - the session metrics.
 * @param environment - the run environment.
 * @param records - the task records.
 * @returns the Markdown report.
 */
export declare function renderReport(metrics: SessionMetrics, environment: SessionEnvironment, records: readonly TaskRecord[], revisions?: readonly RevisionRecord[]): string;
/**
 * Render the summary table in comma-separated values.
 *
 * @param metrics - the session metrics.
 * @returns the CSV text.
 */
export declare function renderSummaryCsv(metrics: SessionMetrics): string;
/**
 * Render the task table in comma-separated values.
 *
 * @param records - the task records.
 * @returns the CSV text.
 */
export declare function renderTasksCsv(records: readonly TaskRecord[]): string;
