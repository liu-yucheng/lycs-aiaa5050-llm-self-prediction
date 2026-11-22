/**
 * Report and table rendering.
 *
 * The report states the method, the results, and the limits of the result. It repeats the exact
 * numbers that `metrics.json` holds, and it never states a conclusion that the numbers do not
 * support.
 */
import type { SessionManifest, SessionMetrics, TaskRecord } from "./types.js";
/**
 * Format one number for a human reader.
 *
 * @param value - the number to format.
 * @param digits - the number of decimal places.
 * @returns the fixed-point text.
 */
export declare function formatNumber(value: number, digits?: number): string;
/**
 * Render the Markdown report of one session.
 *
 * @param metrics - the session metrics.
 * @param session - the session manifest.
 * @param records - the task records of the session.
 * @returns the report text.
 */
export declare function renderReport(metrics: SessionMetrics, session: SessionManifest, records: readonly TaskRecord[]): string;
/**
 * Render the provider summary as CSV.
 *
 * @param metrics - the session metrics.
 * @returns the CSV text with a header row.
 */
export declare function renderSummaryCsv(metrics: SessionMetrics): string;
/**
 * Render the per-task metrics as CSV.
 *
 * @param records - the task records.
 * @returns the CSV text with a header row.
 */
export declare function renderTasksCsv(records: readonly TaskRecord[]): string;
