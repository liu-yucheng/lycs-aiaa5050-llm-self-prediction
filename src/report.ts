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
  SessionEnvironment,
  SessionMetrics,
  TaskRecord,
} from "./types.js";

/** One short description of each comparison. */
const COMPARISON_DESCRIPTIONS: Record<ComparisonName, string> = {
  plain_self:
    "The plain self-prediction against the plain actual prediction. This comparison asks whether " +
    "the model reports the distribution that it produces with no help.",
  injected_self:
    "The self-prediction with the actual table in the context, against the plain actual " +
    "prediction. This comparison asks whether the model reads a given table and rewrites it.",
  injected_actual:
    "The actual prediction with a self-predicted table in the context, against the plain actual " +
    "prediction. This comparison asks whether a self-prediction moves the real prediction.",
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
    "| Comparison | Pairs | Mean symmetric KL (nats) | 95% interval | Top-1 agreement | " +
      "Coverage predicted | Coverage actual | Verdict |",
    "| --- | ---: | ---: | --- | ---: | ---: | ---: | --- |",
  ];
  for (const comparison of COMPARISON_NAMES) {
    const summary = findSummary(summaries, comparison);
    if (summary === undefined) {
      lines.push(`| ${comparison} | 0 | n/a | n/a | n/a | n/a | n/a | inconclusive |`);
      continue;
    }
    const interval = summary.confidenceInterval;
    lines.push(
      `| ${comparison} | ${summary.pairCount} | ${formatNumber(summary.meanSymmetricKl)} | ` +
        `${formatNumber(interval.lower)} to ${formatNumber(interval.upper)} | ` +
        `${formatNumber(summary.topTokenAgreementRate, 3)} | ` +
        `${formatNumber(summary.meanCoveragePredictedByActual, 3)} | ` +
        `${formatNumber(summary.meanCoverageActualByPredicted, 3)} | ` +
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
  lines.push(`- Dataset files: ${metrics.datasetIds.map((id) => `\`${id}\``).join(", ")}.`);
  lines.push(`- Languages: ${metrics.languages.join(", ")}.`);
  lines.push(`- Tasks: ${metrics.taskCount}. Repetitions per condition: ${metrics.repetitionCount}.`);
  lines.push(`- Requested table entry count: ${metrics.topLogprobsCount}.`);
  lines.push(`- Tolerance: ${metrics.toleranceNats} nats. Random seed: ${metrics.randomSeed}.`);
  lines.push("");
  lines.push("The run applies four conditions to each task:");
  lines.push("");
  lines.push(
    "1. `plain_actual`: the model reads the task and returns the table of the served " +
      "distribution. This condition gives the ground truth.",
  );
  lines.push(
    "2. `plain_self`: the model reads the task and writes the table of its own distribution as " +
      "text.",
  );
  lines.push(
    "3. `injected_self`: the model reads the served table, and then writes its own table as text.",
  );
  lines.push(
    "4. `injected_actual`: the model writes its own table, and then reads the task with that " +
      "table in the context. The run reads the served distribution again.",
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
    "A small divergence in `plain_self` supports the null hypothesis for the plain condition. A " +
      "small divergence in `injected_self` shows that the model copies a table that the context " +
      "gives. A large divergence in `injected_actual` shows that a self-prediction does not move " +
      "the served distribution.",
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
  lines.push("## Reproducibility");
  lines.push("");
  lines.push(`- Plugin: \`${PLUGIN_NAME}\` version \`${PLUGIN_VERSION}\`.`);
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
