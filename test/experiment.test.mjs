// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ExperimentService, readSessionStatus } from "../lib/experiment.js";

/**
 * Create one service that writes below a temporary workspace.
 *
 * @param {string} workspace - the temporary workspace.
 * @returns {ExperimentService} the service.
 */
function createService(workspace) {
  return new ExperimentService({
    resolveWorkspace: async () => workspace,
    outputRoot: () => "",
  });
}

test("one dry run writes a complete session with metrics and a report", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "llm-self-prediction-"));
  try {
    const service = createService(workspace);
    const result = await service.run(
      undefined,
      { dryRun: true, limit: 2, repetitions: 2, maxConcurrency: 2 },
      new AbortController().signal,
    );
    assert.equal(result.sessionCode.length > 0, true);
    assert.equal(result.metrics.taskCount, 2);
    assert.equal(result.metrics.providers.length, 1);
    assert.equal(result.metrics.providers[0].pairCount, 8);
    assert.equal(result.reportPath, path.join(result.outputDirectory, "report.md"));

    const manifest = JSON.parse(
      await readFile(path.join(result.outputDirectory, "session.json"), "utf8"),
    );
    assert.equal(manifest.status, "complete");
    assert.equal(manifest.options.repetitionCount, 2);
    assert.equal(manifest.options.topLogprobsCount, 64);
    assert.equal(manifest.environment.nodeVersion, process.version);

    const report = await readFile(result.reportPath, "utf8");
    assert.match(report, /# Next-token self-prediction report/);
    assert.match(report, /## 3\. Results/);
    assert.match(report, /indistinguishable|separated|inconclusive/);

    const rawNames = await readdir(path.join(result.outputDirectory, "raw"));
    assert.equal(rawNames.length, 8);
    assert.equal(
      rawNames.filter((name) => name.endsWith(".error.json")).length,
      0,
    );

    const recordNames = await readdir(path.join(result.outputDirectory, "records"));
    assert.equal(recordNames.length, 2);

    const state = await readSessionStatus(result.outputDirectory);
    assert.equal(state.sessionCode, result.sessionCode);
    assert.equal(state.status, "complete");
    assert.equal(state.taskCount, 2);
    assert.equal(state.failures, 0);

    const latest = await service.status(undefined, new AbortController().signal);
    assert.ok(latest !== undefined);
    assert.equal(latest.sessionCode, result.sessionCode);

    const sessions = await service.listSessions(undefined, new AbortController().signal, 5);
    assert.equal(sessions.length, 1);

    const reportResult = await service.report(undefined, new AbortController().signal, "");
    assert.equal(reportResult.sessionCode, result.sessionCode);
    assert.match(reportResult.text, /## 1\. Question/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("the verdict changes with the tolerance", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "llm-self-prediction-"));
  try {
    const service = createService(workspace);
    const loose = await service.run(
      undefined,
      { dryRun: true, limit: 1, repetitions: 1, toleranceNats: 100 },
      new AbortController().signal,
    );
    assert.equal(loose.metrics.providers[0].verdict, "indistinguishable");
    const strict = await service.run(
      undefined,
      { dryRun: true, limit: 1, repetitions: 1, toleranceNats: 1e-9 },
      new AbortController().signal,
    );
    assert.equal(strict.metrics.providers[0].verdict, "separated");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a run writes below the outputs directory of the workspace", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "llm-self-prediction-"));
  try {
    const service = createService(workspace);
    const result = await service.run(
      undefined,
      { dryRun: true, limit: 1, repetitions: 1 },
      new AbortController().signal,
    );
    assert.equal(
      result.outputDirectory,
      path.join(workspace, "outputs", result.sessionCode),
    );
    const entries = await readdir(path.join(workspace, "outputs"));
    assert.deepEqual(entries, [result.sessionCode]);
    await assert.rejects(readdir(path.join(workspace, ".outputs")));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a workspace inputs directory replaces the bundled dataset", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "llm-self-prediction-"));
  try {
    const dataset = {
      datasetId: "workspace-override",
      language: "zh-Hans",
      description: "Two tasks that prove the workspace input wins.",
      taskCount: 2,
      tasks: [
        { id: "W001", category: "poetry", prefix: "床前明月光", referenceToken: "，", },
        { id: "W002", category: "daily", prefix: "今天天气", referenceToken: "好", },
      ],
    };
    await mkdir(path.join(workspace, "inputs"), { recursive: true });
    await writeFile(
      path.join(workspace, "inputs", "dataset-zh-128.json"),
      `${JSON.stringify(dataset, undefined, 2)}\n`,
      "utf8",
    );
    const service = createService(workspace);
    const result = await service.run(
      undefined,
      { dryRun: true, repetitions: 1 },
      new AbortController().signal,
    );
    assert.equal(result.metrics.datasetId, "workspace-override");
    assert.equal(result.metrics.taskCount, 2);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
