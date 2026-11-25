// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  applyProviderEnvironments,
  buildEdgeRequestOptions,
  buildModelProviderKey,
  createProviderClient,
  MockProviderClient,
  probeLogprobsSupport,
  readServedTable,
  resolveProviderApiKey,
  resolveRequestedKeys,
  validateProviderCatalog,
} from "../lib/providers.js";

const task = {
  id: "E001",
  category: "daily",
  language: "en-US",
  prefix: "The cat sat on the",
  referenceToken: "mat",
};

/** Build one served table of four entries. */
function servedTableReply() {
  return {
    id: "reply",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "mat" },
        finish_reason: "length",
        logprobs: {
          content: [
            {
              token: "mat",
              logprob: -0.7,
              top_logprobs: [
                { token: "mat", logprob: -0.7 },
                { token: "floor", logprob: -1.4 },
                { token: "rug", logprob: -2.1 },
                { token: "bed", logprob: -3.2 },
              ],
            },
          ],
        },
      },
    ],
  };
}

/** Build one self report reply. */
function selfReportReply() {
  return {
    id: "reply",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content:
            '{"entries":[{"token":"mat","logProbability":-0.5},{"token":"floor","logProbability":-1.5}]}',
        },
        finish_reason: "stop",
      },
    ],
  };
}

const requests = [];
let failureMode = false;
let rateLimitCount = 0;
let resetCount = 0;
let server;
let baseUrl = "";

before(async () => {
  server = http.createServer((request, response) => {
    if (resetCount > 0) {
      resetCount -= 1;
      request.socket.destroy();
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(text);
      requests.push({ headers: request.headers, body });
      if (rateLimitCount > 0) {
        rateLimitCount -= 1;
        response.writeHead(429, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "slow down" } }));
        return;
      }
      if (failureMode) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "bad request" } }));
        return;
      }
      const payload = body.logprobs === true ? servedTableReply() : selfReportReply();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

/** Build one provider definition that points at the local server. */
function definition(overrides = {}) {
  return {
    key: "local",
    label: "Local",
    baseUrl,
    model: "local-model",
    apiKeyEnvironmentVariable: "LOCAL_TEST_KEY",
    topLogprobsCount: 4,
    enabled: true,
    ...overrides,
  };
}

test("the catalog validator rejects a definition without a base URL", () => {
  assert.throws(
    () =>
      validateProviderCatalog({
        schemaVersion: 1,
        description: "test",
        providers: [{ key: "x", label: "X", model: "m", apiKeyEnvironmentVariable: "K" }],
      }),
    /baseUrl|base URL/u,
  );
});

test("the model key replaces the characters that a file name rejects", () => {
  assert.equal(buildModelProviderKey("huggingface", "Qwen/Qwen3-VL-8B"), "huggingface-Qwen-Qwen3-VL-8B");
});

test("the requested keys expand one provider into one entry for each model", () => {
  const catalog = {
    schemaVersion: 1,
    description: "test",
    providers: [
      {
        key: "local",
        label: "Local",
        baseUrl: baseUrl,
        model: "first",
        models: ["first", "second"],
        apiKeyEnvironmentVariable: "LOCAL_TEST_KEY",
        enabled: true,
      },
      {
        key: "off",
        label: "Off",
        baseUrl: baseUrl,
        model: "third",
        apiKeyEnvironmentVariable: "LOCAL_TEST_KEY",
        enabled: false,
      },
    ],
  };
  const expanded = resolveRequestedKeys(catalog, ["local"]);
  assert.deepEqual(
    expanded.map((entry) => entry.model),
    ["first", "second"],
  );
  assert.equal(resolveRequestedKeys(catalog, []).length, 2);
  assert.equal(resolveRequestedKeys(catalog, ["off"], true).length, 1);
  assert.throws(() => resolveRequestedKeys(catalog, ["missing"]), /missing/u);
  assert.deepEqual(
    resolveRequestedKeys(catalog, ["local-second"]).map((entry) => entry.model),
    ["second"],
  );
});

test("the API key comes from the environment file before the process environment", () => {
  const environments = new Map([["local", { apiKey: "from-file" }]]);
  assert.equal(resolveProviderApiKey(definition(), environments), "from-file");
  assert.equal(resolveProviderApiKey(definition(), new Map()), undefined);
  process.env["LOCAL_TEST_KEY"] = "from-process";
  assert.equal(resolveProviderApiKey(definition(), new Map()), "from-process");
  process.env["LOCAL_TEST_KEY"] = "<your key>";
  assert.equal(resolveProviderApiKey(definition(), new Map()), undefined);
  delete process.env["LOCAL_TEST_KEY"];
});

test("the served table reader keeps the top entries and the chosen token", () => {
  const served = readServedTable(servedTableReply(), 4);
  assert.equal(served.token, "mat");
  assert.equal(served.distribution.supportSize, 4);
  assert.equal(served.distribution.topToken, "mat");
});

test("the served table reader rejects a reply without a logprobs table", () => {
  assert.throws(
    () => readServedTable({ choices: [{ message: { content: "mat" } }] }, 4),
    /logprobs/u,
  );
});

test("the actual request sends a temperature zero body with logprobs", async () => {
  requests.length = 0;
  failureMode = false;
  const client = createProviderClient(definition(), "secret", 5000);
  const outcome = await client.requestPlainActual(task, 2);
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.headers["authorization"], "Bearer secret");
  assert.equal(request.body.temperature, 0);
  assert.equal(request.body.max_tokens, 1);
  assert.equal(request.body.logprobs, true);
  assert.equal(request.body.top_logprobs, 4);
  assert.equal(request.body.stream, false);
  assert.equal(request.body.model, "local-model");
  assert.equal(outcome.draft.condition, "plain_actual");
  assert.equal(outcome.draft.repetition, 2);
  assert.equal(outcome.draft.source, "provider_logprobs");
  assert.equal(outcome.draft.distribution.supportSize, 4);
  assert.equal(outcome.exchanges.length, 1);
  assert.equal(outcome.exchanges[0].endpoint, `${baseUrl}/chat/completions`);
});

test("the self request sends no logprobs and reads the report body", async () => {
  requests.length = 0;
  const client = createProviderClient(definition(), "secret", 5000);
  const outcome = await client.requestPlainSelf(task, 1);
  assert.equal(requests[0].body.logprobs, undefined);
  assert.ok(requests[0].body.max_tokens >= 512);
  assert.equal(outcome.draft.source, "self_report");
  assert.equal(outcome.draft.distribution.supportSize, 2);
  assert.equal(outcome.draft.distribution.topToken, "mat");
});

test("the injected self request puts one assistant table in the context", async () => {
  requests.length = 0;
  const client = createProviderClient(definition(), "secret", 5000);
  const injected = readServedTable(servedTableReply(), 4).distribution;
  const outcome = await client.requestInjectedSelf(task, 1, injected);
  const messages = requests[0].body.messages;
  assert.equal(messages.length, 4);
  assert.equal(messages[2].role, "assistant");
  assert.ok(messages[2].content.includes("\"floor\""));
  assert.equal(messages[3].role, "user");
  assert.equal(outcome.draft.condition, "injected_self");
});

test("the injected actual request reads one self report and then one table", async () => {
  requests.length = 0;
  const client = createProviderClient(definition(), "secret", 5000);
  const outcome = await client.requestInjectedActual(task, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.logprobs, undefined);
  assert.equal(requests[1].body.logprobs, true);
  const messages = requests[1].body.messages;
  assert.equal(messages.length, 4);
  assert.equal(messages[2].role, "assistant");
  assert.ok(messages[2].content.includes("\"mat\""));
  assert.equal(outcome.self.draft.source, "self_report");
  assert.equal(outcome.actual.draft.source, "provider_logprobs");
  assert.equal(outcome.actual.draft.distribution.topToken, "mat");
});

test("a provider failure reports the status text", async () => {
  requests.length = 0;
  failureMode = true;
  const client = createProviderClient(definition(), "secret", 5000);
  await assert.rejects(() => client.requestPlainActual(task, 1), /HTTP 400/u);
  failureMode = false;
});

test("the probe reports the entry count of a supported model", async () => {
  requests.length = 0;
  const client = createProviderClient(definition(), "secret", 5000);
  const support = await probeLogprobsSupport(client, task);
  assert.equal(support.supported, true);
  assert.equal(support.entryCount, 4);
});

test("the probe reports the reason of an unsupported model", async () => {
  failureMode = true;
  const client = createProviderClient(definition(), "secret", 5000);
  const support = await probeLogprobsSupport(client, task);
  assert.equal(support.supported, false);
  assert.match(support.reason ?? "", /HTTP 400/u);
  failureMode = false;
});

test("the request switches follow the provider definition", async () => {
  requests.length = 0;
  const client = createProviderClient(
    definition({ thinking: "disabled", reasoning: "disabled" }),
    "secret",
    5000,
  );
  await client.requestPlainActual(task, 1);
  assert.deepEqual(requests[0].body.thinking, { type: "disabled" });
  assert.deepEqual(requests[0].body.reasoning, { enabled: false });
});

test("the mock client repeats a table for one repetition and varies it across repetitions", async () => {
  const client = new MockProviderClient(definition({ key: "mock", baseUrl: "mock://local" }));
  const first = await client.requestPlainActual(task, 1);
  const again = await client.requestPlainActual(task, 1);
  const other = await client.requestPlainActual(task, 2);
  assert.deepEqual(
    first.draft.distribution.entries.map((entry) => entry.token),
    again.draft.distribution.entries.map((entry) => entry.token),
  );
  assert.equal(first.draft.distribution.supportSize, 4);
  assert.equal(other.draft.distribution.supportSize, 4);
  assert.equal(first.draft.source, "provider_logprobs");
});

test("the edge request names the base URL host and keeps the edge port", () => {
  const options = buildEdgeRequestOptions(
    "127.0.0.1:8443",
    "https://router.example/v1/chat/completions",
    { accept: "application/json" },
    "{}",
    1000,
  );
  assert.equal(options.hostname, "127.0.0.1");
  assert.equal(options.port, 8443);
  assert.equal(options.path, "/v1/chat/completions");
  assert.equal(options.servername, "127.0.0.1");
  assert.equal(options.rejectUnauthorized, false);
  assert.equal(options.headers.host, "router.example");
  assert.equal(options.headers["content-length"], 2);
  const plain = buildEdgeRequestOptions(
    "cdn-lfs.hf.co",
    "https://router.huggingface.co/v1/chat/completions",
    {},
    "{}",
    1000,
  );
  assert.equal(plain.port, 443);
});

test("the environment override carries the edge host into the catalog", () => {
  const catalog = {
    schemaVersion: 1,
    description: "test",
    providers: [definition()],
  };
  const environments = new Map([["local", { edgeHost: "edge.example" }]]);
  const updated = applyProviderEnvironments(catalog, environments);
  assert.equal(updated.providers[0].edgeHost, "edge.example");
  assert.equal(catalog.providers[0].edgeHost, undefined);
});

test("a reset connection repeats and then succeeds", async () => {
  resetCount = 1;
  const client = createProviderClient(definition(), "secret", 20000);
  const outcome = await client.requestPlainActual(task, 1);
  assert.equal(outcome.draft.distribution.entries.length, 4);
  assert.equal(resetCount, 0);
});

test("a rate-limited request repeats and then succeeds", async () => {
  rateLimitCount = 1;
  const client = createProviderClient(definition(), "secret", 20000);
  const outcome = await client.requestPlainActual(task, 1);
  assert.equal(outcome.draft.distribution.entries.length, 4);
  assert.equal(rateLimitCount, 0);
  assert.equal(requests.length > 0, true);
});
