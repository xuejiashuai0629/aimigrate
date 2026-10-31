import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { createHistory } from "../../core/history.js";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

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
      // 忽略坏行，读取其余会话。
    }
  }
  return events;
}

function claudeContentBlocks(content) {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const blocks = [];
  for (const item of content) {
    if (!item) continue;
    if (item.type === "text" && item.text) {
      blocks.push({ type: "text", text: item.text });
    } else if (item.type === "thinking" && item.thinking) {
      blocks.push({ type: "reasoning", text: item.thinking });
    } else if (item.type === "tool_use") {
      blocks.push({
        type: "tool_call",
        toolCallId: item.id,
        name: item.name,
        arguments: item.input,
      });
    } else if (item.type === "tool_result") {
      let content = item.content;
      if (Array.isArray(content)) {
        content = content.map((part) => part?.text || "").join("\n");
      }
      blocks.push({
        type: "tool_result",
        toolCallId: item.tool_use_id,
        content,
        isError: Boolean(item.is_error),
      });
    } else if (item.type === "image") {
      blocks.push({ type: "attachment", mediaType: "image", ref: item.source });
    }
  }
  return blocks;
}

async function list() {
  const files = walkJsonl(PROJECTS_DIR);
  const out = [];
  for (const filePath of files) {
    const stat = fs.statSync(filePath);
    const events = await readJsonl(filePath);
    let title = "(无标题)";
    for (const event of events) {
      if (event.type === "ai-title" && event.aiTitle) {
        title = event.aiTitle;
        break;
      }
      if (!title || title === "(无标题)") {
        if (event.type === "user") {
          const text = claudeContentBlocks(event.message?.content)
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n")
            .trim();
          if (text) title = text.slice(0, 80).replace(/\s+/g, " ");
        }
      }
    }
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
    if (event.type === "ai-title" && event.aiTitle) {
      title = event.aiTitle;
      continue;
    }

    if (event.type !== "user" && event.type !== "assistant") continue;
    const blocks = claudeContentBlocks(event.message?.content);
    if (!blocks.length) continue;

    sourceExtra.sessionId ||= event.sessionId;
    sourceExtra.version ||= event.version;
    sourceExtra.cwd ||= event.cwd;
    sourceExtra.gitBranch ||= event.gitBranch;

    messages.push({
      id: event.uuid || event.message?.id || `claude-${++messageSeq}`,
      role: event.type === "user" ? "user" : "assistant",
      timestamp: event.timestamp,
      channel: event.isSidechain ? "sidechain" : "main",
      blocks,
    });
  }

  sourceExtra.sessionId ||= path.basename(filePath, ".jsonl");
  return createHistory({
    sourceApp: "claude-code",
    sourceKind: "agent",
    sourceSessionId: sourceExtra.sessionId,
    sourcePath: filePath,
    title,
    rawFormat: "claude-jsonl",
    sourceExtra,
    environment: {
      cwd: sourceExtra.cwd,
      version: sourceExtra.version,
      gitBranch: sourceExtra.gitBranch,
    },
    rawEvents: events,
    messages,
  });
}

export const claudeCodeSource = {
  name: "claude-code",
  displayName: "Claude Code",
  kind: "agent",
  root: PROJECTS_DIR,
  detectStatus() {
    return {
      kind: "agent",
      installed: fs.existsSync(PROJECTS_DIR),
      root: PROJECTS_DIR,
      detail: fs.existsSync(PROJECTS_DIR) ? "Claude Code 已安装，会话目录已找到。" : "未检测到 Claude Code。请先下载安装 Claude Code 并至少进行一次对话，历史记录会自动生成。",
    };
  },
  list,
  read,
};
