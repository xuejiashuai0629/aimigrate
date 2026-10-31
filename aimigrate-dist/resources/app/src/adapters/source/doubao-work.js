import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { createHistory } from "../../core/history.js";

const SESSIONS_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
  "DoubaoWork", "User Data", "Default", ".doubaowork",
  "agent_mode", "workspace", ".sessions"
);

function walkSessionDirs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sessionId = entry.name;
    // Find trajectory.jsonl inside agents/*/system/
    const agentsDir = path.join(dir, sessionId, "agents");
    if (!fs.existsSync(agentsDir)) continue;
    for (const agent of fs.readdirSync(agentsDir, { withFileTypes: true })) {
      if (!agent.isDirectory()) continue;
      const trajPath = path.join(agentsDir, agent.name, "system", "trajectory.jsonl");
      if (fs.existsSync(trajPath)) {
        out.push({ sessionId, agentId: agent.name, trajPath });
      }
    }
  }
  return out;
}

function extractTitle(trajPath) {
  try {
    const content = fs.readFileSync(trajPath, "utf8");
    const lines = content.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.role === "user" && event.content) {
          return event.content.trim().slice(0, 80).replace(/\s+/g, " ");
        }
      } catch {}
    }
  } catch {}
  return "(无标题)";
}

async function list() {
  const sessions = walkSessionDirs(SESSIONS_DIR);
  const out = [];
  for (const session of sessions) {
    const stat = fs.statSync(session.trajPath);
    out.push({
      id: `doubao-work:${session.sessionId}`,
      path: session.trajPath,
      title: extractTitle(session.trajPath),
      updatedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    });
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function parseContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === "string" ? c : c.text || "")).filter(Boolean).join("\n");
  }
  return String(content || "");
}

async function read(ref) {
  const trajPath = ref.startsWith("doubao-work:") ? null : ref;
  if (!trajPath || !fs.existsSync(trajPath)) {
    throw new Error(`豆包工作版会话文件不存在：${ref}`);
  }

  const messages = [];
  const fileStream = fs.createReadStream(trajPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let idx = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const text = parseContent(event.content).trim();
      if (!text) continue;
      // Skip tool results and very long tool docs
      if (event.role === "tool") continue;
      // For assistant messages with tool_calls, extract just the text content
      if (event.role === "assistant" && event.tool_calls) continue;
      messages.push({
        id: `msg-${idx++}`,
        role: event.role === "user" ? "user" : "assistant",
        timestamp: null,
        channel: "main",
        blocks: [{ type: "text", text }],
      });
    } catch {}
  }

  const title = messages.find((m) => m.role === "user")?.blocks[0].text?.slice(0, 80) || "(无标题)";

  return createHistory({
    sourceApp: "doubao-work",
    sourceKind: "agent",
    sourceSessionId: path.basename(path.dirname(path.dirname(path.dirname(trajPath)))),
    sourcePath: trajPath,
    title,
    rawFormat: "doubao-work-trajectory",
    environment: { cwd: null },
    messages,
  });
}

export const doubaoWorkSource = {
  name: "doubao-work",
  displayName: "豆包工作版",
  kind: "agent",
  detectStatus() {
    const installed = fs.existsSync(SESSIONS_DIR);
    return {
      kind: "agent",
      installed,
      detail: installed
        ? "豆包工作版已安装，可以读取 agent 会话历史。"
        : "未检测到豆包工作版。请先下载安装豆包工作版并进行至少一次 AI 对话。",
    };
  },
  list,
  read,
};
