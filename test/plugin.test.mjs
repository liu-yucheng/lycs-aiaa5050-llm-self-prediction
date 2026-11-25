// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * The tests of the plugin entry point.
 *
 * One stub host context stands in for DeepSeek Harness. The test checks the tool registration, the
 * configuration wiring, and one dry run through the registered tool.
 */

import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { apply, inject, name } from "../lib/index.js";

const repository = path.resolve(import.meta.dirname, "..");
const scratchDirectories = [];

after(async () => {
  for (const directory of scratchDirectories) {
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * Create one scratch workspace with the inputs of the repository.
 *
 * @returns the absolute path of the directory.
 */
async function createScratchDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "llm-self-prediction-plugin-"));
  scratchDirectories.push(directory);
  await cp(path.join(repository, "inputs"), path.join(directory, "inputs"), {
    recursive: true,
    filter: (source) => !source.endsWith(".env"),
  });
  return directory;
}

/**
 * Create one stub host context.
 *
 * @param options - the workspace path and the tool registry.
 * @returns the context and the disposal callback of the effect.
 */
function createStubContext(options) {
  const disposals = [];
  const context = {
    tools: {
      register: (definition) => {
        options.registry.set(definition.name, definition);
        return () => {
          options.registry.delete(definition.name);
        };
      },
    },
    effect: (callback) => {
      const dispose = callback();
      disposals.push(dispose);
      return () => {
        if (typeof dispose === "function") {
          dispose();
        }
      };
    },
    get: () => undefined,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    workingDirectory: {
      ensure: async () => options.workspace,
    },
  };
  return { context, disposeAll: () => disposals.forEach((dispose) => dispose?.()) };
}

test("the entry point registers the five tools and reads the configuration", async () => {
  const workspace = await createScratchDirectory();
  const outputRoot = path.join(workspace, "custom-output");
  const registry = new Map();
  const { context, disposeAll } = createStubContext({ workspace, registry });

  apply(context, { outputRoot, maxConcurrency: 2 });

  assert.equal(name, "lycs-aiaa5050-llm-self-prediction");
  assert.deepEqual([...inject], ["tools", "workingDirectory"]);
  assert.deepEqual(
    [...registry.keys()].sort(),
    [
      "llm_self_prediction_dataset",
      "llm_self_prediction_help",
      "llm_self_prediction_report",
      "llm_self_prediction_run",
      "llm_self_prediction_status",
    ],
  );

  const controller = new AbortController();
  const runTool = registry.get("llm_self_prediction_run");
  const value = await runTool.execute(
    { tasks: ["Z001"], repetitions: 1, dryRun: true },
    { signal: controller.signal, agent: { id: "test-agent" } },
  );

  assert.equal(value.metrics.taskCount, 1);
  assert.equal(value.metrics.providers.length, 1);
  assert.equal(value.metrics.verdicts.length, 1);
  assert.equal(value.metrics.verdicts[0].verdicts.length, 3);
  assert.ok(value.directory.startsWith(outputRoot));
  assert.deepEqual(await readdir(outputRoot), [value.xid]);

  const rendered = runTool.output.render({}, value);
  assert.equal(rendered.length, 1);
  assert.match(rendered[0].text, new RegExp(`^Run ${value.xid}`, "u"));

  disposeAll();
  assert.equal(registry.size, 0);
});

test("the entry point loads without a configuration value", async () => {
  const workspace = await createScratchDirectory();
  const registry = new Map();
  const { context } = createStubContext({ workspace, registry });

  apply(context, undefined);

  assert.equal(registry.size, 5);
});
