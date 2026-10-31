import { calculateStats, createHistory } from "./history.js";

export function createActiveWindowHistory(history, summary, options = {}) {
  if (history?.schemaVersion !== 1) {
    throw new Error("仅支持 Canonical History schemaVersion 1");
  }

  const maxMessages = Math.max(2, options.maxMessages || 50);
  const recentMessages = (history.messages || []).slice(-maxMessages);
  const summaryMessage = {
    id: `aimigrate-summary-${Date.now()}`,
    role: "user",
    timestamp: new Date().toISOString(),
    channel: "main",
    blocks: [{
      type: "text",
      text: [
        "<aimigrate-active-window>",
        "以下是由 aimigrate-next 生成的交接摘要。完整历史已保存到本地归档，本会话只激活摘要和最近窗口。",
        "",
        summary.markdown,
        "",
        "请基于以下最近对话继续任务；如需更早上下文，请询问用户或读取归档。",
        "</aimigrate-active-window>",
      ].join("\n"),
    }],
  };

  const messages = [summaryMessage, ...recentMessages];
  return createHistory({
    sourceApp: history.source.app,
    sourceKind: history.source.kind,
    sourceSessionId: history.source.sessionId,
    sourcePath: history.source.path,
    title: history.source.title,
    rawFormat: history.source.rawFormat,
    sourceExtra: {
      ...history.source,
      activeWindow: true,
      archivePath: options.archivePath || null,
    },
    environment: history.environment,
    rawEvents: [],
    messages,
  });
}

export function createSummaryOnlyHistory(history, summary, options = {}) {
  if (history?.schemaVersion !== 1) {
    throw new Error("仅支持 Canonical History schemaVersion 1");
  }

  const summaryMessage = {
    id: `aimigrate-summary-${Date.now()}`,
    role: "user",
    timestamp: new Date().toISOString(),
    channel: "main",
    blocks: [{
      type: "text",
      text: [
        "<aimigrate-summary-handoff>",
        "以下是由 aimigrate-next 生成的交接摘要。完整历史已保存到本地归档，本会话只包含摘要。",
        "",
        summary.markdown,
        "",
        "请基于此摘要了解任务背景；如需更早上下文，请询问用户或读取归档。",
        "</aimigrate-summary-handoff>",
      ].join("\n"),
    }],
  };

  return createHistory({
    sourceApp: history.source.app,
    sourceKind: history.source.kind,
    sourceSessionId: history.source.sessionId,
    sourcePath: history.source.path,
    title: history.source.title,
    rawFormat: history.source.rawFormat,
    sourceExtra: {
      ...history.source,
      summaryHandoff: true,
      archivePath: options.archivePath || null,
    },
    environment: history.environment,
    rawEvents: [],
    messages: [summaryMessage],
  });
}

export function estimateActiveWindow(history, options = {}) {
  const maxMessages = Math.max(2, options.maxMessages || 50);
  const recentMessages = (history.messages || []).slice(-maxMessages);
  return {
    messageCount: recentMessages.length,
    stats: calculateStats(recentMessages),
  };
}
