import { type ProviderEnvironment } from "./env.js";
import type { PredictionAnswer, ProbabilityEntry, ProviderCatalog, ProviderDefinition, Task } from "./types.js";
/** The mock provider key. */
export declare const MOCK_PROVIDER_KEY = "mock";
/** One prediction request. */
export interface PredictionRequest {
    readonly mode: "actual" | "self";
    readonly task: Task;
    readonly repetition: number;
    readonly topLogprobsCount: number;
}
/** One client that answers one prediction request. */
export interface ProviderClient {
    readonly definition: ProviderDefinition;
    predict(request: PredictionRequest, signal: AbortSignal): Promise<PredictionAnswer>;
}
/** The validated provider catalog. */
export declare function validateProviderCatalog(value: unknown): ProviderCatalog;
/**
 * Load the provider catalog.
 *
 * @param filePath - the path of the catalog file. The default is the packaged file.
 * @returns the validated catalog.
 */
export declare function loadProviderCatalog(filePath?: string): Promise<ProviderCatalog>;
/**
 * Select the providers of one run.
 *
 * @param catalog - the validated catalog.
 * @param keys - the requested keys; an empty list selects every enabled provider.
 * @param includeDisabled - true to accept a requested provider that the catalog disables.
 * @returns the selected definitions in catalog order.
 * @throws ExperimentError when a requested key is absent.
 */
export declare function selectProviders(catalog: ProviderCatalog, keys: readonly string[], includeDisabled: boolean): ProviderDefinition[];
/**
 * Read the credential of one provider from its environment variable.
 *
 * @param definition - the provider definition.
 * @returns the credential, or undefined when the variable is absent or empty.
 */
export declare function readProviderCredential(definition: ProviderDefinition): string | undefined;
/**
 * Read the section name of one provider in the environment file.
 *
 * @param definition - the provider definition.
 * @returns the section name, which defaults to the provider key.
 */
export declare function resolveEnvironmentPrefix(definition: ProviderDefinition): string;
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
export declare function resolveProviderApiKey(definition: ProviderDefinition, environments: ReadonlyMap<string, ProviderEnvironment>): string | undefined;
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
export declare function applyProviderEnvironments(catalog: ProviderCatalog, environments: ReadonlyMap<string, ProviderEnvironment>): ProviderCatalog;
/**
 * Create the client of one provider.
 *
 * @param definition - the provider definition.
 * @param timeoutMilliseconds - the ceiling of one request.
 * @returns the client.
 * @throws ExperimentError when a real provider has no credential.
 */
export declare function createProviderClient(definition: ProviderDefinition, timeoutMilliseconds?: number, apiKeyOverride?: string): ProviderClient;
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
export declare function parseProviderReply(request: PredictionRequest, raw: unknown, startedAt: number, endpoint: string, requestBody: unknown): PredictionAnswer;
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
export declare function buildMockDistribution(task: Task, mode: "actual" | "self", repetition: number, entryCount: number): ProbabilityEntry[];
