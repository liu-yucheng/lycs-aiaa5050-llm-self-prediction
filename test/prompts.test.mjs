// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

import assert from "node:assert/strict";
import test from "node:test";

import { SELF_PREDICTION_TOOL_NAME } from "../lib/constants.js";
import { ExperimentError } from "../lib/errors.js";
import {
  buildActualPredictionPrompt,
  buildSelfPredictionPrompt,
  buildSelfPredictionTool,
  parseSelfPredictionArguments,
} from "../lib/prompts.js";

/** One task that the prompt tests use. */
const TASK = {
  id: "T001",
  category: "poetry",
  prefix: "床前明月光，疑是地上",
  referenceToken: "霜",
};

test("the actual prompt names the prefix and asks for one token", () => {
  const prompt = buildActualPredictionPrompt(TASK);
  assert.match(prompt.system, /下一个词/);
  assert.match(prompt.user, /床前明月光/);
  assert.match(prompt.user, /一个词/);
});

test("the self prompt asks for the forced tool call", () => {
  const prompt = buildSelfPredictionPrompt(TASK, 64);
  assert.match(prompt.user, /床前明月光/);
  assert.match(prompt.user, new RegExp(SELF_PREDICTION_TOOL_NAME));
  assert.match(prompt.user, /64/);
});

test("the self-prediction tool bounds the entry count", () => {
  const tool = buildSelfPredictionTool(64);
  assert.equal(tool.name, SELF_PREDICTION_TOOL_NAME);
  const entries = tool.parameters.properties.entries;
  assert.equal(entries.type, "array");
  assert.equal(entries.minItems, 1);
  assert.equal(entries.maxItems, 64);
  const wide = buildSelfPredictionTool(1000);
  assert.equal(wide.parameters.properties.entries.maxItems, 64);
});

test("parseSelfPredictionArguments accepts a JSON string and an object", () => {
  const expected = [
    { token: "霜", logProbability: Math.log(0.6) },
    { token: "月", logProbability: Math.log(0.4) },
  ];
  const fromString = parseSelfPredictionArguments(JSON.stringify({ entries: expected }));
  assert.deepEqual(fromString, expected);
  const fromObject = parseSelfPredictionArguments({ entries: expected });
  assert.deepEqual(fromObject, expected);
});

test("parseSelfPredictionArguments rejects a malformed answer", () => {
  assert.throws(() => parseSelfPredictionArguments("not json"), ExperimentError);
  assert.throws(() => parseSelfPredictionArguments({}), ExperimentError);
  assert.throws(() => parseSelfPredictionArguments({ entries: [] }), ExperimentError);
  assert.throws(
    () => parseSelfPredictionArguments({ entries: [{ token: "霜", logProbability: "x" }] }),
    ExperimentError,
  );
});
