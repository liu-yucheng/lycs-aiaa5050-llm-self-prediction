// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * Fixed constants of the next-token self-prediction experiment.
 *
 * A value that a human may tune at run time lives in the run options, not here.
 */

/** The Cordis plugin name and the npm package name. */
export const PLUGIN_NAME = "lycs-aiaa5050-llm-self-prediction";

/** The plugin version. Keep it equal to the version in `package.json`. */
export const PLUGIN_VERSION = "0.2.0";

/** The host tool names. */
export const TOOL_RUN = "llm_self_prediction_run";
export const TOOL_STATUS = "llm_self_prediction_status";
export const TOOL_REPORT = "llm_self_prediction_report";
export const TOOL_DATASET = "llm_self_prediction_dataset";
export const TOOL_HELP = "llm_self_prediction_help";

/** The forced tool that carries one self-prediction answer. */
export const SELF_PREDICTION_TOOL_NAME = "submit_next_token_log_probabilities";

/** The size of the requested top log-probability table. */
export const TOP_LOGPROBS_COUNT = 64;

/** The default number of repetitions of each prediction mode. */
export const DEFAULT_REPETITION_COUNT = 4;

/** The default lower bound of a reported probability. */
export const PROBABILITY_FLOOR = 1e-12;

/** The default tolerance in nats for the "indistinguishable" verdict. */
export const DEFAULT_TOLERANCE_NATS = 0.05;

/** The default name of the output directory below the workspace. */
export const DEFAULT_OUTPUT_DIRECTORY_NAME = ".outputs";

/** The file name of the bundled dataset. */
export const DATASET_FILE_NAME = "dataset-zh-128.json";

/** The file name of the bundled provider catalog. */
export const PROVIDER_FILE_NAME = "providers.json";

/** The default number of concurrent prediction calls. */
export const DEFAULT_MAX_CONCURRENCY = 3;

/** The default number of bootstrap resamples of a confidence interval. */
export const DEFAULT_BOOTSTRAP_SAMPLE_COUNT = 2000;

/** The default random seed. A run records the seed that it used. */
export const DEFAULT_RANDOM_SEED = 20260815;

/** The ceiling of one provider request in milliseconds. */
export const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 120000;

/** The ceiling of one guess in milliseconds. A longer guess is recorded with a warning. */
export const SLOW_GUESS_THRESHOLD_MILLISECONDS = 10000;

/** The largest accepted top-log-probability table of one answer. */
export const MAX_PROBABILITY_ENTRY_COUNT = 64;
