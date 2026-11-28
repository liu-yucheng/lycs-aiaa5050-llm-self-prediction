// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildActualPredictionPrompt,
  buildInjectedSelfPredictionPrompt,
  buildRepeatedActualPrompt,
  buildInjectedTableMessage,
  buildSelfPredictionPrompt,
  formatTableJson,
  isEnglishTask,
  parseSelfReport,
} from "../lib/prompts.js";

const chineseTask = {
  id: "Z001",
  category: "poetry",
  language: "zh-Hans",
  prefix: "床前明月光，疑是地上",
  referenceToken: "霜",
};

const englishTask = {
  id: "E001",
  category: "daily",
  language: "en-US",
  prefix: "The cat sat on the",
  referenceToken: "mat",
};

test("the language check follows the task language prefix", () => {
  assert.equal(isEnglishTask(englishTask), true);
  assert.equal(isEnglishTask(chineseTask), false);
});

test("the actual prompt holds the prefix and asks for the one next token", () => {
  const prompt = buildActualPredictionPrompt(chineseTask);
  assert.ok(prompt.user.includes("床前明月光，疑是地上"));
  assert.ok(prompt.system.length > 0);
  assert.equal(prompt.user.includes("霜"), false);
});

test("the self prompt asks for the requested entry count in both languages", () => {
  const chinese = buildSelfPredictionPrompt(chineseTask, 20);
  const english = buildSelfPredictionPrompt(englishTask, 12);
  assert.ok(chinese.user.includes("20"));
  assert.ok(english.user.includes("12"));
  assert.ok(chinese.user.includes("床前明月光，疑是地上"));
  assert.ok(english.user.includes("The cat sat on the"));
});

test("the self prompt explains the tokenize cut rule", () => {
  const prompt = buildSelfPredictionPrompt(englishTask, 20);
  assert.match(prompt.user, /cut|piece|fragment|tokeniz/iu);
});

test("the injected table message repeats each entry of the table", () => {
  const text = buildInjectedTableMessage({
    entries: [
      { token: "a", logProbability: -0.1 },
      { token: "b", logProbability: -2.3 },
    ],
  });
  assert.ok(text.includes('"a"'));
  assert.ok(text.includes('"b"'));
  assert.ok(text.includes("-2.3"));
});

test("the injected prompts refer to the table already in the context", () => {
  const self = buildInjectedSelfPredictionPrompt(englishTask, 20);
  const actual = buildRepeatedActualPrompt(englishTask);
  assert.ok(self.length > 0);
  assert.ok(actual.includes("The cat sat on the"));
  assert.match(actual, /next/iu);
  assert.equal(actual, buildActualPredictionPrompt(englishTask).user);
});

test("the table format rounds a log probability and stays valid JSON", () => {
  const text = formatTableJson({ entries: [{ token: "a", logProbability: -0.123456789 }] });
  const parsed = JSON.parse(text);
  assert.equal(parsed.entries[0].logProbability, -0.123457);
});

test("the self report parser reads a plain object", () => {
  const entries = parseSelfReport(
    '{"entries":[{"token":"霜","logProbability":-1.25},{"token":"光","logProbability":-2.5}]}',
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0].token, "霜");
});

test("the self report parser reads a fenced block with a surrounding sentence", () => {
  const entries = parseSelfReport(
    'Sure, here it is:\n```json\n{"entries":[{"token":"mat","logProbability":-0.3}]}\n```\n',
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].logProbability, -0.3);
});

test("the self report parser reads an array and an alternative key name", () => {
  const entries = parseSelfReport('[{"word":"mat","logprob":-0.7}]');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].token, "mat");
  assert.equal(entries[0].logProbability, -0.7);
});

test("the self report parser rejects a reply without a table", () => {
  assert.throws(() => parseSelfReport("I cannot answer that."), /table|JSON|entr/iu);
});
