const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("node:url");

let win;

// Business logic modules (loaded via dynamic import since they are ESM)
const M = {};

// Detect packaged vs dev environment:
// - Packaged: __dirname = resources/app/, src/ is here too
// - Dev: __dirname = electron/, src/ is in project root
const ROOT = fs.existsSync(path.join(__dirname, "src"))
  ? __dirname
  : path.resolve(__dirname, "..");

async function loadModules() {
  const root = ROOT;
  const url = (rel) => pathToFileURL(path.join(root, rel)).href;
  const srcIdx = await import(url("src/adapters/source/index.js"));
  M.sourceAdapters = srcIdx.sourceAdapters;
  M.getSourceAdapter = srcIdx.getSourceAdapter;
  const tgtIdx = await import(url("src/adapters/target/index.js"));
  M.targetAdapters = tgtIdx.targetAdapters;
  M.getTargetAdapter = tgtIdx.getTargetAdapter;
  const planner = await import(url("src/core/route-planner.js"));
  M.planRoutes = planner.planRoutes;
  const extractive = await import(url("src/core/summary/extractive.js"));
  M.createOfflineSummary = extractive.createOfflineSummary;
  const abstractive = await import(url("src/core/summary/abstractive.js"));
  M.createAbstractiveSummary = abstractive.createAbstractiveSummary;
  const report = await import(url("src/core/report.js"));
  M.createMigrationReport = report.createMigrationReport;
  M.saveMigrationReport = report.saveMigrationReport;
  const activeWin = await import(url("src/core/active-window.js"));
  M.createActiveWindowHistory = activeWin.createActiveWindowHistory;
  M.createSummaryOnlyHistory = activeWin.createSummaryOnlyHistory;
  const archive = await import(url("src/core/archive.js"));
  M.saveHandoffArchive = archive.saveHandoffArchive;
}

// ── State (same as server.js) ──
let loginJob = null;
let migrationJob = null;
const artifactDir = path.join(ROOT, ".aimigrate");

// ── Helpers ──
function listArtifactFiles(dir, type) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && (e.name.endsWith(".json") || e.name.endsWith(".md")))
    .map((e) => {
      const fp = path.join(dir, e.name);
      const stat = fs.statSync(fp);
      let s = {};
      if (e.name.endsWith(".json")) { try { s = JSON.parse(fs.readFileSync(fp, "utf8")); } catch {} }
      return { type, name: e.name, path: fp, sizeBytes: stat.size, updatedAt: stat.mtime.toISOString(), title: s.title || s.sourceApp || e.name, sourceApp: s.sourceApp, targetApp: s.targetApp, migrationLevel: s.migrationLevel, mode: s.mode, success: s.success };
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function readArtifactFile(type, name) {
  const safeName = path.basename(name);
  if (!/^[\w.\-]+\.(json|md)$/i.test(safeName)) throw new Error("非法文件名");
  const dir = type === "report" ? path.join(artifactDir, "reports") : path.join(artifactDir, "exports");
  const fp = path.join(dir, safeName);
  if (!fp.startsWith(dir) || !fs.existsSync(fp)) throw new Error("文件不存在");
  return { type, name: safeName, path: fp, content: fs.readFileSync(fp, "utf8") };
}

// ── IPC Handlers ──
function registerIpcHandlers() {
  ipcMain.handle("sources", () => ({
    sources: [...M.sourceAdapters.values()].map((a) => ({
      name: a.name, displayName: a.displayName, kind: a.kind, role: "source",
      status: ["deepseek", "doubao"].includes(a.name) ? "read-only/experimental" : "read-only",
      supportsLogin: Boolean(a.login),
    })),
  }));

  ipcMain.handle("targets", () =>
    [...M.targetAdapters.values()].map((a) => ({
      name: a.name, displayName: a.displayName, kind: a.kind,
      write: a.write, status: a.detectStatus?.() || null,
    }))
  );

  ipcMain.handle("sessions", async (_e, source) => {
    const adapter = M.getSourceAdapter(source);
    return await adapter.list();
  });

  ipcMain.handle("source-status", (_e, source) => {
    const adapter = M.getSourceAdapter(source);
    return adapter.detectStatus?.() || { kind: adapter.kind, installed: true, detail: "适配器未提供状态检测。" };
  });

  ipcMain.handle("login-start", (_e, body) => {
    const adapter = M.getSourceAdapter(body.source);
    if (typeof adapter.login !== "function") return { error: "该来源不需要网页账号绑定。" };
    if (loginJob?.status === "running") return { ok: true, started: true, job: loginJob };
    loginJob = { source: body.source, status: "running", message: "正在打开浏览器绑定窗口。", startedAt: new Date().toISOString() };
    adapter.login()
      .then((r) => { loginJob = r?.ok ? { source: body.source, status: "success", message: r.message || "绑定完成。", finishedAt: new Date().toISOString() } : { source: body.source, status: "error", message: r?.message || "绑定失败。", code: r?.code, finishedAt: new Date().toISOString() }; })
      .catch((err) => { loginJob = { source: body.source, status: "error", message: err?.message || String(err), code: err?.code, finishedAt: new Date().toISOString() }; });
    return { ok: true, started: true, job: loginJob };
  });

  ipcMain.handle("login-status", () => loginJob || { status: "idle", message: "没有进行中的绑定。" });

  ipcMain.handle("history", async (_e, args) => {
    const adapter = M.getSourceAdapter(args.source);
    return await adapter.read(args.path);
  });

  ipcMain.handle("plan", async (_e, body) => {
    const adapter = M.getSourceAdapter(body.source);
    const history = await adapter.read(body.path);
    const plan = M.planRoutes({ sourceApp: body.source, targetApp: body.target, history });
    return { ...plan, apiConfigReceived: Boolean(body.apiBaseUrl || body.apiKey), apiConfigStored: false };
  });

  ipcMain.handle("migration-start", (_e, body) => {
    if (migrationJob?.status === "running") return { ok: true, started: true, job: migrationJob };
    const sourceName = body.source;
    const targetName = body.target;
    const sourceAdapter = M.getSourceAdapter(sourceName);
    const targetAdapter = M.getTargetAdapter(targetName);
    const sourceDisplay = { codex: "Codex", "claude-code": "Claude Code", deepseek: "DeepSeek", doubao: "豆包", cursor: "Cursor", "doubao-work": "豆包工作版" }[sourceName] || sourceName;
    const targetDisplay = { codex: "Codex", "claude-code": "Claude Code", deepseek: "DeepSeek", doubao: "豆包", cursor: "Cursor", "doubao-work": "豆包工作版" }[targetName] || targetName;

    migrationJob = { kind: "migration", source: sourceName, target: targetName, path: body.path, mode: body.mode, status: "running", stage: "preparing", message: "正在准备迁移…", startedAt: new Date().toISOString(), finishedAt: null };

    (async () => {
      try {
        migrationJob.stage = "reading_source";
        migrationJob.message = `正在读取 ${sourceDisplay} 的完整历史。`;
        const history = await sourceAdapter.read(body.path);
        if (migrationJob.status !== "running") return;
        migrationJob.historyStats = history.stats;

        let result;
        if (body.mode === "summary" && typeof targetAdapter.importNative === "function") {
          migrationJob.stage = "generating_summary";
          migrationJob.message = `历史读取完成（${history.stats.messageCount} 条消息）。正在生成交接摘要…`;
          const summary = body.summaryMode === "api" ? await M.createAbstractiveSummary(history, body.apiConfig) : M.createOfflineSummary(history);
          if (migrationJob.status !== "running") return;
          migrationJob.stage = "archiving";
          migrationJob.message = "摘要生成完成。正在保存完整历史归档…";
          const archiveFiles = M.saveHandoffArchive(history, summary, body.archiveDir);
          if (migrationJob.status !== "running") return;
          migrationJob.stage = "writing_target";
          migrationJob.message = `完整历史已归档。正在写入 ${targetDisplay} 的纯摘要新会话…`;
          const summaryHistory = M.createSummaryOnlyHistory(history, summary, { archivePath: archiveFiles.fullPath });
          const options = { cwd: body.cwd, targetRoot: body.targetRoot, overwrite: Boolean(body.overwrite), updateIndex: Boolean(body.updateIndex) };
          result = body.execute ? targetAdapter.importNative(summaryHistory, options) : targetAdapter.dryRun(summaryHistory, options);
          result.summaryHandoff = { summaryTokens: summary.estimatedTokens, archiveFiles };
          result.archiveFiles = archiveFiles;
        } else if (body.mode === "archive-active-window" && typeof targetAdapter.importNative === "function") {
          migrationJob.stage = "generating_summary";
          migrationJob.message = `历史读取完成（${history.stats.messageCount} 条消息）。正在生成交接摘要…`;
          const summary = body.summaryMode === "api" ? await M.createAbstractiveSummary(history, body.apiConfig) : M.createOfflineSummary(history);
          if (migrationJob.status !== "running") return;
          migrationJob.stage = "archiving";
          migrationJob.message = "摘要生成完成。正在保存完整历史归档…";
          const archiveFiles = M.saveHandoffArchive(history, summary, body.archiveDir);
          if (migrationJob.status !== "running") return;
          migrationJob.stage = "writing_target";
          migrationJob.message = `完整历史已归档。正在写入 ${targetDisplay} 的摘要 + 最近窗口…`;
          const maxMessages = Number(body.activeWindowMessages || 50);
          const activeHistory = M.createActiveWindowHistory(history, summary, { maxMessages, archivePath: archiveFiles.fullPath });
          const options = { cwd: body.cwd, targetRoot: body.targetRoot, overwrite: Boolean(body.overwrite), updateIndex: Boolean(body.updateIndex) };
          result = targetAdapter.importNative(activeHistory, options);
          result.activeWindow = { messageCount: activeHistory.stats.messageCount, maxMessages, archiveFiles };
          result.archiveFiles = archiveFiles;
        } else if (typeof targetAdapter.sendSummary === "function") {
          migrationJob.stage = "generating_summary";
          migrationJob.message = `历史读取完成（${history.stats.messageCount} 条消息）。正在生成交接摘要…`;
          const summary = body.summaryMode === "api" ? await M.createAbstractiveSummary(history, body.apiConfig) : M.createOfflineSummary(history);
          if (migrationJob.status !== "running") return;
          migrationJob.stage = "sending_target";
          migrationJob.message = `摘要生成完成（约 ${summary.estimatedTokens || "unknown"} tokens）。正在发送到 ${targetDisplay} 新对话…`;
          result = await targetAdapter.sendSummary(history, summary, { execute: Boolean(body.execute) });
        } else {
          migrationJob.stage = "writing_target";
          migrationJob.message = `历史读取完成（${history.stats.messageCount} 条消息）。正在写入 ${targetDisplay}…`;
          const options = { cwd: body.cwd, targetRoot: body.targetRoot, overwrite: Boolean(body.overwrite), updateIndex: Boolean(body.updateIndex) };
          result = body.execute ? targetAdapter.importNative(history, options) : targetAdapter.dryRun(history, options);
        }

        if (result?.ok) {
          try {
            const isSummary = Boolean(result.summaryMode) || body.mode === "summary";
            const report = M.createMigrationReport({ history, result, migrationLevel: isSummary ? "L1" : body.mode === "archive-active-window" ? "L2 + Active Window" : result.imported ? "L3" : "L2", mode: isSummary ? "summary" : body.mode === "archive-active-window" ? "archive-active-window" : "transcript" });
            result.reportFiles = M.saveMigrationReport(report);
            result.report = report;
          } catch (reportError) { result.reportFiles = null; result.reportError = reportError.message; }
        }

        migrationJob = { ...migrationJob, status: "success", stage: "done", message: body.execute ? `迁移完成：${sourceDisplay} → ${targetDisplay}` : "试运行完成。", result, finishedAt: new Date().toISOString() };
      } catch (error) {
        migrationJob = { ...migrationJob, status: "error", stage: "done", message: error?.message || String(error), code: error?.code, finishedAt: new Date().toISOString() };
      }
    })();

    return { ok: true, started: true, job: migrationJob };
  });

  ipcMain.handle("migration-status", () => migrationJob || { status: "idle", message: "没有进行中的迁移。" });

  ipcMain.handle("archive-start", (_e, body) => {
    if (migrationJob?.status === "running") return { ok: true, started: true, job: migrationJob };
    const sourceAdapter = M.getSourceAdapter(body.source);
    migrationJob = { kind: "archive", source: body.source, path: body.path, mode: "handoff", status: "running", stage: "preparing", message: "正在准备 Level 0 交接归档…", startedAt: new Date().toISOString(), finishedAt: null };
    (async () => {
      try {
        migrationJob.stage = "reading_source";
        migrationJob.message = "正在读取完整历史用于归档。";
        const history = await sourceAdapter.read(body.path);
        migrationJob.historyStats = history.stats;
        migrationJob.stage = "generating_summary";
        migrationJob.message = "正在生成离线交接摘要…";
        const summary = M.createOfflineSummary(history);
        migrationJob.stage = "archiving";
        migrationJob.message = "正在保存完整历史与摘要…";
        const files = M.saveHandoffArchive(history, summary, body.archiveDir);
        migrationJob = { ...migrationJob, status: "success", stage: "done", message: "Level 0 交接归档完成。", result: { ok: true, targetApp: "archive", summaryMode: summary.mode, archiveFiles: files }, finishedAt: new Date().toISOString() };
      } catch (error) {
        migrationJob = { ...migrationJob, status: "error", stage: "done", message: error?.message || String(error), finishedAt: new Date().toISOString() };
      }
    })();
    return { ok: true, started: true, job: migrationJob };
  });

  ipcMain.handle("artifacts", () => ({
    reports: listArtifactFiles(path.join(artifactDir, "reports"), "report"),
    archives: listArtifactFiles(path.join(artifactDir, "exports"), "archive"),
  }));

  ipcMain.handle("artifact-file", (_e, args) => {
    if (!["report", "archive"].includes(args.type)) throw new Error("type 必须是 report 或 archive");
    return readArtifactFile(args.type, args.name);
  });
}

// ── Window ──
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860,
    minWidth: 900, minHeight: 600,
    title: "aimigrate",
    autoHideMenuBar: true,
    backgroundColor: "#0a0a0f",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.loadFile(path.join(ROOT, "public", "index.html"));
}

app.whenReady().then(async () => {
  try {
    await loadModules();
    registerIpcHandlers();
    createWindow();
  } catch (err) {
    console.error("Startup error:", err.stack || err.message);
    const errWin = new BrowserWindow({
      width: 700, height: 500,
      title: "aimigrate - 启动错误",
      autoHideMenuBar: true,
    });
    const html = `<!DOCTYPE html><html><body style="background:#0a0a0f;color:#fca5a5;font-family:monospace;padding:20px"><h2>启动错误</h2><pre>${JSON.stringify(err.stack || err.message)}</pre></body></html>`;
    errWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  }
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err.stack || err.message);
});

app.on("window-all-closed", () => { app.quit(); process.exit(0); });
