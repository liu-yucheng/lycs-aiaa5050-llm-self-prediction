import type { ProbabilityEntry, Task } from "./types.js";
/** One system message and one user message. */
export interface PromptPair {
    readonly system: string;
    readonly user: string;
}
/** The tool definition that the request sends to the provider. */
export interface ProviderToolDefinition {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
}
/**
 * Build the prompt of one actual next-token prediction.
 *
 * @param task - the task whose prefix the model reads.
 * @returns the system message and the user message.
 */
export declare function buildActualPredictionPrompt(task: Task): PromptPair;
/**
 * Build the prompt of one next-token self-prediction.
 *
 * The model reports the distribution that it believes it produced for the same prefix. A serving
 * tokenizer keeps some words whole and cuts other words into a short first piece. A report that
 * names the whole word only loses a large amount of probability when the served first token is
 * that piece, so the prompt asks for a hedge over the cut length. Entry 1 is the whole word, and
 * the other entries are the first letters of the same word. The model sets the mass from its
 * belief about the cut, because the cut is not derivable from the word or from its length.
 *
 * A Chinese word is a short run of characters, and the serving tokenizer usually keeps it whole.
 * The Chinese prompt therefore asks for one entry only.
 *
 * @param task - the task whose prefix the model reads.
 * @param entryCount - the requested table size.
 * @returns the system message and the user message.
 */
export declare function buildSelfPredictionPrompt(task: Task, entryCount: number): PromptPair;
/**
 * Build the forced tool definition of one self-prediction answer.
 *
 * @param entryCount - the maximum number of table entries.
 * @returns the tool definition.
 */
export declare function buildSelfPredictionTool(entryCount: number): ProviderToolDefinition;
/**
 * Parse the arguments of one self-prediction tool call.
 *
 * The parser accepts one JSON object with an `entries` array. A value that is not a JSON string
 * is converted to JSON first, because a provider may return a parsed object.
 *
 * @param argumentsValue - the raw arguments of the tool call.
 * @returns the probability entries in the reported order.
 * @throws ExperimentError when the arguments hold no valid entry.
 */
export declare function parseSelfPredictionArguments(argumentsValue: unknown): ProbabilityEntry[];
