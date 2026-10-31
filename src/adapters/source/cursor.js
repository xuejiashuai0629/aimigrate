import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createHistory } from "../../core/history.js";

const require_ = createRequire(import.meta.url);

const STATE_DB = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Cursor", "User", "globalStorage", "state.vscdb");

function getDb() {
  if (!fs.existsSync(STATE_DB)) return null;
  try {
    const sqlite = require_("node:sqlite");
    if (!sqlite?.DatabaseSync) return null;
    return new sqlite.DatabaseSync(STATE_DB, { readOnly: true });
  } catch {
    return null;
  }
}

async function list() {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = db.prepare(`
      select composerId, value, createdAt, lastUpdatedAt, isArchived
      from composerHeaders
      order by lastUpdatedAt desc
    `).all();
    const out = [];
    for (const row of rows) {
      if (row.isArchived) continue;
      let name = "(无标题)";
      try {
        const val = JSON.parse(row.value);
        if (val.name) name = val.name;
      } catch {}
      out.push({
        id: row.composerId,
        path: `cursor:${row.composerId}`,
        title: name.slice(0, 120),
        updatedAt: row.lastUpdatedAt ? new Date(row.lastUpdatedAt).toISOString() : null,
        sizeBytes: null,
      });
    }
    return out;
  } finally {
    db.close();
  }
}

function extractText(text) {
  if (typeof text !== "string") return "";
  // Strip Cursor-specific context tags
  return text
    .replace(/<[\w-]+>[\s\S]*?<\/[\w-]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function read(ref) {
  const composerId = ref.startsWith("cursor:") ? ref.slice(7) : ref;
  const db = getDb();
  if (!db) throw new Error("无法打开 Cursor 数据库。请确认 Cursor 已安装。");
  try {
    const header = db.prepare("select value, createdAt, lastUpdatedAt from composerHeaders where composerId = ?").get(composerId);
    if (!header) throw new Error(`Cursor 会话不存在：${composerId}`);
    const headerVal = JSON.parse(header.value);

    const cd = db.prepare("select value from cursorDiskKV where key = ?").get(`composerData:${composerId}`);
    if (!cd) throw new Error(`Cursor 会话数据不存在：${composerId}`);
    const data = JSON.parse(cd.value);

    const bubbles = data.fullConversationHeadersOnly || [];
    const messages = [];
    for (const bubbleRef of bubbles) {
      const bubbleId = bubbleRef.bubbleId;
      if (!bubbleId) continue;
      const row = db.prepare("select value from cursorDiskKV where key = ?").get(`bubbleId:${composerId}:${bubbleId}`);
      if (!row) continue;
      try {
        const bubble = JSON.parse(row.value);
        const text = extractText(bubble.text || "");
        if (!text) continue;
        messages.push({
          id: bubbleId,
          role: bubble.type === 1 ? "user" : "assistant",
          timestamp: bubble.createdAt ? new Date(bubble.createdAt).toISOString() : null,
          channel: "main",
          blocks: [{ type: "text", text }],
        });
      } catch {}
    }

    return createHistory({
      sourceApp: "cursor",
      sourceKind: "agent",
      sourceSessionId: composerId,
      sourcePath: `cursor:${composerId}`,
      title: headerVal.name || "(无标题)",
      rawFormat: "cursor-composer",
      environment: { cwd: null },
      messages,
    });
  } finally {
    db.close();
  }
}

export const cursorSource = {
  name: "cursor",
  displayName: "Cursor",
  kind: "agent",
  detectStatus() {
    const installed = fs.existsSync(STATE_DB);
    return {
      kind: "agent",
      installed,
      detail: installed
        ? "Cursor 已安装，可以读取 AI 对话历史。"
        : "未检测到 Cursor。请先下载安装 Cursor 并进行至少一次 AI 对话。",
    };
  },
  list,
  read,
};
