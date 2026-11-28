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
    path.join(repository, ".env.example"),
    path.join(workspace, ".env.example"),
  );
  await fs.copyFile(
    path.join(repository, "configs.env"),
    path.join(workspace, "configs.env"),
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
  assert.ok(files.includes("actual-r1-call1.json"));
  assert.ok(files.includes("self-r1-call1.json"));
  assert.ok(files.includes("actual_injected_self-r1-call1.json"));
  assert.ok(files.includes("actual_injected_actual-r1-call1.json"));
  assert.ok(files.includes("actual_injected_actual-r1-call2.json"));
});

test("the metrics hold the three comparisons and their verdicts", async () => {
  const workspace = await createWorkspace();
  const result = await runDry(workspace);
  assert.equal(result.metrics.taskCount, 2);
  assert.equal(result.metrics.providers.length, 1);
  const provider = result.metrics.providers[0];
  assert.deepEqual(
    provider.comparisons.map((entry) => entry.comparison),
    ["self", "actual_injected_self", "actual_injected_actual"],
  );
  assert.deepEqual(
    provider.verdicts.map((entry) => entry.comparison),
    ["self", "actual_injected_self", "actual_injected_actual"],
  );
  assert.equal(provider.comparisons[0].pairCount, 2);
  assert.equal(provider.comparisons[0].hypothesis.testName, "wilcoxon_signed_rank");
  assert.equal(Number.isFinite(provider.comparisons[0].hypothesis.pValue), true);
  const records = JSON.parse(
    await fs.readFile(path.join(result.directory, "results", "records.json"), "utf8"),
  );
  assert.equal(records.length, 2);
  assert.equal(records[0].comparisons.self.length, 1);
  assert.equal(records[0].comparisons.actual_injected_actual.length, 1);
  assert.equal(records[0].predictions.actual_injected_actual[0].rawFileNames.length, 1);
  assert.match(records[0].predictions.actual_injected_actual[0].rawFileNames[0], /call2\.json$/u);
});

test("the report and the demo site exist after a dry run", async () => {
  const workspace = await createWorkspace();
  const result = await runDry(workspace);
  const report = await fs.readFile(result.reportPath, "utf8");
  assert.match(report, /actual_injected_self|Hypothesis test/u);
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
  assert.equal(manifest.protocolVersion.length > 0, true);
  assert.equal(manifest.options.revise, false);
  assert.equal(manifest.options.folder, manifest.xid);
  assert.equal(manifest.revisions.length, 1);
  assert.equal(result.reuse.requestedRecordCount > 0, true);
  assert.equal(result.reuse.reusedRecordCount, 0);
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

test("a second run revises the same folder and reuses its tables", async () => {
  const workspace = await createWorkspace();
  const service = createService(workspace);
  const first = await service.run(
    { id: "test" },
    { dryRun: true, taskIds: ["Z001"], repetitions: 1, folder: "first-run" },
  );
  assert.equal(path.basename(first.directory), "first-run");
  assert.equal(first.reuse.reusedRecordCount, 0);

  const second = await service.run(
    { id: "test" },
    { dryRun: true, taskIds: ["Z001"], repetitions: 2, folder: "first-run" },
  );
  assert.equal(second.directory, first.directory);
  assert.equal(second.xid, "first-run");
  assert.equal(second.reuse.reusedRecordCount, 4);
  assert.equal(second.reuse.requestedRecordCount, 4);
  assert.deepEqual(await fs.readdir(path.join(workspace, "outputs")), ["first-run"]);

  const taskDirectory = path.join(
    second.directory,
    "intermediate",
    (await fs.readdir(path.join(second.directory, "intermediate")))[0],
    "Z001",
  );
  const files = await fs.readdir(taskDirectory);
  assert.ok(files.includes("self-r2-call1.json"));
  const manifest = JSON.parse(await fs.readFile(path.join(second.directory, "run.json"), "utf8"));
  assert.equal(manifest.options.revise, true);
  assert.equal(manifest.previousXid, "first-run");
  assert.equal(manifest.revisions.length, 2);
  const revision = JSON.parse(
    await fs.readFile(path.join(second.directory, "revision.json"), "utf8"),
  );
  assert.equal(revision.revisions.length, 2);
  assert.equal(revision.revisions[1].reuse.reusedRecordCount, 4);
});

test("a revise pass reuses a legacy table of an earlier protocol version", async () => {
  const workspace = await createWorkspace();
  const service = createService(workspace);
  const first = await service.run(
    { id: "test" },
    { dryRun: true, taskIds: ["Z001"], repetitions: 1, folder: "legacy-run" },
  );
  const providerDirectory = (
    await fs.readdir(path.join(first.directory, "intermediate"))
  )[0];
  const taskDirectory = path.join(first.directory, "intermediate", providerDirectory, "Z001");
  await fs.rename(
    path.join(taskDirectory, "actual-r1-call1.json"),
    path.join(taskDirectory, "plain_actual-r1-call1.json"),
  );
  await fs.rename(
    path.join(taskDirectory, "self-r1-call1.json"),
    path.join(taskDirectory, "plain_self-r1-call1.json"),
  );
  await fs.writeFile(path.join(taskDirectory, "injected_self-r1-call1.json"), "{}\n", "utf8");
  await fs.writeFile(path.join(taskDirectory, "injected_actual-r1-call2.json"), "{}\n", "utf8");

  const second = await service.run(
    { id: "test" },
    { dryRun: true, taskIds: ["Z001"], repetitions: 1, folder: "legacy-run" },
  );
  assert.equal(second.xid, "legacy-run");
  assert.ok(second.reuse.droppedFileCount >= 2);
  const files = await fs.readdir(taskDirectory);
  assert.equal(files.includes("injected_self-r1-call1.json"), false);
  assert.equal(files.includes("injected_actual-r1-call2.json"), false);
});

test("a rename moves the folder to a fresh identifier", async () => {
  const workspace = await createWorkspace();
  const service = createService(workspace);
  const first = await service.run(
    { id: "test" },
    { dryRun: true, taskIds: ["Z001"], repetitions: 1, folder: "old-name" },
  );
  const renamed = await service.rename({ id: "test" }, undefined, "old-name");
  assert.equal(renamed.previousXid, "old-name");
  assert.match(renamed.xid, /^\d{8}T\d{6}Z_[0-9a-f]{6}$/u);
  assert.equal(path.basename(renamed.directory), renamed.xid);
  assert.deepEqual(await fs.readdir(path.join(workspace, "outputs")), [renamed.xid]);
  const manifest = JSON.parse(await fs.readFile(path.join(renamed.directory, "run.json"), "utf8"));
  assert.equal(manifest.xid, renamed.xid);
  assert.equal(manifest.previousXid, "old-name");
  assert.equal(manifest.options.folder, renamed.xid);
  const metrics = JSON.parse(
    await fs.readFile(path.join(renamed.directory, "results", "metrics.json"), "utf8"),
  );
  assert.equal(metrics.xid, renamed.xid);
  assert.equal(first.xid, "old-name");
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
