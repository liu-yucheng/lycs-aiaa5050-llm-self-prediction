// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * Publish the demonstration website of each run under the documentation tree.
 *
 * The script copies the demonstration website of one run, or of every run, into
 * `docs/results/<xid>/` and writes `docs/results.html` with one row for each published run. A
 * published page keeps the relative asset paths of the run directory, so the copy works without
 * a rewrite of the HTML.
 *
 * Usage:
 *
 * ```text
 * node scripts/publish-results.mjs                 # publish every run of outputs/
 * node scripts/publish-results.mjs <xid> [<xid>]   # publish the named runs only
 * ```
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { PLUGIN_NAME, PLUGIN_VERSION } from "../lib/constants.js";

/** The package root directory. */
const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The directory that holds the runs. */
const OUTPUT_ROOT = path.join(PACKAGE_ROOT, "outputs");

/** The directory that holds the published runs. */
const PUBLISHED_ROOT = path.join(PACKAGE_ROOT, "docs", "results");

/** The name of the published list page. */
const LIST_PAGE_NAME = "results.html";

/** The demonstration pages of one run, in navigation order. */
const DEMO_PAGES = [
  ["index.html", "Overview"],
  ["method.html", "Method"],
  ["summary.html", "Summary"],
  ["explorer.html", "Result Explorer"],
  ["context.html", "Course and Debates"],
  ["implementation.html", "Platform"],
  ["meaning.html", "Meaning and Limits"],
];

/**
 * Escape one text for HTML.
 *
 * @param {string} text - the text to escape.
 * @returns {string} the escaped text.
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

/**
 * Read one JSON file.
 *
 * @param {string} filePath - the file path.
 * @returns {Promise<unknown>} the parsed value, or undefined when the file is absent.
 */
async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Test whether one directory holds a complete run.
 *
 * @param {string} directory - the run directory.
 * @returns {Promise<boolean>} true when the run is complete.
 */
async function isCompleteRun(directory) {
  const manifest = await readJson(path.join(directory, "run.json"));
  if (manifest === undefined || manifest.status !== "complete") {
    return false;
  }
  const metrics = await readJson(path.join(directory, "results", "metrics.json"));
  return metrics !== undefined && Array.isArray(metrics.providers);
}

/**
 * Collect the run directories under the output root.
 *
 * @param {readonly string[]} requested - the requested run identifiers.
 * @returns {Promise<string[]>} the complete run directories, in name order.
 */
async function collectRuns(requested) {
  let names = [];
  try {
    names = await fs.readdir(OUTPUT_ROOT);
  } catch {
    return [];
  }
  const directories = [];
  for (const name of names.sort()) {
    if (requested.length > 0 && !requested.includes(name)) {
      continue;
    }
    const directory = path.join(OUTPUT_ROOT, name);
    const entry = await fs.stat(directory).catch(() => undefined);
    if (entry === undefined || !entry.isDirectory()) {
      continue;
    }
    if (await isCompleteRun(directory)) {
      directories.push(directory);
    }
  }
  return directories;
}

/**
 * Copy the demonstration website of one run into the documentation tree.
 *
 * @param {string} runDirectory - the run directory.
 * @param {string} xid - the run identifier.
 * @returns {Promise<boolean>} true when the copy exists.
 */
async function copyDemos(runDirectory, xid) {
  const source = path.join(runDirectory, "demos");
  const entry = await fs.stat(source).catch(() => undefined);
  if (entry === undefined) {
    return false;
  }
  const target = path.join(PUBLISHED_ROOT, xid);
  await fs.rm(target, { recursive: true, force: true });
  await fs.cp(source, target, { recursive: true });
  return true;
}

/**
 * Render one table cell of demonstration links.
 *
 * @param {string} xid - the run identifier.
 * @returns {string} the HTML cell.
 */
function renderLinkCell(xid) {
  const links = DEMO_PAGES.map(
    ([page, label], index) =>
      `      <a href="results/${xid}/${page}">${index + 1}. ${escapeHtml(label)}</a>`,
  ).join("\n");
  return `    <td class="links">\n${links}\n    </td>`;
}

/**
 * Render the row of one published run.
 *
 * @param {{xid: string, metrics: unknown, manifest: unknown}} run - the run facts.
 * @returns {string} the HTML row.
 */
function renderRunRow(run) {
  const providers = run.metrics.providers ?? [];
  const models = providers
    .map((provider) => `<code>${escapeHtml(provider.model)}</code>`)
    .join(", ");
  const verdicts = (run.metrics.verdicts ?? []).flatMap((entry) => entry.verdicts ?? []);
  const separated = verdicts.filter((entry) => entry.verdict === "separated").length;
  const compared = verdicts.length;
  const generatedAt = String(run.metrics.generatedAt ?? "");
  const entries = Number(run.metrics.topLogprobsCount ?? 0);
  return [
    "  <tr>",
    `    <td><code>${escapeHtml(run.xid)}</code></td>`,
    `    <td>${escapeHtml(generatedAt.slice(0, 19).replace("T", " "))}</td>`,
    `    <td class="number">${providers.length}</td>`,
    `    <td class="number">${Number(run.metrics.taskCount ?? 0)}</td>`,
    `    <td class="number">${entries}</td>`,
    `    <td class="number">${separated}/${compared}</td>`,
    renderLinkCell(run.xid),
    "  </tr>",
    `  <tr class="models"><td colspan="7">${models}</td></tr>`,
  ].join("\n");
}

/**
 * Render the list page.
 *
 * @param {readonly {xid: string, metrics: unknown, manifest: unknown}[]} runs - the published runs.
 * @returns {string} the HTML document.
 */
function renderListPage(runs) {
  const rows = runs
    .slice()
    .reverse()
    .map((run) => renderRunRow(run))
    .join("\n");
  const count = runs.length;
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Published results — plugin documentation</title>",
    '<meta name="description" content="The demonstration website of each published run.">',
    '<link rel="stylesheet" href="assets/site.css">',
    "</head>",
    "<body>",
    '<header class="site-header">',
    '  <div class="inner">',
    `    <div class="brand">Next-token self-prediction<small>${PLUGIN_NAME} ${PLUGIN_VERSION}</small></div>`,
    '    <nav class="site-nav" aria-label="Documentation">',
    '      <a href="index.html">Overview</a>',
    '      <a href="design.html">Design</a>',
    '      <a href="protocol.html">Protocol</a>',
    '      <a href="measures.html">Measures</a>',
    '      <a href="reference.html">Reference</a>',
    '      <a href="reproducibility.html">Reproducibility</a>',
    '      <a href="results.html" aria-current="page">Results</a>',
    "    </nav>",
    "  </div>",
    "</header>",
    "",
    "<main>",
    "  <h1>Published results</h1>",
    '  <p class="lede">The demonstration website of every published run. Each link opens one',
    "    chapter page of that run. The pages read the recorded tables of the run, so a reader can",
    "    recompute a divergence in the browser.</p>",
    "",
    `  <div class="callout">The list holds <strong>${count}</strong> ${
      count === 1 ? "run" : "runs"
    }. A run publishes seven pages. The number column counts the separated verdicts against`,
    "    the compared verdicts, so <code>3/3</code> means that every comparison of every model",
    "    stays above the tolerance.</div>",
    "",
    '  <table class="zebra">',
    "    <thead>",
    "      <tr><th>Run</th><th>Finished at, UTC</th><th class=\"number\">Models</th>",
    "        <th class=\"number\">Tasks</th><th class=\"number\">Entries</th>",
    "        <th class=\"number\">Separated</th><th>Pages</th></tr>",
    "    </thead>",
    "    <tbody>",
    rows,
    "    </tbody>",
    "  </table>",
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

/**
 * Publish the requested runs and write the list page.
 *
 * @returns {Promise<void>} a promise that resolves when the copy is complete.
 */
async function main() {
  const requested = process.argv.slice(2).filter((value) => !value.startsWith("-"));
  const directories = await collectRuns(requested);
  if (directories.length === 0) {
    console.log("No complete run is available to publish.");
    return;
  }
  await fs.mkdir(PUBLISHED_ROOT, { recursive: true });
  const published = [];
  for (const directory of directories) {
    const xid = path.basename(directory);
    const copied = await copyDemos(directory, xid);
    if (!copied) {
      console.log(`The run ${xid} holds no demonstration website.`);
      continue;
    }
    const metrics = await readJson(path.join(directory, "results", "metrics.json"));
    const manifest = await readJson(path.join(directory, "run.json"));
    published.push({ xid, metrics, manifest });
  }
  const listPage = renderListPage(published);
  await fs.writeFile(path.join(PACKAGE_ROOT, "docs", LIST_PAGE_NAME), listPage, "utf8");
  for (const run of published) {
    console.log(`Published ${run.xid} to docs/results/${run.xid}/`);
  }
  console.log(`Wrote docs/${LIST_PAGE_NAME} with ${published.length} run(s).`);
}

await main();
