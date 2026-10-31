import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createOfflineSummary } from "../src/core/summary/extractive.js";
import { saveHandoffArchive } from "../src/core/archive.js";
import { createMigrationReport, saveMigrationReport } from "../src/core/report.js";

function history() {
  return {
    schemaVersion: 1,
    source: {
      app: "doubao",
      kind: "web",
      sessionId: "s1",
      path: "web:/chat/s1",
      title: "修复导入器",
      rawFormat: "doubao-dom-fiber",
      url: "https://www.doubao.com/chat/s1",
    },
    timeRange: { from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" },
    messages: [
      { id: "m1", role: "user", blocks: [{ type: "text", text: "请修复 E:\\Desktop\\aimigrate-next\\src\\app.js 的导入 bug" }] },
      { id: "m2", role: "assistant", blocks: [
        { type: "tool_call", toolCallId: "c1", name: "shell", arguments: { command: "npm test" } },
        { type: "text", text: "修复完成。\n下一步：跑完整测试。" },
      ] },
      { id: "m3", role: "tool", blocks: [{ type: "tool_result", toolCallId: "c1", content: "EPERM: operation not permitted" }] },
    ],
    stats: { messageCount: 3, toolCallCount: 1, toolResultCount: 1, attachmentCount: 0 },
  };
}

test("offline extractive summary extracts task, files, commands, errors, and next steps", () => {
  const summary = createOfflineSummary(history());

  assert.equal(summary.mode, "offline-extractive");
  assert.equal(summary.sourceSessionId, "s1");
  assert.match(summary.taskGoal, /修复 E:\\Desktop\\aimigrate-next/);
  assert.match(summary.lastAssistantConclusion, /修复完成/);
  assert.ok(summary.keyFiles.some((file) => file.includes("src\\app.js")));
  assert.ok(summary.keyCommands.includes("npm test"));
  assert.ok(summary.errors.some((error) => error.includes("EPERM")));
  assert.ok(summary.nextSteps.some((step) => step.includes("下一步")));
  assert.match(summary.markdown, /# aimigrate 交接摘要/);
  assert.ok(summary.estimatedTokens > 0);
});

test("handoff archive saves full history and summary", () => {
  const item = history();
  const summary = createOfflineSummary(item);
  const files = saveHandoffArchive(item, summary, fs.mkdtempSync(path.join(os.tmpdir(), "aimigrate-archive-")));

  assert.ok(fs.existsSync(files.fullPath));
  assert.ok(fs.existsSync(files.markdownPath));
  const saved = JSON.parse(fs.readFileSync(files.fullPath, "utf8"));
  assert.equal(saved.summary.mode, "offline-extractive");
});

test("migration report can be created and saved", () => {
  const item = history();
  const report = createMigrationReport({
    history: item,
    result: {
      ok: true,
      targetApp: "codex",
      sessionId: "target-1",
      targetPath: "C:/tmp/session.jsonl",
      verification: { ok: true },
      warnings: ["工具调用语义可能不完全等价。"],
    },
    migrationLevel: "L2",
    mode: "transcript",
  });

  assert.equal(report.success, true);
  assert.equal(report.migrationTokenCost, 0);
  assert.match(report.markdown, /# aimigrate 迁移报告/);

  const files = saveMigrationReport(report, fs.mkdtempSync(path.join(os.tmpdir(), "aimigrate-report-")));
  assert.ok(fs.existsSync(files.jsonPath));
  assert.ok(fs.existsSync(files.markdownPath));
});
