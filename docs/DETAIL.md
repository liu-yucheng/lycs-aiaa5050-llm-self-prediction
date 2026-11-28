# lycs-aiaa5050-llm-self-prediction 0.12.0

A DeepSeek Harness plugin for the experiment "Can LLMs predict their own next token
predictions?". The plugin asks one model for one next-token table, asks the same model to
report that table, and measures the distance between the two tables under two injections.
One run works on one output folder, and a second run on the same folder revises it.

## Research question

A next-token model computes a probability for each token of its vocabulary at each position.
The provider can report the top entries of that table. Can the model report the same table when
a person asks the model in words?

## Hypotheses

- Null hypothesis: the self report agrees with the served table, and the divergence is near zero.
  Self-prediction is then an emergent property of next-token training.
- Alternative hypothesis: the divergence is larger than the tolerance. The model predicts text
  well and its own table badly.

## Conditions

| Condition | Context | Table origin |
| --- | --- | --- |
| `actual` | The task prompt. | The provider logprobs of one served token. |
| `self` | The task prompt. | The JSON table in the reply body. |
| `actual_injected_actual` | Task prompt, then an assistant message with the served table, then the task prompt again. | The provider logprobs of the second read. This condition is the control. |
| `actual_injected_self` | Task prompt, then an assistant message with the served table, then one request for the own table. | The JSON table in the second reply. |

Each condition runs eight times for each task at `temperature: 0`.

## Comparisons

| Comparison | Actual side | Predicted side |
| --- | --- | --- |
| `self` | `actual` | `self` |
| `actual_injected_self` | `actual` | `actual_injected_self` |
| `actual_injected_actual` | `actual` | `actual_injected_actual` |

One comparison pairs each actual repetition with each predicted repetition, so eight
repetitions give sixty-four pairs for each task and comparison.

## Measures

- `klActualPredicted`: the divergence from the actual table to the predicted table, in nats.
- `klPredictedActual`: the divergence from the predicted table to the actual table, in nats.
- `symmetricKl`: the mean of the two directed divergences. This measure carries the verdict.
- `jensenShannon`: the bounded divergence against the mean table, in nats.
- `totalVariation`: one half of the L1 distance between the two tables.
- `topTokenAgreement`: true when both tables name the same most likely token.
- `coveragePredictedByActual` and `coverageActualByPredicted`: the probability mass that the
  other table covers.

A token that one table omits receives the probability floor of 1e-12, and each side is
renormalized after the floor.

## Verdict

The plugin computes the mean symmetric divergence of each task, then one bootstrap interval of
that mean with 2000 resamples and a fixed seed. The default tolerance is 0.05 nats.

- `indistinguishable`: the upper bound of the interval is below the tolerance.
- `separated`: the lower bound of the interval is above the tolerance.
- `inconclusive`: the interval covers the tolerance, or the comparison holds no pair.

## Hypothesis test

The plugin runs one one-sided Wilcoxon signed-rank test for each comparison. The sample is the
per-task median symmetric KL. The null value is the tolerance. The test uses the normal
approximation with a tie correction, drops every zero difference, and reports a one-sided
p-value. A comparison rejects the null hypothesis when the p-value is below alpha.

The session holds the alternative hypothesis only when every comparison rejects the null and
every median stands above the tolerance. The session holds the null hypothesis when no
comparison rejects the null. A mixed result means that one comparison rejects and another one
does not.

## One folder for one run

A run reads one output folder and writes only that folder. A run that names an existing folder
revises it: the pass keeps every raw table that the current protocol reads, requests the absent
tables, and removes each raw file that the current protocol does not read. The folder keeps one
`revision.json` with one entry for each revise pass.

A rename moves the folder to a fresh identifier of the form `<timestamp>_<short identifier>`.
The manifest keeps the old identifier in `previousXid`.


## Dataset

`inputs/testing-dataset/` holds `dataset-zh-32.json` and `dataset-en-32.json`. Each file holds 32
tasks in eight categories. A task holds an identifier, a category, a language, a sentence
prefix, and a reference token. The validator rejects a prefix that ends with its reference
token. No metric reads the reference token.

## Output layout

```text
outputs/<xid>/
  run.json
  revision.json
  tasks.json
  intermediate/<providerKey>/<taskId>/<condition>-r<n>-call<k>.json
  results/metrics.json
  results/records.json
  results/records/<providerKey>/<taskId>.json
  results/report.md
  results/summary.csv
  results/tasks.csv
  results/environment.json
  results/task-summary.json
  demos/index.html
  demos/assets/
```

## Demonstration website

`demos/` holds seven chapter pages: Overview, Method, Summary, Result Explorer, Course and
Debates, Platform, and Meaning and Limits. Each page is bilingual. The Result Explorer compares
one task pair at a time and recomputes the divergence in the browser from the recorded tables.

## Tools

- `llm_self_prediction_run`: run or revise one folder.
- `llm_self_prediction_status`: list the recent sessions.
- `llm_self_prediction_report`: read one Markdown report.
- `llm_self_prediction_rename`: move one folder to a fresh identifier.
- `llm_self_prediction_dataset`: summarize the dataset files.
- `llm_self_prediction_help`: explain the protocol and the provider setup.

## Settings

- `outputRoot`: the output root. An empty value uses `outputs/` in the workspace.
- `maxConcurrency`: the default worker count of one run, from 1 to 16.

## Integrity

- The plugin writes each raw exchange before the plugin parses the reply.
- The plugin never rewrites a raw file and never changes a task or a prompt to make a metric pass.
- Each run records the plugin version, the Node.js version, the platform, the seed, and the times.
- A report states only what the output files support.
