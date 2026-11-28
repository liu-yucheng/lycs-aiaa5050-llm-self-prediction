/**
 * The built-in provider catalog.
 *
 * The plugin serves three providers. Hugging Face serves the tested models. OpenAI serves a model
 * that returns a strict table of twenty candidate tokens. DeepSeek serves the pre-test, because a
 * short DeepSeek run is cheap and it shows that the protocol works. The catalog holds no API key.
 * The private environment file holds the key and the endpoint, and `configs.env` holds the model
 * list and the switches.
 */
import type { ProviderCatalog } from "./types.js";
/** The provider key of Hugging Face. */
export declare const HUGGINGFACE_PROVIDER_KEY = "huggingface";
/** The provider key of DeepSeek. */
export declare const DEEPSEEK_PROVIDER_KEY = "deepseek";
/** The provider key of OpenAI. */
export declare const OPENAI_PROVIDER_KEY = "openai";
/** The base URL of the Hugging Face router. */
export declare const HUGGINGFACE_BASE_URL = "https://router.huggingface.co/v1";
/** The base URL of the DeepSeek API. */
export declare const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
/** The base URL of the OpenAI API. */
export declare const OPENAI_BASE_URL = "https://api.openai.com/v1";
/** The provider key of the local test provider. */
export declare const MOCK_TEST_PROVIDER_KEY = "mock";
/**
 * Create the built-in provider catalog.
 *
 * @returns a new catalog value. The caller may change the value without a shared side effect.
 */
export declare function createProviderCatalog(): ProviderCatalog;
