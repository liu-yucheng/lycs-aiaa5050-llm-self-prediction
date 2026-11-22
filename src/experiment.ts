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

import {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_RANDOM_SEED,
  DEFAULT_REPETITION_COUNT,
  DEFAULT_TOLERANCE_NATS,
  MAX_PROBABILITY_ENTRY_COUNT,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  TOP_LOGPROBS_COUNT,
} from "./constants.js";
import { computeDatasetHash, loadDataset, selectTasks } from "./dataset.js";
import type { Agent, Logger } from "./dsh.js";
import { ExperimentError, errorMessage } from "./errors.js";
import {
  createSessionCode,
  ensureDirectory,
  listChildDirectories,
  readJsonFile,
  readTextFile,
  resolveOutputRoot,
  safeFileSegment,
  writeJsonFile,
  writeTextFile,
} from "./files.js";
import { buildTaskRecord, computeSessionMetrics, resolveTolerance } from "./metrics.js";
import { createProviderClient, loadProviderCatalog, selectProviders } from "./providers.js";
import type { ProviderClient } from "./providers.js";
import { renderReport, renderSummaryCsv, renderTasksCsv } from "./report.js";
import type {
  Dataset,
  PredictionAnswer,
  ProviderDefinition,
  RunOptions,
  RunResult,
  SessionManifest,
  SessionMetrics,
  Task,
  TaskRecord,
} from "./types.js";

/** One run request from a tool or a command. */
export interface RunRequest {
  readonly providerKeys?: readonly string[];
  readonly taskIds?: readonly string[];
  readonly limit?: number;
  readonly repetitions?: number;
  readonly toleranceNats?: number;
  readonly outputDirectory?: string;
  readonly randomSeed?: number;
  readonly maxConcurrency?: number;
  readonly dryRun?: boolean;
}

/** The status of one session. */
export interface SessionStatus {
  readonly sessionCode: string;
  readonly directory: string;
  readonly status: string;
  readonly createdAt: string;
  readonly taskCount: number;
  readonly verdicts: Readonly<Record<string, string>>;
  readonly failures: number;
}

/** The summary of one dataset. */
export interface DatasetSummary {
  readonly datasetId: string;
  readonly language: string;
  readonly taskCount: number;
  readonly categories: Readonly<Record<string, number>>;
  readonly firstTaskIds: readonly string[];
}

/** The dependencies of the service. */
export interface ExperimentServiceOptions {
  /** Resolve the workspace directory of one tool call. */
  readonly resolveWorkspace: (agent: Agent | undefined, signal: AbortSignal) => Promise<string>;
  /** Read the configured output root. */
  readonly outputRoot: () => string;
  /** The host logger. */
  readonly logger?: Logger;
  /** The configured default of the job limit. */
  readonly defaultMaxConcurrency?: number;
}

/** The service that a tool, a command, and the CLI share. */
export class ExperimentService {
  private readonly options: ExperimentServiceOptions;

  /**
   * Create one service.
   *
   * @param options - the workspace resolver, the output root reader, and the logger.
   */
  public constructor(options: ExperimentServiceOptions) {
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
  public async run(
    agent: Agent | undefined,
    request: RunRequest,
    signal: AbortSignal,
  ): Promise<RunResult> {
    const startedAt = new Date();
    const workspace = await this.options.resolveWorkspace(agent, signal);
    const requestedRoot = (request.outputDirectory ?? "").trim();
    const outputRoot = resolveOutputRoot(
      workspace,
      requestedRoot === "" ? this.options.outputRoot() : requestedRoot,
    );
    const dataset = await loadDataset();
    const catalog = await loadProviderCatalog();
    const dryRun = request.dryRun === true;
    const requestedKeys = dryRun ? [dryRunProviderKey(catalog)] : (request.providerKeys ?? []);
    const repetitionCount = clampInteger(
      request.repetitions ?? DEFAULT_REPETITION_COUNT,
      1,
      DEFAULT_REPETITION_COUNT * 2,
      "repetitions",
    );
    const limit = clampInteger(request.limit ?? 0, 0, dataset.tasks.length, "limit");
    const tasks = selectTasks(dataset, request.taskIds ?? [], limit);
    if (tasks.length === 0) {
      throw new ExperimentError("INVALID_ARGUMENT", "The run selected no task.");
    }
    const providers = selectProviders(catalog, requestedKeys, dryRun);
    if (providers.length === 0) {
      throw new ExperimentError("INVALID_PROVIDER", "The run selected no provider.");
    }
    const clients: ProviderClient[] = providers.map((provider) =>
      createProviderClient(provider),
    );
    const randomSeed = request.randomSeed ?? DEFAULT_RANDOM_SEED;
    const toleranceNats = resolveTolerance(request.toleranceNats ?? DEFAULT_TOLERANCE_NATS);
    const maxConcurrency = clampInteger(
      request.maxConcurrency ?? this.options.defaultMaxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
      1,
      16,
      "maxConcurrency",
    );
    const options: RunOptions = {
      providerKeys: providers.map((provider) => provider.key),
      taskIds: tasks.map((task) => task.id),
      repetitionCount,
      toleranceNats,
      outputDirectory: outputRoot,
      randomSeed,
      maxConcurrency,
      topLogprobsCount: TOP_LOGPROBS_COUNT,
      dryRun,
    };
    const sessionCode = createSessionCode(startedAt, randomSeed);
    const directory = path.join(outputRoot, sessionCode);
    await ensureDirectory(path.join(directory, "raw"));
    await ensureDirectory(path.join(directory, "records"));
    const manifest: SessionManifest = {
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
      },
      status: "running",
    };
    await writeJsonFile(path.join(directory, "session.json"), manifest);
    await writeJsonFile(path.join(directory, "tasks.json"), { tasks });
    this.options.logger?.info(
      `llm-self-prediction: session ${sessionCode} starts with ${tasks.length} tasks, ` +
        `${providers.length} providers, ${repetitionCount} repetitions.`,
    );
    try {
      const records = await this.runJobs(
        directory,
        tasks,
        clients,
        repetitionCount,
        maxConcurrency,
        signal,
      );
      const generatedAt = new Date().toISOString();
      const metrics = computeSessionMetrics({
        sessionCode,
        datasetId: dataset.datasetId,
        records,
        toleranceNats,
        repetitionCount,
        topLogprobsCount: TOP_LOGPROBS_COUNT,
        randomSeed,
        generatedAt,
        taskCount: tasks.length,
        providers,
      });
      const finishedAt = new Date();
      const finalManifest: SessionManifest = {
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
      await writeTextFile(
        path.join(directory, "report.md"),
        renderReport(metrics, finalManifest, records),
      );
      await writeTextFile(path.join(directory, "summary.csv"), renderSummaryCsv(metrics));
      await writeTextFile(path.join(directory, "tasks.csv"), renderTasksCsv(records));
      const warnings = metrics.providers.flatMap((provider) => provider.warnings);
      this.options.logger?.info(
        `llm-self-prediction: session ${sessionCode} is complete in ` +
          `${((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)}s.`,
      );
      return {
        sessionCode,
        outputDirectory: directory,
        metrics,
        reportPath: path.join(directory, "report.md"),
        warnings,
      };
    } catch (error) {
      const failedAt = new Date();
      const failedManifest: SessionManifest = {
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
  private async runJobs(
    directory: string,
    tasks: readonly Task[],
    clients: readonly ProviderClient[],
    repetitionCount: number,
    maxConcurrency: number,
    signal: AbortSignal,
  ): Promise<TaskRecord[]> {
    interface Job {
      readonly task: Task;
      readonly client: ProviderClient;
    }
    const jobs: Job[] = [];
    for (const task of tasks) {
      for (const client of clients) {
        jobs.push({ task, client });
      }
    }
    const records: TaskRecord[] = new Array<TaskRecord>(jobs.length);
    let nextIndex = 0;
    let completed = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= jobs.length) {
          return;
        }
        const job = jobs[index] as Job;
        signal.throwIfAborted();
        const record = await this.runOneTask(directory, job.task, job.client, repetitionCount);
        records[index] = record;
        completed += 1;
        if (completed % 16 === 0 || completed === jobs.length) {
          this.options.logger?.info(
            `llm-self-prediction: ${completed} of ${jobs.length} task records are complete.`,
          );
        }
      }
    };
    const workers: Promise<void>[] = [];
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
  private async runOneTask(
    directory: string,
    task: Task,
    client: ProviderClient,
    repetitionCount: number,
  ): Promise<TaskRecord> {
    const actual: PredictionAnswer[] = [];
    const self: PredictionAnswer[] = [];
    const errors: string[] = [];
    for (let repetition = 1; repetition <= repetitionCount; repetition += 1) {
      for (const mode of ["actual", "self"] as const) {
        try {
          const answer = await client.predict(
            { mode, task, repetition, topLogprobsCount: TOP_LOGPROBS_COUNT },
            new AbortController().signal,
          );
          const target = path.join(directory, "raw", safeFileSegment(answer.rawFileName));
          await writeJsonFile(target, answer.raw);
          if (mode === "actual") {
            actual.push(answer);
          } else {
            self.push(answer);
          }
        } catch (error) {
          const message = `${mode} r${repetition}: ${errorMessage(error)}`;
          errors.push(message);
          await writeJsonFile(
            path.join(directory, "raw", `${task.id}-${mode}-r${repetition}.error.json`),
            { taskId: task.id, mode, repetition, error: errorMessage(error) },
          );
        }
      }
    }
    const record = buildTaskRecord(task, client.definition, actual, self, errors);
    await writeJsonFile(
      path.join(directory, "records", `${client.definition.key}-${task.id}.json`),
      record,
    );
    return record;
  }

  /**
   * Report the state of the latest session.
   *
   * @param agent - the agent of the tool call.
   * @param signal - the cancellation signal of the call.
   * @returns the status, or undefined when the output root holds no session.
   */
  public async status(
    agent: Agent | undefined,
    signal: AbortSignal,
  ): Promise<SessionStatus | undefined> {
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
  public async listSessions(
    agent: Agent | undefined,
    signal: AbortSignal,
    limit: number,
  ): Promise<SessionStatus[]> {
    const workspace = await this.options.resolveWorkspace(agent, signal);
    const outputRoot = resolveOutputRoot(workspace, this.options.outputRoot());
    const sessions = await listChildDirectories(outputRoot);
    const selected = sessions.slice(-Math.max(1, limit)).reverse();
    const states: SessionStatus[] = [];
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
  public async report(
    agent: Agent | undefined,
    signal: AbortSignal,
    sessionCode: string,
  ): Promise<{ readonly sessionCode: string; readonly path: string; readonly text: string }> {
    const directory = await this.sessionDirectory(agent, signal, sessionCode);
    const status = await readSessionStatus(directory);
    const reportPath = path.join(directory, "report.md");
    const text = await readTextFile(reportPath).catch(() => "");
    if (text !== "") {
      return { sessionCode: status.sessionCode, path: reportPath, text };
    }
    throw new ExperimentError(
      "MISSING_SESSION",
      `The session ${status.sessionCode} has no report. Its status is ${status.status}.`,
    );
  }

  /**
   * Resolve one session directory.
   *
   * @param agent - the agent of the tool call.
   * @param signal - the cancellation signal of the call.
   * @param sessionCode - the session code, or an empty string for the latest session.
   * @returns the absolute session directory.
   */
  private async sessionDirectory(
    agent: Agent | undefined,
    signal: AbortSignal,
    sessionCode: string,
  ): Promise<string> {
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
  public async datasetSummary(): Promise<DatasetSummary> {
    const dataset: Dataset = await loadDataset();
    const categories: Record<string, number> = {};
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
function dryRunProviderKey(catalog: { providers: readonly ProviderDefinition[] }): string {
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
export async function readSessionStatus(directory: string): Promise<SessionStatus> {
  const manifest = (await readJsonFile(path.join(directory, "session.json"))) as SessionManifest;
  let verdicts: Record<string, string> = {};
  let failures = 0;
  try {
    const metrics = (await readJsonFile(path.join(directory, "metrics.json"))) as SessionMetrics;
    verdicts = { ...metrics.verdicts };
    failures = 0;
  } catch {
    verdicts = {};
  }
  try {
    const names = await readdir(path.join(directory, "raw"));
    failures = names.filter((name) => name.endsWith(".error.json")).length;
  } catch {
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
 * Limit one integer option to a range.
 *
 * @param value - the requested value.
 * @param minimum - the smallest accepted value.
 * @param maximum - the largest accepted value.
 * @param name - the option name for the error message.
 * @returns the limited value.
 */
function clampInteger(value: number, minimum: number, maximum: number, name: string): number {
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
export function clampEntryCount(value: number): number {
  return Math.min(MAX_PROBABILITY_ENTRY_COUNT, Math.max(1, Math.trunc(value)));
}
