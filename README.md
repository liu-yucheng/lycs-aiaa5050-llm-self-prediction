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

The dataset holds 128 next-token tasks in eight categories: 64 Simplified Chinese tasks and 64
US English tasks.
The provider is OpenRouter, and one `.env` section lists the models to use.
A run probes each listed model and keeps the models that return a `logprobs` table at
`top_logprobs` = 20, as the experiment design requires.
The plugin sends no sampling parameter, so every model keeps its recommended default.

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
- The private file `inputs/.env` with one API key for each provider that the run uses.
  The mock provider needs no key.

## Install

The package directory is a bundle. Register the bundle in the profile:

```text
plugin_manager install_bundle target=<absolute path of this package>
```

The bundle patch mounts one row with the id `aiaa5050-llm-self-prediction`.
The row accepts two settings:

| Setting | Default | Meaning |
| --- | --- | --- |
| `outputRoot` | empty | The output root. An empty value uses `outputs` in the workspace. |
| `maxConcurrency` | 3 | The maximum count of concurrent task jobs. |

A change of the source needs `npm run build` and a host restart, because the host keeps the module that it loaded.

## Workspace layout

Every path stays inside one of two directories of the workspace:

| Directory | Content |
| --- | --- |
| `inputs/` | The private `.env`, the example `.env.example`, and optional dataset or provider files. |
| `outputs/` | One directory for each session, named by the session code. |

A run reads `inputs/.env` first, then `inputs/dataset-128.json`, and then `inputs/providers.json`.
A file that `inputs/` does not hold comes from the package.
The first run copies the packaged `.env.example` to `inputs/.env` and stops with the credential prompt.
A run also copies an old `.env` of the workspace root to `inputs/.env`, and it reports that copy.

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
node lib/cli.js run --limit=8
node lib/cli.js status --limit=5
node lib/cli.js report --session=<session code>
node lib/cli.js dataset --sample=8
node lib/cli.js env
```

The command line writes below `outputs` in the current directory unless `--output` names another
root.

## Dataset

The file `inputs/dataset-128.json` holds the dataset `llm-self-prediction-zh64-en64-v2`.
Each task has an identifier, a language tag, a category, a sentence prefix, and one reference next
token. The identifiers `Z001` to `Z064` are Simplified Chinese tasks, and `E001` to `E064` are US
English tasks.
The prompt of a task uses the language of that task.
The prefix ends before the reference token, and the validator rejects a task that breaks this rule.
The dataset is read-only during a run.

## Credentials

The plugin reads the private file `inputs/.env` in the workspace.
The public file `inputs/.env.example` ships with the plugin and holds one section for each provider:

```text
openrouter.base_url=https://openrouter.ai/api/v1
openrouter.api_key=<Your API key.>
openrouter.models_to_use=google/gemini-4-neon:batch, qwen/qwen3.8-flash
```

The property `models_to_use` holds a comma-separated model list, and the plugin expands the list
into one provider per model. The property `model_to_use` sets one model.
The optional properties `top_logprobs` and `reasoning` apply to every model of the section.

A section overrides the base URL and the model list of the catalog, and it carries the API key.
A property that the section omits keeps the value of `inputs/providers.json`.

When `inputs/.env` is absent, the first run copies `inputs/.env.example` to `inputs/.env` and stops
with a prompt that names the keys to fill in. A process environment variable is the fallback, so a shell that already
exports `OPENROUTER_API_KEY` needs no file. The plugin never writes a key to a session file, and
`.gitignore` keeps `.env` out of the repository.

The command `node lib/cli.js env` prints the path of the file and the state of each key without
printing a key.

## Providers

The file `inputs/providers.json` declares the providers.
The catalog holds one OpenRouter provider and one local mock provider.
OpenRouter uses an OpenAI-compatible chat-completions endpoint.

| Key | Section of `.env` | Models |
| --- | --- | --- |
| `openrouter` | `openrouter` | The seven models of `models_to_use` |
| `mock` | none | `mock-flash` |

The plugin expands `models_to_use` into one provider per model, and the report names the model of
each row. A run accepts a model identifier wherever it accepts a provider key.

The actual request sets `logprobs` to true and `top_logprobs` to 20.
The self request asks for the 20 most likely tokens, either through the forced tool
`submit_next_token_log_probabilities` or as one JSON object in the message body, and the plugin
parses either form.

A model answers no `logprobs` table when it spends its first tokens on reasoning, and the design
needs a clean next-token distribution. The catalog sets `reasoning` to `disabled`, and a section
changes it with `<prefix>.reasoning`. A run also sends `provider.require_parameters` to true, so
OpenRouter ignores an upstream endpoint that cannot serve the request.

OpenRouter sells a `:batch` variant that answers no chat completion request. The plugin drops that
suffix from the request and keeps the variant name in the catalog, the report, and the file names.

Before the tasks start, a run probes each listed model with one short actual request. A model that
returns no table at `top_logprobs` = 20 is excluded and the report lists the reason. A run stops
with `INVALID_PROVIDER` when no model passes the probe.

A `.env` section sets the support size with `<prefix>.top_logprobs`, and a run sets it for every
model with the `topLogprobs` argument or the `--top-logprobs` option. The plugin rejects a value
that is not an integer from 1 to 64.

## Output

Each run writes one session directory below the output root.

| Path | Content |
| --- | --- |
| `session.json` | The session code, the options, the providers, and the environment. |
| `tasks.json` | The tasks of the session. |
| `raw/` | Each provider reply, unedited, named `<provider>-<task>-<mode>-r<n>.json`. |
| `raw/<provider>-<task>-<mode>-r<n>.error.json` | The record of one failed call. |
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

The test suite runs 35 tests, which cover the probability measures, the dataset rules, the
environment file, one full mock session, the tool definitions, the prompts, the plugin entry
point, and the HTTP client of a provider against a local server.

## Recorded versions

- Result of the check: Node.js 26.13.0 on the command line and Node.js 24.21.0 in the host runtime.
- Tool versions: TypeScript 5.9.3.
- Platform: Windows 11 x64.
- Random seed: 20260815.
- Plugin version: 0.5.0.

## Licence

GNU Affero General Public License 3.0 or later.
See `LICENSE` and `license-2`.
