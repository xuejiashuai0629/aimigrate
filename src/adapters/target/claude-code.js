import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const PROJECTS_ROOT = path.join(os.homedir(), ".claude", "projects");

function encodeClaudeProjectPath(cwd) {
  return String(cwd || "").replace(/[^A-Za-z0-9]/g, "-");
}

function canonicalContentToClaude(blocks = []) {
  const content = [];
  const warnings = [];

  for (const block of blocks || []) {
    if (!block) continue;
    if (block.type === "text") {
      if (block.text) content.push({ type: "text", text: block.text });
    } else if (block.type === "reasoning") {
      if (block.text) content.push({ type: "thinking", thinking: block.text, signature: crypto.randomUUID() });
    } else if (block.type === "tool_call") {
      content.push({
        type: "tool_use",
        id: block.toolCallId || `call_${crypto.randomUUID()}`,
        name: block.name || "unknown",
        input: block.arguments ?? {},
      });
    } else if (block.type === "tool_result") {
      content.push({
        type: "tool_result",
        tool_use_id: block.toolCallId || `call_${crypto.randomUUID()}`,
        content: typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? ""),
        is_error: Boolean(block.isError),
      });
    } else if (block.type === "attachment") {
      content.push({
        type: "image",
        source: block.ref || { type: "aimigrate-unavailable-attachment" },
      });
      warnings.push("附件已尽力保留，但跨 agent 的图片/文件引用可能无法完全等价。");
    }
  }

  return { content, warnings };
}

function buildMessageEvents(history, options) {
  const events = [];
  const warnings = [];
  let parentUuid = null;
  let seq = 0;

  for (const message of history.messages || []) {
    const { content, warnings: blockWarnings } = canonicalContentToClaude(message.blocks);
    warnings.push(...blockWarnings);
    if (!content.length) continue;

    const uuid = crypto.randomUUID();
    const role = message.role === "assistant" ? "assistant" : "user";
    const event = {
      parentUuid,
      isSidechain: message.channel === "sidechain",
      type: role,
      message: {
        id: message.id || crypto.randomUUID(),
        type: "message",
        role,
        model: options.model || history.source?.model || "imported",
        content,
      },
      uuid,
      timestamp: message.timestamp || new Date().toISOString(),
      permissionMode: options.permissionMode || "default",
      userType: "external",
      entrypoint: options.entrypoint || "aimigrate",
      cwd: options.cwd,
      sessionId: options.sessionId,
      version: options.version || "imported",
      gitBranch: options.gitBranch || history.source?.gitBranch || "HEAD",
    };

    if (event.type === "user") {
      event.promptId = options.promptId;
      event.origin = { kind: "aimigrate-import" };
      event.promptSource = "aimigrate";
    }

    if (content.some((block) => block.type === "tool_result")) {
      event.session_id = options.sessionId;
      event.sourceToolAssistantUUID = parentUuid;
      event.toolUseResult = {
        content: content
          .filter((block) => block.type === "tool_result")
          .map((block) => block.content)
          .join("\n"),
      };
    }

    events.push(event);
    parentUuid = uuid;
    seq += 1;
  }

  return { events, warnings, messageCount: seq };
}

function buildNativeEvents(history, options) {
  const { events, warnings, messageCount } = buildMessageEvents(history, options);
  return {
    events: [
      { type: "mode", mode: "normal", sessionId: options.sessionId },
      { type: "permission-mode", permissionMode: options.permissionMode || "default", sessionId: options.sessionId },
      ...events,
      { type: "ai-title", aiTitle: options.title, sessionId: options.sessionId },
    ],
    warnings,
    messageCount,
  };
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function verifyNativeSession(filePath, expected) {
  const events = readJsonl(filePath);
  const messages = events.filter((event) => event.type === "user" || event.type === "assistant");
  const titleEvent = events.findLast?.((event) => event.type === "ai-title") ||
    [...events].reverse().find((event) => event.type === "ai-title");

  const errors = [];
  if (events.length !== expected.eventCount) {
    errors.push(`事件数不一致：期望 ${expected.eventCount}，实际 ${events.length}`);
  }
  if (messages.length !== expected.messageCount) {
    errors.push(`消息数不一致：期望 ${expected.messageCount}，实际 ${messages.length}`);
  }
  if (titleEvent?.aiTitle !== expected.title) {
    errors.push("标题事件缺失或不一致");
  }
  if (events.some((event) => event.sessionId && event.sessionId !== expected.sessionId)) {
    errors.push("部分事件 sessionId 不一致");
  }

  return {
    ok: errors.length === 0,
    eventCount: events.length,
    messageCount: messages.length,
    title: titleEvent?.aiTitle,
    sessionId: titleEvent?.sessionId,
    errors,
  };
}

function createPlan(history, options = {}) {
  if (history?.schemaVersion !== 1) {
    throw new Error("仅支持 Canonical History schemaVersion 1");
  }
  const cwd = options.cwd || history.source?.cwd;
  if (!cwd) {
    throw new Error("缺少目标 cwd；Claude Code 会话必须绑定一个工作目录。");
  }

  const targetRoot = options.targetRoot || PROJECTS_ROOT;
  const projectDir = path.join(targetRoot, encodeClaudeProjectPath(cwd));
  const sessionId = options.sessionId || crypto.randomUUID();
  const title = options.title || history.source?.title || "(无标题)";

  const { events, warnings, messageCount } = buildNativeEvents(history, {
    ...options,
    cwd,
    sessionId,
    title,
  });
  const jsonl = events.map((event) => JSON.stringify(event)).join("\n") + "\n";

  return {
    targetApp: "claude-code",
    cwd,
    targetRoot,
    projectDir,
    targetPath: path.join(projectDir, `${sessionId}.jsonl`),
    sessionId,
    title,
    eventCount: events.length,
    messageCount,
    estimatedBytes: Buffer.byteLength(jsonl, "utf8"),
    jsonl,
    warnings: [
      ...warnings,
      "跨 agent 的工具调用只能保留结构映射，不保证目标端工具权限和执行语义完全相同。",
    ],
  };
}

function detectStatus() {
  return {
    kind: "agent",
    installed: fs.existsSync(PROJECTS_ROOT),
    root: PROJECTS_ROOT,
    detail: fs.existsSync(PROJECTS_ROOT)
      ? "本地 Claude Code 会话目录已找到，可执行实验性导入。"
      : "未找到本地 Claude Code 会话目录。",
  };
}

function dryRun(history, options = {}) {
  const plan = createPlan(history, options);
  return {
    ok: true,
    dryRun: true,
    targetApp: plan.targetApp,
    targetPath: plan.targetPath,
    projectDir: plan.projectDir,
    sessionId: plan.sessionId,
    title: plan.title,
    eventCount: plan.eventCount,
    messageCount: plan.messageCount,
    estimatedBytes: plan.estimatedBytes,
    warnings: plan.warnings,
  };
}

function importNative(history, options = {}) {
  const plan = createPlan(history, options);

  if (options.dryRun) {
    return dryRun(history, options);
  }

  fs.mkdirSync(plan.projectDir, { recursive: true });

  if (fs.existsSync(plan.targetPath)) {
    if (!options.overwrite) {
      throw new Error(`目标会话已存在：${plan.targetPath}`);
    }
    if (options.backup !== false) {
      const backupPath = `${plan.targetPath}.bak-${Date.now()}`;
      fs.copyFileSync(plan.targetPath, backupPath);
      plan.backupPath = backupPath;
    }
  }

  const tempPath = `${plan.targetPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, plan.jsonl, { encoding: "utf8", flag: "wx" });

  try {
    fs.renameSync(tempPath, plan.targetPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }

  const verification = verifyNativeSession(plan.targetPath, {
    eventCount: plan.eventCount,
    messageCount: plan.messageCount,
    title: plan.title,
    sessionId: plan.sessionId,
  });

  if (!verification.ok) {
    throw new Error(`写入后校验失败：${verification.errors.join("；")}`);
  }

  return {
    ok: true,
    imported: true,
    targetApp: plan.targetApp,
    targetPath: plan.targetPath,
    projectDir: plan.projectDir,
    sessionId: plan.sessionId,
    title: plan.title,
    eventCount: verification.eventCount,
    messageCount: verification.messageCount,
    bytes: plan.estimatedBytes,
    backupPath: plan.backupPath || null,
    verification,
    warnings: plan.warnings,
  };
}

export const claudeCodeTarget = {
  name: "claude-code",
  displayName: "Claude Code",
  kind: "agent",
  root: PROJECTS_ROOT,
  contextWindowTokens: 200000,
  write: {
    native: "experimental",
    transcript: "experimental",
    summary: "planned",
  },
  detectStatus,
  dryRun,
  importNative,
};
