// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * The experiment runner.
 *
 * One run loads the read-only inputs, creates one client for each selected provider, and writes
 * one session directory. A provider failure is a recorded failure of one call, and it never stops
 * the run. The runner writes each raw reply before it writes a parsed record.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MAX_CONCURRENCY, DEFAULT_RANDOM_SEED, DEFAULT_REPETITION_COUNT, DEFAULT_TOLERANCE_NATS, MAX_PROBABILITY_ENTRY_COUNT, PLUGIN_NAME, PLUGIN_VERSION, TOP_LOGPROBS_COUNT, } from "./constants.js";
import { computeDatasetHash, loadDataset, selectTasks } from "./dataset.js";
import { DATASET_FILE_NAME, PROVIDER_FILE_NAME } from "./constants.js";
import { buildProviderEnvironments, describeEnvironmentKey, ensureEnvironmentFile, readEnvironmentFile, } from "./env.js";
import { ExperimentError, errorMessage } from "./errors.js";
import { createSessionCode, ensureDirectory, listChildDirectories, readJsonFile, readTextFile, resolveInputPath, resolveOutputRoot, safeFileSegment, writeJsonFile, writeTextFile, } from "./files.js";
import { buildTaskRecord, computeSessionMetrics, resolveTolerance } from "./metrics.js";
import { applyProviderEnvironments, createProviderClient, MOCK_PROVIDER_KEY, loadProviderCatalog, resolveEnvironmentPrefix, resolveProviderApiKey, selectProviders, } from "./providers.js";
import { renderReport, renderSummaryCsv, renderTasksCsv } from "./report.js";
/** The service that a tool, a command, and the CLI share. */
export class ExperimentService {
    options;
    /**
     * Create one service.
     *
     * @param options - the workspace resolver, the output root reader, and the logger.
     */
    constructor(options) {
        this.options = options;
    }
    /**
     * Run one experiment and write one session directory.
     *
     * @param agent - the agent of the tool call.
     * @param request - the run request.
     * @param signal - the cancellation signal of the call.
     * @returns the result of the run.
     */
    async run(agent, request, signal) {
        const startedAt = new Date();
        const workspace = await this.options.resolveWorkspace(agent, signal);
        const requestedRoot = (request.outputDirectory ?? "").trim();
        const outputRoot = resolveOutputRoot(workspace, requestedRoot === "" ? this.options.outputRoot() : requestedRoot);
        const datasetPath = await resolveInputPath(workspace, DATASET_FILE_NAME);
        const dataset = await loadDataset(datasetPath);
        const environmentState = await ensureEnvironmentFile(workspace);
        const environmentValues = environmentState.filePath === undefined
            ? {}
            : await readEnvironmentFile(environmentState.filePath);
        const environments = buildProviderEnvironments(environmentValues);
        const providerPath = await resolveInputPath(workspace, PROVIDER_FILE_NAME);
        const catalog = applyProviderEnvironments(await loadProviderCatalog(providerPath), environments);
        const dryRun = request.dryRun === true;
        const requestedKeys = dryRun ? [dryRunProviderKey(catalog)] : (request.providerKeys ?? []);
        const repetitionCount = clampInteger(request.repetitions ?? DEFAULT_REPETITION_COUNT, 1, DEFAULT_REPETITION_COUNT * 2, "repetitions");
        const limit = clampInteger(request.limit ?? 0, 0, dataset.tasks.length, "limit");
        const tasks = selectTasks(dataset, request.taskIds ?? [], limit);
        if (tasks.length === 0) {
            throw new ExperimentError("INVALID_ARGUMENT", "The run selected no task.");
        }
        const providers = selectProviders(catalog, requestedKeys, dryRun);
        if (providers.length === 0) {
            throw new ExperimentError("INVALID_PROVIDER", "The run selected no provider.");
        }
        const setupWarnings = checkProviderCredentials(providers, environments, environmentState, dryRun);
        if (environmentState.migratedFrom !== undefined) {
            setupWarnings.push(`The run copied the old environment file ${environmentState.migratedFrom} to ` +
                `${environmentState.filePath ?? ""}. The inputs directory is the new home.`);
        }
        const clients = providers.map((provider) => createProviderClient(provider, undefined, resolveProviderApiKey(provider, environments)));
        const randomSeed = request.randomSeed ?? DEFAULT_RANDOM_SEED;
        const toleranceNats = resolveTolerance(request.toleranceNats ?? DEFAULT_TOLERANCE_NATS);
        const maxConcurrency = clampInteger(request.maxConcurrency ?? this.options.defaultMaxConcurrency ?? DEFAULT_MAX_CONCURRENCY, 1, 16, "maxConcurrency");
        const supportCount = clampEntryCount(request.topLogprobsCount ??
            Math.max(...providers.map((provider) => provider.topLogprobsCount ?? TOP_LOGPROBS_COUNT)));
        const options = {
            providerKeys: providers.map((provider) => provider.key),
            taskIds: tasks.map((task) => task.id),
            repetitionCount,
            toleranceNats,
            outputDirectory: outputRoot,
            randomSeed,
            maxConcurrency,
            topLogprobsCount: supportCount,
            dryRun,
        };
        const sessionCode = createSessionCode(startedAt, randomSeed);
        const directory = path.join(outputRoot, sessionCode);
        await ensureDirectory(path.join(directory, "raw"));
        await ensureDirectory(path.join(directory, "records"));
        const manifest = {
            sessionCode,
            datasetId: dataset.datasetId,
            datasetHash: computeDatasetHash(dataset),
            createdAt: startedAt.toISOString(),
            options,
            providers,
            environment: {
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
            },
            status: "running",
        };
        await writeJsonFile(path.join(directory, "session.json"), manifest);
        await writeJsonFile(path.join(directory, "tasks.json"), { tasks });
        this.options.logger?.info(`llm-self-prediction: session ${sessionCode} starts with ${tasks.length} tasks, ` +
            `${providers.length} providers, ${repetitionCount} repetitions.`);
        try {
            const records = await this.runJobs(directory, tasks, clients, repetitionCount, maxConcurrency, supportCount, signal);
            const generatedAt = new Date().toISOString();
            const metrics = computeSessionMetrics({
                sessionCode,
                datasetId: dataset.datasetId,
                records,
                toleranceNats,
                repetitionCount,
                topLogprobsCount: supportCount,
                randomSeed,
                generatedAt,
                taskCount: tasks.length,
                providers,
            });
            const finishedAt = new Date();
            const finalManifest = {
                ...manifest,
                status: "complete",
                environment: {
                    ...manifest.environment,
                    finishedAt: finishedAt.toISOString(),
                    elapsedSeconds: (finishedAt.getTime() - startedAt.getTime()) / 1000,
                },
            };
            await writeJsonFile(path.join(directory, "session.json"), finalManifest);
            await writeJsonFile(path.join(directory, "metrics.json"), metrics);
            await writeTextFile(path.join(directory, "report.md"), renderReport(metrics, finalManifest, records));
            await writeTextFile(path.join(directory, "summary.csv"), renderSummaryCsv(metrics));
            await writeTextFile(path.join(directory, "tasks.csv"), renderTasksCsv(records));
            const warnings = [
                ...setupWarnings,
                ...metrics.providers.flatMap((provider) => provider.warnings),
            ];
            this.options.logger?.info(`llm-self-prediction: session ${sessionCode} is complete in ` +
                `${((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)}s.`);
            return {
                sessionCode,
                outputDirectory: directory,
                metrics,
                reportPath: path.join(directory, "report.md"),
                warnings,
            };
        }
        catch (error) {
            const failedAt = new Date();
            const failedManifest = {
                ...manifest,
                status: "failed",
                failure: errorMessage(error),
                environment: {
                    ...manifest.environment,
                    finishedAt: failedAt.toISOString(),
                    elapsedSeconds: (failedAt.getTime() - startedAt.getTime()) / 1000,
                },
            };
            await writeJsonFile(path.join(directory, "session.json"), failedManifest);
            throw error;
        }
    }
    /**
     * Run every task and provider pair with a bounded number of concurrent jobs.
     *
     * @param directory - the session directory.
     * @param tasks - the selected tasks.
     * @param clients - the provider clients.
     * @param repetitionCount - the repetition count.
     * @param maxConcurrency - the job limit.
     * @param signal - the cancellation signal.
     * @returns the task records in dataset order.
     */
    async runJobs(directory, tasks, clients, repetitionCount, maxConcurrency, supportCount, signal) {
        const jobs = [];
        for (const task of tasks) {
            for (const client of clients) {
                jobs.push({ task, client });
            }
        }
        const records = new Array(jobs.length);
        let nextIndex = 0;
        let completed = 0;
        const worker = async () => {
            for (;;) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= jobs.length) {
                    return;
                }
                const job = jobs[index];
                signal.throwIfAborted();
                const record = await this.runOneTask(directory, job.task, job.client, repetitionCount, supportCount);
                records[index] = record;
                completed += 1;
                if (completed % 16 === 0 || completed === jobs.length) {
                    this.options.logger?.info(`llm-self-prediction: ${completed} of ${jobs.length} task records are complete.`);
                }
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
     * Run the repetitions of one task and one provider.
     *
     * @param directory - the session directory.
     * @param task - the task.
     * @param client - the provider client.
     * @param repetitionCount - the repetition count.
     * @returns the task record.
     */
    async runOneTask(directory, task, client, repetitionCount, supportCount) {
        const actual = [];
        const self = [];
        const errors = [];
        for (let repetition = 1; repetition <= repetitionCount; repetition += 1) {
            for (const mode of ["actual", "self"]) {
                try {
                    const answer = await client.predict({ mode, task, repetition, topLogprobsCount: supportCount }, new AbortController().signal);
                    const target = path.join(directory, "raw", safeFileSegment(answer.rawFileName));
                    await writeJsonFile(target, answer.raw);
                    if (mode === "actual") {
                        actual.push(answer);
                    }
                    else {
                        self.push(answer);
                    }
                }
                catch (error) {
                    const message = `${mode} r${repetition}: ${errorMessage(error)}`;
                    errors.push(message);
                    await writeJsonFile(path.join(directory, "raw", `${client.definition.key}-${task.id}-${mode}-r${repetition}.error.json`), { taskId: task.id, mode, repetition, error: errorMessage(error) });
                }
            }
        }
        const record = buildTaskRecord(task, client.definition, actual, self, errors);
        await writeJsonFile(path.join(directory, "records", `${client.definition.key}-${task.id}.json`), record);
        return record;
    }
    /**
     * Report the state of the latest session.
     *
     * @param agent - the agent of the tool call.
     * @param signal - the cancellation signal of the call.
     * @returns the status, or undefined when the output root holds no session.
     */
    async status(agent, signal) {
        const workspace = await this.options.resolveWorkspace(agent, signal);
        const outputRoot = resolveOutputRoot(workspace, this.options.outputRoot());
        const sessions = await listChildDirectories(outputRoot);
        const latest = sessions[sessions.length - 1];
        if (latest === undefined) {
            return undefined;
        }
        return readSessionStatus(latest);
    }
    /**
     * List the sessions below one output root, newest first.
     *
     * @param agent - the agent of the tool call.
     * @param signal - the cancellation signal of the call.
     * @param limit - the maximum number of sessions.
     * @returns the session states.
     */
    async listSessions(agent, signal, limit) {
        const workspace = await this.options.resolveWorkspace(agent, signal);
        const outputRoot = resolveOutputRoot(workspace, this.options.outputRoot());
        const sessions = await listChildDirectories(outputRoot);
        const selected = sessions.slice(-Math.max(1, limit)).reverse();
        const states = [];
        for (const directory of selected) {
            states.push(await readSessionStatus(directory));
        }
        return states;
    }
    /**
     * Read one session report.
     *
     * @param agent - the agent of the tool call.
     * @param signal - the cancellation signal of the call.
     * @param sessionCode - the session code, or an empty string for the latest session.
     * @returns the report text and its path.
     */
    async report(agent, signal, sessionCode) {
        const directory = await this.sessionDirectory(agent, signal, sessionCode);
        const status = await readSessionStatus(directory);
        const reportPath = path.join(directory, "report.md");
        const text = await readTextFile(reportPath).catch(() => "");
        if (text !== "") {
            return { sessionCode: status.sessionCode, path: reportPath, text };
        }
        throw new ExperimentError("MISSING_SESSION", `The session ${status.sessionCode} has no report. Its status is ${status.status}.`);
    }
    /**
     * Resolve one session directory.
     *
     * @param agent - the agent of the tool call.
     * @param signal - the cancellation signal of the call.
     * @param sessionCode - the session code, or an empty string for the latest session.
     * @returns the absolute session directory.
     */
    async sessionDirectory(agent, signal, sessionCode) {
        const workspace = await this.options.resolveWorkspace(agent, signal);
        const outputRoot = resolveOutputRoot(workspace, this.options.outputRoot());
        if (sessionCode.trim() === "") {
            const sessions = await listChildDirectories(outputRoot);
            const latest = sessions[sessions.length - 1];
            if (latest === undefined) {
                throw new ExperimentError("MISSING_SESSION", "The output root holds no session.");
            }
            return latest;
        }
        const directory = path.join(outputRoot, safeFileSegment(sessionCode));
        await readJsonFile(path.join(directory, "session.json"));
        return directory;
    }
    /**
     * Summarize the bundled dataset.
     *
     * @returns the dataset summary.
     */
    async datasetSummary() {
        const workspace = await this.options.resolveWorkspace(undefined, new AbortController().signal);
        const datasetPath = await resolveInputPath(workspace, DATASET_FILE_NAME);
        const dataset = await loadDataset(datasetPath);
        const categories = {};
        for (const task of dataset.tasks) {
            categories[task.category] = (categories[task.category] ?? 0) + 1;
        }
        return {
            datasetId: dataset.datasetId,
            language: dataset.language,
            taskCount: dataset.taskCount,
            categories,
            firstTaskIds: dataset.tasks.slice(0, 8).map((task) => task.id),
        };
    }
}
/**
 * Select the mock provider key of one catalog.
 *
 * @param catalog - the provider catalog.
 * @returns the mock key, or the first provider key when the catalog holds no mock provider.
 */
function dryRunProviderKey(catalog) {
    const mock = catalog.providers.find((provider) => provider.key === "mock");
    if (mock !== undefined) {
        return mock.key;
    }
    const first = catalog.providers[0];
    if (first === undefined) {
        throw new ExperimentError("INVALID_PROVIDER", "The provider catalog holds no provider.");
    }
    return first.key;
}
/**
 * Read the state of one session directory.
 *
 * @param directory - the absolute session directory.
 * @returns the session state.
 */
export async function readSessionStatus(directory) {
    const manifest = (await readJsonFile(path.join(directory, "session.json")));
    let verdicts = {};
    let failures = 0;
    try {
        const metrics = (await readJsonFile(path.join(directory, "metrics.json")));
        verdicts = { ...metrics.verdicts };
        failures = 0;
    }
    catch {
        verdicts = {};
    }
    try {
        const names = await readdir(path.join(directory, "raw"));
        failures = names.filter((name) => name.endsWith(".error.json")).length;
    }
    catch {
        failures = 0;
    }
    return {
        sessionCode: manifest.sessionCode,
        directory,
        status: manifest.status,
        createdAt: manifest.createdAt,
        taskCount: manifest.options.taskIds.length,
        verdicts,
        failures,
    };
}
/**
 * Check the API key of each selected provider.
 *
 * A real run stops with a prompt when a key is absent or holds a placeholder. A dry run continues
 * and reports a warning instead, because the mock provider needs no key.
 *
 * @param providers - the selected providers.
 * @param environments - the section values of the environment file.
 * @param environmentState - the state of the environment file.
 * @param dryRun - true for a dry run.
 * @returns the warnings of the run setup.
 * @throws ExperimentError when a real run has no usable key.
 */
function checkProviderCredentials(providers, environments, environmentState, dryRun) {
    const missing = providers
        .filter((provider) => provider.key !== MOCK_PROVIDER_KEY)
        .filter((provider) => resolveProviderApiKey(provider, environments) === undefined)
        .map((provider) => describeEnvironmentKey(resolveEnvironmentPrefix(provider), "api_key"));
    if (missing.length > 0 && !dryRun) {
        throw new ExperimentError("MISSING_CREDENTIAL", buildCredentialPrompt(missing, environmentState));
    }
    const warnings = [];
    if (environmentState.created && environmentState.filePath !== undefined) {
        warnings.push(`The run created ${environmentState.filePath} from the example file. ` +
            "Fill in the placeholder API keys, then run the experiment again.");
    }
    if (missing.length > 0) {
        warnings.push(`A dry run needs no API key. A real run needs ${missing.join(", ")}.`);
    }
    return warnings;
}
/**
 * Build the prompt that asks a user to fill in the API keys.
 *
 * @param missing - the environment keys that hold no usable value.
 * @param environmentState - the state of the environment file.
 * @returns the prompt text.
 */
function buildCredentialPrompt(missing, environmentState) {
    const keys = missing.join(", ");
    if (environmentState.filePath === undefined) {
        return `The run needs an API key for ${keys}. Create a .env file next to .env.example, ` +
            "fill in the keys, then run the experiment again.";
    }
    const origin = environmentState.created
        ? `The run copied the example file to ${environmentState.filePath}.`
        : `The environment file is ${environmentState.filePath}.`;
    return `${origin} Fill in the placeholder value of ${keys}, then run the experiment again.`;
}
/**
 * Limit one integer option to a range.
 *
 * @param value - the requested value.
 * @param minimum - the smallest accepted value.
 * @param maximum - the largest accepted value.
 * @param name - the option name for the error message.
 * @returns the limited value.
 */
function clampInteger(value, minimum, maximum, name) {
    if (!Number.isFinite(value)) {
        throw new ExperimentError("INVALID_ARGUMENT", `The option ${name} is not a number.`);
    }
    return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
/**
 * Limit one correction-table request to the accepted size.
 *
 * @param value - the requested size.
 * @returns the accepted size.
 */
export function clampEntryCount(value) {
    return Math.min(MAX_PROBABILITY_ENTRY_COUNT, Math.max(1, Math.trunc(value)));
}
