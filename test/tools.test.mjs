// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TOOL_DATASET,
  TOOL_HELP,
  TOOL_REPORT,
  TOOL_RUN,
  TOOL_STATUS,
} from "../lib/constants.js";
import { ExperimentError } from "../lib/errors.js";
import { ExperimentService } from "../lib/experiment.js";
import { buildRunRequest, createToolDefinitions } from "../lib/tools.js";

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

test("the plugin registers five tools with an object output schema", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "llm-self-prediction-"));
  try {
    const definitions = createToolDefinitions(createService(workspace));
    assert.deepEqual(
      definitions.map((definition) => definition.name),
      [TOOL_RUN, TOOL_STATUS, TOOL_REPORT, TOOL_DATASET, TOOL_HELP],
    );
    for (const definition of definitions) {
      assert.equal(definition.parameters.type, "object");
      assert.equal(definition.output.schema.type, "object");
      assert.equal(typeof definition.output.render, "function");
    }
    const help = definitions[4];
    assert.ok(help !== undefined);
    const helpValue = await help.execute({}, { signal: new AbortController().signal, callId: "1" });
    const blocks = help.output.render({}, helpValue);
    assert.equal(blocks[0].type, "text");
    assert.match(blocks[0].text, /Next-token self-prediction/);
    assert.match(blocks[0].text, new RegExp(TOOL_RUN));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("buildRunRequest reads the arguments and ignores an unknown argument", () => {
  const request = buildRunRequest({
    providers: ["qwen"],
    tasks: ["T001"],
    limit: 2,
    repetitions: 3,
    toleranceNats: 0.5,
    dryRun: true,
    unknown: 1,
  });
  assert.deepEqual(request.providerKeys, ["qwen"]);
  assert.deepEqual(request.taskIds, ["T001"]);
  assert.equal(request.limit, 2);
  assert.equal(request.repetitions, 3);
  assert.equal(request.toleranceNats, 0.5);
  assert.equal(request.dryRun, true);
  assert.equal(request.maxConcurrency, undefined);
  assert.throws(() => buildRunRequest({ providers: "qwen" }), ExperimentError);
});

test("the run tool executes one dry run and renders a text block", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "llm-self-prediction-"));
  try {
    const definitions = createToolDefinitions(createService(workspace));
    const runTool = definitions[0];
    assert.ok(runTool !== undefined);
    const value = await runTool.execute(
      { dryRun: true, limit: 1, repetitions: 1 },
      { signal: new AbortController().signal, callId: "2" },
    );
    assert.equal(value.taskCount, 1);
    assert.equal(value.pairCount, 1);
    assert.equal(value.verdicts.length, 1);
    const blocks = runTool.output.render({}, value);
    assert.match(blocks[0].text, /^Session: /);
    assert.match(blocks[0].text, /Report: /);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
