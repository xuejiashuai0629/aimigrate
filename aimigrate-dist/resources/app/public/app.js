const $source = document.querySelector("#source");
const $target = document.querySelector("#target");
const $session = document.querySelector("#session");
const $bindButton = document.querySelector("#bindButton");
const $mode = document.querySelector("#mode");
const $planButton = document.querySelector("#planButton");
const $executeButton = document.querySelector("#executeButton");
const $targetCwd = document.querySelector("#targetCwd");
const $updateIndex = document.querySelector("#updateIndex");
const $targetCwdLabel = document.querySelector("#targetCwdLabel");
const $targetCwdHelp = document.querySelector("#targetCwdHelp");
const $summaryEngineSection = document.querySelector("#summaryEngineSection");
const $summaryEngine = document.querySelector("#summaryEngine");
const $compressionApiButton = document.querySelector("#compressionApiButton");
const $apiModal = document.querySelector("#apiModal");
const $apiCloseButton = document.querySelector("#apiCloseButton");
const $apiSaveButton = document.querySelector("#apiSaveButton");
const $apiClearButton = document.querySelector("#apiClearButton");
const $apiBaseUrl = document.querySelector("#apiBaseUrl");
const $apiKey = document.querySelector("#apiKey");
const $summaryModel = document.querySelector("#summaryModel");
const $planSummary = document.querySelector("#planSummary");
const $reportList = document.querySelector("#reportList");
const $archiveList = document.querySelector("#archiveList");
const $artifactViewer = document.querySelector("#artifactViewer");
const $refreshArtifactsButton = document.querySelector("#refreshArtifactsButton");
let latestPlan = null;
let userSelectedMode = null;
let migrationPollTimer = null;
const $output = document.querySelector("#output");
const API_CONFIG_KEY = "aimigrate.compressionApi";
const SUMMARY_ENGINE_KEY = "aimigrate.summaryEngine";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function setOutput(text) {
  $output.textContent = text;
}

function readApiConfig() {
  try {
    return JSON.parse(localStorage.getItem(API_CONFIG_KEY) || "{}");
  } catch {
    return {};
  }
}

function loadApiConfigToForm() {
  const config = readApiConfig();
  $apiBaseUrl.value = config.apiBaseUrl || "";
  $apiKey.value = config.apiKey || "";
  $summaryModel.value = config.summaryModel || "";
}

function loadSummaryEngine() {
  const saved = localStorage.getItem(SUMMARY_ENGINE_KEY);
  if (saved === "api" || saved === "offline") {
    $summaryEngine.value = saved;
  }
}

function saveSummaryEngine() {
  localStorage.setItem(SUMMARY_ENGINE_KEY, $summaryEngine.value);
}

function openApiModal() {
  loadApiConfigToForm();
  $apiModal.hidden = false;
}

function closeApiModal() {
  $apiModal.hidden = true;
}

function saveApiConfig() {
  const config = {
    apiBaseUrl: $apiBaseUrl.value.trim(),
    apiKey: $apiKey.value,
    summaryModel: $summaryModel.value.trim(),
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(API_CONFIG_KEY, JSON.stringify(config));
  closeApiModal();
}

function clearApiConfig() {
  localStorage.removeItem(API_CONFIG_KEY);
  $apiBaseUrl.value = "";
  $apiKey.value = "";
  $summaryModel.value = "";
}

function updateTargetConfig() {
  $updateIndex.checked = $target.value === "codex";
  if ($target.value === "codex") {
    $targetCwdLabel.textContent = "目标工作目录（Codex 需要）";
    $targetCwdHelp.textContent = "Codex 会话会绑定这个目录。例如 E:\\Desktop。来源是豆包/DeepSeek 时必填；来源是 Codex/Claude Code 时可留空。下方勾选项会把导入会话登记进 Codex 列表，推荐开启。";
  } else if ($target.value === "claude-code") {
    $targetCwdLabel.textContent = "目标工作目录（Claude Code 需要）";
    $targetCwdHelp.textContent = "Claude Code 会话会按这个目录归档。例如 E:\\Desktop。来源是豆包/DeepSeek 时必填；来源是 Codex/Claude Code 时可留空。";
  } else {
    $targetCwdLabel.textContent = "目标工作目录";
    $targetCwdHelp.textContent = "当前目标不需要本地工作目录。";
  }
}

function routeLabel(route) {
  const modeNames = {
    native: "原生会话迁移",
    transcript: "完整历史导入",
    "archive-active-window": "完整归档 + 活跃窗口",
    summary: "压缩摘要续聊",
    handoff: "交接包",
  };
  const statusNames = {
    experimental: "实验可用",
    available: "可用",
    planned: "计划中",
    hidden: "隐藏兜底",
  };
  return `L${route.level} ${modeNames[route.mode] || route.mode} · ${statusNames[route.status] || route.status}`;
}

function renderPlanSummary(plan) {
  const recommendation = plan.routes.find((route) =>
    route.level === plan.recommendation.level && route.mode === plan.recommendation.mode
  );
  const [selectedLevelText, selectedMode] = $mode.value.split(":");
  const selected = plan.routes.find((route) =>
    route.level === Number(selectedLevelText) && route.mode === selectedMode
  );
  const isUserSelected = Boolean(selected) && $mode.value !== `${plan.recommendation.level}:${plan.recommendation.mode}`;
  const isSummaryMode = selectedMode === "summary" || selectedMode === "archive-active-window";
  const engineName = $summaryEngine?.value === "api" ? "API 模型" : "离线提取";
  const cost = selected?.migrationTokenCost ?? recommendation?.migrationTokenCost;
  const costText = isSummaryMode
    ? (engineName === "API 模型" ? "摘要消耗 API 额度" : "摘要生成 0 token（离线）")
    : typeof cost === "number" && cost === 0 ? "迁移本身 0 token" : cost || "见说明";
  const routeRows = plan.routes
    .filter((route) => route.status !== "hidden")
    .map((route) => `
      <div class="route-row ${route.level === selected?.level && route.mode === selected?.mode ? "selected" : ""} ${route.level === recommendation?.level && route.mode === recommendation?.mode ? "recommended" : ""}">
        <strong>${escapeHtml(routeLabel(route))}</strong>
        <span>${escapeHtml(route.description)}</span>
        ${route.level === recommendation?.level && route.mode === recommendation?.mode ? `<em>系统推荐</em>` : ""}
        ${route.level === selected?.level && route.mode === selected?.mode && isUserSelected ? `<em>当前选择</em>` : ""}
      </div>
    `).join("");

  $planSummary.innerHTML = `
    <div class="plan-headline">
      <span class="badge">${escapeHtml(routeLabel(selected || recommendation || plan.recommendation))}</span>
      <strong>${escapeHtml(plan.sourceApp)} → ${escapeHtml(plan.targetApp)}</strong>
    </div>
    <p class="plan-reason">
      ${isUserSelected && selected
        ? `已保留你的选择：${escapeHtml(routeLabel(selected))}。系统推荐是：${escapeHtml(routeLabel(recommendation || plan.recommendation))}。`
        : escapeHtml(plan.recommendation.reason)}
    </p>
    <div class="metric-grid">
      <div><span>估算上下文</span><strong>${escapeHtml(plan.estimatedTokens.toLocaleString())} tokens</strong></div>
      <div><span>目标上下文窗口</span><strong>${escapeHtml(plan.targetContextWindowTokens.toLocaleString())} tokens</strong></div>
      <div><span>迁移成本</span><strong>${escapeHtml(String(costText))}</strong>${isSummaryMode ? `<small>引擎：${engineName}</small>` : ""}</div>
      <div><span>超长上下文</span><strong>${plan.activeWindowRecommended ? "是" : "否"}</strong></div>
    </div>
    <div class="route-list">${routeRows}</div>
  `;
}

function renderImportSummary(result) {
  if (result.summaryMode) {
    // sendSummary result (web target)
    $planSummary.innerHTML = `
      <div class="plan-headline">
        <span class="badge success">迁移完成</span>
        <strong>${escapeHtml(result.targetApp || "")}</strong>
      </div>
      <div class="metric-grid">
        <div><span>发送方式</span><strong>摘要发送</strong></div>
        <div><span>摘要模式</span><strong>${escapeHtml(result.summaryMode || "unknown")}</strong></div>
        <div><span>摘要 tokens</span><strong>${escapeHtml(String(result.summaryEstimatedTokens ?? "—"))}</strong></div>
        <div><span>确认</span><strong>${result.sent ? "已发送" : "未确认"}</strong></div>
      </div>
      ${result.url ? `<div class="path-box"><span>目标会话</span><code>${escapeHtml(result.url)}</code></div>` : ""}
      ${result.confirmation ? `<p class="plan-reason">${escapeHtml(result.confirmation)}</p>` : ""}
    `;
    return;
  }
  // importNative result (local agent target)
  $planSummary.innerHTML = `
    <div class="plan-headline">
      <span class="badge success">迁移完成</span>
      <strong>${escapeHtml(result.targetApp)}</strong>
    </div>
    <div class="metric-grid">
      <div><span>写入事件</span><strong>${escapeHtml((result.eventCount ?? 0).toLocaleString())}</strong></div>
      <div><span>写入消息</span><strong>${escapeHtml((result.messageCount ?? result.responseItemCount ?? 0).toLocaleString())}</strong></div>
      <div><span>文件大小</span><strong>${escapeHtml(((result.bytes || 0) / 1024).toFixed(1))} KB</strong></div>
      <div><span>校验</span><strong>${result.verification?.ok ? "通过" : "失败"}</strong></div>
    </div>
    <div class="path-box"><span>目标文件</span><code>${escapeHtml(result.targetPath)}</code></div>
    ${result.index ? `<div class="path-box"><span>Codex 索引</span><code>${result.index.updated ? "已更新" : escapeHtml(result.index.reason || "未更新")}</code></div>` : ""}
  `;
}

async function getJson(url) {
  const urlObj = new URL(url, "http://localhost");
  const p = urlObj.pathname;
  const q = Object.fromEntries(urlObj.searchParams);

  if (p === "/api/sources") return await window.aimigrate.getSources();
  if (p === "/api/targets") return await window.aimigrate.getTargets();
  if (p === "/api/sessions") return await window.aimigrate.getSessions(q.source);
  if (p === "/api/source-status") return await window.aimigrate.getSourceStatus(q.source);
  if (p === "/api/login/status") return await window.aimigrate.getLoginStatus();
  if (p === "/api/import/status") return await window.aimigrate.getMigrationStatus();
  if (p === "/api/artifacts") return await window.aimigrate.getArtifacts();
  if (p === "/api/artifacts/file") return await window.aimigrate.getArtifactFile(q.type, q.name);
  throw new Error("Unknown API: " + p);
}

async function postJson(url, body) {
  if (url === "/api/login/start") return await window.aimigrate.startLogin(body.source);
  if (url === "/api/plan") return await window.aimigrate.plan(body);
  if (url === "/api/import/start") return await window.aimigrate.startMigration(body);
  if (url === "/api/archive/start") return await window.aimigrate.startArchive(body);
  throw new Error("Unknown API: " + url);
}

async function loadSources() {
  $source.innerHTML = "<option>加载中…</option>";
  $source.disabled = true;
  const [sourceResponse, targets] = await Promise.all([
    getJson("/api/sources"),
    getJson("/api/targets"),
  ]);

  const sources = sourceResponse?.sources || sourceResponse || [];

  $source.innerHTML = "";
  for (const item of sources) {
    $source.append(new Option(`${item.displayName}（${item.status}）`, item.name));
  }

  $target.innerHTML = "";
  for (const item of targets) {
    const status = item.kind === "web"
      ? item.write?.summary?.status || "planned"
      : item.write?.native?.status || "planned";
    const statusLabel = item.kind === "web" ? "summary" : "native";
    $target.append(new Option(`${item.displayName}（${statusLabel}:${status}）`, item.name));
  }

  $source.disabled = false;

  await loadSessions();
}

async function loadSessions() {
  $bindButton.disabled = false;
  $bindButton.hidden = true;
  $session.disabled = true;
  $session.innerHTML = "<option>加载中…</option>";
  if (!$source.value) return;

  try {
    const status = await getJson(`/api/source-status?source=${encodeURIComponent($source.value)}`);
    if (status.kind === "agent" && !status.installed) {
      $session.innerHTML = `<option>⚠ ${status.detail || "该 AI 尚未安装，无法读取历史"}</option>`;
      return;
    }
    if (status.kind === "web" && status.requiresLogin && status.loggedIn === "unknown") {
      // Web AI: show bind prompt immediately instead of waiting for a slow browser check.
      const srcName = $source.value;
      const label = srcName === "deepseek"
        ? "未绑定 DeepSeek，点击去绑定"
        : srcName === "doubao" ? "未绑定豆包，点击去绑定" : "未绑定网页账号，点击去绑定";
      $session.innerHTML = `<option value="__login__">${label}</option>`;
      $session.disabled = false;
      $bindButton.hidden = false;
      // Still try to load sessions in the background (in case already logged in).
      try {
        const sessions = await getJson(`/api/sessions?source=${encodeURIComponent(srcName)}`);
        if (sessions.length > 0) {
          $session.innerHTML = "";
          for (const session of sessions) {
            $session.append(new Option(`${session.title} · ${session.updatedAt ? new Date(session.updatedAt).toLocaleString() : "网页会话"}`, session.path));
          }
          $session.disabled = false;
          $bindButton.hidden = true;
        }
      } catch {
        // Keep the bind prompt if list fails (not logged in).
      }
      return;
    }
  } catch {
    // 状态检测失败不阻断列表读取。
  }

  try {
    const sessions = await getJson(`/api/sessions?source=${encodeURIComponent($source.value)}`);
    $session.innerHTML = "";
    if (!sessions.length) {
      $session.append(new Option("未找到会话", ""));
      return;
    }
    for (const session of sessions) {
      $session.append(new Option(`${session.title} · ${new Date(session.updatedAt).toLocaleString()}`, session.path));
    }
    $session.disabled = false;
  } catch (error) {
    if (error.data?.code === "NO_LOGIN" || /未登录|未绑定/.test(error.message)) {
      const label = $source.value === "deepseek"
        ? "未绑定 DeepSeek，点击去绑定"
        : $source.value === "doubao" ? "未绑定豆包，点击去绑定" : "未绑定网页账号，点击去绑定";
      $session.innerHTML = `<option value="__login__">${label}</option>`;
      $session.disabled = false;
      $bindButton.hidden = false;
    } else {
      const isBrowserError = /browserType|launchPersistentContext|Target page|browser closed/i.test(error.message);
      const friendlyMsg = isBrowserError
        ? "浏览器启动失败，请稍后重试或重启 aimigrate"
        : `加载会话失败：${error.message.slice(0, 80)}`;
      $session.innerHTML = `<option>${friendlyMsg}</option>`;
    }
  }
}

async function bindSource() {
  const source = $source.value;
  if (!source) return;
  $bindButton.disabled = true;
  $session.innerHTML = "<option>等待浏览器窗口完成登录…</option>";
  setOutput("正在打开浏览器绑定窗口…");

  try {
    const data = await postJson("/api/login/start", { source });
    if (!data.started) throw new Error(data.message || data.error || "无法启动绑定流程");
    setOutput(data.job?.message || "正在打开浏览器绑定窗口…");
    pollLoginStatus();
  } catch (error) {
    setOutput(error.message);
    $session.innerHTML = "<option value=\"__login__\">未绑定网页账号，点击去绑定</option>";
    $bindButton.disabled = false;
  }
}

let loginPollTimer = null;

function pollLoginStatus() {
  if (loginPollTimer) clearTimeout(loginPollTimer);

  const tick = async () => {
    try {
      const job = await getJson("/api/login/status");
      setOutput(job.message || job.status);

      if (job.status === "running") {
        loginPollTimer = setTimeout(tick, 1000);
        return;
      }

      if (job.status === "success") {
        await loadSessions();
        return;
      }

      $session.innerHTML = "<option value=\"__login__\">未绑定网页账号，点击去绑定</option>";
      $session.disabled = false;
      $bindButton.hidden = false;
      $bindButton.disabled = false;
    } catch (error) {
      setOutput(`绑定状态查询失败：${error.message}`);
      $bindButton.hidden = false;
      $bindButton.disabled = false;
    }
  };

  tick();
}

async function loadPlan() {
  const previousMode = userSelectedMode || ($mode.value.includes(":") ? $mode.value : null);
  $executeButton.hidden = true;
  $executeButton.disabled = true;
  $mode.disabled = true;
  $mode.innerHTML = "<option>计算路线中…</option>";
  $planButton.disabled = true;
  setOutput("生成中…");

  try {
    const plan = await postJson("/api/plan", {
      source: $source.value,
      target: $target.value,
      path: $session.value,
      apiConfig: readApiConfig(),
    });

    $mode.innerHTML = "";
    for (const item of plan.routes) {
      const label = `${routeLabel(item)}${item.level === 0 ? "（隐藏兜底）" : ""}`;
      $mode.append(new Option(label, `${item.level}:${item.mode}`));
    }
    const recommended = `${plan.recommendation.level}:${plan.recommendation.mode}`;
    const selected = [...$mode.options].some((option) => option.value === previousMode)
      ? previousMode
      : recommended;
    if (selected !== recommended) {
      userSelectedMode = selected;
    }
    $mode.value = selected;
    $mode.disabled = false;
    $planButton.disabled = false;
    latestPlan = plan;
    const route = plan.routes.find((item) => item.level === plan.recommendation.level && item.mode === plan.recommendation.mode);
    const canExecute = Boolean(route && ["experimental", "available"].includes(route.status) &&
      ["native", "transcript", "summary", "archive-active-window"].includes(route.mode));
    $executeButton.hidden = !canExecute;
    $executeButton.disabled = !canExecute;
    renderPlanSummary(plan);
    setOutput(JSON.stringify(plan, null, 2));
    updateTargetConfig();
  } catch (error) {
    $mode.innerHTML = "<option>无法规划</option>";
    setOutput(error.message);
    $planSummary.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderMigrationProgress(job) {
  const stageNames = {
    preparing: "准备",
    reading_source: "读取来源历史",
    generating_summary: "生成摘要",
    archiving: "保存归档",
    writing_target: "写入目标",
    sending_target: "发送目标",
    done: "完成",
  };
  const elapsed = Math.max(0, Math.round((Date.now() - new Date(job.startedAt).getTime()) / 1000));
  $planSummary.innerHTML = `
    <div class="plan-headline">
      <span class="badge ${job.status === "running" ? "" : job.status === "success" ? "success" : "error"}">
        ${escapeHtml(job.status === "running" ? "迁移进行中" : job.status === "success" ? "迁移完成" : "迁移失败")}
      </span>
      <strong>${escapeHtml(job.source)} → ${escapeHtml(job.target)}</strong>
    </div>
    <p class="plan-reason">${escapeHtml(job.message || "")}</p>
    <div class="metric-grid">
      <div><span>阶段</span><strong>${escapeHtml(stageNames[job.stage] || job.stage || "")}</strong></div>
      <div><span>已运行</span><strong>${elapsed} 秒</strong></div>
      <div><span>来源消息</span><strong>${job.historyStats ? escapeHtml(job.historyStats.messageCount.toLocaleString()) : "读取中"}</strong></div>
      <div><span>建议</span><strong>请勿关闭页面</strong></div>
    </div>
    ${job.status === "error" ? `
      <div class="failure-actions">
        <button data-recovery="retry">重试当前路线</button>
        ${latestPlan?.routes?.some((route) => route.mode === "summary") && job.mode !== "summary" ? `<button data-recovery="summary">改用压缩摘要</button>` : ""}
        <button data-recovery="archive">导出 Level 0 交接归档</button>
        <button data-recovery="cancel" class="ghost">关闭提示</button>
      </div>
      <p class="note">失败不会自动降级。请选择下一步。</p>
    ` : ""}
  `;
}

$planSummary.addEventListener("click", (event) => {
  const action = event.target.closest("[data-recovery]")?.dataset.recovery;
  if (!action) return;
  if (action === "retry") {
    executeMigration();
  } else if (action === "summary") {
    if (latestPlan?.routes?.some((route) => route.mode === "summary")) {
      $mode.value = "1:summary";
      updateExecuteButton();
      executeMigration();
    }
  } else if (action === "archive") {
    startArchiveExport();
  } else if (action === "cancel") {
    $planSummary.innerHTML = `<div class="error-state">迁移失败。你可以在“技术详情”查看错误，或稍后重试。</div>`;
  }
});

function pollMigrationStatus() {
  if (migrationPollTimer) clearTimeout(migrationPollTimer);

  const tick = async () => {
    let job;
    try {
      job = await getJson("/api/import/status");
      renderMigrationProgress(job);

      if (job.status === "running") {
        migrationPollTimer = setTimeout(tick, 1000);
        return;
      }

      setOutput(JSON.stringify(job, null, 2));
      if (job.status === "success" && job.result) {
        renderImportSummary(job.result);
        loadArtifacts();
      }
    } catch (error) {
      setOutput(`迁移状态查询失败：${error.message}`);
      $planSummary.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
    } finally {
      if (job?.status !== "running") {
        $executeButton.disabled = false;
      }
    }
  };

  tick();
}

function updateExecuteButton() {
  if (!latestPlan) return;
  const [levelText, mode] = $mode.value.split(":");
  const level = Number(levelText);
  const route = latestPlan.routes.find((item) => item.level === level && item.mode === mode);
    const canExecute = Boolean(route && ["experimental", "available"].includes(route.status) &&
      ["native", "transcript", "summary", "archive-active-window"].includes(mode));
  $executeButton.hidden = !canExecute;
  $executeButton.disabled = !canExecute;
  const isSummaryMode = mode === "summary" || mode === "archive-active-window";
  if ($summaryEngineSection) {
    $summaryEngineSection.hidden = !isSummaryMode || !canExecute;
  }
}

async function executeMigration() {
  if (!$source.value || !$target.value || !$session.value) return;
  const mode = $mode.value.split(":")[1];
  if (!["native", "transcript", "summary", "archive-active-window"].includes(mode)) {
    setOutput("当前路线尚未支持真实写入。");
    return;
  }

  if (latestPlan?.sourceKind === "web" && ["codex", "claude-code"].includes($target.value) && !$targetCwd.value.trim()) {
    const message = "网页 AI 来源迁移到 Codex / Claude Code 时，目标工作目录必填。例如 E:\\Desktop。";
    setOutput(message);
    $planSummary.innerHTML = `<div class="error-state">${escapeHtml(message)}</div>`;
    return;
  }

  const confirmed = mode === "summary"
    ? window.confirm("即将向目标网页 AI 的新对话发送压缩摘要。\n\n这会消耗目标模型的正常对话额度。\n\n继续执行吗？")
    : window.confirm(
      `即将写入目标 AI 的本地原生会话目录。${$target.value === "codex" && $updateIndex.checked ? "\n同时会更新 Codex SQLite 索引并自动备份。" : ""}\n\n` +
      "请确认目标工作目录正确，并且你了解这是实验性写入。\n\n继续执行吗？"
    );
  if (!confirmed) return;

  $executeButton.disabled = true;
  setOutput("迁移已启动…");
  $planSummary.innerHTML = `<div class="empty-state">正在启动迁移…</div>`;

  try {
    const data = await postJson("/api/import/start", {
      source: $source.value,
      target: $target.value,
      path: $session.value,
      cwd: $targetCwd.value.trim() || undefined,
      mode,
      updateIndex: $updateIndex.checked,
      execute: true,
      summaryMode: $summaryEngine?.value === "api" ? "api" : "offline",
      apiConfig: readApiConfig(),
    });
    if (!data.started) throw new Error(data.error || "无法启动迁移");
    renderMigrationProgress(data.job);
    pollMigrationStatus();
  } catch (error) {
    setOutput(error.message);
    $planSummary.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  } finally {
    $executeButton.disabled = false;
  }
}

async function startArchiveExport() {
  if (!$source.value || !$session.value) return;
  $executeButton.disabled = true;
  $planSummary.innerHTML = `<div class="empty-state">正在启动 Level 0 交接归档…</div>`;

  try {
    const data = await postJson("/api/archive/start", {
      source: $source.value,
      path: $session.value,
    });
    if (!data.started) throw new Error(data.error || "无法启动归档");
    renderMigrationProgress(data.job);
    pollMigrationStatus();
  } catch (error) {
    setOutput(error.message);
    $planSummary.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  } finally {
    $executeButton.disabled = false;
  }
}

async function loadArtifacts() {
  try {
    const data = await getJson("/api/artifacts");
    const renderItem = (item) => `
      <li>
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(new Date(item.updatedAt).toLocaleString())} · ${(item.sizeBytes / 1024).toFixed(1)} KB</span>
        </div>
        <button data-view="${item.type}" data-name="${escapeHtml(item.name)}">查看</button>
      </li>
    `;
    $reportList.innerHTML = data.reports.length
      ? data.reports.map(renderItem).join("")
      : "<li>暂无报告</li>";
    $archiveList.innerHTML = data.archives.length
      ? data.archives.map(renderItem).join("")
      : "<li>暂无归档</li>";
  } catch (error) {
    $reportList.innerHTML = `<li>${escapeHtml(error.message)}</li>`;
    $archiveList.innerHTML = `<li>${escapeHtml(error.message)}</li>`;
  }
}

async function viewArtifact(type, name) {
  try {
    const data = await getJson(`/api/artifacts/file?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`);
    $artifactViewer.hidden = false;
    $artifactViewer.textContent = data.content;
    $artifactViewer.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    $artifactViewer.hidden = false;
    $artifactViewer.textContent = error.message;
  }
}

{
  loadSources();
}

$source.addEventListener("change", loadSessions);
$session.addEventListener("change", () => {
  if ($session.value === "__login__") {
    bindSource();
    return;
  }
  loadPlan();
});
$target.addEventListener("change", loadPlan);
$target.addEventListener("change", updateTargetConfig);
$mode.addEventListener("change", () => {
  userSelectedMode = $mode.value;
  updateExecuteButton();
});
$summaryEngine.addEventListener("change", () => {
  saveSummaryEngine();
  if (latestPlan) renderPlanSummary(latestPlan);
});
$planButton.addEventListener("click", loadPlan);
$bindButton.addEventListener("click", bindSource);
$executeButton.addEventListener("click", executeMigration);
$compressionApiButton.addEventListener("click", openApiModal);
$apiCloseButton.addEventListener("click", closeApiModal);
$apiSaveButton.addEventListener("click", saveApiConfig);
$apiClearButton.addEventListener("click", clearApiConfig);
$apiModal.addEventListener("click", (event) => {
  if (event.target === $apiModal) closeApiModal();
});
$refreshArtifactsButton.addEventListener("click", loadArtifacts);
$planSummary.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) viewArtifact(viewButton.dataset.view, viewButton.dataset.name);
});
loadApiConfigToForm();
loadSummaryEngine();
loadArtifacts();
