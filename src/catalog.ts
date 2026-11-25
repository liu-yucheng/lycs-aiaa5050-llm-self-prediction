// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * The built-in provider catalog.
 *
 * The plugin serves two providers. Hugging Face serves the tested models. DeepSeek serves the
 * pre-test, because a short DeepSeek run is cheap and it shows that the protocol works. The catalog
 * holds no API key. The private environment file holds the key, and `models-to-use.env` holds the
 * model list.
 */

import type { ProviderCatalog, ProviderDefinition } from "./types.js";

/** The provider key of Hugging Face. */
export const HUGGINGFACE_PROVIDER_KEY = "huggingface";

/** The provider key of DeepSeek. */
export const DEEPSEEK_PROVIDER_KEY = "deepseek";

/** The base URL of the Hugging Face router. */
export const HUGGINGFACE_BASE_URL = "https://router.huggingface.co/v1";

/** The base URL of the DeepSeek API. */
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/** The provider key of the local test provider. */
export const MOCK_TEST_PROVIDER_KEY = "mock";

/**
 * Describe one provider of the catalog.
 *
 * The catalog holds the two real providers and one local test provider. The test provider answers
 * without a network, so a test and a dry run need no API key. The catalog disables the test
 * provider, and only a dry run selects it.
 *
 * @returns the three provider definitions in their canonical order.
 */
function describeProviders(): ProviderDefinition[] {
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
export function createProviderCatalog(): ProviderCatalog {
  return {
    schemaVersion: 2,
    description: "Hugging Face for the test; DeepSeek for the pre-test; mock for the local test.",
    providers: describeProviders(),
  };
}
