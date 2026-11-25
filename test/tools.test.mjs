// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

import test from "node:test";
import assert from "node:assert/strict";

import { buildHelpText, createToolDefinitions } from "../lib/tools.js";
import {
  TOOL_DATASET,
  TOOL_HELP,
  TOOL_REPORT,
  TOOL_RUN,
  TOOL_STATUS,
} from "../lib/constants.js";

/** Build one stub service and record each request. */
function createStubService() {
  const calls = [];
  const service = {
    async run(agent, request, signal) {
      calls.push({ method: "run", agent, request, signal });
      return {
        xid: "20261125T090000Z_abc123",
        directory: "outputs/20261125T090000Z_abc123",
        metrics: { taskCount: 2, providers: [], verdicts: [] },
        reportPath: "outputs/20261125T090000Z_abc123/results/report.md",
        demosPath: "outputs/20261125T090000Z_abc123/demos/index.html",
        warnings: [],
      };
    },
    async status(agent, signal, limit) {
      calls.push({ method: "status", agent, signal, limit });
      return [
        {
          xid: "20261125T090000Z_abc123",
          directory: "outputs/20261125T090000Z_abc123",
          status: "complete",
          createdAt: "2026-11-25T09:00:00.000Z",
          taskCount: 2,
          verdicts: [],
          failures: [],
        },
      ];
    },
    async report(agent, signal, xid) {
      calls.push({ method: "report", agent, signal, xid });
      return { xid: "20261125T090000Z_abc123", directory: "outputs/x", report: "# Report" };
    },
    async datasetSummary(agent, signal, sampleSize) {
      calls.push({ method: "datasetSummary", agent, signal, sampleSize });
      return [
        {
          datasetId: "zh32",
          language: "zh-Hans",
          description: "test",
          taskCount: 32,
          sample: [],
        },
      ];
    },
  };
  return { service, calls };
}

/** Read the text of one rendered tool output. */
function renderText(tool, value) {
  return tool.output.render({}, value)[0].text;
}

test("the tool set holds the five tools of the protocol", () => {
  const { service } = createStubService();
  const tools = createToolDefinitions(service);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [TOOL_RUN, TOOL_STATUS, TOOL_REPORT, TOOL_DATASET, TOOL_HELP],
  );
  for (const tool of tools) {
    assert.equal(typeof tool.description, "string");
    assert.ok(tool.description.length > 10);
    assert.equal(tool.parameters.type, "object");
    assert.equal(typeof tool.execute, "function");
  }
});

test("the run tool maps the arguments onto one request", async () => {
  const { service, calls } = createStubService();
  const run = createToolDefinitions(service).find((tool) => tool.name === TOOL_RUN);
  const value = await run.execute(
    {
      providers: ["mock"],
      tasks: ["Z001"],
      repetitions: 2,
      toleranceNats: 0.1,
      seed: 7,
      maxConcurrency: 2,
      topLogprobsCount: 20,
      dryRun: true,
    },
    { signal: new AbortController().signal, agent: { id: "agent" } },
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].request, {
    providerKeys: ["mock"],
    taskIds: ["Z001"],
    repetitions: 2,
    toleranceNats: 0.1,
    outputDirectory: undefined,
    randomSeed: 7,
    maxConcurrency: 2,
    topLogprobsCount: 20,
    dryRun: true,
  });
  const text = renderText(run, value);
  assert.match(text, /20261125T090000Z_abc123/u);
  assert.match(text, /report\.md/u);
  assert.match(text, /demos/u);
});

test("the run tool keeps a long time limit for the network calls", () => {
  const { service } = createStubService();
  const run = createToolDefinitions(service).find((tool) => tool.name === TOOL_RUN);
  assert.ok(run.timeoutMs >= 3_600_000);
});

test("the status tool reads the recent runs", async () => {
  const { service, calls } = createStubService();
  const status = createToolDefinitions(service).find((tool) => tool.name === TOOL_STATUS);
  const value = await status.execute({}, { signal: new AbortController().signal });
  assert.equal(calls[0].method, "status");
  const text = renderText(status, value);
  assert.match(text, /complete/u);
});

test("the report tool reads one report", async () => {
  const { service, calls } = createStubService();
  const report = createToolDefinitions(service).find((tool) => tool.name === TOOL_REPORT);
  const value = await report.execute(
    { session: "20261125T090000Z_abc123" },
    { signal: new AbortController().signal },
  );
  assert.equal(calls[0].xid, "20261125T090000Z_abc123");
  assert.match(renderText(report, value), /# Report/u);
});

test("the dataset tool describes the two dataset files", async () => {
  const { service, calls } = createStubService();
  const dataset = createToolDefinitions(service).find((tool) => tool.name === TOOL_DATASET);
  const value = await dataset.execute({}, { signal: new AbortController().signal });
  assert.equal(calls[0].method, "datasetSummary");
  assert.match(renderText(dataset, value), /zh32/u);
});

test("the help text describes the protocol and the comparisons", () => {
  const text = buildHelpText();
  for (const name of [TOOL_RUN, TOOL_STATUS, TOOL_REPORT, TOOL_DATASET, TOOL_HELP]) {
    assert.ok(text.includes(name), name);
  }
  for (const name of ["plain_self", "injected_self", "injected_actual"]) {
    assert.ok(text.includes(name), name);
  }
});
