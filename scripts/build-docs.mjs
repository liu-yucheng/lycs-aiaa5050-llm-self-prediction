// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * Build the static documentation of the plugin.
 *
 * The script writes `docs/index.html`, `docs/design.html`, `docs/protocol.html`,
 * `docs/measures.html`, `docs/reference.html`, `docs/reproducibility.html`, and `docs/DETAIL.md`.
 * Run `npm run build` first, because the script reads the plugin name and the plugin version from
 * the built constants module.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PLUGIN_NAME, PLUGIN_VERSION } from "../lib/constants.js";

/** The repository root. */
const root = path.resolve(import.meta.dirname, "..");

/** The documentation directory. */
const docsDirectory = path.join(root, "docs");

/** The navigation entries in page order. */
const NAVIGATION = [
  ["index.html", "Overview"],
  ["design.html", "Design"],
  ["protocol.html", "Protocol"],
  ["measures.html", "Measures"],
  ["reference.html", "Reference"],
  ["reproducibility.html", "Reproducibility"],
  ["results.html", "Results"],
];

/**
 * Escape one text for HTML.
 *
 * @param text - the text.
 * @returns the escaped text.
 */
function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Build one paragraph.
 *
 * @param text - the sentence text.
 * @returns the HTML.
 */
function paragraph(text) {
  return `<p>${text}</p>`;
}

/**
 * Build one section with a level-two heading.
 *
 * @param heading - the heading text.
 * @param body - the HTML body.
 * @returns the HTML.
 */
function section(heading, body) {
  return `<h2>${heading}</h2>\n${body}`;
}

/**
 * Build one unordered list.
 *
 * @param items - the item texts.
 * @returns the HTML.
 */
function list(items) {
  const lines = items.map((item) => `    <li>${item}</li>`).join("\n");
  return `<ul>\n${lines}\n  </ul>`;
}

/**
 * Build one table.
 *
 * @param head - the header cells.
 * @param rows - the body rows.
 * @returns the HTML.
 */
function table(head, rows) {
  const header = `      <tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr>`;
  const body = rows
    .map((row) => `      <tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("\n");
  return [
    "  <table>",
    "    <thead>",
    header,
    "    </thead>",
    "    <tbody>",
    body,
    "    </tbody>",
    "  </table>",
  ].join("\n");
}

/**
 * Build one code block.
 *
 * @param text - the code text.
 * @returns the HTML.
 */
function code(text) {
  return `  <pre><code>${escapeHtml(text)}</code></pre>`;
}

/**
 * Build one callout box.
 *
 * @param text - the text.
 * @returns the HTML.
 */
function callout(text) {
  return `  <div class="callout">\n    ${paragraph(text)}\n  </div>`;
}

/**
 * Build one fact list.
 *
 * @param entries - the term and description pairs.
 * @returns the HTML.
 */
function facts(entries) {
  const lines = entries
    .map(([term, description]) => `    <dt>${term}</dt><dd>${description}</dd>`)
    .join("\n");
  return `  <dl class="facts">\n${lines}\n  </dl>`;
}

/**
 * Build one card list.
 *
 * @param entries - the target, title, and description triples.
 * @returns the HTML.
 */
function cards(entries) {
  const lines = entries
    .map(
      ([href, title, description]) =>
        `    <a class="card" href="${href}">\n      <strong>${title}</strong>\n` +
        `      <span>${description}</span>\n    </a>`,
    )
    .join("\n");
  return `  <div class="cards">\n${lines}\n  </div>`;
}

/**
 * Build one page.
 *
 * @param options - the page name, title, description, and body.
 * @returns the HTML document.
 */
function renderPage(options) {
  const navigation = NAVIGATION.map(([href, label]) => {
    const current = href === options.name ? ' aria-current="page"' : "";
    return `      <a href="${href}"${current}>${label}</a>`;
  }).join("\n");
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${options.title} — plugin documentation</title>`,
    `<meta name="description" content="${options.description}">`,
    '<link rel="stylesheet" href="assets/site.css">',
    "</head>",
    "<body>",
    '<header class="site-header">',
    '  <div class="inner">',
    `    <div class="brand">Next-token self-prediction<small>${PLUGIN_NAME} ${PLUGIN_VERSION}</small></div>`,
    '    <nav class="site-nav" aria-label="Documentation">',
    navigation,
    "    </nav>",
    "  </div>",
    "</header>",
    "",
    "<main>",
    `  <h1>${options.heading}</h1>`,
    options.body,
    "</main>",
    "",
    "<footer>",
    `  <p class="muted">${PLUGIN_NAME} ${PLUGIN_VERSION}. Released under the GNU AGPL 3.0 License.`,
    "    The plugin records one run per directory and never edits a raw reply.</p>",
    "</footer>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** The body of the overview page. */
const overviewBody = [
  '  <p class="lede">A DeepSeek Harness plugin that measures how far the next-token table of a',
  "    language model stands from the table that the same model reports about itself.</p>",
  callout(
    "<strong>The question.</strong> A model reads a sentence prefix. The provider reports the top " +
      "20 next-token choices. Does the model know that table? The plugin asks the model to write " +
      "the table, compares the two tables, and repeats the comparison under two injections.",
  ),
  facts([
    [
      "Dataset",
      "32 Simplified Chinese and 32 US English tasks in 8 categories in <code>inputs/testing-dataset/</code>",
    ],
    [
      "Providers",
      "Hugging Face router models, OpenAI chat models, and a deterministic mock provider",
    ],
    ["Conditions", "actual, self, actual then actual, and actual then self; 8 repetitions each"],
    ["Comparisons", "3: self, actual then self, and actual then actual against the actual table"],
    ["Verdict", "Bootstrap interval of the mean symmetric KL against a tolerance of 0.05 nats"],
    ["Hypothesis test", "One-sided Wilcoxon signed-rank test of the median divergence, alpha 0.05"],
  ]),
  section(
    "Why four conditions",
    list([
      "The actual table is the ground truth, because the provider computes it and the model does not write it.",
      "The self table shows what the model says when it must state its own prediction.",
      "The actual-then-self table shows whether the true table moves the self report toward the truth.",
      "The actual-then-actual table is the control. The model reads the table, reads the table again, " +
        "and any divergence is the noise of the reading, not a self report.",
    ]),
  ),
  section(
    "What one run writes",
    list([
      "<code>outputs/&lt;xid&gt;/intermediate/</code> holds every raw exchange, one file for each call.",
      "<code>outputs/&lt;xid&gt;/results/</code> holds the metrics, the records, the report, and the tables.",
      "<code>outputs/&lt;xid&gt;/demos/</code> holds the static bilingual demonstration website.",
      "<code>outputs/&lt;xid&gt;/revision.json</code> holds one entry for each revise pass of the folder.",
      "<code>node lib/cli.js demos [&lt;xid&gt;]</code> writes that website again from the current templates.",
    ]),
  ),
  section(
    "One folder for one run",
    list([
      "A run reads one output folder and writes only that folder.",
      "A run that names an existing folder revises it. The pass keeps every raw table that the " +
        "current protocol reads, requests the absent tables, and removes each raw file that the " +
        "current protocol does not read.",
      "<code>node lib/cli.js rename --session=&lt;xid&gt;</code> moves the folder to a fresh " +
        "identifier, and the manifest keeps the old identifier.",
    ]),
  ),
  section(
    "Install and first run",
    code(
      [
        "# register the package directory as a bundle",
        "plugin_manager install_bundle target=<absolute path of this package>",
        "",
        "# a dry run needs no credential and no network",
        "node lib/cli.js run --dry-run --tasks=Z001,E001 --repetitions=1",
        "",
        "# a real run reads the key from .env",
        "node lib/cli.js env",
        "node lib/cli.js run --folder=<name> --repetitions=8",
        "",
        "# a revise pass of the same folder, then a new identifier",
        "node lib/cli.js run --folder=<name> --repetitions=8",
        "node lib/cli.js rename --session=<name>",
      ].join("\n"),
    ),
  ),
  section(
    "The six tools",
    table(
      ["Tool", "Purpose"],
      [
        ["<code>llm_self_prediction_run</code>", "Run or revise one folder and write the session files."],
        ["<code>llm_self_prediction_status</code>", "List the recent sessions with their verdicts."],
        ["<code>llm_self_prediction_report</code>", "Read the Markdown report of one session."],
        ["<code>llm_self_prediction_rename</code>", "Move one folder to a fresh identifier."],
        ["<code>llm_self_prediction_dataset</code>", "Summarize the two dataset files."],
        ["<code>llm_self_prediction_help</code>", "Explain the protocol and the provider setup."],
      ],
    ),
  ),
  section(
    "Read next",
    cards([
      ["design.html", "Design", "Hypotheses, run flow, dataset rules, and pairing."],
      ["protocol.html", "Protocol", "Requests, prompts, injections, and reply rules."],
      ["measures.html", "Measures", "Alignment, KL, JS, TV, coverage, bootstrap, and verdict."],
      ["reference.html", "Reference", "Tool arguments, command line, settings, and output layout."],
      ["reproducibility.html", "Reproducibility", "Recorded versions, integrity rules, and tests."],
      ["DETAIL.md", "Design note", "The Markdown source of the plugin detail page."],
    ]),
  ),
].join("\n\n");

/** The body of the design page. */
const designBody = [
  '  <p class="lede">The research question, the two hypotheses, the four conditions, and the rules',
  "    that keep the comparison honest.</p>",
  section(
    "The hypotheses",
    [
      paragraph(
        "<strong>The null hypothesis.</strong> The self report agrees with the served table. The " +
          "divergence is near zero, and self-prediction is an emergent property of next-token training.",
      ),
      paragraph(
        "<strong>The alternative hypothesis.</strong> The divergence is significantly larger than " +
          "zero. The model predicts text well and its own table badly.",
      ),
      paragraph(
        "A verdict never proves either hypothesis. It states whether the observed sample supports " +
          "a difference that is larger than the tolerance.",
      ),
    ].join("\n  "),
  ),
  section(
    "The four conditions",
    table(
      ["Condition", "Context", "Table origin"],
      [
        ["<code>actual</code>", "The task prompt.", "The provider logprobs of one served token."],
        ["<code>self</code>", "The task prompt.", "The JSON table in the reply body."],
        [
          "<code>actual_injected_actual</code>",
          "The task prompt, then one assistant message with the served table, then the task prompt again.",
          "The provider logprobs of the second read. This condition is the control.",
        ],
        [
          "<code>actual_injected_self</code>",
          "The task prompt, then one assistant message with the served table, then one request for " +
            "the own table.",
          "The JSON table in the second reply body.",
        ],
      ],
    ),
  ),
  section(
    "The repetitions",
    [
      paragraph(
        "Each condition runs eight times for each task. The temperature is zero, so the served " +
          "table of one model changes little across repetitions, while a self report can change a " +
          "lot. Both kinds of repetition appear in the comparison.",
      ),
      paragraph(
        "One comparison pairs each actual repetition with each predicted repetition. Eight " +
          "repetitions give sixty-four pairs for each task and each comparison.",
      ),
    ].join("\n  "),
  ),
  section(
    "The dataset",
    [
      paragraph(
        "The dataset holds two files in <code>inputs/testing-dataset/</code>. One file holds 32 " +
          "Simplified Chinese tasks. The other file holds 32 US English tasks. Each file spreads " +
          "its tasks over eight categories: poetry, idiom, daily, food, weather, technology, news, " +
          "and story.",
      ),
      paragraph(
        "A task holds an identifier, a category, a language, a sentence prefix, and a reference " +
          "token. The reference token is the token that a human writer would choose next. The " +
          "plugin validates the dataset and rejects a prefix that already ends with its reference " +
          "token. No metric reads the reference token, so a wrong completion cannot flatter or " +
          "spoil a divergence.",
      ),
    ].join("\n  "),
  ),
  section(
    "The run flow",
    list([
      "Read the workspace, the dataset, the environment file, and the provider catalog.",
      "Expand each provider that lists several models into one client for each model.",
      "Resolve the API key of each client and stop with a prompt when a key is absent.",
      "Probe each client with one served table and leave out a model that reports no table.",
      "Create the run directory and write <code>run.json</code> and <code>tasks.json</code>.",
      "Run one job for each task and client pair, with a bounded worker pool.",
      "Write the raw exchange of each call before the plugin parses the reply.",
      "Compute the three comparisons, the summaries, and the bootstrap intervals.",
      "Write the metrics, the records, the report, the tables, and the demonstration website.",
    ]),
  ),
  section(
    "The integrity rules",
    list([
      "The plugin never edits a raw reply. The parse result lives in a separate file.",
      "The plugin never changes a prompt or a dataset task to make a metric pass.",
      "The plugin records the plugin version, the Node.js version, the platform, and the seed.",
      "A failed call becomes one failure line in the task record, and the run continues.",
    ]),
  ),
].join("\n\n");

/** The body of the protocol page. */
const protocolBody = [
  '  <p class="lede">The exact request bodies, the prompt rules, the injections, and the reply',
  "    parsing rules.</p>",
  section(
    "The actual request",
    [
      paragraph(
        "The plugin sends one system message and one user message, with <code>temperature: 0</code>, " +
          "<code>max_tokens: 1</code>, <code>logprobs: true</code>, and " +
          "<code>top_logprobs: 20</code>. The provider returns the top 20 entries of the first " +
          "generated token. An endpoint that denies a field changes the body. The OpenAI provider " +
          "omits the temperature, names the budget with <code>max_completion_tokens</code>, raises " +
          "the budget to 16 tokens, and lowers <code>top_logprobs</code> to 5 when the endpoint " +
          "denies 20.",
      ),
      code(
        [
          "POST <base_url>/chat/completions",
          "{",
          '  "model": "<model>",',
          '  "messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}],',
          '  "temperature": 0,',
          '  "max_tokens": 1,',
          '  "logprobs": true,',
          '  "top_logprobs": 20,',
          '  "stream": false',
          "}",
        ].join("\n"),
      ),
    ].join("\n  "),
  ),
  section(
    "The self request",
    [
      paragraph(
        "The self request asks the model to write the table itself. The request sets " +
          "<code>max_tokens: 2048</code> and no <code>logprobs</code> field. The reply must hold one " +
          "JSON object with an entry list, where each entry gives a token and a log probability.",
      ),
      code(
        [
          '{"entries":[{"token":"霜","logProbability":-0.42},',
          '            {"token":"光","logProbability":-1.05}]}',
        ].join("\n"),
      ),
      paragraph(
        "The prompt describes the tokenize cut. A tokenizer can split one word into several " +
          "tokens. The prompt asks the model to list the leading pieces as separate entries and to " +
          "give the rest of the mass to the whole word.",
      ),
    ].join("\n  "),
  ),
  section(
    "The two injected conditions",
    [
      paragraph(
        "<strong>Actual then self.</strong> The plugin sends the task prompt, then one assistant " +
          "message that holds the served table of the same repetition, then one user message that " +
          "asks for the own table. The second table is the measurement.",
      ),
      paragraph(
        "<strong>Actual then actual.</strong> The plugin sends the task prompt, then one assistant " +
          "message that holds the served table of the same repetition, then the task prompt again. " +
          "The served table of the second read is the measurement. The first read of the pair is " +
          "the <code>actual</code> table of the same repetition, so the folder needs no extra call.",
      ),
      paragraph(
        "The condition that reads the table twice is the control. It shows how far one reading " +
          "stands from another reading of the same model and the same prefix. A divergence that " +
          "stays near that level is not evidence of a self report.",
      ),
      paragraph(
        "The plugin writes a marker file for the reused first read, so a reader can tell a reused " +
          "table from a fresh call. The marker holds no table.",
      ),
    ].join("\n  "),
  ),
  section(
    "The reply rules",
    table(
      ["Reply", "Rule"],
      [
        ["Served table", "Read <code>choices[0].logprobs.content[0].top_logprobs</code>."],
        ["Self report", "Read the first balanced JSON object or array in the message body."],
        ["Token names", "Apply NFKC and trim the token. Drop an empty token."],
        ["Duplicates", "Add the probabilities of two entries that name the same token."],
        ["Missing entry", "Use the probability floor of 1e-12 and renormalize the table."],
        ["Slow reply", "Add one warning when a call takes more than 10 seconds."],
      ],
    ),
  ),
  section(
    "The provider switches",
    list([
      "<code>thinking: disabled</code> sends <code>{\"thinking\": {\"type\": \"disabled\"}}</code>," +
        " which the DeepSeek endpoint reads.",
      "<code>reasoning: disabled</code> sends <code>{\"reasoning\": {\"enabled\": false}}</code>," +
        " which the Hugging Face router reads.",
      "A model that reports one entry only is left out, and the run records one warning.",
    ]),
  ),
].join("\n\n");

/** The body of the measures page. */
const measuresBody = [
  '  <p class="lede">The three comparisons, the alignment rule, the divergence measures, and the',
  "    verdict rule.</p>",
  section(
    "The three comparisons",
    table(
      ["Comparison", "Actual side", "Predicted side"],
      [
        ["<code>self</code>", "<code>actual</code>", "<code>self</code>"],
        ["<code>actual_injected_self</code>", "<code>actual</code>", "<code>actual_injected_self</code>"],
        [
          "<code>actual_injected_actual</code>",
          "<code>actual</code>",
          "<code>actual_injected_actual</code>",
        ],
      ],
    ),
  ),
  section(
    "The hypothesis test",
    [
      paragraph(
        "The bootstrap interval states the uncertainty of the mean. The hypothesis test states " +
          "the evidence against the null hypothesis. The plugin runs one one-sided Wilcoxon " +
          "signed-rank test for each comparison. The sample is the per-task median symmetric KL, " +
          "the null value is the tolerance of 0.05 nats, and the alternative states that the " +
          "median stands above the null value.",
      ),
      paragraph(
        "The test uses the normal approximation with a tie correction, and it drops every zero " +
          "difference. A comparison rejects the null hypothesis when its p-value is below alpha, " +
          "which is 0.05 by default.",
      ),
      paragraph(
        "The session holds the alternative hypothesis only when every comparison rejects the null " +
          "and every median stands above the tolerance. The session holds the null hypothesis when " +
          "no comparison rejects the null. A mixed result means that one comparison rejects and " +
          "another one does not.",
      ),
    ].join("\n  "),
  ),
  section(
    "The alignment",
    [
      paragraph(
        "Two tables rarely share one token set. The plugin builds the union of both token sets. A " +
          "token that one table omits receives the probability floor of 1e-12, and each side is " +
          "renormalized after the floor. The floor keeps the divergence finite and gives one " +
          "missing token a large but bounded cost.",
      ),
      paragraph(
        "The alignment reports the union size and the coverage of each side, so a reader can tell " +
          "a real disagreement from a narrow table.",
      ),
    ].join("\n  "),
  ),
  section(
    "The measures",
    table(
      ["Measure", "Definition"],
      [
        ["<code>klActualPredicted</code>", "The divergence from the actual table to the predicted table, in nats."],
        ["<code>klPredictedActual</code>", "The divergence from the predicted table to the actual table, in nats."],
        ["<code>symmetricKl</code>", "The mean of the two directed divergences. This measure carries the verdict."],
        ["<code>jensenShannon</code>", "The bounded divergence against the mean table, in nats."],
        ["<code>totalVariation</code>", "One half of the L1 distance between the two tables."],
        ["<code>topTokenAgreement</code>", "True when both tables name the same most likely token."],
      ],
    ),
  ),
  section(
    "The verdict",
    [
      paragraph(
        "The plugin computes the mean symmetric divergence of each task, then one bootstrap " +
          "interval of that mean with 2000 resamples and a fixed seed. The interval states how much " +
          "the task sample supports.",
      ),
      table(
        ["Interval against the tolerance", "Verdict"],
        [
          ["The upper bound is below the tolerance.", "<code>indistinguishable</code>"],
          ["The lower bound is above the tolerance.", "<code>separated</code>"],
          ["The interval covers the tolerance.", "<code>inconclusive</code>"],
          ["The comparison holds no pair.", "<code>inconclusive</code>"],
        ],
      ),
      paragraph(
        "The default tolerance is 0.05 nats. One nat is a factor of e in probability, so the " +
          "tolerance asks whether the two tables differ by more than about five percent in the " +
          "exponential sense.",
      ),
    ].join("\n  "),
  ),
  section(
    "The warning about repetition noise",
    paragraph(
      "A self report varies across repetitions, and a served table can also vary at temperature " +
        "zero. The interval covers the task sample, not the provider noise. A reader must compare " +
        "the interval with the spread of the repetitions before the reader calls a small " +
        "divergence a real one.",
    ),
  ),
].join("\n\n");

/** The body of the reference page. */
const referenceBody = [
  '  <p class="lede">The tool arguments, the command line, the settings, the environment keys, and',
  "    the output layout.</p>",
  section(
    "The tool arguments",
    table(
      ["Argument", "Type", "Meaning"],
      [
        ["<code>providers</code>", "string array", "Provider keys or model keys. Empty selects every enabled model."],
        ["<code>tasks</code>", "string array", "Task identifiers in the selected order. Empty selects every task."],
        ["<code>repetitions</code>", "integer 1 to 16", "The repetition count of each condition. Default 8."],
        ["<code>toleranceNats</code>", "number", "The verdict tolerance in nats. Default 0.05."],
        ["<code>alpha</code>", "number 1e-6 to 0.5", "The alpha level of the hypothesis test. Default 0.05."],
        ["<code>outputDirectory</code>", "string", "The output root. Empty uses the plugin setting."],
        ["<code>folder</code>", "string", "The one output folder. An existing folder is revised."],
        ["<code>renameFolder</code>", "boolean", "Move the folder to a fresh identifier at the end."],
        ["<code>seed</code>", "integer", "The bootstrap seed. Default 20260815."],
        ["<code>maxConcurrency</code>", "integer 1 to 16", "The number of tasks that run at the same time."],
        ["<code>topLogprobsCount</code>", "integer 2 to 64", "The requested table size. Default 20."],
        ["<code>dryRun</code>", "boolean", "Use the mock provider and no network."],
      ],
    ),
  ),
  section(
    "The command line",
    code(
      [
        "node lib/cli.js run [options]",
        "node lib/cli.js status [--limit=5]",
        "node lib/cli.js report [--session=<xid>]",
        "node lib/cli.js demos [--session=<xid>]",
        "node lib/cli.js rename --session=<xid>",
        "node lib/cli.js dataset [--sample=8]",
        "node lib/cli.js env",
        "node lib/cli.js help",
        "",
        "# run options",
        "--providers=<keys> --tasks=<ids> --repetitions=<n> --tolerance=<nats> --alpha=<level>",
        "--folder=<name> --rename-folder --output=<directory> --seed=<n> --concurrency=<n>",
        "--entries=<n> --dry-run",
      ].join("\n"),
    ),
  ),
  section(
    "The plugin settings",
    table(
      ["Setting", "Type", "Meaning"],
      [
        ["<code>outputRoot</code>", "string", "The output root. Empty uses <code>outputs/</code> in the workspace."],
        ["<code>maxConcurrency</code>", "integer 1 to 16", "The default worker count of one run."],
      ],
    ),
  ),
  section(
    "The environment keys",
    paragraph(
      "The private file <code>.env</code> holds only <code>repo_url</code>, <code>base_url</code>, " +
        "and <code>api_key</code>. The public file <code>.env.example</code> lists the same keys. " +
        "The public file <code>configs.env</code> holds every other setting, such as the model " +
        "list and the switches. A placeholder in angle brackets counts as an absent key. The " +
        "reader reports a key outside the private set in <code>.env</code> and applies only the " +
        "<code>configs.env</code> value.",
    ),
    table(
      ["Private key", "Meaning"],
      [
        [
          "<code>&lt;section&gt;.repo_url</code>",
          "The optional code repository of the section. The plugin accepts the key and calls no repository.",
        ],
        ["<code>&lt;section&gt;.base_url</code>", "The endpoint that serves the OpenAI-compatible chat route."],
        ["<code>&lt;section&gt;.api_key</code>", "The API key of the section."],
      ],
    ),
    table(
      ["Configuration key", "Meaning"],
      [
        ["<code>&lt;section&gt;.model_to_use</code>", "One model name."],
        ["<code>&lt;section&gt;.models_to_use</code>", "A comma-separated model list that replaces the catalog list."],
        ["<code>&lt;section&gt;.top_logprobs</code>", "The requested table size."],
        [
          "<code>&lt;section&gt;.edge_host</code>",
          "The host name of one permitted edge, when the network blocks the base URL host.",
        ],
        ["<code>&lt;section&gt;.thinking</code>", "<code>disabled</code> turns the thinking mode off."],
        ["<code>&lt;section&gt;.reasoning</code>", "<code>disabled</code> turns the reasoning mode off."],
      ],
    ),
  ),
  section(
    "The output layout",
    code(
      [
        "outputs/<xid>/",
        "  run.json                     the manifest: status, options, providers, versions",
        "  revision.json                one record for each revise pass of the folder",
        "  tasks.json                   the selected tasks",
        "  intermediate/<providerKey>/<taskId>/<condition>-r<n>-call<k>.json",
        "  results/metrics.json         the three comparisons, the summaries, the tests, the verdicts",
        "  results/records.json         one task record for each task and model",
        "  results/records/<providerKey>/<taskId>.json",
        "  results/report.md            the Markdown report",
        "  results/summary.csv          one row for each provider and comparison",
        "  results/tasks.csv            one row for each task and comparison",
        "  results/environment.json     the recorded versions and the elapsed time",
        "  results/task-summary.json    the compact table that the explorer reads",
        "  demos/index.html             the demonstration website",
        "  demos/assets/                the style sheet, the script, and the data files",
      ].join("\n"),
    ),
  ),
  section(
    "The failure modes",
    table(
      ["Code", "Cause"],
      [
        ["<code>INVALID_ARGUMENT</code>", "An argument is absent, malformed, or names an unknown task."],
        ["<code>INVALID_DATASET</code>", "A dataset file breaks a validation rule."],
        ["<code>INVALID_PROVIDER</code>", "The catalog holds no such provider, or no model reports a table."],
        ["<code>MISSING_CREDENTIAL</code>", "No API key is available for a selected provider."],
        ["<code>PROVIDER_FAILURE</code>", "The endpoint returned an error status or no JSON body."],
        ["<code>INVALID_RESPONSE</code>", "The reply holds no usable table."],
        ["<code>MISSING_SESSION</code>", "The requested run or report is absent."],
      ],
    ),
  ),
].join("\n\n");

/** The body of the reproducibility page. */
const reproducibilityBody = [
  '  <p class="lede">The recorded versions, the seed rule, the integrity rules, the tests, and the',
  "    known limits.</p>",
  section(
    "The recorded versions",
    paragraph(
      "Each run writes <code>results/environment.json</code> and repeats the record in " +
        "<code>run.json</code>. The record holds the plugin name, the plugin version, the Node.js " +
        "version, the platform, the random seed, the start time, the end time, and the elapsed " +
        "time. A reader can rebuild the run only when the reader knows these values.",
    ),
  ),
  section(
    "The seed rule",
    paragraph(
      "The default random seed is 20260815. The seed drives the bootstrap resampling only. The " +
        "requests use <code>temperature: 0</code>, and the plugin never samples a reply itself, so " +
        "the provider decides every remaining variation.",
    ),
  ),
  section(
    "The integrity rules",
    list([
      "The plugin writes each raw exchange before the plugin parses the reply.",
      "The plugin keeps the raw reply and the parse result in separate files.",
      "The plugin never rewrites a raw file.",
      "The plugin never changes a task, a prompt, or a parsing rule to make a metric pass.",
      "The plugin records a failure in the task record and continues the run.",
      "The plugin repeats a request after HTTP 429, HTTP 5xx, or a temporary network fault, at most "
        + "four attempts with a growing delay. A model that fails all attempts adds one error line.",

      "A report states only what the output files support.",
    ]),
  ),
  section(
    "The tests",
    paragraph(
      "The test suite runs with <code>npm test</code>. It covers the dataset validation, the " +
        "probability normalizer, the divergence measures, the pairing, the bootstrap, the verdict " +
        "rule, the prompt builders, the reply parser, the request bodies against a local HTTP " +
        "server, the run directory layout, the tool definitions, the environment file, and the " +
        "plugin entry point.",
    ),
  ),
  section(
    "The known limits",
    list([
      "The self report is text, so a model can break the JSON rule or write a table that does not sum to one.",
      "A provider can return fewer entries than the request asks for, and the plugin cannot add an entry.",
      "The divergence of two tables with different supports depends on the probability floor.",
      "One run measures one model version at one time. A provider update can move the numbers.",
      "The interview of one model does not show the behavior of another model.",
    ]),
  ),
  section(
    "How to reproduce a reported run",
    code(
      [
        "npm ci",
        "npm run build",
        "npm test",
        "node lib/cli.js env",
        "node lib/cli.js run --providers=<keys> --repetitions=3 --seed=20260815",
        "node lib/cli.js report --session=<xid>",
      ].join("\n"),
    ),
  ),
].join("\n\n");

/** The pages in file order. */
const PAGES = [
  {
    name: "index.html",
    title: "Overview",
    heading: "Does a model know its own next token?",
    description: "Overview of the plugin lycs-aiaa5050-llm-self-prediction.",
    body: overviewBody,
  },
  {
    name: "design.html",
    title: "Design",
    heading: "Design of the experiment",
    description: "The hypotheses, the four conditions, the dataset, and the run flow.",
    body: designBody,
  },
  {
    name: "protocol.html",
    title: "Protocol",
    heading: "Protocol of one run",
    description: "The request bodies, the prompts, the injections, and the reply rules.",
    body: protocolBody,
  },
  {
    name: "measures.html",
    title: "Measures",
    heading: "Measures and verdict",
    description: "The comparison rule, the divergence measures, the bootstrap, and the verdict.",
    body: measuresBody,
  },
  {
    name: "reference.html",
    title: "Reference",
    heading: "Reference",
    description: "Tool arguments, command line, settings, environment keys, and output layout.",
    body: referenceBody,
  },
  {
    name: "reproducibility.html",
    title: "Reproducibility",
    heading: "Reproducibility and limits",
    description: "Recorded versions, the seed rule, the integrity rules, and the known limits.",
    body: reproducibilityBody,
  },
];

/** The Markdown design note. */
const detailMarkdown = [
  `# ${PLUGIN_NAME} ${PLUGIN_VERSION}`,
  "",
  "A DeepSeek Harness plugin for the experiment \"Can LLMs predict their own next token",
  "predictions?\". The plugin asks one model for one next-token table, asks the same model to",
  "report that table, and measures the distance between the two tables under two injections.",
  "One run works on one output folder, and a second run on the same folder revises it.",
  "",
  "## Research question",
  "",
  "A next-token model computes a probability for each token of its vocabulary at each position.",
  "The provider can report the top entries of that table. Can the model report the same table when",
  "a person asks the model in words?",
  "",
  "## Hypotheses",
  "",
  "- Null hypothesis: the self report agrees with the served table, and the divergence is near zero.",
  "  Self-prediction is then an emergent property of next-token training.",
  "- Alternative hypothesis: the divergence is larger than the tolerance. The model predicts text",
  "  well and its own table badly.",
  "",
  "## Conditions",
  "",
  "| Condition | Context | Table origin |",
  "| --- | --- | --- |",
  "| `actual` | The task prompt. | The provider logprobs of one served token. |",
  "| `self` | The task prompt. | The JSON table in the reply body. |",
  "| `actual_injected_actual` | Task prompt, then an assistant message with the served table," +
    " then the task prompt again. | The provider logprobs of the second read. This condition is" +
    " the control. |",
  "| `actual_injected_self` | Task prompt, then an assistant message with the served table," +
    " then one request for the own table. | The JSON table in the second reply. |",
  "",
  "Each condition runs eight times for each task at `temperature: 0`.",
  "",
  "## Comparisons",
  "",
  "| Comparison | Actual side | Predicted side |",
  "| --- | --- | --- |",
  "| `self` | `actual` | `self` |",
  "| `actual_injected_self` | `actual` | `actual_injected_self` |",
  "| `actual_injected_actual` | `actual` | `actual_injected_actual` |",
  "",
  "One comparison pairs each actual repetition with each predicted repetition, so eight",
  "repetitions give sixty-four pairs for each task and comparison.",
  "",
  "## Measures",
  "",
  "- `klActualPredicted`: the divergence from the actual table to the predicted table, in nats.",
  "- `klPredictedActual`: the divergence from the predicted table to the actual table, in nats.",
  "- `symmetricKl`: the mean of the two directed divergences. This measure carries the verdict.",
  "- `jensenShannon`: the bounded divergence against the mean table, in nats.",
  "- `totalVariation`: one half of the L1 distance between the two tables.",
  "- `topTokenAgreement`: true when both tables name the same most likely token.",
  "- `coveragePredictedByActual` and `coverageActualByPredicted`: the probability mass that the",
  "  other table covers.",
  "",
  "A token that one table omits receives the probability floor of 1e-12, and each side is",
  "renormalized after the floor.",
  "",
  "## Verdict",
  "",
  "The plugin computes the mean symmetric divergence of each task, then one bootstrap interval of",
  "that mean with 2000 resamples and a fixed seed. The default tolerance is 0.05 nats.",
  "",
  "- `indistinguishable`: the upper bound of the interval is below the tolerance.",
  "- `separated`: the lower bound of the interval is above the tolerance.",
  "- `inconclusive`: the interval covers the tolerance, or the comparison holds no pair.",
  "",
  "## Hypothesis test",
  "",
  "The plugin runs one one-sided Wilcoxon signed-rank test for each comparison. The sample is the",
  "per-task median symmetric KL. The null value is the tolerance. The test uses the normal",
  "approximation with a tie correction, drops every zero difference, and reports a one-sided",
  "p-value. A comparison rejects the null hypothesis when the p-value is below alpha.",
  "",
  "The session holds the alternative hypothesis only when every comparison rejects the null and",
  "every median stands above the tolerance. The session holds the null hypothesis when no",
  "comparison rejects the null. A mixed result means that one comparison rejects and another one",
  "does not.",
  "",
  "## One folder for one run",
  "",
  "A run reads one output folder and writes only that folder. A run that names an existing folder",
  "revises it: the pass keeps every raw table that the current protocol reads, requests the absent",
  "tables, and removes each raw file that the current protocol does not read. The folder keeps one",
  "`revision.json` with one entry for each revise pass.",
  "",
  "A rename moves the folder to a fresh identifier of the form `<timestamp>_<short identifier>`.",
  "The manifest keeps the old identifier in `previousXid`.",
  "",
  "",
  "## Dataset",
  "",
  "`inputs/testing-dataset/` holds `dataset-zh-32.json` and `dataset-en-32.json`. Each file holds 32",
  "tasks in eight categories. A task holds an identifier, a category, a language, a sentence",
  "prefix, and a reference token. The validator rejects a prefix that ends with its reference",
  "token. No metric reads the reference token.",
  "",
  "## Output layout",
  "",
  "```text",
  "outputs/<xid>/",
  "  run.json",
  "  revision.json",
  "  tasks.json",
  "  intermediate/<providerKey>/<taskId>/<condition>-r<n>-call<k>.json",
  "  results/metrics.json",
  "  results/records.json",
  "  results/records/<providerKey>/<taskId>.json",
  "  results/report.md",
  "  results/summary.csv",
  "  results/tasks.csv",
  "  results/environment.json",
  "  results/task-summary.json",
  "  demos/index.html",
  "  demos/assets/",
  "```",
  "",
  "## Demonstration website",
  "",
  "`demos/` holds seven chapter pages: Overview, Method, Summary, Result Explorer, Course and",
  "Debates, Platform, and Meaning and Limits. Each page is bilingual. The Result Explorer compares",
  "one task pair at a time and recomputes the divergence in the browser from the recorded tables.",
  "",
  "## Tools",
  "",
  "- `llm_self_prediction_run`: run or revise one folder.",
  "- `llm_self_prediction_status`: list the recent sessions.",
  "- `llm_self_prediction_report`: read one Markdown report.",
  "- `llm_self_prediction_rename`: move one folder to a fresh identifier.",
  "- `llm_self_prediction_dataset`: summarize the dataset files.",
  "- `llm_self_prediction_help`: explain the protocol and the provider setup.",
  "",
  "## Settings",
  "",
  "- `outputRoot`: the output root. An empty value uses `outputs/` in the workspace.",
  "- `maxConcurrency`: the default worker count of one run, from 1 to 16.",
  "",
  "## Integrity",
  "",
  "- The plugin writes each raw exchange before the plugin parses the reply.",
  "- The plugin never rewrites a raw file and never changes a task or a prompt to make a metric pass.",
  "- Each run records the plugin version, the Node.js version, the platform, the seed, and the times.",
  "- A report states only what the output files support.",
  "",
].join("\n");

/**
 * Write the documentation files.
 *
 * @returns nothing.
 */
async function main() {
  await mkdir(docsDirectory, { recursive: true });
  for (const page of PAGES) {
    const html = renderPage(page);
    await writeFile(path.join(docsDirectory, page.name), html, "utf8");
    process.stdout.write(`Wrote ${page.name}\n`);
  }
  await writeFile(path.join(docsDirectory, "DETAIL.md"), detailMarkdown, "utf8");
  process.stdout.write("Wrote DETAIL.md\n");
}

await main();
