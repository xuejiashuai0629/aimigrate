export function estimateTokens(text) {
  // 粗略估算，仅供路线规划使用，不能当成计费依据。
  const chars = [...String(text || "")].length;
  return Math.ceil(chars / 3);
}

export function blockText(blocks = []) {
  return blocks
    .map((block) => {
      if (!block) return "";
      if (block.type === "text" || block.type === "reasoning") return block.text || "";
      if (block.type === "tool_call") {
        return `[tool_call ${block.name || "unknown"}]`;
      }
      if (block.type === "tool_result") {
        const content = typeof block.content === "string"
          ? block.content
          : JSON.stringify(block.content ?? "");
        return `[tool_result]\n${content}`;
      }
      if (block.type === "attachment") {
        return `[attachment ${block.name || block.mediaType || ""}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function calculateStats(messages = []) {
  const stats = {
    messageCount: messages.length,
    textCharacterCount: 0,
    estimatedTokens: 0,
    toolCallCount: 0,
    toolResultCount: 0,
    attachmentCount: 0,
  };

  for (const message of messages) {
    for (const block of message.blocks || []) {
      if (block.type === "text" || block.type === "reasoning") {
        stats.textCharacterCount += String(block.text || "").length;
      } else if (block.type === "tool_call") {
        stats.toolCallCount += 1;
        stats.textCharacterCount += JSON.stringify(block.arguments ?? {}).length;
      } else if (block.type === "tool_result") {
        stats.toolResultCount += 1;
        stats.textCharacterCount += typeof block.content === "string"
          ? block.content.length
          : JSON.stringify(block.content ?? {}).length;
      }
      if (block.type === "attachment") {
        stats.attachmentCount += 1;
      }
    }
  }

  stats.estimatedTokens = Math.ceil(stats.textCharacterCount / 3);
  return stats;
}

export function calculateTimeRange(messages = []) {
  const timestamps = (messages || [])
    .map((message) => message.timestamp)
    .filter(Boolean)
    .map((timestamp) => {
      const date = new Date(timestamp);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    })
    .filter(Boolean)
    .sort();

  return {
    from: timestamps[0] || null,
    to: timestamps.at(-1) || null,
  };
}

export function createHistory(input) {
  const messages = input.messages || [];
  const sourceExtra = input.sourceExtra || {};
  const source = {
    app: input.sourceApp,
    kind: input.sourceKind,
    sessionId: input.sourceSessionId || "",
    path: input.sourcePath,
    title: input.title || "(无标题)",
    rawFormat: input.rawFormat,
    ...sourceExtra,
  };

  return {
    schemaVersion: 1,
    source,
    messages,
    timeRange: calculateTimeRange(messages),
    environment: input.environment || {
      cwd: source.cwd || null,
      url: source.url || null,
    },
    rawEvents: input.rawEvents || [],
    rawEventsPolicy: input.rawEvents ? "inline" : "external-reference",
    stats: calculateStats(messages),
  };
}
