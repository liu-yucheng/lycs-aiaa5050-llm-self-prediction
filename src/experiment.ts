// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * Orchestration of one run.
 *
 * One run works on exactly one output folder. A run that names no folder creates one folder with a
 * fresh identifier. A run that names an existing folder revises that folder: the run reuses each
 * table that the folder already holds, requests only the missing tables, removes each raw file that
 * the current protocol does not read, and records the change in the revision record.
 *
 * One job covers one task on one model. A job runs the repetitions of the four conditions in
 * protocol order, writes each raw exchange below the intermediate directory, and writes the task
 * record below the results directory. The run then computes the metrics and writes the report and
 * the demos.
 */

import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  CONDITION_ACTUAL,
  CONDITION_ACTUAL_INJECTED_ACTUAL,
  CONDITION_ACTUAL_INJECTED_SELF,
  CONDITION_SELF,
  DATASET_DIRECTORY_NAME,
  DEFAULT_ALPHA,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_RANDOM_SEED,
  DEFAULT_REPETITION_COUNT,
  DEFAULT_TOLERANCE_NATS,
  DEMOS_DIRECTORY_NAME,
  ENV_EXAMPLE_FILE_NAME,
  ENV_FILE_NAME,
  INTERMEDIATE_DIRECTORY_NAME,
  MANIFEST_FILE_NAME,
  MAX_PROBABILITY_ENTRY_COUNT,
  MAX_REPETITION_COUNT,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  PROTOCOL_VERSION,
  RESULTS_DIRECTORY_NAME,
  REVISION_RECORD_FILE_NAME,
  TOP_LOGPROBS_COUNT,
} from "./constants.js";
import { countByCategory, loadDatasets, resolveDatasetDirectory, selectTasks } from "./dataset.js";
import { readDemoOptions, renderDemos } from "./demos.js";
import { readConfiguration } from "./env.js";
import { ExperimentError } from "./errors.js";
import {
  ensureDirectory,
  listChildDirectories,
  moveDirectory,
  pathExists,
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
  buildModelProviderKey,
  buildPredictionRecord,
  createProviderClient,
  probeLogprobsSupport,
  resolveProviderApiKey,
  resolveRequestedKeys,
  MOCK_PROVIDER_KEY,
} from "./providers.js";
import { createProviderCatalog } from "./catalog.js";
import { renderReport, renderSummaryCsv, renderTasksCsv } from "./report.js";
import {
  buildFirstCallMarker,
  findReusedRecord,
  scanReusableData,
} from "./reuse.js";
import type { PredictionOutcome } from "./providers.js";
import type { ReusedTaskData, ReuseScan } from "./reuse.js";
import type {
  ConditionName,
  DatasetSummary,
  PredictionRecord,
  ProviderDefinition,
  ProviderVerdict,
  ReuseSummary,
  RevisionRecord,
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
  /** The significance level of each hypothesis test. */
  readonly alpha?: number;
  /** The output root. */
  readonly outputDirectory?: string;
  /** The one folder of this run, as a name below the output root or as an absolute path. */
  readonly folder?: string;
  /** True to rename the folder at the end of the run. */
  readonly renameFolder?: boolean;
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
    /** Write one information line. */
    info: (message: string) => void;
    /** Write one warning line. */
    warn: (message: string) => void;
    /** Write one error line. */
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

/** One counted set of records. */
interface RecordCounter {
  /** The number of reused records. */
  reused: number;
  /** The number of requested records. */
  requested: number;
}

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
 * Resolve the one output folder of one run.
 *
 * A request that names no folder gets a fresh folder. A request that names a path gets that path. A
 * request that names a bare folder name gets the folder below the output root.
 *
 * @param options - the output root and the requested folder.
 * @returns the absolute folder path and the folder name.
 */
export function resolveRunFolder(options: {
  readonly outputRoot: string;
  readonly folder: string;
  readonly startedAt: Date;
}): { directory: string; name: string } {
  const requested = options.folder.trim();
  if (requested === "") {
    const name = createRunId(options.startedAt);
    return { directory: path.join(options.outputRoot, name), name };
  }
  if (path.isAbsolute(requested)) {
    return { directory: requested, name: path.basename(requested) };
  }
  if (requested.includes("/") || requested.includes("\\")) {
    const directory = path.resolve(options.outputRoot, requested);
    return { directory, name: path.basename(directory) };
  }
  return { directory: path.join(options.outputRoot, requested), name: requested };
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
 * Read one number with a fallback.
 *
 * @param value - the requested value, or undefined for the fallback.
 * @param fallback - the value to use when the request holds none.
 * @returns the number.
 */
function readNumber(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : value;
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
    `Put the key in ${path.join(workspace, ENV_FILE_NAME)}.`,
    "One line holds `<section>.api_key=<your key>`, for example `huggingface.api_key=hf_...`.",
    `The example file ${path.join(workspace, ENV_EXAMPLE_FILE_NAME)} shows each section.`,
  ];
  return lines.join(" ");
}

/**
 * Read the manifest of one output folder.
 *
 * @param directory - the output folder.
 * @returns the manifest, or undefined when the folder holds none.
 */
async function readManifest(directory: string): Promise<SessionManifest | undefined> {
  const manifestPath = path.join(directory, MANIFEST_FILE_NAME);
  if (!(await pathExists(manifestPath))) {
    return undefined;
  }
  try {
    const value = await readJsonFile(manifestPath);
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    return value as SessionManifest;
  } catch {
    return undefined;
  }
}

/**
 * Find one prediction of one repetition.
 *
 * @param records - the predictions of one condition.
 * @param repetition - the repetition number.
 * @returns the prediction, or the first prediction when the repetition is absent.
 */
function findPrediction(
  records: readonly PredictionRecord[],
  repetition: number,
): PredictionRecord | undefined {
  const exact = records.find((record) => record.repetition === repetition);
  return exact ?? records[0];
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
   * Run one experiment on one output folder.
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
    const configuration = await readConfiguration(workspace);
    const environmentState = configuration.state.environment;
    const catalog = applyProviderEnvironments(
      createProviderCatalog(),
      configuration.environments,
    );
    const folder = resolveRunFolder({
      outputRoot,
      folder: request.folder ?? "",
      startedAt,
    });
    const directory = folder.directory;
    const previous = await readManifest(directory);
    const revising = previous !== undefined;
    const previousOptions = previous?.options;
    const repetitionCount = clampInteger(
      request.repetitions ?? previousOptions?.repetitionCount,
      DEFAULT_REPETITION_COUNT,
      1,
      MAX_REPETITION_COUNT,
    );
    const topLogprobsCount = clampInteger(
      request.topLogprobsCount ?? previousOptions?.topLogprobsCount,
      TOP_LOGPROBS_COUNT,
      2,
      MAX_PROBABILITY_ENTRY_COUNT,
    );
    const toleranceNats = Math.max(
      0,
      readNumber(request.toleranceNats ?? previousOptions?.toleranceNats, DEFAULT_TOLERANCE_NATS),
    );
    const alpha = Math.min(0.5, Math.max(1e-6, readNumber(request.alpha, DEFAULT_ALPHA)));
    const randomSeed = clampInteger(
      request.randomSeed ?? previousOptions?.randomSeed,
      DEFAULT_RANDOM_SEED,
      0,
      2 ** 31 - 1,
    );
    const maxConcurrency = clampInteger(
      request.maxConcurrency ?? previousOptions?.maxConcurrency,
      this.options.defaultMaxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
      1,
      16,
    );
    const dryRun = request.dryRun === true;
    const selectedTasks = selectTasks(
      dataset.tasks,
      request.taskIds ?? previousOptions?.taskIds ?? [],
    );
    const requestedKeys = dryRun
      ? [MOCK_PROVIDER_KEY]
      : (request.providerKeys ?? previousOptions?.providerKeys ?? []);
    const definitions = resolveRequestedKeys(catalog, requestedKeys, dryRun).map((definition) => ({
      ...definition,
      topLogprobsCount: definition.topLogprobsCount ?? topLogprobsCount,
    }));
    if (definitions.length === 0) {
      throw new ExperimentError("INVALID_PROVIDER", "The run selects no provider.");
    }
    const xid = folder.name;
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
      protocolVersion: PROTOCOL_VERSION,
      randomSeed,
      startedAt: startedAt.toISOString(),
      finishedAt: startedAt.toISOString(),
      elapsedSeconds: 0,
      environmentFile: environmentState.filePath,
      environmentFileCreated: environmentState.created,
      configFile: configuration.state.configFilePath,
    };
    const manifest: SessionManifest = {
      xid,
      protocolVersion: PROTOCOL_VERSION,
      previousXid: previous?.previousXid ?? (revising ? previous.xid : undefined),
      datasetIds: dataset.datasetIds,
      datasetHash: dataset.hash,
      createdAt: previous?.createdAt ?? startedAt.toISOString(),
      options: {
        providerKeys: [...requestedKeys],
        taskIds: selectedTasks.map((task) => task.id),
        repetitionCount,
        toleranceNats,
        outputDirectory: outputRoot,
        folder: xid,
        revise: revising,
        randomSeed,
        maxConcurrency,
        topLogprobsCount,
        dryRun,
      },
      providers: definitions.map((definition) => `${definition.key}:${definition.model}`),
      environment: baseEnvironment,
      status: "running",
      revisions: previous?.revisions ?? [],
    };
    const manifestPath = path.join(directory, MANIFEST_FILE_NAME);
    await writeJsonFile(manifestPath, manifest);
    await writeJsonFile(path.join(directory, "tasks.json"), selectedTasks);
    const warnings: string[] = [];
    const counter: RecordCounter = { reused: 0, requested: 0 };
    try {
      const clients = [];
      for (const definition of definitions) {
        const apiKey = resolveProviderApiKey(definition, configuration.environments);
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
        if (client.definition.distribution === "chosen-only") {
          warnings.push(
            `The provider ${client.providerKey} serves the chosen token only, so each ` +
              "distribution holds one token and every divergence is near zero.",
          );
          active.push(client);
          continue;
        }
        const support = await probeLogprobsSupport(client, PROBE_TASK, signal);
        if (!support.supported) {
          warnings.push(
            `The model ${client.providerKey} reports no top-${topLogprobsCount} table and is ` +
              `left out: ${(support.reason ?? "the probe table holds one entry").replace(/\.$/u, "")}.`,
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
      const activeProviderNames = active.map((client) => safeFileSegment(client.providerKey));
      const storedProviderNames = revising
        ? (await listChildDirectories(intermediateDirectory)).map((entry) => path.basename(entry))
        : [];
      const scannedProviderNames = [...new Set([...activeProviderNames, ...storedProviderNames])];
      const scan = revising
        ? await scanReusableData({
            intermediateDirectory,
            providerDirectoryNames: scannedProviderNames,
            taskIds: selectedTasks.map((task) => task.id),
            repetitionCount,
            topLogprobsCount,
          })
        : { tasks: new Map(), droppedFileNames: [], reusedRecordCount: 0 };
      if (scan.reusedRecordCount > 0) {
        warnings.push(
          `The run reuses ${scan.reusedRecordCount} recorded table(s) of the folder ${xid}.`,
        );
      }
      if (scan.droppedFileNames.length > 0) {
        warnings.push(
          `The run removes ${scan.droppedFileNames.length} raw file(s) that the protocol ` +
            `${PROTOCOL_VERSION} does not read.`,
        );
      }
      const records = await this.runJobs(
        active,
        selectedTasks,
        repetitionCount,
        intermediateDirectory,
        resultsDirectory,
        maxConcurrency,
        scan,
        counter,
        signal,
      );
      const finishedAt = new Date();
      const metrics = computeSessionMetrics({
        xid,
        protocolVersion: PROTOCOL_VERSION,
        datasetIds: dataset.datasetIds,
        languages: dataset.languages,
        records,
        toleranceNats,
        repetitionCount,
        topLogprobsCount,
        randomSeed,
        generatedAt: finishedAt.toISOString(),
        taskCount: selectedTasks.length,
        alpha,
      });
      const environment = {
        ...baseEnvironment,
        finishedAt: finishedAt.toISOString(),
        elapsedSeconds: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
      };
      const reuse: ReuseSummary = {
        reusedRecordCount: counter.reused,
        requestedRecordCount: counter.requested,
        droppedFileCount: scan.droppedFileNames.length,
      };
      const revision: RevisionRecord = {
        revisedAt: finishedAt.toISOString(),
        pluginVersion: PLUGIN_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        repetitionCount,
        providers: definitions.map((definition) => `${definition.key}:${definition.model}`),
        reuse,
        droppedFileNames: [...scan.droppedFileNames],
      };
      const revisions = [...(manifest.revisions ?? []), revision];
      const reportPath = path.join(resultsDirectory, "report.md");
      await writeJsonFile(path.join(resultsDirectory, "metrics.json"), metrics);
      await writeJsonFile(path.join(resultsDirectory, "records.json"), records);
      await writeTextFile(reportPath, renderReport(metrics, environment, records, revisions));
      await writeTextFile(path.join(resultsDirectory, "summary.csv"), renderSummaryCsv(metrics));
      await writeTextFile(path.join(resultsDirectory, "tasks.csv"), renderTasksCsv(records));
      await writeJsonFile(path.join(resultsDirectory, "environment.json"), environment);
      const completedManifest: SessionManifest = {
        ...manifest,
        revisions,
        environment,
        status: "complete",
      };
      await writeJsonFile(manifestPath, completedManifest);
      if (revising) {
        await writeJsonFile(
          path.join(directory, REVISION_RECORD_FILE_NAME),
          { xid, protocolVersion: PROTOCOL_VERSION, revisions },
        );
      }
      let demosPath = await renderDemos({
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
        reuse,
      });
      let finalXid = xid;
      let finalDirectory = directory;
      if (request.renameFolder === true) {
        const renamed = await this.applyRename({
          outputRoot,
          directory,
          manifest: completedManifest,
        });
        finalXid = renamed.xid;
        finalDirectory = renamed.directory;
        demosPath = path.join(renamed.directory, DEMOS_DIRECTORY_NAME, "index.html");
      }
      return {
        xid: finalXid,
        directory: finalDirectory,
        metrics,
        reportPath,
        demosPath,
        warnings,
        reuse,
      };
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
   * Rename one output folder to a fresh identifier.
   *
   * The method moves the folder, rewrites the identifier in the manifest and in the metrics, and
   * writes the demos again, so each page names the folder that holds it.
   *
   * @param agent - the agent that asks.
   * @param signal - the cancellation signal.
   * @param folder - the folder name, or an empty string for the newest folder.
   * @returns the previous identifier, the new identifier, and the new directory.
   */
  public async rename(
    agent: { readonly id?: string } | undefined,
    signal?: AbortSignal,
    folder?: string,
  ): Promise<{ previousXid: string; xid: string; directory: string }> {
    const workspace = await this.options.resolveWorkspace(agent, signal);
    const outputRoot = resolveOutputRoot(workspace, this.options.outputRoot() ?? "");
    const target = await this.resolveExistingFolder(outputRoot, folder ?? "");
    const manifest = await readManifest(target);
    if (manifest === undefined) {
      throw new ExperimentError(
        "MISSING_SESSION",
        `The folder ${path.basename(target)} holds no ${MANIFEST_FILE_NAME}.`,
      );
    }
    const renamed = await this.applyRename({ outputRoot, directory: target, manifest });
    return { previousXid: manifest.xid, xid: renamed.xid, directory: renamed.directory };
  }

  /**
   * Move one folder to a fresh identifier and rewrite the recorded identity.
   *
   * @param options - the output root, the current directory, and the current manifest.
   * @returns the new identifier and the new directory.
   */
  private async applyRename(options: {
    readonly outputRoot: string;
    readonly directory: string;
    readonly manifest: SessionManifest;
  }): Promise<{ xid: string; directory: string }> {
    const xid = createRunId(new Date());
    const directory = path.join(options.outputRoot, xid);
    if (await pathExists(directory)) {
      throw new ExperimentError("FILE_FAILURE", `The folder ${xid} already exists.`);
    }
    await moveDirectory(options.directory, directory);
    const manifest: SessionManifest = {
      ...options.manifest,
      xid,
      previousXid: options.manifest.xid,
      options: { ...options.manifest.options, folder: xid },
    };
    await writeJsonFile(path.join(directory, MANIFEST_FILE_NAME), manifest);
    const metricsPath = path.join(directory, RESULTS_DIRECTORY_NAME, "metrics.json");
    if (await pathExists(metricsPath)) {
      try {
        const value = await readJsonFile(metricsPath);
        if (typeof value === "object" && value !== null) {
          await writeJsonFile(metricsPath, { ...(value as SessionMetrics), xid });
        }
      } catch {
        // The rename still holds. The metrics file stays as it is.
      }
      await this.rewriteDemosFor(directory);
    }
    return { xid, directory };
  }

  /**
   * Write the demos of one folder again from the recorded files.
   *
   * @param directory - the folder.
   */
  private async rewriteDemosFor(directory: string): Promise<void> {
    try {
      const demoOptions = await readDemoOptions(directory);
      await renderDemos(demoOptions);
    } catch {
      // The demos are a view of the recorded files. A failed rewrite leaves the old pages.
    }
  }

  /**
   * Resolve one existing folder below the output root.
   *
   * @param outputRoot - the output root.
   * @param folder - the folder name, or an empty string for the newest folder.
   * @returns the folder path.
   */
  private async resolveExistingFolder(outputRoot: string, folder: string): Promise<string> {
    const requested = folder.trim();
    if (requested === "") {
      const directories = await listChildDirectories(outputRoot);
      const newest = directories[directories.length - 1];
      if (newest === undefined) {
        throw new ExperimentError("MISSING_SESSION", "The output root holds no run.");
      }
      return newest;
    }
    if (path.isAbsolute(requested)) {
      return requested;
    }
    if (requested.includes("/") || requested.includes("\\")) {
      return path.resolve(outputRoot, requested);
    }
    return path.join(outputRoot, safeFileSegment(requested));
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
      const manifest = await readManifest(directory);
      if (manifest === undefined) {
        continue;
      }
      const details = await this.readRunDetails(directory);
      statuses.push({
        xid: manifest.xid ?? path.basename(directory),
        directory,
        status: manifest.status,
        createdAt: manifest.createdAt,
        taskCount: details.taskCount,
        verdicts: details.verdicts,
        failures: manifest.failure === undefined ? [] : [manifest.failure],
      });
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
    const target = await this.resolveExistingFolder(outputRoot, xid ?? "");
    const reportPath = path.join(target, RESULTS_DIRECTORY_NAME, "report.md");
    try {
      const report = await readTextFile(reportPath);
      return { xid: path.basename(target), directory: target, report };
    } catch {
      throw new ExperimentError("MISSING_SESSION", `The run ${path.basename(target)} has no report.`);
    }
  }

  /**
   * Write the demonstration website of one run again.
   *
   * The method reads the recorded metrics, records, and environment of the run. It writes the
   * pages and the assets from the current templates, so a template change reaches a run that is
   * already complete.
   *
   * @param agent - the agent that asks.
   * @param signal - the cancellation signal.
   * @param xid - the run identifier, or an empty string for the newest run.
   * @returns the run identifier and the path of the entry page.
   */
  public async rewriteDemos(
    agent: { readonly id?: string } | undefined,
    signal?: AbortSignal,
    xid?: string,
  ): Promise<{ xid: string; directory: string; entryPath: string }> {
    const workspace = await this.options.resolveWorkspace(agent, signal);
    const outputRoot = resolveOutputRoot(workspace, this.options.outputRoot() ?? "");
    const target = await this.resolveExistingFolder(outputRoot, xid ?? "");
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
   * @param scan - the reuse scan of the folder.
   * @param counter - the record counter of the run.
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
    scan: ReuseScan,
    counter: RecordCounter,
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
        const providerName = safeFileSegment(job.client.providerKey);
        const record = await this.runOneTask({
          client: job.client,
          task: job.task,
          repetitionCount,
          taskDirectory: path.join(
            intermediateDirectory,
            providerName,
            safeFileSegment(job.task.id),
          ),
          resultsDirectory,
          reused: scan.tasks.get(providerName)?.get(job.task.id),
          counter,
          signal,
        });
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
   * @param options - the client, the task, the repetition count, the directories, the reused data,
   * the counter, and the signal.
   * @returns the task record.
   */
  private async runOneTask(options: {
    readonly client: ReturnType<typeof createProviderClient>;
    readonly task: Task;
    readonly repetitionCount: number;
    readonly taskDirectory: string;
    readonly resultsDirectory: string;
    readonly reused: ReusedTaskData | undefined;
    readonly counter: RecordCounter;
    readonly signal?: AbortSignal;
  }): Promise<TaskRecord> {
    const { client, task, repetitionCount, taskDirectory, reused, counter } = options;
    await ensureDirectory(taskDirectory);
    const predictions: Record<ConditionName, PredictionRecord[]> = {
      actual: [],
      self: [],
      actual_injected_self: [],
      actual_injected_actual: [],
    };
    const errors: string[] = [];
    for (let repetition = 1; repetition <= repetitionCount; repetition += 1) {
      const recorded = findReusedRecord(reused, CONDITION_ACTUAL, repetition);
      if (recorded !== undefined) {
        predictions.actual.push(recorded);
        counter.reused += 1;
        continue;
      }
      try {
        const outcome = await client.requestActualPrediction(task, repetition, options.signal);
        predictions.actual.push(await this.recordOutcome(outcome, taskDirectory, 1));
        counter.requested += 1;
      } catch (error) {
        errors.push(`${CONDITION_ACTUAL} r${repetition}: ${describeError(error)}`);
      }
    }
    for (let repetition = 1; repetition <= repetitionCount; repetition += 1) {
      const recorded = findReusedRecord(reused, CONDITION_SELF, repetition);
      if (recorded !== undefined) {
        predictions.self.push(recorded);
        counter.reused += 1;
        continue;
      }
      try {
        const outcome = await client.requestSelfPrediction(task, repetition, options.signal);
        predictions.self.push(await this.recordOutcome(outcome, taskDirectory, 1));
        counter.requested += 1;
      } catch (error) {
        errors.push(`${CONDITION_SELF} r${repetition}: ${describeError(error)}`);
      }
    }
    for (let repetition = 1; repetition <= repetitionCount; repetition += 1) {
      const recorded = findReusedRecord(reused, CONDITION_ACTUAL_INJECTED_SELF, repetition);
      if (recorded !== undefined) {
        predictions.actual_injected_self.push(recorded);
        counter.reused += 1;
        continue;
      }
      const injected = findPrediction(predictions.actual, repetition);
      if (injected === undefined) {
        errors.push(`${CONDITION_ACTUAL_INJECTED_SELF} r${repetition}: no served table to inject.`);
        continue;
      }
      try {
        const outcome = await client.requestActualInjectedSelfPrediction(
          task,
          repetition,
          injected.distribution,
          options.signal,
        );
        predictions.actual_injected_self.push(await this.recordOutcome(outcome, taskDirectory, 1));
        counter.requested += 1;
      } catch (error) {
        errors.push(`${CONDITION_ACTUAL_INJECTED_SELF} r${repetition}: ${describeError(error)}`);
      }
    }
    for (let repetition = 1; repetition <= repetitionCount; repetition += 1) {
      const recorded = findReusedRecord(reused, CONDITION_ACTUAL_INJECTED_ACTUAL, repetition);
      if (recorded !== undefined) {
        predictions.actual_injected_actual.push(recorded);
        counter.reused += 1;
        await this.ensureFirstCallMarker(taskDirectory, repetition);
        continue;
      }
      const injected = findPrediction(predictions.actual, repetition);
      if (injected === undefined) {
        errors.push(
          `${CONDITION_ACTUAL_INJECTED_ACTUAL} r${repetition}: no served table to inject.`,
        );
        continue;
      }
      try {
        const outcome = await client.requestRepeatedActualPrediction(
          task,
          repetition,
          injected.distribution,
          options.signal,
        );
        const rawFileNames = await this.writeExchanges(outcome, taskDirectory, 2);
        predictions.actual_injected_actual.push(
          buildPredictionRecord(outcome.draft, rawFileNames),
        );
        counter.requested += 1;
        await this.ensureFirstCallMarker(taskDirectory, repetition);
      } catch (error) {
        errors.push(
          `${CONDITION_ACTUAL_INJECTED_ACTUAL} r${repetition}: ${describeError(error)}`,
        );
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
      path.join(
        options.resultsDirectory,
        "records",
        safeFileSegment(client.providerKey),
        `${safeFileSegment(task.id)}.json`,
      ),
      record,
    );
    return record;
  }

  /**
   * Write the marker of one reused first call of `actual_injected_actual`.
   *
   * @param taskDirectory - the intermediate task directory.
   * @param repetition - the repetition number.
   */
  private async ensureFirstCallMarker(
    taskDirectory: string,
    repetition: number,
  ): Promise<void> {
    const fileName = `${CONDITION_ACTUAL_INJECTED_ACTUAL}-r${repetition}-call1.json`;
    const markerPath = path.join(taskDirectory, fileName);
    if (await pathExists(markerPath)) {
      return;
    }
    await writeJsonFile(
      markerPath,
      buildFirstCallMarker({
        repetition,
        reusedFrom: `${CONDITION_ACTUAL}-r${repetition}-call1.json`,
      }),
    );
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
      const fileName =
        `${outcome.draft.condition}-r${outcome.draft.repetition}-call${callNumber + index}.json`;
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
