import { blockText, estimateTokens } from "../history.js";

const HARNESS_MARKER_RE = /^<\/?(environment_context|recommended_plugins|system_reminder|permissions|collaboration_mode|apps_instructions|skills_instructions)/i;

function displayText(message) {
  const text = blockText(message?.blocks || []).trim();
  if (!text || HARNESS_MARKER_RE.test(text)) return "";
  return text;
}

function unique(values, limit = 12) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, limit);
}

function extractFilePaths(text) {
  return unique(text.match(/(?:[A-Za-z]:\\|\/)?(?:[\w.\- ]+[/\\])+[\w.\-]+/g) || [], 20)
    .filter((value) => /\.(md|json|jsonl|js|mjs|cjs|ts|tsx|jsx|py|css|html|toml|sqlite|png|jpg|jpeg|webp|pdf|docx|xlsx|pptx)$/i.test(value));
}

function extractCommands(message) {
  const commands = [];
  for (const block of message.blocks || []) {
    if (block.type !== "tool_call") continue;
    let args = block.arguments;
    if (typeof args === "string") {
      try { args = JSON.parse(args); } catch { args = {}; }
    }
    const command = args?.command || args?.cmd || args?.prompt || "";
    if (command) commands.push(String(command).slice(0, 500));
  }
  return unique(commands, 20);
}

function extractErrors(text) {
  return unique(
    text.split(/\r?\n/).filter((line) => /(error|exception|failed|失败|报错|错误|无法|不能|EPERM|ENOENT)/i.test(line)).slice(0, 20),
    20,
  );
}

function extractNextSteps(text) {
  return unique(
    text.split(/\r?\n/)
      .filter((line) => /^(下一步|接下来|todo|to-do|next step|\d+[.、)]|- \[ \])/i.test(line.trim()))
      .slice(0, 20),
    20,
  );
}

function firstMeaningfulText(messages, role, fromEnd = false) {
  const list = fromEnd ? [...messages].reverse() : messages;
  for (const message of list) {
    if (message.role !== role) continue;
    const text = displayText(message);
    if (text) return text;
  }
  return "";
}

function clip(value, length = 1200) {
  const text = String(value || "").trim();
  return text.length > length ? `${text.slice(0, length)}\n...[截断]` : text;
}

export function createOfflineSummary(history) {
  if (history?.schemaVersion !== 1) {
    throw new Error("仅支持 Canonical History schemaVersion 1");
  }

  const messages = history.messages || [];
  const taskGoal = clip(firstMeaningfulText(messages, "user"), 1800);
  const lastUserRequest = clip(firstMeaningfulText(messages, "user", true), 1800);
  const lastAssistantConclusion = clip(firstMeaningfulText(messages, "assistant", true), 3000);
  const allText = messages.map((message) => blockText(message.blocks)).join("\n");
  const keyFiles = extractFilePaths(allText);
  const keyCommands = unique(messages.flatMap(extractCommands), 20);
  const errors = extractErrors(allText);
  const nextSteps = extractNextSteps(lastAssistantConclusion);
  const status = errors.length ? "存在报错，继续前需要确认修复状态" : "可从最后状态继续";

  const markdown = [
    `# aimigrate 交接摘要（离线提取）`,
    "",
    `- 来源：${history.source.app}`,
    `- 来源会话：${history.source.sessionId || "(unknown)"}`,
    `- 标题：${history.source.title}`,
    `- 消息数：${messages.length}`,
    `- 时间范围：${history.timeRange?.from || "unknown"} ~ ${history.timeRange?.to || "unknown"}`,
    `- 当前状态：${status}`,
    "",
    "## 任务目标",
    "",
    taskGoal || "(未识别)",
    "",
    "## 最后用户请求",
    "",
    lastUserRequest || "(未识别)",
    "",
    "## 最后助手结论",
    "",
    lastAssistantConclusion || "(未识别)",
    "",
    "## 关键文件",
    "",
    keyFiles.length ? keyFiles.map((file) => `- ${file}`).join("\n") : "(未识别)",
    "",
    "## 关键命令",
    "",
    keyCommands.length ? keyCommands.map((command) => `- \`${command.replace(/`/g, "'")}\``).join("\n") : "(未识别)",
    "",
    "## 报错 / 需要注意",
    "",
    errors.length ? errors.map((error) => `- ${error}`).join("\n") : "(未识别)",
    "",
    "## 下一步",
    "",
    nextSteps.length ? nextSteps.map((step) => `- ${step}`).join("\n") : "请根据最后助手结论和最后用户请求继续。",
    "",
  ].join("\n");

  return {
    schemaVersion: 1,
    mode: "offline-extractive",
    title: history.source.title,
    sourceApp: history.source.app,
    sourceKind: history.source.kind,
    sourceSessionId: history.source.sessionId,
    status,
    taskGoal,
    lastUserRequest,
    lastAssistantConclusion,
    keyFiles,
    keyCommands,
    errors,
    nextSteps,
    markdown,
    estimatedTokens: estimateTokens(markdown),
    sourceStats: history.stats,
    createdAt: new Date().toISOString(),
  };
}
