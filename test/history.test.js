import test from "node:test";
import assert from "node:assert/strict";
import { calculateStats, createHistory } from "../src/core/history.js";

test("canonical history calculates text, tool call, and tool result stats", () => {
  const messages = [{
    id: "m1",
    role: "assistant",
    blocks: [
      { type: "text", text: "abcd" },
      { type: "tool_call", name: "shell", arguments: { command: "dir" } },
    ],
  }, {
    id: "m2",
    role: "tool",
    blocks: [{ type: "tool_result", toolCallId: "1", content: "file1\nfile2" }],
  }];

  const stats = calculateStats(messages);
  assert.equal(stats.messageCount, 2);
  assert.equal(stats.toolCallCount, 1);
  assert.equal(stats.toolResultCount, 1);
  assert.equal(stats.attachmentCount, 0);
  assert.ok(stats.estimatedTokens > 0);
});

test("createHistory keeps source metadata and calculates stats", () => {
  const item = createHistory({
    sourceApp: "codex",
    sourceKind: "agent",
    sourceSessionId: "s1",
    sourcePath: "p.jsonl",
    title: "测试",
    rawFormat: "codex-jsonl",
    environment: { cwd: "E:/Demo" },
    rawEvents: [{ type: "session_meta" }, { type: "response_item" }],
    messages: [{ id: "m1", role: "user", blocks: [{ type: "text", text: "hello" }] }],
  });

  assert.equal(item.schemaVersion, 1);
  assert.equal(item.source.app, "codex");
  assert.equal(item.stats.messageCount, 1);
  assert.equal(item.stats.attachmentCount, 0);
  assert.equal(item.timeRange.from, null);
  assert.equal(item.timeRange.to, null);
  assert.equal(item.environment.cwd, "E:/Demo");
  assert.equal(item.rawEventsPolicy, "inline");
  assert.equal(item.rawEvents.length, 2);
});

test("createHistory derives an explicit time range", () => {
  const item = createHistory({
    sourceApp: "codex",
    sourceKind: "agent",
    sourcePath: "p.jsonl",
    rawFormat: "codex-jsonl",
    messages: [
      { id: "m1", role: "user", timestamp: "2026-01-02T00:00:00Z", blocks: [] },
      { id: "m2", role: "assistant", timestamp: "2026-01-01T00:00:00Z", blocks: [] },
    ],
  });

  assert.equal(item.timeRange.from, "2026-01-01T00:00:00.000Z");
  assert.equal(item.timeRange.to, "2026-01-02T00:00:00.000Z");
  assert.equal(item.rawEventsPolicy, "external-reference");
});
