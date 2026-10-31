import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { codexTarget } from "../src/adapters/target/codex.js";

function history() {
  return {
    schemaVersion: 1,
    source: {
      app: "claude-code",
      kind: "agent",
      sessionId: "source-1",
      path: "source.jsonl",
      title: "迁移到 Codex",
      rawFormat: "claude-jsonl",
      cwd: "E:/Demo",
      model: "source-model",
      gitBranch: "main",
    },
    messages: [
      { id: "m1", role: "user", timestamp: "2026-01-01T00:00:00Z", blocks: [{ type: "text", text: "继续这个任务" }] },
      { id: "m2", role: "assistant", timestamp: "2026-01-01T00:00:01Z", blocks: [
        { type: "reasoning", text: "先检查状态" },
        { type: "text", text: "好的。" },
        { type: "tool_call", toolCallId: "c1", name: "shell", arguments: { command: "npm test" } },
      ] },
      { id: "m3", role: "tool", timestamp: "2026-01-01T00:00:02Z", blocks: [{ type: "tool_result", toolCallId: "c1", content: "ok", isError: false }] },
    ],
    stats: { messageCount: 3, textCharacterCount: 20, estimatedTokens: 42, toolCallCount: 1, toolResultCount: 1 },
  };
}

test("codex target dry run does not write any file", async () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aimigrate-codex-target-"));
  const result = codexTarget.dryRun(history(), { targetRoot });

  assert.equal(result.dryRun, true);
  assert.equal(result.title, "迁移到 Codex");
  assert.equal(result.responseItemCount, 5);
  assert.equal(result.indexWillUpdate, false);
  assert.ok(fs.existsSync(result.projectDir) === false);
  assert.ok(fs.existsSync(result.targetPath) === false);
});

test("codex target imports canonical history and verifies native JSONL", async () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aimigrate-codex-target-"));
  const result = codexTarget.importNative(history(), { targetRoot });

  assert.equal(result.ok, true);
  assert.equal(result.imported, true);
  assert.equal(result.verification.ok, true);
  assert.equal(result.index.updated, false);
  assert.ok(result.index.reason.includes("SQLite"));

  const events = fs.readFileSync(result.targetPath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(events[0].type, "session_meta");
  assert.equal(events[0].payload.session_id, result.sessionId);
  assert.equal(events.filter((event) => event.type === "response_item").length, 5);

  const functionCall = events.find((event) => event.payload.type === "function_call");
  const functionOutput = events.find((event) => event.payload.type === "function_call_output");
  assert.equal(functionCall.payload.name, "shell");
  assert.equal(functionOutput.payload.call_id, functionCall.payload.call_id);
});

test("codex target can update a provided sqlite index with backup", async () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aimigrate-codex-target-"));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "aimigrate-codex-state-"));
  const stateDbPath = path.join(stateDir, "state.sqlite");
  const threadHistoryDbPath = path.join(stateDir, "thread_history.sqlite");
  const db = new DatabaseSync(stateDbPath);
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      model_provider TEXT NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      sandbox_policy TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      has_user_event INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      cli_version TEXT NOT NULL DEFAULT '',
      first_user_message TEXT NOT NULL DEFAULT '',
      thread_source TEXT,
      preview TEXT NOT NULL DEFAULT '',
      recency_at INTEGER,
      recency_at_ms INTEGER,
      history_mode TEXT NOT NULL DEFAULT 'legacy',
      originator TEXT,
      model TEXT
    )
  `);
  db.close();

  const historyDb = new DatabaseSync(threadHistoryDbPath);
  historyDb.exec(`
    CREATE TABLE thread_items (
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      rollout_ordinal INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      item_json TEXT NOT NULL,
      item_type TEXT NOT NULL DEFAULT '',
      updated_at_ordinal INTEGER NOT NULL DEFAULT 0,
      started_at_ms INTEGER,
      completed_at_ms INTEGER,
      PRIMARY KEY (thread_id, turn_id, item_id)
    );
    CREATE TABLE thread_turns (
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      rollout_ordinal INTEGER NOT NULL,
      status TEXT NOT NULL,
      error_json TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      duration_ms INTEGER,
      first_user_item_id TEXT,
      final_agent_item_id TEXT,
      rollout_byte_offset INTEGER,
      rollout_end_ordinal INTEGER,
      rollout_end_byte_offset INTEGER,
      PRIMARY KEY (thread_id, turn_id)
    );
    CREATE TABLE thread_history_projection_state (
      thread_id TEXT PRIMARY KEY,
      next_rollout_byte_offset INTEGER NOT NULL,
      next_rollout_ordinal INTEGER NOT NULL
    );
  `);
  historyDb.close();

  const result = codexTarget.importNative(history(), {
    targetRoot,
    stateDbPath,
    threadHistoryDbPath,
    updateIndex: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.index.updated, true);
  assert.ok(fs.existsSync(result.index.backupPath));
  assert.equal(result.index.row.title, "迁移到 Codex");
  assert.equal(result.index.row.rollout_path, result.targetPath);
  assert.equal(result.threadHistory.updated, true);
  assert.equal(result.threadHistory.itemCount, 3);
  assert.equal(result.threadHistory.turn.status, "completed");
  assert.equal(result.threadHistory.turn.first_user_item_id, "m1");
  assert.equal(result.threadHistory.turn.final_agent_item_id, "m2");
});

test("codex target refuses overwrite unless explicitly enabled and backs up when enabled", async () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aimigrate-codex-target-"));
  const options = { targetRoot, sessionId: "fixed-session" };
  const first = codexTarget.importNative(history(), options);

  assert.throws(() => codexTarget.importNative(history(), options), /目标会话已存在/);

  const second = codexTarget.importNative(history(), { ...options, overwrite: true });
  assert.equal(second.ok, true);
  assert.ok(second.backupPath);
  assert.ok(fs.existsSync(second.backupPath));
  assert.equal(first.targetPath, second.targetPath);
});
