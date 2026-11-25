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
 * The home link of a page that runs beside `index.html`.
 *
 * A demonstration page that lives in the run directory points the home button at its own
 * `index.html`.
 */
const LOCAL_HOME_LINK = 'class="home-link" href="index.html"';

/**
 * The home link of a page that lives under `docs/results/<xid>/`.
 *
 * The copy in the documentation tree points the home button at the published list page, so a
 * reader returns to `docs/results.html` rather than to one run.
 */
const PUBLISHED_HOME_LINK = 'class="home-link" href="../../results.html"';

/**
 * Copy the demonstration website of one run into the documentation tree.
 *
 * The copy sends the home button to the list page of the documentation tree. The run directory
 * keeps the local home link, so the two copies differ in that one attribute only.
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
  for (const [page] of DEMO_PAGES) {
    const pagePath = path.join(target, page);
    const text = await fs.readFile(pagePath, "utf8").catch(() => undefined);
    if (text === undefined || !text.includes(LOCAL_HOME_LINK)) {
      continue;
    }
    await fs.writeFile(pagePath, text.replace(LOCAL_HOME_LINK, PUBLISHED_HOME_LINK), "utf8");
  }
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
 * Build the file tree of the explorer.
 *
 * The tree holds one folder for each published run. Each folder holds the seven pages of the
 * run, and the path of each page is relative to `docs/`.
 *
 * @param {readonly {xid: string}[]} runs - the published runs, newest first.
 * @returns {string} the JSON text of the tree.
 */
function renderTree(runs) {
  return JSON.stringify(
    runs.map((run) => ({
      name: run.xid,
      folder: true,
      children: DEMO_PAGES.map(([page, label]) => ({
        name: page,
        label,
        path: `results/${run.xid}/${page}`,
      })),
    })),
  );
}

/**
 * Render the explorer style of the list page.
 *
 * @returns {string} the CSS text.
 */
function renderExplorerStyle() {
  return [
    "    .explorer {",
    "      border: 1px solid var(--border);",
    "      border-radius: var(--radius);",
    "      background: var(--surface);",
    "      margin: 1rem 0 1.5rem;",
    "      overflow: hidden;",
    "    }",
    "    .explorer-toolbar {",
    "      display: flex;",
    "      align-items: center;",
    "      gap: 0.4rem;",
    "      border-bottom: 1px solid var(--border);",
    "      padding: 0.5rem 0.6rem;",
    "    }",
    "    .explorer-toolbar button {",
    "      font-family: inherit;",
    "      font-size: 0.95rem;",
    "      line-height: 1;",
    "      color: var(--text);",
    "      background: var(--background);",
    "      border: 1px solid var(--border);",
    "      border-radius: 6px;",
    "      padding: 0.3rem 0.5rem;",
    "      cursor: pointer;",
    "    }",
    "    .explorer-toolbar button:hover:not(:disabled) {",
    "      border-color: var(--accent);",
    "      color: var(--accent);",
    "    }",
    "    .explorer-toolbar button:disabled { opacity: 0.45; cursor: default; }",
    "    .explorer-path {",
    "      flex: 1;",
    "      font-family: var(--mono);",
    "      font-size: 0.85rem;",
    "      color: var(--text);",
    "      background: var(--background);",
    "      border: 1px solid var(--border);",
    "      border-radius: 6px;",
    "      padding: 0.32rem 0.5rem;",
    "    }",
    "    .explorer-files {",
    "      max-height: 15rem;",
    "      overflow-y: auto;",
    "      background: var(--background);",
    "      border-bottom: 1px solid var(--border);",
    "    }",
    "    .explorer-row {",
    "      display: flex;",
    "      align-items: center;",
    "      gap: 0.5rem;",
    "      padding: 0.32rem 0.7rem;",
    "      font-size: 0.92rem;",
    "    }",
    "    .explorer-row:hover { background: var(--accent-soft); }",
    "    .explorer-row.selected { background: var(--accent-soft); font-weight: 650; }",
    "    .explorer-chip {",
    "      font-family: var(--mono);",
    "      font-size: 0.7rem;",
    "      font-weight: 700;",
    "      color: var(--muted);",
    "      border: 1px solid var(--border);",
    "      border-radius: 4px;",
    "      padding: 0 0.28rem;",
    "      background: var(--surface);",
    "    }",
    "    .explorer-chip.folder { color: var(--accent); border-color: var(--accent); }",
    "    .explorer-name { font-family: var(--mono); font-size: 0.85rem; }",
    "    .explorer-label { color: var(--muted); font-size: 0.85rem; }",
    "    .explorer-preview { background: var(--background); }",
    "    .explorer-preview iframe {",
    "      display: block;",
    "      width: 100%;",
    "      height: 32rem;",
    "      border: 0;",
    "    }",
    "    .explorer-hint {",
    "      margin: 0;",
    "      padding: 0.6rem 0.8rem;",
    "      color: var(--muted);",
    "      font-size: 0.85rem;",
    "      border-top: 1px solid var(--border);",
    "    }",
    "    .explorer-status {",
    "      padding: 0.4rem 0.7rem;",
    "      border-top: 1px solid var(--border);",
    "      background: var(--surface);",
    "      color: var(--muted);",
    "      font-family: var(--mono);",
    "      font-size: 0.78rem;",
    "    }",
  ].join("\n");
}

/**
 * Render the script that drives the explorer.
 *
 * @param {readonly {xid: string}[]} runs - the published runs, newest first.
 * @returns {string} the HTML script element.
 */
function renderExplorerScript(runs) {
  const tree = renderTree(runs);
  return [
    "<script>",
    "(function () {",
    '  "use strict";',
    `  var TREE = ${tree};`,
    '  var state = { path: [], selected: null };',
    '  var files = document.getElementById("explorer-files");',
    '  var frame = document.getElementById("explorer-frame");',
    '  var pathInput = document.getElementById("explorer-path");',
    '  var status = document.getElementById("explorer-status");',
    '  var upButton = document.querySelector(\'[data-act="up"]\');',
    "",
    "  function currentFolder() {",
    "    var node = { children: TREE };",
    "    for (var index = 0; index < state.path.length; index += 1) {",
    "      var name = state.path[index];",
    "      var match = (node.children || []).filter(function (item) {",
    "        return item.folder && item.name === name;",
    "      })[0];",
    "      if (!match) {",
    "        return { children: [] };",
    "      }",
    "      node = match;",
    "    }",
    "    return node;",
    "  }",
    "",
    "  function render() {",
    '    files.textContent = "";',
    "    var folder = currentFolder();",
    "    (folder.children || []).forEach(function (item) {",
    '      var row = document.createElement("div");',
    '      row.className = "explorer-row" + (item.folder ? " folder" : "");',
    '      var chip = document.createElement("span");',
    '      chip.className = "explorer-chip" + (item.folder ? " folder" : "");',
    '      chip.textContent = item.folder ? "D" : "F";',
    '      var name = document.createElement("span");',
    '      name.className = "explorer-name";',
    "      name.textContent = item.name;",
    "      row.appendChild(chip);",
    "      row.appendChild(name);",
    '      if (!item.folder && item.label && item.name !== "index.html") {',
    '        var label = document.createElement("span");',
    '        label.className = "explorer-label";',
    "        label.textContent = item.label;",
    "        row.appendChild(label);",
    "      }",
    "      row.tabIndex = 0;",
    '      row.setAttribute("role", "option");',
    '      row.addEventListener("click", function () { select(item, row); });',
    '      row.addEventListener("dblclick", function () { open(item); });',
    '      row.addEventListener("keydown", function (event) {',
    '        if (event.key === "Enter") { select(item, row); }',
    '        if (event.key === " ") { event.preventDefault(); open(item); }',
    "      });",
    "      files.appendChild(row);",
    "    });",
    '    pathInput.value = "/" + state.path.join("/") + (state.path.length ? "/" : "");',
    "    upButton.disabled = state.path.length === 0;",
    "  }",
    "",
    "  function enter(item) {",
    "    state.path = state.path.concat([item.name]);",
    "    state.selected = null;",
    "    render();",
    "  }",
    "",
    "  function select(item, row) {",
    "    if (item.folder) {",
    "      enter(item);",
    "      return;",
    "    }",
    "    state.selected = item;",
    '    document.querySelectorAll(".explorer-row").forEach(function (other) {',
    '      other.classList.remove("selected");',
    "    });",
    '    row.classList.add("selected");',
    "    frame.src = item.path;",
    "    status.textContent = item.path;",
    "  }",
    "",
    "  function open(item) {",
    "    if (item.folder) {",
    "      enter(item);",
    "      return;",
    '    }',
    '    window.open(item.path, "_blank", "noopener");',
    "  }",
    "",
    '  upButton.addEventListener("click", function () {',
    "    if (state.path.length === 0) {",
    "      return;",
    "    }",
    "    state.path = state.path.slice(0, -1);",
    "    state.selected = null;",
    "    render();",
    "  });",
    '  document.querySelector(\'[data-act="home"]\').addEventListener("click", function () {',
    "    state.path = [];",
    "    state.selected = null;",
    "    render();",
    "  });",
    '  document.querySelector(\'[data-act="newtab"]\').addEventListener("click", function () {',
    "    if (state.selected) {",
    '      window.open(state.selected.path, "_blank", "noopener");',
    "    }",
    "  });",
    "",
    "  render();",
    "})();",
    "</script>",
  ].join("\n");
}

/**
 * Render the explorer window of the list page.
 *
 * @param {readonly {xid: string}[]} runs - the published runs, newest first.
 * @returns {string} the HTML fragment.
 */
function renderExplorer(runs) {
  const firstRun = runs[0];
  const initialPath = firstRun === undefined ? "" : `results/${firstRun.xid}/index.html`;
  return [
    '    <section class="explorer" aria-label="Published results explorer">',
    '      <div class="explorer-toolbar">',
    '        <button type="button" data-act="up" title="Up one folder">&#8593;</button>',
    '        <button type="button" data-act="home" title="Back to the root folder">&#8962;</button>',
    '        <button type="button" data-act="newtab" title="Open the selected page in a new tab">',
    "          &#8599;",
    "        </button>",
    '        <input id="explorer-path" class="explorer-path" type="text" readonly',
    '          aria-label="Current folder" value="/">',
    "      </div>",
    '      <div id="explorer-files" class="explorer-files" role="listbox"',
    '        aria-label="Published runs and pages"></div>',
    '      <div class="explorer-preview">',
    `        <iframe id="explorer-frame" title="Page preview" src="${escapeHtml(initialPath)}">`,
    "        </iframe>",
    '        <p class="explorer-hint">Single click a row to preview the page here. Double click a',
    "          page to open it in a new tab.</p>",
    "      </div>",
    '      <div id="explorer-status" class="explorer-status">&mdash;</div>',
    "    </section>",
  ].join("\n");
}

/**
 * Render the list page.
 *
 * @param {readonly {xid: string, metrics: unknown, manifest: unknown}[]} runs - the published runs.
 * @returns {string} the HTML document.
 */
function renderListPage(runs) {
  const ordered = runs.slice().reverse();
  const rows = ordered.map((run) => renderRunRow(run)).join("\n");
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
    "<style>",
    renderExplorerStyle(),
    "</style>",
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
    '  <p class="lede">The demonstration website of every published run, in a file explorer.',
    "    Each run is one folder of seven chapter pages. The pages read the recorded tables of the",
    "    run, so a reader can recompute a divergence in the browser.</p>",
    "",
    `  <div class="callout">The list holds <strong>${count}</strong> ${
      count === 1 ? "run" : "runs"
    }. A run publishes seven pages. The table below counts the separated verdicts against`,
    "    the compared verdicts, so <code>27/27</code> means that every comparison of every model",
    "    stays above the tolerance.</div>",
    "",
    renderExplorer(ordered),
    "",
    '  <table class="zebra">',
    "    <thead>",
    '      <tr><th>Run</th><th>Finished at, UTC</th><th class="number">Models</th>',
    '        <th class="number">Tasks</th><th class="number">Entries</th>',
    '        <th class="number">Separated</th><th>Pages</th></tr>',
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
    renderExplorerScript(ordered),
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
