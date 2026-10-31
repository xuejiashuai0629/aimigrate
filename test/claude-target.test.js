import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeCodeTarget } from "../src/adapters/target/claude-code.js";

function history() {
  return {
    schemaVersion: 1,
    source: {
      app: "codex",
      kind: "agent",
      sessionId: "source-1",
      path: "source.jsonl",
      title: "修复构建",
      rawFormat: "codex-jsonl",
      cwd: "E:/Demo",
      model: "test-model",
      gitBranch: "main",
    },
    messages: [
      { id: "m1", role: "user", timestamp: "2026-01-01T00:00:00Z", blocks: [{ type: "text", text: "帮我修复构建" }] },
      { id: "m2", role: "assistant", timestamp: "2026-01-01T00:00:01Z", blocks: [
        { type: "text", text: "我先看日志。" },
        { type: "tool_call", toolCallId: "c1", name: "shell", arguments: { command: "npm test" } },
      ] },
      { id: "m3", role: "tool", timestamp: "2026-01-01T00:00:02Z", blocks: [{ type: "tool_result", toolCallId: "c1", content: "ok", isError: false }] },
    ],
    stats: { messageCount: 3, textCharacterCount: 20, estimatedTokens: 7, toolCallCount: 1, toolResultCount: 1 },
  };
}

test("claude target dry run does not write any file", async () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aimigrate-target-"));
  const result = claudeCodeTarget.dryRun(history(), { targetRoot });

  assert.equal(result.dryRun, true);
  assert.equal(result.title, "修复构建");
  assert.equal(result.messageCount, 3);
  assert.ok(fs.existsSync(result.projectDir) === false);
  assert.ok(fs.existsSync(result.targetPath) === false);
});

test("claude target imports canonical history and verifies it", async () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aimigrate-target-"));
  const result = claudeCodeTarget.importNative(history(), { targetRoot });

  assert.equal(result.ok, true);
  assert.equal(result.imported, true);
  assert.equal(result.verification.ok, true);
  assert.equal(result.verification.messageCount, 3);
  assert.equal(result.verification.title, "修复构建");

  const events = fs.readFileSync(result.targetPath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(events[0].type, "mode");
  assert.equal(events[0].sessionId, result.sessionId);
  assert.equal(events.at(-1).type, "ai-title");
  assert.equal(events.at(-1).aiTitle, "修复构建");

  const toolUse = events.flatMap((event) => event.message?.content || []).find((block) => block.type === "tool_use");
  const toolResult = events.flatMap((event) => event.message?.content || []).find((block) => block.type === "tool_result");
  assert.equal(toolUse.name, "shell");
  assert.equal(toolResult.tool_use_id, toolUse.id);
});

test("claude target refuses overwrite unless explicitly enabled and backs up when enabled", async () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aimigrate-target-"));
  const options = { targetRoot, sessionId: "fixed-session" };
  const first = claudeCodeTarget.importNative(history(), options);

  assert.throws(() => claudeCodeTarget.importNative(history(), options), /目标会话已存在/);

  const overwriteOptions = { ...options, overwrite: true };
  const second = claudeCodeTarget.importNative(history(), overwriteOptions);
  assert.equal(second.ok, true);
  assert.ok(second.backupPath);
  assert.ok(fs.existsSync(second.backupPath));
  assert.equal(first.targetPath, second.targetPath);
});
