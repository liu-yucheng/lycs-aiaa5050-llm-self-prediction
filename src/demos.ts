// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.

/**
 * Static demonstration website of one run.
 *
 * The site holds seven pages: overview, method, summary, explorer, context, implementation, and
 * meaning. Each page is bilingual. The explorer reads one data file for each model, so the pages
 * open from the file system with no server and no network.
 */

import path from "node:path";

import { COMPARISON_NAMES, PLUGIN_NAME, PLUGIN_VERSION } from "./constants.js";
import { ensureDirectory, safeFileSegment, writeJsonFile, writeTextFile } from "./files.js";
import { formatNumber } from "./report.js";
import type {
  ComparisonMetrics,
  ComparisonName,
  ComparisonSummary,
  PredictionRecord,
  SessionEnvironment,
  SessionMetrics,
  TaskRecord,
} from "./types.js";

/** The description of one dataset, as the demos show it. */
export interface DemoDatasetDescription {
  /** The identifiers of the datasets of the run. */
  readonly datasetIds: readonly string[];
  /** The languages of the run. */
  readonly languages: readonly string[];
  /** The task count of the run. */
  readonly taskCount: number;
  /** The task count of each category. */
  readonly categories: readonly { readonly name: string; readonly count: number }[];
}

/** The options of the demonstration website. */
export interface DemoOptions {
  /** The demos directory. */
  readonly directory: string;
  /** The session metrics. */
  readonly metrics: SessionMetrics;
  /** The task records. */
  readonly records: readonly TaskRecord[];
  /** The run environment. */
  readonly environment: SessionEnvironment;
  /** The dataset description. */
  readonly dataset: DemoDatasetDescription;
}

/** The page order of the navigation bar. */
const PAGES = [
  { file: "index.html", english: "Overview", chinese: "总览" },
  { file: "method.html", english: "Method", chinese: "方法" },
  { file: "summary.html", english: "Summary", chinese: "结果" },
  { file: "explorer.html", english: "Result Explorer", chinese: "结果浏览器" },
  { file: "context.html", english: "Course and Debates", chinese: "课程与辩论" },
  { file: "implementation.html", english: "Platform", chinese: "平台实现" },
  { file: "meaning.html", english: "Meaning and Limits", chinese: "意义与局限" },
] as const;

/**
 * Build one bilingual span pair.
 *
 * @param english - the English text.
 * @param chinese - the Simplified Chinese text.
 * @returns the HTML fragment.
 */
function bilingual(english: string, chinese: string): string {
  return (
    `<span data-lang="en">${english}</span>` +
    `<span data-lang="zh" hidden>${chinese}</span>`
  );
}

/**
 * Build one bilingual paragraph.
 *
 * @param english - the English text.
 * @param chinese - the Simplified Chinese text.
 * @returns the HTML fragment.
 */
function paragraph(english: string, chinese: string): string {
  return `<p>${bilingual(english, chinese)}</p>`;
}

/**
 * Build one bilingual heading.
 *
 * @param level - the heading level, from 2 to 4.
 * @param english - the English text.
 * @param chinese - the Simplified Chinese text.
 * @returns the HTML fragment.
 */
function heading(level: 2 | 3 | 4, english: string, chinese: string): string {
  return `<h${level}>${bilingual(english, chinese)}</h${level}>`;
}

/**
 * Build one bilingual list.
 *
 * @param items - the English and Chinese text of each item.
 * @param ordered - true for an ordered list.
 * @returns the HTML fragment.
 */
function list(
  items: readonly { readonly english: string; readonly chinese: string }[],
  ordered = false,
): string {
  const tag = ordered ? "ol" : "ul";
  const body = items
    .map((item) => `<li>${bilingual(item.english, item.chinese)}</li>`)
    .join("\n");
  return `<${tag}>\n${body}\n</${tag}>`;
}

/**
 * Build one bilingual callout box.
 *
 * @param english - the English text.
 * @param chinese - the Simplified Chinese text.
 * @returns the HTML fragment.
 */
function callout(english: string, chinese: string): string {
  return `<aside class="callout">${bilingual(english, chinese)}</aside>`;
}

/**
 * Build one bilingual table.
 *
 * @param headers - the header text of each column.
 * @param rows - the cell text of each row, already in HTML.
 * @returns the HTML fragment.
 */
function table(
  headers: readonly { readonly english: string; readonly chinese: string }[],
  rows: readonly string[],
): string {
  const head = headers
    .map((header) => `<th>${bilingual(header.english, header.chinese)}</th>`)
    .join("");
  return `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${rows.join("\n")}\n</tbody>\n</table>`;
}

/**
 * Read the verdict of one comparison summary.
 *
 * @param summary - the summary.
 * @param toleranceNats - the tolerance in nats.
 * @returns the verdict text.
 */
function verdictOf(summary: ComparisonSummary, toleranceNats: number): string {
  if (summary.pairCount === 0) {
    return "inconclusive";
  }
  if (summary.confidenceInterval.upper < toleranceNats) {
    return "indistinguishable";
  }
  if (summary.confidenceInterval.lower > toleranceNats) {
    return "separated";
  }
  return "inconclusive";
}

/**
 * Render one strip of statistic cards.
 *
 * @param items - the cards to render.
 * @returns the HTML block.
 */
function statStrip(
  items: readonly {
    readonly icon: string;
    readonly value: string;
    readonly labelEnglish: string;
    readonly labelChinese: string;
    readonly kind?: "actual" | "predicted" | "symmetric";
  }[],
): string {
  const cards = items.map(
    (item) =>
      `<div class="stat-card${item.kind === undefined ? "" : ` ${item.kind}`}">` +
      `<span class="stat-icon">${item.icon}</span>` +
      `<span class="stat-value">${item.value}</span>` +
      `<span class="stat-label">${bilingual(item.labelEnglish, item.labelChinese)}</span></div>`,
  );
  return `<div class="stat-strip">${cards.join("")}</div>`;
}

/**
 * Render the verdict of one comparison as a colored badge.
 *
 * @param verdict - the verdict name.
 * @param value - the value to show inside the badge.
 * @returns the HTML snippet.
 */
function verdictBadge(verdict: string, value: string): string {
  const kind = verdict === "indistinguishable" ? "ok" : verdict === "separated" ? "bad" : "warn";
  return `<span class="badge ${kind}">${verdict} · ${value}</span>`;
}

/**
 * Render one horizontal bar with a tolerance mark.
 *
 * @param label - the row label.
 * @param value - the bar value.
 * @param maximum - the value that fills the track.
 * @param tolerance - the tolerance to mark, or undefined for no mark.
 * @param kind - the color class.
 * @returns the HTML block.
 */
function barRow(
  label: string,
  value: number,
  maximum: number,
  tolerance: number | undefined,
  kind: "actual" | "predicted" | "symmetric",
): string {
  const width = maximum > 0 ? Math.min(100, Math.max(0.5, (value / maximum) * 100)) : 0;
  const mark =
    tolerance === undefined || maximum <= 0
      ? ""
      : `<span class="tolerance-line" style="left:${Math.min(100, (tolerance / maximum) * 100)}%">` +
        "</span>";
  return (
    `<div class="bar-row"><span class="url-hint">${label}</span>` +
    `<span class="bar-track"><span class="bar-fill ${kind}" ` +
    `style="width:${width.toFixed(2)}%"></span>${mark}</span>` +
    `<span class="bar-value">${formatNumber(value, 3)}</span></div>`
  );
}

/**
 * Render one band of numbered protocol steps.
 *
 * @param steps - the steps to render, in order.
 * @returns the HTML block.
 */
function flowStrip(
  steps: readonly {
    readonly icon: string;
    readonly titleEnglish: string;
    readonly titleChinese: string;
    readonly detailEnglish: string;
    readonly detailChinese: string;
  }[],
): string {
  const items = steps.map(
    (step, index) =>
      `<li><span class="step">${String(index + 1).padStart(2, "0")} ${step.icon}</span>` +
      `<span class="title">${bilingual(step.titleEnglish, step.titleChinese)}</span>` +
      `<span class="detail">${bilingual(step.detailEnglish, step.detailChinese)}</span></li>`,
  );
  return `<ol class="flow">${items.join("")}</ol>`;
}

/**
 * Build the shared page shell.
 *
 * @param options - the page options.
 * @returns the HTML document.
 */
function renderShell(options: {
  readonly current: string;
  readonly titleEnglish: string;
  readonly titleChinese: string;
  readonly ledeEnglish: string;
  readonly ledeChinese: string;
  readonly body: string;
  readonly metrics: SessionMetrics;
}): string {
  const links = PAGES.map((page) => {
    const active = page.file === options.current ? ' class="active"' : "";
    return (
      `<a href="${page.file}"${active}>` +
      bilingual(page.english, page.chinese) +
      "</a>"
    );
  }).join("\n");
  return `<!DOCTYPE html>
<html lang="en" data-lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${options.titleEnglish} · ${options.metrics.xid}</title>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <div class="brand">
      <span class="brand-mark">NTP</span>
      <span class="brand-text">${bilingual(
        "Can LLMs predict their own next token predictions?",
        "大模型能预测自己的下一个词块吗？",
      )}</span>
    </div>
    <nav class="nav">${links}</nav>
    <button class="lang-toggle" type="button" id="lang-toggle" aria-label="Switch language">
      <span data-lang="en">中文</span><span data-lang="zh" hidden>English</span>
    </button>
  </div>
</header>
<main class="page">
  <p class="eyebrow">${bilingual("Run", "运行")} <code>${options.metrics.xid}</code></p>
  <h1>${bilingual(options.titleEnglish, options.titleChinese)}</h1>
  <p class="lede">${bilingual(options.ledeEnglish, options.ledeChinese)}</p>
  ${options.body}
</main>
<footer class="page-footer">
  <p>${bilingual(
    `Generated by ${PLUGIN_NAME} version ${PLUGIN_VERSION}. Random seed ${options.metrics.randomSeed}.`,
    `由 ${PLUGIN_NAME} 版本 ${PLUGIN_VERSION} 生成。随机种子 ${options.metrics.randomSeed}。`,
  )}</p>
  <p>${bilingual(
    "This page is a record of one run. The files below the run directory hold every number.",
    "本页记录一次运行。运行目录下的文件保存每一个数字。",
  )}</p>
</footer>
<script src="assets/app.js"></script>
</body>
</html>
`;
}

/**
 * Render the overview page.
 *
 * @param options - the demo options.
 * @returns the HTML document.
 */
function renderOverviewPage(options: DemoOptions): string {
  const { metrics, dataset } = options;
  const modelCount = metrics.providers.length;
  const means = COMPARISON_NAMES.map((comparison) => {
    const values = metrics.providers
      .map((provider) => provider.comparisons.find((entry) => entry.comparison === comparison))
      .filter((entry): entry is ComparisonSummary => entry !== undefined);
    if (values.length === 0) {
      return { comparison, mean: undefined as number | undefined };
    }
    const mean = values.reduce((sum, entry) => sum + entry.meanSymmetricKl, 0) / values.length;
    return { comparison, mean };
  });
  const rows = means.map(
    (entry) =>
      `<tr><td><code>${entry.comparison}</code></td><td class="number">` +
      `${formatNumber(entry.mean)}</td></tr>`,
  );
  const pairCount = metrics.providers.reduce(
    (total, provider) =>
      total + provider.comparisons.reduce((inner, entry) => inner + entry.pairCount, 0),
    0,
  );
  const separatedCount = metrics.providers.reduce(
    (total, provider) =>
      total +
      provider.comparisons.filter(
        (entry) => verdictOf(entry, metrics.toleranceNats) === "separated",
      ).length,
    0,
  );
  const comparisonCount = metrics.providers.length * COMPARISON_NAMES.length;
  const verdictRows = metrics.providers.map((provider) => {
    const cells = COMPARISON_NAMES.map((comparison) => {
      const summary = provider.comparisons.find((entry) => entry.comparison === comparison);
      if (summary === undefined) {
        return '<td><span class="badge warn">n/a</span></td>';
      }
      const verdict = verdictOf(summary, metrics.toleranceNats);
      return `<td>${verdictBadge(verdict, formatNumber(summary.meanSymmetricKl, 3))}</td>`;
    }).join("");
    return (
      `<tr><td class="model"><code>${provider.providerKey}</code></td>` +
      `${cells}<td class="number">${provider.taskCount}</td></tr>`
    );
  });
  const body = `
${statStrip([
  {
    icon: "🧪",
    value: String(metrics.providers.length),
    labelEnglish: "tested models",
    labelChinese: "被测模型",
    kind: "actual",
  },
  {
    icon: "📋",
    value: String(metrics.taskCount),
    labelEnglish: "tasks, two languages",
    labelChinese: "任务，两种语言",
  },
  {
    icon: "🔁",
    value: `${metrics.repetitionCount} × 4`,
    labelEnglish: "repetitions × conditions",
    labelChinese: "重复次数 × 条件数",
  },
  {
    icon: "📊",
    value: String(pairCount),
    labelEnglish: "paired distributions",
    labelChinese: "配对分布",
    kind: "predicted",
  },
  {
    icon: "🎯",
    value: formatNumber(metrics.toleranceNats, 2),
    labelEnglish: "tolerance, nats",
    labelChinese: "容差，奈特",
  },
  {
    icon: "⚖️",
    value: `${separatedCount}/${comparisonCount}`,
    labelEnglish: "separated verdicts",
    labelChinese: "有差异判定",
    kind: "symmetric",
  },
])}
${paragraph(
  "A language model writes one token at each step, and that step rests on a probability " +
    "distribution over the next token. The model can show that distribution when the interface " +
    "returns log probabilities. This experiment asks a different question: can the same model " +
    "state that distribution as text, with no log-probability interface at all?",
  "语言模型每一步写一个词块，这一步由下一个词块的概率分布决定。接口返回对数概率时，模型可以展示这个分布。" +
    "本实验问另一个问题：同一个模型能不能不用对数概率接口，只用文字把这个分布说出来？",
)}
${callout(
  "Null hypothesis: a model reports its own distribution with no error, so the divergence is " +
    "near 0 nats. Alternative hypothesis: a model does not learn to report its own distribution " +
    "in training, so the divergence is larger than 0 nats.",
  "零假设：模型能无误差地报告自己的分布，因此散度接近 0 奈特。对立假设：模型在训练中没有学会报告自己的分布，" +
    "因此散度大于 0 奈特。",
)}
${heading(2, "The verdict at a glance", "判定一览")}
${paragraph(
  "Each cell gives the mean symmetric divergence of one model in one comparison, with its " +
    "verdict badge. Green is indistinguishable from zero, amber is inconclusive, and red is a " +
    "clear difference.",
  "每格给出一个模型在一个比较中的平均对称散度与判定徽标。绿色表示与零不可区分，琥珀色表示不确定，" +
    "红色表示明显不同。",
)}
${table(
  [
    { english: "Model key", chinese: "模型键" },
    ...COMPARISON_NAMES.map((comparison) => ({ english: comparison, chinese: comparison })),
    { english: "Tasks", chinese: "任务" },
  ],
  verdictRows,
)}
${heading(2, "The four conditions", "四个条件")}
${paragraph(
  "The run applies four conditions to each task. Two conditions ask for a table. Two conditions " +
    "put a table into the context and then measure again.",
  "本运行对每个任务使用四个条件。两个条件要求模型写出表格。两个条件把表格放进上下文，然后再测一次。",
)}
<div class="condition-grid">
  <div class="condition-card">
    <h3>1 · plain_actual</h3>
    ${paragraph(
      "The model reads the task and predicts the next token. The run reads the served table. " +
        "This condition gives the ground truth.",
      "模型读任务并预测下一个词块。运行读取接口返回的表格。本条件给出基准真值。",
    )}
  </div>
  <div class="condition-card">
    <h3>2 · plain_self</h3>
    ${paragraph(
      "The model reads the same task and writes the table of its own distribution as text.",
      "模型读同一个任务，用文字写出自己分布的表格。",
    )}
  </div>
  <div class="condition-card">
    <h3>3 · injected_self</h3>
    ${paragraph(
      "The model reads the served table, and then writes its own table. This condition tests " +
        "whether the model can read and rewrite a table.",
      "模型先读接口返回的表格，再写自己的表格。本条件检验模型能否读懂并重写表格。",
    )}
  </div>
  <div class="condition-card">
    <h3>4 · injected_actual</h3>
    ${paragraph(
      "The model writes its own table, and then predicts the next token with that table in the " +
        "context. This condition tests whether a self-prediction moves the real prediction.",
      "模型先写出自己的表格，然后在该表格位于上下文时预测下一个词块。本条件检验自我预测是否会改变真实预测。",
    )}
  </div>
</div>
${heading(2, "This run", "本次运行")}
<ul class="stat-row">
  <li><span class="stat-value">${modelCount}</span>${bilingual("models", "个模型")}</li>
  <li><span class="stat-value">${dataset.taskCount}</span>${bilingual("tasks", "个任务")}</li>
  <li><span class="stat-value">${metrics.repetitionCount}</span>${bilingual(
    "repetitions per condition",
    "次重复／条件",
  )}</li>
  <li><span class="stat-value">${metrics.topLogprobsCount}</span>${bilingual(
    "table entries",
    "表格条目",
  )}</li>
  <li><span class="stat-value">${metrics.toleranceNats}</span>${bilingual("nats tolerance", "奈特容差")}</li>
  <li><span class="stat-value">${options.environment.elapsedSeconds}</span>${bilingual("seconds", "秒")}</li>
</ul>
${paragraph(
  "The table shows the mean symmetric Kullback-Leibler divergence of each comparison, averaged " +
    "over every model of the run.",
  "下表显示每个比较的对称 Kullback-Leibler 散度均值，取本运行全部模型的平均。",
)}
${table(
  [
    { english: "Comparison", chinese: "比较" },
    { english: "Mean symmetric KL (nats)", chinese: "对称 KL 均值（奈特）" },
  ],
  rows,
)}
${heading(2, "Where to go next", "接下来看什么")}
${list([
  {
    english: "Method: the dataset, the prompts, the parser, and the statistics.",
    chinese: "方法：数据集、提示词、解析器和统计方法。",
  },
  {
    english: "Summary: the numbers of this run and the verdict of each comparison.",
    chinese: "结果：本次运行的数字和每个比较的判定。",
  },
  {
    english: "Result Explorer: the two-pane view of one task, with per-token contributions.",
    chinese: "结果浏览器：单个任务的双栏视图，带每个词块的贡献。",
  },
  {
    english: "Meaning and Limits: what these numbers do and do not show.",
    chinese: "意义与局限：这些数字说明什么，不说明什么。",
  },
])}
`;
  return renderShell({
    current: "index.html",
    titleEnglish: "Overview",
    titleChinese: "总览",
    ledeEnglish:
      "One measurement of the ability of a language model to report its own next-token " +
      "distribution.",
    ledeChinese: "测量语言模型报告自己下一个词块分布的能力。",
    body,
    metrics,
  });
}

/**
 * Render the method page.
 *
 * @param options - the demo options.
 * @returns the HTML document.
 */
function renderMethodPage(options: DemoOptions): string {
  const { metrics, dataset } = options;
  const categoryRows = dataset.categories.map(
    (entry) =>
      `<tr><td>${entry.name}</td><td class="number">${entry.count}</td></tr>`,
  );
  const body = `
${flowStrip([
  {
    icon: "📝",
    titleEnglish: "Pick a task",
    titleChinese: "选择任务",
    detailEnglish: "A prefix of one sentence and the token that a human reader expects.",
    detailChinese: "一句句子的前缀，以及人类读者预期的词块。",
  },
  {
    icon: "📡",
    titleEnglish: "Read the served table",
    titleChinese: "读取接口表格",
    detailEnglish: "One request with max_tokens 1 and top_logprobs 20 gives the ground truth.",
    detailChinese: "一次请求，max_tokens 为 1，top_logprobs 为 20，得到基准。",
  },
  {
    icon: "🗣️",
    titleEnglish: "Ask for the own table",
    titleChinese: "索取自身表格",
    detailEnglish: "The model writes a JSON table of its own distribution as text.",
    detailChinese: "模型用文本写出自己分布的 JSON 表格。",
  },
  {
    icon: "🔁",
    titleEnglish: "Inject and repeat",
    titleChinese: "注入并重复",
    detailEnglish: "Each table enters the other context, and the run measures again.",
    detailChinese: "两个表格分别进入对方的上下文，运行再次测量。",
  },
  {
    icon: "📐",
    titleEnglish: "Compare and judge",
    titleChinese: "比较与判定",
    detailEnglish: "Symmetric divergence, a bootstrap interval, and a verdict per comparison.",
    detailChinese: "对称散度、自助法区间，以及每个比较的判定。",
  },
])}
${heading(2, "Dataset", "数据集")}
${paragraph(
  `The run reads ${dataset.datasetIds.length} dataset files from inputs/testing-dataset/. Each ` +
    "file holds next-token tasks in one language. Each task gives a prefix and the token that a " +
    "human reader expects.",
  `本运行从 inputs/testing-dataset/ 读取 ${dataset.datasetIds.length} 个数据集文件。每个文件保存一种语言的` +
    "下一个词块任务。每个任务给出前缀，以及人类读者预期的词块。",
)}
${table(
  [
    { english: "Dataset", chinese: "数据集" },
    { english: "Language", chinese: "语言" },
    { english: "Tasks", chinese: "任务数" },
  ],
  metrics.providers.length > 0 || dataset.taskCount > 0
    ? dataset.datasetIds.map(
        (id, index) =>
          `<tr><td><code>${id}</code></td><td>${dataset.languages[index] ?? ""}</td>` +
          `<td class="number">${countTasksOfDataset(options.records, id)}</td></tr>`,
      )
    : [],
)}
${paragraph(
  "The run keeps the reference token for the record. No metric uses the reference token.",
  "运行保存参考词块以备记录。任何指标都不使用参考词块。",
)}
${table(
  [
    { english: "Category", chinese: "类别" },
    { english: "Tasks", chinese: "任务数" },
  ],
  categoryRows,
)}
${heading(2, "Prompts", "提示词")}
${paragraph(
  "The plain actual condition sends the task with the log-probability request. The interface " +
    "returns the top entries of the served distribution. The plain self condition sends the same " +
    "task and asks for a JSON object with the entries of the model own distribution.",
  "普通实际条件发送任务，并请求对数概率。接口返回实际分布的前若干条目。普通自我条件发送同样的任务，" +
    "要求模型用 JSON 对象写出自己分布的各条目。",
)}
${callout(
  "The self condition asks for one token of one or more characters. A tokenizer can cut a word " +
    "into pieces, and the model does not see the tokenizer. The prompt therefore permits the " +
    "model to list the leading pieces and to give the rest of the probability to the whole word.",
  "自我条件要求一个词块，可以是一个或多个字符。分词器会把一个词切成片段，而模型看不到分词器。" +
    "因此提示词允许模型列出前导片段，并把其余概率给整个词。",
)}
${paragraph(
  "The run parses the reply as text. It accepts a code fence, an object, or an array. It keeps " +
    "the raw reply unchanged in the intermediate directory and stores the parsed table next to " +
    "the record.",
  "运行按文本解析回复。它接受代码围栏、对象或数组。原始回复原样保存在中间目录，解析后的表格与记录一起保存。",
)}
${heading(2, "Divergence", "散度")}
${paragraph(
  "For two distributions p and q over the union of their supports, the symmetric divergence is " +
    "one half of the forward divergence plus one half of the reverse divergence.",
  "对于支撑集并集上的两个分布 p 与 q，对称散度是前向散度的一半加反向散度的一半。",
)}
<pre class="formula">D(p || q) = Σ p(t) · ln( p(t) / q(t) )
D_sym(p, q) = 0.5 · D(p || q) + 0.5 · D(q || p)</pre>
${paragraph(
  "A token that one side omits receives a probability floor of 1e-12 before the normalization. " +
    "One omitted token therefore contributes a large value, and a missing token in the served " +
    "table counts against the self report.",
  "一方没有给出的词块在归一化之前得到 1e-12 的概率下限。因此一个缺失的词块会带来很大的数值，" +
    "接口表格里缺失的词块会对自我报告不利。",
)}
${heading(2, "Statistics", "统计")}
${paragraph(
  `Each comparison pairs every repetition of the actual condition with every repetition of the ` +
    `predicted condition. The run then takes the mean over the tasks, and it bootstraps the ` +
    `interval of that mean with ${metrics.repetitionCount} repetitions per condition and a random ` +
    "seed that the report states.",
  "每个比较把实际条件的每次重复与预测条件的每次重复配对。运行再对任务取均值，并用报告的随机种子对均值做自助法区间估计。",
)}
${paragraph(
  `A verdict is separated when the lower end of the interval stays above ${metrics.toleranceNats} ` +
    `nats. A verdict is indistinguishable when the upper end stays below ${metrics.toleranceNats} ` +
    "nats. Any other interval is inconclusive.",
  `当区间下端高于 ${metrics.toleranceNats} 奈特时，判定为有差异。当区间上端低于 ${metrics.toleranceNats} 奈特时，` +
    "判定为不可区分。其他区间判定为不确定。",
)}
${heading(2, "Recorded conditions", "记录的条件")}
${list(
  [
    {
      english: "The model name, the provider, the plugin version, and the Node.js version.",
      chinese: "模型名、提供方、插件版本和 Node.js 版本。",
    },
    { english: "The random seed and the tolerance of the run.", chinese: "运行的随机种子和容差。" },
    { english: "Each raw request and each raw reply, one file for each call.", chinese: "每个原始请求和每个原始回复，每次调用一个文件。" },
    { english: "The elapsed time of each call, and a warning above 10 seconds.", chinese: "每次调用的耗时，超过 10 秒时给出警告。" },
  ],
  true,
)}
`;
  return renderShell({
    current: "method.html",
    titleEnglish: "Method",
    titleChinese: "方法",
    ledeEnglish: "The dataset, the prompts, the parser, the divergence, and the statistics.",
    ledeChinese: "数据集、提示词、解析器、散度和统计方法。",
    body,
    metrics,
  });
}

/**
 * Count the tasks of one dataset in the records.
 *
 * @param records - the task records.
 * @param datasetId - the dataset identifier.
 * @returns the task count, or 0 when the identifier matches no record.
 */
function countTasksOfDataset(records: readonly TaskRecord[], datasetId: string): number {
  const language = datasetId.includes("-zh") ? "zh" : datasetId.includes("-en") ? "en" : "";
  if (language === "") {
    return 0;
  }
  const ids = new Set(
    records
      .filter((record) => (record.task.language ?? "").startsWith(language))
      .map((record) => record.task.id),
  );
  return ids.size;
}

/**
 * Render the summary page.
 *
 * @param options - the demo options.
 * @returns the HTML document.
 */
function renderSummaryPage(options: DemoOptions): string {
  const { metrics } = options;
  const rows: string[] = [];
  for (const result of metrics.providers) {
    for (const comparison of COMPARISON_NAMES) {
      const summary = result.comparisons.find((entry) => entry.comparison === comparison);
      if (summary === undefined) {
        continue;
      }
      const verdict = verdictOf(summary, metrics.toleranceNats);
      rows.push(
        `<tr><td class="model"><code>${result.providerKey}</code></td><td><code>${comparison}</code>` +
          `</td><td class="number">${formatNumber(summary.meanSymmetricKl)}</td>` +
          `<td class="number">${formatNumber(summary.confidenceInterval.lower)} – ` +
          `${formatNumber(summary.confidenceInterval.upper)}</td>` +
          `<td class="number">${formatNumber(summary.topTokenAgreementRate, 3)}</td>` +
          `<td><span class="verdict verdict-${verdict}">${verdict}</span></td></tr>`,
      );
    }
  }
  const tally = COMPARISON_NAMES.map((comparison) => {
    const counts = { separated: 0, indistinguishable: 0, inconclusive: 0 };
    for (const result of metrics.providers) {
      const summary = result.comparisons.find((entry) => entry.comparison === comparison);
      if (summary === undefined) {
        continue;
      }
      counts[verdictOf(summary, metrics.toleranceNats) as keyof typeof counts] += 1;
    }
    return { comparison, counts };
  });
  const tallyRows = tally.map(
    (entry) =>
      `<tr><td><code>${entry.comparison}</code></td>` +
      `<td class="number">${entry.counts.separated}</td>` +
      `<td class="number">${entry.counts.indistinguishable}</td>` +
      `<td class="number">${entry.counts.inconclusive}</td></tr>`,
  );
  const plainCount = tally[0]?.counts.indistinguishable ?? 0;
  const plainSeparated = tally[0]?.counts.separated ?? 0;
  const stateLine =
    plainCount > plainSeparated
      ? bilingual(
          "In the plain condition, most models fall below the tolerance. This run supports the " +
            "null hypothesis for those models.",
          "在普通条件下，多数模型低于容差。对多数模型而言，本运行支持零假设。",
        )
      : bilingual(
          "In the plain condition, most models stay above the tolerance. This run supports the " +
            "alternative hypothesis for those models.",
          "在普通条件下，多数模型高于容差。对多数模型而言，本运行支持对立假设。",
        );
  const flat = metrics.providers.flatMap((provider) =>
    provider.comparisons.map((entry) => ({
      providerKey: provider.providerKey,
      comparison: entry.comparison,
      value: entry.meanSymmetricKl,
    })),
  );
  const maximum = flat.reduce((highest, entry) => Math.max(highest, entry.value), metrics.toleranceNats);
  const first = flat[0];
  const best =
    first === undefined ? undefined : flat.reduce((low, entry) => (entry.value < low.value ? entry : low), first);
  const worst =
    first === undefined
      ? undefined
      : flat.reduce((high, entry) => (entry.value > high.value ? entry : high), first);
  const barBlocks = metrics.providers
    .map((provider) => {
      const rows = COMPARISON_NAMES.map((comparison) => {
        const entry = provider.comparisons.find((item) => item.comparison === comparison);
        if (entry === undefined) {
          return "";
        }
        const kind =
          comparison === "plain_self"
            ? "symmetric"
            : comparison === "injected_self"
              ? "predicted"
              : "actual";
        return barRow(comparison, entry.meanSymmetricKl, maximum, metrics.toleranceNats, kind);
      }).join("");
      return `${heading(3, provider.providerKey, provider.providerKey)}${rows}`;
    })
    .join("");
  const body = `
${statStrip([
  {
    icon: "🏆",
    value: formatNumber(best === undefined ? undefined : best.value, 3),
    labelEnglish: "smallest mean divergence",
    labelChinese: "最小平均散度",
    kind: "actual",
  },
  {
    icon: "🔺",
    value: formatNumber(worst === undefined ? undefined : worst.value, 3),
    labelEnglish: "largest mean divergence",
    labelChinese: "最大平均散度",
    kind: "predicted",
  },
  {
    icon: "🎯",
    value: formatNumber(metrics.toleranceNats, 2),
    labelEnglish: "tolerance, nats",
    labelChinese: "容差，奈特",
  },
  {
    icon: "🧪",
    value: String(metrics.providers.length),
    labelEnglish: "tested models",
    labelChinese: "被测模型",
  },
])}
<p class="callout">${stateLine}</p>
${heading(2, "Every model on one scale", "所有模型同一标尺")}
${paragraph(
  "Each bar gives the mean symmetric divergence. The dashed line marks the tolerance. A bar " +
    "shorter than the line stays below the tolerance.",
  "每条柱给出平均对称散度。虚线标出容差。短于虚线的柱低于容差。",
)}
${barBlocks}
${heading(2, "Verdict tally", "判定统计")}
${table(
  [
    { english: "Comparison", chinese: "比较" },
    { english: "Separated", chinese: "有差异" },
    { english: "Indistinguishable", chinese: "不可区分" },
    { english: "Inconclusive", chinese: "不确定" },
  ],
  tallyRows,
)}
${heading(2, "Each model", "每个模型")}
${paragraph(
  "Each row gives one comparison of one model. The interval is the task-level bootstrap interval " +
    "of the mean symmetric divergence.",
  "每行给出一个模型的一个比较。区间是均值对称散度的任务级自助法区间。",
)}
${table(
  [
    { english: "Model key", chinese: "模型键" },
    { english: "Comparison", chinese: "比较" },
    { english: "Mean symmetric KL", chinese: "对称 KL 均值" },
    { english: "95% interval", chinese: "95% 区间" },
    { english: "Top-1 agreement", chinese: "首位一致率" },
    { english: "Verdict", chinese: "判定" },
  ],
  rows,
)}
${heading(2, "Divergence by comparison", "各比较的散度")}
${paragraph(
  "The chart shows the mean symmetric divergence of each model. The vertical line marks the " +
    "tolerance.",
  "图表显示每个模型的对称散度均值。竖直虚线标出容差。",
)}
<div class="chart" id="verdict-chart" data-tolerance="${metrics.toleranceNats}"></div>
${heading(2, "Explorer", "浏览器")}
${paragraph(
  "Open the Result Explorer to read one task. It shows the served table and the predicted table " +
    "side by side, and it lists the contribution of each token to the divergence.",
  "打开结果浏览器查看单个任务。它并排显示接口表格和预测表格，并列出每个词块对散度的贡献。",
)}
<p><a class="button" href="explorer.html">${bilingual("Open the explorer", "打开浏览器")}</a></p>
`;
  return renderShell({
    current: "summary.html",
    titleEnglish: "Summary",
    titleChinese: "结果",
    ledeEnglish: "The numbers of this run and the verdict of each comparison.",
    ledeChinese: "本次运行的数字和每个比较的判定。",
    body,
    metrics,
  });
}

/**
 * Render the explorer page.
 *
 * @param options - the demo options.
 * @returns the HTML document.
 */
function renderExplorerPage(options: DemoOptions): string {
  const { metrics } = options;
  const modelOptions = metrics.providers
    .map(
      (provider) =>
        `<option value="${provider.providerKey}">${provider.model} · ${provider.providerKey}</option>`,
    )
    .join("");
  const comparisonOptions = COMPARISON_NAMES.map(
    (comparison) => `<option value="${comparison}">${comparison}</option>`,
  ).join("");
  const body = `
${paragraph(
  "Pick a model, a task, and a comparison, then press Apply. The left pane shows the served " +
    "distribution. The right pane shows the predicted distribution. Each row gives the " +
    "probability and its share of the divergence. The page also updates when a control changes.",
  "选择模型、任务和比较，然后按“应用”。左栏显示接口分布。右栏显示预测分布。每行给出概率及其对散度的贡献。" +
    "控件变化时，页面也会自动更新。",
)}
<div class="explorer-bar">
  <form class="explorer-controls" id="explorer-controls" onsubmit="return false">
    <label>${bilingual("Model", "模型")}<select id="select-model">${modelOptions}</select></label>
    <label>${bilingual("Comparison", "比较")}<select id="select-comparison">${comparisonOptions}</select></label>
    <label>${bilingual("Task", "任务")}<select id="select-task"></select></label>
    <label>${bilingual("Actual repetition", "实际重复")}<select id="select-actual"></select></label>
    <label>${bilingual("Predicted repetition", "预测重复")}<select id="select-predicted"></select></label>
    <label class="checkbox">${bilingual("Compare two tasks", "对比两个任务")}
      <input type="checkbox" id="toggle-compare">
    </label>
    <label id="label-task-b" hidden>${bilingual("Second task", "第二个任务")}
      <select id="select-task-b"></select>
    </label>
  </form>
  <div class="button-row">
    <button class="primary" type="button" id="apply-selection">${bilingual("Apply", "应用")}</button>
    <button class="ghost" type="button" id="reset-selection">${bilingual("Reset", "重置")}</button>
  </div>
</div>
<p class="status-line" id="explorer-status"></p>
<div class="stat-strip" id="explorer-stats"></div>
<div class="legend">
  <span class="key"><span class="dot actual"></span>${bilingual("Served", "接口")}</span>
  <span class="key"><span class="dot predicted"></span>${bilingual("Predicted", "预测")}</span>
  <span class="key"><span class="dot symmetric"></span>${bilingual("Divergence share", "散度贡献")}</span>
</div>
<div class="detail-grid" id="detail-grid">
  <section class="detail-pane" id="pane-a"></section>
  <section class="detail-pane" id="pane-b"></section>
  <section class="detail-pane" id="pane-c" hidden></section>
  <section class="detail-pane" id="pane-d" hidden></section>
</div>
${heading(2, "How to read a pane", "如何读一栏")}
${list([
  {
    english: "Probability: the normalized probability of the token in that distribution.",
    chinese: "概率：该词块在该分布中归一化后的概率。",
  },
  {
    english: "Share: the part of the symmetric divergence that this token contributes.",
    chinese: "贡献：该词块对对称散度的贡献份额。",
  },
  {
    english: "Missing: the token does not appear in that distribution, so it takes the floor.",
    chinese: "缺失：该词块不在该分布中，因此取概率下限。",
  },
  {
    english: "Badge: green is below 0.05 nats, amber is below 0.5 nats, red is at or above 0.5.",
    chinese: "徽标：绿色低于 0.05 奈特，琥珀色低于 0.5 奈特，红色为 0.5 奈特或更高。",
  },
])}
`;
  return renderShell({
    current: "explorer.html",
    titleEnglish: "Result Explorer",
    titleChinese: "结果浏览器",
    ledeEnglish: "Two panes, one task, and every token contribution.",
    ledeChinese: "双栏、单任务、每个词块的贡献。",
    body,
    metrics,
  });
}


/**
 * Render the course and debate page.
 *
 * @param options - the demo options.
 * @returns the HTML document.
 */
function renderContextPage(options: DemoOptions): string {
  const body = `
${heading(2, "Why I built this", "我为什么做这个实验")}
${paragraph(
  "The course asks a hard question: does a large language model have anything like a self? I " +
    "cannot answer that question with a definition. I can measure one narrow, checkable part of " +
    "it. If a model holds a distribution over the next token, and if it can also report that " +
    "distribution, then the model carries a usable model of its own computation. If it cannot, " +
    "then the phrase the model knows itself needs a narrower meaning.",
  "课程提出一个很难的问题：大模型有没有类似自我的东西？我不能用定义回答这个问题，但可以测量其中一个狭窄且可检验的部分。" +
    "如果模型持有下一个词块的分布，并且也能报告这个分布，那么模型就带有自己计算过程的可用的模型。" +
    "如果做不到，那么模型认识自己这句话就需要更窄的含义。",
)}
${paragraph(
  "The gap between the two is the measurement. That is the whole experiment: no introspection " +
    "claim, no consciousness claim, one number with an interval.",
  "两者之间的差距就是测量结果。整个实验只有这个：不主张内省，不主张意识，只给出一个带区间的数字。",
)}
${heading(2, "Course topics", "课程主题")}
${paragraph(
  "The course module Understanding LLMs builds the pipeline of a decoder: tokenize, embed, " +
    "attend, feed forward, decode one token at a time. Next-token prediction is the loop of that " +
    "pipeline. This experiment reads the output of the loop in two ways, once from the interface " +
    "and once from the model as text.",
  "课程模块《理解大模型》讲清解码器的流程：分词、嵌入、注意力、前馈、逐个解码。下一个词块预测就是这个流程的循环。" +
    "本实验用两种方式读取该循环的输出：一次从接口读，一次让模型用文字写出。",
)}
${paragraph(
  "The module Seventy Years at a Glance sorts the literature by question. The third question is " +
    "does it know itself. This experiment turns that question into a protocol with four " +
    "conditions, three repetitions, and one divergence.",
  "模块《研究全景》按问题给文献分类。第三个问题是它认得自己吗。本实验把这个问题变成一个协议：" +
    "四个条件、三次重复、一个散度。",
)}
${paragraph(
  "The module Are LLMs Conscious separates the whole question into parts: the whole picture, the " +
    "self, the stake, and measuring it. This experiment belongs to the last part. It measures a " +
    "capability, and it states no position on experience.",
  "模块《大模型有意识吗》把整个问题拆成几部分：整体图景、自我、利害、一起去量。本实验属于最后一部分。" +
    "它测量一项能力，不对体验表态。",
)}
${paragraph(
  "The modules on consciousness theory and on the Turing test give two habits that this " +
    "experiment keeps. First, a claim about a machine needs an operational test. Second, a test " +
  "measures the test and not the thing behind it.",
  "意识理论与图灵测试两个模块给出两个习惯，本实验都保留。第一，关于机器的判断需要可操作的检验。" +
    "第二，检验测量的是检验本身，不是它背后的东西。",
)}
${heading(2, "Debate topics", "辩论主题")}
${paragraph(
  "The debate class runs two rounds, one technical and one beyond technology, and every motion " +
    "asks for a position that a measurement can inform but cannot settle. Three motions sit close " +
    "to this experiment.",
  "辩论课有两场，一场技术向，一场非技术向。每道辩题都要求一个立场，测量可以支持这个立场，但不能决定它。三道辩题与本实验接近。",
)}
${list([
  {
    english:
      "Motion: a model that reports its own distribution understands itself. The experiment " +
      "supplies the first half of the premise and refuses the second half.",
    chinese: "辩题：能报告自己分布的模型理解自己。实验提供前提的前半部分，不对后半部分表态。",
  },
  {
    english:
      "Motion: self-report is evidence of inner life. The experiment shows that self-report can " +
      "be measured and can be wrong, so the motion needs a further step.",
    chinese: "辩题：自我报告是内在生命的证据。实验表明自我报告可以被测量，也可能出错，因此该辩题还需要一步论证。",
  },
  {
    english:
      "Motion: we should trust a model about its own computation more than we trust its output. " +
      "The divergence between the two is the quantity that the motion needs.",
    chinese: "辩题：关于自己的计算，我们应该更相信模型的说明，而不是它的输出。两者之间的散度正是该辩题需要的量。",
  },
])}
${heading(2, "Final requirements", "期末要求")}
${paragraph(
  "The final assessment asks for a paper that is complete, deep, and new, and for a four-minute " +
    "talk that states one finding. This site supports both. The Summary page gives the finding, " +
    "the Method page gives the procedure, and the Result Explorer gives the evidence for one case " +
    "at the finest detail that the run records.",
  "期末考核要求一篇记得全、想得深、做得新的论文，以及一个说明一个发现的四分钟报告。本网站支持这两项。" +
    "结果页给出发现，方法页给出流程，结果浏览器给出单个案例的最细证据。",
)}
${callout(
  "The site states one finding per comparison. It does not claim that a model is conscious, and " +
    "it does not claim that a model is not conscious.",
  "网站对每个比较只给出一个发现。它不主张模型有意识，也不主张模型没有意识。",
)}
`;
  return renderShell({
    current: "context.html",
    titleEnglish: "Course and Debates",
    titleChinese: "课程与辩论",
    ledeEnglish: "How this run connects to the lectures, the debates, and the final assessment.",
    ledeChinese: "本运行与课程、辩论和期末考核的关系。",
    body,
    metrics: options.metrics,
  });
}

/**
 * Render the implementation page.
 *
 * @param options - the demo options.
 * @returns the HTML document.
 */
function renderImplementationPage(options: DemoOptions): string {
  const { metrics, environment } = options;
  const body = `
${heading(2, "The platform", "平台")}
${paragraph(
  "The platform is a plugin of DeepSeek Harness, a terminal and web harness that hosts tools and " +
    "agent presets. The plugin registers five tools and one command line. A run is one tool call " +
    "or one command, and the run writes a directory that holds every input and every output.",
  "平台是 DeepSeek Harness 的插件。DeepSeek Harness 是承载工具和智能体预设的终端与网页运行环境。" +
    "插件注册五个工具和一套命令行。一次运行是一次工具调用或一条命令，运行写出的目录保存每个输入和每个输出。",
)}
${list([
  {
    english: `llm_self_prediction_run: run the four conditions on a set of tasks.`,
    chinese: "llm_self_prediction_run：对一组任务运行四个条件。",
  },
  {
    english: "llm_self_prediction_status: list the recent runs of the output root.",
    chinese: "llm_self_prediction_status：列出输出根目录下最近的运行。",
  },
  {
    english: "llm_self_prediction_report: read the Markdown report of one run.",
    chinese: "llm_self_prediction_report：读取一次运行的 Markdown 报告。",
  },
  {
    english: "llm_self_prediction_dataset: describe the packaged datasets.",
    chinese: "llm_self_prediction_dataset：说明随包的数据集。",
  },
  {
    english: "llm_self_prediction_help: print the protocol and the file layout.",
    chinese: "llm_self_prediction_help：打印协议与文件布局。",
  },
])}
${heading(2, "Preset creation", "预设的创建")}
${paragraph(
  "The experiment compares many models with one protocol, so the work splits into three agent " +
    "roles. A planner reads the design and writes the task list. An operator runs the conditions " +
    "and keeps each raw reply. A reviewer checks the report against the records and states the " +
    "defects.",
  "本实验用同一协议比较多个模型，因此工作分为三种智能体角色。规划者读设计并写出任务清单。操作者运行各条件并保存每次原始回复。" +
    "审阅者把报告与记录对照，指出缺陷。",
)}
${paragraph(
  "Each role gets its own preset with three parts: a system prompt that states the role, a tool " +
    "allow list that limits what the role can do, and an output contract that names the files the " +
    "role must write. The preset is data, so the run records the preset version next to the " +
    "result.",
  "每个角色有自己的预设，预设分三部分：说明角色的系统提示词、限制角色权限的工具白名单、规定角色必须写哪些文件的输出契约。" +
    "预设是数据，因此运行会把预设版本与结果一起记录。",
)}
${heading(2, "Providers", "模型提供方")}
${paragraph(
  "The run reaches each model through an OpenAI-compatible chat endpoint. The plain actual " +
    "condition sets logprobs and top_logprobs. The self conditions send no log-probability " +
    "parameter at all, so the model must write the table as text.",
  "运行通过兼容 OpenAI 的对话接口访问每个模型。普通实际条件设置 logprobs 与 top_logprobs。" +
    "自我条件完全不发送对数概率参数，因此模型必须用文字写出表格。",
)}
${heading(2, "This run", "本次运行")}
${table(
  [
    { english: "Item", chinese: "项目" },
    { english: "Value", chinese: "值" },
  ],
  [
    `<tr><td>Plugin</td><td><code>${PLUGIN_NAME} ${PLUGIN_VERSION}</code></td></tr>`,
    `<tr><td>Node.js</td><td><code>${environment.nodeVersion}</code> on ` +
    `<code>${environment.platform}</code></td></tr>`,
    `<tr><td>Started</td><td><code>${environment.startedAt}</code></td></tr>`,
    `<tr><td>Finished</td><td><code>${environment.finishedAt}</code></td></tr>`,
    `<tr><td>Elapsed</td><td>${environment.elapsedSeconds} s</td></tr>`,
    `<tr><td>Seed</td><td><code>${environment.randomSeed}</code></td></tr>`,
    `<tr><td>Tolerance</td><td>${metrics.toleranceNats} nats</td></tr>`,
    `<tr><td>Repetitions</td><td>${metrics.repetitionCount}</td></tr>`,
    `<tr><td>Table entries</td><td>${metrics.topLogprobsCount}</td></tr>`,
  ],
)}
${heading(2, "File layout", "文件布局")}
<pre class="tree">outputs/${metrics.xid}/
  run.json            the manifest of the run
  tasks.json          the selected tasks
  task-summary.json   the table of each condition and each call
  intermediate/       each raw request and each raw reply
  results/            metrics, records, report, and tables
  demos/              this website</pre>
`;
  return renderShell({
    current: "implementation.html",
    titleEnglish: "Platform",
    titleChinese: "平台实现",
    ledeEnglish: "How the plugin, the presets, and the providers produce this run.",
    ledeChinese: "插件、预设与提供方如何产生本次运行。",
    body,
    metrics,
  });
}

/**
 * Render the meaning and limits page.
 *
 * @param options - the demo options.
 * @returns the HTML document.
 */
function renderMeaningPage(options: DemoOptions): string {
  const body = `
${heading(2, "What a small divergence means", "小散度说明什么")}
${paragraph(
  "A small divergence in the plain condition means that the text table of the model matches the " +
    "served table at the resolution of the measurement. That is a statement about a capability: " +
    "the model can report its own distribution. It is not a statement about experience, and it is " +
    "not a statement about access to the computation that produced the distribution.",
  "普通条件下的小散度表示：在本次测量的分辨率下，模型写出的文字表格与接口表格一致。" +
    "这是关于能力的一句话：模型能报告自己的分布。它不是关于体验的论断，也不是关于能访问产生该分布的计算过程的论断。",
)}
${heading(2, "What a large divergence means", "大散度说明什么")}
${paragraph(
  "A large divergence in the plain condition means that the model cannot state its own " +
    "distribution. The model can still produce the distribution, because the interface reads it " +
    "at each step. The gap between producing and reporting is the measured quantity.",
  "普通条件下的大散度表示：模型无法说出自己的分布。模型仍然能产生该分布，因为接口在每一步读取它。产生与报告之间的差距就是被测量的量。",
)}
${heading(2, "The injection comparisons", "注入比较")}
${paragraph(
  "The injected self condition controls for the mechanics of the task. If the model copies the " +
    "served table with little error, then a large divergence in the plain condition comes from " +
    "the model and not from the difficulty of writing a table.",
  "注入自我条件控制了任务的机械难度。如果模型几乎无误差地复制接口表格，那么普通条件下的大散度来自模型本身，" +
    "而不是来自写表格的难度。",
)}
${paragraph(
  "The injected actual condition tests influence in the other direction. A small divergence means " +
    "that the model ignores the self-predicted table when it predicts. A large divergence means " +
    "that the table moves the prediction.",
  "注入实际条件检验相反方向的影响。小散度表示模型在预测时忽略了自我预测表格。大散度表示该表格改变了预测。",
)}
${heading(2, "Limits", "局限")}
${list([
  {
    english:
      "The measurement covers one token at one position. It says nothing about a long reply.",
    chinese: "测量只覆盖一个位置的一个词块。它不涉及长回复。",
  },
  {
    english:
      "The table holds the top entries only. A model that reports the top entries well can still " +
      "hold a different tail.",
    chinese: "表格只保存前若干条目。报告好前若干条目的模型，尾部仍然可能不同。",
  },
  {
    english:
      "The tokenizer is invisible to the model. A word that the tokenizer cuts into pieces " +
      "limits the exact match of the top token.",
    chinese: "分词器对模型不可见。被切成片段的词会限制首位词块的精确一致。",
  },
  {
    english:
      "The floor of 1e-12 exaggerates one missing token. The report shows the coverage so that a " +
      "reader can see this effect.",
    chinese: "1e-12 的概率下限会放大单个缺失词块的影响。报告给出覆盖率，读者可以看出这一影响。",
  },
  {
    english:
      "A provider can serve a quantized or a routed variant of a model. The recorded model name " +
      "is the name that the provider reports.",
    chinese: "提供方可能提供量化版本或路由版本。记录的模型名是提供方报告的模型名。",
  },
  {
    english:
      "The repetition count is small. The interval covers the sampling of tasks and repetitions " +
      "in this run, and no other source of variation.",
    chinese: "重复次数较少。区间只覆盖本次运行的任务抽样与重复抽样，不覆盖其他变异来源。",
  },
])}
${heading(2, "Future work", "未来工作")}
${list([
  {
    english: "Measure a whole reply, one position at a time, and compare the error along it.",
    chinese: "逐个位置测量一整段回复，并比较误差沿回复的变化。",
  },
  {
    english: "Ask for the tail as well as the head, with a second prompt for rare tokens.",
    chinese: "除头部外也询问尾部，用第二个提示词覆盖稀有词块。",
  },
  {
    english: "Vary the temperature and the reasoning setting, and report each cell.",
    chinese: "改变温度与推理开关，逐格报告结果。",
  },
  {
    english:
      "Give the model its own served table and ask it to explain the difference from its " +
      "self-report.",
    chinese: "把接口表格给模型，让它解释与自我报告的差异。",
  },
])}
`;
  return renderShell({
    current: "meaning.html",
    titleEnglish: "Meaning and Limits",
    titleChinese: "意义与局限",
    ledeEnglish: "What these numbers show, what they do not show, and what to measure next.",
    ledeChinese: "这些数字说明什么，不说明什么，下一步测什么。",
    body,
    metrics: options.metrics,
  });
}

/**
 * Build the shared style sheet.
 *
 * @returns the CSS text.
 */
function buildStyleSheet(): string {
  return `:root {
  --paper: #fbfaf7;
  --ink: #1f1e1c;
  --muted: #5f5b53;
  --rule: #d9d3c7;
  --accent: #7a2233;
  --accent-soft: #f2e6e8;
  --actual: #1b4a6b;
  --predicted: #8a5a12;
  --serif: Cambria, "Source Serif 4", "Noto Serif SC", "Songti SC", SimSun, serif;
  --mono: "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Courier New", monospace;
  --math: "XITS Math", "Cambria Math", "STIX Two Math", Cambria, serif;
}

* { box-sizing: border-box; }

html { background: var(--paper); }

body {
  margin: 0;
  color: var(--ink);
  font-family: var(--serif);
  font-size: 17px;
  line-height: 1.62;
}

span[data-lang][hidden] { display: none; }

.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(251, 250, 247, 0.96);
  border-bottom: 1px solid var(--rule);
  backdrop-filter: blur(6px);
}

.topbar-inner {
  display: flex;
  gap: 18px;
  align-items: center;
  max-width: 1180px;
  margin: 0 auto;
  padding: 10px 22px;
}

.brand { display: flex; gap: 10px; align-items: baseline; flex: 1 1 auto; min-width: 0; }

.brand-mark {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.12em;
  color: var(--paper);
  background: var(--accent);
  padding: 2px 7px;
  border-radius: 3px;
}

.brand-text { font-size: 14px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.nav { display: flex; gap: 4px; flex-wrap: wrap; }

.nav a {
  color: var(--muted);
  text-decoration: none;
  font-size: 14px;
  padding: 5px 9px;
  border-radius: 4px;
}

.nav a:hover { background: var(--accent-soft); color: var(--accent); }
.nav a.active { color: var(--accent); border-bottom: 2px solid var(--accent); border-radius: 0; }

.lang-toggle {
  font-family: var(--serif);
  font-size: 13px;
  color: var(--muted);
  background: transparent;
  border: 1px solid var(--rule);
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
}

.page { max-width: 1180px; margin: 0 auto; padding: 34px 22px 60px; }

.eyebrow { font-family: var(--mono); font-size: 12px; color: var(--muted); letter-spacing: 0.04em; margin: 0 0 6px; }

h1 { font-size: 34px; line-height: 1.2; margin: 0 0 10px; font-weight: 600; }
h2  {
  font-size: 23px;
  margin: 42px 0 10px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--rule);
  font-weight: 600;
}
h3 { font-size: 17px; margin: 20px 0 6px; font-weight: 600; }
h4 { font-size: 15px; margin: 16px 0 4px; }

p { margin: 0 0 12px; }
.lede { font-size: 19px; color: var(--muted); max-width: 60ch; margin-bottom: 26px; }

a { color: var(--accent); }

code { font-family: var(--mono); font-size: 0.86em; background: #f1eee7; padding: 1px 4px; border-radius: 3px; }

ul, ol { margin: 0 0 14px; padding-left: 24px; }
li { margin-bottom: 6px; }

table { border-collapse: collapse; width: 100%; margin: 10px 0 20px; font-size: 15px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { font-weight: 600; font-size: 13px; letter-spacing: 0.02em; color: var(--muted); background: #f5f2ea; }
td.number, th.number { text-align: right; font-family: var(--mono); font-size: 13px; }
tbody tr:hover { background: #f7f4ec; }

.callout {
  border-left: 3px solid var(--accent);
  background: var(--accent-soft);
  padding: 12px 16px;
  margin: 18px 0;
  font-size: 16px;
}

.condition-grid  {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
  margin: 16px 0 24px;
}
.condition-card { border: 1px solid var(--rule); border-radius: 5px; padding: 12px 14px; background: #fffdf8; }
.condition-card h3 { margin-top: 0; font-family: var(--mono); font-size: 14px; color: var(--accent); }
.condition-card p { font-size: 15px; margin: 0; }

.stat-row  {
  display: flex;
  flex-wrap: wrap;
  gap: 26px;
  list-style: none;
  padding: 14px 0;
  margin: 12px 0 22px;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
}
.stat-row li { font-size: 13px; color: var(--muted); margin: 0; }
.stat-value { display: block; font-family: var(--mono); font-size: 22px; color: var(--ink); }

.formula  {
  font-family: var(--math);
  font-size: 16px;
  background: #f5f2ea;
  border: 1px solid var(--rule);
  border-radius: 4px;
  padding: 12px 14px;
  overflow-x: auto;
}
.tree  {
  font-family: var(--mono);
  font-size: 13px;
  background: #f5f2ea;
  border: 1px solid var(--rule);
  border-radius: 4px;
  padding: 12px 14px;
  overflow-x: auto;
}

.button  {
  display: inline-block;
  background: var(--accent);
  color: #fff;
  text-decoration: none;
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 15px;
}
.button:hover { background: #611a28; }

.verdict { font-family: var(--mono); font-size: 12px; padding: 2px 6px; border-radius: 3px; }
.verdict-separated { background: #f6e3d6; color: #8a3b12; }
.verdict-indistinguishable { background: #dfeee0; color: #1f5d2a; }
.verdict-inconclusive { background: #ece9e0; color: var(--muted); }

.explorer-controls  {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
  align-items: end;
  padding: 14px;
  border: 1px solid var(--rule);
  border-radius: 5px;
  background: #fffdf8;
  margin: 16px 0 8px;
}
.explorer-controls label  {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  letter-spacing: 0.02em;
}
.explorer-controls label.checkbox { flex-direction: row; align-items: center; gap: 8px; }
.explorer-controls select  {
  font-family: var(--serif);
  font-size: 14px;
  padding: 5px 7px;
  border: 1px solid var(--rule);
  border-radius: 3px;
  background: #fff;
  min-width: 150px;
  max-width: 320px;
}
.status-line { font-family: var(--mono); font-size: 12px; color: var(--muted); margin: 6px 0 14px; }

.detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 16px; }
.detail-pane  {
  border: 1px solid var(--rule);
  border-radius: 5px;
  background: #fffdf8;
  padding: 12px 14px;
  min-width: 0;
}
.detail-pane h4 { margin-top: 0; font-family: var(--mono); font-size: 13px; letter-spacing: 0.04em; }
.detail-pane .prefix { font-size: 15px; background: #f5f2ea; border-radius: 3px; padding: 8px 10px; margin: 0 0 10px; }
.detail-pane .metric-row  {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 10px;
}
.detail-pane .metric-row b { color: var(--ink); font-weight: 600; }
.detail-pane table { margin: 0; font-size: 13px; }
.detail-pane td, .detail-pane th { padding: 4px 8px; }
.bar { display: inline-block; height: 8px; border-radius: 2px; background: var(--actual); vertical-align: middle; }
.bar.predicted { background: var(--predicted); }
.bar.missing { background: #c9c2b4; }
.bar.share { background: var(--accent); }
.flow {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  list-style: none;
  padding: 0;
  margin: 18px 0;
}
.flow li { background: #fff; border: 1px solid #e3dccd; border-top: 3px solid var(--accent); border-radius: 4px; padding: 10px 12px; }
.flow .step { font-family: "Cascadia Mono", Consolas, monospace; color: var(--accent); font-size: 12px; }
.flow .title { display: block; font-weight: 600; margin: 2px 0 4px; }
.flow .detail { color: #5a5346; font-size: 14px; }
.token-cell { font-family: var(--mono); white-space: pre; }
.share { font-family: var(--mono); font-size: 12px; color: var(--muted); }

.chart { min-height: 40px; }

/* The stat strip and the visual blocks. */
.stat-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin: 18px 0 22px;
}
.stat-card {
  border: 1px solid var(--rule);
  border-top: 3px solid var(--accent);
  border-radius: 4px;
  background: #fffdf9;
  padding: 10px 12px;
}
.stat-card .stat-icon { font-size: 18px; line-height: 1.2; }
.stat-card .stat-value {
  display: block;
  font-family: var(--mono);
  font-size: 20px;
  font-weight: 600;
  color: var(--accent);
  line-height: 1.25;
}
.stat-card .stat-label { display: block; font-size: 12px; color: var(--muted); }
.stat-card.actual { border-top-color: var(--actual); }
.stat-card.actual .stat-value { color: var(--actual); }
.stat-card.predicted { border-top-color: var(--predicted); }
.stat-card.predicted .stat-value { color: var(--predicted); }

.badge {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 9px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid transparent;
}
.badge.ok { background: #e5f2e9; border-color: #a9cfb6; color: #1f5c33; }
.badge.bad { background: #fbe9e7; border-color: #e0a9a2; color: #8a2b1d; }
.badge.warn { background: #fbf1dd; border-color: #ddc187; color: #7a5a12; }
.badge.info { background: #e9eef4; border-color: #b6c4d4; color: #274a63; }

.bar-row { display: grid; grid-template-columns: 220px 1fr 76px; gap: 10px; align-items: center; }
.bar-track {
  display: block;
  background: #efe9dc;
  border-radius: 3px;
  height: 12px;
  position: relative;
  min-width: 120px;
}
.bar-fill { display: block; height: 12px; border-radius: 3px; background: var(--actual); }
.bar-fill.predicted { background: var(--predicted); }
.bar-fill.symmetric { background: var(--accent); }
.bar-value { font-family: var(--mono); font-size: 12px; text-align: right; }
.tolerance-line {
  position: absolute;
  top: -4px;
  bottom: -4px;
  border-left: 2px dashed var(--accent);
}

table.zebra tbody tr:nth-child(even) { background: #fbf8f1; }
table.zebra td.model code { font-size: 12px; }
.number.good { color: #1f5c33; font-weight: 600; }
.number.bad { color: #8a2b1d; font-weight: 600; }
.number.mid { color: #7a5a12; font-weight: 600; }

.legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 13px; color: var(--muted); margin: 6px 0 12px; }
.legend span.key { display: inline-flex; align-items: center; gap: 6px; }
.legend span.dot { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
.dot.actual { background: var(--actual); }
.dot.predicted { background: var(--predicted); }
.dot.symmetric { background: var(--accent); }

.explorer-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: end;
  border: 1px solid var(--rule);
  border-radius: 5px;
  background: #fffdf9;
  padding: 12px 14px;
  margin: 14px 0 10px;
}
.explorer-controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
.explorer-controls label { display: flex; flex-direction: column; font-size: 12px; color: var(--muted); gap: 3px; }
.explorer-controls select, .explorer-controls input[type="text"] {
  font-family: var(--mono);
  font-size: 12px;
  padding: 4px 6px;
  border: 1px solid #cfc7b8;
  border-radius: 3px;
  background: #fff;
  min-width: 150px;
  max-width: 320px;
}
.button-row { display: flex; gap: 8px; }
button.primary, button.ghost {
  font-family: inherit;
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid var(--accent);
}
button.primary { background: var(--accent); color: #fff; }
button.primary:hover { background: #8f2b3e; }
button.ghost { background: transparent; color: var(--accent); }
.status-line.ok { color: #1f5c33; }
.status-line.bad { color: #8a2b1d; }
.url-hint { font-family: var(--mono); font-size: 12px; color: var(--muted); }

.page-footer  {
  max-width: 1180px;
  margin: 0 auto;
  padding: 22px;
  border-top: 1px solid var(--rule);
  color: var(--muted);
  font-size: 13px;
}

@media (max-width: 720px) {
  .topbar-inner { flex-wrap: wrap; }
  .nav { order: 3; width: 100%; }
  h1 { font-size: 27px; }
}
`;
}

/**
 * Build the shared browser script.
 *
 * @returns the JavaScript text.
 */
function buildBrowserScript(): string {
  return `(function () {
  "use strict";

  var storageKey = "llm-self-prediction-language";
  var stored = null;
  try { stored = window.localStorage.getItem(storageKey); } catch (error) { stored = null; }
  var language = stored === "zh" ? "zh" : "en";

  function applyLanguage(next) {
    language = next;
    document.documentElement.setAttribute("data-lang", next);
    document.documentElement.setAttribute("lang", next === "zh" ? "zh-Hans" : "en");
    var nodes = document.querySelectorAll("[data-lang]");
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      if (node.tagName === "HTML") { continue; }
      if (node.getAttribute("data-lang") === next) { node.removeAttribute("hidden"); }
      else { node.setAttribute("hidden", ""); }
    }
    try { window.localStorage.setItem(storageKey, next); } catch (error) { /* ignore */ }
  }

  applyLanguage(language);

  var toggle = document.getElementById("lang-toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      applyLanguage(language === "zh" ? "en" : "zh");
    });
  }

  function pickEnglish() { return language === "en"; }
  function text(english, chinese) { return pickEnglish() ? english : chinese; }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var element = document.createElement("script");
      element.src = url;
      element.async = true;
      element.onload = function () { resolve(); };
      element.onerror = function () { reject(new Error("Cannot load " + url)); };
      document.head.appendChild(element);
    });
  }

  var modelCache = {};

  function loadModelIndex() {
    if (window.LLM_SP_INDEX) { return Promise.resolve(window.LLM_SP_INDEX); }
    return loadScript("assets/data-index.js").then(function () { return window.LLM_SP_INDEX; });
  }

  function loadModel(entry) {
    if (modelCache[entry.file]) { return Promise.resolve(modelCache[entry.file]); }
    window.LLM_SP_MODEL = undefined;
    return loadScript("assets/" + entry.file).then(function () {
      modelCache[entry.file] = window.LLM_SP_MODEL;
      return window.LLM_SP_MODEL;
    });
  }

  function probability(logProbability) {
    return Math.exp(logProbability);
  }

  function align(left, right) {
    var map = {};
    var order = [];
    function add(entries, side) {
      for (var index = 0; index < entries.length; index += 1) {
        var token = entries[index][0];
        if (!map[token]) { map[token] = { token: token, left: null, right: null }; order.push(token); }
        map[token][side] = entries[index][1];
      }
    }
    add(left, "left");
    add(right, "right");
    return order.map(function (token) { return map[token]; });
  }

  var floor = 1e-12;

  function normalize(values) {
    var total = 0;
    for (var index = 0; index < values.length; index += 1) { total += values[index]; }
    if (total <= 0) { return values.map(function () { return 0; }); }
    return values.map(function (value) { return value / total; });
  }

  function contributions(leftEntries, rightEntries) {
    var rows = align(leftEntries, rightEntries);
    var leftValues = normalize(rows.map(function (row) {
      return row.left === null ? floor : Math.exp(row.left);
    }));
    var rightValues = normalize(rows.map(function (row) {
      return row.right === null ? floor : Math.exp(row.right);
    }));
    var total = 0;
    var items = rows.map(function (row, index) {
      var p = leftValues[index];
      var q = rightValues[index];
      var forward = p > 0 ? p * Math.log(p / q) : 0;
      var backward = q > 0 ? q * Math.log(q / p) : 0;
      var share = 0.5 * forward + 0.5 * backward;
      total += share;
      return {
        token: row.token,
        left: row.left,
        right: row.right,
        leftProbability: p,
        rightProbability: q,
        share: share
      };
    });
    items.sort(function (a, b) { return b.share - a.share; });
    return { items: items, total: total };
  }

  function formatNumber(value, digits) {
    if (value === null || value === undefined || !isFinite(value)) { return "n/a"; }
    return Number(value).toFixed(digits === undefined ? 4 : digits);
  }

  function bar(value, maximum, kind) {
    var width = maximum > 0 ? Math.max(1, Math.round((value / maximum) * 90)) : 1;
    return '<span class="bar ' + kind + '" style="width:' + width + 'px"></span>';
  }

  function renderPane(titleText, task, actualEntry, predictedEntry, comparison, emphasis) {
    var computed = contributions(actualEntry.entries, predictedEntry.entries);
    var maximumShare = computed.items.length > 0 ? computed.items[0].share : 0;
    var ordered = computed.items.slice();
    ordered.sort(function (left, right) {
      var leftValue = emphasis === "predicted" ? left.rightProbability : left.leftProbability;
      var rightValue = emphasis === "predicted" ? right.rightProbability : right.leftProbability;
      return rightValue - leftValue;
    });
    var rows = ordered.slice(0, 30).map(function (item) {
      var leftText = item.left === null
        ? '<span class="share">' + text("missing", "缺失") + '</span>'
        : formatNumber(item.leftProbability, 5);
      var rightText = item.right === null
        ? '<span class="share">' + text("missing", "缺失") + '</span>'
        : formatNumber(item.rightProbability, 5);
      var leftBar = item.left === null
        ? '<span class="bar missing" style="width:2px"></span>'
        : bar(item.leftProbability, 1, "");
      var rightBar = item.right === null
        ? '<span class="bar missing" style="width:2px"></span>'
        : bar(item.rightProbability, 1, "predicted");
      var shareBar = bar(item.share, maximumShare, "share");
      return '<tr><td class="token-cell">' + escapeHtml(item.token) + '</td>' +
        '<td class="number">' + leftText + ' ' + leftBar + '</td>' +
        '<td class="number">' + rightText + ' ' + rightBar + '</td>' +
        '<td class="number ' + numberClass(item.share) + '">' +
        formatNumber(item.share, 4) + ' ' + shareBar + '</td></tr>';
    }).join("");
    var summary = comparison || {};
    var badge = '<span class="badge ' + verdictKind(summary.symmetricKl) + '">' +
      formatNumber(summary.symmetricKl, 3) + ' nats</span>';
    return '<h4>' + escapeHtml(titleText) + '</h4>' +
      '<p class="prefix">' + escapeHtml(task.prefix) +
      '<b>' + escapeHtml(task.referenceToken) + '</b></p>' +
      '<div class="metric-row">' +
      '<span>📋 <b>' + escapeHtml(task.id) + '</b></span>' +
      '<span>🏷️ ' + escapeHtml(task.category) + '</span>' +
      '<span>' + badge + '</span>' +
      '<span>KL(A‖P) <b>' + formatNumber(summary.klActualPredicted, 3) + '</b></span>' +
      '<span>KL(P‖A) <b>' + formatNumber(summary.klPredictedActual, 3) + '</b></span>' +
      '<span>JS <b>' + formatNumber(summary.jensenShannon, 3) + '</b></span>' +
      '<span>TV <b>' + formatNumber(summary.totalVariation, 3) + '</b></span>' +
      '<span>🕳️ <b>' + formatNumber(summary.coveragePredictedByActual, 3) + '</b></span>' +
      '<span>🧮 <b>' + formatNumber(computed.total, 3) + '</b></span>' +
      '</div>' +
      '<p class="url-hint">' +
      (emphasis === "predicted"
        ? text("Rows sorted by the predicted probability.", "按预测概率排序。")
        : text("Rows sorted by the served probability.", "按接口概率排序。")) +
      '</p>' +
      '<table class="zebra"><thead><tr>' +
      '<th>' + text("Token", "词块") + '</th>' +
      '<th class="number">' + text("Served", "接口") + '</th>' +
      '<th class="number">' + text("Predicted", "预测") + '</th>' +
      '<th class="number">' + text("Share", "贡献") + '</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function findComparison(task, comparisonName, actualRepetition, predictedRepetition) {
    var values = task.comparisons[comparisonName] || [];
    for (var index = 0; index < values.length; index += 1) {
      var value = values[index];
      if (value.actualIndex === actualRepetition && value.predictedIndex === predictedRepetition) {
        return value;
      }
    }
    return values[0];
  }

  function prediction(task, condition, repetition) {
    var values = task.runs[condition] || [];
    for (var index = 0; index < values.length; index += 1) {
      if (values[index].rep === repetition) { return values[index]; }
    }
    return values[0];
  }

  function whichKeys(comparisonName) {
    if (comparisonName === "plain_self") { return { actual: "plain_actual", predicted: "plain_self" }; }
    if (comparisonName === "injected_self") { return { actual: "plain_actual", predicted: "injected_self" }; }
    return { actual: "plain_actual", predicted: "injected_actual" };
  }

  function fillSelect(select, values, labelOf) {
    select.innerHTML = "";
    for (var index = 0; index < values.length; index += 1) {
      var option = document.createElement("option");
      option.value = String(values[index]);
      option.textContent = labelOf ? labelOf(values[index]) : String(values[index]);
      select.appendChild(option);
    }
  }

  function verdictKind(value) {
    if (!isFinite(value)) { return "warn"; }
    return value >= 0.5 ? "bad" : (value >= 0.05 ? "warn" : "ok");
  }

  function numberClass(value) {
    if (!isFinite(value)) { return ""; }
    return value >= 0.5 ? "bad" : (value >= 0.05 ? "mid" : "good");
  }

  function statCard(icon, value, label, kind) {
    return '<div class="stat-card ' + (kind || "") + '">' +
      '<span class="stat-icon">' + icon + '</span>' +
      '<span class="stat-value">' + escapeHtml(value) + '</span>' +
      '<span class="stat-label">' + escapeHtml(label) + '</span></div>';
  }

  function setupExplorer() {
    var controls = document.getElementById("explorer-controls");
    if (!controls) { return; }
    var modelSelect = document.getElementById("select-model");
    var comparisonSelect = document.getElementById("select-comparison");
    var taskSelect = document.getElementById("select-task");
    var taskSelectB = document.getElementById("select-task-b");
    var actualSelect = document.getElementById("select-actual");
    var predictedSelect = document.getElementById("select-predicted");
    var compareToggle = document.getElementById("toggle-compare");
    var labelTaskB = document.getElementById("label-task-b");
    var status = document.getElementById("explorer-status");
    var stats = document.getElementById("explorer-stats");
    var applyButton = document.getElementById("apply-selection");
    var resetButton = document.getElementById("reset-selection");
    var panes = [
      document.getElementById("pane-a"),
      document.getElementById("pane-b"),
      document.getElementById("pane-c"),
      document.getElementById("pane-d")
    ];
    var state = { index: null, entry: null, model: null, busy: false };

    function setStatus(message, kind) {
      status.textContent = message;
      status.className = "status-line" + (kind ? " " + kind : "");
    }

    function currentEntry() {
      var entries = state.index ? state.index.models : [];
      var position = Number(modelSelect.value);
      return entries[isFinite(position) ? position : 0] || entries[0];
    }

    function refreshModelData() {
      var entry = currentEntry();
      if (!entry) { return Promise.reject(new Error(text("The run holds no model.", "本次运行没有模型。"))); }
      if (state.model && state.entry && state.entry.file === entry.file) {
        return Promise.resolve(state.model);
      }
      setStatus(text("Loading the model data...", "正在加载模型数据..."), "");
      return loadModel(entry).then(function (model) {
        state.entry = entry;
        state.model = model;
        return model;
      });
    }

    function syncTaskSelects(model) {
      var ids = Object.keys(model.tasks);
      var keepTask = taskSelect.value;
      var keepTaskB = taskSelectB.value;
      fillSelect(taskSelect, ids);
      fillSelect(taskSelectB, ids);
      if (ids.indexOf(keepTask) >= 0) { taskSelect.value = keepTask; }
      if (ids.indexOf(keepTaskB) >= 0) { taskSelectB.value = keepTaskB; }
      else if (ids.length > 1) { taskSelectB.value = ids[1]; }
    }

    function syncRepetitionSelects(model) {
      var task = model.tasks[taskSelect.value];
      if (!task) { return; }
      var keepActual = Number(actualSelect.value) || 1;
      var keepPredicted = Number(predictedSelect.value) || 1;
      var actualReps = (task.runs.plain_actual || []).map(function (item) { return item.rep; });
      fillSelect(actualSelect, actualReps);
      if (actualReps.indexOf(keepActual) >= 0) { actualSelect.value = String(keepActual); }
      var keys = whichKeys(comparisonSelect.value);
      var predictedReps = (task.runs[keys.predicted] || []).map(function (item) { return item.rep; });
      fillSelect(predictedSelect, predictedReps);
      if (predictedReps.indexOf(keepPredicted) >= 0) { predictedSelect.value = String(keepPredicted); }
    }

    function renderStats(task, comparison) {
      if (!stats) { return; }
      var value = comparison || {};
      stats.innerHTML =
        statCard("🧭", formatNumber(value.symmetricKl, 3), text("symmetric KL", "对称散度"), "symmetric") +
        statCard("🎯", formatNumber(value.topTokenAgreement === true ? 1 : 0, 0),
          text("top-1 match", "首选一致"), "predicted") +
        statCard("🧮", formatNumber(value.jensenShannon, 3), text("Jensen-Shannon", "JS 散度"), "actual") +
        statCard("📏", formatNumber(value.totalVariation, 3), text("total variation", "全变差")) +
        statCard("🕳️", formatNumber(value.coveragePredictedByActual, 3),
          text("coverage of served mass", "接口质量覆盖率"));
    }

    function renderPanes() {
      var model = state.model;
      if (!model) { return; }
      var task = model.tasks[taskSelect.value];
      if (!task) {
        setStatus(text("The model holds no such task.", "该模型没有这个任务。"), "bad");
        return;
      }
      var comparisonName = comparisonSelect.value;
      var keys = whichKeys(comparisonName);
      var actualRepetition = Number(actualSelect.value) || 1;
      var predictedRepetition = Number(predictedSelect.value) || 1;
      var comparison = findComparison(task, comparisonName, actualRepetition, predictedRepetition);
      var actualEntry = prediction(task, keys.actual, actualRepetition);
      var predictedEntry = prediction(task, keys.predicted, predictedRepetition);
      panes[0].className = "detail-pane actual";
      panes[1].className = "detail-pane predicted";
      panes[0].innerHTML = renderPane(
        "🔵 " + model.model + " · " + text("served", "接口"),
        task, actualEntry, predictedEntry, comparison, "served"
      );
      panes[1].innerHTML = renderPane(
        "🟠 " + model.model + " · " + text("predicted", "预测"),
        task, actualEntry, predictedEntry, comparison, "predicted"
      );
      var compare = compareToggle.checked;
      labelTaskB.hidden = !compare;
      panes[2].hidden = !compare;
      panes[3].hidden = !compare;
      if (compare) {
        var taskB = model.tasks[taskSelectB.value];
        if (taskB) {
          var comparisonB = findComparison(taskB, comparisonName, actualRepetition, predictedRepetition);
          panes[2].className = "detail-pane actual";
          panes[3].className = "detail-pane predicted";
          panes[2].innerHTML = renderPane(
            "🔵 " + taskB.id + " · " + text("served", "接口"),
            taskB, prediction(taskB, keys.actual, actualRepetition),
            prediction(taskB, keys.predicted, predictedRepetition), comparisonB, "served"
          );
          panes[3].innerHTML = renderPane(
            "🟠 " + taskB.id + " · " + text("predicted", "预测"),
            taskB, prediction(taskB, keys.actual, actualRepetition),
            prediction(taskB, keys.predicted, predictedRepetition), comparisonB, "predicted"
          );
        }
      }
      renderStats(task, comparison);
      setStatus(
        text(
          "Showing " + model.providerKey + " · task " + task.id + " · " + comparisonName +
            " · actual r" + actualRepetition + " vs predicted r" + predictedRepetition +
            " · symmetric KL " + (comparison ? formatNumber(comparison.symmetricKl) : "n/a") + " nats",
          "显示 " + model.providerKey + " · 任务 " + task.id + " · " + comparisonName +
            " · 实际 r" + actualRepetition + " 对 预测 r" + predictedRepetition +
            " · 对称散度 " + (comparison ? formatNumber(comparison.symmetricKl) : "n/a") + " 奈特"
        ),
        "ok"
      );
    }

    function applySelection() {
      if (state.busy) { return; }
      state.busy = true;
      if (applyButton) { applyButton.disabled = true; }
      refreshModelData().then(function (model) {
        syncTaskSelects(model);
        syncRepetitionSelects(model);
        renderPanes();
      }).catch(function (error) {
        setStatus(String(error && error.message ? error.message : error), "bad");
      }).then(function () {
        state.busy = false;
        if (applyButton) { applyButton.disabled = false; }
      });
    }

    controls.addEventListener("change", applySelection);
    controls.addEventListener("input", function (event) {
      if (event.target && event.target.type === "checkbox") { applySelection(); }
    });
    if (applyButton) { applyButton.addEventListener("click", applySelection); }
    if (resetButton) {
      resetButton.addEventListener("click", function () {
        modelSelect.value = "0";
        if (state.index) { comparisonSelect.value = state.index.defaultComparison || "plain_self"; }
        compareToggle.checked = false;
        state.model = null;
        state.entry = null;
        applySelection();
      });
    }

    setStatus(text("Loading the run index...", "正在加载运行索引..."), "");
    loadModelIndex().then(function (index) {
      state.index = index;
      var entries = index.models;
      fillSelect(modelSelect, entries.map(function (entry, position) { return position; }), function (position) {
        return entries[position].model + " · " + entries[position].providerKey;
      });
      comparisonSelect.value = index.defaultComparison || "plain_self";
      state.model = null;
      applySelection();
    }).catch(function (error) {
      setStatus(String(error && error.message ? error.message : error), "bad");
    });
  }

  function setupChart() {
    var chart = document.getElementById("verdict-chart");
    if (!chart) { return; }
    loadModelIndex().then(function (index) {
      var metrics = index.metrics;
      var tolerance = Number(chart.getAttribute("data-tolerance")) || 0.05;
      var rows = [];
      var maximum = tolerance * 2;
      for (var index2 = 0; index2 < metrics.providers.length; index2 += 1) {
        var provider = metrics.providers[index2];
        for (var index3 = 0; index3 < provider.comparisons.length; index3 += 1) {
          var entry = provider.comparisons[index3];
          maximum = Math.max(maximum, entry.meanSymmetricKl);
          rows.push({ key: provider.providerKey, comparison: entry.comparison, value: entry.meanSymmetricKl });
        }
      }
      var html = rows.map(function (row) {
        var width = maximum > 0 ? Math.max(1, Math.round((row.value / maximum) * 320)) : 1;
        var toleranceX = maximum > 0 ? Math.round((tolerance / maximum) * 320) : 0;
        return '<div class="chart-row" style="display:flex;gap:10px;align-items:center;margin:3px 0;' +
          'font-family:var(--mono);font-size:12px">' +
          '<span style="width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          escapeHtml(row.key) + " · " + escapeHtml(row.comparison) + '</span>' +
          '<span style="position:relative;flex:0 0 330px">' +
          '<span class="bar" style="width:' + width + 'px"></span>' +
          '<span style="position:absolute;left:' + toleranceX + 'px;top:-3px;height:14px;' +
          'border-left:1px dashed var(--accent)"></span></span>' +
          '<span>' + formatNumber(row.value, 3) + '</span></div>';
      }).join("");
      chart.innerHTML = html;
    });
  }

  setupExplorer();
  setupChart();
})();
`;
}

/**
 * Build the index data file.
 *
 * @param options - the demo options.
 * @returns the JavaScript text.
 */
function buildIndexData(options: DemoOptions): string {
  const models = options.metrics.providers.map((provider) => ({
    providerKey: provider.providerKey,
    model: provider.model,
    file: `data-${safeFileSegment(provider.providerKey)}.js`,
    taskCount: provider.taskCount,
  }));
  const payload = {
    xid: options.metrics.xid,
    toleranceNats: options.metrics.toleranceNats,
    defaultComparison: "plain_self",
    models,
    metrics: {
      xid: options.metrics.xid,
      toleranceNats: options.metrics.toleranceNats,
      repetitionCount: options.metrics.repetitionCount,
      providers: options.metrics.providers.map((provider) => ({
        providerKey: provider.providerKey,
        model: provider.model,
        comparisons: provider.comparisons.map((comparison) => ({
          comparison: comparison.comparison,
          pairCount: comparison.pairCount,
          meanSymmetricKl: comparison.meanSymmetricKl,
          meanJensenShannon: comparison.meanJensenShannon,
          meanTotalVariation: comparison.meanTotalVariation,
          topTokenAgreementRate: comparison.topTokenAgreementRate,
          confidenceInterval: comparison.confidenceInterval,
        })),
      })),
    },
  };
  return `window.LLM_SP_INDEX = ${JSON.stringify(payload)};\n`;
}

/**
 * Build one model data file.
 *
 * @param providerKey - the provider key.
 * @param model - the model name.
 * @param records - the task records of the model.
 * @returns the JavaScript text.
 */
function buildModelData(
  providerKey: string,
  model: string,
  records: readonly TaskRecord[],
): string {
  const tasks: Record<string, unknown> = {};
  for (const record of records) {
    const runs: Record<string, unknown> = {};
    for (const [condition, values] of Object.entries(record.predictions)) {
      runs[condition] = (values as readonly PredictionRecord[]).map((value) => ({
        rep: value.repetition,
        token: value.token ?? "",
        source: value.source,
        elapsed: Math.round(value.elapsedMilliseconds),
        entries: value.distribution.entries.map((entry) => [
          entry.token,
          Number(entry.logProbability.toFixed(5)),
        ]),
      }));
    }
    const comparisons: Record<string, unknown> = {};
    for (const [name, values] of Object.entries(record.comparisons)) {
      comparisons[name] = (values as readonly ComparisonMetrics[]).map((value) => ({
        actualIndex: value.actualRepetition,
        predictedIndex: value.predictedRepetition,
        klActualPredicted: Number(value.klActualPredicted.toFixed(6)),
        klPredictedActual: Number(value.klPredictedActual.toFixed(6)),
        symmetricKl: Number(value.symmetricKl.toFixed(6)),
        jensenShannon: Number(value.jensenShannon.toFixed(6)),
        totalVariation: Number(value.totalVariation.toFixed(6)),
        topTokenAgreement: value.topTokenAgreement,
        coveragePredictedByActual: Number(value.coveragePredictedByActual.toFixed(4)),
        coverageActualByPredicted: Number(value.coverageActualByPredicted.toFixed(4)),
        unionSupportSize: value.unionSupportSize,
      }));
    }
    tasks[record.task.id] = {
      id: record.task.id,
      prefix: record.task.prefix,
      referenceToken: record.task.referenceToken,
      language: record.task.language ?? "",
      category: record.task.category,
      runs,
      comparisons,
      errors: record.errors,
    };
  }
  const payload = { providerKey, model, tasks };
  return `window.LLM_SP_MODEL = ${JSON.stringify(payload)};\n`;
}

/**
 * Build the task summary table of the run.
 *
 * @param xid - the run identifier.
 * @param records - the task records.
 * @returns the JSON value.
 */
function buildTaskSummary(xid: string, records: readonly TaskRecord[]): unknown {
  return {
    xid,
    tasks: records.map((record) => ({
      providerKey: record.providerKey,
      taskId: record.task.id,
      calls: Object.fromEntries(
        Object.entries(record.predictions).map(([condition, values]) => [
          condition,
          (values as readonly PredictionRecord[]).map((value) => ({
            repetition: value.repetition,
            token: value.token ?? "",
            elapsedMilliseconds: Math.round(value.elapsedMilliseconds),
            supportSize: value.distribution.supportSize,
            rawFileNames: value.rawFileNames,
          })),
        ]),
      ),
      errors: record.errors,
    })),
  };
}

/**
 * Write the demonstration website of one run.
 *
 * @param options - the demo options.
 * @returns the path of the entry page.
 */
export async function renderDemos(options: DemoOptions): Promise<string> {
  const { directory, metrics, records } = options;
  const assets = path.join(directory, "assets");
  await ensureDirectory(assets);
  await writeTextFile(path.join(assets, "style.css"), buildStyleSheet());
  await writeTextFile(path.join(assets, "app.js"), buildBrowserScript());
  await writeTextFile(path.join(assets, "data-index.js"), buildIndexData(options));
  for (const provider of metrics.providers) {
    const own = records.filter((record) => record.providerKey === provider.providerKey);
    await writeTextFile(
      path.join(assets, `data-${safeFileSegment(provider.providerKey)}.js`),
      buildModelData(provider.providerKey, provider.model, own),
    );
  }
  await writeTextFile(path.join(directory, "index.html"), renderOverviewPage(options));
  await writeTextFile(path.join(directory, "method.html"), renderMethodPage(options));
  await writeTextFile(path.join(directory, "summary.html"), renderSummaryPage(options));
  await writeTextFile(path.join(directory, "explorer.html"), renderExplorerPage(options));
  await writeTextFile(path.join(directory, "context.html"), renderContextPage(options));
  await writeTextFile(
    path.join(directory, "implementation.html"),
    renderImplementationPage(options),
  );
  await writeTextFile(path.join(directory, "meaning.html"), renderMeaningPage(options));
  await writeJsonFile(
    path.join(directory, "..", "results", "task-summary.json"),
    buildTaskSummary(metrics.xid, records),
  );
  return path.join(directory, "index.html");
}
