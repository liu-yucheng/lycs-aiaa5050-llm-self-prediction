// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * Markdown report and CSV tables of one run.
 *
 * The report states the question, the protocol, the results, and the limits of the results.
 * Every number comes from the metrics file. The report adds no number that the files do not hold.
 */

import { COMPARISON_NAMES, PLUGIN_NAME, PLUGIN_VERSION } from "./constants.js";
import type {
  ComparisonName,
  ComparisonSummary,
  RevisionRecord,
  SessionEnvironment,
  SessionMetrics,
  TaskRecord,
} from "./types.js";

/** One short description of each comparison. */
const COMPARISON_DESCRIPTIONS: Record<ComparisonName, string> = {
  self:
    "The `self` condition against the `actual` condition. This comparison asks whether the model " +
    "reports the distribution that it produces with no help.",
  actual_injected_self:
    "The `actual_injected_self` condition against the `actual` condition. This comparison asks " +
    "whether a served table in the context moves the self report of the model.",
  actual_injected_actual:
    "The `actual_injected_actual` condition against the `actual` condition. This comparison is the " +
    "control: the model reads the task twice with the served table between the two reads.",
};

/**
 * Format one number with a fixed digit count.
 *
 * @param value - the number.
 * @param digits - the digit count after the decimal point.
 * @returns the text of the number, or `n/a` for a missing value.
 */
export function formatNumber(value: number | undefined, digits = 4): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  return value.toFixed(digits);
}

/**
 * Format one p-value for the report.
 *
 * A p-value below 0.001 keeps three significant digits, because the exact size matters for a
 * strong rejection. A larger p-value keeps four digits after the decimal point.
 *
 * @param value - the p-value.
 * @returns the text of the p-value, or `n/a` for a missing value.
 */
export function formatPValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "n/a";
  }
  if (value < 0.001) {
    return value.toExponential(1);
  }
  return value.toFixed(4);
}

/**
 * Find one comparison summary in a list.
 *
 * @param summaries - the summaries to search.
 * @param comparison - the comparison name.
 * @returns the summary, or undefined when the list holds none.
 */
function findSummary(
  summaries: readonly ComparisonSummary[],
  comparison: ComparisonName,
): ComparisonSummary | undefined {
  return summaries.find((summary) => summary.comparison === comparison);
}

/**
 * Render one comparison table of one result.
 *
 * @param summaries - the comparison summaries.
 * @param toleranceNats - the tolerance of the verdict, in nats.
 * @returns the Markdown table.
 */
function renderComparisonTable(summaries: readonly ComparisonSummary[], toleranceNats: number): string {
  const lines = [
    "| Comparison | Pairs | Median symmetric KL (nats) | Mean symmetric KL (nats) | " +
      "95% interval | p-value | Top-1 agreement | Verdict |",
    "| --- | ---: | ---: | ---: | --- | ---: | ---: | --- |",
  ];
  for (const comparison of COMPARISON_NAMES) {
    const summary = findSummary(summaries, comparison);
    if (summary === undefined) {
      lines.push(`| ${comparison} | 0 | n/a | n/a | n/a | n/a | n/a | inconclusive |`);
      continue;
    }
    const interval = summary.confidenceInterval;
    lines.push(
      `| ${comparison} | ${summary.pairCount} | ` +
        `${formatNumber(summary.medianSymmetricKl)} | ${formatNumber(summary.meanSymmetricKl)} | ` +
        `${formatNumber(interval.lower)} to ${formatNumber(interval.upper)} | ` +
        `${formatPValue(summary.hypothesis.pValue)} | ` +
        `${formatNumber(summary.topTokenAgreementRate, 3)} | ` +
        `${readVerdict(interval, summary, toleranceNats)} |`,
    );
  }
  return lines.join("\n");
}

/**
 * Read the verdict text of one comparison summary.
 *
 * @param interval - the confidence interval of the summary.
 * @param summary - the summary.
 * @param toleranceNats - the tolerance in nats.
 * @returns the verdict text.
 */
function readVerdict(
  interval: { readonly lower: number; readonly upper: number },
  summary: ComparisonSummary,
  toleranceNats: number,
): string {
  if (summary.pairCount === 0) {
    return "inconclusive";
  }
  if (interval.upper < toleranceNats) {
    return "indistinguishable";
  }
  if (interval.lower > toleranceNats) {
    return "separated";
  }
  return "inconclusive";
}

/**
 * Render the group tables of one result.
 *
 * @param groups - the groups to render.
 * @param heading - the heading text.
 * @returns the Markdown section.
 */
function renderGroupSection(
  groups: readonly {
    readonly name: string;
    readonly taskCount: number;
    readonly comparisons: readonly ComparisonSummary[];
  }[],
  heading: string,
  toleranceNats: number,
): string {
  if (groups.length === 0) {
    return "";
  }
  const lines = [
    `### ${heading}`,
    "",
    "| Group | Tasks | Comparison | Mean symmetric KL (nats) | Verdict |",
    "| --- | ---: | --- | ---: | --- |",
  ];
  for (const group of groups) {
    for (const comparison of COMPARISON_NAMES) {
      const summary = findSummary(group.comparisons, comparison);
      if (summary === undefined) {
        continue;
      }
      lines.push(
        `| ${group.name} | ${group.taskCount} | ${comparison} | ` +
          `${formatNumber(summary.meanSymmetricKl)} | ` +
          `${readVerdict(summary.confidenceInterval, summary, toleranceNats)} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Render the report of one run.
 *
 * @param metrics - the session metrics.
 * @param environment - the run environment.
 * @param records - the task records.
 * @returns the Markdown report.
 */
export function renderReport(
  metrics: SessionMetrics,
  environment: SessionEnvironment,
  records: readonly TaskRecord[],
  revisions: readonly RevisionRecord[] = [],
): string {
  const lines: string[] = [];
  lines.push(`# Predict the Next Token of Your Own Model: Run ${metrics.xid}`);
  lines.push("");
  lines.push(
    "This report states one measurement of the ability of a language model to report its own " +
      "next-token distribution.",
  );
  lines.push("");
  lines.push("## Question");
  lines.push("");
  lines.push(
    '"Can LLMs predict their own next token predictions?" The null hypothesis holds that a ' +
      "model reports its own distribution with no error, so each divergence is near 0 nats. The " +
      "alternative hypothesis holds that a model does not learn to report its own distribution " +
      "in training, so each divergence is larger than 0 nats.",
  );
  lines.push("");
  lines.push("## Protocol");
  lines.push("");
  lines.push(`- Run identifier: \`${metrics.xid}\`.`);
  lines.push(`- Protocol version: \`${metrics.protocolVersion}\`.`);
  lines.push(`- Dataset files: ${metrics.datasetIds.map((id) => `\`${id}\``).join(", ")}.`);
  lines.push(`- Languages: ${metrics.languages.join(", ")}.`);
  lines.push(`- Tasks: ${metrics.taskCount}. Repetitions per condition: ${metrics.repetitionCount}.`);
  lines.push(`- Requested table entry count: ${metrics.topLogprobsCount}.`);
  lines.push(`- Tolerance: ${metrics.toleranceNats} nats. Random seed: ${metrics.randomSeed}.`);
  lines.push("");
  lines.push("The run applies four conditions to each task:");
  lines.push("");
  lines.push(
    "1. `actual`: the model reads the task and returns the table of the served distribution. This " +
      "condition gives the ground truth.",
  );
  lines.push(
    "2. `self`: the model reads the task and writes the table of its own distribution as text.",
  );
  lines.push(
    "3. `actual_injected_actual`: the model reads the task, then reads the served table, then " +
      "reads the task again, and then returns the served table of the second read. This condition " +
      "is the control.",
  );
  lines.push(
    "4. `actual_injected_self`: the model reads the task, then reads the served table, and then " +
      "writes the table of its own distribution as text.",
  );
  lines.push("");
  lines.push("The run computes three comparisons:");
  lines.push("");
  for (const comparison of COMPARISON_NAMES) {
    lines.push(`- \`${comparison}\`: ${COMPARISON_DESCRIPTIONS[comparison]}`);
  }
  lines.push("");
  lines.push(
    "Each comparison uses the symmetric Kullback-Leibler divergence in nats. A token that one " +
      "side omits receives a probability floor of 1e-12 before the normalization, so one omitted " +
      "token contributes a large divergence value. The run also reports the Jensen-Shannon " +
      "divergence, the total variation distance, the top-1 agreement, and the support coverage.",
  );
  lines.push("");
  lines.push("## Results");
  lines.push("");
  if (metrics.providers.length === 0) {
    lines.push("The run holds no result.");
  }
  for (const result of metrics.providers) {
    lines.push(`### ${result.model} (\`${result.providerKey}\`)`);
    lines.push("");
    lines.push(`Tasks: ${result.taskCount}.`);
    lines.push("");
    lines.push(renderComparisonTable(result.comparisons, metrics.toleranceNats));
    lines.push("");
    const languageSection = renderGroupSection(
      result.languages,
      "By language",
      metrics.toleranceNats,
    );
    if (languageSection !== "") {
      lines.push(languageSection);
    }
    const categorySection = renderGroupSection(
      result.categories,
      "By category",
      metrics.toleranceNats,
    );
    if (categorySection !== "") {
      lines.push(categorySection);
    }
  }
  lines.push("## Hypothesis test");
  lines.push("");
  lines.push(
    "The null hypothesis holds that the symmetric Kullback-Leibler divergence between the model " +
      "self-prediction and the served distribution is 0 nats, so the model holds the ability to " +
      "report its own next-token distribution. The alternative hypothesis holds that the " +
      "divergence is larger than 0 nats.",
  );
  lines.push("");
  lines.push(
    `The run applies a one-sided Wilcoxon signed-rank test to each comparison at the alpha level ` +
      `${metrics.hypothesis.alpha}. The test uses the per-task median divergence as the sample. ` +
      "The test covers the two self-prediction comparisons. The control comparison is the " +
      "consistency check of the protocol, because a repeat read at the temperature 0 must return " +
      "the same table.",
  );
  lines.push("");
  lines.push("| Comparison | Sample | Median (nats) | z | p-value | Null rejected |");
  lines.push("| --- | ---: | ---: | ---: | ---: | --- |");
  for (const result of metrics.providers) {
    for (const summary of result.comparisons) {
      const test = summary.hypothesis;
      lines.push(
        `| ${result.model} / ${summary.comparison} | ${test.sampleCount} | ` +
          `${formatNumber(test.median)} | ${formatNumber(test.zScore, 3)} | ` +
          `${formatPValue(test.pValue)} | ${test.rejectsNull ? "yes" : "no"} |`,
      );
    }
  }
  lines.push("");
  lines.push(
    `The session verdict is \`${metrics.hypothesis.verdict}\`: ` +
      `${metrics.hypothesis.rejectedCount} of ${metrics.hypothesis.testCount} tests reject the ` +
      `null hypothesis, the smallest p-value is ` +
      `${formatPValue(metrics.hypothesis.smallestPValue)}, and ` +
      `${metrics.hypothesis.controlViolationCount} of ` +
      `${metrics.hypothesis.controlTestCount} control tests stand above the tolerance. The ` +
      `largest control median is ${formatNumber(metrics.hypothesis.controlMedianMaximum)} nats.`,
  );
  lines.push("");
  lines.push(
    "The session holds the alternative hypothesis only when every self-prediction test rejects " +
      "the null hypothesis, every self-prediction median stands above the tolerance, and every " +
      "control median stays at or below the tolerance. A control median above the tolerance " +
      "means that the model does not repeat its own table, so the divergence of that model " +
      "measures the protocol as well as the model.",
  );
  lines.push("");
  lines.push("## Verdicts");
  lines.push("");
  lines.push("| Model | Comparison | Verdict | 95% interval |");
  lines.push("| --- | --- | --- | --- |");
  for (const verdict of metrics.verdicts) {
    for (const entry of verdict.verdicts) {
      lines.push(
        `| ${verdict.model} | ${entry.comparison} | ${entry.verdict} | ` +
          `${formatNumber(entry.intervalLower)} to ${formatNumber(entry.intervalUpper)} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Interpretation");
  lines.push("");
  lines.push(
    "A `separated` verdict means that the interval of the mean divergence stays above the " +
      "tolerance, so the two distributions differ. An `indistinguishable` verdict means that the " +
      "interval stays below the tolerance, so the two distributions are close at the resolution " +
      "of this measurement. An `inconclusive` verdict means that the interval crosses the " +
      "tolerance, so this run does not decide the question.",
  );
  lines.push("");
  lines.push(
    "A small divergence in `self` supports the null hypothesis: the model reports its own " +
      "distribution. A small divergence in `actual_injected_actual` shows that the repeated read " +
      "of the task returns the same distribution, so the protocol adds no error of its own. A " +
      "large divergence in `actual_injected_self` shows that a served table in the context does " +
      "not move the self report of the model.",
  );
  lines.push("");
  lines.push("## Failures and warnings");
  lines.push("");
  const failures = records.flatMap((record) =>
    record.errors.map((error) => `- \`${record.providerKey}\` \`${record.task.id}\`: ${error}`),
  );
  const warnings = records.flatMap((record) =>
    record.warnings.map(
      (warning) => `- \`${record.providerKey}\` \`${record.task.id}\`: ${warning}`,
    ),
  );
  for (const line of failures.slice(0, 50)) {
    lines.push(line);
  }
  for (const line of warnings.slice(0, 50)) {
    lines.push(line);
  }
  if (failures.length === 0 && warnings.length === 0) {
    lines.push("The run records no failure and no warning.");
  }
  if (failures.length > 50) {
    lines.push(`- ${failures.length - 50} more failures are in \`results/records.json\`.`);
  }
  lines.push("");
  if (revisions.length > 0) {
    lines.push("## Revisions");
    lines.push("");
    lines.push("| Revised at | Plugin | Protocol | Repetitions | Reused | Requested | Dropped |");
    lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: |");
    for (const revision of revisions) {
      lines.push(
        `| ${revision.revisedAt} | ${revision.pluginVersion} | ${revision.protocolVersion} | ` +
          `${revision.repetitionCount} | ${revision.reuse.reusedRecordCount} | ` +
          `${revision.reuse.requestedRecordCount} | ${revision.reuse.droppedFileCount} |`,
      );
    }
    lines.push("");
  }
  lines.push("## Reproducibility");
  lines.push("");
  lines.push(
    `- Plugin: \`${PLUGIN_NAME}\` version \`${PLUGIN_VERSION}\`, protocol ` +
      `\`${metrics.protocolVersion}\`.`,
  );
  lines.push(`- Node.js: \`${environment.nodeVersion}\` on \`${environment.platform}\`.`);
  lines.push(`- Started at \`${environment.startedAt}\` and finished at \`${environment.finishedAt}\`.`);
  lines.push(`- Elapsed time: ${environment.elapsedSeconds} seconds.`);
  lines.push(`- Random seed: ${environment.randomSeed}.`);
  if (environment.environmentFile !== undefined) {
    lines.push(`- Environment file: \`${environment.environmentFile}\`.`);
  }
  lines.push("");
  lines.push("## Files");
  lines.push("");
  lines.push("- `run.json` holds the manifest of the run.");
  lines.push("- `intermediate/` holds each raw exchange, one file for each call.");
  lines.push("- `results/records.json` holds each task record with each distribution.");
  lines.push("- `results/metrics.json` holds the metrics that this report shows.");
  lines.push("- `results/summary.csv` holds one row for each model and comparison.");
  lines.push("- `results/tasks.csv` holds one row for each task and comparison.");
  lines.push("- `demos/index.html` shows the visual report of the run.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

/**
 * Render the summary table in comma-separated values.
 *
 * @param metrics - the session metrics.
 * @returns the CSV text.
 */
export function renderSummaryCsv(metrics: SessionMetrics): string {
  const header = [
    "provider_key",
    "model",
    "task_count",
    "comparison",
    "pair_count",
    "mean_kl_actual_predicted",
    "mean_kl_predicted_actual",
    "mean_symmetric_kl",
    "median_symmetric_kl",
    "mean_jensen_shannon",
    "mean_total_variation",
    "top_token_agreement_rate",
    "mean_coverage_predicted_by_actual",
    "mean_coverage_actual_by_predicted",
    "mean_union_support_size",
    "interval_lower",
    "interval_upper",
    "verdict",
  ];
  const rows = [header.join(",")];
  for (const result of metrics.providers) {
    for (const comparison of COMPARISON_NAMES) {
      const summary = findSummary(result.comparisons, comparison);
      if (summary === undefined) {
        continue;
      }
      rows.push(
        [
          result.providerKey,
          csvCell(result.model),
          String(result.taskCount),
          comparison,
          String(summary.pairCount),
          formatNumber(summary.meanKlActualPredicted, 6),
          formatNumber(summary.meanKlPredictedActual, 6),
          formatNumber(summary.meanSymmetricKl, 6),
          formatNumber(summary.medianSymmetricKl, 6),
          formatNumber(summary.meanJensenShannon, 6),
          formatNumber(summary.meanTotalVariation, 6),
          formatNumber(summary.topTokenAgreementRate, 4),
          formatNumber(summary.meanCoveragePredictedByActual, 4),
          formatNumber(summary.meanCoverageActualByPredicted, 4),
          formatNumber(summary.meanUnionSupportSize, 2),
          formatNumber(summary.confidenceInterval.lower, 6),
          formatNumber(summary.confidenceInterval.upper, 6),
          readVerdict(summary.confidenceInterval, summary, metrics.toleranceNats),
        ].join(","),
      );
    }
  }
  return `${rows.join("\n")}\n`;
}

/**
 * Render the task table in comma-separated values.
 *
 * @param records - the task records.
 * @returns the CSV text.
 */
export function renderTasksCsv(records: readonly TaskRecord[]): string {
  const header = [
    "provider_key",
    "model",
    "task_id",
    "language",
    "category",
    "comparison",
    "pair_count",
    "mean_symmetric_kl",
    "median_symmetric_kl",
    "top_token_agreement_rate",
    "mean_coverage_predicted_by_actual",
    "chosen_token",
    "error_count",
  ];
  const rows = [header.join(",")];
  for (const record of records) {
    for (const comparison of COMPARISON_NAMES) {
      const values = record.comparisons[comparison];
      if (values.length === 0) {
        continue;
      }
      const divergences = values.map((value) => value.symmetricKl);
      const mean = divergences.reduce((sum, value) => sum + value, 0) / divergences.length;
      const agreements = values.filter((value) => value.topTokenAgreement).length;
      const coverages = values.map((value) => value.coveragePredictedByActual);
      rows.push(
        [
          record.providerKey,
          csvCell(record.model),
          record.task.id,
          record.task.language ?? "",
          record.task.category,
          comparison,
          String(values.length),
          formatNumber(mean, 6),
          formatNumber(median(divergences), 6),
          formatNumber(agreements / values.length, 4),
          formatNumber(coverages.reduce((sum, value) => sum + value, 0) / coverages.length, 4),
          csvCell(record.task.referenceToken),
          String(record.errors.length),
        ].join(","),
      );
    }
  }
  return `${rows.join("\n")}\n`;
}

/**
 * Read the median of a list of numbers.
 *
 * @param values - the numbers.
 * @returns the median, or undefined for an empty list.
 */
function median(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Quote one comma-separated value when it holds a comma or a quote.
 *
 * @param value - the value.
 * @returns the cell text.
 */
function csvCell(value: string): string {
  if (/[",\n]/u.test(value)) {
    return `"${value.replace(/"/gu, '""')}"`;
  }
  return value;
}
