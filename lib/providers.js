// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * Provider catalog and provider clients.
 *
 * A provider definition names one OpenAI-compatible chat completions endpoint. The real client
 * sends one request and reads the answer. The mock client builds a deterministic answer from the
 * task text, so a dry run and a test need no network access and no credential.
 */
import { createHash } from "node:crypto";
import { DEFAULT_REQUEST_TIMEOUT_MILLISECONDS, PROVIDER_FILE_NAME, SLOW_GUESS_THRESHOLD_MILLISECONDS, } from "./constants.js";
import { isPlaceholderValue } from "./env.js";
import { ExperimentError, errorMessage, isRecord } from "./errors.js";
import { packagedPath, readJsonFile } from "./files.js";
import { buildDistribution } from "./probability.js";
import { buildActualPredictionPrompt, buildSelfPredictionPrompt, buildSelfPredictionTool, parseSelfPredictionArguments, } from "./prompts.js";
/** The mock provider key. */
export const MOCK_PROVIDER_KEY = "mock";
/** The candidate tokens of the mock provider. */
const MOCK_TOKENS = [
    "的", "了", "是", "在", "和", "有", "人", "我", "他", "她", "们", "这", "那", "不", "也", "就",
    "都", "说", "到", "去", "来", "上", "下", "大", "小", "多", "好", "天", "地", "水", "火", "风",
    "雨", "雪", "山", "河", "树", "花", "草", "鸟", "鱼", "车", "路", "门", "窗", "灯", "书", "字",
    "话", "心", "手", "头", "眼", "脸", "家", "城", "村", "店", "饭", "茶", "酒", "肉", "菜", "汤",
    "面", "米", "油", "盐", "糖", "甜", "香", "热", "冷", "快", "慢", "高", "低", "长", "短", "新",
    "旧", "真", "假", "对", "错", "开", "关", "进", "出", "回", "走", "跑", "看", "听", "想", "笑",
];
/** The validated provider catalog. */
export function validateProviderCatalog(value) {
    if (!isRecord(value)) {
        throw new ExperimentError("INVALID_PROVIDER", "The provider catalog is not a JSON object.");
    }
    const schemaVersion = value["schemaVersion"];
    const description = value["description"];
    const rawProviders = value["providers"];
    if (!Array.isArray(rawProviders) || rawProviders.length === 0) {
        throw new ExperimentError("INVALID_PROVIDER", "The provider catalog holds no provider.");
    }
    const providers = [];
    const keys = new Set();
    for (const rawProvider of rawProviders) {
        const provider = validateProvider(rawProvider);
        if (keys.has(provider.key)) {
            throw new ExperimentError("INVALID_PROVIDER", `The provider key ${provider.key} repeats.`);
        }
        keys.add(provider.key);
        providers.push(provider);
    }
    return {
        schemaVersion: typeof schemaVersion === "number" ? schemaVersion : 1,
        description: typeof description === "string" ? description : "",
        providers,
    };
}
/**
 * Validate one provider definition.
 *
 * @param value - the parsed JSON value of one provider.
 * @returns the validated definition.
 */
function validateProvider(value) {
    if (!isRecord(value)) {
        throw new ExperimentError("INVALID_PROVIDER", "One provider is not a JSON object.");
    }
    const fields = ["key", "label", "baseUrl", "model", "apiKeyEnvironmentVariable"];
    const parts = {};
    for (const field of fields) {
        const raw = value[field];
        if (typeof raw !== "string") {
            throw new ExperimentError("INVALID_PROVIDER", `The provider field ${field} is absent.`);
        }
        parts[field] = raw;
    }
    if (parts["key"] === "" || parts["model"] === "") {
        throw new ExperimentError("INVALID_PROVIDER", "A provider key and model must not be empty.");
    }
    const enabled = value["enabled"];
    const environmentPrefix = value["environmentPrefix"];
    const prefix = typeof environmentPrefix === "string" ? environmentPrefix.trim() : "";
    const topLogprobsCount = value["topLogprobsCount"];
    const thinking = value["thinking"];
    const thinkingValue = typeof thinking === "string" ? thinking.trim() : "";
    return {
        key: parts["key"],
        label: parts["label"],
        baseUrl: parts["baseUrl"],
        model: parts["model"],
        apiKeyEnvironmentVariable: parts["apiKeyEnvironmentVariable"],
        environmentPrefix: prefix === "" ? undefined : prefix,
        topLogprobsCount: typeof topLogprobsCount === "number" && Number.isInteger(topLogprobsCount) &&
            topLogprobsCount >= 1 && topLogprobsCount <= 64
            ? topLogprobsCount
            : undefined,
        thinking: thinkingValue === "" ? undefined : thinkingValue,
        enabled: enabled !== false,
    };
}
/**
 * Load the provider catalog.
 *
 * @param filePath - the path of the catalog file. The default is the packaged file.
 * @returns the validated catalog.
 */
export async function loadProviderCatalog(filePath) {
    const target = filePath ?? packagedPath(`inputs/${PROVIDER_FILE_NAME}`);
    return validateProviderCatalog(await readJsonFile(target));
}
/**
 * Select the providers of one run.
 *
 * @param catalog - the validated catalog.
 * @param keys - the requested keys; an empty list selects every enabled provider.
 * @param includeDisabled - true to accept a requested provider that the catalog disables.
 * @returns the selected definitions in catalog order.
 * @throws ExperimentError when a requested key is absent.
 */
export function selectProviders(catalog, keys, includeDisabled) {
    if (keys.length > 0) {
        const requested = new Set(keys);
        for (const key of requested) {
            if (!catalog.providers.some((provider) => provider.key === key)) {
                throw new ExperimentError("INVALID_PROVIDER", `The provider catalog has no key ${key}.`);
            }
        }
        return catalog.providers.filter((provider) => requested.has(provider.key) && (includeDisabled || provider.enabled || provider.key ===
            MOCK_PROVIDER_KEY));
    }
    return catalog.providers.filter((provider) => provider.enabled);
}
/**
 * Read the credential of one provider from its environment variable.
 *
 * @param definition - the provider definition.
 * @returns the credential, or undefined when the variable is absent or empty.
 */
export function readProviderCredential(definition) {
    const variable = definition.apiKeyEnvironmentVariable.trim();
    if (variable === "") {
        return undefined;
    }
    const value = process.env[variable];
    if (value === undefined || isPlaceholderValue(value)) {
        return undefined;
    }
    return value;
}
/**
 * Read the section name of one provider in the environment file.
 *
 * @param definition - the provider definition.
 * @returns the section name, which defaults to the provider key.
 */
export function resolveEnvironmentPrefix(definition) {
    const prefix = definition.environmentPrefix?.trim() ?? "";
    return prefix === "" ? definition.key : prefix;
}
/**
 * Resolve the API key of one provider.
 *
 * The environment file wins. The process environment is the fallback, so a shell session that
 * already holds the variable needs no file.
 *
 * @param definition - the provider definition.
 * @param environments - the section values of the environment file.
 * @returns the key, or undefined when no usable key exists.
 */
export function resolveProviderApiKey(definition, environments) {
    const section = environments.get(resolveEnvironmentPrefix(definition));
    const override = section?.apiKey;
    if (override !== undefined && !isPlaceholderValue(override)) {
        return override;
    }
    return readProviderCredential(definition);
}
/**
 * Apply the environment file to a provider catalog.
 *
 * A section overrides the base URL and the model of the matching provider. An empty value keeps
 * the catalog value. The function does not read or copy an API key.
 *
 * @param catalog - the validated catalog.
 * @param environments - the section values of the environment file.
 * @returns the catalog with the overrides applied.
 */
export function applyProviderEnvironments(catalog, environments) {
    const providers = catalog.providers.map((definition) => {
        const section = environments.get(resolveEnvironmentPrefix(definition));
        if (section === undefined) {
            return definition;
        }
        const baseUrl = section.baseUrl?.trim() ?? "";
        const model = section.model?.trim() ?? "";
        return {
            ...definition,
            baseUrl: baseUrl === "" ? definition.baseUrl : baseUrl,
            model: model === "" ? definition.model : model,
            topLogprobsCount: section.topLogprobsCount ?? definition.topLogprobsCount,
            thinking: section.thinking === undefined || section.thinking.trim() === ""
                ? definition.thinking
                : section.thinking,
        };
    });
    return { ...catalog, providers };
}
/**
 * Create the client of one provider.
 *
 * @param definition - the provider definition.
 * @param timeoutMilliseconds - the ceiling of one request.
 * @returns the client.
 * @throws ExperimentError when a real provider has no credential.
 */
export function createProviderClient(definition, timeoutMilliseconds = DEFAULT_REQUEST_TIMEOUT_MILLISECONDS, apiKeyOverride) {
    if (definition.key === MOCK_PROVIDER_KEY) {
        return new MockProviderClient(definition);
    }
    const credential = apiKeyOverride ?? readProviderCredential(definition);
    if (credential === undefined) {
        throw new ExperimentError("MISSING_CREDENTIAL", `The provider ${definition.key} needs an API key in the environment file ` +
            `or in the environment variable ${definition.apiKeyEnvironmentVariable}.`);
    }
    return new OpenAiCompatibleClient(definition, credential, timeoutMilliseconds);
}
/**
 * Build one answer object from the raw numbers of one provider reply.
 *
 * @param request - the prediction request.
 * @param entries - the reported probability entries.
 * @param token - the reported chosen token.
 * @param raw - the raw provider reply.
 * @param startedAt - the time before the request in milliseconds.
 * @param endpoint - the request endpoint.
 * @param requestBody - the request body.
 * @returns the answer with the normalized distribution.
 */
function buildAnswer(request, entries, token, raw, startedAt, endpoint, requestBody, providerKey) {
    const elapsedMilliseconds = Date.now() - startedAt;
    const distribution = buildDistribution(entries);
    const answer = {
        mode: request.mode,
        repetition: request.repetition,
        requestedAt: new Date(startedAt).toISOString(),
        elapsedMilliseconds,
        token,
        distribution,
        raw,
        rawFileName: `${providerKey === undefined ? "" : `${providerKey}-`}${request.task.id}-${request.mode}-r${request.repetition}.json`,
        endpoint,
        requestBody,
    };
    if (elapsedMilliseconds > SLOW_GUESS_THRESHOLD_MILLISECONDS) {
        return { ...answer, warning: `The guess took ${(elapsedMilliseconds / 1000).toFixed(1)}s.` };
    }
    return answer;
}
/** One client of an OpenAI-compatible chat completions endpoint. */
class OpenAiCompatibleClient {
    /** The provider definition. */
    definition;
    credential;
    timeoutMilliseconds;
    /**
     * Create one client.
     *
     * @param definition - the provider definition.
     * @param credential - the API key.
     * @param timeoutMilliseconds - the ceiling of one request.
     */
    constructor(definition, credential, timeoutMilliseconds) {
        this.definition = definition;
        this.credential = credential;
        this.timeoutMilliseconds = timeoutMilliseconds;
    }
    /**
     * Send one prediction request and parse the answer.
     *
     * @param request - the prediction request.
     * @param signal - the cancellation signal of the run.
     * @returns the parsed answer.
     */
    async predict(request, signal) {
        const endpoint = `${this.definition.baseUrl.replace(/\/+$/u, "")}/chat/completions`;
        const body = request.mode === "actual"
            ? this.buildActualBody(request)
            : this.buildSelfBody(request);
        const startedAt = Date.now();
        const raw = await this.post(endpoint, body, signal);
        return parseProviderReply(request, raw, startedAt, endpoint, body, this.definition.key);
    }
    /** Build the body of one actual-prediction request. */
    buildActualBody(request) {
        const prompt = buildActualPredictionPrompt(request.task);
        const body = {
            model: this.definition.model,
            messages: [
                { role: "system", content: prompt.system },
                { role: "user", content: prompt.user },
            ],
            max_tokens: 1,
            logprobs: true,
            top_logprobs: request.topLogprobsCount,
            stream: false,
        };
        this.applyThinking(body);
        return body;
    }
    /**
     * Merge the thinking parameter of the provider into a request body.
     *
     * A provider that thinks by default rejects a forced tool choice. A section value of `disabled`
     * turns thinking off, and a value of `low`, `high`, or `max` sets the effort level.
     *
     * @param body - the request body to extend in place.
     */
    applyThinking(body) {
        const thinking = this.definition.thinking?.trim() ?? "";
        if (thinking !== "") {
            body["thinking"] = { type: thinking };
        }
    }
    /** Build the body of one self-prediction request with the forced tool. */
    buildSelfBody(request) {
        const prompt = buildSelfPredictionPrompt(request.task, request.topLogprobsCount);
        const tool = buildSelfPredictionTool(request.topLogprobsCount);
        const body = {
            model: this.definition.model,
            messages: [
                { role: "system", content: prompt.system },
                { role: "user", content: prompt.user },
            ],
            tools: [{ type: "function", function: tool }],
            tool_choice: { type: "function", function: { name: tool.name } },
            max_tokens: 2048,
            stream: false,
        };
        this.applyThinking(body);
        return body;
    }
    /** Send one HTTP request and read the JSON reply. */
    async post(endpoint, body, signal) {
        const timeout = AbortSignal.timeout(this.timeoutMilliseconds);
        const combined = AbortSignal.any([signal, timeout]);
        let response;
        try {
            response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${this.credential}`,
                },
                body: JSON.stringify(body),
                signal: combined,
            });
        }
        catch (error) {
            throw new ExperimentError("PROVIDER_FAILURE", `The provider ${this.definition.key} did not answer: ${errorMessage(error)}`);
        }
        const text = await response.text();
        if (!response.ok) {
            const head = text.length > 500 ? `${text.slice(0, 500)}...` : text;
            throw new ExperimentError("PROVIDER_FAILURE", `The provider ${this.definition.key} returned HTTP ${response.status}: ${head}`);
        }
        try {
            return JSON.parse(text);
        }
        catch {
            throw new ExperimentError("INVALID_RESPONSE", `The provider ${this.definition.key} returned invalid JSON.`);
        }
    }
}
/**
 * Parse one provider reply into an answer.
 *
 * An actual prediction reads `choices[0].logprobs.content[0]`. A self prediction reads the first
 * tool call, and falls back to a JSON body when the provider answers in text.
 *
 * @param request - the prediction request.
 * @param raw - the raw provider reply.
 * @param startedAt - the time before the request in milliseconds.
 * @param endpoint - the request endpoint.
 * @param requestBody - the request body.
 * @returns the parsed answer.
 */
export function parseProviderReply(request, raw, startedAt, endpoint, requestBody, providerKey) {
    if (!isRecord(raw)) {
        throw new ExperimentError("INVALID_RESPONSE", "The provider reply is not a JSON object.");
    }
    const choices = raw["choices"];
    if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) {
        throw new ExperimentError("INVALID_RESPONSE", "The provider reply holds no choice.");
    }
    const choice = choices[0];
    if (request.mode === "actual") {
        const entries = readLogprobEntries(choice);
        const token = readLogprobToken(choice);
        return buildAnswer(request, entries, token, raw, startedAt, endpoint, requestBody, providerKey);
    }
    const entries = readSelfPredictionEntries(choice);
    const distribution = buildDistribution(entries);
    return buildAnswer(request, entries, distribution.topToken, raw, startedAt, endpoint, requestBody, providerKey);
}
/**
 * Read the chosen token of one actual-prediction choice.
 *
 * @param choice - one reply choice.
 * @returns the token text.
 */
function readLogprobToken(choice) {
    const logprobs = choice["logprobs"];
    if (isRecord(logprobs)) {
        const content = logprobs["content"];
        if (Array.isArray(content) && content.length > 0 && isRecord(content[0])) {
            const token = content[0]["token"];
            if (typeof token === "string") {
                return token;
            }
        }
    }
    throw new ExperimentError("INVALID_RESPONSE", "The provider reply holds no logprob token.");
}
/**
 * Read the top log-probability entries of one actual-prediction choice.
 *
 * @param choice - one reply choice.
 * @returns the probability entries, or a single entry of the chosen token when the provider
 *   reports no top table.
 */
function readLogprobEntries(choice) {
    const logprobs = choice["logprobs"];
    if (!isRecord(logprobs)) {
        throw new ExperimentError("INVALID_RESPONSE", "The provider reply holds no logprobs table.");
    }
    const content = logprobs["content"];
    if (!Array.isArray(content) || content.length === 0 || !isRecord(content[0])) {
        throw new ExperimentError("INVALID_RESPONSE", "The provider reply holds an empty logprobs table.");
    }
    const first = content[0];
    const token = first["token"];
    const logprob = first["logprob"];
    const entries = [];
    const top = first["top_logprobs"];
    if (Array.isArray(top)) {
        for (const item of top) {
            if (!isRecord(item)) {
                continue;
            }
            const itemToken = item["token"];
            const itemLogprob = item["logprob"];
            if (typeof itemToken === "string" && typeof itemLogprob === "number") {
                entries.push({ token: itemToken, logProbability: itemLogprob });
            }
        }
    }
    if (entries.length === 0 && typeof token === "string" && typeof logprob === "number") {
        entries.push({ token, logProbability: logprob });
    }
    if (entries.length === 0) {
        throw new ExperimentError("INVALID_RESPONSE", "The provider reply holds no usable logprob.");
    }
    return entries;
}
/**
 * Read one self-prediction answer from one reply choice.
 *
 * @param choice - one reply choice.
 * @returns the probability entries.
 */
function readSelfPredictionEntries(choice) {
    const message = choice["message"];
    if (!isRecord(message)) {
        throw new ExperimentError("INVALID_RESPONSE", "The provider reply holds no message.");
    }
    const toolCalls = message["tool_calls"];
    if (Array.isArray(toolCalls)) {
        for (const call of toolCalls) {
            if (!isRecord(call)) {
                continue;
            }
            const functionValue = call["function"];
            if (isRecord(functionValue) && functionValue["arguments"] !== undefined) {
                return parseSelfPredictionArguments(functionValue["arguments"]);
            }
        }
    }
    const content = message["content"];
    if (typeof content === "string" && content.trim() !== "") {
        return parseSelfPredictionArguments(content.trim());
    }
    throw new ExperimentError("INVALID_RESPONSE", "The provider reply holds no tool call.");
}
/** A deterministic client that needs no network access and no credential. */
class MockProviderClient {
    /** The provider definition. */
    definition;
    /**
     * Create one mock client.
     *
     * @param definition - the provider definition.
     */
    constructor(definition) {
        this.definition = definition;
    }
    /**
     * Build one deterministic answer from the task text.
     *
     * @param request - the prediction request.
     * @param signal - the cancellation signal of the run.
     * @returns the answer.
     */
    async predict(request, signal) {
        if (signal.aborted) {
            throw new ExperimentError("PROVIDER_FAILURE", "The mock request was aborted.");
        }
        const startedAt = Date.now();
        const entries = buildMockDistribution(request.task, request.mode, request.repetition, request.topLogprobsCount);
        const distribution = buildDistribution(entries);
        const raw = {
            id: `mock-${createHash("sha256").update(JSON.stringify(request)).digest("hex").slice(0, 16)}`,
            object: "chat.completion",
            model: this.definition.model,
            choices: [
                {
                    index: 0,
                    message: {
                        role: "assistant",
                        content: request.mode === "actual" ? distribution.topToken : "",
                    },
                    finish_reason: "stop",
                },
            ],
            mock: true,
        };
        const held = Math.max(1, entries.length);
        const answer = buildAnswer(request, entries, distribution.topToken, raw, startedAt, "mock://local/chat/completions", { mode: request.mode, taskId: request.task.id, repetition: request.repetition }, this.definition.key);
        if (held !== request.topLogprobsCount) {
            return { ...answer, warning: `The mock table holds ${held} entries.` };
        }
        return answer;
    }
}
/**
 * Build one deterministic probability table for the mock provider.
 *
 * The table uses a hash of the prefix and the token, so the actual table does not depend on the
 * repetition. The self-prediction mode adds a small perturbation that does depend on the
 * repetition, so its table mirrors the actual table with a reproducible amount of variation.
 *
 * @param task - the task.
 * @param mode - the prediction mode.
 * @param repetition - the repetition number.
 * @param entryCount - the requested table size.
 * @returns the probability entries in descending order.
 */
export function buildMockDistribution(task, mode, repetition, entryCount) {
    const size = Math.min(entryCount, MOCK_TOKENS.length);
    const scored = [];
    for (const token of MOCK_TOKENS) {
        const digest = createHash("sha256")
            .update(`${task.prefix}|${token}`)
            .digest();
        const raw = digest.readUInt32BE(0) / 0xffffffff;
        let score = raw * 2 - 1;
        if (mode === "self") {
            const jitter = createHash("sha256")
                .update(`self|${task.prefix}|${token}|${repetition}`)
                .digest()
                .readUInt32BE(0) / 0xffffffff;
            score += (jitter - 0.5) * 0.02;
        }
        scored.push({ token, score });
    }
    scored.sort((left, right) => right.score - left.score || left.token.localeCompare(right.token));
    const top = scored.slice(0, size);
    const maximum = top[0]?.score ?? 0;
    let total = 0;
    const probabilities = [];
    for (const item of top) {
        const probability = Math.exp((item.score - maximum) * 3);
        probabilities.push(probability);
        total += probability;
    }
    return top.map((item, index) => ({
        token: item.token,
        logProbability: Math.log((probabilities[index] ?? 0) / total),
    }));
}
