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

import {
  CONDITION_INJECTED_ACTUAL,
  CONDITION_INJECTED_SELF,
  CONDITION_PLAIN_ACTUAL,
  CONDITION_PLAIN_SELF,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_RANDOM_SEED,
  DEFAULT_REPETITION_COUNT,
  DEFAULT_TOLERANCE_NATS,
  DEMOS_DIRECTORY_NAME,
  ENV_EXAMPLE_FILE_NAME,
  ENV_FILE_NAME,
  INTERMEDIATE_DIRECTORY_NAME,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  RESULTS_DIRECTORY_NAME,
  TOP_LOGPROBS_COUNT,
} from "./constants.js";
import { countByCategory, loadDatasets, resolveDatasetDirectory, selectTasks } from "./dataset.js";
import { renderDemos } from "./demos.js";
import { buildProviderEnvironments, ensureEnvironmentFile, readEnvironmentFile } from "./env.js";
import { ExperimentError } from "./errors.js";
import {
  ensureDirectory,
  listChildDirectories,
  readJsonFile,
  readTextFile,
  resolveOutputRoot,
  safeFileSegment,
  writeJsonFile,
  writeTextFile,
} from "./files.js";
import { computeSessionMetrics, buildTaskRecord } from "./metrics.js";
import {
  applyProviderEnvironments,
  buildPredictionRecord,
  createProviderClient,
  loadProviderCatalog,
  probeLogprobsSupport,
  resolveProviderApiKey,
  resolveRequestedKeys,
  MOCK_PROVIDER_KEY,
} from "./providers.js";
import { DATASET_DIRECTORY_NAME, PROVIDER_FILE_NAME } from "./constants.js";
import { resolveInputPath } from "./files.js";
import { renderReport, renderSummaryCsv, renderTasksCsv } from "./report.js";
import type { PredictionOutcome } from "./providers.js";
import type {
  ConditionName,
  DatasetSummary,
  PredictionRecord,
  ProviderDefinition,
  ProviderVerdict,
  RunResult,
  SessionManifest,
  SessionMetrics,
  SessionStatus,
  Task,
  TaskRecord,
} from "./types.js";

/** The request of one run. */
export interface RunRequest {
  /** The requested provider keys or model keys. */
  readonly providerKeys?: readonly string[];
  /** The requested task identifiers. */
  readonly taskIds?: readonly string[];
  /** The repetition count of one condition. */
  readonly repetitions?: number;
  /** The divergence tolerance in nats. */
  readonly toleranceNats?: number;
  /** The output root. */
  readonly outputDirectory?: string;
  /** The random seed. */
  readonly randomSeed?: number;
  /** The number of tasks that run at the same time. */
  readonly maxConcurrency?: number;
  /** The requested table entry count. */
  readonly topLogprobsCount?: number;
  /** True to use the mock provider and no network. */
  readonly dryRun?: boolean;
}

/** The options of the experiment service. */
export interface ExperimentServiceOptions {
  /** Resolve the workspace directory of one agent. */
  readonly resolveWorkspace: (agent?: { readonly id?: string }, signal?: AbortSignal) => Promise<string>;
  /** The configured output root. */
  readonly outputRoot: () => string;
  /** The configured maximum concurrency. */
  readonly defaultMaxConcurrency?: number;
  /** The logger of the host. */
  readonly logger?: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}

/** The probe task of the support check. */
const PROBE_TASK: Task = {
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
export function createRunId(startedAt: Date): string {
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
function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
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
function buildCredentialPrompt(
  providers: readonly ProviderDefinition[],
  workspace: string,
): string {
  const lines = [
    `No API key is available for ${providers.map((provider) => provider.key).join(", ")}.`,
    `Put the key in ${path.join(workspace, "inputs", ENV_FILE_NAME)}.`,
    "One line holds `<section>.api_key=<your key>`, for example `huggingface.api_key=hf_...`.",
    `The example file ${path.join(workspace, "inputs", ENV_EXAMPLE_FILE_NAME)} shows each section.`,
  ];
  return lines.join(" ");
}

/**
 * The service that runs the experiment.
 */
export class ExperimentService {
  /** The options of the service. */
  private readonly options: ExperimentServiceOptions;

  /**
   * Create one service.
   *
   * @param options - the options of the service.
   */
  public constructor(options: ExperimentServiceOptions) {
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
  public async run(
    agent: { readonly id?: string } | undefined,
    request: RunRequest,
    signal?: AbortSignal,
  ): Promise<RunResult> {
    const startedAt = new Date();
    const workspace = await this.options.resolveWorkspace(agent, signal);
    const outputRoot = resolveOutputRoot(
      workspace,
      (request.outputDirectory ?? this.options.outputRoot() ?? "").trim(),
    );
    const datasetDirectory = await resolveDatasetDirectory(workspace, DATASET_DIRECTORY_NAME);
    const dataset = await loadDatasets(datasetDirectory);
    const environmentState = await ensureEnvironmentFile(workspace);
    const environmentValues =
      environmentState.filePath === undefined
        ? {}
        : await readEnvironmentFile(environmentState.filePath);
    const environments = buildProviderEnvironments(environmentValues);
    const catalogPath = await resolveInputPath(workspace, PROVIDER_FILE_NAME);
    const catalog = applyProviderEnvironments(
      await loadProviderCatalog(catalogPath),
      environments,
    );
    const repetitionCount = clampInteger(
      request.repetitions,
      DEFAULT_REPETITION_COUNT,
      1,
      10,
    );
    const topLogprobsCount = clampInteger(
      request.topLogprobsCount,
      TOP_LOGPROBS_COUNT,
      2,
      64,
    );
    const toleranceNats =
      request.toleranceNats !== undefined && Number.isFinite(request.toleranceNats)
        ? Math.max(0, request.toleranceNats)
        : DEFAULT_TOLERANCE_NATS;
    const randomSeed = clampInteger(request.randomSeed, DEFAULT_RANDOM_SEED, 0, 2 ** 31 - 1);
    const maxConcurrency = clampInteger(
      request.maxConcurrency,
      this.options.defaultMaxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
      1,
      16,
    );
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
    };
    const manifest: SessionManifest = {
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
    const warnings: string[] = [];
    try {
      const clients = [];
      for (const definition of definitions) {
        const apiKey = resolveProviderApiKey(definition, environments);
        if (
          apiKey === undefined &&
          definition.key !== MOCK_PROVIDER_KEY &&
          !definition.baseUrl.startsWith("mock://")
        ) {
          throw new ExperimentError(
            "MISSING_CREDENTIAL",
            buildCredentialPrompt([definition], workspace),
          );
        }
        clients.push(createProviderClient(definition, apiKey));
      }
      const active = [];
      for (const client of clients) {
        if (client.definition.key === MOCK_PROVIDER_KEY) {
          active.push(client);
          continue;
        }
        const support = await probeLogprobsSupport(client, PROBE_TASK, signal);
        if (!support.supported) {
          warnings.push(
            `The model ${client.providerKey} reports no top-${topLogprobsCount} table and is ` +
              `left out: ${support.reason ?? "the probe table holds one entry"}.`,
          );
          continue;
        }
        active.push(client);
      }
      if (active.length === 0) {
        throw new ExperimentError(
          "INVALID_PROVIDER",
          `No model reports a top-${topLogprobsCount} table. ${warnings.join(" ")}`,
        );
      }
      const records = await this.runJobs(
        active,
        selectedTasks,
        repetitionCount,
        intermediateDirectory,
        resultsDirectory,
        maxConcurrency,
        signal,
      );
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
    } catch (error) {
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
  public async status(
    agent: { readonly id?: string } | undefined,
    signal?: AbortSignal,
    limit = 5,
  ): Promise<SessionStatus[]> {
    const workspace = await this.options.resolveWorkspace(agent, signal);
    const outputRoot = resolveOutputRoot(workspace, this.options.outputRoot() ?? "");
    const directories = await listChildDirectories(outputRoot);
    const statuses: SessionStatus[] = [];
    for (const directory of directories.reverse().slice(0, Math.max(1, limit))) {
      const manifestPath = path.join(directory, "run.json");
      try {
        const value = await readJsonFile(manifestPath);
        if (typeof value !== "object" || value === null) {
          continue;
        }
        const manifest = value as SessionManifest;
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
      } catch {
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
  private async readRunDetails(
    directory: string,
  ): Promise<{ taskCount: number; verdicts: ProviderVerdict[] }> {
    const metricsPath = path.join(directory, RESULTS_DIRECTORY_NAME, "metrics.json");
    try {
      const value = await readJsonFile(metricsPath);
      if (typeof value !== "object" || value === null) {
        return { taskCount: 0, verdicts: [] };
      }
      const metrics = value as SessionMetrics;
      return {
        taskCount: typeof metrics.taskCount === "number" ? metrics.taskCount : 0,
        verdicts: Array.isArray(metrics.verdicts) ? [...metrics.verdicts] : [],
      };
    } catch {
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
  public async report(
    agent: { readonly id?: string } | undefined,
    signal?: AbortSignal,
    xid?: string,
  ): Promise<{ xid: string; directory: string; report: string }> {
    const workspace = await this.options.resolveWorkspace(agent, signal);
    const outputRoot = resolveOutputRoot(workspace, this.options.outputRoot() ?? "");
    const directories = await listChildDirectories(outputRoot);
    const target =
      xid === undefined || xid.trim() === ""
        ? directories[directories.length - 1]
        : path.join(outputRoot, safeFileSegment(xid.trim()));
    if (target === undefined) {
      throw new ExperimentError("MISSING_SESSION", "The output root holds no run.");
    }
    const reportPath = path.join(target, RESULTS_DIRECTORY_NAME, "report.md");
    try {
      const report = await readTextFile(reportPath);
      return { xid: path.basename(target), directory: target, report };
    } catch {
      throw new ExperimentError("MISSING_SESSION", `The run ${path.basename(target)} has no report.`);
    }
  }

  /**
   * Describe the dataset of one workspace.
   *
   * @param agent - the agent that asks.
   * @param signal - the cancellation signal.
   * @param sampleSize - the number of tasks to show per file.
   * @returns the dataset summaries.
   */
  public async datasetSummary(
    agent: { readonly id?: string } | undefined,
    signal?: AbortSignal,
    sampleSize = 8,
  ): Promise<DatasetSummary[]> {
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
  private async runJobs(
    clients: readonly ReturnType<typeof createProviderClient>[],
    tasks: readonly Task[],
    repetitionCount: number,
    intermediateDirectory: string,
    resultsDirectory: string,
    maxConcurrency: number,
    signal?: AbortSignal,
  ): Promise<TaskRecord[]> {
    const jobs: { client: (typeof clients)[number]; task: Task }[] = [];
    for (const client of clients) {
      for (const task of tasks) {
        jobs.push({ client, task });
      }
    }
    const records: TaskRecord[] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
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
        const record = await this.runOneTask(
          job.client,
          job.task,
          repetitionCount,
          intermediateDirectory,
          resultsDirectory,
          signal,
        );
        records.push(record);
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
  private async runOneTask(
    client: ReturnType<typeof createProviderClient>,
    task: Task,
    repetitionCount: number,
    intermediateDirectory: string,
    resultsDirectory: string,
    signal?: AbortSignal,
  ): Promise<TaskRecord> {
    const taskDirectory = path.join(
      intermediateDirectory,
      safeFileSegment(client.providerKey),
      safeFileSegment(task.id),
    );
    await ensureDirectory(taskDirectory);
    const predictions: Record<ConditionName, PredictionRecord[]> = {
      plain_actual: [],
      plain_self: [],
      injected_self: [],
      injected_actual: [],
    };
    const errors: string[] = [];
    for (let repetition = 1; repetition <= repetitionCount; repetition += 1) {
      try {
        const outcome = await client.requestPlainActual(task, repetition, signal);
        predictions.plain_actual.push(await this.recordOutcome(outcome, taskDirectory, 1));
      } catch (error) {
        errors.push(`${CONDITION_PLAIN_ACTUAL} r${repetition}: ${describeError(error)}`);
      }
    }
    for (let repetition = 1; repetition <= repetitionCount; repetition += 1) {
      try {
        const outcome = await client.requestPlainSelf(task, repetition, signal);
        predictions.plain_self.push(await this.recordOutcome(outcome, taskDirectory, 1));
      } catch (error) {
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
      } catch (error) {
        errors.push(`${CONDITION_INJECTED_SELF} r${repetition}: ${describeError(error)}`);
      }
    }
    for (let repetition = 1; repetition <= repetitionCount; repetition += 1) {
      try {
        const outcome = await client.requestInjectedActual(task, repetition, signal);
        await this.writeExchanges(outcome.self, taskDirectory, 1);
        const rawFileNames = await this.writeExchanges(outcome.actual, taskDirectory, 2);
        predictions.injected_actual.push(buildPredictionRecord(outcome.actual.draft, rawFileNames));
      } catch (error) {
        errors.push(`${CONDITION_INJECTED_ACTUAL} r${repetition}: ${describeError(error)}`);
      }
    }
    const record = buildTaskRecord(
      task,
      client.providerKey,
      client.definition.label,
      client.model,
      predictions,
      errors,
    );
    await writeJsonFile(
      path.join(resultsDirectory, "records", safeFileSegment(client.providerKey), `${safeFileSegment(task.id)}.json`),
      record,
    );
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
  private async recordOutcome(
    outcome: PredictionOutcome,
    taskDirectory: string,
    callNumber: number,
  ): Promise<PredictionRecord> {
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
  private async writeExchanges(
    outcome: PredictionOutcome,
    taskDirectory: string,
    callNumber: number,
  ): Promise<string[]> {
    const rawFileNames: string[] = [];
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
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
