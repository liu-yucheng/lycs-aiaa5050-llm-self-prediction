// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * Orchestration of one run.
 *
 * One job covers one task on one model. A job runs the three repetitions of the four conditions in
 * protocol order, writes each raw exchange below the intermediate directory, and writes the task
 * record below the results directory. The run then computes the metrics and writes the report and
 * the demos.
 */
import path from "node:path";
import { randomBytes } from "node:crypto";
import { CONDITION_INJECTED_ACTUAL, CONDITION_INJECTED_SELF, CONDITION_PLAIN_ACTUAL, CONDITION_PLAIN_SELF, DEFAULT_MAX_CONCURRENCY, DEFAULT_RANDOM_SEED, DEFAULT_REPETITION_COUNT, DEFAULT_TOLERANCE_NATS, DEMOS_DIRECTORY_NAME, ENV_EXAMPLE_FILE_NAME, ENV_FILE_NAME, INTERMEDIATE_DIRECTORY_NAME, PLUGIN_NAME, PLUGIN_VERSION, RESULTS_DIRECTORY_NAME, TOP_LOGPROBS_COUNT, } from "./constants.js";
import { countByCategory, loadDatasets, resolveDatasetDirectory, selectTasks } from "./dataset.js";
import { readDemoOptions, renderDemos } from "./demos.js";
import { readConfiguration } from "./env.js";
import { ExperimentError } from "./errors.js";
import { ensureDirectory, listChildDirectories, readJsonFile, readTextFile, resolveOutputRoot, safeFileSegment, writeJsonFile, writeTextFile, } from "./files.js";
import { computeSessionMetrics, buildTaskRecord } from "./metrics.js";
import { applyProviderEnvironments, buildPredictionRecord, createProviderClient, probeLogprobsSupport, resolveProviderApiKey, resolveRequestedKeys, MOCK_PROVIDER_KEY, } from "./providers.js";
import { createProviderCatalog } from "./catalog.js";
import { DATASET_DIRECTORY_NAME } from "./constants.js";
import { renderReport, renderSummaryCsv, renderTasksCsv } from "./report.js";
/** The probe task of the support check. */
const PROBE_TASK = {
    id: "PROBE",
    category: "probe",
    language: "zh-Hans",
    prefix: "床前明月光，疑是地上",
    referenceToken: "霜",
};
/**
 * Build one run identifier from the start time.
 *
 * The identifier has the shape `<timestamp>_<short-unique-id>`.
 *
 * @param startedAt - the start time of the run.
 * @returns the run identifier.
 */
export function createRunId(startedAt) {
    const stamp = startedAt.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
    return `${stamp}_${randomBytes(3).toString("hex")}`;
}
/**
 * Clamp one integer to a closed range.
 *
 * @param value - the requested value, or undefined for the fallback.
 * @param fallback - the value to use when the request holds none.
 * @param minimum - the smallest accepted value.
 * @param maximum - the largest accepted value.
 * @returns the clamped value.
 */
function clampInteger(value, fallback, minimum, maximum) {
    const base = value === undefined || !Number.isFinite(value) ? fallback : Math.trunc(value);
    return Math.min(maximum, Math.max(minimum, base));
}
/**
 * Build one credential instruction for the run.
 *
 * @param providers - the providers that need a key.
 * @param workspace - the workspace directory.
 * @returns the instruction text.
 */
function buildCredentialPrompt(providers, workspace) {
    const lines = [
        `No API key is available for ${providers.map((provider) => provider.key).join(", ")}.`,
        `Put the key in ${path.join(workspace, ENV_FILE_NAME)}.`,
        "One line holds `<section>.api_key=<your key>`, for example `huggingface.api_key=hf_...`.",
        `The example file ${path.join(workspace, ENV_EXAMPLE_FILE_NAME)} shows each section.`,
    ];
    return lines.join(" ");
}
/**
 * The service that runs the experiment.
 */
export class ExperimentService {
    /** The options of the service. */
    options;
    /**
     * Create one service.
     *
     * @param options - the options of the service.
     */
    constructor(options) {
        this.options = options;
    }
    /**
     * Run one experiment.
     *
     * @param agent - the agent that asks for the run.
     * @param request - the run request.
     * @param signal - the cancellation signal.
     * @returns the run result.
     */
    async run(agent, request, signal) {
        const startedAt = new Date();
        const workspace = await this.options.resolveWorkspace(agent, signal);
        const outputRoot = resolveOutputRoot(workspace, (request.outputDirectory ?? this.options.outputRoot() ?? "").trim());
        const datasetDirectory = await resolveDatasetDirectory(workspace, DATASET_DIRECTORY_NAME);
        const dataset = await loadDatasets(datasetDirectory);
        const configuration = await readConfiguration(workspace);
        const environmentState = configuration.state.environment;
        const catalog = applyProviderEnvironments(createProviderCatalog(), configuration.environments);
        const repetitionCount = clampInteger(request.repetitions, DEFAULT_REPETITION_COUNT, 1, 10);
        const topLogprobsCount = clampInteger(request.topLogprobsCount, TOP_LOGPROBS_COUNT, 2, 64);
        const toleranceNats = request.toleranceNats !== undefined && Number.isFinite(request.toleranceNats)
            ? Math.max(0, request.toleranceNats)
            : DEFAULT_TOLERANCE_NATS;
        const randomSeed = clampInteger(request.randomSeed, DEFAULT_RANDOM_SEED, 0, 2 ** 31 - 1);
        const maxConcurrency = clampInteger(request.maxConcurrency, this.options.defaultMaxConcurrency ?? DEFAULT_MAX_CONCURRENCY, 1, 16);
        const dryRun = request.dryRun === true;
        const selectedTasks = selectTasks(dataset.tasks, request.taskIds ?? []);
        const requestedKeys = dryRun ? [MOCK_PROVIDER_KEY] : (request.providerKeys ?? []);
        const definitions = resolveRequestedKeys(catalog, requestedKeys, dryRun).map((definition) => ({
            ...definition,
            topLogprobsCount: definition.topLogprobsCount ?? topLogprobsCount,
        }));
        if (definitions.length === 0) {
            throw new ExperimentError("INVALID_PROVIDER", "The run selects no provider.");
        }
        const xid = createRunId(startedAt);
        const directory = path.join(outputRoot, xid);
        const intermediateDirectory = path.join(directory, INTERMEDIATE_DIRECTORY_NAME);
        const resultsDirectory = path.join(directory, RESULTS_DIRECTORY_NAME);
        const demosDirectory = path.join(directory, DEMOS_DIRECTORY_NAME);
        await ensureDirectory(intermediateDirectory);
        await ensureDirectory(resultsDirectory);
        const baseEnvironment = {
            nodeVersion: process.version,
            platform: `${process.platform} ${process.arch}`,
            pluginName: PLUGIN_NAME,
            pluginVersion: PLUGIN_VERSION,
            randomSeed,
            startedAt: startedAt.toISOString(),
            finishedAt: startedAt.toISOString(),
            elapsedSeconds: 0,
            environmentFile: environmentState.filePath,
            environmentFileCreated: environmentState.created,
            modelsFile: configuration.state.modelsFilePath,
        };
        const manifest = {
            xid,
            datasetIds: dataset.datasetIds,
            datasetHash: dataset.hash,
            createdAt: startedAt.toISOString(),
            options: {
                providerKeys: [...requestedKeys],
                taskIds: selectedTasks.map((task) => task.id),
                repetitionCount,
                toleranceNats,
                outputDirectory: outputRoot,
                randomSeed,
                maxConcurrency,
                topLogprobsCount,
                dryRun,
            },
            providers: definitions.map((definition) => `${definition.key}:${definition.model}`),
            environment: baseEnvironment,
            status: "running",
        };
        const manifestPath = path.join(directory, "run.json");
        await writeJsonFile(manifestPath, manifest);
        await writeJsonFile(path.join(directory, "tasks.json"), selectedTasks);
        const warnings = [];
        try {
            const clients = [];
            for (const definition of definitions) {
                const apiKey = resolveProviderApiKey(definition, configuration.environments);
                if (apiKey === undefined &&
                    definition.key !== MOCK_PROVIDER_KEY &&
                    !definition.baseUrl.startsWith("mock://")) {
                    throw new ExperimentError("MISSING_CREDENTIAL", buildCredentialPrompt([definition], workspace));
                }
                clients.push(createProviderClient(definition, apiKey));
            }
            const active = [];
            for (const client of clients) {
                if (client.definition.key === MOCK_PROVIDER_KEY) {
                    active.push(client);
                    continue;
                }
                if (client.definition.distribution === "chosen-only") {
                    warnings.push(`The provider ${client.providerKey} serves the chosen token only, so each ` +
                        "distribution holds one token and every divergence is near zero.");
                    active.push(client);
                    continue;
                }
                const support = await probeLogprobsSupport(client, PROBE_TASK, signal);
                if (!support.supported) {
                    warnings.push(`The model ${client.providerKey} reports no top-${topLogprobsCount} table and is ` +
                        `left out: ${(support.reason ?? "the probe table holds one entry").replace(/\.$/u, "")}.`);
                    continue;
                }
                active.push(client);
            }
            if (active.length === 0) {
                throw new ExperimentError("INVALID_PROVIDER", `No model reports a top-${topLogprobsCount} table. ${warnings.join(" ")}`);
            }
            const records = await this.runJobs(active, selectedTasks, repetitionCount, intermediateDirectory, resultsDirectory, maxConcurrency, signal);
            const finishedAt = new Date();
            const metrics = computeSessionMetrics({
                xid,
                datasetIds: dataset.datasetIds,
                languages: dataset.languages,
                records,
                toleranceNats,
                repetitionCount,
                topLogprobsCount,
                randomSeed,
                generatedAt: finishedAt.toISOString(),
                taskCount: selectedTasks.length,
            });
            const environment = {
                ...baseEnvironment,
                finishedAt: finishedAt.toISOString(),
                elapsedSeconds: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
            };
            const reportPath = path.join(resultsDirectory, "report.md");
            await writeJsonFile(path.join(resultsDirectory, "metrics.json"), metrics);
            await writeJsonFile(path.join(resultsDirectory, "records.json"), records);
            await writeTextFile(reportPath, renderReport(metrics, environment, records));
            await writeTextFile(path.join(resultsDirectory, "summary.csv"), renderSummaryCsv(metrics));
            await writeTextFile(path.join(resultsDirectory, "tasks.csv"), renderTasksCsv(records));
            await writeJsonFile(path.join(resultsDirectory, "environment.json"), environment);
            await writeJsonFile(manifestPath, {
                ...manifest,
                environment,
                status: "complete",
            });
            const demosPath = await renderDemos({
                directory: demosDirectory,
                metrics,
                records,
                environment,
                dataset: {
                    datasetIds: dataset.datasetIds,
                    languages: dataset.languages,
                    taskCount: selectedTasks.length,
                    categories: [...countByCategory(selectedTasks).entries()].map(([name, count]) => ({
                        name,
                        count,
                    })),
                },
            });
            return { xid, directory, metrics, reportPath, demosPath, warnings };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await writeJsonFile(manifestPath, {
                ...manifest,
                status: "failed",
                failure: message,
            });
            throw error;
        }
    }
    /**
     * List the status of each run below the output root.
     *
     * @param agent - the agent that asks.
     * @param signal - the cancellation signal.
     * @param limit - the number of runs to report.
     * @returns the statuses, newest first.
     */
    async status(agent, signal, limit = 5) {
        const workspace = await this.options.resolveWorkspace(agent, signal);
        const outputRoot = resolveOutputRoot(workspace, this.options.outputRoot() ?? "");
        const directories = await listChildDirectories(outputRoot);
        const statuses = [];
        for (const directory of directories.reverse().slice(0, Math.max(1, limit))) {
            const manifestPath = path.join(directory, "run.json");
            try {
                const value = await readJsonFile(manifestPath);
                if (typeof value !== "object" || value === null) {
                    continue;
                }
                const manifest = value;
                const details = await this.readRunDetails(directory);
                statuses.push({
                    xid: manifest.xid,
                    directory,
                    status: manifest.status,
                    createdAt: manifest.createdAt,
                    taskCount: details.taskCount,
                    verdicts: details.verdicts,
                    failures: manifest.failure === undefined ? [] : [manifest.failure],
                });
            }
            catch {
                continue;
            }
        }
        return statuses;
    }
    /**
     * Read the task count and the verdicts of one run directory.
     *
     * @param directory - the run directory.
     * @returns the task count and the verdicts; both are empty when the metrics file is absent.
     */
    async readRunDetails(directory) {
        const metricsPath = path.join(directory, RESULTS_DIRECTORY_NAME, "metrics.json");
        try {
            const value = await readJsonFile(metricsPath);
            if (typeof value !== "object" || value === null) {
                return { taskCount: 0, verdicts: [] };
            }
            const metrics = value;
            return {
                taskCount: typeof metrics.taskCount === "number" ? metrics.taskCount : 0,
                verdicts: Array.isArray(metrics.verdicts) ? [...metrics.verdicts] : [],
            };
        }
        catch {
            return { taskCount: 0, verdicts: [] };
        }
    }
    /**
     * Read one run report.
     *
     * @param agent - the agent that asks.
     * @param signal - the cancellation signal.
     * @param xid - the run identifier, or an empty string for the newest run.
     * @returns the report text and the run directory.
     */
    async report(agent, signal, xid) {
        const workspace = await this.options.resolveWorkspace(agent, signal);
        const outputRoot = resolveOutputRoot(workspace, this.options.outputRoot() ?? "");
        const directories = await listChildDirectories(outputRoot);
        const target = xid === undefined || xid.trim() === ""
            ? directories[directories.length - 1]
            : path.join(outputRoot, safeFileSegment(xid.trim()));
        if (target === undefined) {
            throw new ExperimentError("MISSING_SESSION", "The output root holds no run.");
        }
        const reportPath = path.join(target, RESULTS_DIRECTORY_NAME, "report.md");
        try {
            const report = await readTextFile(reportPath);
            return { xid: path.basename(target), directory: target, report };
        }
        catch {
            throw new ExperimentError("MISSING_SESSION", `The run ${path.basename(target)} has no report.`);
        }
    }
    /**
     * Write the demonstration website of one run again.
     *
     * The method reads the recorded metrics, records, and environment of the run. It writes the
     * seven pages and the assets from the current templates, so a template change reaches a run
     * that is already complete.
     *
     * @param agent - the agent that asks.
     * @param signal - the cancellation signal.
     * @param xid - the run identifier, or an empty string for the newest run.
     * @returns the run identifier and the path of the entry page.
     */
    async rewriteDemos(agent, signal, xid) {
        const workspace = await this.options.resolveWorkspace(agent, signal);
        const outputRoot = resolveOutputRoot(workspace, this.options.outputRoot() ?? "");
        const directories = await listChildDirectories(outputRoot);
        const target = xid === undefined || xid.trim() === ""
            ? directories[directories.length - 1]
            : path.join(outputRoot, safeFileSegment(xid.trim()));
        if (target === undefined) {
            throw new ExperimentError("MISSING_SESSION", "The output root holds no run.");
        }
        const options = await readDemoOptions(target);
        const entryPath = await renderDemos(options);
        return { xid: path.basename(target), directory: target, entryPath };
    }
    /**
     * Describe the dataset of one workspace.
     *
     * @param agent - the agent that asks.
     * @param signal - the cancellation signal.
     * @param sampleSize - the number of tasks to show per file.
     * @returns the dataset summaries.
     */
    async datasetSummary(agent, signal, sampleSize = 8) {
        const workspace = await this.options.resolveWorkspace(agent, signal);
        const directory = await resolveDatasetDirectory(workspace, DATASET_DIRECTORY_NAME);
        const dataset = await loadDatasets(directory);
        return dataset.datasets.map((entry) => ({
            datasetId: entry.datasetId,
            language: entry.language,
            description: entry.description,
            taskCount: entry.taskCount,
            sample: entry.tasks.slice(0, Math.max(0, sampleSize)),
        }));
    }
    /**
     * Run each task of each model.
     *
     * @param clients - the active clients.
     * @param tasks - the selected tasks.
     * @param repetitionCount - the repetition count of one condition.
     * @param intermediateDirectory - the intermediate directory.
     * @param resultsDirectory - the results directory.
     * @param maxConcurrency - the number of tasks that run at the same time.
     * @param signal - the cancellation signal.
     * @returns the task records.
     */
    async runJobs(clients, tasks, repetitionCount, intermediateDirectory, resultsDirectory, maxConcurrency, signal) {
        const jobs = [];
        for (const client of clients) {
            for (const task of tasks) {
                jobs.push({ client, task });
            }
        }
        const records = [];
        let next = 0;
        const worker = async () => {
            for (;;) {
                const position = next;
                next += 1;
                if (position >= jobs.length) {
                    return;
                }
                const job = jobs[position];
                if (job === undefined) {
                    return;
                }
                if (signal?.aborted === true) {
                    return;
                }
                const record = await this.runOneTask(job.client, job.task, repetitionCount, intermediateDirectory, resultsDirectory, signal);
                records.push(record);
            }
        };
        const workers = [];
        for (let index = 0; index < Math.min(maxConcurrency, jobs.length); index += 1) {
            workers.push(worker());
        }
        await Promise.all(workers);
        return records;
    }
    /**
     * Run one task on one model.
     *
     * @param client - the client.
     * @param task - the task.
     * @param repetitionCount - the repetition count of one condition.
     * @param intermediateDirectory - the intermediate directory.
     * @param resultsDirectory - the results directory.
     * @param signal - the cancellation signal.
     * @returns the task record.
     */
    async runOneTask(client, task, repetitionCount, intermediateDirectory, resultsDirectory, signal) {
        const taskDirectory = path.join(intermediateDirectory, safeFileSegment(client.providerKey), safeFileSegment(task.id));
        await ensureDirectory(taskDirectory);
        const predictions = {
            plain_actual: [],
            plain_self: [],
            injected_self: [],
            injected_actual: [],
        };
        const errors = [];
        for (let repetition = 1; repetition <= repetitionCount; repetition += 1) {
            try {
                const outcome = await client.requestPlainActual(task, repetition, signal);
                predictions.plain_actual.push(await this.recordOutcome(outcome, taskDirectory, 1));
            }
            catch (error) {
                errors.push(`${CONDITION_PLAIN_ACTUAL} r${repetition}: ${describeError(error)}`);
            }
        }
        for (let repetition = 1; repetition <= repetitionCount; repetition += 1) {
            try {
                const outcome = await client.requestPlainSelf(task, repetition, signal);
                predictions.plain_self.push(await this.recordOutcome(outcome, taskDirectory, 1));
            }
            catch (error) {
                errors.push(`${CONDITION_PLAIN_SELF} r${repetition}: ${describeError(error)}`);
            }
        }
        for (let repetition = 1; repetition <= repetitionCount; repetition += 1) {
            const served = predictions.plain_actual[(repetition - 1) % Math.max(1, predictions.plain_actual.length)];
            if (served === undefined) {
                errors.push(`${CONDITION_INJECTED_SELF} r${repetition}: no served table to inject.`);
                continue;
            }
            try {
                const outcome = await client.requestInjectedSelf(task, repetition, served.distribution, signal);
                predictions.injected_self.push(await this.recordOutcome(outcome, taskDirectory, 1));
            }
            catch (error) {
                errors.push(`${CONDITION_INJECTED_SELF} r${repetition}: ${describeError(error)}`);
            }
        }
        for (let repetition = 1; repetition <= repetitionCount; repetition += 1) {
            try {
                const outcome = await client.requestInjectedActual(task, repetition, signal);
                await this.writeExchanges(outcome.self, taskDirectory, 1);
                const rawFileNames = await this.writeExchanges(outcome.actual, taskDirectory, 2);
                predictions.injected_actual.push(buildPredictionRecord(outcome.actual.draft, rawFileNames));
            }
            catch (error) {
                errors.push(`${CONDITION_INJECTED_ACTUAL} r${repetition}: ${describeError(error)}`);
            }
        }
        const record = buildTaskRecord(task, client.providerKey, client.definition.label, client.model, predictions, errors);
        await writeJsonFile(path.join(resultsDirectory, "records", safeFileSegment(client.providerKey), `${safeFileSegment(task.id)}.json`), record);
        return record;
    }
    /**
     * Write one outcome and build its record.
     *
     * @param outcome - the outcome to write.
     * @param taskDirectory - the intermediate task directory.
     * @param callNumber - the call number of the condition.
     * @returns the prediction record.
     */
    async recordOutcome(outcome, taskDirectory, callNumber) {
        const rawFileNames = await this.writeExchanges(outcome, taskDirectory, callNumber);
        return buildPredictionRecord(outcome.draft, rawFileNames);
    }
    /**
     * Write the raw exchanges of one prediction.
     *
     * @param outcome - the prediction outcome.
     * @param taskDirectory - the directory of the task.
     * @param callNumber - the number of the first call of the outcome.
     * @returns the raw file names relative to the run directory.
     */
    async writeExchanges(outcome, taskDirectory, callNumber) {
        const rawFileNames = [];
        for (let index = 0; index < outcome.exchanges.length; index += 1) {
            const exchange = outcome.exchanges[index];
            if (exchange === undefined) {
                continue;
            }
            const fileName = `${outcome.draft.condition}-r${outcome.draft.repetition}-call${callNumber + index}.json`;
            await writeJsonFile(path.join(taskDirectory, fileName), {
                requestedAt: exchange.requestedAt,
                elapsedMilliseconds: exchange.elapsedMilliseconds,
                endpoint: exchange.endpoint,
                request: exchange.requestBody,
                response: exchange.responseBody,
            });
            rawFileNames.push(fileName);
        }
        return rawFileNames;
    }
}
/**
 * Describe one error in one short line.
 *
 * @param error - the error value.
 * @returns the description.
 */
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
