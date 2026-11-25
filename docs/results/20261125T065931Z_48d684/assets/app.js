(function () {
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
