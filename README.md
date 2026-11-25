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

## Tested models

The public file `models-to-use.env` holds the model list. The probe script measures the four
requirements of the protocol before a run: an open-source model, a top-tier publisher, the latest
version of its series, and a served table of 20 candidates at `temperature=0`.

```text
npm run probe                       # probe every candidate of the publisher list
node scripts/probe-models.mjs --per-org=3 --concurrency=4
```

The probe writes `outputs/probe/report.md`. The list below holds the models that passed on
2026-11-25:

| Publisher | Model | Series |
| --- | --- | --- |
| DeepSeek | `deepseek-ai/DeepSeek-V4.1-Flash-1017` | V4.1 Flash |
| Qwen | `Qwen/Qwen3-Coder-Next` | Qwen3 Coder |
| Moonshot AI | `moonshotai/Kimi-K3.1-Pro` | Kimi K3.1 |
| Z.ai | `zai-org/GLM-5.2` | GLM-5.2 |
| Xiaomi | `XiaomiMiMo/MiMo-V2.6-Pro-RL` | MiMo V2.6 |
| Tencent | `tencent/Hy4` | Hunyuan 4 |
| ByteDance | `ByteDance-Seed/UI-TARS-1.5-7B` | UI-TARS 1.5 |
| MiniMax | `MiniMaxAI/MiniMax-M3` | MiniMax M3 |
| Meta | `meta-llama/Llama-4-Maverick-17B-128E-Instruct` | Llama 4 |
| Google | `google/gemma-4-31B-it` | Gemma 4 |

A model that fails the probe is left out of the run with a warning that names the reason. Two
reasons are common: the endpoint makes the reasoning mode mandatory, or the endpoint serves no
table of candidates.

DeepSeek serves the chosen token only. The endpoint fills every other candidate with a
placeholder value, so the reader keeps the chosen token and the record carries a warning. Use the
DeepSeek provider for a pre-test of the pipeline, not for a published measurement.

## Credentials

The plugin reads `.env` in the workspace root. A repository also holds the public files
`.env.example` and `models-to-use.env`. The first run copies each absent file from the packaged
copy and stops with a prompt when a key is absent. A value in angle brackets counts as an absent
key. Never commit `.env`.

```text
# .env, private: endpoints and keys
huggingface.base_url=https://router.huggingface.co/v1
huggingface.api_key=<your key>
deepseek.base_url=https://api.deepseek.com
deepseek.api_key=<your key>
```

```text
# models-to-use.env, public: the tested models
huggingface.models_to_use=Qwen/Qwen3-Coder-Next, zai-org/GLM-5.2
deepseek.models_to_use=deepseek-flash
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

The plugin holds the catalog in code. It serves two providers, Hugging Face for the test and
DeepSeek for the pre-test, and one local test provider that a dry run selects. The private
`.env` file holds the base URL and the API key. The public `models-to-use.env` file holds the
model list, so a workspace changes the tested models without a change of the private file. A
provider with no model stops the run with a message that names the missing line.

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

# write the demonstration website of a complete run again
node lib/cli.js demos
node lib/cli.js demos 20261125T065931Z_48d684
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

Each page is bilingual. One button switches between English and Simplified Chinese. Each page
leads with a strip of statistic cards, colored verdict badges, and horizontal bars that mark the
tolerance, so the numbers read before the prose.

The pages copy the tokens and the layout of `docs/` and keep three font roles. The sans font
(Arial, SimHei) sets the top bar, the footer, and every chapter and section title. The serif font
(Cambria, NSimSun) sets the body text. The monospace font (Cascadia Mono) sets a code block, a
table number, and the whole Result Explorer. The top-bar mark names the course, `AIAA5050`.

The prose follows ASD-STE100 non-strict mode with an academic US English fallback, and
Simplified Technical Chinese non-strict mode with a 白话文 fallback. Each page states one point in
one short sentence, and a list replaces a paragraph where a list reads faster.

A page change reaches a completed run. The command `node lib/cli.js demos <xid>` reads the
recorded metrics, records, and environment of the run, and it writes the seven pages again from
the current templates.

The Result Explorer shows one task pair in two panes and recomputes the divergence in the
browser from the recorded tables. Pick a model, a comparison, a task, and one repetition for each
side, then press Apply. The page also applies each control change at once. Reset returns to the
first model and the default comparison. Each pane sorts its rows by its own distribution, so the
served pane puts the largest served probability first and the predicted pane puts the largest
predicted probability first.

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
seed 20260815. The run `20261125T050722Z_d59ca3` applied three repetitions to each of the four
conditions of the 64 tasks for five Hugging Face models, and it took 2467 seconds.

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
bash scripts/build-docs.sh              # build, write the pages, publish every run
bash scripts/build-docs.sh --check      # the same, with the type check and the test suite first
bash scripts/build-docs.sh <xid>        # publish the named run only
npm run docs                            # write the pages without the publication step
```

The script compiles the sources, writes `docs/index.html`, `docs/design.html`, `docs/protocol.html`,
`docs/measures.html`, `docs/reference.html`, `docs/reproducibility.html`, and `docs/DETAIL.md`,
publishes the demonstration website of each complete run under `docs/results/<xid>/`, and writes the
list page `docs/results.html`. The documentation pages take 95 percent of the window width.

## Published results

```bash
npm run publish                       # publish every complete run of outputs/
node scripts/publish-results.mjs <xid>  # publish the named run only
```

The command copies the demonstration website of each complete run to
`docs/results/<xid>/` and writes `docs/results.html`. The list page holds a file explorer with one
folder for each published run. A single click previews a page in the same window. A double click
opens the page in a new tab. A facts table below the explorer gives the run identifier, the end
time, the model count, the task count, the served table size, the separated verdict count, and one
link for each of the seven chapter pages.

The copy sends the home button of the top bar to `docs/results.html`. The demonstration website of
the run directory sends the same button to its own `index.html`, so each copy returns to its own
entry point.

## License

GNU Affero General Public License 3.0 or later. See `LICENSE` and `license-2`.
