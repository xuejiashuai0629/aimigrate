import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { sourceAdapters, getSourceAdapter } from "../../src/adapters/source/index.js";
import { targetAdapters, getTargetAdapter } from "../../src/adapters/target/index.js";
import { planRoutes } from "../../src/core/route-planner.js";
import { createOfflineSummary } from "../../src/core/summary/extractive.js";
import { createAbstractiveSummary } from "../../src/core/summary/abstractive.js";
import { createMigrationReport, saveMigrationReport } from "../../src/core/report.js";
import { createActiveWindowHistory } from "../../src/core/active-window.js";
import { createSummaryOnlyHistory } from "../../src/core/active-window.js";
import { saveHandoffArchive } from "../../src/core/archive.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER_VERSION = "20261026.l1-summary";
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 8765);
let guiUrl = `http://127.0.0.1:${port}`;
let activePort = port;
const stateDir = process.env.AIMIGRATE_STATE_DIR || path.join(os.homedir(), ".aimigrate");
const pidFile = path.join(stateDir, "gui.pid");
const artifactDir = path.join(root, ".aimigrate");
let loginJob = null;
let migrationJob = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, milestone: "M0/M2" });
    return;
  }

  if (url.pathname === "/api/sources") {
    sendJson(res, 200, {
      serverVersion: SERVER_VERSION,
      sources: [...sourceAdapters.values()].map((adapter) => ({
        name: adapter.name,
        displayName: adapter.displayName,
        kind: adapter.kind,
        role: "source",
        status: ["deepseek", "doubao"].includes(adapter.name) ? "read-only/experimental" : "read-only",
        supportsLogin: Boolean(adapter.login),
      })),
    });
    return;
  }

  if (url.pathname === "/api/targets") {
    sendJson(res, 200, [...targetAdapters.values()].map((adapter) => ({
      name: adapter.name,
      displayName: adapter.displayName,
      kind: adapter.kind,
      write: adapter.write,
      status: adapter.detectStatus?.() || null,
    })));
    return;
  }

  if (url.pathname === "/api/sessions") {
    const source = url.searchParams.get("source");
    const adapter = getSourceAdapter(source);
    sendJson(res, 200, await adapter.list());
    return;
  }

  if (url.pathname === "/api/source-status") {
    const source = url.searchParams.get("source");
    const adapter = getSourceAdapter(source);
    sendJson(res, 200, adapter.detectStatus?.() || {
      kind: adapter.kind,
      installed: true,
      detail: "适配器未提供状态检测。",
    });
    return;
  }

  if (url.pathname === "/api/login/start" && req.method === "POST") {
    const body = await readBody(req);
    const adapter = getSourceAdapter(body.source);
    if (typeof adapter.login !== "function") {
      sendJson(res, 400, { error: "该来源不需要网页账号绑定。" });
      return;
    }

    if (loginJob?.status === "running") {
      sendJson(res, 200, { ok: true, started: true, job: loginJob });
      return;
    }

    loginJob = {
      source: body.source,
      status: "running",
      message: "正在打开浏览器绑定窗口。请在弹出的浏览器中登录。",
      startedAt: new Date().toISOString(),
    };

    adapter.login()
      .then((result) => {
        loginJob = result?.ok
          ? { source: body.source, status: "success", message: result.message || "绑定完成。", finishedAt: new Date().toISOString() }
          : { source: body.source, status: "error", message: result?.message || "绑定失败。", code: result?.code, finishedAt: new Date().toISOString() };
      })
      .catch((error) => {
        loginJob = {
          source: body.source,
          status: "error",
          message: error?.message || String(error),
          code: error?.code,
          finishedAt: new Date().toISOString(),
        };
      });

    sendJson(res, 200, { ok: true, started: true, job: loginJob });
    return;
  }

  if (url.pathname === "/api/login/status") {
    sendJson(res, 200, loginJob || { status: "idle", message: "没有进行中的绑定。" });
    return;
  }

  if (url.pathname === "/api/shutdown" && req.method === "POST") {
    sendJson(res, 200, { ok: true, message: "正在关闭旧 server。" });
    setTimeout(() => process.exit(0), 100);
    return;
  }

  if (url.pathname === "/api/history" && req.method === "GET") {
    const source = url.searchParams.get("source");
    const sessionPath = url.searchParams.get("path");
    const adapter = getSourceAdapter(source);
    const history = await adapter.read(sessionPath);
    sendJson(res, 200, history);
    return;
  }

  if (url.pathname === "/api/plan" && req.method === "POST") {
    const body = await readBody(req);
    const adapter = getSourceAdapter(body.source);
    const history = await adapter.read(body.path);
    const plan = planRoutes({
      sourceApp: body.source,
      targetApp: body.target,
      history,
    });
    sendJson(res, 200, {
      ...plan,
      apiConfigReceived: Boolean(body.apiBaseUrl || body.apiKey),
      apiConfigStored: false,
    });
    return;
  }

  if (url.pathname === "/api/import/start" && req.method === "POST") {
    const body = await readBody(req);
    if (migrationJob?.status === "running") {
      sendJson(res, 200, { ok: true, started: true, job: migrationJob });
      return;
    }

    const sourceName = body.source;
    const targetName = body.target;
    const sourceAdapter = getSourceAdapter(sourceName);
    const targetAdapter = getTargetAdapter(targetName);
    const sourceDisplay = { codex: "Codex", "claude-code": "Claude Code", deepseek: "DeepSeek", doubao: "豆包" }[sourceName] || sourceName;
    const targetDisplay = { codex: "Codex", "claude-code": "Claude Code", deepseek: "DeepSeek", doubao: "豆包" }[targetName] || targetName;
    migrationJob = {
      kind: "migration",
      source: sourceName,
      target: targetName,
      path: body.path,
      mode: body.mode,
      status: "running",
      stage: "preparing",
      message: "正在准备迁移…",
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };

    (async () => {
      try {
        migrationJob.stage = "reading_source";
        migrationJob.message = `正在读取 ${sourceDisplay} 的完整历史。网页来源可能需要几十秒，请勿关闭页面。`;

        const history = await sourceAdapter.read(body.path);
        if (migrationJob.status !== "running") return;
        migrationJob.historyStats = history.stats;

        let result;
        if (body.mode === "summary" && typeof targetAdapter.importNative === "function") {
          // L1 Summary Handoff to a local agent target.
          // Generate summary, archive full history, then write a new session containing ONLY the summary message.
          migrationJob.stage = "generating_summary";
          migrationJob.message = `历史读取完成（${history.stats.messageCount} 条消息）。正在生成交接摘要…`;
          const summary = body.summaryMode === "api"
            ? await createAbstractiveSummary(history, body.apiConfig)
            : createOfflineSummary(history);

          if (migrationJob.status !== "running") return;
          migrationJob.stage = "archiving";
          migrationJob.message = "摘要生成完成。正在保存完整历史归档…";
          const archiveFiles = saveHandoffArchive(history, summary, body.archiveDir);

          if (migrationJob.status !== "running") return;
          migrationJob.stage = "writing_target";
          migrationJob.message = `完整历史已归档。正在写入 ${targetDisplay} 的纯摘要新会话…`;
          const summaryHistory = createSummaryOnlyHistory(history, summary, {
            archivePath: archiveFiles.fullPath,
          });
          const options = {
            cwd: body.cwd,
            targetRoot: body.targetRoot,
            overwrite: Boolean(body.overwrite),
            updateIndex: Boolean(body.updateIndex),
          };
          result = body.execute
            ? targetAdapter.importNative(summaryHistory, options)
            : targetAdapter.dryRun(summaryHistory, options);
          result.summaryHandoff = {
            summaryTokens: summary.estimatedTokens,
            archiveFiles,
          };
          result.archiveFiles = archiveFiles;
        } else if (body.mode === "archive-active-window" && typeof targetAdapter.importNative === "function") {
          migrationJob.stage = "generating_summary";
          migrationJob.message = `历史读取完成（${history.stats.messageCount} 条消息）。正在生成交接摘要…`;
          const summary = body.summaryMode === "api"
            ? await createAbstractiveSummary(history, body.apiConfig)
            : createOfflineSummary(history);

          if (migrationJob.status !== "running") return;
          migrationJob.stage = "archiving";
          migrationJob.message = "摘要生成完成。正在保存完整历史归档…";
          const archiveFiles = saveHandoffArchive(history, summary, body.archiveDir);

          if (migrationJob.status !== "running") return;
          migrationJob.stage = "writing_target";
          migrationJob.message = `完整历史已归档。正在写入 ${targetDisplay} 的摘要 + 最近窗口…`;
          const maxMessages = Number(body.activeWindowMessages || 50);
          const activeHistory = createActiveWindowHistory(history, summary, {
            maxMessages,
            archivePath: archiveFiles.fullPath,
          });
          const options = {
            cwd: body.cwd,
            targetRoot: body.targetRoot,
            overwrite: Boolean(body.overwrite),
            updateIndex: Boolean(body.updateIndex),
          };
          result = targetAdapter.importNative(activeHistory, options);
          result.activeWindow = {
            messageCount: activeHistory.stats.messageCount,
            maxMessages,
            archiveFiles,
          };
          result.archiveFiles = archiveFiles;
        } else if (typeof targetAdapter.sendSummary === "function") {
          migrationJob.stage = "generating_summary";
          migrationJob.message = `历史读取完成（${history.stats.messageCount} 条消息）。正在生成交接摘要…`;
          const summary = body.summaryMode === "api"
            ? await createAbstractiveSummary(history, body.apiConfig)
            : createOfflineSummary(history);

          if (migrationJob.status !== "running") return;
          migrationJob.stage = "sending_target";
          migrationJob.message = `摘要生成完成（约 ${summary.estimatedTokens || "unknown"} tokens）。正在发送到 ${targetDisplay} 新对话…`;
          result = await targetAdapter.sendSummary(history, summary, {
            execute: Boolean(body.execute),
          });
        } else {
          migrationJob.stage = "writing_target";
          migrationJob.message = `历史读取完成（${history.stats.messageCount} 条消息）。正在写入 ${targetDisplay}…`;
          const options = {
            cwd: body.cwd,
            targetRoot: body.targetRoot,
            overwrite: Boolean(body.overwrite),
            updateIndex: Boolean(body.updateIndex),
          };
          result = body.execute
            ? targetAdapter.importNative(history, options)
            : targetAdapter.dryRun(history, options);
        }

        if (result?.ok) {
          try {
            const isSummary = Boolean(result.summaryMode) || body.mode === "summary";
            const report = createMigrationReport({
              history,
              result,
              migrationLevel: isSummary
                ? "L1"
                : body.mode === "archive-active-window"
                  ? "L2 + Active Window"
                  : result.imported ? "L3" : "L2",
              mode: isSummary ? "summary" : body.mode === "archive-active-window" ? "archive-active-window" : "transcript",
            });
            result.reportFiles = saveMigrationReport(report);
            result.report = report;
          } catch (reportError) {
            result.reportFiles = null;
            result.reportError = reportError.message;
          }
        }

        migrationJob = {
          ...migrationJob,
          status: "success",
          stage: "done",
          message: body.execute
            ? `迁移完成：${sourceDisplay} → ${targetDisplay}`
            : "试运行完成。",
          result,
          finishedAt: new Date().toISOString(),
        };
      } catch (error) {
        migrationJob = {
          ...migrationJob,
          status: "error",
          stage: "done",
          message: error?.message || String(error),
          code: error?.code,
          finishedAt: new Date().toISOString(),
        };
      }
    })();

    sendJson(res, 200, { ok: true, started: true, job: migrationJob });
    return;
  }

  if (url.pathname === "/api/import/status") {
    sendJson(res, 200, migrationJob || { status: "idle", message: "没有进行中的迁移。" });
    return;
  }

  if (url.pathname === "/api/archive/start" && req.method === "POST") {
    const body = await readBody(req);
    if (migrationJob?.status === "running") {
      sendJson(res, 200, { ok: true, started: true, job: migrationJob });
      return;
    }

    const sourceAdapter = getSourceAdapter(body.source);
    migrationJob = {
      kind: "archive",
      source: body.source,
      path: body.path,
      mode: "handoff",
      status: "running",
      stage: "preparing",
      message: "正在准备 Level 0 交接归档…",
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };

    (async () => {
      try {
        migrationJob.stage = "reading_source";
        migrationJob.message = "正在读取完整历史用于归档。网页来源可能需要几十秒，请勿关闭页面。";
        const history = await sourceAdapter.read(body.path);
        migrationJob.historyStats = history.stats;

        migrationJob.stage = "generating_summary";
        migrationJob.message = "正在生成离线交接摘要…";
        const summary = createOfflineSummary(history);

        migrationJob.stage = "archiving";
        migrationJob.message = "正在保存完整历史与摘要…";
        const files = saveHandoffArchive(history, summary, body.archiveDir);

        migrationJob = {
          ...migrationJob,
          status: "success",
          stage: "done",
          message: "Level 0 交接归档完成。",
          result: {
            ok: true,
            targetApp: "archive",
            summaryMode: summary.mode,
            archiveFiles: files,
          },
          finishedAt: new Date().toISOString(),
        };
      } catch (error) {
        migrationJob = {
          ...migrationJob,
          status: "error",
          stage: "done",
          message: error?.message || String(error),
          finishedAt: new Date().toISOString(),
        };
      }
    })();

    sendJson(res, 200, { ok: true, started: true, job: migrationJob });
    return;
  }

  if (url.pathname === "/api/artifacts") {
    sendJson(res, 200, {
      reports: listArtifactFiles(path.join(artifactDir, "reports"), "report"),
      archives: listArtifactFiles(path.join(artifactDir, "exports"), "archive"),
    });
    return;
  }

  if (url.pathname === "/api/artifacts/file") {
    const type = url.searchParams.get("type");
    const name = url.searchParams.get("name");
    if (!["report", "archive"].includes(type)) {
      sendJson(res, 400, { error: "type 必须是 report 或 archive" });
      return;
    }
    sendJson(res, 200, readArtifactFile(type, name));
    return;
  }

  sendJson(res, 404, { error: "API not found" });
}

function serveStatic(res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.join(publicDir, relative);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  });
}

function listArtifactFiles(dir, type) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".md")))
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      const stat = fs.statSync(filePath);
      let summary = {};
      if (entry.name.endsWith(".json")) {
        try {
          summary = JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch {
          summary = {};
        }
      }
      return {
        type,
        name: entry.name,
        path: filePath,
        sizeBytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
        title: summary.title || summary.sourceApp || entry.name,
        sourceApp: summary.sourceApp,
        targetApp: summary.targetApp,
        migrationLevel: summary.migrationLevel,
        mode: summary.mode,
        success: summary.success,
      };
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function readArtifactFile(type, name) {
  const safeName = path.basename(name);
  if (!/^[\w.\-]+\.(json|md)$/i.test(safeName)) {
    throw new Error("非法文件名");
  }
  const dir = type === "report"
    ? path.join(artifactDir, "reports")
    : path.join(artifactDir, "exports");
  const filePath = path.join(dir, safeName);
  if (!filePath.startsWith(dir) || !fs.existsSync(filePath)) {
    throw new Error("文件不存在");
  }
  return {
    type,
    name: safeName,
    path: filePath,
    content: fs.readFileSync(filePath, "utf8"),
  };
}

function openBrowser() {
  const command = process.platform === "win32" ? "rundll32" : "xdg-open";
  const args = process.platform === "win32"
    ? ["url.dll,FileProtocolHandler", guiUrl]
    : [guiUrl];
  try {
    spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {
    // 用户仍可手动打开地址。
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 400, {
      error: error?.message || String(error),
      code: error?.code,
    });
  }
});

function startServer(listenPort) {
  activePort = listenPort;
  guiUrl = `http://127.0.0.1:${listenPort}`;
  server.listen(listenPort, "127.0.0.1", () => {
  if (process.env.AIMIGRATE_OPEN_BROWSER === "1") {
    openBrowser();
  }
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, String(process.pid), "utf8");
  console.log(`aimigrate GUI: ${guiUrl}`);
});
}

if (process.env.AIMIGRATE_ELECTRON !== "1") {
  startServer(port);
}

process.on("exit", () => {
  try {
    if (fs.existsSync(pidFile) && Number(fs.readFileSync(pidFile, "utf8")) === process.pid) {
      fs.rmSync(pidFile, { force: true });
    }
  } catch {
    // 忽略退出清理失败。
  }
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    if (activePort < 8790) {
      startServer(activePort + 1);
      return;
    }
  }
  console.error(error);
  process.exit(1);
});
