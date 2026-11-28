// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/** The provider key of Hugging Face. */
export const HUGGINGFACE_PROVIDER_KEY = "huggingface";
/** The provider key of DeepSeek. */
export const DEEPSEEK_PROVIDER_KEY = "deepseek";
/** The provider key of OpenAI. */
export const OPENAI_PROVIDER_KEY = "openai";
/** The base URL of the Hugging Face router. */
export const HUGGINGFACE_BASE_URL = "https://router.huggingface.co/v1";
/** The base URL of the DeepSeek API. */
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
/** The base URL of the OpenAI API. */
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
/** The provider key of the local test provider. */
export const MOCK_TEST_PROVIDER_KEY = "mock";
/**
 * Describe one provider of the catalog.
 *
 * The catalog holds the three real providers and one local test provider. The test provider
 * answers without a network, so a test and a dry run need no API key. The catalog disables the
 * test provider, and only a dry run selects it.
 *
 * @returns the four provider definitions in their canonical order.
 */
function describeProviders() {
    return [
        {
            key: HUGGINGFACE_PROVIDER_KEY,
            label: "Hugging Face",
            baseUrl: HUGGINGFACE_BASE_URL,
            model: "",
            models: [],
            apiKeyEnvironmentVariable: "HF_TOKEN",
            environmentPrefix: HUGGINGFACE_PROVIDER_KEY,
            topLogprobsCount: 20,
            reasoning: "disabled",
            enabled: true,
        },
        {
            key: DEEPSEEK_PROVIDER_KEY,
            label: "DeepSeek",
            baseUrl: DEEPSEEK_BASE_URL,
            model: "deepseek-flash",
            models: [],
            apiKeyEnvironmentVariable: "DEEPSEEK_API_KEY",
            environmentPrefix: DEEPSEEK_PROVIDER_KEY,
            topLogprobsCount: 20,
            distribution: "chosen-only",
            thinking: "disabled",
            reasoning: "disabled",
            enabled: true,
        },
        {
            key: OPENAI_PROVIDER_KEY,
            label: "OpenAI",
            baseUrl: OPENAI_BASE_URL,
            model: "",
            models: [],
            apiKeyEnvironmentVariable: "OPENAI_API_KEY",
            environmentPrefix: OPENAI_PROVIDER_KEY,
            topLogprobsCount: 20,
            enabled: true,
        },
        {
            key: MOCK_TEST_PROVIDER_KEY,
            label: "Local test",
            baseUrl: "mock://local",
            model: "mock-flash",
            models: ["mock-flash"],
            apiKeyEnvironmentVariable: "",
            environmentPrefix: MOCK_TEST_PROVIDER_KEY,
            topLogprobsCount: 20,
            enabled: false,
        },
    ];
}
/**
 * Create the built-in provider catalog.
 *
 * @returns a new catalog value. The caller may change the value without a shared side effect.
 */
export function createProviderCatalog() {
    return {
        schemaVersion: 2,
        description: "Hugging Face for the test; OpenAI for the strict table; DeepSeek for the pre-test; " +
            "mock for the local test.",
        providers: describeProviders(),
    };
}
