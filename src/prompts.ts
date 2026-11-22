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
export function buildActualPredictionPrompt(task: Task): PromptPair {
  return {
    system:
      "你正在参加一项中文下一个词预测实验。你要阅读一段句子前缀，并给出紧接着出现的一个词。" +
      "只输出这一个词，不要解释，不要加标点。",
    user: `句子前缀：${task.prefix}\n\n请只输出紧接着的一个词。`,
  };
}

/**
 * Build the prompt of one next-token self-prediction.
 *
 * The model reports the distribution that it believes it produced for the same prefix. The
 * prompt states the requested table size, the natural-log unit, and the normalization rule.
 *
 * @param task - the task whose prefix the model reads.
 * @param entryCount - the requested table size.
 * @returns the system message and the user message.
 */
export function buildSelfPredictionPrompt(task: Task, entryCount: number): PromptPair {
  return {
    system:
      "你正在参加一项中文下一个词自我预测实验。你要报告自己作为语言模型在看到一段句子前缀时，" +
      "对紧接着出现的那个词的概率分布。你必须调用工具提交结果，不要在正文中写答案。",
    user:
      `句子前缀：${task.prefix}\n\n` +
      `请调用 ${SELF_PREDICTION_TOOL_NAME} 工具，提交你认为最可能的 ${entryCount} 个词，` +
      "每个词给出自然对数概率 logProbability。概率之和必须约等于 1，数值必须小于或等于 0。" +
      "按概率从高到低排列。",
  };
}

/**
 * Build the forced tool definition of one self-prediction answer.
 *
 * @param entryCount - the maximum number of table entries.
 * @returns the tool definition.
 */
export function buildSelfPredictionTool(entryCount: number): ProviderToolDefinition {
  const maximum = Math.min(entryCount, MAX_PROBABILITY_ENTRY_COUNT);
  return {
    name: SELF_PREDICTION_TOOL_NAME,
    description:
      "提交下一个词的自然对数概率表。每个条目给出一个词和它的自然对数概率。" +
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
export function parseSelfPredictionArguments(argumentsValue: unknown): ProbabilityEntry[] {
  const parsed = parseArgumentsValue(argumentsValue);
  if (!isRecord(parsed)) {
    throw new ExperimentError("INVALID_RESPONSE", "The self-prediction arguments are not an object.");
  }
  const rawEntries = parsed["entries"];
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    throw new ExperimentError("INVALID_RESPONSE", "The self-prediction answer holds no entry.");
  }
  const entries: ProbabilityEntry[] = [];
  for (const rawEntry of rawEntries) {
    if (!isRecord(rawEntry)) {
      throw new ExperimentError("INVALID_RESPONSE", "One self-prediction entry is not an object.");
    }
    const token = rawEntry["token"];
    const logProbability = rawEntry["logProbability"];
    if (typeof token !== "string" || token.trim() === "") {
      throw new ExperimentError("INVALID_RESPONSE", "One self-prediction entry has no token.");
    }
    if (typeof logProbability !== "number" || !Number.isFinite(logProbability)) {
      throw new ExperimentError(
        "INVALID_RESPONSE",
        `The entry ${JSON.stringify(token)} has no finite log probability.`,
      );
    }
    entries.push({ token, logProbability });
  }
  return entries;
}

/**
 * Parse the arguments of one tool call to a JSON value.
 *
 * @param value - a JSON string, or an already parsed value.
 * @returns the parsed value.
 */
function parseArgumentsValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ExperimentError("INVALID_RESPONSE", "The self-prediction arguments hold invalid JSON.");
  }
}
