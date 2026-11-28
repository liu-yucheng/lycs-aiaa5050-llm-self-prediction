import type { ProbabilityEntry, Task } from "./types.js";
/** One table as the plugin writes it into a message or into a file. */
export interface TableDocument {
    /** The entries in report order. */
    readonly entries: readonly ProbabilityEntry[];
}
/**
 * Report whether one task is an English task.
 *
 * @param task - the task to inspect.
 * @returns true when the language tag starts with `en`.
 */
export declare function isEnglishTask(task: Task): boolean;
/**
 * Build the user message of one actual next-token prediction.
 *
 * @param task - the task whose prefix the model reads.
 * @returns the system message and the user message.
 */
export declare function buildActualPredictionPrompt(task: Task): {
    system: string;
    user: string;
};
/**
 * Build the user message of one self-prediction request.
 *
 * The model reports the table that it believes its own inference stack produces for the prefix.
 * The check runs before the model reads any served table.
 *
 * @param task - the task whose prefix the model reads.
 * @param entryCount - the requested table size.
 * @returns the system message and the user message.
 */
export declare function buildSelfPredictionPrompt(task: Task, entryCount: number): {
    system: string;
    user: string;
};
/**
 * Build the message that injects one served table into the conversation.
 *
 * The injected-actual condition puts this message into the conversation and then repeats the exact
 * task. The injected-self condition puts this message into the conversation and then asks for the
 * self table. The two conditions read the same table format, so the experiment records one table
 * format for both conditions.
 *
 * @param table - the served table.
 * @returns the message text.
 */
export declare function buildInjectedTableMessage(table: TableDocument): string;
/**
 * Build the user message that repeats the exact task after one injected served table.
 *
 * The message is the user message of the actual-prediction prompt without a change. The
 * injected-actual condition repeats the exact task, so the run compares two reads of the same
 * prompt.
 *
 * @param task - the task whose prefix the model reads.
 * @returns the user message.
 */
export declare function buildRepeatedActualPrompt(task: Task): string;
/**
 * Build the user message that follows one injected served table in the injected self-prediction
 * condition.
 *
 * @param task - the task whose prefix the model reads.
 * @param entryCount - the requested table size.
 * @returns the user message.
 */
export declare function buildInjectedSelfPredictionPrompt(task: Task, entryCount: number): string;
/**
 * Format one table as the canonical JSON document.
 *
 * @param table - the table to format.
 * @returns the JSON text with two-space indentation.
 */
export declare function formatTableJson(table: TableDocument): string;
/**
 * Parse one self report from the text of a model reply.
 *
 * The parser accepts one JSON object or one JSON array. It ignores a code fence and any text
 * around the JSON value. Each entry must hold a token and a finite log probability.
 *
 * @param text - the reply text.
 * @returns the entries in report order.
 * @throws ExperimentError when the text holds no valid entry.
 */
export declare function parseSelfReport(text: string): ProbabilityEntry[];
