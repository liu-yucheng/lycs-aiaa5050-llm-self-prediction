// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * Fixed constants of the plugin.
 *
 * A constant in this module is read-only data. The experiment protocol names four conditions and
 * three comparisons, and the module holds both lists in their canonical order.
 */

/** The package name of the plugin. */
export const PLUGIN_NAME = "lycs-aiaa5050-llm-self-prediction";

/** The semantic version of the plugin. */
export const PLUGIN_VERSION = "0.6.0";

/** The name of the tool that runs the experiment. */
export const TOOL_RUN = "llm_self_prediction_run";

/** The name of the tool that lists the sessions. */
export const TOOL_STATUS = "llm_self_prediction_status";

/** The name of the tool that reads one session report. */
export const TOOL_REPORT = "llm_self_prediction_report";

/** The name of the tool that describes the dataset. */
export const TOOL_DATASET = "llm_self_prediction_dataset";

/** The name of the tool that prints the help text. */
export const TOOL_HELP = "llm_self_prediction_help";

/** The condition that reads the served `logprobs` table without any prior table in context. */
export const CONDITION_PLAIN_ACTUAL = "plain_actual";

/** The condition that asks the model to report its own table without any prior table in context. */
export const CONDITION_PLAIN_SELF = "plain_self";

/** The condition that injects the plain actual table and then asks for the self table. */
export const CONDITION_INJECTED_SELF = "injected_self";

/** The condition that keeps a self table in context and then reads the served actual table. */
export const CONDITION_INJECTED_ACTUAL = "injected_actual";

/** The four conditions of the protocol in their canonical order. */
export const CONDITION_NAMES = [
  CONDITION_PLAIN_ACTUAL,
  CONDITION_PLAIN_SELF,
  CONDITION_INJECTED_SELF,
  CONDITION_INJECTED_ACTUAL,
] as const;

/** The comparison that pairs the plain self table with the plain actual table. */
export const COMPARISON_PLAIN_SELF = "plain_self";

/** The comparison that pairs the injected self table with the plain actual table. */
export const COMPARISON_INJECTED_SELF = "injected_self";

/** The comparison that pairs the injected actual table with the plain actual table. */
export const COMPARISON_INJECTED_ACTUAL = "injected_actual";

/** The three comparisons of the protocol in their canonical order. */
export const COMPARISON_NAMES = [
  COMPARISON_PLAIN_SELF,
  COMPARISON_INJECTED_SELF,
  COMPARISON_INJECTED_ACTUAL,
] as const;

/** The number of table entries that the protocol requests. */
export const TOP_LOGPROBS_COUNT = 20;

/** The number of repetitions of one condition on one task. */
export const DEFAULT_REPETITION_COUNT = 3;

/** The probability that one side receives for one token that the other side does not report. */
export const PROBABILITY_FLOOR = 1e-12;

/** The divergence in nats below which two distributions count as the same distribution. */
export const DEFAULT_TOLERANCE_NATS = 0.05;

/** The directory name of the input files. */
export const INPUTS_DIRECTORY_NAME = "inputs";

/** The directory name of the tested dataset below the inputs directory. */
export const DATASET_DIRECTORY_NAME = "testing-dataset";

/** The dataset files of the protocol, one file for each language. */
export const DATASET_FILE_NAMES = ["dataset-zh-32.json", "dataset-en-32.json"] as const;

/** The default output directory name below the workspace directory. */
export const DEFAULT_OUTPUT_DIRECTORY_NAME = "outputs";

/** The directory name of the intermediate data below one run directory. */
export const INTERMEDIATE_DIRECTORY_NAME = "intermediate";

/** The directory name of the results data below one run directory. */
export const RESULTS_DIRECTORY_NAME = "results";

/** The directory name of the static webpages below one run directory. */
export const DEMOS_DIRECTORY_NAME = "demos";

/** The file name of the provider catalog. */
export const PROVIDER_FILE_NAME = "providers.json";

/** The file name of the private environment file. */
export const ENV_FILE_NAME = ".env";

/** The file name of the public example environment file. */
export const ENV_EXAMPLE_FILE_NAME = ".env.example";

/** The environment property that overrides the base URL of one provider. */
export const ENV_BASE_URL_PROPERTY = "base_url";

/** The environment property that overrides the model of one provider. */
export const ENV_MODEL_PROPERTY = "model_to_use";

/** The environment property that overrides the model list of one provider. */
export const ENV_MODELS_PROPERTY = "models_to_use";

/** The environment property that holds the API key of one provider. */
export const ENV_API_KEY_PROPERTY = "api_key";

/** The environment property that names one permitted network edge of a provider. */
export const ENV_EDGE_HOST_PROPERTY = "edge_host";

/** The environment property that overrides the table entry count of one provider. */
export const ENV_TOP_LOGPROBS_PROPERTY = "top_logprobs";

/** The environment property that sets the `thinking` switch of one provider. */
export const ENV_THINKING_PROPERTY = "thinking";

/** The environment property that sets the `reasoning` switch of one provider. */
export const ENV_REASONING_PROPERTY = "reasoning";

/** The attempt count of one request that a rate limit or a server fault can repeat. */
export const REQUEST_ATTEMPT_COUNT = 4;

/** The delay before the first retry of one request. The delay grows with each attempt. */
export const REQUEST_RETRY_DELAY_MILLISECONDS = 4000;

/** The default number of tasks that run at the same time. */
export const DEFAULT_MAX_CONCURRENCY = 3;

/** The default number of bootstrap resamples of one confidence interval. */
export const DEFAULT_BOOTSTRAP_SAMPLE_COUNT = 2000;

/** The default random seed of a run. */
export const DEFAULT_RANDOM_SEED = 20260815;

/** The default time limit of one provider request. */
export const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 120000;

/** The largest table that one self report may hold. */
export const MAX_PROBABILITY_ENTRY_COUNT = 64;

/** The elapsed time above which one request receives a warning. */
export const SLOW_REQUEST_THRESHOLD_MILLISECONDS = 10000;
