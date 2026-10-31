import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codexSource } from "../src/adapters/source/codex.js";
import { claudeCodeSource } from "../src/adapters/source/claude-code.js";

test("codex source parses meta, messages, tool calls, and extracts a display title", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aimigrate-codex-"));
  const filePath = path.join(dir, "rollout-2026-01-01T00-00-00-123.jsonl");
  const events = [
    { type: "session_meta", payload: { session_id: "s1", cwd: "E:/Demo", base_instructions: { provenance: { model: "test-model" } } } },
    { type: "response_item", timestamp: "2026-01-01T00:00:00Z", payload: { type: "message", id: "m0", role: "user", content: [{ type: "input_text", text: "<recommended_plugins>ignored</recommended_plugins>" }, { type: "input_text", text: "帮我修复构建错误" }] } },
    { type: "response_item", timestamp: "2026-01-01T00:00:01Z", payload: { type: "message", id: "m1", role: "assistant", content: [{ type: "output_text", text: "我先看日志。" }] } },
    { type: "response_item", timestamp: "2026-01-01T00:00:02Z", payload: { type: "function_call", id: "t1", call_id: "c1", name: "shell", arguments: { command: "npm test" } } },
    { type: "response_item", timestamp: "2026-01-01T00:00:03Z", payload: { type: "function_call_output", call_id: "c1", output: "ok" } },
  ];
  fs.writeFileSync(filePath, events.map((event) => JSON.stringify(event)).join("\n"));

  const history = await codexSource.read(filePath);
  assert.equal(history.source.app, "codex");
  assert.equal(history.source.sessionId, "s1");
  assert.equal(history.source.title, "帮我修复构建错误");
  assert.equal(history.stats.messageCount, 4);
  assert.equal(history.stats.toolCallCount, 1);
  assert.equal(history.stats.toolResultCount, 1);
  assert.equal(history.rawEventsPolicy, "inline");
  assert.equal(history.rawEvents.length, 5);
  assert.equal(history.timeRange.from, "2026-01-01T00:00:00.000Z");
  assert.equal(history.timeRange.to, "2026-01-01T00:00:03.000Z");
  assert.equal(history.messages[1].blocks[0].text, "我先看日志。");
});

test("claude source parses ai-title, reasoning, tool calls, and results", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aimigrate-claude-"));
  const filePath = path.join(dir, "session.jsonl");
  const events = [
    { type: "ai-title", aiTitle: "迁移会话" },
    { type: "user", uuid: "u1", sessionId: "s1", timestamp: "2026-01-01T00:00:00Z", cwd: "E:/Demo", isSidechain: false, message: { role: "user", content: "继续这个任务" } },
    { type: "assistant", uuid: "a1", sessionId: "s1", timestamp: "2026-01-01T00:00:01Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "先检查格式" }, { type: "text", text: "好的。" }, { type: "tool_use", id: "t1", name: "read", input: { path: "a.txt" } }] } },
    { type: "user", uuid: "u2", sessionId: "s1", timestamp: "2026-01-01T00:00:02Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "file content" }] } },
  ];
  fs.writeFileSync(filePath, events.map((event) => JSON.stringify(event)).join("\n"));

  const history = await claudeCodeSource.read(filePath);
  assert.equal(history.source.app, "claude-code");
  assert.equal(history.source.sessionId, "s1");
  assert.equal(history.source.title, "迁移会话");
  assert.equal(history.stats.messageCount, 3);
  assert.equal(history.stats.toolCallCount, 1);
  assert.equal(history.stats.toolResultCount, 1);
  assert.equal(history.messages[1].blocks[0].type, "reasoning");
  assert.equal(history.messages[2].channel, "main");
  assert.equal(history.rawEvents.length, 4);
});
