import test from "node:test";
import assert from "node:assert/strict";
import { createActiveWindowHistory, createSummaryOnlyHistory, estimateActiveWindow } from "../src/core/active-window.js";
import { createHistory } from "../src/core/history.js";
import { createOfflineSummary } from "../src/core/summary/extractive.js";

function history(count = 8) {
  return {
    schemaVersion: 1,
    source: {
      app: "deepseek",
      kind: "web",
      sessionId: "source-1",
      path: "web:/chat/source-1",
      title: "长对话",
      rawFormat: "deepseek-dom",
    },
    timeRange: { from: null, to: null },
    environment: {},
    rawEvents: [],
    messages: Array.from({ length: count }, (_, index) => ({
      id: `m${index + 1}`,
      role: index % 2 ? "assistant" : "user",
      timestamp: `2026-01-01T00:00:${String(index).padStart(2, "0")}Z`,
      blocks: [{ type: "text", text: `message ${index + 1}` }],
    })),
    stats: { messageCount: count, textCharacterCount: 0, estimatedTokens: 0, toolCallCount: 0, toolResultCount: 0, attachmentCount: 0 },
  };
}

test("active window keeps summary plus recent messages and marks archive", () => {
  const full = history(10);
  const summary = { markdown: "# 摘要\n继续当前任务。" };
  const active = createActiveWindowHistory(full, summary, {
    maxMessages: 4,
    archivePath: "E:/archives/conversation-full.json",
  });

  assert.equal(active.messages.length, 5);
  assert.match(active.messages[0].blocks[0].text, /aimigrate-active-window/);
  assert.match(active.messages[0].blocks[0].text, /# 摘要/);
  assert.equal(active.messages[1].id, "m7");
  assert.equal(active.messages.at(-1).id, "m10");
  assert.equal(active.source.activeWindow, true);
  assert.equal(active.source.archivePath, "E:/archives/conversation-full.json");
  assert.equal(active.stats.messageCount, 5);
});

test("active window estimator reports recent size", () => {
  const estimate = estimateActiveWindow(history(100), { maxMessages: 12 });
  assert.equal(estimate.messageCount, 12);
});

test("summary-only history contains exactly one user message with summary", () => {
  const history = createHistory({
    sourceApp: "codex",
    sourceKind: "local",
    messages: [
      { id: "1", role: "user", blocks: [{ type: "text", text: "hello" }] },
      { id: "2", role: "assistant", blocks: [{ type: "text", text: "world" }] },
      { id: "3", role: "user", blocks: [{ type: "text", text: "fix it" }] },
    ],
  });
  const summary = createOfflineSummary(history);
  const result = createSummaryOnlyHistory(history, summary, {
    archivePath: "/tmp/test-archive",
  });

  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].role, "user");
  const text = result.messages[0].blocks[0].text;
  assert.ok(text.includes("<aimigrate-summary-handoff>"));
  assert.ok(text.includes(summary.markdown));
  assert.ok(result.stats.messageCount === 1);
});
