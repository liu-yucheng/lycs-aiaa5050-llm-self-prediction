// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildProviderEnvironments,
  ensureEnvironmentFile,
  isPlaceholderValue,
  parseEnvironmentText,
  readEnvironmentFile,
} from "../lib/env.js";
import { applyProviderEnvironments } from "../lib/providers.js";
import { ExperimentService } from "../lib/experiment.js";

const repository = path.resolve(import.meta.dirname, "..");

/**
 * Create one workspace with the inputs of the repository.
 *
 * @param extraFiles - the files to add, keyed by a relative path.
 * @returns the workspace path.
 */
async function makeWorkspace(extraFiles = {}) {
  const workspace = await mkdtemp(path.join(tmpdir(), "llm-self-prediction-env-"));
  await mkdir(path.join(workspace, "inputs", "testing-dataset"), { recursive: true });
  for (const name of ["dataset-zh-32.json", "dataset-en-32.json"]) {
    await writeFile(
      path.join(workspace, "inputs", "testing-dataset", name),
      await readFile(path.join(repository, "inputs", "testing-dataset", name)),
    );
  }
  await writeFile(
    path.join(workspace, "inputs", "providers.json"),
    await readFile(path.join(repository, "inputs", "providers.json")),
  );
  for (const [name, content] of Object.entries(extraFiles)) {
    await writeFile(path.join(workspace, name), content);
  }
  return workspace;
}

test("the parser reads keys, quotes, and comments", () => {
  const values = parseEnvironmentText(
    [
      "# A comment.",
      "huggingface.model_to_use = Qwen/Qwen3-Coder-Next",
      'deepseek.api_key="sk-quoted"',
      "export mock.base_url=mock://local",
      "",
    ].join("\n"),
  );
  assert.equal(values["huggingface.model_to_use"], "Qwen/Qwen3-Coder-Next");
  assert.equal(values["deepseek.api_key"], "sk-quoted");
  assert.equal(values["mock.base_url"], "mock://local");
  assert.equal(Object.keys(values).length, 3);
});

test("the placeholder test reports an empty value and an angle bracket value", () => {
  assert.equal(isPlaceholderValue(""), true);
  assert.equal(isPlaceholderValue("   "), true);
  assert.equal(isPlaceholderValue("<your key>"), true);
  assert.equal(isPlaceholderValue("hf_abc"), false);
});

test("the section builder groups the properties of one prefix", () => {
  const environments = buildProviderEnvironments({
    "huggingface.api_key": "hf_key",
    "huggingface.model_to_use": "Qwen/Qwen3-Coder-Next",
    "huggingface.models_to_use": "one, two , three",
    "huggingface.top_logprobs": "12",
    "deepseek.api_key": "sk_key",
  });
  const huggingface = environments.get("huggingface");
  assert.equal(huggingface?.apiKey, "hf_key");
  assert.equal(huggingface?.model, "Qwen/Qwen3-Coder-Next");
  assert.deepEqual(huggingface?.models, ["one", "two", "three"]);
  assert.equal(huggingface?.topLogprobsCount, 12);
  assert.equal(environments.get("deepseek")?.apiKey, "sk_key");
});

test("the environment sections override the base URL, the model list, and the entry count", () => {
  const catalog = {
    schemaVersion: 1,
    description: "test",
    providers: [
      {
        key: "huggingface",
        label: "Hugging Face",
        baseUrl: "https://example.invalid/v1",
        model: "old-model",
        apiKeyEnvironmentVariable: "HF_TOKEN",
        topLogprobsCount: 5,
        enabled: true,
      },
    ],
  };
  const environments = buildProviderEnvironments({
    "huggingface.base_url": "https://other.invalid/v1",
    "huggingface.models_to_use": "first, second",
    "huggingface.top_logprobs": "20",
    "huggingface.reasoning": "disabled",
  });
  const [provider] = applyProviderEnvironments(catalog, environments).providers;
  assert.equal(provider.baseUrl, "https://other.invalid/v1");
  assert.deepEqual(provider.models, ["first", "second"]);
  assert.equal(provider.topLogprobsCount, 20);
  assert.equal(provider.reasoning, "disabled");
});

test("the environment file is copied once and an edited file is kept", async () => {
  const workspace = await makeWorkspace();
  try {
    const state = await ensureEnvironmentFile(workspace);
    assert.equal(state.filePath, path.join(workspace, "inputs", ".env"));
    assert.equal(state.created, true);
    const copied = await readFile(state.filePath, "utf8");
    assert.ok(copied.includes("api_key"));
    await writeFile(state.filePath, "deepseek.api_key=sk-edited\n");
    const second = await ensureEnvironmentFile(workspace);
    assert.equal(second.created, false);
    assert.equal(await readFile(second.filePath, "utf8"), "deepseek.api_key=sk-edited\n");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a root environment file moves into the inputs directory", async () => {
  const workspace = await makeWorkspace({ ".env": "deepseek.api_key=sk-legacy\n" });
  try {
    const state = await ensureEnvironmentFile(workspace);
    assert.equal(state.filePath, path.join(workspace, "inputs", ".env"));
    assert.equal(state.migratedFrom, path.join(workspace, ".env"));
    const values = await readEnvironmentFile(state.filePath);
    assert.equal(values["deepseek.api_key"], "sk-legacy");
    const second = await ensureEnvironmentFile(workspace);
    assert.equal(second.created, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a real run stops with a prompt when no key is available", async () => {
  const workspace = await makeWorkspace();
  const previous = process.env["HF_TOKEN"];
  delete process.env["HF_TOKEN"];
  try {
    const service = new ExperimentService({
      resolveWorkspace: async () => workspace,
      outputRoot: () => "",
    });
    await assert.rejects(
      () =>
        service.run(
          { id: "test" },
          { providerKeys: ["huggingface"], taskIds: ["Z001"], repetitions: 1 },
        ),
      /No API key is available/u,
    );
    await assert.rejects(
      () =>
        service.run(
          { id: "test" },
          { providerKeys: ["huggingface"], taskIds: ["Z001"], repetitions: 1 },
        ),
      /inputs[\\/]\.env/u,
    );
  } finally {
    if (previous !== undefined) {
      process.env["HF_TOKEN"] = previous;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});
