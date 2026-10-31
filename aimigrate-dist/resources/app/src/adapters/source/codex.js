import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { createRequire } from "node:module";
import { createHistory } from "../../core/history.js";

const SESSIONS_DIR = path.join(os.homedir(), ".codex", "sessions");
const STATE_DB_PATH = path.join(os.homedir(), ".codex", "state_5.sqlite");
const require_ = createRequire(import.meta.url);

function loadSqliteTitles() {
  const map = new Map();
  const archivedIds = new Set();
  try {
    const sqlite = require_("node:sqlite");
    if (!sqlite?.DatabaseSync) return { map, archivedIds };
    const db = new sqlite.DatabaseSync(STATE_DB_PATH, { readOnly: true });
    // Match by session UUID (threads.id) rather than rollout_path because
    // imported sessions may have rollout_path pointing to a different drive.
    const rows = db.prepare("select id, name, archived from threads").all();
    for (const row of rows) {
      const key = String(row.id || "").trim().toLowerCase();
      if (row.archived) { archivedIds.add(key); continue; }
      const name = String(row.name || "").trim().slice(0, 80);
      if (name) map.set(key, name);
    }
    db.close();
  } catch {
    // SQLite 不可用时静默降级到 JSONL 解析
  }
  return { map, archivedIds };
}

function walkJsonl(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
    }
  }
  return out;
}

async function readJsonl(filePath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  const events = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // 单行坏数据不应毁掉整个会话读取。
    }
  }
  return events;
}

function codexContentBlocks(content) {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const blocks = [];
  for (const item of content) {
    if (!item) continue;
    if (item.type === "input_text" || item.type === "output_text") {
      if (item.text) blocks.push({ type: "text", text: item.text });
    } else if (item.type === "input_image" || item.type === "image") {
      blocks.push({ type: "attachment", mediaType: "image", ref: item });
    } else if (item.text || item.content) {
      const text = typeof item.content === "string" ? item.content : item.text;
      if (text) blocks.push({ type: "text", text });
    }
  }
  return blocks;
}

function normalizePayload(payload) {
  if (!payload) return null;

  if (payload.type === "message") {
    const blocks = codexContentBlocks(payload.content);
    if (!blocks.length) return null;
    return {
      role: payload.role || "user",
      blocks,
    };
  }

  if (payload.type === "function_call" || payload.type === "custom_tool_call" || payload.type === "local_shell_call") {
    return {
      role: "tool",
      blocks: [{
        type: "tool_call",
        toolCallId: payload.call_id || payload.id,
        name: payload.name || payload.action?.type || payload.type,
        arguments: payload.arguments ?? payload.action ?? payload.input,
      }],
    };
  }

  if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
    return {
      role: "tool",
      blocks: [{
        type: "tool_result",
        toolCallId: payload.call_id || payload.id,
        content: payload.output,
        isError: Boolean(payload.error),
      }],
    };
  }

  if (payload.type === "reasoning") {
    const text = Array.isArray(payload.summary)
      ? payload.summary.map((x) => x?.text || "").join("\n").trim()
      : typeof payload.summary === "string" ? payload.summary : "";
    if (!text) return null;
    return {
      role: "assistant",
      blocks: [{ type: "reasoning", text }],
    };
  }

  return null;
}

async function previewTitle(filePath) {
  const events = await readJsonl(filePath);
  for (const event of events) {
    if (event.type !== "response_item") continue;
    const payload = event.payload;
    if (payload?.type !== "message" || payload.role !== "user") continue;
    const text = codexContentBlocks(payload.content)
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .filter(isDisplayText)
      .join("\n")
      .trim();
    if (text) return text.slice(0, 80).replace(/\s+/g, " ");
  }
  return "(无标题)";
}

function isDisplayText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  const harnessMarkers = [
    "<app-context>",
    "<environment_context>",
    "<recommended_plugins>",
    "<system_reminder>",
    "<permissions instructions>",
    "<collaboration_mode>",
    "<apps_instructions>",
    "<skills_instructions>",
    "# AGENTS.md instructions",
    "# 全局约束（对所有任务生效）",
    "The following is the Codex agent history",
    "<aimigrate-summary-handoff>",
    "<aimigrate-active-window>",
    "# Files mentioned by the user:",
    "[aimigrate attachment]",
    "<image name=",
    "</image>",
    "TRANSCRIPT",
    "Some conversation entries were omitted",
    "The Codex agent has requested",
    "Assess the exact planned action",
    "Planned action JSON",
    "APPROVAL REQUEST",
    "Retry reason:",
    "retry without sandbox",
    ">>> APPROVAL REQUEST",
    "Reviewed Codex session id:",
    "Distinguish instructions in attached documents",
  ];
  if (harnessMarkers.some((marker) => trimmed.includes(marker))) return false;
  // Transcript dumps from Codex review sessions have "[N] user:" / "[N] tool" patterns.
  if (/\[\d+\]\s+(user|tool|assistant)\b/.test(trimmed)) return false;
  // JSON tool call dumps start with { "key": ...
  if (/^\{\s*"/.test(trimmed)) return false;
  // Tool result output starts with structured markers.
  if (/^(Chunk ID:|Exit code:|Wall time:|Process exited)/.test(trimmed)) return false;
  return true;
}

async function list() {
  const files = walkJsonl(SESSIONS_DIR);
  const { map: sqliteTitles, archivedIds } = loadSqliteTitles();
  const out = [];
  for (const filePath of files) {
    const stat = fs.statSync(filePath);
    const basename = path.basename(filePath, ".jsonl");
    const idMatch = basename.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);
    const key = idMatch ? idMatch[1].toLowerCase() : basename;
    if (archivedIds.has(key)) continue;
    const sqliteTitle = sqliteTitles.get(key) || "";
    const title = sqliteTitle || await previewTitle(filePath);
    out.push({
      id: path.basename(filePath, ".jsonl"),
      path: filePath,
      title,
      updatedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    });
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

async function read(filePath) {
  const events = await readJsonl(filePath);
  const messages = [];
  const sourceExtra = {};
  let title = "(无标题)";
  let messageSeq = 0;

  for (const event of events) {
    if (event.type === "session_meta") {
      const payload = event.payload || {};
      sourceExtra.sessionId = payload.session_id || payload.id || path.basename(filePath, ".jsonl");
      sourceExtra.cwd = payload.cwd;
      sourceExtra.originator = payload.originator;
      sourceExtra.cliVersion = payload.cli_version;
      sourceExtra.modelProvider = payload.model_provider;
      sourceExtra.model = payload.base_instructions?.provenance?.model;
      sourceExtra.contextWindowId = payload.context_window?.window_id;
      continue;
    }

    if (event.type !== "response_item") continue;
    const normalized = normalizePayload(event.payload);
    if (!normalized) continue;

    if (!title || title === "(无标题)") {
      if (normalized.role === "user") {
        const text = normalized.blocks
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .filter(isDisplayText)
          .join("\n")
          .trim();
        if (text) title = text.slice(0, 80).replace(/\s+/g, " ");
      }
    }

    messages.push({
      id: event.payload?.id || `codex-${++messageSeq}`,
      role: normalized.role,
      timestamp: event.timestamp,
      channel: "main",
      blocks: normalized.blocks,
    });
  }

  sourceExtra.sessionId ||= path.basename(filePath, ".jsonl");
  return createHistory({
    sourceApp: "codex",
    sourceKind: "agent",
    sourceSessionId: sourceExtra.sessionId,
    sourcePath: filePath,
    title,
    rawFormat: "codex-jsonl",
    sourceExtra,
    environment: {
      cwd: sourceExtra.cwd,
      originator: sourceExtra.originator,
      cliVersion: sourceExtra.cliVersion,
      modelProvider: sourceExtra.modelProvider,
      model: sourceExtra.model,
      contextWindowId: sourceExtra.contextWindowId,
    },
    rawEvents: events,
    messages,
  });
}

export const codexSource = {
  name: "codex",
  displayName: "Codex",
  kind: "agent",
  root: SESSIONS_DIR,
  detectStatus() {
    return {
      kind: "agent",
      installed: fs.existsSync(SESSIONS_DIR),
      root: SESSIONS_DIR,
      detail: fs.existsSync(SESSIONS_DIR) ? "Codex 已安装，会话目录已找到。" : "未检测到 Codex。请先下载安装 Codex 并至少进行一次对话，历史记录会自动生成。",
    };
  },
  list,
  read,
};
