// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * The tests of the OpenAI-compatible provider client.
 *
 * One local HTTP server stands in for a provider. The test checks the request shape, the parse of
 * both reply modes, and the report of an HTTP error.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { REQUEST_TEMPERATURE, createProviderClient } from "../lib/providers.js";

const credentialVariable = "LLM_SELF_PREDICTION_HTTP_TEST_KEY";
const recordedRequests = [];
let server;
let baseUrl;

before(async () => {
  process.env[credentialVariable] = "test-key";
  server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(text);
      recordedRequests.push({
        url: request.url,
        authorization: request.headers.authorization,
        contentType: request.headers["content-type"],
        body,
      });
      if (request.url !== "/v1/chat/completions") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }
      if (body["model"] === "reject-flash") {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "invalid api key" } }));
        return;
      }
      const payload = body["tools"] === undefined
        ? {
          choices: [{
            message: { content: "霜" },
            logprobs: {
              content: [{
                token: "霜",
                logprob: -0.4,
                top_logprobs: [
                  { token: "霜", logprob: -0.4 },
                  { token: "雪", logprob: -1.6 },
                  { token: " 霜", logprob: -3.1 },
                ],
              }],
            },
          }],
        }
        : {
          choices: [{
            message: {
              content: "",
              tool_calls: [{
                function: {
                  name: "submit_next_token_log_probabilities",
                  arguments: JSON.stringify({
                    entries: [
                      { token: "霜", logProbability: -0.5 },
                      { token: "雪", logProbability: -1.5 },
                    ],
                  }),
                },
              }],
            },
          }],
        };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

after(async () => {
  delete process.env[credentialVariable];
  await new Promise((resolve) => server.close(resolve));
});

/**
 * Build one provider definition that points at the local server.
 *
 * @param model - the model name.
 * @returns the definition.
 */
function createDefinition(model) {
  return {
    key: "local",
    label: "Local",
    baseUrl,
    model,
    apiKeyEnvironmentVariable: credentialVariable,
    enabled: true,
  };
}

/** One task fixture. */
const task = {
  id: "T900",
  category: "test",
  prefix: "床前明月光，疑是地上",
  referenceToken: "霜",
};

test("the client sends one logprobs request and parses the actual table", async () => {
  recordedRequests.length = 0;
  const client = createProviderClient(createDefinition("local-flash"));
  const controller = new AbortController();
  const answer = await client.predict(
    { mode: "actual", task, repetition: 1, topLogprobsCount: 64 },
    controller.signal,
  );

  assert.equal(recordedRequests.length, 1);
  const recorded = recordedRequests[0];
  assert.equal(recorded.url, "/v1/chat/completions");
  assert.equal(recorded.authorization, "Bearer test-key");
  assert.match(recorded.contentType, /application\/json/);
  assert.equal(recorded.body["model"], "local-flash");
  assert.equal(recorded.body["logprobs"], true);
  assert.equal(recorded.body["top_logprobs"], 64);
  assert.equal(recorded.body["max_tokens"], 1);
  assert.equal(recorded.body["temperature"], REQUEST_TEMPERATURE);
  assert.equal(recorded.body["temperature"], 0);
  assert.equal(recorded.body["tools"], undefined);
  assert.ok(recorded.body["messages"].length >= 1);

  assert.equal(answer.mode, "actual");
  assert.equal(answer.token, "霜");
  assert.equal(answer.distribution.supportSize, 2);
  assert.equal(answer.distribution.topToken, "霜");
  assert.ok(Math.abs(answer.distribution.totalProbability - 1) < 1e-9);
  assert.ok(answer.elapsedMilliseconds >= 0);
});

test("the client sends one forced tool call and parses the self table", async () => {
  recordedRequests.length = 0;
  const client = createProviderClient(createDefinition("local-flash"));
  const controller = new AbortController();
  const answer = await client.predict(
    { mode: "self", task, repetition: 2, topLogprobsCount: 64 },
    controller.signal,
  );

  const recorded = recordedRequests[0];
  assert.equal(recorded.body["temperature"], 0);
  assert.equal(recorded.body["tools"].length, 1);
  assert.equal(recorded.body["tools"][0].function.name, "submit_next_token_log_probabilities");
  assert.equal(recorded.body["tool_choice"].function.name, "submit_next_token_log_probabilities");
  assert.equal(answer.mode, "self");
  assert.equal(answer.token, "霜");
  assert.equal(answer.distribution.supportSize, 2);
});

test("the client reports an HTTP error with the response text", async () => {
  const client = createProviderClient(createDefinition("reject-flash"));
  const controller = new AbortController();
  await assert.rejects(
    client.predict({ mode: "actual", task, repetition: 1, topLogprobsCount: 64 }, controller.signal),
    (error) => {
      assert.equal(error.code, "PROVIDER_FAILURE");
      assert.match(error.message, /401/);
      assert.match(error.message, /invalid api key/);
      return true;
    },
  );
});
