// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * Format one number for a human reader.
 *
 * @param value - the number to format.
 * @param digits - the number of decimal places.
 * @returns the fixed-point text.
 */
export function formatNumber(value, digits = 6) {
    if (!Number.isFinite(value)) {
        return "n/a";
    }
    return value.toFixed(digits);
}
/**
 * Render the Markdown report of one session.
 *
 * @param metrics - the session metrics.
 * @param session - the session manifest.
 * @param records - the task records of the session.
 * @returns the report text.
 */
export function renderReport(metrics, session, records) {
    const lines = [];
    lines.push("# Next-token self-prediction report");
    lines.push("");
    lines.push(`Session: \`${metrics.sessionCode}\``);
    lines.push(`Dataset: \`${metrics.datasetId}\``);
    lines.push(`Generated: ${metrics.generatedAt}`);
    lines.push("");
    lines.push("## 1. Question");
    lines.push("");
    lines.push("Does a language model report the next-token distribution that it actually produces?");
    lines.push("The run compares the actual distribution of the `logprobs` table with the distribution that " +
        "the model reports through a forced tool call.");
    lines.push("");
    lines.push("## 2. Method");
    lines.push("");
    lines.push(`The dataset holds ${metrics.taskCount} tasks in these languages: ${metrics.datasetLanguage}.`);
    lines.push(`Each task and each model gives ${metrics.repetitionCount} actual predictions and ` +
        `${metrics.repetitionCount} self predictions.`);
    lines.push(`The actual table requests \`top_logprobs\` = ${metrics.topLogprobsCount}.`);
    lines.push("");
    lines.push("The run reports these quantities for each actual-versus-self pair.");
    lines.push("");
    lines.push("- `KL(P||Q)`: the divergence from the actual distribution to the self distribution.");
    lines.push("- `KL(Q||P)`: the divergence from the self distribution to the actual distribution.");
    lines.push("- `symmetric KL`: the mean of the two directed divergences.");
    lines.push("- `JS`: the Jensen-Shannon divergence, in nats.");
    lines.push("- `TV`: the total-variation distance.");
    lines.push("- `top-1`: the fraction of pairs that agree on the most likely token.");
    lines.push("");
    lines.push("A token that one side does not report receives a probability floor, and each side is " +
        "renormalized over the token union.");
    lines.push(`The verdict uses a tolerance of ${metrics.toleranceNats} nats and a bootstrap confidence ` +
        "interval of the mean symmetric divergence.");
    lines.push("");
    lines.push("## 3. Results");
    lines.push("");
    lines.push("| Provider | Model | Tasks | Pairs | Mean symmetric KL | 95% interval | " +
        "Mean KL(P\\|\\|Q) | Mean KL(Q\\|\\|P) | Mean JS | Top-1 | Verdict |");
    lines.push("| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |");
    for (const provider of metrics.providers) {
        const interval = `${formatNumber(provider.confidenceInterval.lower, 4)} to ` +
            `${formatNumber(provider.confidenceInterval.upper, 4)}`;
        lines.push(`| ${provider.provider.label} | \`${provider.provider.model}\` | ${provider.taskCount} | ` +
            `${provider.pairCount} | ${formatNumber(provider.summary.meanSymmetricKl)} | ${interval} | ` +
            `${formatNumber(provider.summary.meanKlActualSelf)} | ` +
            `${formatNumber(provider.summary.meanKlSelfActual)} | ` +
            `${formatNumber(provider.summary.meanJensenShannon)} | ` +
            `${formatNumber(provider.summary.topTokenAgreementRate, 3)} | ${provider.verdict} |`);
    }
    lines.push("");
    lines.push("### Baseline");
    lines.push("");
    lines.push("The baseline is the mean symmetric divergence between two predictions of the same mode.");
    lines.push("It shows how much the sampling noise alone contributes.");
    lines.push("");
    lines.push("| Provider | Baseline symmetric KL | Separated pair fraction |");
    lines.push("| --- | ---: | ---: |");
    for (const provider of metrics.providers) {
        lines.push(`| ${provider.provider.label} | ${formatNumber(provider.baselineSymmetricKl)} | ` +
            `${formatNumber(provider.separatedFraction, 3)} |`);
    }
    lines.push("");
    lines.push("### By language");
    lines.push("");
    const languages = [
        ...new Set(metrics.providers.flatMap((provider) => Object.keys(provider.languages))),
    ].sort();
    lines.push(`| Language | ${metrics.providers.map((provider) => provider.provider.label).join(" | ")} |`);
    lines.push(`| --- | ${metrics.providers.map(() => "---:").join(" | ")} |`);
    for (const language of languages) {
        const cells = metrics.providers.map((provider) => {
            const summary = provider.languages[language];
            return summary === undefined ? "n/a" : formatNumber(summary.meanSymmetricKl);
        });
        lines.push(`| ${language} | ${cells.join(" | ")} |`);
    }
    lines.push("");
    lines.push("### By category");
    lines.push("");
    const categories = [
        ...new Set(metrics.providers.flatMap((provider) => Object.keys(provider.categories))),
    ].sort();
    lines.push(`| Category | ${metrics.providers.map((provider) => provider.provider.label).join(" | ")} |`);
    lines.push(`| --- | ${metrics.providers.map(() => "---:").join(" | ")} |`);
    for (const category of categories) {
        const cells = metrics.providers.map((provider) => {
            const summary = provider.categories[category];
            return summary === undefined ? "n/a" : formatNumber(summary.meanSymmetricKl);
        });
        lines.push(`| ${category} | ${cells.join(" | ")} |`);
    }
    lines.push("");
    lines.push("## 4. Interpretation");
    lines.push("");
    lines.push("A `separated` verdict means that the confidence interval of the mean symmetric divergence " +
        "lies above the tolerance.");
    lines.push("An `indistinguishable` verdict means that the interval lies below the tolerance.");
    lines.push("An `inconclusive` verdict means that the interval crosses the tolerance.");
    lines.push("A verdict is a statement about this dataset and these model versions, not about every " +
        "possible prompt.");
    lines.push("");
    lines.push("## 5. Failures and warnings");
    lines.push("");
    const errors = records.flatMap((record) => record.errors.map((error) => `${record.providerKey}/${record.task.id}: ${error}`));
    const warnings = metrics.providers.flatMap((provider) => provider.warnings);
    if (errors.length === 0 && warnings.length === 0) {
        lines.push("The run recorded no failure and no warning.");
    }
    else {
        for (const error of errors.slice(0, 40)) {
            lines.push(`- Failure: ${error}`);
        }
        if (errors.length > 40) {
            lines.push(`- ${errors.length - 40} more failures are in \`records/\`.`);
        }
        for (const warning of warnings.slice(0, 40)) {
            lines.push(`- Warning: ${warning}`);
        }
    }
    lines.push("");
    lines.push("## 6. Reproducibility");
    lines.push("");
    lines.push(`- Dataset hash: \`${session.datasetHash}\``);
    lines.push(`- Random seed: ${session.environment.randomSeed}`);
    lines.push(`- Plugin: \`${session.environment.pluginName}\` ${session.environment.pluginVersion}`);
    lines.push(`- Node.js: ${session.environment.nodeVersion}`);
    lines.push(`- Platform: ${session.environment.platform}`);
    lines.push(`- Started: ${session.environment.startedAt}`);
    lines.push(`- Finished: ${session.environment.finishedAt}`);
    lines.push(`- Elapsed: ${session.environment.elapsedSeconds.toFixed(1)} s`);
    lines.push("");
    lines.push("## 7. Files");
    lines.push("");
    lines.push("- `session.json`: the run configuration and the environment.");
    lines.push("- `tasks.json`: the tasks that the run used.");
    lines.push("- `raw/`: the raw provider replies, unedited.");
    lines.push("- `records/`: the parsed answers and the pair metrics of each task.");
    lines.push("- `metrics.json`: the aggregate metrics.");
    lines.push("- `summary.csv` and `tasks.csv`: the same numbers in table form.");
    lines.push("");
    return `${lines.join("\n")}\n`;
}
/**
 * Render the provider summary as CSV.
 *
 * @param metrics - the session metrics.
 * @returns the CSV text with a header row.
 */
export function renderSummaryCsv(metrics) {
    const header = [
        "provider_key",
        "model",
        "task_count",
        "pair_count",
        "mean_symmetric_kl",
        "median_symmetric_kl",
        "mean_kl_actual_self",
        "mean_kl_self_actual",
        "mean_jensen_shannon",
        "mean_total_variation",
        "top1_agreement_rate",
        "baseline_symmetric_kl",
        "ci_lower",
        "ci_upper",
        "separated_fraction",
        "verdict",
    ];
    const rows = [header.join(",")];
    for (const provider of metrics.providers) {
        rows.push([
            provider.providerKey,
            provider.provider.model,
            provider.taskCount,
            provider.pairCount,
            formatNumber(provider.summary.meanSymmetricKl),
            formatNumber(provider.summary.medianSymmetricKl),
            formatNumber(provider.summary.meanKlActualSelf),
            formatNumber(provider.summary.meanKlSelfActual),
            formatNumber(provider.summary.meanJensenShannon),
            formatNumber(provider.summary.meanTotalVariation),
            formatNumber(provider.summary.topTokenAgreementRate),
            formatNumber(provider.baselineSymmetricKl),
            formatNumber(provider.confidenceInterval.lower),
            formatNumber(provider.confidenceInterval.upper),
            formatNumber(provider.separatedFraction),
            provider.verdict,
        ].join(","));
    }
    return `${rows.join("\n")}\n`;
}
/**
 * Render the per-task metrics as CSV.
 *
 * @param records - the task records.
 * @returns the CSV text with a header row.
 */
export function renderTasksCsv(records) {
    const header = [
        "provider_key",
        "model",
        "task_id",
        "category",
        "actual_count",
        "self_count",
        "pair_count",
        "mean_symmetric_kl",
        "mean_kl_actual_self",
        "mean_kl_self_actual",
        "top1_agreement_rate",
        "baseline_symmetric_kl",
        "error_count",
    ];
    const rows = [header.join(",")];
    for (const record of records) {
        rows.push([
            record.providerKey,
            record.provider.model,
            record.task.id,
            record.task.category,
            record.actual.length,
            record.self.length,
            record.summary.pairCount,
            formatNumber(record.summary.meanSymmetricKl),
            formatNumber(record.summary.meanKlActualSelf),
            formatNumber(record.summary.meanKlSelfActual),
            formatNumber(record.summary.topTokenAgreementRate),
            formatNumber(record.baselineSymmetricKl),
            record.errors.length,
        ].join(","));
    }
    return `${rows.join("\n")}\n`;
}
