export const targetCapabilities = {
  codex: {
    name: "codex",
    displayName: "Codex",
    kind: "agent",
    contextWindowTokens: 200000,
    write: {
      native: { status: "experimental" },
      transcript: { status: "experimental" },
      summary: { status: "experimental" },
    },
  },
  "claude-code": {
    name: "claude-code",
    displayName: "Claude Code",
    kind: "agent",
    contextWindowTokens: 200000,
    write: {
      native: { status: "experimental" },
      transcript: { status: "experimental" },
      summary: { status: "experimental" },
    },
  },
  deepseek: {
    name: "deepseek",
    displayName: "DeepSeek",
    kind: "web",
    contextWindowTokens: 128000,
    write: {
      native: { status: "unsupported" },
      transcript: { status: "planned" },
      summary: { status: "experimental" },
    },
  },
  doubao: {
    name: "doubao",
    displayName: "豆包",
    kind: "web",
    contextWindowTokens: 128000,
    write: {
      native: { status: "unsupported" },
      transcript: { status: "planned" },
      summary: { status: "experimental" },
    },
  },
  cursor: {
    name: "cursor",
    displayName: "Cursor",
    kind: "agent",
    contextWindowTokens: 200000,
    write: {
      native: { status: "planned" },
      transcript: { status: "planned" },
      summary: { status: "planned" },
    },
  },
  "doubao-work": {
    name: "doubao-work",
    displayName: "豆包工作版",
    kind: "agent",
    contextWindowTokens: 128000,
    write: {
      native: { status: "planned" },
      transcript: { status: "planned" },
      summary: { status: "planned" },
    },
  },
  "deepseek-harness": {
    name: "deepseek-harness",
    displayName: "DeepSeek Harness",
    kind: "agent",
    contextWindowTokens: 128000,
    write: {
      native: { status: "planned" },
      transcript: { status: "planned" },
      summary: { status: "planned" },
    },
  },
  workbuddy: {
    name: "workbuddy",
    displayName: "WorkBuddy",
    kind: "agent",
    contextWindowTokens: 128000,
    write: {
      native: { status: "planned" },
      transcript: { status: "planned" },
      summary: { status: "planned" },
    },
  },
};

function route(level, mode, status, description, tokenCost) {
  return {
    level,
    mode,
    status,
    description,
    migrationTokenCost: tokenCost,
  };
}

function buildRoutes({ sourceKind, targetKind, target }) {
  const routes = [];
  const nativeStatus = target?.write?.native?.status || "planned";
  const transcriptStatus = target?.write?.transcript?.status || "planned";

  if (sourceKind === "agent" && targetKind === "agent") {
    routes.push(route(3, "native", nativeStatus, "转换为目标 agent 的原生 session。", 0));
    routes.push(route(2, "transcript", transcriptStatus, "把完整历史导入为目标会话；继续对话时目标 AI 会读取全部导入内容。", 0));
    routes.push(route(2, "archive-active-window", "experimental", "完整历史保存为本地归档；新会话只激活摘要和最近窗口。", 0));
    routes.push(route(1, "summary", "experimental", "压缩摘要后开启轻量新对话。", "目标网页/模型读取摘要时正常计费。"));
  }

  if (sourceKind === "web" && targetKind === "agent") {
    routes.push(route(2, "transcript", transcriptStatus, "把网页 AI 的完整历史导入为目标会话；继续对话时目标 AI 会读取全部导入内容。", 0));
    routes.push(route(2, "archive-active-window", "experimental", "完整网页历史保存为本地归档；新会话只激活摘要和最近窗口。", 0));
    routes.push(route(1, "summary", "experimental", "压缩摘要后开启轻量新对话。", "目标网页/模型读取摘要时正常计费。"));
  }

  if (sourceKind === "agent" && targetKind === "web") {
    routes.push(route(1, "summary", "experimental", "压缩摘要后通过网页输入框开启新对话。", "目标网页模型读取摘要时正常计费。"));
  }

  if (sourceKind === "web" && targetKind === "web") {
    routes.push(route(1, "summary", "experimental", "压缩摘要后开启目标网页 AI 新对话。", "目标网页模型读取摘要时正常计费。"));
  }

  routes.push(route(0, "handoff", "hidden", "导出交接包；不作为主流程展示。", 0));
  return routes;
}

function activeWindowNeeded(history, target) {
  const estimated = history?.stats?.estimatedTokens || 0;
  const windowTokens = target?.contextWindowTokens || 128000;
  return estimated > windowTokens * 0.8;
}

function chooseDefault(routes, { sourceKind, targetKind, history, target }) {
  const longContext = activeWindowNeeded(history, target);

  if (sourceKind === "agent" && targetKind === "agent") {
    return longContext
      ? { level: 2, mode: "archive-active-window", reason: "原对话接近目标上下文，推荐完整归档 + 摘要/最近窗口激活。" }
      : { level: 3, mode: "native", reason: "本地 agent 支持原生迁移时优先 L3。" };
  }

  if (sourceKind === "web" && targetKind === "agent") {
    return longContext
      ? { level: 2, mode: "archive-active-window", reason: "原对话接近目标上下文，推荐完整归档 + 摘要/最近窗口激活。" }
      : { level: 2, mode: "transcript", reason: "网页完整历史可导入 agent，迁移过程不烧 token。" };
  }

  if (sourceKind === "agent" && targetKind === "web") {
    return { level: 1, mode: "summary", reason: "网页 chatbot 通常无法写入原生历史。" };
  }

  return { level: 1, mode: "summary", reason: "不同网页 AI 之间通常无法照搬服务器历史。" };
}

export function planRoutes({ sourceApp, targetApp, history }) {
  const source = { kind: history?.source?.kind || "agent" };
  const target = targetCapabilities[targetApp];
  if (!target) {
    throw new Error(`目标适配器未实现或不存在：${targetApp}`);
  }

  const routes = buildRoutes({ sourceKind: source.kind, targetKind: target.kind, target });
  const recommendation = chooseDefault(routes, {
    sourceKind: source.kind,
    targetKind: target.kind,
    history,
    target,
  });

  return {
    schemaVersion: 1,
    sourceApp,
    targetApp,
    sourceKind: source.kind,
    targetKind: target.kind,
    estimatedTokens: history?.stats?.estimatedTokens || 0,
    targetContextWindowTokens: target.contextWindowTokens,
    activeWindowRecommended: activeWindowNeeded(history, target),
    recommendation,
    routes,
  };
}
