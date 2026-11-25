/**
 * Provider clients and the four request kinds of the protocol.
 *
 * One client talks to one OpenAI-compatible endpoint with one model. The client returns the table
 * of one condition. The caller writes the raw exchanges and builds the record, so the client never
 * writes a file. The mock client gives a deterministic table and needs no network.
 */
import https from "node:https";
import type { ConditionName, PredictionRecord, ProviderCatalog, ProviderDefinition, Task, TokenDistribution } from "./types.js";
/** The provider key of the mock client. */
export declare const MOCK_PROVIDER_KEY = "mock";
/** One recorded HTTP exchange. */
export interface RecordedExchange {
    /** The ISO timestamp of the request. */
    readonly requestedAt: string;
    /** The elapsed time of the request in milliseconds. */
    readonly elapsedMilliseconds: number;
    /** The endpoint of the request. */
    readonly endpoint: string;
    /** The request body, without the API key. */
    readonly requestBody: unknown;
    /** The response body. */
    readonly responseBody: unknown;
}
/** One prediction before the caller writes the raw files. */
export interface PredictionDraft {
    /** The condition that produced the draft. */
    readonly condition: ConditionName;
    /** The repetition number. */
    readonly repetition: number;
    /** The ISO timestamp of the request. */
    readonly requestedAt: string;
    /** The elapsed time of the request in milliseconds. */
    readonly elapsedMilliseconds: number;
    /** The chosen token of a served table. */
    readonly token?: string;
    /** The normalized table. */
    readonly distribution: TokenDistribution;
    /** The origin of the table. */
    readonly source: "provider_logprobs" | "self_report";
    /** The endpoint of the request. */
    readonly endpoint: string;
    /** The request body, without the API key. */
    readonly requestBody: unknown;
    /** A warning about the draft. */
    readonly warning?: string;
}
/** One prediction with the exchanges that produced it. */
export interface PredictionOutcome {
    /** The draft of the prediction. */
    readonly draft: PredictionDraft;
    /** The exchanges in request order. */
    readonly exchanges: readonly RecordedExchange[];
}
/** The outcome of the injected actual-prediction condition. */
export interface InjectedActualOutcome {
    /** The self report that the plugin keeps in context. */
    readonly self: PredictionOutcome;
    /** The served actual table that follows the self report. */
    readonly actual: PredictionOutcome;
}
/** One client of one OpenAI-compatible endpoint. */
export interface ProviderClient {
    /** The provider definition of the client. */
    readonly definition: ProviderDefinition;
    /** The model name of the client. */
    readonly model: string;
    /** The provider key of the client, expanded with the model name. */
    readonly providerKey: string;
    /** Read the served table of one task. */
    requestPlainActual(task: Task, repetition: number, signal?: AbortSignal): Promise<PredictionOutcome>;
    /** Read the self report of one task. */
    requestPlainSelf(task: Task, repetition: number, signal?: AbortSignal): Promise<PredictionOutcome>;
    /** Inject one served table and read the self report that follows. */
    requestInjectedSelf(task: Task, repetition: number, injected: TokenDistribution, signal?: AbortSignal): Promise<PredictionOutcome>;
    /** Read one self report, keep it in context, and read the served table that follows. */
    requestInjectedActual(task: Task, repetition: number, signal?: AbortSignal): Promise<InjectedActualOutcome>;
}
/**
 * Validate one provider catalog.
 *
 * @param value - the parsed file value.
 * @returns the validated catalog.
 * @throws ExperimentError when the value is not a valid catalog.
 */
export declare function validateProviderCatalog(value: unknown): ProviderCatalog;
/**
 * Select the providers to run.
 *
 * @param catalog - the catalog.
 * @param keys - the requested keys; an empty list selects every enabled provider.
 * @param includeDisabled - true to keep a disabled provider that the caller names.
 * @returns the selected definitions.
 * @throws ExperimentError when a requested key is absent.
 */
export declare function selectProviders(catalog: ProviderCatalog, keys: readonly string[], includeDisabled?: boolean): ProviderDefinition[];
/**
 * Read the API key of one provider.
 *
 * The environment file section wins over the process environment.
 *
 * @param definition - the provider definition.
 * @param environments - the sections of the environment file.
 * @returns the API key, or undefined when the key is absent.
 */
export declare function resolveProviderApiKey(definition: ProviderDefinition, environments: ReadonlyMap<string, {
    readonly apiKey?: string;
}>): string | undefined;
/**
 * Resolve the environment section name of one provider.
 *
 * @param definition - the provider definition.
 * @returns the section name.
 */
export declare function resolveEnvironmentPrefix(definition: ProviderDefinition): string;
/**
 * Apply the environment sections to one catalog.
 *
 * @param catalog - the catalog to update.
 * @param environments - the sections of the environment file.
 * @returns a new catalog with the overrides applied.
 */
export declare function applyProviderEnvironments(catalog: ProviderCatalog, environments: ReadonlyMap<string, {
    readonly baseUrl?: string;
    readonly model?: string;
    readonly models?: readonly string[];
    readonly topLogprobsCount?: number;
    readonly edgeHost?: string;
    readonly thinking?: string;
    readonly reasoning?: string;
}>): ProviderCatalog;
/**
 * Build the provider key of one model.
 *
 * @param providerKey - the provider key.
 * @param model - the model name.
 * @returns the expanded key, as in `huggingface-Qwen-Qwen3-Coder-Next`.
 */
export declare function buildModelProviderKey(providerKey: string, model: string): string;
/**
 * Expand one catalog into one entry for each model.
 *
 * @param catalog - the catalog.
 * @returns the expanded definitions in model order.
 */
export declare function expandProviderModels(catalog: ProviderCatalog): ProviderDefinition[];
/**
 * Resolve the requested keys against one expanded catalog.
 *
 * @param catalog - the catalog.
 * @param keys - the requested keys; an empty list selects every enabled model.
 * @param includeDisabled - true to accept a disabled provider.
 * @returns the selected definitions.
 * @throws ExperimentError when a requested key matches no model.
 */
export declare function resolveRequestedKeys(catalog: ProviderCatalog, keys: readonly string[], includeDisabled?: boolean): ProviderDefinition[];
/**
 * Read the served table of one response body.
 *
 * @param body - the response body.
 * @param topLogprobsCount - the expected entry count.
 * @returns the chosen token and the normalized distribution.
 * @throws ExperimentError when the body holds no served table.
 */
export declare function readServedTable(body: unknown, topLogprobsCount: number): {
    token: string;
    distribution: TokenDistribution;
};
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
export declare function buildEdgeRequestOptions(edgeHost: string, endpoint: string, headers: Readonly<Record<string, string | number>>, bodyText: string, timeoutMilliseconds: number): https.RequestOptions;
/** One client of one OpenAI-compatible chat endpoint. */
export declare class OpenAiCompatibleClient implements ProviderClient {
    /** The provider definition of the client. */
    readonly definition: ProviderDefinition;
    /** The model name of the client. */
    readonly model: string;
    /** The expanded provider key of the client. */
    readonly providerKey: string;
    /** The API key of the client. */
    private readonly apiKey;
    /** The time limit of one request. */
    private readonly timeoutMilliseconds;
    /** The number of requested table entries. */
    private readonly topLogprobsCount;
    /**
     * Create one client.
     *
     * @param definition - the provider definition.
     * @param apiKey - the API key.
     * @param timeoutMilliseconds - the time limit of one request.
     */
    constructor(definition: ProviderDefinition, apiKey: string | undefined, timeoutMilliseconds?: number);
    /**
     * Read the served table of one task.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    requestPlainActual(task: Task, repetition: number, signal?: AbortSignal): Promise<PredictionOutcome>;
    /**
     * Read the self report of one task.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    requestPlainSelf(task: Task, repetition: number, signal?: AbortSignal): Promise<PredictionOutcome>;
    /**
     * Inject one served table and read the self report that follows.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param injected - the served table.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    requestInjectedSelf(task: Task, repetition: number, injected: TokenDistribution, signal?: AbortSignal): Promise<PredictionOutcome>;
    /**
     * Read one self report, keep it in context, and read the served table that follows.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param signal - the cancellation signal.
     * @returns both outcomes.
     */
    requestInjectedActual(task: Task, repetition: number, signal?: AbortSignal): Promise<InjectedActualOutcome>;
    /**
     * Request one served table.
     *
     * @param condition - the condition name.
     * @param repetition - the repetition number.
     * @param messages - the messages of the request.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    private requestServedTable;
    /**
     * Request one self report.
     *
     * @param condition - the condition name.
     * @param repetition - the repetition number.
     * @param messages - the messages of the request.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    private requestSelfReport;
    /**
     * Send one request and record the exchange.
     *
     * @param endpoint - the endpoint URL.
     * @param body - the request body.
     * @param signal - the cancellation signal.
     * @returns the recorded exchange.
     */
    private send;
}
/** One deterministic client that needs no network. */
export declare class MockProviderClient implements ProviderClient {
    /** The provider definition of the client. */
    readonly definition: ProviderDefinition;
    /** The model name of the client. */
    readonly model: string;
    /** The expanded provider key of the client. */
    readonly providerKey: string;
    /** The number of requested table entries. */
    private readonly topLogprobsCount;
    /**
     * Create one mock client.
     *
     * @param definition - the provider definition.
     */
    constructor(definition: ProviderDefinition);
    /**
     * Read one mock served table.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    requestPlainActual(task: Task, repetition: number, _signal?: AbortSignal): Promise<PredictionOutcome>;
    /**
     * Read one mock self report.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    requestPlainSelf(task: Task, repetition: number, _signal?: AbortSignal): Promise<PredictionOutcome>;
    /**
     * Read one mock injected self report.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param injected - the injected table.
     * @param signal - the cancellation signal.
     * @returns the prediction outcome.
     */
    requestInjectedSelf(task: Task, repetition: number, _injected: TokenDistribution, _signal?: AbortSignal): Promise<PredictionOutcome>;
    /**
     * Read one mock injected actual table.
     *
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param signal - the cancellation signal.
     * @returns both outcomes.
     */
    requestInjectedActual(task: Task, repetition: number, _signal?: AbortSignal): Promise<InjectedActualOutcome>;
    /**
     * Build one mock outcome.
     *
     * @param condition - the condition name.
     * @param task - the task.
     * @param repetition - the repetition number.
     * @param source - the origin of the table.
     * @returns the prediction outcome.
     */
    private buildOutcome;
}
/**
 * Build one provider client.
 *
 * @param definition - the provider definition.
 * @param apiKey - the API key.
 * @param timeoutMilliseconds - the time limit of one request.
 * @returns the client.
 */
export declare function createProviderClient(definition: ProviderDefinition, apiKey: string | undefined, timeoutMilliseconds?: number): ProviderClient;
/**
 * Probe whether one client reports a full top-N table.
 *
 * @param client - the client to probe.
 * @param task - the probe task.
 * @param signal - the cancellation signal.
 * @returns the support report.
 */
export declare function probeLogprobsSupport(client: ProviderClient, task: Task, signal?: AbortSignal): Promise<{
    supported: boolean;
    reason?: string;
    entryCount: number;
}>;
/**
 * Build one prediction record from one draft and its raw file names.
 *
 * @param draft - the draft.
 * @param rawFileNames - the raw file names relative to the run directory.
 * @returns the prediction record.
 */
export declare function buildPredictionRecord(draft: PredictionDraft, rawFileNames: readonly string[]): PredictionRecord;
