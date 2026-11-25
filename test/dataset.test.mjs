// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  computeDatasetHash,
  countByCategory,
  loadDatasets,
  resolveDatasetDirectory,
  selectTasks,
  validateDataset,
} from "../lib/dataset.js";

const workspace = path.resolve(import.meta.dirname, "..");

test("the packaged dataset directory holds one file for each language", async () => {
  const directory = await resolveDatasetDirectory(workspace, "testing-dataset");
  const loaded = await loadDatasets(directory);
  assert.equal(loaded.datasets.length, 2);
  assert.deepEqual([...loaded.languages].sort(), ["en-US", "zh-Hans"]);
  for (const dataset of loaded.datasets) {
    assert.equal(dataset.taskCount, 32);
  }
  assert.equal(loaded.tasks.length, 64);
  assert.equal(new Set(loaded.tasks.map((task) => task.id)).size, 64);
});

test("each dataset holds four tasks of each of the eight categories", async () => {
  const directory = await resolveDatasetDirectory(workspace, "testing-dataset");
  const loaded = await loadDatasets(directory);
  for (const dataset of loaded.datasets) {
    const counts = countByCategory(dataset.tasks);
    assert.equal(counts.size, 8);
    for (const count of counts.values()) {
      assert.equal(count, 4);
    }
  }
});

test("no task prefix ends with its reference token", async () => {
  const directory = await resolveDatasetDirectory(workspace, "testing-dataset");
  const loaded = await loadDatasets(directory);
  for (const task of loaded.tasks) {
    assert.equal(task.prefix.endsWith(task.referenceToken), false);
  }
});

test("the dataset hash changes with the task list", async () => {
  const directory = await resolveDatasetDirectory(workspace, "testing-dataset");
  const loaded = await loadDatasets(directory);
  const first = loaded.datasets[0];
  assert.ok(first);
  const full = computeDatasetHash(first.tasks);
  const shorter = computeDatasetHash(first.tasks.slice(0, 3));
  assert.match(full, /^[0-9a-f]{64}$/u);
  assert.notEqual(full, shorter);
});

test("task selection keeps the requested order and rejects an unknown identifier", async () => {
  const directory = await resolveDatasetDirectory(workspace, "testing-dataset");
  const loaded = await loadDatasets(directory);
  const ids = loaded.tasks.map((task) => task.id);
  const selected = selectTasks(loaded.tasks, [ids[1], ids[0]].filter(Boolean));
  assert.deepEqual(
    selected.map((task) => task.id),
    [ids[1], ids[0]],
  );
  assert.throws(() => selectTasks(loaded.tasks, ["NOPE"]), /NOPE/u);
  assert.deepEqual(selectTasks(loaded.tasks, []), loaded.tasks);
});

test("the validator rejects a duplicate identifier and an empty task list", () => {
  const task = {
    id: "T001",
    category: "daily",
    language: "en-US",
    prefix: "The cat sat on the",
    referenceToken: "mat",
  };
  assert.throws(
    () =>
      validateDataset({
        datasetId: "test",
        language: "en-US",
        description: "test",
        tasks: [task, task],
      }),
    /repeats the task/u,
  );
  assert.throws(
    () =>
      validateDataset({
        datasetId: "test",
        language: "en-US",
        description: "test",
        tasks: [],
      }),
    /task/u,
  );
});

test("the validator rejects a prefix that already ends with the reference token", () => {
  assert.throws(
    () =>
      validateDataset({
        datasetId: "test",
        language: "en-US",
        description: "test",
        tasks: [
          {
            id: "T001",
            category: "daily",
            prefix: "The cat sat on the mat",
            referenceToken: "mat",
          },
        ],
      }),
    /reference token/u,
  );
});
