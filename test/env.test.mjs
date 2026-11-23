// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * Tests of the environment file.
 *
 * The tests cover the parser, the section builder, the copy of the example file, and the prompt
 * that a run reports when an API key is absent.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildProviderEnvironments,
  ensureEnvironmentFile,
  isPlaceholderValue,
  parseEnvironmentText,
  readEnvironmentFile,
} from "../lib/env.js";
import { ExperimentError } from "../lib/errors.js";
import { ExperimentService } from "../lib/experiment.js";
import {
  applyProviderEnvironments,
  expandProviderModels,
  resolveProviderApiKey,
} from "../lib/providers.js";
import { loadProviderCatalog } from "../lib/providers.js";

/**
 * Create one temporary directory that holds the given files.
 *
 * @param files - the file names and their text.
 * @returns the directory path.
 */
async function makeWorkspace(files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "llm-self-prediction-env-"));
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(directory, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text, "utf8");
  }
  return directory;
}

test("parseEnvironmentText reads keys, quotes, and comments", () => {
  const text = [
    "# a comment",
    "",
    "deepseek.base_url=https://api.deepseek.com",
    "  deepseek.api_key = \"sk-test-1\"  ",
    "export qwen.model_to_use='qwen-flash'",
    "note=left=right",
    "broken line without a separator",
    "=no key",
  ].join("\n");
  const values = parseEnvironmentText(text);
  assert.deepEqual(values, {
    "deepseek.base_url": "https://api.deepseek.com",
    "deepseek.api_key": "sk-test-1",
    "qwen.model_to_use": "qwen-flash",
    "note": "left=right",
  });
});

test("isPlaceholderValue reports empty values and angle-bracket placeholders", () => {
  assert.equal(isPlaceholderValue(""), true);
  assert.equal(isPlaceholderValue("   "), true);
  assert.equal(isPlaceholderValue("<Your API key, not mine.>"), true);
  assert.equal(isPlaceholderValue("sk-live-1234"), false);
});

test("buildProviderEnvironments groups the properties of one section", () => {
  const values = {
    "deepseek.base_url": "https://api.deepseek.com",
    "deepseek.model_to_use": "deepseek-flash",
    "deepseek.api_key": "sk-test-1",
    "zhipu.api_key": "zhipu-test",
    "unknown.property": "ignored",
    "noDotKey": "ignored",
  };
  const environments = buildProviderEnvironments(values);
  assert.deepEqual(environments.get("deepseek"), {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    apiKey: "sk-test-1",
  });
  assert.deepEqual(environments.get("zhipu"), { apiKey: "zhipu-test" });
  assert.equal(environments.has("unknown"), false);
  assert.equal(environments.size, 2);
});

test("ensureEnvironmentFile copies the example once and keeps an edited file", async () => {
  const example = "openrouter.api_key=<Your API key.>\n";
  const directory = await makeWorkspace({ "inputs/.env.example": example });
  try {
    const first = await ensureEnvironmentFile(directory);
    assert.equal(first.created, true);
    assert.equal(first.filePath, path.join(directory, "inputs", ".env"));
    assert.equal(await readFile(first.filePath, "utf8"), example);
    await writeFile(first.filePath, "deepseek.api_key=sk-test-1\n", "utf8");
    const second = await ensureEnvironmentFile(directory);
    assert.equal(second.created, false);
    assert.equal(await readFile(second.filePath, "utf8"), "deepseek.api_key=sk-test-1\n");
    const values = await readEnvironmentFile(second.filePath);
    assert.equal(values["deepseek.api_key"], "sk-test-1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("applyProviderEnvironments overrides the base URL and the model list", async () => {
  const catalog = await loadProviderCatalog();
  const environments = buildProviderEnvironments({
    "openrouter.base_url": "https://api.example.test/v1",
    "openrouter.models_to_use": "alpha/one:batch, beta/two",
  });
  const merged = applyProviderEnvironments(catalog, environments);
  const openrouter = merged.providers.find((provider) => provider.key === "openrouter");
  assert.equal(openrouter.baseUrl, "https://api.example.test/v1");
  assert.deepEqual(openrouter.models, ["alpha/one:batch", "beta/two"]);
  assert.equal(resolveProviderApiKey(openrouter, environments), undefined);
  const expanded = expandProviderModels(merged);
  assert.deepEqual(
    expanded.providers.map((provider) => provider.key),
    ["openrouter-alpha-one-batch", "openrouter-beta-two", "mock"],
  );
  assert.deepEqual(
    expanded.providers.map((provider) => provider.model),
    ["alpha/one:batch", "beta/two", "mock-flash"],
  );
});

test("a real run stops with a prompt when the key is a placeholder", async () => {
  const directory = await makeWorkspace({
    "inputs/.env.example": "deepseek.api_key=<Your API key, not mine.>\n",
  });
  try {
    const service = new ExperimentService({
      resolveWorkspace: async () => directory,
      outputRoot: () => "",
    });
    const request = { providerKeys: ["openrouter"], limit: 1, repetitions: 1 };
    await assert.rejects(
      service.run(undefined, request, new AbortController().signal),
      (error) => {
        assert.equal(error instanceof ExperimentError, true);
        assert.equal(error.code, "MISSING_CREDENTIAL");
        assert.match(error.message, /openrouter\.api_key/u);
        assert.match(error.message, /\.env/u);
        return true;
      },
    );
    const state = await ensureEnvironmentFile(directory);
    assert.equal(state.created, false);
    assert.equal(state.filePath, path.join(directory, "inputs", ".env"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a dry run reports the created environment file as a warning", async () => {
  const directory = await makeWorkspace({
    "inputs/.env.example": "deepseek.api_key=<Your API key, not mine.>\n",
  });
  try {
    const service = new ExperimentService({
      resolveWorkspace: async () => directory,
      outputRoot: () => "",
    });
    const result = await service.run(
      undefined,
      { limit: 1, repetitions: 1, dryRun: true },
      new AbortController().signal,
    );
    assert.equal(result.metrics.taskCount, 1);
    assert.equal(result.warnings.length >= 1, true);
    assert.match(result.warnings.join("\n"), /created .*\.env/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a root environment file moves into the inputs directory", async () => {
  const directory = await makeWorkspace({
    ".env": "deepseek.api_key=sk-legacy\n",
  });
  try {
    const state = await ensureEnvironmentFile(directory);
    assert.equal(state.filePath, path.join(directory, "inputs", ".env"));
    assert.equal(state.migratedFrom, path.join(directory, ".env"));
    assert.equal(await readFile(state.filePath, "utf8"), "deepseek.api_key=sk-legacy\n");
    const values = await readEnvironmentFile(state.filePath);
    assert.equal(values["deepseek.api_key"], "sk-legacy");
    const second = await ensureEnvironmentFile(directory);
    assert.equal(second.migratedFrom, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
