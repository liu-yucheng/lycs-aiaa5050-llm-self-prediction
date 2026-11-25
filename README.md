# lycs-aiaa5050-llm-self-prediction

A DeepSeek Harness plugin for the experiment "Can LLMs predict their own next token
predictions?".

The plugin asks one language model for the top next-token table of one sentence prefix. The
provider computes that table. The plugin then asks the same model to report the table in words.
The distance between the two tables is the measurement.

The plugin runs four conditions at a temperature of zero, compares three of them against the
served table, and writes a bilingual demonstration website beside the numbers.

- Version: 0.6.0
- License: GNU AGPL 3.0 or later
- Runtime: Node.js 20.11 or later, TypeScript 5.9.3
- Author: Yucheng Liu

## The research question

A next-token model computes a probability for each token of its vocabulary at each position. The
provider can report the top entries of that table. Can the model report the same table when a
person asks the model in words?

- Null hypothesis: the self report agrees with the served table, and the divergence is near zero.
  Self-prediction is then an emergent property of next-token training.
- Alternative hypothesis: the divergence is larger than the tolerance. The model predicts text
  well and its own table badly.

A verdict never proves either hypothesis. It states whether the sample supports a difference that
is larger than the tolerance.

## The four conditions

| Condition | Context | Table origin |
| --- | --- | --- |
| `plain_actual` | The task prompt. | The provider logprobs of one served token. |
| `plain_self` | The task prompt. | The JSON table in the reply body. |
| `injected_self` | Task prompt, then an assistant message with a served table. | The JSON table in the second reply. |
| `injected_actual` | Task prompt, then an assistant message with a self report. | The served table that follows. |

Each condition runs three times for each task. Each comparison pairs each actual repetition with
each predicted repetition, so one task gives nine pairs for each comparison.

## The three comparisons

| Comparison | Actual side | Predicted side |
| --- | --- | --- |
| `plain_self` | `plain_actual` | `plain_self` |
| `injected_self` | `plain_actual` | `injected_self` |
| `injected_actual` | `plain_actual` | `injected_actual` |

The plugin reports the directed divergences, the symmetric divergence, the Jensen-Shannon
divergence, the total variation distance, the top-token agreement, the coverage of each side, and
the union support size.

## Install

```bash
npm ci
npm run build
npm test
```

Register the package directory as one bundle, then ask the agent in a session:

```text
plugin_manager install_bundle target=<absolute path of this package>
```

```text
use lycs-aiaa5050-llm-self-prediction to run an experiment
```

## Dataset

`inputs/testing-dataset/` holds two files:

- `dataset-zh-32.json`: 32 Simplified Chinese tasks, dataset `llm-self-prediction-zh32`.
- `dataset-en-32.json`: 32 US English tasks, dataset `llm-self-prediction-en32`.

Each file spreads its tasks over eight categories: poetry, idiom, daily, food, weather,
technology, news, and story.

A task holds an identifier, a category, a language, a sentence prefix, and a reference token. The
validator rejects a duplicate identifier and a prefix that ends with its reference token. No
metric reads the reference token.

## Credentials

The plugin reads `inputs/.env`. The first run copies `inputs/.env.example` to `inputs/.env` and
stops with a prompt when a key is absent. A value in angle brackets counts as an absent key.

```text
huggingface.base_url=https://router.huggingface.co/v1
huggingface.api_key=<your key>
huggingface.models_to_use=Qwen/Qwen3-Coder-Next, zai-org/GLM-5.2
huggingface.reasoning=disabled
```

| Key | Meaning |
| --- | --- |
| `<section>.base_url` | The endpoint that serves the OpenAI-compatible chat route. |
| `<section>.api_key` | The API key of the section. |
| `<section>.model_to_use` | One model name. |
| `<section>.models_to_use` | A comma-separated model list that replaces the catalog list. |
| `<section>.top_logprobs` | The requested table size. |
| `<section>.edge_host` | The edge host, when the network blocks the base URL host. |
| `<section>.thinking` | `disabled` turns the thinking mode off. |
| `<section>.reasoning` | `disabled` turns the reasoning mode off. |

An edge host carries the request through a host that the network permits. The TLS handshake
carries the edge name, and the `Host` header keeps the base URL host, so the edge still selects
the right distribution. The edge certificate replaces the certificate of the base URL host.

`inputs/providers.json` holds the provider catalog. A provider can list several models, and the
plugin expands each model into one client.

## Run

```bash
# a dry run needs no credential and no network
node lib/cli.js run --dry-run --tasks=Z001,E001 --repetitions=1

# a real run on one model
node lib/cli.js run --providers=huggingface-Qwen-Qwen3-Coder-Next

# inspect the state
node lib/cli.js status
node lib/cli.js report
node lib/cli.js dataset
node lib/cli.js env
```

The plugin probes each model with one served table before the run. A model that reports no table
is left out, and the run records one warning for that model.

## Output layout

```text
outputs/<xid>/
  run.json                     the manifest: status, options, providers, versions
  tasks.json                   the selected tasks
  intermediate/<providerKey>/<taskId>/<condition>-r<n>-call<k>.json
  results/metrics.json         the three comparisons, the summaries, the verdicts
  results/records.json         one task record for each task and model
  results/records/<providerKey>/<taskId>.json
  results/report.md            the Markdown report
  results/summary.csv          one row for each provider and comparison
  results/tasks.csv            one row for each task and comparison
  results/environment.json     the recorded versions and the elapsed time
  results/task-summary.json    the compact table that the explorer reads
  demos/index.html             the demonstration website
  demos/assets/                the style sheet, the script, and the data files
```

`xid` is a timestamp and a short random suffix, for example `20261125T114500Z_ab12cd`.

## The demonstration website

`demos/` holds seven chapter pages:

| Page | Content |
| --- | --- |
| `index.html` | Overview and the author motivation. |
| `method.html` | The protocol, the conditions, and the measures. |
| `summary.html` | The tables and the verdicts. |
| `explorer.html` | The Result Explorer. |
| `context.html` | The course topics and the debate topics. |
| `implementation.html` | The platform, the presets, and the run flow. |
| `meaning.html` | What the results mean and do not mean, the limits, and the future work. |

Each page is bilingual. One button switches between English and Simplified Chinese. The Result
Explorer compares one task pair at a time and recomputes the divergence in the browser from the
recorded tables.

## The five tools

| Tool | Purpose |
| --- | --- |
| `llm_self_prediction_run` | Run one session and write the session directory. |
| `llm_self_prediction_status` | List the recent sessions with their verdicts. |
| `llm_self_prediction_report` | Read the Markdown report of one session. |
| `llm_self_prediction_dataset` | Summarize the two dataset files. |
| `llm_self_prediction_help` | Explain the protocol and the provider setup. |

The run tool accepts `providers`, `tasks`, `repetitions`, `toleranceNats`, `outputDirectory`,
`seed`, `maxConcurrency`, `topLogprobsCount`, and `dryRun`.

## Verdict

The plugin computes the mean symmetric divergence of each task, then one bootstrap interval of
that mean with 2000 resamples and a seed of 20260815. The default tolerance is 0.05 nats.

| Interval against the tolerance | Verdict |
| --- | --- |
| The upper bound is below the tolerance. | `indistinguishable` |
| The lower bound is above the tolerance. | `separated` |
| The interval covers the tolerance. | `inconclusive` |
| The comparison holds no pair. | `inconclusive` |

## Settings

| Setting | Type | Meaning |
| --- | --- | --- |
| `outputRoot` | string | The output root. An empty value uses `outputs/` in the workspace. |
| `maxConcurrency` | integer 1 to 16 | The default worker count of one run. |

## Reproducibility

Each run writes `results/environment.json` with the plugin name, the plugin version, the Node.js
version, the platform, the random seed, the start time, the end time, and the elapsed time. The
run also repeats that record in `run.json`.

The plugin writes each raw exchange before the plugin parses the reply. The parse result lives in
a separate file. The plugin never rewrites a raw file and never changes a task or a prompt to make
a metric pass.

A reported run of this machine used Node.js 26.13.0, TypeScript 5.9.3, and Windows 11 x64 with the
seed 20260815.

## Tests

```bash
npm run typecheck
npm test
```

The suite covers the dataset validation, the probability normalizer, the divergence measures, the
pairing, the bootstrap, the verdict rule, the prompt builders, the reply parser, the request
bodies against a local HTTP server, the run directory layout, the tool definitions, the
environment file, and the plugin entry point.

## Documentation

```bash
npm run docs
```

The command writes `docs/index.html`, `docs/design.html`, `docs/protocol.html`,
`docs/measures.html`, `docs/reference.html`, `docs/reproducibility.html`, and `docs/DETAIL.md`.

## License

GNU Affero General Public License 3.0 or later. See `LICENSE` and `license-2`.
