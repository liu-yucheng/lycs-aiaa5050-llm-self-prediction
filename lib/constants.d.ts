/**
 * Fixed constants of the next-token self-prediction experiment.
 *
 * A value that a human may tune at run time lives in the run options, not here.
 */
/** The Cordis plugin name and the npm package name. */
export declare const PLUGIN_NAME = "lycs-aiaa5050-llm-self-prediction";
/** The plugin version. Keep it equal to the version in `package.json`. */
export declare const PLUGIN_VERSION = "0.4.0";
/** The host tool names. */
export declare const TOOL_RUN = "llm_self_prediction_run";
export declare const TOOL_STATUS = "llm_self_prediction_status";
export declare const TOOL_REPORT = "llm_self_prediction_report";
export declare const TOOL_DATASET = "llm_self_prediction_dataset";
export declare const TOOL_HELP = "llm_self_prediction_help";
/** The forced tool that carries one self-prediction answer. */
export declare const SELF_PREDICTION_TOOL_NAME = "submit_next_token_log_probabilities";
/** The size of the requested top log-probability table. */
export declare const TOP_LOGPROBS_COUNT = 20;
/** The default number of repetitions of each prediction mode. */
export declare const DEFAULT_REPETITION_COUNT = 4;
/** The default lower bound of a reported probability. */
export declare const PROBABILITY_FLOOR = 1e-12;
/** The default tolerance in nats for the "indistinguishable" verdict. */
export declare const DEFAULT_TOLERANCE_NATS = 0.05;
/** The name of the directory that holds the inputs of a workspace. */
export declare const INPUTS_DIRECTORY_NAME = "inputs";
/** The default name of the output directory below the workspace. */
export declare const DEFAULT_OUTPUT_DIRECTORY_NAME = "outputs";
/** The file name of the bundled dataset. */
export declare const DATASET_FILE_NAME = "dataset-128.json";
/** The file name of the bundled provider catalog. */
export declare const PROVIDER_FILE_NAME = "providers.json";
/** The file name of the private environment file. A user fills in the API keys. */
export declare const ENV_FILE_NAME = ".env";
/** The file name of the public environment example file. The plugin copies it to the private one. */
export declare const ENV_EXAMPLE_FILE_NAME = ".env.example";
/** The property names of one provider section in the environment file. */
export declare const ENV_BASE_URL_PROPERTY = "base_url";
export declare const ENV_API_KEY_PROPERTY = "api_key";
export declare const ENV_MODEL_PROPERTY = "model_to_use";
export declare const ENV_MODELS_PROPERTY = "models_to_use";
/** The property names of the optional request tuning of one provider section. */
export declare const ENV_TOP_LOGPROBS_PROPERTY = "top_logprobs";
export declare const ENV_THINKING_PROPERTY = "thinking";
export declare const ENV_REASONING_PROPERTY = "reasoning";
/** The default number of concurrent prediction calls. */
export declare const DEFAULT_MAX_CONCURRENCY = 3;
/** The default number of bootstrap resamples of a confidence interval. */
export declare const DEFAULT_BOOTSTRAP_SAMPLE_COUNT = 2000;
/** The default random seed. A run records the seed that it used. */
export declare const DEFAULT_RANDOM_SEED = 20260815;
/** The ceiling of one provider request in milliseconds. */
export declare const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 120000;
/** The ceiling of one guess in milliseconds. A longer guess is recorded with a warning. */
export declare const SLOW_GUESS_THRESHOLD_MILLISECONDS = 10000;
/** The largest accepted top-log-probability table of one answer. */
export declare const MAX_PROBABILITY_ENTRY_COUNT = 64;
