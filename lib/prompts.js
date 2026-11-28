// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * Prompts of the four conditions.
 *
 * The actual-prediction prompt asks for one next token, and the run reads the `logprobs` table of
 * the reply. The self-prediction prompt asks for one JSON table. Both prompts state the same task,
 * so the comparison measures the model and not the wording.
 *
 * The injected-actual condition puts one served table into the message list as an assistant turn
 * and then repeats the exact task. The second read is the recorded table of the condition. The
 * injected-self condition puts one served table into the message list and then asks for the self
 * table. One table format serves both conditions.
 */
import { MAX_PROBABILITY_ENTRY_COUNT } from "./constants.js";
import { ExperimentError, isRecord } from "./errors.js";
/**
 * Report whether one task is an English task.
 *
 * @param task - the task to inspect.
 * @returns true when the language tag starts with `en`.
 */
export function isEnglishTask(task) {
    return (task.language ?? "").trim().toLowerCase().startsWith("en");
}
/**
 * Build the user message of one actual next-token prediction.
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
 * Build the user message of one self-prediction request.
 *
 * The model reports the table that it believes its own inference stack produces for the prefix.
 * The check runs before the model reads any served table.
 *
 * @param task - the task whose prefix the model reads.
 * @param entryCount - the requested table size.
 * @returns the system message and the user message.
 */
export function buildSelfPredictionPrompt(task, entryCount) {
    const count = Math.min(entryCount, MAX_PROBABILITY_ENTRY_COUNT);
    if (isEnglishTask(task)) {
        return {
            system: "You take part in a next-token prediction experiment. This turn is the self-prediction " +
                "check. You read a sentence prefix, name the one word that comes next, and report the " +
                "table of next-token probabilities that you believe your own inference stack produces. " +
                "Reply with one JSON object and nothing else.",
            user: `Sentence prefix: ${task.prefix}

Report the ${count} most likely next tokens for this prefix, in the table that you believe ` +
                "your own inference stack produces.\n" +
                `Reply with exactly one JSON object of this shape: {"entries": [{"token": "word", ` +
                `"logProbability": -0.02}]}\n` +
                `Rules:\n` +
                `1. Give exactly ${count} entries, the highest probability first.\n` +
                "2. logProbability is the natural logarithm of the probability. It is 0 or below.\n" +
                "3. The probabilities of the entries sum to about 1.\n" +
                "4. The serving tokenizer stores some words as one token and cuts other words into a " +
                "short leading piece plus a remainder. When you believe a cut is likely, list the " +
                "leading pieces as separate entries and give the whole word the rest of the mass.",
        };
    }
    return {
        system: "你正在参加一项中文下一个词预测实验，本次是自我预测环节。你要阅读一段句子前缀，" +
            "给出紧接着出现的一个词，并报告你认为自己的推理流程会给出的下一个词概率表。" +
            "只回复一个 JSON 对象，不要写其他内容。",
        user: `句子前缀：${task.prefix}

请报告这个前缀之后最可能的 ${count} 个词，也就是你认为自己的推理流程会给出的概率表。\n` +
            `只回复一个 JSON 对象，格式为：{"entries": [{"token": "词", "logProbability": -0.02}]}\n` +
            `规则：\n` +
            `1. 一共给出 ${count} 个条目，概率高的排在前面。\n` +
            "2. logProbability 是概率的自然对数，取值为 0 或负数。\n" +
            "3. 各条目概率之和约等于 1。\n" +
            "4. 分词器可能把一个词整体作为一个词元，也可能只取词首的几个字。若你认为某种切分" +
            "很可能出现，就把这些词首片段作为单独条目列出，其余概率留给整词。",
    };
}
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
export function buildInjectedTableMessage(table) {
    return ("The table below is the next-token `logprobs` table that the serving stack actually " +
        "produced for the same sentence prefix in this experiment.\n\n" +
        `${formatTableJson(table)}\n\n` +
        "下面的表是服务端在同一句子前缀上实际给出的下一个词 `logprobs` 概率表。");
}
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
export function buildRepeatedActualPrompt(task) {
    return buildActualPredictionPrompt(task).user;
}
/**
 * Build the user message that follows one injected served table in the injected self-prediction
 * condition.
 *
 * @param task - the task whose prefix the model reads.
 * @param entryCount - the requested table size.
 * @returns the user message.
 */
export function buildInjectedSelfPredictionPrompt(task, entryCount) {
    const count = Math.min(entryCount, MAX_PROBABILITY_ENTRY_COUNT);
    if (isEnglishTask(task)) {
        return (`Sentence prefix: ${task.prefix}\n\n` +
            "You have now seen the table that your serving stack actually produced. Report your own " +
            `predicted table for the same prefix: the ${count} most likely next tokens with the ` +
            "probabilities that you believe you would have reported before you saw the served table. " +
            "Do not copy the served table. Reply with one JSON object of the shape " +
            '{"entries": [{"token": "word", "logProbability": -0.02}]} and nothing else.');
    }
    return (`句子前缀：${task.prefix}\n\n` +
        "你已经看到服务端实际给出的概率表。现在请报告你自己预测的概率表：这个前缀之后最可能的 " +
        `${count} 个词，以及你认为在看到服务端概率表之前自己会给出的概率。不要照抄服务端的表。` +
        '只回复一个 JSON 对象，格式为：{"entries": [{"token": "词", "logProbability": -0.02}]}');
}
/**
 * Format one table as the canonical JSON document.
 *
 * @param table - the table to format.
 * @returns the JSON text with two-space indentation.
 */
export function formatTableJson(table) {
    const entries = table.entries.map((entry) => ({
        token: entry.token,
        logProbability: roundLogProbability(entry.logProbability),
    }));
    return JSON.stringify({ entries }, null, 2);
}
/**
 * Round one log probability to six decimals for a stable file.
 *
 * @param value - the log probability.
 * @returns the rounded value.
 */
function roundLogProbability(value) {
    return Math.round(value * 1e6) / 1e6;
}
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
export function parseSelfReport(text) {
    const candidate = extractJsonValue(text);
    if (candidate === undefined) {
        throw new ExperimentError("INVALID_RESPONSE", "The self report holds no JSON value.");
    }
    const rawEntries = readRawEntries(candidate);
    const entries = [];
    for (const rawEntry of rawEntries) {
        if (!isRecord(rawEntry)) {
            continue;
        }
        const token = rawEntry["token"] ?? rawEntry["word"] ?? rawEntry["text"];
        const logProbability = rawEntry["logProbability"] ?? rawEntry["logprob"] ?? rawEntry["log_probability"];
        if (typeof token !== "string" || token.trim() === "") {
            continue;
        }
        if (typeof logProbability !== "number" || !Number.isFinite(logProbability)) {
            continue;
        }
        entries.push({ token, logProbability });
    }
    if (entries.length === 0) {
        throw new ExperimentError("INVALID_RESPONSE", "Every self report entry is invalid: a token and a finite log probability are required.");
    }
    return entries;
}
/**
 * Read the entry list of one parsed self report.
 *
 * @param value - the parsed JSON value.
 * @returns the raw entry list.
 * @throws ExperimentError when the value holds no entry list.
 */
function readRawEntries(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (!isRecord(value)) {
        throw new ExperimentError("INVALID_RESPONSE", "The self report is not a JSON object.");
    }
    for (const key of ["entries", "logprobs", "table", "tokens"]) {
        const candidate = value[key];
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }
    throw new ExperimentError("INVALID_RESPONSE", "The self report holds no entries array.");
}
/**
 * Extract the first JSON value of one text.
 *
 * The function tries the whole text, one fenced block, and one balanced brace range.
 *
 * @param text - the text to scan.
 * @returns the parsed value, or undefined when no JSON value parses.
 */
function extractJsonValue(text) {
    const trimmed = text.trim();
    const whole = tryParseJson(trimmed);
    if (whole !== undefined) {
        return whole;
    }
    const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/u.exec(trimmed);
    if (fenceMatch !== null) {
        const fenced = tryParseJson((fenceMatch[1] ?? "").trim());
        if (fenced !== undefined) {
            return fenced;
        }
    }
    for (const [open, close] of [
        ["{", "}"],
        ["[", "]"],
    ]) {
        const start = trimmed.indexOf(open);
        const end = trimmed.lastIndexOf(close);
        if (start >= 0 && end > start) {
            const candidate = tryParseJson(trimmed.slice(start, end + 1));
            if (candidate !== undefined) {
                return candidate;
            }
        }
    }
    return undefined;
}
/**
 * Parse one JSON text without a throw.
 *
 * @param text - the text to parse.
 * @returns the parsed value, or undefined when the text is not valid JSON.
 */
function tryParseJson(text) {
    if (text === "") {
        return undefined;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
