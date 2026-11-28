// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * Probe the Hugging Face router for models that serve a top-20 log probability table.
 *
 * The Hugging Face router publishes no list of supported request parameters. The probe therefore
 * measures the support with a real request. A model passes when the reply holds exactly twenty
 * entries at `choices[0].logprobs.content[0].top_logprobs` with `temperature: 0`.
 *
 * The probe reads the private environment file for the API key and the edge host. It writes one
 * report to `outputs/probe/report.md`, and it prints one line for each model.
 *
 * Usage:
 *
 * ```text
 * node scripts/probe-models.mjs [--per-org=3] [--attempts=2] [--concurrency=4]
 * ```
 */

import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";

import { readConfiguration } from "../lib/env.js";
import { CONFIG_FILE_NAME, TOP_LOGPROBS_COUNT } from "../lib/constants.js";

/** The organizations of the top-tier Chinese and international companies. */
const TARGET_ORGANIZATIONS = [
  "deepseek-ai",
  "Qwen",
  "moonshotai",
  "zai-org",
  "XiaomiMiMo",
  "inclusionAI",
  "tencent",
  "ByteDance-Seed",
  "MiniMaxAI",
  "stepfun-ai",
  "01-ai",
  "internlm",
  "baichuan-inc",
  "meta-llama",
  "google",
  "mistralai",
  "microsoft",
  "nvidia",
  "ibm-granite",
  "allenai",
  "CohereLabs",
  "openai",
  "tiiuae",
  "LiquidAI",
  "LGAI-EXANOE",
  "upstage",
  "swiss-ai",
];

/** The probe sentence. The token `霜` is the reference token. */
const PROBE_TASK = {
  id: "PROBE",
  prefix: "床前明月光，疑是地上",
  referenceToken: "霜",
};

/** The repository root. */
const root = path.resolve(import.meta.dirname, "..");

/**
 * Read one numeric option of the command line.
 *
 * @param name - the option name without the leading dashes.
 * @param fallback - the value to use when the option is absent.
 * @returns the option value.
 */
function readNumberOption(name, fallback) {
  const pattern = new RegExp(`--${name}=(\\d+)`, "u");
  for (const argument of process.argv.slice(2)) {
    const match = pattern.exec(argument);
    if (match !== null) {
      return Number.parseInt(match[1], 10);
    }
  }
  return fallback;
}

/**
 * Send one HTTPS request through an optional edge host.
 *
 * @param options - the request inputs.
 * @returns the status code and the reply text.
 */
function requestThroughEdge(options) {
  const url = new URL(options.url);
  const edgeHost = options.edgeHost ?? "";
  const [edgeName, edgePort] = edgeHost.split(":");
  const body = options.body;
  const headers = {
    ...options.headers,
    "content-length": Buffer.byteLength(body),
  };
  const requestOptions = {
    method: "POST",
    host: edgeHost === "" ? url.hostname : edgeName,
    port: edgeHost === "" ? 443 : Number.parseInt(edgePort ?? "443", 10),
    path: `${url.pathname}${url.search}`,
    headers,
    servername: edgeHost === "" ? url.hostname : edgeName,
    rejectUnauthorized: edgeHost === "",
  };
  return new Promise((resolve, reject) => {
    const request = https.request(requestOptions, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          text: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.on("error", reject);
    request.setTimeout(120_000, () => {
      request.destroy(new Error("The request reached its time limit."));
    });
    request.end(body);
  });
}

/**
 * List the models of the router.
 *
 * @param baseUrl - the base URL of the router.
 * @param apiKey - the API key.
 * @param edgeHost - the edge host, or an empty text.
 * @returns the model identifiers with their creation dates.
 */
async function listModels(baseUrl, apiKey, edgeHost) {
  const url = new URL("models", `${baseUrl.replace(/\/$/u, "")}/`);
  const [edgeName, edgePort] = edgeHost.split(":");
  const requestOptions = {
    method: "GET",
    host: edgeHost === "" ? url.hostname : edgeName,
    port: edgeHost === "" ? 443 : Number.parseInt(edgePort ?? "443", 10),
    path: url.pathname,
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    servername: edgeHost === "" ? url.hostname : edgeName,
    rejectUnauthorized: edgeHost === "",
  };
  const text = await new Promise((resolve, reject) => {
    const request = https.request(requestOptions, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    request.on("error", reject);
    request.setTimeout(120_000, () => {
      request.destroy(new Error("The request reached its time limit."));
    });
    request.end();
  });
  const value = JSON.parse(text);
  const entries = Array.isArray(value) ? value : (value.data ?? []);
  return entries.map((entry) => ({
    id: String(entry.id ?? ""),
    createdAt: String(entry.created ?? entry.created_at ?? ""),
  }));
}

/**
 * Probe one model.
 *
 * @param options - the probe inputs.
 * @returns the entry count, and the reason of a failure.
 */
async function probeModel(options) {
  const body = JSON.stringify({
    model: options.model,
    messages: [
      {
        role: "user",
        content: `Complete the poem line with one token. Output the token only.\n${PROBE_TASK.prefix}`,
      },
    ],
    temperature: 0,
    max_tokens: 1,
    logprobs: true,
    top_logprobs: TOP_LOGPROBS_COUNT,
    stream: false,
    reasoning: { enabled: false },
  });
  const reply = await requestThroughEdge({
    url: `${options.baseUrl.replace(/\/$/u, "")}/chat/completions`,
    edgeHost: options.edgeHost,
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
      ...(options.edgeHost === "" ? {} : { host: new URL(options.baseUrl).hostname }),
    },
    body,
  });
  if (reply.status !== 200) {
    return { entryCount: 0, reason: `HTTP ${reply.status}: ${reply.text.slice(0, 160)}` };
  }
  let value;
  try {
    value = JSON.parse(reply.text);
  } catch {
    return { entryCount: 0, reason: "The reply holds no JSON value." };
  }
  const top = value?.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs;
  const count = Array.isArray(top) ? top.length : 0;
  if (count === 0) {
    return { entryCount: 0, reason: "The reply holds no log probability table." };
  }
  return { entryCount: count, reason: "" };
}

/**
 * Run one task with a limited concurrency.
 *
 * @param items - the items to process.
 * @param limit - the maximum number of active tasks.
 * @param worker - the function that processes one item.
 * @returns the results in the item order.
 */
async function runLimited(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Run the probe.
 *
 * @returns nothing.
 */
async function main() {
  const perOrganization = readNumberOption("per-org", 3);
  const attempts = readNumberOption("attempts", 2);
  const concurrency = readNumberOption("concurrency", 4);
  const configuration = await readConfiguration(root);
  const huggingface = configuration.environments.get("huggingface") ?? {};
  const baseUrl = huggingface.baseUrl ?? "https://router.huggingface.co/v1";
  const apiKey = huggingface.apiKey;
  const edgeHost = huggingface.edgeHost ?? "";
  if (apiKey === undefined || apiKey === "") {
    throw new Error("No Hugging Face API key is available.");
  }
  const models = await listModels(baseUrl, apiKey, edgeHost);
  const byOrganization = new Map();
  for (const model of models) {
    const organization = model.id.split("/")[0] ?? "";
    if (!TARGET_ORGANIZATIONS.includes(organization)) {
      continue;
    }
    const list = byOrganization.get(organization) ?? [];
    list.push(model);
    byOrganization.set(organization, list);
  }
  const candidates = [];
  for (const organization of TARGET_ORGANIZATIONS) {
    const list = (byOrganization.get(organization) ?? []).sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
    candidates.push(...list.slice(0, perOrganization));
  }
  process.stdout.write(`Candidates: ${candidates.length}\n`);
  const results = await runLimited(candidates, concurrency, async (candidate) => {
    let last = { entryCount: 0, reason: "The probe did not run." };
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        last = await probeModel({ model: candidate.id, baseUrl, apiKey, edgeHost });
      } catch (error) {
        last = { entryCount: 0, reason: `Transport: ${String(error).slice(0, 160)}` };
      }
      if (last.entryCount === TOP_LOGPROBS_COUNT) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
    const line = `${last.entryCount === TOP_LOGPROBS_COUNT ? "PASS" : "FAIL"}  ${candidate.id}  ` +
      `${last.entryCount}  ${last.reason}`;
    process.stdout.write(`${line}\n`);
    return { model: candidate.id, createdAt: candidate.createdAt, ...last };
  });
  const passed = results.filter((result) => result.entryCount === TOP_LOGPROBS_COUNT);
  const lines = [
    "# Hugging Face model probe",
    "",
    `- Candidates: ${candidates.length}`,
    `- Passing models: ${passed.length}`,
    `- Requested table size: ${TOP_LOGPROBS_COUNT}`,
    `- Probe sentence: ${PROBE_TASK.prefix}[${PROBE_TASK.referenceToken}]`,
    "",
    "## Passing models",
    "",
    "| Model | Created | Entries |",
    "| --- | --- | --- |",
    ...passed.map((result) => `| ${result.model} | ${result.createdAt} | ${result.entryCount} |`),
    "",
    "## Failing models",
    "",
    "| Model | Entries | Reason |",
    "| --- | --- | --- |",
    ...results
      .filter((result) => result.entryCount !== TOP_LOGPROBS_COUNT)
      .map((result) => `| ${result.model} | ${result.entryCount} | ${result.reason} |`),
    "",
  ];
  await fs.mkdir(path.join(root, "outputs", "probe"), { recursive: true });
  await fs.writeFile(
    path.join(root, "outputs", "probe", "report.md"),
    `${lines.join("\n")}\n`,
    "utf8",
  );
  process.stdout.write(`\nConfiguration file: ${CONFIG_FILE_NAME}\n`);
  process.stdout.write(`Passing model count: ${passed.length}\n`);
}

await main();
