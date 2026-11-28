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
export const PLUGIN_VERSION = "0.12.0";
/** The version of the experiment protocol that this plugin implements. */
export const PROTOCOL_VERSION = "2.0.0";
/** The name of the tool that runs the experiment. */
export const TOOL_RUN = "llm_self_prediction_run";
/** The name of the tool that lists the sessions. */
export const TOOL_STATUS = "llm_self_prediction_status";
/** The name of the tool that reads one session report. */
export const TOOL_REPORT = "llm_self_prediction_report";
/** The name of the tool that describes the dataset. */
export const TOOL_DATASET = "llm_self_prediction_dataset";
/** The name of the tool that renames one run folder. */
export const TOOL_RENAME = "llm_self_prediction_rename";
/** The name of the tool that prints the help text. */
export const TOOL_HELP = "llm_self_prediction_help";
/** The condition that reads the served `logprobs` table without any prior table in context. */
export const CONDITION_ACTUAL = "actual";
/** The condition that asks the model to report its own table without any prior table in context. */
export const CONDITION_SELF = "self";
/** The condition that injects the served table and then asks for the self table. */
export const CONDITION_ACTUAL_INJECTED_SELF = "actual_injected_self";
/** The condition that reads the served table, keeps it in context, and reads it again. */
export const CONDITION_ACTUAL_INJECTED_ACTUAL = "actual_injected_actual";
/** The four conditions of the protocol in their canonical order. */
export const CONDITION_NAMES = [
    CONDITION_ACTUAL,
    CONDITION_SELF,
    CONDITION_ACTUAL_INJECTED_SELF,
    CONDITION_ACTUAL_INJECTED_ACTUAL,
];
/** The comparison that pairs the self table with the actual table. */
export const COMPARISON_SELF = "self";
/** The comparison that pairs the injected self table with the actual table. */
export const COMPARISON_ACTUAL_INJECTED_SELF = "actual_injected_self";
/** The comparison that pairs the injected actual table with the actual table. */
export const COMPARISON_ACTUAL_INJECTED_ACTUAL = "actual_injected_actual";
/** The three comparisons of the protocol in their canonical order. */
export const COMPARISON_NAMES = [
    COMPARISON_SELF,
    COMPARISON_ACTUAL_INJECTED_SELF,
    COMPARISON_ACTUAL_INJECTED_ACTUAL,
];
/**
 * The raw file name prefixes of an earlier protocol version.
 *
 * A revise pass reads one of these files when the file of the current protocol version is absent.
 * The plan of the earlier protocol asked the same question in the same words for the two entries,
 * so the recorded table is a valid sample of the new condition.
 */
export const LEGACY_CONDITION_NAMES = {
    plain_actual: CONDITION_ACTUAL,
    plain_self: CONDITION_SELF,
};
/** The prefixes of the raw files that the current protocol reads, in lookup order. */
export const REUSABLE_CONDITION_PREFIXES = {
    [CONDITION_ACTUAL]: [CONDITION_ACTUAL, "plain_actual"],
    [CONDITION_SELF]: [CONDITION_SELF, "plain_self"],
    [CONDITION_ACTUAL_INJECTED_SELF]: [CONDITION_ACTUAL_INJECTED_SELF],
    [CONDITION_ACTUAL_INJECTED_ACTUAL]: [CONDITION_ACTUAL_INJECTED_ACTUAL],
};
/**
 * The prefixes of the raw files that the current protocol does not read.
 *
 * The earlier protocol asked a different question in these two conditions. A revise pass removes
 * the files, because no table of the current protocol can replace them.
 */
export const OBSOLETE_CONDITION_PREFIXES = ["injected_self", "injected_actual"];
/** The number of table entries that the protocol requests. */
export const TOP_LOGPROBS_COUNT = 20;
/** The number of repetitions of one condition on one task. */
export const DEFAULT_REPETITION_COUNT = 8;
/** The largest repetition count that one run accepts. */
export const MAX_REPETITION_COUNT = 16;
/** The probability that one side receives for one token that the other side does not report. */
export const PROBABILITY_FLOOR = 1e-12;
/** The divergence in nats below which two distributions count as the same distribution. */
export const DEFAULT_TOLERANCE_NATS = 0.05;
/** The significance level of one hypothesis test. */
export const DEFAULT_ALPHA = 0.05;
/** The directory name of the input files. */
export const INPUTS_DIRECTORY_NAME = "inputs";
/** The directory name of the tested dataset below the inputs directory. */
export const DATASET_DIRECTORY_NAME = "testing-dataset";
/** The dataset files of the protocol, one file for each language. */
export const DATASET_FILE_NAMES = ["dataset-zh-32.json", "dataset-en-32.json"];
/** The default output directory name below the workspace directory. */
export const DEFAULT_OUTPUT_DIRECTORY_NAME = "outputs";
/** The directory name of the intermediate data below one run directory. */
export const INTERMEDIATE_DIRECTORY_NAME = "intermediate";
/** The directory name of the results data below one run directory. */
export const RESULTS_DIRECTORY_NAME = "results";
/** The directory name of the static webpages below one run directory. */
export const DEMOS_DIRECTORY_NAME = "demos";
/** The file name of the run manifest. */
export const MANIFEST_FILE_NAME = "run.json";
/** The file name of the revision record, which lists each file that a revise pass removed. */
export const REVISION_RECORD_FILE_NAME = "revision.json";
/** The file name of the public configuration file that holds the non-secret provider settings. */
export const CONFIG_FILE_NAME = "configs.env";
/** The file name of the configuration file that an earlier plugin version used. */
export const LEGACY_CONFIG_FILE_NAME = "models-to-use.env";
/** The file name of the private environment file. */
export const ENV_FILE_NAME = ".env";
/** The file name of the public example environment file. */
export const ENV_EXAMPLE_FILE_NAME = ".env.example";
/** The environment property that names the code repository of one provider. The property is optional. */
export const ENV_REPO_URL_PROPERTY = "repo_url";
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
/**
 * The properties that the private environment file accepts.
 *
 * The private file holds the optional repository URL, the endpoint, and the API key. Every other
 * property belongs to the public configuration file.
 */
export const PRIVATE_ENVIRONMENT_PROPERTIES = [
    ENV_REPO_URL_PROPERTY,
    ENV_BASE_URL_PROPERTY,
    ENV_API_KEY_PROPERTY,
];
/** The attempt count of one served table request. */
export const SERVED_TABLE_ATTEMPT_COUNT = 3;
/** The attempt count of one request that a rate limit or a server fault can repeat. */
export const REQUEST_ATTEMPT_COUNT = 4;
/** The delay before the first retry of one request. The delay grows with each attempt. */
export const REQUEST_RETRY_DELAY_MILLISECONDS = 4000;
/** The default number of tasks that run at the same time. */
export const DEFAULT_MAX_CONCURRENCY = 3;
/** The default number of bootstrap resamples of one confidence interval. */
export const DEFAULT_BOOTSTRAP_SAMPLE_COUNT = 2000;
/**
 * The default random seed of a run.
 *
 * The number is the date 2026-08-15. On that day Yucheng Liu first tried DeepSeek Harness.
 * The seed drives the bootstrap resampling of one confidence interval, and every run records it.
 */
export const DEFAULT_RANDOM_SEED = 20260815;
/** The default time limit of one provider request. */
export const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 120000;
/** The largest table that one self report may hold. */
export const MAX_PROBABILITY_ENTRY_COUNT = 64;
/** The elapsed time above which one request receives a warning. */
export const SLOW_REQUEST_THRESHOLD_MILLISECONDS = 10000;
