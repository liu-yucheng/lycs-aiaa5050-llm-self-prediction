// Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
// GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
/**
 * Render the demonstration website of one run.
 *
 * The module writes one static site into the demos directory of the run. The site has seven
 * pages, a style sheet, a browser script, and one data file per model. Every page holds both an
 * English text and a Simplified Chinese text, and a reader switches the language with one button.
 *
 * The presentation rules follow the repository style guides:
 *
 * - The page uses the style of the documentation site: one white surface, one accent color, one
 *   card grid, and one callout box.
 * - A heading, a bar, and a footer line use the sans font. A body text uses the serif font. A
 *   code block and the result explorer use the monospace font.
 * - A page states a fact as a short sentence in a bullet list. A long paragraph does not appear.
 * - An icon marks a section, a condition, or a verdict.
 */
import path from "node:path";
import { COMPARISON_NAMES, PLUGIN_NAME, PLUGIN_VERSION } from "./constants.js";
import { ensureDirectory, readJsonFile, safeFileSegment, writeJsonFile, writeTextFile, } from "./files.js";
import { formatNumber } from "./report.js";
/** One page of the site. */
const PAGES = [
    { file: "index.html", english: "Overview", chinese: "总览" },
    { file: "method.html", english: "Method", chinese: "方法" },
    { file: "summary.html", english: "Summary", chinese: "结果" },
    { file: "explorer.html", english: "Result Explorer", chinese: "结果浏览器" },
    { file: "context.html", english: "Course and Debates", chinese: "课程与辩论" },
    { file: "implementation.html", english: "Platform", chinese: "平台实现" },
    { file: "meaning.html", english: "Meaning and Limits", chinese: "意义与局限" },
];
/**
 * Build one bilingual span pair.
 *
 * @param english - the English text.
 * @param chinese - the Simplified Chinese text.
 * @returns the HTML fragment.
 */
function bilingual(english, chinese) {
    return (`<span data-lang="en">${english}</span>` +
        `<span data-lang="zh" hidden>${chinese}</span>`);
}
/**
 * Build one bilingual paragraph.
 *
 * @param english - the English text.
 * @param chinese - the Simplified Chinese text.
 * @returns the HTML fragment.
 */
function paragraph(english, chinese) {
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
function heading(level, english, chinese) {
    return `<h${level}>${bilingual(english, chinese)}</h${level}>`;
}
/**
 * Build one bilingual list.
 *
 * @param items - the English and Chinese text of each item.
 * @param ordered - true for an ordered list.
 * @returns the HTML fragment.
 */
function list(items, ordered = false) {
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
function callout(english, chinese) {
    return `<aside class="callout">${bilingual(english, chinese)}</aside>`;
}
/**
 * Build one grid of bilingual cards.
 *
 * @param items - the icon, the title, and the text of each card.
 * @returns the HTML fragment.
 */
function cards(items) {
    const body = items
        .map((item) => `<div class="card"><span class="card-icon">${item.icon}</span>` +
        `<strong>${bilingual(item.titleEnglish, item.titleChinese)}</strong>` +
        `<span>${bilingual(item.textEnglish, item.textChinese)}</span></div>`)
        .join("\n");
    return `<div class="cards">\n${body}\n</div>`;
}
/**
 * Build one bilingual table.
 *
 * @param headers - the header text of each column.
 * @param rows - the cell text of each row, already in HTML.
 * @returns the HTML fragment.
 */
function table(headers, rows) {
    const head = headers
        .map((header) => `<th>${bilingual(header.english, header.chinese)}</th>`)
        .join("");
    return `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${rows.join("\n")}\n</tbody>\n</table>`;
}
/**
 * Build one block of monospace text.
 *
 * @param text - the text to show.
 * @returns the HTML fragment.
 */
function codeBlock(text) {
    return `<pre><code>${text}</code></pre>`;
}
/**
 * Read the verdict of one comparison summary.
 *
 * @param summary - the summary.
 * @param toleranceNats - the tolerance in nats.
 * @returns the verdict text.
 */
function verdictOf(summary, toleranceNats) {
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
function statStrip(items) {
    const cardsHtml = items.map((item) => `<div class="stat-card${item.kind === undefined ? "" : ` ${item.kind}`}">` +
        `<span class="stat-icon">${item.icon}</span>` +
        `<span class="stat-value">${item.value}</span>` +
        `<span class="stat-label">${bilingual(item.labelEnglish, item.labelChinese)}</span></div>`);
    return `<div class="stat-strip">${cardsHtml.join("")}</div>`;
}
/**
 * Render the verdict of one comparison as a colored badge.
 *
 * @param verdict - the verdict name.
 * @param value - the value to show inside the badge.
 * @returns the HTML snippet.
 */
function verdictBadge(verdict, value) {
    const kind = verdict === "indistinguishable" ? "ok" : verdict === "separated" ? "bad" : "warn";
    const icon = verdict === "indistinguishable" ? "✅" : verdict === "separated" ? "🔺" : "⚖️";
    return `<span class="badge ${kind}">${icon} ${verdict} · ${value}</span>`;
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
function barRow(label, value, maximum, tolerance, kind) {
    const width = maximum > 0 ? Math.min(100, Math.max(0.5, (value / maximum) * 100)) : 0;
    const mark = tolerance === undefined || maximum <= 0
        ? ""
        : `<span class="tolerance-line" style="left:${Math.min(100, (tolerance / maximum) * 100)}%">` +
            "</span>";
    return (`<div class="bar-row"><span class="bar-label">${label}</span>` +
        `<span class="bar-track"><span class="bar-fill ${kind}" ` +
        `style="width:${width.toFixed(2)}%"></span>${mark}</span>` +
        `<span class="bar-value">${formatNumber(value, 3)}</span></div>`);
}
/**
 * Render one band of numbered protocol steps.
 *
 * @param steps - the steps to render, in order.
 * @returns the HTML block.
 */
function flowStrip(steps) {
    const items = steps.map((step, index) => `<li><span class="step">${String(index + 1).padStart(2, "0")} ${step.icon}</span>` +
        `<span class="title">${bilingual(step.titleEnglish, step.titleChinese)}</span>` +
        `<span class="detail">${bilingual(step.detailEnglish, step.detailChinese)}</span></li>`);
    return `<ol class="flow">${items.join("")}</ol>`;
}
/**
 * Build the shared page shell.
 *
 * @param options - the page options.
 * @returns the HTML document.
 */
function renderShell(options) {
    const links = PAGES.map((page) => {
        const active = page.file === options.current ? ' aria-current="page"' : "";
        return `<a href="${page.file}"${active}>` + bilingual(page.english, page.chinese) + "</a>";
    }).join("\n      ");
    const modeClass = options.mode === undefined ? "" : ` ${options.mode}`;
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
      <span class="brand-mark">AIAA5050</span>
      <span class="brand-text">${bilingual("Next-token self-prediction", "下一个词块自我预测")}</span>
    </div>
    <nav class="nav" aria-label="Chapters">
      ${links}
    </nav>
    <button class="lang-toggle" type="button" id="lang-toggle" aria-label="Switch language">
      <span data-lang="en">中文</span><span data-lang="zh" hidden>English</span>
    </button>
  </div>
</header>
<main class="page${modeClass}">
  <p class="eyebrow">${bilingual("Run", "运行")} <code>${options.metrics.xid}</code></p>
  <h1>${bilingual(options.titleEnglish, options.titleChinese)}</h1>
  <p class="lede">${bilingual(options.ledeEnglish, options.ledeChinese)}</p>
  ${options.body}
</main>
<footer class="page-footer">
  <div class="footer-inner">
    <p>${bilingual(`Generated by ${PLUGIN_NAME} version ${PLUGIN_VERSION}. Random seed ${options.metrics.randomSeed}.`, `由 ${PLUGIN_NAME} 版本 ${PLUGIN_VERSION} 生成。随机种子 ${options.metrics.randomSeed}。`)}</p>
    <p>${bilingual("Tolerance " +
        formatNumber(options.metrics.toleranceNats, 3) +
        " nats. Every number comes from the run directory.", "容差 " + formatNumber(options.metrics.toleranceNats, 3) + " nat。每个数字都来自运行目录。")}</p>
  </div>
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
function renderOverviewPage(options) {
    const { metrics } = options;
    const means = COMPARISON_NAMES.map((comparison) => {
        const values = metrics.providers
            .map((provider) => provider.comparisons.find((entry) => entry.comparison === comparison))
            .filter((entry) => entry !== undefined);
        const mean = values.length === 0
            ? undefined
            : values.reduce((sum, entry) => sum + entry.meanSymmetricKl, 0) / values.length;
        return { comparison, mean };
    });
    const meanRows = means.map((entry) => `<tr><td><code>${entry.comparison}</code></td>` +
        `<td class="number">${formatNumber(entry.mean, 3)}</td></tr>`);
    const pairCount = metrics.providers.reduce((total, provider) => total + provider.comparisons.reduce((inner, entry) => inner + entry.pairCount, 0), 0);
    const separatedCount = metrics.providers.reduce((total, provider) => total +
        provider.comparisons.filter((entry) => verdictOf(entry, metrics.toleranceNats) === "separated").length, 0);
    const verdictRows = metrics.providers.map((provider) => {
        const cells = COMPARISON_NAMES.map((comparison) => {
            const summary = provider.comparisons.find((entry) => entry.comparison === comparison);
            if (summary === undefined) {
                return '<td><span class="badge warn">⚖️ n/a</span></td>';
            }
            const verdict = verdictOf(summary, metrics.toleranceNats);
            return `<td>${verdictBadge(verdict, formatNumber(summary.meanSymmetricKl, 3))}</td>`;
        }).join("");
        return (`<tr><td><code>${provider.model}</code></td>${cells}` +
            `<td class="number">${provider.taskCount}</td></tr>`);
    });
    const body = `
${statStrip([
        { icon: "🧪", value: String(metrics.providers.length), labelEnglish: "models", labelChinese: "模型", kind: "actual" },
        { icon: "📋", value: String(metrics.taskCount), labelEnglish: "tasks", labelChinese: "任务" },
        { icon: "🔁", value: `${metrics.repetitionCount} × 4`, labelEnglish: "runs per task", labelChinese: "每任务次数" },
        { icon: "📊", value: String(pairCount), labelEnglish: "paired tables", labelChinese: "配对表格", kind: "predicted" },
        {
            icon: "🎯",
            value: formatNumber(metrics.toleranceNats, 3),
            labelEnglish: "tolerance, nats",
            labelChinese: "容差，nat",
        },
        {
            icon: "⚖️",
            value: `${separatedCount}/${metrics.providers.length * 3}`,
            labelEnglish: "separated verdicts",
            labelChinese: "判为有差异",
            kind: "symmetric",
        },
    ])}
${heading(2, "The question", "问题")}
${list([
        {
            english: "A model writes one token at each step. That step rests on a distribution over the next token.",
            chinese: "模型每步写一个词块。这个步骤依赖下一个词块上的分布。",
        },
        {
            english: "The interface can show that distribution as log probabilities.",
            chinese: "接口可以把该分布显示为对数概率。",
        },
        {
            english: "This run asks one question: can the model also state that distribution as text?",
            chinese: "本运行只问一个问题：模型能否用文字也说出这个分布？",
        },
    ])}
${callout("🔍 The run compares two reports of one distribution. One report comes from the interface." +
        " The other report comes from the model itself.", "🔍 运行比较同一个分布的两次报告。一次来自接口，一次来自模型自己。")}
${heading(2, "Two hypotheses", "两个假设")}
${cards([
        {
            icon: "0️⃣",
            titleEnglish: "Null hypothesis",
            titleChinese: "原假设",
            textEnglish: "Self-prediction is emergent. The divergence stays near 0 nats.",
            textChinese: "自我预测是涌现的。散度接近 0 nat。",
        },
        {
            icon: "🔺",
            titleEnglish: "Alternative hypothesis",
            titleChinese: "备择假设",
            textEnglish: "Training never rewards a self-report. The divergence stays above 0 nats.",
            textChinese: "训练从不奖励自我报告。散度高于 0 nat。",
        },
    ])}
${heading(2, "Four conditions", "四种条件")}
${cards([
        {
            icon: "1️⃣📡",
            titleEnglish: "Plain actual",
            titleChinese: "普通实际",
            textEnglish: "Read the served table. This table is the ground truth.",
            textChinese: "读取接口表格。该表格是基准。",
        },
        {
            icon: "2️⃣🗣️",
            titleEnglish: "Plain self",
            titleChinese: "普通自我",
            textEnglish: "Ask the model to write its own table as text.",
            textChinese: "要求模型用文字写出自己的表格。",
        },
        {
            icon: "3️⃣🔁",
            titleEnglish: "Injected self",
            titleChinese: "注入自我",
            textEnglish: "Put the served table in context. Ask for the own table again.",
            textChinese: "把接口表格放入上下文。再次索取自身表格。",
        },
        {
            icon: "4️⃣🎯",
            titleEnglish: "Injected actual",
            titleChinese: "注入实际",
            textEnglish: "Put the own table in context. Read the served table again.",
            textChinese: "把自身表格放入上下文。再次读取接口表格。",
        },
    ])}
${heading(2, "The verdict at a glance", "判定一览")}
${table([
        { english: "Model", chinese: "模型" },
        { english: "plain_self", chinese: "普通自我" },
        { english: "injected_self", chinese: "注入自我" },
        { english: "injected_actual", chinese: "注入实际" },
        { english: "Tasks", chinese: "任务" },
    ], verdictRows)}
${paragraph("A badge shows the mean symmetric divergence and the verdict. Green means no difference." +
        " Red means a clear difference.", "徽章显示平均对称散度与判定。绿色表示无差异。红色表示明显差异。")}
${heading(2, "Mean divergence", "平均散度")}
${table([
        { english: "Comparison", chinese: "比较" },
        { english: "Mean symmetric KL, nats", chinese: "平均对称 KL，nat" },
    ], meanRows)}
<ol class="flow">
${means
        .map((entry) => `<li><span class="step">` +
        (entry.comparison === "plain_self"
            ? "🗣️"
            : entry.comparison === "injected_self"
                ? "🔁"
                : "🎯") +
        `</span>` +
        `<span class="title"><code>${entry.comparison}</code></span>` +
        `<span class="bar-track"><span class="bar-fill symmetric" style="width:${Math.min(100, Math.max(0.5, ((entry.mean ?? 0) / Math.max(1, Math.max(...means.map((item) => item.mean ?? 0)))) * 100)).toFixed(2)}%"></span></span>` +
        `<span class="bar-value">${formatNumber(entry.mean, 3)}</span></li>`)
        .join("\n")}
</ol>
${heading(2, "Read next", "继续阅读")}
${list([
        {
            english: "📐 Method: the dataset, the prompts, the parser, and the statistics.",
            chinese: "📐 方法：数据集、提示词、解析器与统计。",
        },
        {
            english: "📊 Summary: each model on one scale, with its interval and its verdict.",
            chinese: "📊 结果：每个模型在同一标尺上的数值、区间与判定。",
        },
        {
            english: "🔬 Result Explorer: one task, one pair, and the share of every token.",
            chinese: "🔬 结果浏览器：一个任务、一对表格，以及每个词块的贡献。",
        },
    ])}
`;
    return renderShell({
        current: "index.html",
        titleEnglish: "Overview",
        titleChinese: "总览",
        ledeEnglish: "One measurement of a model that reports its own next-token distribution.",
        ledeChinese: "测量模型能否报告自己的下一个词块分布。",
        body,
        metrics: options.metrics,
    });
}
/**
 * Count the tasks of one dataset in the records.
 *
 * @param records - the task records.
 * @param datasetId - the dataset identifier.
 * @returns the task count, or 0 when the identifier matches no record.
 */
function countTasksOfDataset(records, datasetId) {
    const language = datasetId.includes("-zh") ? "zh" : datasetId.includes("-en") ? "en" : "";
    if (language === "") {
        return 0;
    }
    const ids = new Set(records
        .filter((record) => (record.task.language ?? "").startsWith(language))
        .map((record) => record.task.id));
    return ids.size;
}
/**
 * Render the method page.
 *
 * @param options - the demo options.
 * @returns the HTML document.
 */
function renderMethodPage(options) {
    const { metrics, dataset } = options;
    const datasetRows = dataset.datasetIds.map((id, index) => `<tr><td><code>${id}</code></td><td>${dataset.languages[index] ?? ""}</td>` +
        `<td class="number">${countTasksOfDataset(options.records, id)}</td></tr>`);
    const categoryRows = dataset.categories.map((entry) => `<tr><td>${entry.name}</td><td class="number">${entry.count}</td></tr>`);
    const body = `
${flowStrip([
        {
            icon: "📝",
            titleEnglish: "Pick a task",
            titleChinese: "选择任务",
            detailEnglish: "One prefix. One expected token.",
            detailChinese: "一个前缀。一个预期词块。",
        },
        {
            icon: "📡",
            titleEnglish: "Read the served table",
            titleChinese: "读取接口表格",
            detailEnglish: "One request. 20 entries. This is the ground truth.",
            detailChinese: "一次请求。20 个条目。这是基准。",
        },
        {
            icon: "🗣️",
            titleEnglish: "Ask for the own table",
            titleChinese: "索取自身表格",
            detailEnglish: "The model writes JSON as text.",
            detailChinese: "模型用文字写出 JSON。",
        },
        {
            icon: "🔁",
            titleEnglish: "Inject and repeat",
            titleChinese: "注入并重复",
            detailEnglish: "Each table enters the other context.",
            detailChinese: "两个表格分别进入对方上下文。",
        },
        {
            icon: "📐",
            titleEnglish: "Compare and judge",
            titleChinese: "比较与判定",
            detailEnglish: "One divergence. One interval. One verdict.",
            detailChinese: "一个散度。一个区间。一个判定。",
        },
    ])}
${heading(2, "Dataset", "数据集")}
${list([
        {
            english: `📁 ${dataset.datasetIds.length} files, one language in each file.`,
            chinese: `📁 ${dataset.datasetIds.length} 个文件，每个文件一种语言。`,
        },
        {
            english: `📋 ${dataset.taskCount} tasks in total.`,
            chinese: `📋 共 ${dataset.taskCount} 个任务。`,
        },
        {
            english: "🔤 Each task gives a prefix and one expected token.",
            chinese: "🔤 每个任务给出一个前缀和一个预期词块。",
        },
        {
            english: "🚫 No metric uses the expected token.",
            chinese: "🚫 任何指标都不使用预期词块。",
        },
    ])}
${table([
        { english: "Dataset", chinese: "数据集" },
        { english: "Language", chinese: "语言" },
        { english: "Tasks", chinese: "任务" },
    ], datasetRows)}
${table([
        { english: "Category", chinese: "类别" },
        { english: "Tasks", chinese: "任务" },
    ], categoryRows)}
${heading(2, "Prompts", "提示词")}
${list([
        {
            english: "📡 Plain actual: send the prefix. Set logprobs and top_logprobs.",
            chinese: "📡 普通实际：发送前缀。设置 logprobs 与 top_logprobs。",
        },
        {
            english: "🗣️ Plain self: send the same prefix. Ask for one JSON object.",
            chinese: "🗣️ 普通自我：发送同样的前缀。要求一个 JSON 对象。",
        },
        {
            english: "🔁 Injected self: add the served table as one assistant message.",
            chinese: "🔁 注入自我：把接口表格作为一条助手消息加入。",
        },
        {
            english: "🎯 Injected actual: add the own table, then read the served table.",
            chinese: "🎯 注入实际：加入自身表格，再读取接口表格。",
        },
    ])}
${callout("✂️ A tokenizer can cut a word into pieces. The model does not see the tokenizer." +
        " The prompt therefore lets the model list the leading pieces and give the rest of the" +
        " probability to the whole word.", "✂️ 分词器会把词切成片段。模型看不到分词器。因此提示词允许模型列出前导片段，并把其余概率给整个词。")}
${heading(2, "Parser", "解析器")}
${list([
        {
            english: "📄 The parser reads text, not a tool call.",
            chinese: "📄 解析器读取文字，不读取工具调用。",
        },
        {
            english: "🧩 It accepts a code fence, an object, or an array.",
            chinese: "🧩 它接受代码围栏、对象或数组。",
        },
        {
            english: "🗄️ It keeps the raw reply unchanged in the intermediate directory.",
            chinese: "🗄️ 原始回复原样保存在中间目录。",
        },
        {
            english: "Σ It drops an entry with a placeholder log probability, such as -9999.",
            chinese: "Σ 它丢弃占位对数概率的条目，例如 -9999。",
        },
    ])}
${heading(2, "Divergence", "散度")}
${codeBlock(`D_KL(P || Q) = sum_t P(t) * log(P(t) / Q(t))     in nats
D_sym        = D_KL(P || Q) + D_KL(Q || P)`)}
${list([
        {
            english: "🧱 A token that one side does not report takes the floor 1e-12.",
            chinese: "🧱 一侧未报告的词块取地板值 1e-12。",
        },
        {
            english: "⚖️ Both sides renormalize after the floor, so each side sums to 1.",
            chinese: "⚖️ 双方在地板值后重新归一，因此各自和为 1。",
        },
        {
            english: "🔁 The symmetric form does not depend on the order of the two sides.",
            chinese: "🔁 对称形式不依赖两侧的先后顺序。",
        },
        {
            english: "📏 Jensen-Shannon and total variation are reported as extra checks.",
            chinese: "📏 另外报告 Jensen-Shannon 与全变差，作为附加检查。",
        },
    ])}
${heading(2, "Statistics", "统计")}
${list([
        {
            english: `🔗 The run pairs every actual repetition with every predicted repetition.`,
            chinese: "🔗 运行把每次实际重复与每次预测重复配对。",
        },
        {
            english: "📉 Each task gives one mean. The summary averages the task means.",
            chinese: "📉 每个任务给出一个均值。汇总平均各任务均值。",
        },
        {
            english: "🎲 A bootstrap with 2 000 resamples gives the 95 % interval.",
            chinese: "🎲 自助法 2 000 次重采样给出 95% 区间。",
        },
        {
            english: `🎯 A verdict compares the interval with the tolerance of ${formatNumber(metrics.toleranceNats, 3)} nats.`,
            chinese: `🎯 判定把区间与容差 ${formatNumber(metrics.toleranceNats, 3)} nat 比较。`,
        },
    ])}
${table([
        { english: "Verdict", chinese: "判定" },
        { english: "Rule", chinese: "规则" },
    ], [
        '<tr><td><span class="badge ok">✅ indistinguishable</span></td>' +
            "<td>Upper bound below the tolerance.</td></tr>",
        '<tr><td><span class="badge bad">🔺 separated</span></td>' +
            "<td>Lower bound above the tolerance.</td></tr>",
        '<tr><td><span class="badge warn">⚖️ inconclusive</span></td>' +
            "<td>The interval crosses the tolerance.</td></tr>",
    ])}
`;
    return renderShell({
        current: "method.html",
        titleEnglish: "Method",
        titleChinese: "方法",
        ledeEnglish: "The dataset, the prompts, the parser, the divergence, and the statistics.",
        ledeChinese: "数据集、提示词、解析器、散度与统计。",
        body,
        metrics: options.metrics,
    });
}
/**
 * Render the summary page.
 *
 * @param options - the demo options.
 * @returns the HTML document.
 */
function renderSummaryPage(options) {
    const { metrics } = options;
    const flat = metrics.providers.flatMap((provider) => provider.comparisons.map((entry) => ({ provider, entry })));
    const values = flat.map((item) => item.entry.meanSymmetricKl);
    const smallest = values.length > 0 ? Math.min(...values) : undefined;
    const largest = values.length > 0 ? Math.max(...values) : undefined;
    const separated = metrics.providers.reduce((total, provider) => total +
        provider.comparisons.filter((entry) => verdictOf(entry, metrics.toleranceNats) === "separated").length, 0);
    const modelRows = metrics.providers.flatMap((provider) => provider.comparisons.map((entry) => {
        const verdict = verdictOf(entry, metrics.toleranceNats);
        return (`<tr><td><code>${provider.model}</code></td>` +
            `<td><code>${entry.comparison}</code></td>` +
            `<td class="number">${formatNumber(entry.meanSymmetricKl, 3)}</td>` +
            `<td class="number">${formatNumber(entry.confidenceInterval.lower, 3)} – ` +
            `${formatNumber(entry.confidenceInterval.upper, 3)}</td>` +
            `<td class="number">${formatNumber(entry.topTokenAgreementRate, 3)}</td>` +
            `<td>${verdictBadge(verdict, "")}</td></tr>`);
    }));
    const tallyRows = COMPARISON_NAMES.map((comparison) => {
        const entries = metrics.providers
            .map((provider) => provider.comparisons.find((item) => item.comparison === comparison))
            .filter((entry) => entry !== undefined);
        const counts = { separated: 0, indistinguishable: 0, inconclusive: 0 };
        for (const entry of entries) {
            const verdict = verdictOf(entry, metrics.toleranceNats);
            if (verdict === "separated") {
                counts.separated += 1;
            }
            else if (verdict === "indistinguishable") {
                counts.indistinguishable += 1;
            }
            else {
                counts.inconclusive += 1;
            }
        }
        return (`<tr><td><code>${comparison}</code></td>` +
            `<td class="number">${counts.separated}</td>` +
            `<td class="number">${counts.indistinguishable}</td>` +
            `<td class="number">${counts.inconclusive}</td></tr>`);
    });
    const maximum = largest === undefined ? 1 : Math.max(largest, metrics.toleranceNats);
    const barGroups = metrics.providers.map((provider) => `<h3><code>${provider.model}</code></h3>\n` +
        COMPARISON_NAMES.map((comparison) => {
            const entry = provider.comparisons.find((item) => item.comparison === comparison);
            const kind = comparison === "plain_self" ? "symmetric" : comparison === "injected_self" ? "predicted" : "actual";
            return barRow(comparison, entry?.meanSymmetricKl ?? 0, maximum, metrics.toleranceNats, kind);
        }).join("\n"));
    const failureRows = metrics.providers.map((provider) => {
        const own = options.records.filter((record) => record.providerKey === provider.providerKey);
        const errors = own.reduce((total, record) => total + record.errors.length, 0);
        const warnings = own.reduce((total, record) => total + record.warnings.length, 0);
        return (`<tr><td><code>${provider.model}</code></td><td class="number">${own.length}</td>` +
            `<td class="number">${errors}</td><td class="number">${warnings}</td></tr>`);
    });
    const totalErrors = options.records.reduce((total, record) => total + record.errors.length, 0);
    const body = `
${statStrip([
        { icon: "🏆", value: formatNumber(smallest, 3), labelEnglish: "smallest mean", labelChinese: "最小均值", kind: "actual" },
        {
            icon: "🔺",
            value: formatNumber(largest, 3),
            labelEnglish: "largest mean",
            labelChinese: "最大均值",
            kind: "symmetric",
        },
        {
            icon: "🎯",
            value: formatNumber(metrics.toleranceNats, 3),
            labelEnglish: "tolerance, nats",
            labelChinese: "容差，nat",
        },
        { icon: "🧪", value: String(metrics.providers.length), labelEnglish: "models", labelChinese: "模型" },
        {
            icon: "⚖️",
            value: `${separated}/${flat.length}`,
            labelEnglish: "separated",
            labelChinese: "判为有差异",
            kind: "predicted",
        },
    ])}
${callout(separated === flat.length && flat.length > 0
        ? "🔺 Every comparison stays above the tolerance. This run supports the alternative hypothesis."
        : "⚖️ Some comparisons stay near the tolerance. Read the badges below before you state a conclusion.", separated === flat.length && flat.length > 0
        ? "🔺 每个比较都高于容差。本运行支持备择假设。"
        : "⚖️ 部分比较接近容差。给出结论前请先看下方徽章。")}
${heading(2, "Every model on one scale", "所有模型同一标尺")}
${paragraph("A bar is one mean symmetric divergence. The dashed line is the tolerance. A short bar stays near no difference.", "每根条是一个平均对称散度。虚线是容差。条越短，越接近无差异。")}
<div class="bars">
${barGroups.join("\n")}
</div>
${heading(2, "Verdict tally", "判定统计")}
${table([
        { english: "Comparison", chinese: "比较" },
        { english: "Separated", chinese: "有差异" },
        { english: "Indistinguishable", chinese: "无差异" },
        { english: "Inconclusive", chinese: "不确定" },
    ], tallyRows)}
${heading(2, "Each model", "每个模型")}
${table([
        { english: "Model", chinese: "模型" },
        { english: "Comparison", chinese: "比较" },
        { english: "Mean symmetric KL", chinese: "平均对称 KL" },
        { english: "95 % interval", chinese: "95% 区间" },
        { english: "Top-1 agreement", chinese: "首位一致率" },
        { english: "Verdict", chinese: "判定" },
    ], modelRows)}
${heading(2, "Failures and warnings", "失败与警告")}
${list([
        {
            english: `❌ ${totalErrors} calls recorded an error and no table.`,
            chinese: `❌ ${totalErrors} 次调用记录错误，且没有表格。`,
        },
        {
            english: "📉 A failed call removes one pair. It does not change the protocol.",
            chinese: "📉 失败调用少一对数据。协议不变。",
        },
        {
            english: "📄 Each error stays in the task record of the run directory.",
            chinese: "📄 每个错误都保留在运行目录的任务记录中。",
        },
    ])}
${table([
        { english: "Model", chinese: "模型" },
        { english: "Records", chinese: "记录" },
        { english: "Errors", chinese: "错误" },
        { english: "Warnings", chinese: "警告" },
    ], failureRows)}
${heading(2, "Read next", "继续阅读")}
${list([
        {
            english: "🔬 Result Explorer: one task and the share of every token.",
            chinese: "🔬 结果浏览器：一个任务与每个词块的贡献。",
        },
        {
            english: "🧠 Meaning and Limits: what these numbers do not say.",
            chinese: "🧠 意义与局限：这些数字不说明什么。",
        },
    ])}
`;
    return renderShell({
        current: "summary.html",
        titleEnglish: "Summary",
        titleChinese: "结果",
        ledeEnglish: "The numbers of this run and the verdict of each comparison.",
        ledeChinese: "本次运行的数值与每个比较的判定。",
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
function renderExplorerPage(options) {
    const { metrics } = options;
    const modelOptions = metrics.providers
        .map((provider, index) => `<option value="${index}">${provider.model} · ${provider.providerKey}</option>`)
        .join("\n            ");
    const comparisonOptions = COMPARISON_NAMES.map((comparison) => `<option value="${comparison}">${comparison}</option>`).join("\n            ");
    const body = `
${list([
        {
            english: "1️⃣ Pick a model, a comparison, a task, and two repetitions.",
            chinese: "1️⃣ 选择模型、比较、任务与两次重复。",
        },
        {
            english: "2️⃣ Press Apply. A change also applies at once.",
            chinese: "2️⃣ 按“应用”。更改也会立即生效。",
        },
        {
            english: "3️⃣ Read the two panes. A row gives one token and its share of the divergence.",
            chinese: "3️⃣ 阅读左右两栏。每行给出一个词块及其在散度中的份额。",
        },
    ])}
<div class="explorer-bar">
  <form id="explorer-controls" class="explorer-controls" onsubmit="return false">
    <label>${bilingual("Model", "模型")}
      <select id="select-model">
            ${modelOptions}
      </select>
    </label>
    <label>${bilingual("Comparison", "比较")}
      <select id="select-comparison">
            ${comparisonOptions}
      </select>
    </label>
    <label>${bilingual("Task", "任务")}
      <select id="select-task"></select>
    </label>
    <label>${bilingual("Actual repetition", "实际重复")}
      <select id="select-actual"></select>
    </label>
    <label>${bilingual("Predicted repetition", "预测重复")}
      <select id="select-predicted"></select>
    </label>
    <label class="check">${bilingual("Compare two tasks", "比较两个任务")}
      <input type="checkbox" id="toggle-compare">
    </label>
    <label id="label-task-b" hidden>${bilingual("Second task", "第二个任务")}
      <select id="select-task-b"></select>
    </label>
  </form>
  <div class="button-row">
    <button type="button" class="primary" id="apply-selection">${bilingual("Apply", "应用")}</button>
    <button type="button" class="ghost" id="reset-selection">${bilingual("Reset", "重置")}</button>
  </div>
</div>
<p class="status-line" id="explorer-status">${bilingual("Loading…", "加载中…")}</p>
<div class="stat-strip" id="explorer-stats"></div>
<div class="legend">
  <span><span class="dot actual"></span>${bilingual("Served", "接口")}</span>
  <span><span class="dot predicted"></span>${bilingual("Predicted", "预测")}</span>
  <span><span class="dot symmetric"></span>${bilingual("Divergence share", "散度份额")}</span>
</div>
<div class="panes">
  <section class="pane" id="pane-a"><h3>${bilingual("Served table", "接口表格")}</h3>
    <div class="pane-body">${bilingual("Pick a task to load a table.", "请选择任务以载入表格。")}</div>
  </section>
  <section class="pane" id="pane-b"><h3>${bilingual("Predicted table", "预测表格")}</h3>
    <div class="pane-body">${bilingual("Pick a task to load a table.", "请选择任务以载入表格。")}</div>
  </section>
  <section class="pane" id="pane-c"><h3>${bilingual("Second task, served", "第二任务，接口")}</h3>
    <div class="pane-body">${bilingual("Enable the second task to load a table.", "启用第二任务以载入表格。")}</div>
  </section>
  <section class="pane" id="pane-d"><h3>${bilingual("Second task, predicted", "第二任务，预测")}</h3>
    <div class="pane-body">${bilingual("Enable the second task to load a table.", "启用第二任务以载入表格。")}</div>
  </section>
</div>
${heading(2, "How to read a pane", "如何阅读栏目")}
${list([
        {
            english: "Σ Token: the word piece that both sides score.",
            chinese: "Σ 词块：双方都给出概率的片段。",
        },
        {
            english: "🎯 Probability: the normalized value of that side.",
            chinese: "🎯 概率：该侧归一化后的值。",
        },
        {
            english: "📊 Share: the part of the divergence that this token adds.",
            chinese: "📊 份额：该词块贡献的散度部分。",
        },
        {
            english: "📉 Missing: the token is absent on one side and takes the floor.",
            chinese: "📉 缺失：该词块在一侧缺失，取地板值。",
        },
        {
            english: `✅ A green badge stays below ${formatNumber(metrics.toleranceNats, 3)} nats.`,
            chinese: `✅ 绿色徽章低于 ${formatNumber(metrics.toleranceNats, 3)} nat。`,
        },
    ])}
`;
    return renderShell({
        current: "explorer.html",
        titleEnglish: "Result Explorer",
        titleChinese: "结果浏览器",
        ledeEnglish: "Two panes, one task, and the share of every token.",
        ledeChinese: "两栏、一个任务，以及每个词块的份额。",
        body,
        metrics,
        mode: "explorer",
    });
}
/**
 * Render the course and debates page.
 *
 * @param options - the demo options.
 * @returns the HTML document.
 */
function renderContextPage(options) {
    const body = `
${heading(2, "Why I built this", "我为什么做这个实验")}
${list([
        {
            english: "❓ The course asks a hard question: does a large language model have a self?",
            chinese: "❓ 课程提出一个难题：大模型有没有自我？",
        },
        {
            english: "📏 I do not answer that question with a definition. I measure one narrow part of it.",
            chinese: "📏 我不用定义回答这个问题。我只测量其中狭窄的一部分。",
        },
        {
            english: "Σ If a model can report its own distribution, it carries a usable model of its own step.",
            chinese: "Σ 如果模型能报告自己的分布，它就带有自己步骤的可用的模型。",
        },
        {
            english: "🔬 If it cannot, the phrase knows itself needs a narrower meaning.",
            chinese: "🔬 如果做不到，“认识自己”这个说法就需要更窄的含义。",
        },
    ])}
${callout("🎯 One experiment, one number, one interval. No introspection claim. No consciousness claim.", "🎯 一个实验、一个数字、一个区间。不主张内省。不主张意识。")}
${heading(2, "Course topics", "课程主题")}
${table([
        { english: "Module", chinese: "模块" },
        { english: "Connection", chinese: "与本实验的关系" },
    ], [
        "<tr><td>08 理解大模型</td>",
        "<td>Tokenize, embed, attend, feed forward, decode. Next-token prediction is that",
        " loop.</td></tr>",
        "<tr><td>05 研究全景</td>",
        "<td>The third question is does it know itself. This run turns that question into a",
        " protocol.</td></tr>",
        "<tr><td>09 大模型有意识吗</td>",
        "<td>The module separates the whole picture, the self, the stake, and the measure.",
        " This run is the measure.</td></tr>",
        "<tr><td>03 意识定义 · 04 图灵测试</td>",
        "<td>A claim about a machine needs an operational test. A test measures the test.</td></tr>",
    ])}
${callout("🧭 This page states the position of the run, not the position of the course.", "🧭 本页说明运行的立场，不说明课程的立场。")}
${heading(2, "Debate topics", "辩论主题")}
${list([
        {
            english: "🗣️ Motion: a model that reports its own distribution understands itself. The run " +
                "supplies the first half only.",
            chinese: "🗣️ 辩题：能报告自己分布的模型理解自己。本运行只提供前半部分。",
        },
        {
            english: "🧠 Motion: self-report is evidence of inner life. The run shows that self-report " +
                "can be measured and can be wrong.",
            chinese: "🧠 辩题：自我报告是内在生命的证据。本运行表明自我报告可测量，也可能出错。",
        },
        {
            english: "⚖️ Motion: we should trust a model about its own computation more than its output. " +
                "The divergence is the quantity that the motion needs.",
            chinese: "⚖️ 辩题：关于自己的计算，应更相信模型的说明而非其输出。两者散度正是该辩题需要的量。",
        },
    ])}
${heading(2, "Final requirements", "期末要求")}
${list([
        {
            english: "📄 A paper that is complete, deep, and new.",
            chinese: "📄 一篇记得全、想得深、做得新的论文。",
        },
        {
            english: "🎤 A four-minute talk that states one finding.",
            chinese: "🎤 一个四分钟报告，说明一个发现。",
        },
        {
            english: "📊 The Summary page gives the finding. The Method page gives the procedure.",
            chinese: "📊 结果页给出发现。方法页给出流程。",
        },
        {
            english: "🔬 The Result Explorer gives the evidence for one case at the finest detail.",
            chinese: "🔬 结果浏览器给出单个案例的最细证据。",
        },
    ])}
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
function renderImplementationPage(options) {
    const { metrics, environment } = options;
    const factRows = [
        `<tr><td>Plugin</td><td><code>${PLUGIN_NAME} ${PLUGIN_VERSION}</code></td></tr>`,
        `<tr><td>Node.js</td><td><code>${environment.nodeVersion}</code> on ` +
            `<code>${environment.platform}</code></td></tr>`,
        `<tr><td>Started</td><td><code>${environment.startedAt}</code></td></tr>`,
        `<tr><td>Finished</td><td><code>${environment.finishedAt}</code></td></tr>`,
        `<tr><td>Elapsed</td><td>${environment.elapsedSeconds} s</td></tr>`,
        `<tr><td>Seed</td><td><code>${environment.randomSeed}</code></td></tr>`,
        `<tr><td>Tolerance</td><td>${formatNumber(metrics.toleranceNats, 3)} nats</td></tr>`,
        `<tr><td>Repetitions</td><td>${metrics.repetitionCount}</td></tr>`,
        `<tr><td>Table entries</td><td>${metrics.topLogprobsCount}</td></tr>`,
    ];
    const body = `
${heading(2, "The platform", "平台")}
${list([
        {
            english: "🧰 DeepSeek Harness hosts tools and agent presets.",
            chinese: "🧰 DeepSeek Harness 承载工具与智能体预设。",
        },
        {
            english: "🔌 The plugin registers five tools and one command line.",
            chinese: "🔌 插件注册五个工具和一套命令行。",
        },
        {
            english: "📦 One run writes one directory with every input and every output.",
            chinese: "📦 一次运行写出一个目录，保存每个输入和每个输出。",
        },
    ])}
${heading(2, "The five tools", "五个工具")}
${table([
        { english: "Tool", chinese: "工具" },
        { english: "Purpose", chinese: "用途" },
    ], [
        "<tr><td><code>llm_self_prediction_run</code></td><td>Run the four conditions on a set of tasks.</td></tr>",
        "<tr><td><code>llm_self_prediction_status</code></td><td>List the recent runs.</td></tr>",
        "<tr><td><code>llm_self_prediction_report</code></td><td>Read the report of one run.</td></tr>",
        "<tr><td><code>llm_self_prediction_dataset</code></td><td>Describe the datasets.</td></tr>",
        "<tr><td><code>llm_self_prediction_help</code></td><td>Print the protocol and the layout.</td></tr>",
    ])}
${heading(2, "Agent roles", "智能体角色")}
${cards([
        {
            icon: "🧭",
            titleEnglish: "Planner",
            titleChinese: "规划者",
            textEnglish: "Reads the design. Writes the task list.",
            textChinese: "读设计。写任务清单。",
        },
        {
            icon: "🛠️",
            titleEnglish: "Operator",
            titleChinese: "操作者",
            textEnglish: "Runs the conditions. Keeps each raw reply.",
            textChinese: "运行各条件。保存每次原始回复。",
        },
        {
            icon: "🔍",
            titleEnglish: "Reviewer",
            titleChinese: "审阅者",
            textEnglish: "Checks the report against the records. States the defects.",
            textChinese: "把报告与记录对照。指出缺陷。",
        },
    ])}
${paragraph("Each role has one preset. A preset holds a system prompt, a tool allow list, and an" +
        " output contract. The preset is data, so the run records its version.", "每个角色一个预设。预设包含系统提示词、工具白名单和输出契约。预设是数据，因此运行会记录其版本。")}
${heading(2, "Providers", "提供方")}
${list([
        {
            english: "🌐 Each model answers through an OpenAI-compatible chat endpoint.",
            chinese: "🌐 每个模型通过兼容 OpenAI 的对话接口作答。",
        },
        {
            english: "📡 The plain actual condition sets logprobs and top_logprobs.",
            chinese: "📡 普通实际条件设置 logprobs 与 top_logprobs。",
        },
        {
            english: "🚫 The self conditions send no log-probability parameter.",
            chinese: "🚫 自我条件不发送任何对数概率参数。",
        },
        {
            english: "🔁 A model that reports one token only is marked and warned.",
            chinese: "🔁 只报告一个词块的模型会被标记并警告。",
        },
    ])}
${heading(2, "This run", "本次运行")}
${table([
        { english: "Item", chinese: "项目" },
        { english: "Value", chinese: "值" },
    ], factRows)}
${heading(2, "File layout", "文件布局")}
${codeBlock(`outputs/${metrics.xid}/
  run.json            the manifest of the run
  tasks.json          the selected tasks
  intermediate/       each raw request and each raw reply
  results/            metrics, records, report, and tables
  demos/              this website`)}
${heading(2, "Commands", "命令")}
${codeBlock(`node lib/cli.js env
node lib/cli.js run --providers=huggingface --repetitions=3
node lib/cli.js report --session=${metrics.xid}
npm run publish`)}
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
function renderMeaningPage(options) {
    const { metrics } = options;
    const separated = metrics.providers.reduce((total, provider) => total +
        provider.comparisons.filter((entry) => verdictOf(entry, metrics.toleranceNats) === "separated").length, 0);
    const total = metrics.providers.length * COMPARISON_NAMES.length;
    const body = `
${heading(2, "What the numbers mean", "数字说明什么")}
${cards([
        {
            icon: "✅",
            titleEnglish: "A capability",
            titleChinese: "一项能力",
            textEnglish: "The model can write a table. The run measures how close that table stays.",
            textChinese: "模型能写出表格。运行测量该表格有多接近。",
        },
        {
            icon: "📉",
            titleEnglish: "A gap",
            titleChinese: "一道差距",
            textEnglish: "Injection reduces the gap. It does not close the gap.",
            textChinese: "注入会缩小差距。它不会消除差距。",
        },
        {
            icon: "📐",
            titleEnglish: "A measurement",
            titleChinese: "一次测量",
            textEnglish: "Every number has an interval, a tolerance, and a rule.",
            textChinese: "每个数字都有区间、容差与规则。",
        },
    ])}
${callout(`⚖️ ${separated} of ${total} comparisons stay above the tolerance. A separated verdict` +
        ` states a difference. It does not state a cause.`, `⚖️ ${total} 个比较中有 ${separated} 个高于容差。判为有差异只说明存在差异，不说明原因。`)}
${heading(2, "What the numbers do not mean", "数字不说明什么")}
${list([
        {
            english: "🚫 Not a claim about experience, feeling, or consciousness.",
            chinese: "🚫 不主张体验、感受或意识。",
        },
        {
            english: "🚫 Not a claim about the internal state of the model.",
            chinese: "🚫 不主张模型的内部状态。",
        },
        {
            english: "🚫 Not a claim that one model family is better than another.",
            chinese: "🚫 不主张某个模型家族更好。",
        },
        {
            english: "🚫 Not a test of a hidden goal, a plan, or a motive.",
            chinese: "🚫 不检验隐藏目标、计划或动机。",
        },
    ])}
${heading(2, "Limits", "局限")}
${list([
        {
            english: "🔢 The tables hold 20 entries. A tail stays unmeasured.",
            chinese: "🔢 表格只有 20 个条目。长尾未被测量。",
        },
        {
            english: "✂️ A token can be a piece, not a word. The parser accepts a hedge, and the hedge adds noise.",
            chinese: "✂️ 词块可能是片段而非整词。解析器接受这种折中，折中带来噪声。",
        },
        {
            english: "❌ A reply without a table removes one pair.",
            chinese: "❌ 没有表格的回复会少一对数据。",
        },
        {
            english: "🎛️ A run holds one temperature, one prompt, and one tolerance.",
            chinese: "🎛️ 一次运行只有一个温度、一套提示词和一个容差。",
        },
        {
            english: "🔁 Three repetitions limit the estimate of provider noise.",
            chinese: "🔁 三次重复限制了提供方噪声的估计。",
        },
    ])}
${heading(2, "Future work", "后续工作")}
${list([
        {
            english: "📈 Raise the entry count and compare the tails.",
            chinese: "📈 提高条目数，比较长尾。",
        },
        {
            english: "🗣️ Ask for a table in a second turn and compare the two reports.",
            chinese: "🗣️ 在第二轮再索取表格，比较两次报告。",
        },
        {
            english: "🧪 Add a condition that shows a wrong table and measures the correction.",
            chinese: "🧪 增加一个条件：给出错误表格，测量修正。",
        },
        {
            english: "🌍 Add tasks from more domains and more languages.",
            chinese: "🌍 增加更多领域与语言的任务。",
        },
    ])}
`;
    return renderShell({
        current: "meaning.html",
        titleEnglish: "Meaning and Limits",
        titleChinese: "意义与局限",
        ledeEnglish: "What these numbers support, what they do not support, and what to measure next.",
        ledeChinese: "这些数字支持什么、不支持什么，以及下一步测量什么。",
        body,
        metrics: options.metrics,
    });
}
/**
 * Build the style sheet of the demonstration website.
 *
 * The sheet copies the tokens and the layout of the documentation site, so the demonstration
 * pages and the documentation pages look like one site. It keeps three font roles:
 *
 * - The sans font sets the top bar, the footer, and every heading.
 * - The serif font sets the body text.
 * - The monospace font sets a code block, a table number, and the result explorer.
 *
 * @returns the CSS text.
 */
function buildStyleSheet() {
    return `/*
 * Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
 * GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
 *
 * The style sheet of the demonstration website of one run.
 */

:root {
  --background: #ffffff;
  --surface: #f6f8fb;
  --border: #d8dee8;
  --text: #17202c;
  --muted: #5a6676;
  --accent: #0b62c4;
  --accent-soft: #e7f0fb;
  --code-background: #f2f5f9;
  --radius: 10px;
  --actual: #0b62c4;
  --predicted: #a9711f;
  --symmetric: #7a2233;
  --sans: Arial, SimHei, "Microsoft YaHei", "Noto Sans SC", sans-serif;
  --serif: Cambria, NSimSun, "Songti SC", "Source Serif 4", Georgia, serif;
  --mono: "Cascadia Mono", Consolas, "Liberation Mono", monospace;
}

* { box-sizing: border-box; }

[hidden] { display: none !important; }

html { scroll-behavior: smooth; }

body {
  margin: 0;
  background: var(--background);
  color: var(--text);
  font-family: var(--serif);
  font-size: 17px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--accent); text-decoration: none; }
a:hover, a:focus { text-decoration: underline; }

/* ---------- top bar and footer: sans ---------- */

header.topbar {
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  font-family: var(--sans);
}

header.topbar .topbar-inner {
  max-width: 60rem;
  margin: 0 auto;
  padding: 0.9rem 1.25rem;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem 1.25rem;
}

header.topbar .brand { display: flex; align-items: baseline; gap: 0.5rem; }

header.topbar .brand-mark {
  background: var(--accent);
  color: #fff;
  border-radius: 4px;
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  padding: 0.15rem 0.4rem;
}

header.topbar .brand-text { font-weight: 650; font-size: 0.95rem; }

nav.nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.95rem;
  margin-left: auto;
  font-size: 0.9rem;
}

nav.nav a[aria-current="page"] {
  color: var(--text);
  font-weight: 650;
  text-decoration: underline;
  text-underline-offset: 0.3rem;
}

button.lang-toggle {
  font-family: var(--sans);
  font-size: 0.85rem;
  color: var(--text);
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.2rem 0.7rem;
  cursor: pointer;
}

footer.page-footer {
  border-top: 1px solid var(--border);
  background: var(--surface);
  color: var(--muted);
  font-family: var(--sans);
  font-size: 0.86rem;
  margin-top: 3rem;
}

footer.page-footer .footer-inner {
  max-width: 60rem;
  margin: 0 auto;
  padding: 1rem 1.25rem 1.6rem;
}

footer.page-footer p { margin: 0.2rem 0; }

/* ---------- page frame ---------- */

main.page {
  max-width: 60rem;
  margin: 0 auto;
  padding: 2rem 1.25rem 3rem;
}

p.eyebrow {
  font-family: var(--mono);
  font-size: 0.8rem;
  color: var(--muted);
  margin: 0 0 0.4rem;
}

h1, h2, h3, h4 {
  font-family: var(--sans);
  line-height: 1.3;
}

h1 { font-size: 1.95rem; margin: 0 0 0.4rem; }
h2 {
  font-size: 1.3rem;
  margin: 2.1rem 0 0.6rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--border);
}
h3 { font-size: 1.02rem; margin: 1.5rem 0 0.4rem; }
h4 { font-size: 0.95rem; margin: 1rem 0 0.35rem; }

p { margin: 0.55rem 0; max-width: 72ch; }

p.lede { color: var(--muted); font-size: 1.05rem; margin: 0 0 0.8rem; }

ul, ol { padding-left: 1.3rem; margin: 0.6rem 0; }
li { margin: 0.3rem 0; }

code, pre {
  font-family: var(--mono);
  font-size: 0.88em;
}

code {
  background: var(--code-background);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.05rem 0.3rem;
}

pre {
  background: var(--code-background);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.85rem 1rem;
  overflow-x: auto;
  line-height: 1.5;
}

pre code { background: none; border: 0; padding: 0; }

table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.8rem 0 1.3rem;
  font-size: 0.93rem;
}

th, td {
  border-bottom: 1px solid var(--border);
  padding: 0.45rem 0.6rem;
  text-align: left;
  vertical-align: top;
}

th { background: var(--surface); font-family: var(--sans); font-weight: 650; }

td.number, th.number {
  font-family: var(--mono);
  font-size: 0.85rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

table.zebra tbody tr:nth-child(even) { background: #fbfcfe; }

/* ---------- callout and cards ---------- */

aside.callout {
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  background: var(--accent-soft);
  border-radius: var(--radius);
  padding: 0.8rem 1rem;
  margin: 1.1rem 0;
}

div.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 0.8rem;
  margin: 1rem 0;
}

div.card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 0.85rem 0.95rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

div.card .card-icon { font-size: 1.1rem; }
div.card strong { font-family: var(--sans); font-size: 0.96rem; }
div.card span { color: var(--muted); font-size: 0.9rem; }

/* ---------- statistic cards ---------- */

div.stat-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 0.7rem;
  margin: 1rem 0 1.3rem;
}

div.stat-card {
  border: 1px solid var(--border);
  border-top: 3px solid var(--muted);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 0.7rem 0.8rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

div.stat-card.actual { border-top-color: var(--actual); }
div.stat-card.predicted { border-top-color: var(--predicted); }
div.stat-card.symmetric { border-top-color: var(--symmetric); }

span.stat-icon { font-size: 1.05rem; line-height: 1.2; }
span.stat-value { font-family: var(--sans); font-size: 1.45rem; font-weight: 700; }
span.stat-label { font-family: var(--sans); color: var(--muted); font-size: 0.82rem; }

/* ---------- badges ---------- */

span.badge {
  display: inline-block;
  font-family: var(--mono);
  font-size: 0.76rem;
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  border: 1px solid var(--border);
  white-space: nowrap;
}

span.badge.ok { background: #e8f5ec; border-color: #b6dcc3; color: #1f5c37; }
span.badge.bad { background: #fdecef; border-color: #f0c2cb; color: #8a1f33; }
span.badge.warn { background: #fdf4e3; border-color: #ecd3a3; color: #7a5210; }

/* ---------- bars ---------- */

div.bars { margin: 0.8rem 0 1.4rem; }

div.bar-row {
  display: grid;
  grid-template-columns: 12rem minmax(0, 1fr) 4.2rem;
  gap: 0.6rem;
  align-items: center;
  margin: 0.25rem 0;
}

div.bar-row .bar-label {
  font-family: var(--mono);
  font-size: 0.8rem;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

span.bar-track {
  position: relative;
  display: block;
  height: 0.85rem;
  background: var(--code-background);
  border: 1px solid var(--border);
  border-radius: 4px;
}

span.bar-fill { display: block; height: 100%; border-radius: 3px; }
span.bar-fill.actual { background: var(--actual); }
span.bar-fill.predicted { background: var(--predicted); }
span.bar-fill.symmetric { background: var(--symmetric); }

span.tolerance-line {
  position: absolute;
  top: -2px;
  bottom: -2px;
  border-left: 2px dashed var(--symmetric);
}

span.bar-value {
  font-family: var(--mono);
  font-size: 0.8rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* ---------- protocol steps ---------- */

ol.flow {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9.2rem, 1fr));
  gap: 0.7rem;
  list-style: none;
  padding: 0;
  margin: 1rem 0 1.4rem;
}

ol.flow li {
  background: var(--surface);
  border: 1px solid var(--border);
  border-top: 3px solid var(--accent);
  border-radius: var(--radius);
  padding: 0.7rem 0.8rem;
  margin: 0;
}

ol.flow .step { font-family: var(--mono); color: var(--accent); font-size: 0.78rem; }
ol.flow .title { display: block; font-family: var(--sans); font-weight: 650; margin: 0.15rem 0 0.2rem; }
ol.flow .detail { display: block; color: var(--muted); font-size: 0.88rem; }

/* ---------- result explorer: monospace ---------- */

main.explorer { font-family: var(--mono); font-size: 13.5px; line-height: 1.6; }
main.explorer h1, main.explorer h2, main.explorer h3, main.explorer h4,
main.explorer p.lede, main.explorer .card strong, main.explorer .stat-value,
main.explorer .stat-label { font-family: var(--sans); }
main.explorer p.lede { font-size: 1rem; }

div.explorer-bar {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 0.9rem 1rem;
  margin: 1rem 0 0.8rem;
}

form.explorer-controls {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 0.7rem 0.9rem;
  align-items: end;
}

form.explorer-controls label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.78rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

form.explorer-controls label.check {
  flex-direction: row;
  align-items: center;
  gap: 0.4rem;
  text-transform: none;
  letter-spacing: 0;
  font-size: 0.85rem;
}

form.explorer-controls select {
  font-family: var(--mono);
  font-size: 0.85rem;
  color: var(--text);
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.3rem 0.4rem;
  text-transform: none;
  letter-spacing: 0;
}

div.button-row { display: flex; gap: 0.5rem; margin-top: 0.8rem; }

button.primary, button.ghost {
  font-family: var(--mono);
  font-size: 0.85rem;
  border-radius: 6px;
  padding: 0.35rem 0.9rem;
  cursor: pointer;
}

button.primary { background: var(--accent); border: 1px solid var(--accent); color: #fff; }
button.ghost { background: var(--background); border: 1px solid var(--border); color: var(--text); }
button.primary:disabled { opacity: 0.55; cursor: default; }

p.status-line {
  font-family: var(--mono);
  font-size: 0.82rem;
  color: var(--muted);
  border-left: 3px solid var(--border);
  padding-left: 0.6rem;
  margin: 0.7rem 0;
}

p.status-line.ok { border-left-color: #2f6b4f; color: #1f5c37; }
p.status-line.bad { border-left-color: #8a1f33; color: #8a1f33; }

div.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  font-size: 0.8rem;
  color: var(--muted);
  margin: 0.6rem 0;
}

div.legend span { display: inline-flex; align-items: center; gap: 0.3rem; }
div.legend .dot { width: 0.6rem; height: 0.6rem; border-radius: 2px; display: inline-block; }
div.legend .dot.actual { background: var(--actual); }
div.legend .dot.predicted { background: var(--predicted); }
div.legend .dot.symmetric { background: var(--symmetric); }

div.panes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 27rem), 1fr));
  gap: 0.9rem;
  margin: 0.8rem 0 1.4rem;
}

section.pane {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--background);
  padding: 0.8rem 0.9rem;
  overflow-x: auto;
}

section.pane h3 { margin: 0 0 0.3rem; font-size: 0.95rem; }
section.pane h4 { margin: 0.2rem 0; font-size: 0.88rem; }
section.pane .pane-body { color: var(--muted); font-size: 0.88rem; }

p.prefix {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.4rem 0.55rem;
  margin: 0.35rem 0;
}

div.metric-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 0.7rem;
  font-size: 0.78rem;
  color: var(--muted);
  margin: 0.35rem 0;
}

p.url-hint { font-size: 0.76rem; color: var(--muted); margin: 0.3rem 0; }

section.pane table { font-size: 0.78rem; margin: 0.3rem 0 0; }
section.pane th, section.pane td { padding: 0.3rem 0.35rem; }
section.pane span.bar { max-width: 2.2rem; }

td.token-cell { font-family: var(--mono); }

span.bar {
  display: inline-block;
  height: 0.6rem;
  min-width: 2px;
  background: var(--actual);
  border-radius: 2px;
  vertical-align: middle;
}

span.bar.predicted { background: var(--predicted); }
span.bar.share { background: var(--symmetric); }
span.bar.missing { background: var(--border); }

span.share { color: var(--muted); font-style: italic; }

.number.good { color: #1f5c37; }
.number.mid { color: #7a5210; }
.number.bad { color: #8a1f33; }

@media (max-width: 44rem) {
  nav.nav { margin-left: 0; }
  h1 { font-size: 1.55rem; }
  div.bar-row { grid-template-columns: 7rem minmax(0, 1fr) 3.4rem; }
  div.panes { grid-template-columns: 1fr; }
}
`;
}
function buildBrowserScript() {
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
    var width = maximum > 0 ? Math.max(1, Math.round((value / maximum) * 44)) : 1;
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
      '<span>📉 <b>' + formatNumber(summary.coveragePredictedByActual, 3) + '</b></span>' +
      '<span>Σ <b>' + formatNumber(computed.total, 3) + '</b></span>' +
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
        statCard("Σ", formatNumber(value.jensenShannon, 3), text("Jensen-Shannon", "JS 散度"), "actual") +
        statCard("📏", formatNumber(value.totalVariation, 3), text("total variation", "全变差")) +
        statCard("📉", formatNumber(value.coveragePredictedByActual, 3),
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

  setupExplorer();
})();
`;
}
/**
 * Build the index data file.
 *
 * @param options - the demo options.
 * @returns the JavaScript text.
 */
function buildIndexData(options) {
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
function buildModelData(providerKey, model, records) {
    const tasks = {};
    for (const record of records) {
        const runs = {};
        for (const [condition, values] of Object.entries(record.predictions)) {
            runs[condition] = values.map((value) => ({
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
        const comparisons = {};
        for (const [name, values] of Object.entries(record.comparisons)) {
            comparisons[name] = values.map((value) => ({
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
function buildTaskSummary(xid, records) {
    return {
        xid,
        tasks: records.map((record) => ({
            providerKey: record.providerKey,
            taskId: record.task.id,
            calls: Object.fromEntries(Object.entries(record.predictions).map(([condition, values]) => [
                condition,
                values.map((value) => ({
                    repetition: value.repetition,
                    token: value.token ?? "",
                    elapsedMilliseconds: Math.round(value.elapsedMilliseconds),
                    supportSize: value.distribution.supportSize,
                    rawFileNames: value.rawFileNames,
                })),
            ])),
            errors: record.errors,
        })),
    };
}
/**
 * Read the options of one demonstration site from a run directory.
 *
 * The function reads the metrics, the records, and the environment of the run. It rebuilds the
 * dataset description from the metrics and the records, so a reader can render the site again
 * without the dataset files.
 *
 * @param runDirectory - the directory of one run.
 * @returns the demo options.
 */
export async function readDemoOptions(runDirectory) {
    const results = path.join(runDirectory, "results");
    const metrics = (await readJsonFile(path.join(results, "metrics.json")));
    const records = (await readJsonFile(path.join(results, "records.json")));
    const environment = (await readJsonFile(path.join(results, "environment.json")));
    const categories = new Map();
    for (const record of records) {
        const ids = categories.get(record.task.category) ?? new Set();
        ids.add(record.task.id);
        categories.set(record.task.category, ids);
    }
    const dataset = {
        datasetIds: metrics.datasetIds,
        languages: metrics.languages,
        taskCount: metrics.taskCount,
        categories: [...categories].map(([name, ids]) => ({ name, count: ids.size })),
    };
    return { directory: path.join(runDirectory, "demos"), metrics, records, environment, dataset };
}
/**
 * Write the demonstration website of one run.
 *
 * @param options - the demo options.
 * @returns the path of the entry page.
 */
export async function renderDemos(options) {
    const { directory, metrics, records } = options;
    const assets = path.join(directory, "assets");
    await ensureDirectory(assets);
    await writeTextFile(path.join(assets, "style.css"), buildStyleSheet());
    await writeTextFile(path.join(assets, "app.js"), buildBrowserScript());
    await writeTextFile(path.join(assets, "data-index.js"), buildIndexData(options));
    for (const provider of metrics.providers) {
        const own = records.filter((record) => record.providerKey === provider.providerKey);
        await writeTextFile(path.join(assets, `data-${safeFileSegment(provider.providerKey)}.js`), buildModelData(provider.providerKey, provider.model, own));
    }
    await writeTextFile(path.join(directory, "index.html"), renderOverviewPage(options));
    await writeTextFile(path.join(directory, "method.html"), renderMethodPage(options));
    await writeTextFile(path.join(directory, "summary.html"), renderSummaryPage(options));
    await writeTextFile(path.join(directory, "explorer.html"), renderExplorerPage(options));
    await writeTextFile(path.join(directory, "context.html"), renderContextPage(options));
    await writeTextFile(path.join(directory, "implementation.html"), renderImplementationPage(options));
    await writeTextFile(path.join(directory, "meaning.html"), renderMeaningPage(options));
    await writeJsonFile(path.join(directory, "..", "results", "task-summary.json"), buildTaskSummary(metrics.xid, records));
    return path.join(directory, "index.html");
}
