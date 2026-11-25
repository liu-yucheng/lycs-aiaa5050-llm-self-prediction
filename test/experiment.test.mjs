// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExperimentService } from "../lib/experiment.js";

/** The workspace of the repository. */
const repository = path.resolve(import.meta.dirname, "..");

/**
 * Create one temporary workspace with the inputs of the repository.
 *
 * @returns the workspace path.
 */
async function createWorkspace() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "llm-self-prediction-"));
  const inputs = path.join(workspace, "inputs");
  await fs.mkdir(path.join(inputs, "testing-dataset"), { recursive: true });
  for (const name of ["dataset-zh-32.json", "dataset-en-32.json"]) {
    await fs.copyFile(
      path.join(repository, "inputs", "testing-dataset", name),
      path.join(inputs, "testing-dataset", name),
    );
  }
  await fs.copyFile(
    path.join(repository, "inputs", "providers.json"),
    path.join(inputs, "providers.json"),
  );
  return workspace;
}

/**
 * Build one service for a workspace.
 *
 * @param workspace - the workspace path.
 * @returns the service.
 */
function createService(workspace) {
  return new ExperimentService({
    resolveWorkspace: async () => workspace,
    outputRoot: () => "",
  });
}

/**
 * Run one small dry run.
 *
 * @param workspace - the workspace path.
 * @returns the result.
 */
async function runDry(workspace) {
  const service = createService(workspace);
  return service.run({ id: "test" }, { dryRun: true, taskIds: ["Z001", "E001"], repetitions: 1 });
}

test("a dry run writes the intermediate, results, and demos directories", async () => {
  const workspace = await createWorkspace();
  const result = await runDry(workspace);
  for (const name of ["intermediate", "results", "demos"]) {
    const stat = await fs.stat(path.join(result.directory, name));
    assert.equal(stat.isDirectory(), true);
  }
  for (const name of ["run.json", "tasks.json"]) {
    const stat = await fs.stat(path.join(result.directory, name));
    assert.equal(stat.isFile(), true);
  }
  for (const name of [
    "metrics.json",
    "records.json",
    "report.md",
    "summary.csv",
    "tasks.csv",
    "environment.json",
    "task-summary.json",
  ]) {
    const stat = await fs.stat(path.join(result.directory, "results", name));
    assert.equal(stat.isFile(), true, name);
  }
});

test("a dry run writes one raw file for each call of each condition", async () => {
  const workspace = await createWorkspace();
  const result = await runDry(workspace);
  const providerDirectories = await fs.readdir(path.join(result.directory, "intermediate"));
  assert.equal(providerDirectories.length, 1);
  const taskDirectories = await fs.readdir(
    path.join(result.directory, "intermediate", providerDirectories[0]),
  );
  assert.deepEqual(taskDirectories.sort(), ["E001", "Z001"]);
  const files = await fs.readdir(
    path.join(result.directory, "intermediate", providerDirectories[0], "Z001"),
  );
  assert.equal(files.filter((name) => name.endsWith(".json")).length, 5);
  assert.ok(files.includes("plain_actual-r1-call1.json"));
  assert.ok(files.includes("plain_self-r1-call1.json"));
  assert.ok(files.includes("injected_self-r1-call1.json"));
  assert.ok(files.includes("injected_actual-r1-call1.json"));
  assert.ok(files.includes("injected_actual-r1-call2.json"));
});

test("the metrics hold the three comparisons and their verdicts", async () => {
  const workspace = await createWorkspace();
  const result = await runDry(workspace);
  assert.equal(result.metrics.taskCount, 2);
  assert.equal(result.metrics.providers.length, 1);
  const provider = result.metrics.providers[0];
  assert.deepEqual(
    provider.comparisons.map((entry) => entry.comparison),
    ["plain_self", "injected_self", "injected_actual"],
  );
  assert.deepEqual(
    provider.verdicts.map((entry) => entry.comparison),
    ["plain_self", "injected_self", "injected_actual"],
  );
  assert.equal(provider.comparisons[0].pairCount, 2);
  const records = JSON.parse(
    await fs.readFile(path.join(result.directory, "results", "records.json"), "utf8"),
  );
  assert.equal(records.length, 2);
  assert.equal(records[0].comparisons.plain_self.length, 1);
  assert.equal(records[0].comparisons.injected_actual.length, 1);
  assert.equal(records[0].predictions.injected_actual[0].rawFileNames.length, 1);
  assert.match(records[0].predictions.injected_actual[0].rawFileNames[0], /call2\.json$/u);
});

test("the report and the demo site exist after a dry run", async () => {
  const workspace = await createWorkspace();
  const result = await runDry(workspace);
  const report = await fs.readFile(result.reportPath, "utf8");
  assert.match(report, /plain_self|plain actual|Plain actual/u);
  const demos = await fs.readFile(result.demosPath, "utf8");
  assert.match(demos, /<html/iu);
  for (const name of ["method.html", "summary.html", "explorer.html", "context.html"]) {
    const stat = await fs.stat(path.join(result.demosPath, "..", name));
    assert.equal(stat.isFile(), true, name);
  }
});

test("the run manifest records the protocol and turns complete", async () => {
  const workspace = await createWorkspace();
  const result = await runDry(workspace);
  const manifest = JSON.parse(await fs.readFile(path.join(result.directory, "run.json"), "utf8"));
  assert.equal(manifest.xid, result.xid);
  assert.equal(manifest.status, "complete");
  assert.equal(manifest.options.dryRun, true);
  assert.equal(manifest.options.repetitionCount, 1);
  assert.equal(manifest.environment.pluginVersion.length > 0, true);
  assert.equal(manifest.datasetIds.length, 2);
});

test("the status and report readers find the run", async () => {
  const workspace = await createWorkspace();
  const result = await runDry(workspace);
  const service = createService(workspace);
  const statuses = await service.status({ id: "test" }, undefined, 5);
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].xid, result.xid);
  assert.equal(statuses[0].taskCount, 2);
  assert.equal(statuses[0].verdicts.length, 1);
  const report = await service.report({ id: "test" });
  assert.equal(report.xid, result.xid);
  assert.ok(report.report.includes("Reproducibility"));
});

test("an unknown task identifier stops the run before any directory is written", async () => {
  const workspace = await createWorkspace();
  const service = createService(workspace);
  await assert.rejects(
    () => service.run({ id: "test" }, { dryRun: true, taskIds: ["NOPE"], repetitions: 1 }),
    /NOPE/u,
  );
  const outputRoot = path.join(workspace, "outputs");
  const entries = await fs.readdir(outputRoot).catch(() => []);
  assert.deepEqual(entries, []);
});

test("the dataset summary describes both files", async () => {
  const workspace = await createWorkspace();
  const service = createService(workspace);
  const summaries = await service.datasetSummary({ id: "test" }, undefined, 2);
  assert.equal(summaries.length, 2);
  for (const summary of summaries) {
    assert.equal(summary.taskCount, 32);
    assert.equal(summary.sample.length, 2);
  }
});
