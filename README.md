# lycs-aiaa5050-llm-self-prediction

A DeepSeek Harness plugin for the next-token self-prediction experiment.
The plugin extends Experiment 8A, "Guess the Next Word: Who Gets It Right?".

## What it does

The plugin asks one language model two questions about the same sentence prefix.

1. Next-token prediction: the provider returns the top 64 log probabilities of the next token.
2. Next-token self-prediction: a forced tool call asks the model to report the same table itself.

The run compares the two tables with a two-way Kullback-Leibler divergence.
A divergence close to zero supports the self-prediction hypothesis.
A divergence above the tolerance supports the null hypothesis.
Each task and each provider gives four actual predictions and four self predictions, so one task
gives sixteen actual-versus-self pairs.
The plugin also measures a baseline, which is the divergence between two predictions of the same
mode, so the report separates the model effect from the sampling noise.

The dataset holds 128 Simplified Chinese next-token tasks in eight categories.
The default providers are the flash models of DeepSeek, Qwen, and GLM, and the plugin uses the
provider default inference parameters.

## Documentation

The documentation site starts at [`docs/index.html`](docs/index.html).
Open that file in a browser, or serve the `docs/` directory with any static file server.
Each page covers one part of the experiment:

| Page | Content |
| --- | --- |
| `docs/index.html` | Overview, the two questions, install, and the five tools. |
| `docs/design.html` | Hypotheses, run flow, dataset rules, prompts, and pairing. |
| `docs/protocol.html` | Request bodies, the forced tool schema, and the reply rules. |
| `docs/measures.html` | Alignment, divergence measures, the bootstrap, and the verdict. |
| `docs/reference.html` | Tool arguments, command line, settings, output layout, failures. |
| `docs/reproducibility.html` | Recorded fields, integrity rules, limitations, tests. |

[`docs/DETAIL.md`](docs/DETAIL.md) is the Markdown source that the plugin detail page shows.

## Requirements

- DeepSeek Harness 0.2.0 or later.
- Node.js 20.11 or later.
- One credential for each provider that the run uses. The mock provider needs no credential.

## Install

The package directory is a bundle. Register the bundle in the profile:

```text
plugin_manager install_bundle target=<absolute path of this package>
```

The bundle patch mounts one row with the id `aiaa5050-llm-self-prediction`.
The row accepts two settings:

| Setting | Default | Meaning |
| --- | --- | --- |
| `outputRoot` | empty | The output root. An empty value uses `.outputs` in the workspace. |
| `maxConcurrency` | 3 | The maximum count of concurrent task jobs. |

A change of the source needs `npm run build` and a host restart, because the host keeps the module that it loaded.

## Run in DeepSeek Harness

1. Open a workspace and a session.
2. Write a request that names the experiment, for example:
   "use lycs-aiaa5050-llm-self-prediction to run an experiment".
3. The agent calls `llm_self_prediction_run`.
4. The agent calls `llm_self_prediction_report` and reports the result.

A tool call with `dryRun` uses the mock provider, writes a complete session, and needs no network.

## Tools

| Tool | Purpose |
| --- | --- |
| `llm_self_prediction_run` | Run one session and write the session directory. |
| `llm_self_prediction_status` | List the recent sessions with the verdict of each provider. |
| `llm_self_prediction_report` | Read the Markdown report of one session. |
| `llm_self_prediction_dataset` | Summarize the dataset and list the first tasks. |
| `llm_self_prediction_help` | Explain the experiment and the provider setup. |

## Command line

```text
node lib/cli.js run --dry-run --limit=2 --repetitions=2
node lib/cli.js run --providers=deepseek,qwen --limit=8
node lib/cli.js status --limit=5
node lib/cli.js report --session=<session code>
node lib/cli.js dataset --sample=8
```

The command line writes below `.outputs` in the current directory unless `--output` names another
root.

## Dataset

The file `inputs/dataset-zh-128.json` holds the dataset `llm-self-prediction-zh-128-v1`.
Each task has an identifier, a category, a sentence prefix, and one reference next token.
The prefix ends before the reference token, and the validator rejects a task that breaks this rule.
The dataset is read-only during a run.

## Providers

The file `inputs/providers.json` declares the providers.
Each provider uses an OpenAI-compatible chat-completions endpoint.

| Key | Model | Environment variable |
| --- | --- | --- |
| `deepseek` | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| `qwen` | `qwen-flash` | `DASHSCOPE_API_KEY` |
| `glm` | `glm-4.5-flash` | `ZHIPU_API_KEY` |
| `mock` | `mock-flash` | none |

The actual request sets `logprobs` and `top_logprobs` to 64.
The self request forces the tool `submit_next_token_log_probabilities` with one entry list of at
most 64 token and log-probability pairs.

## Output

Each run writes one session directory below the output root.

| Path | Content |
| --- | --- |
| `session.json` | The session code, the options, the providers, and the environment. |
| `tasks.json` | The tasks of the session. |
| `raw/` | Each provider reply, unedited. |
| `raw/<task>-<mode>-r<n>.error.json` | The record of one failed call. |
| `records/<provider>-<task>.json` | The parsed answers, the pair metrics, and the warnings. |
| `metrics.json` | The aggregate metrics and the verdict of each provider. |
| `report.md` | The readable report. |
| `summary.csv` and `tasks.csv` | The same numbers in table form. |

The plugin never edits a raw reply.
A failed call becomes one error file and one warning, and it never stops the run.

## Verdict

The plugin reports `KL(P||Q)`, `KL(Q||P)`, the mean of the two, the Jensen-Shannon divergence, the
total-variation distance, the top-1 agreement, and the coverage of each support.

A token that one side does not report receives the probability floor `1e-12`, and each side is
renormalized over the token union.
The verdict compares the bootstrap confidence interval of the mean symmetric divergence with the
tolerance, which defaults to 0.05 nats.

- `separated`: the lower bound is above the tolerance.
- `indistinguishable`: the upper bound is below the tolerance.
- `inconclusive`: the interval crosses the tolerance.

## Check the source

```text
npm install
npm run typecheck
npm test
```

The test suite runs 24 tests, which cover the probability measures, the dataset rules, one full
mock session, the tool definitions, the prompts, the plugin entry point, and the HTTP client of a
provider against a local server.

## Recorded versions

- Result of the check: Node.js 26.13.0 on the command line and Node.js 24.21.0 in the host runtime.
- Tool versions: TypeScript 5.9.3.
- Platform: Windows 11 x64.
- Random seed: 20260815.
- Plugin version: 0.2.0.

## Licence

GNU Affero General Public License 3.0 or later.
See `LICENSE` and `license-2`.
