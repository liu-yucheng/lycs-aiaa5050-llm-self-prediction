// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildPrivateProviderEnvironments,
  buildProviderEnvironments,
  ensureConfigFile,
  ensureEnvironmentFile,
  isPlaceholderValue,
  mergeProviderEnvironments,
  parseEnvironmentText,
  readConfiguration,
  readEnvironmentFile,
} from "../lib/env.js";
import { PRIVATE_ENVIRONMENT_PROPERTIES } from "../lib/constants.js";
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
  for (const name of [".env.example", "configs.env"]) {
    await writeFile(
      path.join(workspace, name),
      await readFile(path.join(repository, name)),
    );
  }
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
    assert.equal(state.filePath, path.join(workspace, ".env"));
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

test("an old inputs environment file moves to the workspace root", async () => {
  const workspace = await makeWorkspace();
  await mkdir(path.join(workspace, "inputs"), { recursive: true });
  await writeFile(path.join(workspace, "inputs", ".env"), "deepseek.api_key=sk-legacy\n");
  try {
    const state = await ensureEnvironmentFile(workspace);
    assert.equal(state.filePath, path.join(workspace, ".env"));
    assert.equal(state.migratedFrom, path.join(workspace, "inputs", ".env"));
    const second = await ensureEnvironmentFile(workspace);
    assert.equal(second.created, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a real run stops with a prompt when no key is available", async () => {
  const workspace = await makeWorkspace({
    "configs.env": "huggingface.models_to_use=Qwen/Qwen3-Coder-Next\n",
  });
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
      /Put the key in .*[\\/]\.env/u,
    );
  } finally {
    if (previous !== undefined) {
      process.env["HF_TOKEN"] = previous;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

test("the models file wins for a model list and keeps the other properties", () => {
  const base = buildProviderEnvironments({
    "huggingface.base_url": "https://example.invalid/v1",
    "huggingface.models_to_use": "old-one",
    "deepseek.api_key": "sk_key",
  });
  const overlay = buildProviderEnvironments({
    "huggingface.models_to_use": "new-one, new-two",
  });
  const merged = mergeProviderEnvironments(base, overlay);
  const huggingface = merged.get("huggingface");
  assert.equal(huggingface?.baseUrl, "https://example.invalid/v1");
  assert.deepEqual(huggingface?.models, ["new-one", "new-two"]);
  assert.equal(merged.get("deepseek")?.apiKey, "sk_key");
});

test("the configuration file is copied from the package once", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "llm-self-prediction-config-"));
  try {
    const state = await ensureConfigFile(workspace);
    assert.equal(state.filePath, path.join(workspace, "configs.env"));
    assert.equal(state.created, true);
    assert.match(await readFile(state.filePath, "utf8"), /models_to_use=/u);
    const second = await ensureConfigFile(workspace);
    assert.equal(second.created, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("the legacy models file moves to the configuration file", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "llm-self-prediction-legacy-"));
  try {
    const legacy = "huggingface.models_to_use=first\n";
    const legacyPath = path.join(workspace, "models-to-use.env");
    await writeFile(legacyPath, legacy);
    const state = await ensureConfigFile(workspace);
    assert.equal(state.filePath, path.join(workspace, "configs.env"));
    assert.equal(state.created, true);
    assert.equal(state.migratedFrom, legacyPath);
    assert.equal(await readFile(state.filePath, "utf8"), legacy);
    assert.equal(await readFile(legacyPath, "utf8"), legacy);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("the private builder accepts only repo_url, base_url, and api_key", () => {
  const result = buildPrivateProviderEnvironments({
    "huggingface.repo_url": "https://example.invalid/repo",
    "huggingface.base_url": "https://other.invalid/v1",
    "huggingface.api_key": "hf_key",
    "huggingface.edge_host": "cdn-lfs.hf.co",
    "deepseek.models_to_use": "deepseek-flash",
    orphan: "value",
  });
  const huggingface = result.environments.get("huggingface");
  assert.equal(huggingface?.baseUrl, "https://other.invalid/v1");
  assert.equal(huggingface?.apiKey, "hf_key");
  assert.equal(huggingface?.edgeHost, undefined);
  assert.deepEqual(result.rejectedKeys, ["huggingface.edge_host", "deepseek.models_to_use"]);
});

test("the reader takes the private keys from .env and the settings from configs.env", async () => {
  const workspace = await makeWorkspace({
    ".env": 'huggingface.repo_url="https://example.invalid/repo"' + "\n" + 'huggingface.api_key="hf_test"' + "\n",
    "configs.env":
      "huggingface.models_to_use=first, second" + "\n" + "huggingface.edge_host=cdn-lfs.hf.co" + "\n" +
      "deepseek.models_to_use=deepseek-flash" + "\n",
  });
  try {
    const configuration = await readConfiguration(workspace);
    assert.equal(configuration.problems.length, 0);
    assert.equal(configuration.state.environment.filePath, path.join(workspace, ".env"));
    assert.equal(configuration.state.configFilePath, path.join(workspace, "configs.env"));
    const huggingface = configuration.environments.get("huggingface");
    assert.equal(huggingface?.apiKey, "hf_test");
    assert.equal(huggingface?.edgeHost, "cdn-lfs.hf.co");
    assert.deepEqual(huggingface?.models, ["first", "second"]);
    assert.deepEqual(configuration.environments.get("deepseek")?.models, ["deepseek-flash"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("the reader reports a non-private key in .env and moves the setting to configs.env", async () => {
  const workspace = await makeWorkspace({
    ".env": "huggingface.api_key=hf_test" + "\n" + "huggingface.models_to_use=private-list" + "\n",
  });
  try {
    const configuration = await readConfiguration(workspace);
    assert.equal(configuration.problems.length, 1);
    assert.match(configuration.problems[0], /huggingface\.models_to_use/u);
    assert.match(configuration.problems[0], /configs\.env/u);
    assert.equal(configuration.environments.get("huggingface")?.apiKey, "hf_test");
    assert.notDeepEqual(configuration.environments.get("huggingface")?.models, ["private-list"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("the packaged example file holds only the private keys", async () => {
  const text = await readFile(path.join(repository, ".env.example"), "utf8");
  const keys = Object.keys(parseEnvironmentText(text));
  assert.ok(keys.length > 0);
  for (const key of keys) {
    const property = key.slice(key.indexOf(".") + 1);
    assert.ok(PRIVATE_ENVIRONMENT_PROPERTIES.includes(property), "unexpected property " + property);
  }
});

