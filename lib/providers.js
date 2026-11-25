// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * Provider clients and the four request kinds of the protocol.
 *
 * One client talks to one OpenAI-compatible endpoint with one model. The client returns the table
 * of one condition. The caller writes the raw exchanges and builds the record, so the client never
 * writes a file. The mock client gives a deterministic table and needs no network.
 */
import https from "node:https";
import { CONDITION_INJECTED_ACTUAL, CONDITION_INJECTED_SELF, CONDITION_PLAIN_ACTUAL, CONDITION_PLAIN_SELF, DEFAULT_REQUEST_TIMEOUT_MILLISECONDS, MAX_PROBABILITY_ENTRY_COUNT, MODELS_FILE_NAME, PROBABILITY_FLOOR, REQUEST_ATTEMPT_COUNT, REQUEST_RETRY_DELAY_MILLISECONDS, SLOW_REQUEST_THRESHOLD_MILLISECONDS, } from "./constants.js";
import { ExperimentError, errorMessage, isRecord } from "./errors.js";
import { sleep } from "./files.js";
import { buildDistribution } from "./probability.js";
import { buildActualPredictionPrompt, buildInjectedActualPrompt, buildInjectedSelfPredictionPrompt, buildInjectedTableMessage, buildSelfPredictionPrompt, formatTableJson, parseSelfReport, } from "./prompts.js";
/** The provider key of the mock client. */
export const MOCK_PROVIDER_KEY = "mock";
/** The temperature of every request. */
const REQUEST_TEMPERATURE = 0;
/** The number of tokens of one self report. */
const SELF_REPORT_MAX_TOKENS = 2048;
/**
 * Validate one provider definition.
 *
 * @param value - the value to check.
 * @param index - the position of the definition in the file.
 * @returns the validated definition.
 * @throws ExperimentError when the value is not a valid definition.
 */
function validateProviderDefinition(value, index) {
    if (!isRecord(value)) {
        throw new ExperimentError("INVALID_PROVIDER", `The provider at index ${index} is not an object.`);
    }
    const key = value["key"];
    const label = value["label"];
    const baseUrl = value["baseUrl"];
    const model = value["model"];
    if (typeof key !== "string" || key.trim() === "") {
        throw new ExperimentError("INVALID_PROVIDER", `The provider at index ${index} has no key.`);
    }
    if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
        throw new ExperimentError("INVALID_PROVIDER", `The provider ${key} has no base URL.`);
    }
    if (typeof model !== "string" || model.trim() === "") {
        throw new ExperimentError("INVALID_PROVIDER", `The provider ${key} has no model.`);
    }
    const rawModels = value["models"];
    const models = Array.isArray(rawModels)
        ? rawModels.filter((entry) => typeof entry === "string" && entry.trim() !== "")
        : undefined;
    const rawApiKeyVariable = value["apiKeyEnvironmentVariable"];
    const rawTopLogprobs = value["topLogprobsCount"];
    return {
        key: key.trim(),
        label: typeof label === "string" && label.trim() !== "" ? label.trim() : key.trim(),
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        models: models === undefined ? undefined : models.map((entry) => entry.trim()),
        apiKeyEnvironmentVariable: typeof rawApiKeyVariable === "string" ? rawApiKeyVariable.trim() : "",
        environmentPrefix: typeof value["environmentPrefix"] === "string"
            ? value["environmentPrefix"].trim()
            : undefined,
        topLogprobsCount: typeof rawTopLogprobs === "number" && Number.isInteger(rawTopLogprobs)
            ? rawTopLogprobs
            : undefined,
        thinking: typeof value["thinking"] === "string" ? value["thinking"] : undefined,
        reasoning: typeof value["reasoning"] === "string" ? value["reasoning"] : undefined,
        enabled: value["enabled"] !== false,
    };
}
/**
 * Validate one provider catalog.
 *
 * @param value - the parsed file value.
 * @returns the validated catalog.
 * @throws ExperimentError when the value is not a valid catalog.
 */
export function validateProviderCatalog(value) {
    if (!isRecord(value)) {
        throw new ExperimentError("INVALID_PROVIDER", "The provider catalog must be one JSON object.");
    }
    const rawProviders = value["providers"];
    if (!Array.isArray(rawProviders) || rawProviders.length === 0) {
        throw new ExperimentError("INVALID_PROVIDER", "The provider catalog holds no provider.");
    }
    const providers = rawProviders.map((entry, index) => validateProviderDefinition(entry, index));
    const rawSchemaVersion = value["schemaVersion"];
    return {
        schemaVersion: typeof rawSchemaVersion === "number" ? rawSchemaVersion : 1,
        description: typeof value["description"] === "string" ? value["description"] : "",
        providers,
    };
}
/**
 * Select the providers to run.
 *
 * @param catalog - the catalog.
 * @param keys - the requested keys; an empty list selects every enabled provider.
 * @param includeDisabled - true to keep a disabled provider that the caller names.
 * @returns the selected definitions.
 * @throws ExperimentError when a requested key is absent.
 */
export function selectProviders(catalog, keys, includeDisabled = false) {
    if (keys.length === 0) {
        return catalog.providers.filter((provider) => provider.enabled);
    }
    const selected = [];
    for (const key of keys) {
        const match = catalog.providers.find((provider) => provider.key === key);
        if (match === undefined) {
            throw new ExperimentError("INVALID_PROVIDER", `The catalog holds no provider ${key}. The keys are ${catalog.providers
                .map((provider) => provider.key)
                .join(", ")}.`);
        }
        if (!match.enabled && !includeDisabled) {
            throw new ExperimentError("INVALID_PROVIDER", `The provider ${key} is disabled.`);
        }
        selected.push(match);
    }
    return selected;
}
/**
 * Read the API key of one provider.
 *
 * The environment file section wins over the process environment.
 *
 * @param definition - the provider definition.
 * @param environments - the sections of the environment file.
 * @returns the API key, or undefined when the key is absent.
 */
export function resolveProviderApiKey(definition, environments) {
    const prefix = resolveEnvironmentPrefix(definition);
    const fromFile = environments.get(prefix)?.apiKey;
    if (fromFile !== undefined && !isPlaceholderValue(fromFile)) {
        return fromFile.trim();
    }
    const variableName = definition.apiKeyEnvironmentVariable;
    if (variableName === "") {
        return undefined;
    }
    const fromProcess = process.env[variableName];
    if (fromProcess !== undefined && !isPlaceholderValue(fromProcess)) {
        return fromProcess.trim();
    }
    return undefined;
}
/**
 * Report whether one value is absent or an unfilled placeholder.
 *
 * @param value - the value to test.
 * @returns true when the value is empty or a placeholder.
 */
function isPlaceholderValue(value) {
    const trimmed = value.trim();
    if (trimmed === "") {
        return true;
    }
    return trimmed.startsWith("<") && trimmed.endsWith(">");
}
/**
 * Resolve the environment section name of one provider.
 *
 * @param definition - the provider definition.
 * @returns the section name.
 */
export function resolveEnvironmentPrefix(definition) {
    const prefix = definition.environmentPrefix?.trim();
    return prefix === undefined || prefix === "" ? definition.key : prefix;
}
/**
 * Apply the environment sections to one catalog.
 *
 * @param catalog - the catalog to update.
 * @param environments - the sections of the environment file.
 * @returns a new catalog with the overrides applied.
 */
export function applyProviderEnvironments(catalog, environments) {
    const providers = catalog.providers.map((provider) => {
        const section = environments.get(resolveEnvironmentPrefix(provider));
        if (section === undefined) {
            return provider;
        }
        return {
            ...provider,
            baseUrl: section.baseUrl ?? provider.baseUrl,
            model: section.model ?? provider.model,
            models: section.models ?? provider.models,
            topLogprobsCount: section.topLogprobsCount ?? provider.topLogprobsCount,
            edgeHost: section.edgeHost ?? provider.edgeHost,
            thinking: section.thinking ?? provider.thinking,
            reasoning: section.reasoning ?? provider.reasoning,
        };
    });
    return { ...catalog, providers };
}
/**
 * Build the provider key of one model.
 *
 * @param providerKey - the provider key.
 * @param model - the model name.
 * @returns the expanded key, as in `huggingface-Qwen-Qwen3-Coder-Next`.
 */
export function buildModelProviderKey(providerKey, model) {
    const cleaned = model.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
    return `${providerKey}-${cleaned === "" ? "model" : cleaned}`;
}
/**
 * Expand one catalog into one entry for each model.
 *
 * @param catalog - the catalog.
 * @returns the expanded definitions in model order.
 */
export function expandProviderModels(catalog) {
    const expanded = [];
    for (const provider of catalog.providers) {
        const models = (provider.models ?? []).map((model) => model.trim()).filter((model) => model !== "");
        if (models.length === 0 && provider.model.trim() !== "") {
            models.push(provider.model.trim());
        }
        for (const model of models) {
            expanded.push({ ...provider, model });
        }
    }
    return expanded;
}
/**
 * Resolve the requested keys against one expanded catalog.
 *
 * @param catalog - the catalog.
 * @param keys - the requested keys; an empty list selects every enabled model.
 * @param includeDisabled - true to accept a disabled provider.
 * @returns the selected definitions.
 * @throws ExperimentError when a requested key matches no model.
 */
export function resolveRequestedKeys(catalog, keys, includeDisabled = false) {
    const expanded = expandProviderModels(catalog);
    if (keys.length === 0) {
        const enabled = expanded.filter((provider) => provider.enabled);
        if (enabled.length === 0) {
            throw new ExperimentError("INVALID_PROVIDER", `The catalog holds no model. Add one <section>.models_to_use= line to ${MODELS_FILE_NAME}.`);
        }
        return enabled;
    }
    const selected = [];
    for (const key of keys) {
        const byModel = expanded.find((provider) => buildModelProviderKey(provider.key, provider.model) === key);
        if (byModel !== undefined) {
            selected.push(byModel);
            continue;
        }
        const byProvider = expanded.filter((provider) => provider.key === key && (includeDisabled || provider.enabled));
        if (byProvider.length === 0) {
            const provider = catalog.providers.find((entry) => entry.key === key);
            if (provider !== undefined) {
                throw new ExperimentError("INVALID_PROVIDER", `The provider ${key} holds no model. Add one ${key}.models_to_use= line to ` +
                    `${MODELS_FILE_NAME}.`);
            }
            throw new ExperimentError("INVALID_PROVIDER", `The catalog holds no enabled provider or model ${key}.`);
        }
        selected.push(...byProvider);
    }
    return selected;
}
/**
 * Build the self report table of one model reply.
 *
 * @param content - the message content.
 * @param toolArguments - the arguments of the first tool call, when present.
 * @returns the normalized distribution.
 */
function buildSelfDistribution(content, toolArguments) {
    if (typeof toolArguments === "string" && toolArguments.trim() !== "") {
        try {
            return buildDistribution(parseSelfReport(toolArguments));
        }
        catch {
            // The message body is the second chance.
        }
    }
    return buildDistribution(parseSelfReport(content));
}
/**
 * Read the served table of one response body.
 *
 * @param body - the response body.
 * @param topLogprobsCount - the expected entry count.
 * @returns the chosen token and the normalized distribution.
 * @throws ExperimentError when the body holds no served table.
 */
export function readServedTable(body, topLogprobsCount) {
    const choice = readFirstChoice(body);
    const logprobs = choice["logprobs"];
    if (!isRecord(logprobs)) {
        throw new ExperimentError("INVALID_RESPONSE", "The reply holds no logprobs table.");
    }
    const content = logprobs["content"];
    if (Array.isArray(content) && content.length > 0) {
        const first = content[0];
        if (!isRecord(first)) {
            throw new ExperimentError("INVALID_RESPONSE", "The logprobs entry is not an object.");
        }
        const entries = readTopLogprobs(first["top_logprobs"]);
        if (entries.length === 0) {
            throw new ExperimentError("INVALID_RESPONSE", "The logprobs table holds no token.");
        }
        const chosen = first["token"];
        const token = typeof chosen === "string" && chosen.trim() !== "" ? chosen : entries[0].token;
        return { token, distribution: buildDistribution(entries) };
    }
    const token = readMessageContent(choice);
    if (token.trim() === "") {
        throw new ExperimentError("INVALID_RESPONSE", "The reply holds an empty logprobs table.");
    }
    return {
        token,
        distribution: buildDistribution([{ token, logProbability: 0 }]),
    };
}
/**
 * The log probability below which an entry is a placeholder.
 *
 * Some endpoints list the alternative tokens and fill their log probability with a large negative
 * sentinel. Such an entry carries no measurement, so the reader drops it. Only the chosen token
 * keeps a real value.
 */
const SENTINEL_LOG_PROBABILITY = -1000;
/**
 * Read the top entry list of one logprobs entry.
 *
 * @param value - the raw value.
 * @returns the entries with a finite log probability.
 */
function readTopLogprobs(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const entries = [];
    for (const rawEntry of value) {
        if (!isRecord(rawEntry)) {
            continue;
        }
        const token = rawEntry["token"];
        const logProbability = rawEntry["logprob"];
        if (typeof token !== "string" || token.trim() === "") {
            continue;
        }
        if (typeof logProbability !== "number" || !Number.isFinite(logProbability)) {
            continue;
        }
        if (logProbability < SENTINEL_LOG_PROBABILITY) {
            continue;
        }
        entries.push({ token, logProbability });
    }
    return entries;
}
/**
 * Read the first choice of one response body.
 *
 * @param body - the response body.
 * @returns the choice record.
 * @throws ExperimentError when the body holds no choice.
 */
function readFirstChoice(body) {
    if (!isRecord(body)) {
        throw new ExperimentError("INVALID_RESPONSE", "The response body is not an object.");
    }
    const choices = body["choices"];
    if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) {
        throw new ExperimentError("INVALID_RESPONSE", "The response body holds no choice.");
    }
    return choices[0];
}
/**
 * Read the message content of one choice.
 *
 * @param choice - the choice record.
 * @returns the content text.
 */
function readMessageContent(choice) {
    const message = choice["message"];
    if (!isRecord(message)) {
        return "";
    }
    const content = message["content"];
    return typeof content === "string" ? content : "";
}
/**
 * Read the tool argument value of the first tool call.
 *
 * @param choice - the choice record.
 * @returns the argument value, or undefined when the reply holds no tool call.
 */
function readToolArguments(choice) {
    const message = choice["message"];
    if (!isRecord(message)) {
        return undefined;
    }
    const toolCalls = message["tool_calls"];
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
        return undefined;
    }
    const first = toolCalls[0];
    if (!isRecord(first)) {
        return undefined;
    }
    const callFunction = first["function"];
    if (!isRecord(callFunction)) {
        return undefined;
    }
    return callFunction["arguments"];
}
/**
 * Apply one switch to a request body.
 *
 * @param body - the body to update.
 * @param definition - the provider definition.
 * @returns the updated body.
 */
function applySwitches(body, definition) {
    if (definition.thinking !== undefined && definition.thinking.trim() !== "") {
        body["thinking"] = { type: definition.thinking.trim() };
    }
    if (definition.reasoning !== undefined && definition.reasoning.trim() !== "") {
        body["reasoning"] = { enabled: definition.reasoning.trim().toLowerCase() === "enabled" };
    }
    return body;
}
/**
 * Build the options of one request that travels through a permitted edge.
 *
 * The edge host can carry a port, as in `127.0.0.1:8443`. Without a port, the request uses the
 * default HTTPS port. The `Host` header always names the host of the base URL, because the edge
 * selects the distribution from that header.
 *
 * @param edgeHost - the host name of the edge, with an optional port.
 * @param endpoint - the endpoint URL of the base URL host.
 * @param headers - the request headers.
 * @param bodyText - the encoded request body.
 * @param timeoutMilliseconds - the time limit.
 * @returns the request options.
 */
export function buildEdgeRequestOptions(edgeHost, endpoint, headers, bodyText, timeoutMilliseconds) {
    const target = new URL(endpoint);
    const separator = edgeHost.lastIndexOf(":");
    const hasPort = separator > 0 && /^\d+$/u.test(edgeHost.slice(separator + 1));
    const hostname = hasPort ? edgeHost.slice(0, separator) : edgeHost;
    const port = hasPort ? Number.parseInt(edgeHost.slice(separator + 1), 10) : 443;
    const requestHeaders = {};
    for (const [name, value] of Object.entries(headers)) {
        requestHeaders[name] = value;
    }
    requestHeaders["host"] = target.host;
    requestHeaders["content-length"] = Buffer.byteLength(bodyText);
    return {
        hostname,
        port,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: requestHeaders,
        servername: hostname,
        rejectUnauthorized: false,
        timeout: timeoutMilliseconds,
    };
}
/**
 * Post one request and read the JSON body, with a bounded retry.
 *
 * A shared pool of an upstream provider can answer HTTP 429 at any moment. A server fault can
 * answer HTTP 5xx. Both answers can succeed after a short wait, so the request repeats with a
 * growing delay. Any other failure ends the attempt at once.
 *
 * @param endpoint - the endpoint URL.
 * @param body - the request body.
 * @param apiKey - the API key.
 * @param timeoutMilliseconds - the time limit.
 * @param providerKey - the provider key for one error message.
 * @param signal - the cancellation signal.
 * @param edgeHost - the permitted network edge, when the base URL host is blocked.
 * @returns the response body.
 */
async function postJson(endpoint, body, apiKey, timeoutMilliseconds, providerKey, signal, edgeHost) {
    let lastError;
    for (let attempt = 1; attempt <= REQUEST_ATTEMPT_COUNT; attempt += 1) {
        try {
            return await postJsonOnce(endpoint, body, apiKey, timeoutMilliseconds, providerKey, signal, edgeHost);
        }
        catch (error) {
            if (!isRetryableFailure(error)) {
                throw error;
            }
            lastError =
                error instanceof ExperimentError
                    ? error
                    : new ExperimentError("PROVIDER_FAILURE", errorMessage(error));
            if (attempt === REQUEST_ATTEMPT_COUNT) {
                break;
            }
            await waitBeforeRetry(REQUEST_RETRY_DELAY_MILLISECONDS * attempt, signal);
        }
    }
    throw lastError ?? new ExperimentError("PROVIDER_FAILURE", `The provider ${providerKey} failed.`);
}
/**
 * Test one failure for a condition that a retry can clear.
 *
 * A transport failure has no HTTP status. A name lookup can fail, a connection can reset, and a
 * connection can time out while the network carries a load. Each condition can pass on the next
 * attempt, so the request repeats.
 *
 * @param error - the failure.
 * @returns true when one retry can clear the failure.
 */
function isRetryableFailure(error) {
    const message = errorMessage(error);
    return isRetryable(message) || isRetryableTransport(message);
}
/**
 * Test one transport message for a failure that a retry can clear.
 *
 * @param message - the transport message.
 * @returns true when the message names a temporary network fault.
 */
function isRetryableTransport(message) {
    return /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|socket hang up|fetch failed/iu.test(message);
}
/**
 * Test one error message for a failure that a retry can clear.
 *
 * @param message - the error message.
 * @returns true when the message names HTTP 429 or HTTP 5xx.
 */
function isRetryable(message) {
    return /HTTP (?:429|5\d\d)/u.test(message);
}
/**
 * Wait before one retry.
 *
 * @param delayMilliseconds - the delay.
 * @param signal - the cancellation signal.
 * @returns a promise that settles after the delay.
 */
async function waitBeforeRetry(delayMilliseconds, signal) {
    await sleep(delayMilliseconds, signal);
}
/**
 * Post one request and read the JSON body.
 *
 * @param endpoint - the endpoint URL.
 * @param body - the request body.
 * @param apiKey - the API key.
 * @param timeoutMilliseconds - the time limit.
 * @param providerKey - the provider key for one error message.
 * @param signal - the cancellation signal.
 * @returns the response body.
 */
async function postJsonOnce(endpoint, body, apiKey, timeoutMilliseconds, providerKey, signal, edgeHost) {
    const headers = {
        "content-type": "application/json",
        accept: "application/json",
    };
    if (apiKey !== undefined) {
        headers["authorization"] = `Bearer ${apiKey}`;
    }
    if (edgeHost !== undefined && edgeHost.trim() !== "") {
        return await postJsonThroughEdge(edgeHost.trim(), endpoint, headers, JSON.stringify(body), timeoutMilliseconds, providerKey, signal);
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMilliseconds);
    const combinedSignal = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
    let response;
    try {
        response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: combinedSignal,
        });
    }
    catch (error) {
        throw new ExperimentError("PROVIDER_FAILURE", `The provider ${providerKey} did not answer: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    if (!response.ok) {
        throw new ExperimentError("PROVIDER_FAILURE", `The provider ${providerKey} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    try {
        return JSON.parse(text);
    }
    catch {
        throw new ExperimentError("INVALID_RESPONSE", `The provider ${providerKey} returned invalid JSON: ${text.slice(0, 200)}`);
    }
}
/**
 * Post one request through a permitted network edge.
 *
 * The local network can block the host of the base URL. The edge carries the TLS handshake, and
 * the `Host` header names the host of the base URL. The edge then selects the distribution from
 * the header. The certificate belongs to the edge, so the check of the certificate is off.
 *
 * @param edgeHost - the host name of the edge.
 * @param endpoint - the endpoint URL of the base URL host.
 * @param headers - the request headers.
 * @param bodyText - the encoded request body.
 * @param timeoutMilliseconds - the time limit.
 * @param providerKey - the provider key for one error message.
 * @param signal - the cancellation signal.
 * @returns the response body.
 */
async function postJsonThroughEdge(edgeHost, endpoint, headers, bodyText, timeoutMilliseconds, providerKey, signal) {
    const requestHeaders = {};
    for (const [name, value] of Object.entries(headers)) {
        requestHeaders[name] = value;
    }
    const options = buildEdgeRequestOptions(edgeHost, endpoint, requestHeaders, bodyText, timeoutMilliseconds);
    const text = await new Promise((resolve, reject) => {
        const request = https.request(options, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => {
                const status = response.statusCode ?? 0;
                const body = Buffer.concat(chunks).toString("utf8");
                if (status < 200 || status >= 300) {
                    reject(new ExperimentError("PROVIDER_FAILURE", `The provider ${providerKey} returned HTTP ${status}: ${body.slice(0, 500)}`));
                    return;
                }
                resolve(body);
            });
            response.on("error", (error) => {
                reject(new ExperimentError("PROVIDER_FAILURE", `The provider ${providerKey} did not answer: ${errorMessage(error)}`));
            });
        });
        request.on("timeout", () => {
            request.destroy(new Error("The request reached its time limit."));
        });
        request.on("error", (error) => {
            reject(new ExperimentError("PROVIDER_FAILURE", `The provider ${providerKey} did not answer: ${errorMessage(error)}`));
        });
        if (signal !== undefined) {
            signal.addEventListener("abort", () => {
                request.destroy(new Error("The request was cancelled."));
            });
        }
        request.end(bodyText);
    });
    try {
        return JSON.parse(text);
    }
    catch {
        throw new ExperimentError("INVALID_RESPONSE", `The provider ${providerKey} returned invalid JSON: ${text.slice(0, 200)}`);
    }
}
/**
 * Build one warning for a slow exchange.
 *
 * @param elapsedMilliseconds - the elapsed time.
 * @returns the warning, or undefined when the request is fast.
 */
function buildSlowWarning(elapsedMilliseconds) {
    if (elapsedMilliseconds <= SLOW_REQUEST_THRESHOLD_MILLISECONDS) {
        return undefined;
    }
    return `The request took ${Math.round(elapsedMilliseconds / 1000)} s.`;
}
/** One client of one OpenAI-compatible chat endpoint. */
export class OpenAiCompatibleClient {
    /** The provider definition of the client. */
    definition;
    /** The model name of the client. */
    model;
    /** The expanded provider key of the client. */
    providerKey;
    /** The API key of the client. */
    apiKey;
    /** The time limit of one request. */
    timeoutMilliseconds;
    /** The number of requested table entries. */
    topLogprobsCount;
    /**
     * Create one client.
     *
     * @param definition - the provider definition.
     * @param apiKey - the API key.
     * @param timeoutMilliseconds - the time limit of one request.
     */
    constructor(definition, apiKey, timeoutMilliseconds = DEFAULT_REQUEST_TIMEOUT_MILLISECONDS) {
        this.definition = definition;
        this.model = definition.model;
        this.providerKey = buildModelProviderKey(definition.key, definition.model);
        this.apiKey = apiKey;
        this.timeoutMilliseconds = timeoutMilliseconds;
        this.topLogprobsCount = Math.min(definition.topLogprobsCount ?? MAX_PROBABILITY_ENTRY_COUNT, MAX_PROBABILITY_ENTRY_COUNT);
    }
    /**
     * Read the served table of one task.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    async requestPlainActual(task, repetition, signal) {
        const prompt = buildActualPredictionPrompt(task);
        const messages = [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
        ];
        return this.requestServedTable(CONDITION_PLAIN_ACTUAL, repetition, messages, signal);
    }
    /**
     * Read the self report of one task.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    async requestPlainSelf(task, repetition, signal) {
        const prompt = buildSelfPredictionPrompt(task, this.topLogprobsCount);
        const messages = [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
        ];
        return this.requestSelfReport(CONDITION_PLAIN_SELF, repetition, messages, signal);
    }
    /**
     * Inject one served table and read the self report that follows.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param injected - the served table.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    async requestInjectedSelf(task, repetition, injected, signal) {
        const prompt = buildSelfPredictionPrompt(task, this.topLogprobsCount);
        const messages = [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
            { role: "assistant", content: buildInjectedTableMessage(injected) },
            {
                role: "user",
                content: buildInjectedSelfPredictionPrompt(task, this.topLogprobsCount),
            },
        ];
        return this.requestSelfReport(CONDITION_INJECTED_SELF, repetition, messages, signal);
    }
    /**
     * Read one self report, keep it in context, and read the served table that follows.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param signal - the cancellation signal.
     * @returns both outcomes.
     */
    async requestInjectedActual(task, repetition, signal) {
        const prompt = buildSelfPredictionPrompt(task, this.topLogprobsCount);
        const selfMessages = [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
        ];
        const self = await this.requestSelfReport(CONDITION_INJECTED_ACTUAL, repetition, selfMessages, signal);
        const tableText = formatTableJson({ entries: self.draft.distribution.entries });
        const messages = [
            ...selfMessages,
            { role: "assistant", content: tableText },
            { role: "user", content: buildInjectedActualPrompt(task) },
        ];
        const actual = await this.requestServedTable(CONDITION_INJECTED_ACTUAL, repetition, messages, signal);
        return { self, actual };
    }
    /**
     * Request one served table.
     *
     * @param condition - the condition name.
     * @param repetition - the repetition number.
     * @param messages - the messages of the request.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    async requestServedTable(condition, repetition, messages, signal) {
        const endpoint = `${this.definition.baseUrl.replace(/\/+$/u, "")}/chat/completions`;
        const body = applySwitches({
            model: this.model,
            messages: messages.map((message) => ({ role: message.role, content: message.content })),
            temperature: REQUEST_TEMPERATURE,
            max_tokens: 1,
            logprobs: true,
            top_logprobs: this.topLogprobsCount,
            stream: false,
        }, this.definition);
        const exchange = await this.send(endpoint, body, signal);
        const choice = readFirstChoice(exchange.responseBody);
        const served = readServedTable(exchange.responseBody, this.topLogprobsCount);
        const content = readMessageContent(choice);
        return {
            draft: {
                condition,
                repetition,
                requestedAt: exchange.requestedAt,
                elapsedMilliseconds: exchange.elapsedMilliseconds,
                token: served.token,
                distribution: served.distribution,
                source: "provider_logprobs",
                endpoint,
                requestBody: body,
                warning: buildSlowWarning(exchange.elapsedMilliseconds),
            },
            exchanges: [exchange],
        };
    }
    /**
     * Request one self report.
     *
     * @param condition - the condition name.
     * @param repetition - the repetition number.
     * @param messages - the messages of the request.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    async requestSelfReport(condition, repetition, messages, signal) {
        const endpoint = `${this.definition.baseUrl.replace(/\/+$/u, "")}/chat/completions`;
        const body = applySwitches({
            model: this.model,
            messages: messages.map((message) => ({ role: message.role, content: message.content })),
            temperature: REQUEST_TEMPERATURE,
            max_tokens: SELF_REPORT_MAX_TOKENS,
            stream: false,
        }, this.definition);
        const exchange = await this.send(endpoint, body, signal);
        const choice = readFirstChoice(exchange.responseBody);
        const distribution = buildSelfDistribution(readMessageContent(choice), readToolArguments(choice));
        return {
            draft: {
                condition,
                repetition,
                requestedAt: exchange.requestedAt,
                elapsedMilliseconds: exchange.elapsedMilliseconds,
                distribution,
                source: "self_report",
                endpoint,
                requestBody: body,
                warning: buildSlowWarning(exchange.elapsedMilliseconds),
            },
            exchanges: [exchange],
        };
    }
    /**
     * Send one request and record the exchange.
     *
     * @param endpoint - the endpoint URL.
     * @param body - the request body.
     * @param signal - the cancellation signal.
     * @returns the recorded exchange.
     */
    async send(endpoint, body, signal) {
        const requestedAt = new Date().toISOString();
        const started = performance.now();
        const responseBody = await postJson(endpoint, body, this.apiKey, this.timeoutMilliseconds, this.providerKey, signal, this.definition.edgeHost);
        return {
            requestedAt,
            elapsedMilliseconds: Math.round(performance.now() - started),
            endpoint,
            requestBody: body,
            responseBody,
        };
    }
}
/** The token alphabet of the mock client. */
/** The weight of the served table in each mock condition. */
const MOCK_CONDITION_WEIGHTS = {
    plain_actual: 1,
    plain_self: 0,
    injected_self: 0.55,
    injected_actual: 0.85,
};
const MOCK_TOKENS = [
    "霜",
    "流",
    "鸟",
    "花",
    "月",
    "风",
    "雨",
    "云",
    "山",
    "水",
    "晚",
    "早",
    "光",
    "声",
    "blue",
    "star",
    "day",
    "night",
    "rain",
    "wind",
    "moon",
    "light",
    "water",
    "song",
];
/**
 * Compute one stable hash of a text.
 *
 * @param text - the text to hash.
 * @returns a non-negative integer.
 */
function stableHash(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
/**
 * Build one deterministic distribution of the mock client.
 *
 * @param task - the task.
 * @param condition - the condition name.
 * @param repetition - the repetition number.
 * @param entryCount - the requested entry count.
 * @returns the normalized distribution.
 */
function buildMockDistribution(task, condition, repetition, entryCount) {
    const count = Math.max(2, Math.min(entryCount, MOCK_TOKENS.length));
    const seed = stableHash(`${task.id}|${repetition}`);
    const tokenSeed = stableHash(task.id);
    const tokens = Array.from({ length: count }, (_value, index) => {
        const position = (tokenSeed + index * 7) % MOCK_TOKENS.length;
        return MOCK_TOKENS[position] ?? MOCK_TOKENS[0];
    });
    const served = mockWeights(count, seed % count);
    const reported = mockWeights(count, (seed + 11) % count);
    const weight = MOCK_CONDITION_WEIGHTS[condition];
    const entries = tokens.map((token, index) => {
        const left = served[index] ?? 0;
        const right = reported[index] ?? 0;
        const probability = weight * left + (1 - weight) * right;
        return { token, logProbability: Math.log(Math.max(probability, PROBABILITY_FLOOR)) };
    });
    return buildDistribution(entries);
}
/**
 * Build one normalized Zipf weight vector with a rotation.
 *
 * @param count - the entry count.
 * @param rotation - the rotation of the ranking.
 * @returns the normalized weights.
 */
function mockWeights(count, rotation) {
    const weights = [];
    for (let index = 0; index < count; index += 1) {
        const rank = ((index - rotation + count) % count) + 1;
        weights.push(1 / Math.pow(rank, 1.35));
    }
    const total = weights.reduce((sum, value) => sum + value, 0);
    return weights.map((value) => value / total);
}
/** One deterministic client that needs no network. */
export class MockProviderClient {
    /** The provider definition of the client. */
    definition;
    /** The model name of the client. */
    model;
    /** The expanded provider key of the client. */
    providerKey;
    /** The number of requested table entries. */
    topLogprobsCount;
    /**
     * Create one mock client.
     *
     * @param definition - the provider definition.
     */
    constructor(definition) {
        this.definition = definition;
        this.model = definition.model;
        this.providerKey = buildModelProviderKey(definition.key, definition.model);
        this.topLogprobsCount = definition.topLogprobsCount ?? MAX_PROBABILITY_ENTRY_COUNT;
    }
    /**
     * Read one mock served table.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    async requestPlainActual(task, repetition, _signal) {
        return this.buildOutcome(CONDITION_PLAIN_ACTUAL, task, repetition, "provider_logprobs");
    }
    /**
     * Read one mock self report.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    async requestPlainSelf(task, repetition, _signal) {
        return this.buildOutcome(CONDITION_PLAIN_SELF, task, repetition, "self_report");
    }
    /**
     * Read one mock injected self report.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param injected - the injected table.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    async requestInjectedSelf(task, repetition, _injected, _signal) {
        return this.buildOutcome(CONDITION_INJECTED_SELF, task, repetition, "self_report");
    }
    /**
     * Read one mock injected actual table.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param signal - the cancellation signal.
     * @returns both outcomes.
     */
    async requestInjectedActual(task, repetition, _signal) {
        return {
            self: this.buildOutcome(CONDITION_INJECTED_ACTUAL, task, repetition, "self_report"),
            actual: this.buildOutcome(CONDITION_INJECTED_ACTUAL, task, repetition, "provider_logprobs"),
        };
    }
    /**
     * Build one mock outcome.
     *
     * @param condition - the condition name.
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param source - the origin of the table.
     * @returns the prediction outcome.
     */
    buildOutcome(condition, task, repetition, source) {
        const distribution = buildMockDistribution(task, condition, repetition, this.topLogprobsCount);
        const endpoint = "mock://local/chat/completions";
        return {
            draft: {
                condition,
                repetition,
                requestedAt: new Date().toISOString(),
                elapsedMilliseconds: 0,
                token: source === "provider_logprobs" ? distribution.topToken : undefined,
                distribution,
                source,
                endpoint,
                requestBody: { model: this.model, mock: true, condition },
            },
            exchanges: [
                {
                    requestedAt: new Date().toISOString(),
                    elapsedMilliseconds: 0,
                    endpoint,
                    requestBody: {
                        model: this.model,
                        messages: [{ role: "user", content: task.prefix }],
                        temperature: REQUEST_TEMPERATURE,
                        mock: true,
                        condition,
                    },
                    responseBody: {
                        mock: true,
                        model: this.model,
                        condition,
                        entries: distribution.entries,
                    },
                },
            ],
        };
    }
}
/**
 * Build one provider client.
 *
 * @param definition - the provider definition.
 * @param apiKey - the API key.
 * @param timeoutMilliseconds - the time limit of one request.
 * @returns the client.
 */
export function createProviderClient(definition, apiKey, timeoutMilliseconds = DEFAULT_REQUEST_TIMEOUT_MILLISECONDS) {
    if (definition.key === MOCK_PROVIDER_KEY || definition.baseUrl.startsWith("mock://")) {
        return new MockProviderClient(definition);
    }
    return new OpenAiCompatibleClient(definition, apiKey, timeoutMilliseconds);
}
/**
 * Probe whether one client reports a full top-N table.
 *
 * @param client - the client to probe.
 * @param task - the probe task.
 * @param signal - the cancellation signal.
 * @returns the support report.
 */
export async function probeLogprobsSupport(client, task, signal) {
    try {
        const outcome = await client.requestPlainActual(task, 1, signal);
        const entryCount = outcome.draft.distribution.supportSize;
        return { supported: entryCount > 1, entryCount };
    }
    catch (error) {
        return {
            supported: false,
            reason: error instanceof Error ? error.message : String(error),
            entryCount: 0,
        };
    }
}
/**
 * Build one prediction record from one draft and its raw file names.
 *
 * @param draft - the draft.
 * @param rawFileNames - the raw file names relative to the run directory.
 * @returns the prediction record.
 */
export function buildPredictionRecord(draft, rawFileNames) {
    return {
        condition: draft.condition,
        repetition: draft.repetition,
        requestedAt: draft.requestedAt,
        elapsedMilliseconds: draft.elapsedMilliseconds,
        token: draft.token,
        distribution: draft.distribution,
        source: draft.source,
        rawFileNames,
        endpoint: draft.endpoint,
        requestBody: draft.requestBody,
        warning: draft.distribution.supportSize <= 1
            ? "The table holds the chosen token only."
            : draft.warning,
    };
}
