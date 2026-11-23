# Next-token self-prediction

This page describes the design of the plugin `lycs-aiaa5050-llm-self-prediction`.
The HTML documentation site starts at [`index.html`](index.html).

## 1. Question

A language model produces a probability for each possible next token.
The provider can return that table through the `logprobs` field.
The experiment asks whether the same model can report that table when a tool call asks for it.

- Null hypothesis: the training did not teach the model to report its own table, so the
  divergence between the actual table and the reported table is clearly above zero.
- Alternative hypothesis: self-prediction emerges from the training, so the divergence is close to zero.

The plugin measures the divergence, its confidence interval, and a baseline, and it reports one
verdict for each provider.

## 2. Flow

1. The user opens a workspace and a session in DeepSeek Harness and names the experiment.
2. The agent calls `llm_self_prediction_run` with the providers, the tasks, and the repetition count.
3. The plugin loads the dataset and the provider catalog, creates one session directory, and
   starts one job for each task and provider pair.
4. A job asks for one actual prediction, then one self prediction, for each repetition.
5. The job writes each raw reply, then one parsed record with the pair metrics.
6. The run writes the aggregate metrics, the report, and the CSV tables.
7. The agent calls `llm_self_prediction_report` and reports the verdict.

A dry run replaces each provider with the mock provider and needs no network.

## 3. Dataset

The dataset `llm-self-prediction-zh-128-v1` holds 128 tasks in eight categories: poetry, idiom,
daily life, food, weather, technology, news, and story.
One category holds 16 tasks.

Each task has four fields:

| Field | Meaning |
| --- | --- |
| `id` | The identifier, from `T001` to `T128`. |
| `category` | The category name. |
| `prefix` | The sentence text before the target token. |
| `referenceToken` | The next token of the source sentence. |

The validator enforces these rules:

- The identifier, the category, the prefix, and the reference token are non-empty strings.
- The identifier is unique.
- The prefix does not end with the reference token.

The reference token is a reference only.
The metrics compare the actual table with the self table, and they never compare either table with
the reference token.

## 4. Requests

### 4.1 Actual prediction

The request sets `max_tokens` to 1, `logprobs` to true, and `top_logprobs` to the support size of
the provider. A provider section sets the size with `<prefix>.top_logprobs`, and a run sets one size
for every provider with the `topLogprobs` argument. The default is 64, which the catalog value
reduces for an endpoint with a lower cap.
The system message asks for one next word, and the user message gives the prefix.
The reply table is `choices[0].logprobs.content[0].top_logprobs`.

### 4.2 Self prediction

The request adds one tool, `submit_next_token_log_probabilities`, and it forces that tool with
`tool_choice`.
The tool takes one list of entries of the same support size, and each entry holds a token and a
natural-log probability.
A section value of `<prefix>.thinking=disabled` turns thinking off, because a reasoning model
refuses a forced tool choice while it thinks.
An entry without a token or without a finite log probability is dropped, and the answer fails only
when every entry is invalid.
The prompt names the prefix, the token count, and the rule that the probabilities sum to one.
The plugin reads the arguments of the first tool call.
A text reply that holds the same JSON object is also accepted, and the raw reply keeps both forms.

### 4.3 Inference parameters

The plugin sends no sampling parameter, so each provider uses its recommended default.
A provider that needs a fixed temperature can set one in `inputs/providers.json`.

## 5. Parsing rules

- A token is normalized with NFKC and trimmed at both ends.
- Two entries with the same normalized token are aggregated by the sum of their probabilities.
- A table with a duplicate, a negative probability, a non-finite value, or a zero sum is an invalid response.
- A missing `logprobs` table, an empty tool call, or a tool argument that breaks the schema is an invalid response.
- An invalid response becomes one error file, one warning, and one missing answer. The run continues.

## 6. Pairing

One task and one provider give `R` actual answers and `R` self answers, with `R` equal to the
repetition count, which defaults to 4.
The plugin compares each actual answer with each self answer, so one task gives `R * R` pairs.
The default run therefore gives 16 pairs for each task and provider.

The plugin also builds two baselines:

- The actual baseline compares each actual answer with each other actual answer.
- The self baseline compares each self answer with each other self answer.

A baseline shows the part of the divergence that comes from the sampling noise alone.

## 7. Measures

For one pair, the plugin aligns the two tables over the union of their tokens.
A token that one side does not report receives the probability floor `1e-12`.
Each side is then renormalized over the union.

| Measure | Definition |
| --- | --- |
| `KL(P||Q)` | `sum(p * ln(p / q))` from the actual table to the self table. |
| `KL(Q||P)` | The same sum in the other direction. |
| `symmetric KL` | The mean of the two directed divergences. |
| `JS` | The Jensen-Shannon divergence, which is bounded by `ln 2`. |
| `TV` | Half the sum of the absolute probability differences, which is bounded by 1. |
| `top-1` | True when the two tables agree on the most likely token. |
| `coverage` | The probability that one table gives to the support of the other table. |
| `union support size` | The count of tokens in the aligned union. |

The aggregate metrics are the mean, the median, and the count of the pairs.
The confidence interval is a percentile bootstrap of the mean symmetric divergence with 2000
resamples and a fixed seed.

## 8. Verdict

The plugin compares the 95 percent confidence interval of the mean symmetric divergence with the
tolerance, which defaults to 0.05 nats.

| Verdict | Condition | Reading |
| --- | --- | --- |
| `separated` | lower bound > tolerance | The self table differs from the actual table by more than the tolerance. |
| `indistinguishable` | upper bound < tolerance | The two tables agree within the tolerance. |
| `inconclusive` | the interval crosses the tolerance | The run needs more pairs, or a smaller tolerance. |

A verdict is a statement about this dataset and these model versions.
It is not a statement about every prompt or every language.

## 9. Failures and warnings

- A provider without its credential fails before the run starts, and the message names the variable.
- A network failure, an HTTP error, an empty reply, or an invalid reply becomes one error file and one warning.
- A slow guess is a warning, and the plugin keeps the guess.
- A run with no successful answer still writes a session, and its status is `complete` only when the run finishes.
- A cancelled run writes the status `failed` and the reason.

## 10. Reproducibility record

`session.json` records the session code, the dataset identifier, the dataset digest, the options,
the provider definitions, the Node.js version, the platform, the plugin version, and the random
seed.
`report.md` repeats the dataset digest, the seed, the versions, and the elapsed time.

## 11. Integrity rules

- The plugin never edits a raw reply.
- The plugin never changes a task, a prompt, or a parsing rule to make a metric pass.
- The report states a number only when a session file supports the number.
- A missing answer stays missing, and it never becomes a zero divergence.

## 12. Module map

| Module | Responsibility |
| --- | --- |
| `src/index.ts` | The host entry, the configuration reader, and the tool registration. |
| `src/tools.ts` | The five tool definitions, the argument validation, and the render functions. |
| `src/experiment.ts` | The session runner, the job pool, the status reader, and the report reader. |
| `src/providers.ts` | The provider catalog, the OpenAI-compatible client, the reply parser, and the mock provider. |
| `src/prompts.ts` | The two prompts, the tool schema, and the tool-argument parser. |
| `src/probability.ts` | The table builder, the alignment, and the divergence measures. |
| `src/metrics.ts` | The pair metrics, the baselines, the bootstrap interval, and the verdicts. |
| `src/report.ts` | The Markdown report and the CSV tables. |
| `src/dataset.ts` | The dataset validation, the loader, the digest, and the task selection. |
| `src/files.ts` | The file helpers, the session code, and the packaged path. |
| `src/errors.ts` | The error codes, the error type, and the record guard. |
| `src/env.ts` | The environment file parser, the section builder, the example copy, and the placeholder rule. |
| `src/constants.ts` | The names, the defaults, and the limits. |
| `src/types.ts` | The shared types. |
| `src/cli.ts` | The command-line interface. |

## 13. Environment file and API keys

The workspace keeps two directories. `inputs/` holds the private file `.env`, the public file
`.env.example`, and optional replacements of the dataset and the provider catalog. `outputs/` holds
one directory for each session. The plugin reads `inputs/.env` first, and the packaged file is the
fallback. A workspace file wins over the packaged file of the same name.

The public file `.env.example` ships with the plugin and holds one section for each provider.
A section has three properties:

- `base_url` overrides the base URL of the provider catalog.
- `model_to_use` overrides the model name of the provider catalog.
- `api_key` holds the credential.

The section name comes from the `environmentPrefix` field of the catalog, so the provider `glm`
uses the section `zhipu`. A property that the section omits keeps the value of `inputs/providers.json`.

When the private file is absent, the first run copies the example file, and the run stops with a
prompt that names the keys to fill in. A process environment variable is the fallback, so a shell
that already exports a key needs no file. A value between angle brackets is a placeholder, and the
run treats it as an absent key. The plugin writes no key to a session file, and `.gitignore` keeps
the private file out of the repository.

A run copies an old `.env` of the workspace root to `inputs/.env` and reports that copy in the
warnings. The old file stays in place, because the plugin does not move a file that holds a
credential.

The command `node lib/cli.js env` prints the path of each file and the state of each key, without
printing a key.

## 14. Limitations

- The actual table comes from the provider, so a provider that returns a truncated or a smoothed
  table limits the comparison.
- The top-64 truncation leaves out the tail of the distribution, so each side is renormalized over a partial support.
- A self prediction is a report, not a measurement, so a model can report a table that differs from its own output.
- The default sample of 128 tasks is small for a claim about a model family.
- One run measures one model version.

## 15. Test coverage

The test suite covers the probability measures against known values, the dataset rules, one full
mock session with its files, the verdict at two tolerances, the tool definitions, the prompt and
tool-argument parsers, the plugin entry point, and the HTTP client against a local server.

The suite runs 34 tests.
The environment tests cover the parser, the sections, the copy of the example, and the prompt of a
missing key.
The entry-point test calls `apply` with a stub host context and runs the registered run tool.
The HTTP test sends one actual request and one self request to a local server and checks the header,
the request body, and the parsed table.

Run the checks with `npm run typecheck` and `npm test`.
