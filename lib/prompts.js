// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * Prompts and the self-prediction tool.
 *
 * The actual-prediction prompt asks for one next token, and the run reads the `logprobs` table of
 * the reply. The self-prediction prompt asks the model to report its own distribution through one
 * forced tool call. Both prompts state the same task, so the comparison measures the model and
 * not the wording.
 */
import { MAX_PROBABILITY_ENTRY_COUNT, SELF_PREDICTION_TOOL_NAME } from "./constants.js";
import { ExperimentError, isRecord } from "./errors.js";
/**
 * Build the prompt of one actual next-token prediction.
 *
 * @param task - the task whose prefix the model reads.
 * @returns the system message and the user message.
 */
export function buildActualPredictionPrompt(task) {
    if (isEnglishTask(task)) {
        return {
            system: "You take part in a next-token prediction experiment. You read a sentence prefix and " +
                "give the one word that comes next. Output only that word. Do not explain and do not " +
                "add punctuation.",
            user: `Sentence prefix: ${task.prefix}

Output only the one word that comes next.`,
        };
    }
    return {
        system: "你正在参加一项中文下一个词预测实验。你要阅读一段句子前缀，并给出紧接着出现的一个词。" +
            "只输出这一个词，不要解释，不要加标点。",
        user: `句子前缀：${task.prefix}

请只输出紧接着的一个词。`,
    };
}
/**
 * Report whether one task is an English task.
 *
 * @param task - the task to inspect.
 * @returns true when the language tag starts with `en`.
 */
function isEnglishTask(task) {
    return (task.language ?? "").trim().toLowerCase().startsWith("en");
}
/** The number of table entries that the hedge report uses when the table is wide enough. */
const SELF_PREDICTION_HEDGE_ENTRY_COUNT = 5;
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
export function buildSelfPredictionPrompt(task, entryCount) {
    const hedgeEntryCount = Math.min(SELF_PREDICTION_HEDGE_ENTRY_COUNT, Math.max(1, entryCount));
    const prefixLengths = Array.from({ length: hedgeEntryCount - 1 }, (_, index) => index + 1);
    const prefixList = prefixLengths.length < 2
        ? prefixLengths.join("")
        : `${prefixLengths.slice(0, -1).join(", ")} and ${prefixLengths[prefixLengths.length - 1]}`;
    if (isEnglishTask(task)) {
        return {
            system: "You take part in a next-token prediction experiment. This run is the self-prediction " +
                "check. You read a sentence prefix and give the one word that comes next. Prefer the " +
                "tool call. When no tool call is possible, write one JSON object in the message body " +
                "and nothing else.",
            user: `Sentence prefix: ${task.prefix}

` +
                `Call ${SELF_PREDICTION_TOOL_NAME} with exactly ${hedgeEntryCount} entries. Decide the ` +
                "one word that comes next. The serving tokenizer stores some words as one token and " +
                "cuts other words into a short first piece plus a remainder. Report your belief about " +
                `that cut. Entry 1 is the whole word. Entries 2 to ${hedgeEntryCount} are the first ` +
                `${prefixList} letters of that same word. Give a prefix more mass when you believe the ` +
                "tokenizer cuts there. Give the whole word the largest mass when you believe the word " +
                `is one token. The ${hedgeEntryCount} masses must sum to about 1. Order the entries ` +
                "from the highest mass to the lowest.",
        };
    }
    return {
        system: "你正在参加一项中文下一个词预测实验，本次是自我预测环节。你要阅读一段句子前缀，" +
            "并给出紧接着出现的一个词。只输出这一个词，不要解释，不要加标点。优先调用工具提交结果。" +
            "无法调用工具时，只在正文中写一个 JSON 对象。",
        user: `句子前缀：${task.prefix}

` +
            `请调用 ${SELF_PREDICTION_TOOL_NAME} 工具，只提交一个条目：紧接着出现的那个词。` +
            `logProbability 填 0。工具的条目上限是 ${entryCount}。`,
    };
}
/**
 * Build the forced tool definition of one self-prediction answer.
 *
 * @param entryCount - the maximum number of table entries.
 * @returns the tool definition.
 */
export function buildSelfPredictionTool(entryCount) {
    const maximum = Math.min(entryCount, MAX_PROBABILITY_ENTRY_COUNT);
    return {
        name: SELF_PREDICTION_TOOL_NAME,
        description: "提交下一个词的自然对数概率表。每个条目给出一个词和它的自然对数概率。" +
            "按概率从高到低排列，概率之和必须约等于 1。",
        parameters: {
            type: "object",
            additionalProperties: false,
            required: ["entries"],
            properties: {
                entries: {
                    type: "array",
                    minItems: 1,
                    maxItems: maximum,
                    items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["token", "logProbability"],
                        properties: {
                            token: { type: "string", description: "一个词。" },
                            logProbability: {
                                type: "number",
                                description: "该词的自然对数概率，小于或等于 0。",
                            },
                        },
                    },
                },
            },
        },
    };
}
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
export function parseSelfPredictionArguments(argumentsValue) {
    const parsed = parseArgumentsValue(argumentsValue);
    if (!isRecord(parsed)) {
        throw new ExperimentError("INVALID_RESPONSE", "The self-prediction arguments are not an object.");
    }
    const rawEntries = parsed["entries"];
    if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
        throw new ExperimentError("INVALID_RESPONSE", "The self-prediction answer holds no entry.");
    }
    const entries = [];
    for (const rawEntry of rawEntries) {
        if (!isRecord(rawEntry)) {
            continue;
        }
        const token = rawEntry["token"];
        const logProbability = rawEntry["logProbability"];
        if (typeof token !== "string" || token.trim() === "") {
            continue;
        }
        if (typeof logProbability !== "number" || !Number.isFinite(logProbability)) {
            continue;
        }
        entries.push({ token, logProbability });
    }
    if (entries.length === 0) {
        throw new ExperimentError("INVALID_RESPONSE", "Every self-prediction entry is invalid: a token and a finite log probability are required.");
    }
    return entries;
}
/**
 * Parse the arguments of one tool call to a JSON value.
 *
 * @param value - a JSON string, or an already parsed value.
 * @returns the parsed value.
 */
function parseArgumentsValue(value) {
    if (typeof value !== "string") {
        return value;
    }
    try {
        return JSON.parse(value);
    }
    catch {
        throw new ExperimentError("INVALID_RESPONSE", "The self-prediction arguments hold invalid JSON.");
    }
}
