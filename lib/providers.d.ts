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
 * Create the client of one provider.
 *
 * @param definition - the provider definition.
 * @param timeoutMilliseconds - the ceiling of one request.
 * @returns the client.
 * @throws ExperimentError when a real provider has no credential.
 */
export declare function createProviderClient(definition: ProviderDefinition, timeoutMilliseconds?: number): ProviderClient;
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
