// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

import assert from "node:assert/strict";
import test from "node:test";

import {
  computeDatasetHash,
  countByCategory,
  loadDataset,
  selectTasks,
  validateDataset,
} from "../lib/dataset.js";
import { ExperimentError } from "../lib/errors.js";

test("the bundled dataset holds 128 unique tasks in 8 categories and 2 languages", async () => {
  const dataset = await loadDataset();
  assert.equal(dataset.taskCount, 128);
  assert.equal(dataset.tasks.length, 128);
  assert.equal(dataset.language, "zh-Hans, en-US");
  assert.deepEqual(dataset.languages, ["zh-Hans", "en-US"]);
  const identifiers = new Set(dataset.tasks.map((task) => task.id));
  assert.equal(identifiers.size, 128);
  const categories = countByCategory(dataset.tasks);
  assert.equal(Object.keys(categories).length, 8);
  for (const count of Object.values(categories)) {
    assert.equal(count, 16);
  }
  const languages = new Set(dataset.tasks.map((task) => task.language));
  assert.deepEqual([...languages].sort(), ["en-US", "zh-Hans"]);
  for (const language of ["en-US", "zh-Hans"]) {
    assert.equal(dataset.tasks.filter((task) => task.language === language).length, 64);
  }
});

test("each task ends the prefix before the reference token", async () => {
  const dataset = await loadDataset();
  for (const task of dataset.tasks) {
    assert.notEqual(task.prefix.trim(), "", `The task ${task.id} has an empty prefix.`);
    assert.notEqual(task.referenceToken.trim(), "", `The task ${task.id} has no reference token.`);
    assert.equal(
      task.prefix.endsWith(task.referenceToken),
      false,
      `The task ${task.id} already ends with its reference token.`,
    );
  }
});

test("selectTasks keeps the dataset order and applies one limit", async () => {
  const dataset = await loadDataset();
  const selected = selectTasks(dataset, ["Z005", "Z002"], 0);
  assert.deepEqual(
    selected.map((task) => task.id),
    ["Z002", "Z005"],
  );
  const limited = selectTasks(dataset, [], 3);
  assert.deepEqual(
    limited.map((task) => task.id),
    ["Z001", "Z002", "Z003"],
  );
  assert.throws(() => selectTasks(dataset, ["T999"], 0), ExperimentError);
});

test("the dataset hash is stable and depends on the task text", async () => {
  const dataset = await loadDataset();
  const first = computeDatasetHash(dataset);
  const second = computeDatasetHash(dataset);
  assert.equal(first, second);
  assert.equal(first.length, 64);
  const changed = {
    ...dataset,
    tasks: dataset.tasks.map((task, index) =>
      index === 0 ? { ...task, prefix: `${task.prefix}多` } : task,
    ),
  };
  assert.notEqual(computeDatasetHash(changed), first);
});

test("validateDataset rejects a malformed dataset", () => {
  assert.throws(() => validateDataset({ tasks: [] }), ExperimentError);
  assert.throws(
    () => validateDataset({ datasetId: "x", language: "zh-Hans", taskCount: 2, tasks: [] }),
    ExperimentError,
  );
});
