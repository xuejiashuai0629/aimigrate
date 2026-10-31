import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions");
const STATE_DB_PATH = path.join(os.homedir(), ".codex", "state_5.sqlite");
const CONFIG_PATH = path.join(os.homedir(), ".codex", "config.toml");
const require = createRequire(import.meta.url);

function getSqlite() {
  try {
    return require("node:sqlite");
  } catch {
    return null;
  }
}

function readCodexRuntime() {
  try {
    const config = fs.readFileSync(CONFIG_PATH, "utf8");
    const model = config.match(/^model\s*=\s*"([^"]+)"/m)?.[1];
    const modelProvider = config.match(/^model_provider\s*=\s*"([^"]+)"/m)?.[1];
    const providerNames = [...config.matchAll(/^\s*\[model_providers\.(?:"([^"]+)"|([^\]".]+))\]/gm)]
      .map((match) => match[1] || match[2])
      .filter(Boolean);

    return {
      model,
      modelProvider: modelProvider || providerNames[0],
      providerNames,
    };
  } catch {
    return {
      model: null,
      modelProvider: null,
      providerNames: [],
    };
  }
}

function textContentItems(blocks, role) {
  const items = [];
  for (const block of blocks || []) {
    if (!block) continue;
    if (block.type === "text" && block.text) {
      items.push({
        type: role === "assistant" ? "output_text" : "input_text",
        text: block.text,
      });
    } else if (block.type === "attachment") {
      if (block.ref?.type === "base64" && block.ref.data) {
        items.push({
          type: "input_image",
          image_url: `data:${block.ref.media_type || "image/png"};base64,${block.ref.data}`,
        });
      } else if (block.ref?.url) {
        items.push({
          type: "input_image",
          image_url: block.ref.url,
        });
      } else {
        items.push({
          type: "input_text",
          text: `[aimigrate attachment] ${block.name || block.mediaType || "unknown"}`,
        });
      }
    }
  }
  return items;
}

function itemCompletedFor(responseEvent, options) {
  const payload = responseEvent.payload;
  const timestamp = responseEvent.timestamp;
  const completedAtMs = Date.parse(timestamp);
  const base = {
    type: "item_completed",
    thread_id: options.sessionId,
    turn_id: responseEvent.turnId,
    item: null,
    started_at_ms: completedAtMs,
    completed_at_ms: completedAtMs,
  };

  if (payload.type === "message" && payload.role === "user") {
    const content = [];
    for (const block of payload.content || []) {
      if (block.type === "input_text" && block.text) {
        content.push({ type: "text", text: block.text, text_elements: [] });
      } else if (block.type === "input_image" && block.path) {
        content.push({ type: "local_image", path: block.path });
      } else if (block.type === "input_image" && block.image_url) {
        content.push({ type: "text", text: "[图片附件]" });
      }
    }
    return {
      timestamp,
      type: "event_msg",
      payload: {
        ...base,
        item: {
          type: "UserMessage",
          id: payload.id,
          client_id: crypto.randomUUID(),
          content,
        },
      },
    };
  }

  if (payload.type === "message" && payload.role === "assistant") {
    return {
      timestamp,
      type: "event_msg",
      payload: {
        ...base,
        item: {
          type: "AgentMessage",
          id: payload.id,
          content: (payload.content || [])
            .filter((block) => block.type === "output_text" && block.text)
            .map((block) => ({ type: "Text", text: block.text })),
          phase: "final_answer",
        },
      },
    };
  }

  if (payload.type === "reasoning") {
    return {
      timestamp,
      type: "event_msg",
      payload: {
        ...base,
        item: {
          type: "Reasoning",
          id: payload.id,
          summary_text: (payload.summary || [])
            .map((item) => item.text)
            .filter(Boolean),
          raw_content: [],
        },
      },
    };
  }

  return null;
}

function canonicalToCodexEvents(history, options) {
  const events = [];
  const warnings = [];
  let seq = 0;
  let firstUser = "";
  const turnId = crypto.randomUUID();
  const startedAtMs = Math.floor(Date.parse(history.messages?.[0]?.timestamp || new Date().toISOString()) / 1000);

  events.push({
    timestamp: history.messages?.[0]?.timestamp || new Date().toISOString(),
    type: "event_msg",
    payload: {
      type: "task_started",
      turn_id: turnId,
      started_at: startedAtMs,
      model_context_window: 200000,
      collaboration_mode_kind: "default",
    },
  });

  events.push({
    timestamp: history.messages?.[0]?.timestamp || new Date().toISOString(),
    type: "turn_context",
    payload: {
      turn_id: turnId,
      root_turn_id: turnId,
      cwd: options.cwd,
      workspace_roots: [options.cwd],
      current_date: new Date().toISOString().slice(0, 10),
      timezone: "Asia/Shanghai",
      approval_policy: "on-request",
      sandbox_policy: {
        type: "workspace-write",
        writable_roots: [options.cwd],
        network_access: false,
        exclude_tmpdir_env_var: false,
        exclude_slash_tmp: false,
      },
      model: options.model || history.source?.model || "imported",
      personality: "friendly",
      collaboration_mode: {
        mode: "default",
        settings: {
          model: options.model || history.source?.model || "imported",
          reasoning_effort: "medium",
        },
      },
      realtime_active: false,
      effort: "medium",
      summary: "auto",
    },
  });

  for (const message of history.messages || []) {
    const timestamp = message.timestamp || new Date().toISOString();
    const role = ["user", "assistant", "developer", "system"].includes(message.role)
      ? message.role === "system" ? "developer" : message.role
      : "user";

    const textItems = textContentItems(message.blocks, role);
    if (textItems.length) {
      const responseEvent = {
        timestamp,
        type: "response_item",
        payload: {
          type: "message",
          id: message.id || `msg_aimigrate_${++seq}`,
          role,
          content: textItems,
        },
      };
      responseEvent.turnId = turnId;
      events.push(responseEvent);
      const completed = itemCompletedFor(responseEvent, options);
      if (completed) events.push(completed);
      if (!firstUser && role === "user") {
        firstUser = textItems.filter((item) => item.type === "input_text").map((item) => item.text).join("\n");
      }
    }

    for (const block of message.blocks || []) {
      if (!block) continue;

      if (block.type === "reasoning" && block.text) {
        const responseEvent = {
          timestamp,
          type: "response_item",
          payload: {
            type: "reasoning",
            id: `rs_aimigrate_${crypto.randomUUID()}`,
            summary: [{ type: "summary_text", text: block.text }],
          },
        };
        responseEvent.turnId = turnId;
        events.push(responseEvent);
        const completed = itemCompletedFor(responseEvent, options);
        if (completed) events.push(completed);
      }

      if (block.type === "tool_call") {
        events.push({
          timestamp,
          type: "response_item",
          payload: {
            type: "function_call",
            id: `fc_aimigrate_${crypto.randomUUID()}`,
            name: block.name || "unknown",
            arguments: typeof block.arguments === "string"
              ? block.arguments
              : JSON.stringify(block.arguments ?? {}),
            call_id: block.toolCallId || `call_${crypto.randomUUID()}`,
          },
        });
      }

      if (block.type === "tool_result") {
        events.push({
          timestamp,
          type: "response_item",
          payload: {
            type: "function_call_output",
            id: `fco_aimigrate_${crypto.randomUUID()}`,
            call_id: block.toolCallId || `call_${crypto.randomUUID()}`,
            output: typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content ?? ""),
          },
        });
      }
    }
  }

  warnings.push("Codex 目标端不重放源 agent 的原始工具执行环境。");
  warnings.push("跨 agent 工具调用会映射为 Codex function_call，但不保证工具名、参数和权限完全等价。");

  return { events, warnings, firstUser: firstUser.trim(), turnId };
}

function createPlan(history, options = {}) {
  if (history?.schemaVersion !== 1) {
    throw new Error("仅支持 Canonical History schemaVersion 1");
  }

  const cwd = options.cwd || history.source?.cwd;
  if (!cwd) {
    throw new Error("缺少目标 cwd；Codex 会话必须绑定一个工作目录。");
  }

  const targetRoot = options.targetRoot || SESSIONS_ROOT;
  const sessionId = options.sessionId || crypto.randomUUID();
  const title = options.title || history.source?.title || "(无标题)";
  const firstTimestamp = history.messages?.find((message) => message.timestamp)?.timestamp
    || history.source?.createdAt
    || new Date().toISOString();
  const startedAt = new Date(firstTimestamp);
  if (Number.isNaN(startedAt.getTime())) {
    startedAt.setTime(Date.now());
  }

  const { events, warnings, firstUser, turnId } = canonicalToCodexEvents(history, options);
  const codexRuntime = readCodexRuntime();
  const model = options.model || codexRuntime.model || history.source?.model || "imported";
  const modelProvider = options.modelProvider || codexRuntime.modelProvider || "openai";
  const sessionMeta = {
    timestamp: startedAt.toISOString(),
    ordinal: 0,
    type: "session_meta",
    payload: {
      session_id: sessionId,
      id: sessionId,
      timestamp: startedAt.toISOString(),
      cwd,
      originator: "aimigrate-next",
      cli_version: "imported",
      source: options.source || "vscode",
      thread_source: "user",
      model_provider: modelProvider,
      base_instructions: {
        text: "This native session was imported by aimigrate-next from another AI conversation.",
        provenance: {
          type: "model",
          model,
        },
      },
      history_mode: "paginated",
      context_window: {
        window_id: `${sessionId}-context`,
      },
    },
  };

  let ordinal = 1;
  let byteOffset = 0;
  const allEvents = [sessionMeta, ...events].map((event) => {
    const projected = {
      ...event,
      ordinal: ordinal++,
    };
    const line = JSON.stringify(projected);
    projected.rolloutByteOffset = byteOffset;
    projected.rolloutEndByteOffset = byteOffset + Buffer.byteLength(line, "utf8");
    byteOffset += Buffer.byteLength(line, "utf8") + 1;
    return projected;
  });
  const jsonl = allEvents.map((event) => JSON.stringify(event)).join("\n") + "\n";
  const taskStarted = allEvents.find((event) => event.type === "event_msg" && event.payload?.type === "task_started");
  const uiItems = allEvents.filter((event) => event.type === "event_msg" && event.payload?.type === "item_completed")
    .map((event) => ({
      item: event.payload.item,
      threadId: event.payload.thread_id,
      turnId: event.payload.turn_id,
      itemId: event.payload.item.id,
      rolloutOrdinal: event.ordinal,
      createdAtMs: event.payload.completed_at_ms,
      startedAtMs: event.payload.started_at_ms,
      completedAtMs: event.payload.completed_at_ms,
    }));
  const year = String(startedAt.getUTCFullYear()).padStart(4, "0");
  const month = String(startedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(startedAt.getUTCDate()).padStart(2, "0");
  const stamp = startedAt.toISOString().replace(/\.\d+Z$/, "").replace(/:/g, "-");
  const projectDir = path.join(targetRoot, year, month, day);

  return {
    targetApp: "codex",
    cwd,
    targetRoot,
    projectDir,
    targetPath: path.join(projectDir, `rollout-${stamp}-${sessionId}.jsonl`),
    sessionId,
    title,
    firstUser,
    eventCount: allEvents.length,
    responseItemCount: allEvents.filter((event) => event.type === "response_item").length,
    estimatedBytes: Buffer.byteLength(jsonl, "utf8"),
    estimatedTokens: history.stats?.estimatedTokens || 0,
    jsonl,
    model,
    modelProvider,
    startedAt: startedAt.toISOString(),
    turnId,
    uiItems,
    rolloutOffsets: {
      firstEvent: allEvents[0],
      lastEvent: allEvents.at(-1),
      nextRolloutByteOffset: byteOffset,
      nextRolloutOrdinal: ordinal,
    },
    warnings,
  };
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function verifyNativeSession(filePath, expected) {
  const events = readJsonl(filePath);
  const meta = events.find((event) => event.type === "session_meta");
  const responseItems = events.filter((event) => event.type === "response_item");
  const errors = [];

  if (events.length !== expected.eventCount) {
    errors.push(`事件数不一致：期望 ${expected.eventCount}，实际 ${events.length}`);
  }
  if (responseItems.length !== expected.responseItemCount) {
    errors.push(`response_item 数不一致：期望 ${expected.responseItemCount}，实际 ${responseItems.length}`);
  }
  if (events.filter((event) => event.type === "session_meta").length !== 1) {
    errors.push("session_meta 数量不是 1");
  }
  if (meta?.payload?.session_id !== expected.sessionId) {
    errors.push("session_meta.session_id 不一致");
  }
  if (events.some((event) => event.payload?.session_id && event.payload.session_id !== expected.sessionId)) {
    errors.push("部分 response_item.session_id 不一致");
  }

  return {
    ok: errors.length === 0,
    eventCount: events.length,
    responseItemCount: responseItems.length,
    sessionId: meta?.payload?.session_id,
    errors,
  };
}

function backupStateDatabase(stateDbPath) {
  try {
    const sqlite = getSqlite();
    if (sqlite?.DatabaseSync) {
      const db = new sqlite.DatabaseSync(stateDbPath, { readOnly: true });
      db.exec("PRAGMA wal_checkpoint(FULL)");
      db.close();
    }
  } catch {
    // 即使 checkpoint 失败，也继续尝试复制主数据库。
  }

  const backupPath = `${stateDbPath}.bak-${Date.now()}`;
  fs.copyFileSync(stateDbPath, backupPath);
  return backupPath;
}

function normalizeProjectPath(value) {
  return path.resolve(String(value || "")).replace(/^\\\\\?\\/, "").toLowerCase();
}

function ensureCodexProject(db, cwd) {
  const tables = new Set(db.prepare("select name from sqlite_master where type='table'").all().map((row) => row.name));
  if (!tables.has("projects") || !tables.has("project_roots")) return null;
  const normalizedCwd = normalizeProjectPath(cwd);
  const existing = db.prepare(`
    select p.id, p.name
    from project_roots r
    join projects p on p.id = r.project_id
    where lower(r.path) = ?
    order by p.updated_at_ms desc
    limit 1
  `).get(normalizedCwd);
  if (existing) return existing.id;

  const nowMs = Date.now();
  const projectId = crypto.randomUUID();
  const name = path.basename(normalizedCwd) || "Imported Project";
  const position = db.prepare("select coalesce(max(position) + 1, 0) as next from projects").get().next;
  db.prepare(`
    insert into projects (id, name, metadata, position, created_at_ms, updated_at_ms)
    values (?, ?, '{}', ?, ?, ?)
  `).run(projectId, name, position, nowMs, nowMs);
  db.prepare(`
    insert into project_roots (project_id, position, path)
    values (?, 0, ?)
  `).run(projectId, path.resolve(cwd));
  return projectId;
}

function updateCodexIndex(plan, options = {}) {
  const stateDbPath = options.stateDbPath || STATE_DB_PATH;
  if (!fs.existsSync(stateDbPath)) {
    return { updated: false, reason: `未找到 Codex 索引数据库：${stateDbPath}` };
  }

  const sqlite = getSqlite();
  if (!sqlite?.DatabaseSync) {
    return { updated: false, reason: "当前 Node.js 没有 node:sqlite，无法更新 Codex 索引。" };
  }

  const backupPath = backupStateDatabase(stateDbPath);
  const startedAt = new Date(plan.startedAt);
  const now = Math.floor(Date.now() / 1000);
  const nowMs = Date.now();
  const db = new sqlite.DatabaseSync(stateDbPath);
  const threadColumns = new Set(db.prepare("pragma table_info(threads)").all().map((row) => row.name));

  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare(`
      INSERT OR REPLACE INTO threads (
        id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
        sandbox_policy, approval_mode, tokens_used, has_user_event, archived,
        cli_version, first_user_message, thread_source, preview, recency_at,
        recency_at_ms, history_mode, originator, model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      plan.sessionId,
      plan.targetPath,
      Math.floor(startedAt.getTime() / 1000),
      now,
      options.source || "vscode",
      plan.modelProvider,
      plan.cwd,
      plan.title,
      JSON.stringify({
        type: "workspace-write",
        writable_roots: [plan.cwd],
        network_access: false,
      }),
      "on-request",
      plan.estimatedTokens || 0,
      0,
      0,
      "aimigrate-next",
      plan.firstUser || plan.title,
      "user",
      plan.firstUser || plan.title,
      now,
      nowMs,
      "paginated",
      "aimigrate-next",
      plan.model,
    );

    if (threadColumns.has("project_id")) {
      const projectId = ensureCodexProject(db, plan.cwd);
      if (projectId) {
        db.prepare("update threads set project_id = ? where id = ?").run(projectId, plan.sessionId);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }

  const row = threadColumns.has("project_id")
    ? db.prepare("select id, title, rollout_path, project_id from threads where id = ?").get(plan.sessionId)
    : db.prepare("select id, title, rollout_path from threads where id = ?").get(plan.sessionId);
  db.close();

  if (!row || row.rollout_path !== plan.targetPath) {
    throw new Error("Codex 索引写入后校验失败");
  }

  return {
    updated: true,
    stateDbPath,
    backupPath,
    row,
  };
}

function threadHistoryItemJson(item) {
  if (item.type === "UserMessage") {
    return {
      type: "userMessage",
      id: item.id,
      clientId: item.client_id || null,
      content: item.content || [],
    };
  }
  if (item.type === "AgentMessage") {
    return {
      type: "agentMessage",
      id: item.id,
      text: (item.content || []).map((block) => block.text || "").join("\n"),
      phase: item.phase || null,
      memoryCitation: null,
      delivery: null,
      questions: null,
    };
  }
  if (item.type === "Reasoning") {
    return {
      type: "reasoning",
      id: item.id,
      summaryText: item.summary_text || [],
      rawContent: item.raw_content || [],
    };
  }
  return { type: item.type, id: item.id, ...item };
}

function threadHistoryItemType(item) {
  if (item.type === "UserMessage") return "userMessage";
  if (item.type === "AgentMessage") return "agentMessage";
  if (item.type === "Reasoning") return "reasoning";
  return item.type.charAt(0).toLowerCase() + item.type.slice(1);
}

function updateThreadHistoryIndex(plan, options = {}) {
  const threadHistoryDbPath = options.threadHistoryDbPath
    || path.join(os.homedir(), ".codex", "thread_history_1.sqlite");
  if (!fs.existsSync(threadHistoryDbPath)) {
    return { updated: false, reason: `未找到 Codex 桌面历史投影库：${threadHistoryDbPath}` };
  }

  const sqlite = getSqlite();
  if (!sqlite?.DatabaseSync) {
    return { updated: false, reason: "当前 Node.js 没有 node:sqlite，无法更新 Codex 桌面历史投影。" };
  }

  const backupPath = `${threadHistoryDbPath}.bak-${Date.now()}`;
  try {
    const checkpointDb = new sqlite.DatabaseSync(threadHistoryDbPath, { readOnly: true });
    checkpointDb.exec("PRAGMA wal_checkpoint(FULL)");
    checkpointDb.close();
  } catch {
    // checkpoint 失败时仍继续备份主数据库。
  }
  fs.copyFileSync(threadHistoryDbPath, backupPath);

  const db = new sqlite.DatabaseSync(threadHistoryDbPath);
  const firstUserItem = plan.uiItems.find((item) => item.item.type === "UserMessage");
  const finalAgentItem = [...plan.uiItems].reverse().find((item) => item.item.type === "AgentMessage");
  const taskStarted = plan.rolloutOffsets.firstEvent;

  try {
    db.exec("BEGIN IMMEDIATE");
    for (const item of plan.uiItems) {
      db.prepare(`
        INSERT OR REPLACE INTO thread_items (
          thread_id, turn_id, item_id, rollout_ordinal, created_at_ms,
          item_json, item_type, updated_at_ordinal, started_at_ms, completed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        plan.sessionId,
        item.turnId,
        item.itemId,
        item.rolloutOrdinal,
        item.createdAtMs,
        JSON.stringify(threadHistoryItemJson(item.item)),
        threadHistoryItemType(item.item),
        item.rolloutOrdinal,
        item.startedAtMs,
        item.completedAtMs,
      );
    }

    db.prepare(`
      INSERT OR REPLACE INTO thread_turns (
        thread_id, turn_id, rollout_ordinal, status, error_json,
        started_at, completed_at, duration_ms, first_user_item_id,
        final_agent_item_id, rollout_byte_offset, rollout_end_ordinal,
        rollout_end_byte_offset
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      plan.sessionId,
      plan.turnId,
      taskStarted.ordinal,
      "completed",
      null,
      Math.floor(new Date(plan.startedAt).getTime() / 1000),
      Math.floor(Date.now() / 1000),
      Math.max(0, Date.now() - new Date(plan.startedAt).getTime()),
      firstUserItem?.itemId || null,
      finalAgentItem?.itemId || null,
      taskStarted.rolloutByteOffset,
      plan.rolloutOffsets.lastEvent.ordinal,
      plan.rolloutOffsets.lastEvent.rolloutEndByteOffset,
    );

    db.prepare(`
      INSERT OR REPLACE INTO thread_history_projection_state (
        thread_id, next_rollout_byte_offset, next_rollout_ordinal
      ) VALUES (?, ?, ?)
    `).run(
      plan.sessionId,
      plan.rolloutOffsets.nextRolloutByteOffset,
      plan.rolloutOffsets.nextRolloutOrdinal,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }

  const turn = db.prepare("select * from thread_turns where thread_id = ? and turn_id = ?")
    .get(plan.sessionId, plan.turnId);
  const itemCount = db.prepare("select count(*) as count from thread_items where thread_id = ?")
    .get(plan.sessionId).count;
  const projection = db.prepare("select * from thread_history_projection_state where thread_id = ?")
    .get(plan.sessionId);
  db.close();

  if (!turn || itemCount < plan.uiItems.length || !projection) {
    throw new Error("Codex 桌面历史投影写入后校验失败");
  }

  return {
    updated: true,
    threadHistoryDbPath,
    backupPath,
    turn,
    itemCount,
    projection,
  };
}

function detectStatus() {
  return {
    kind: "agent",
    installed: fs.existsSync(SESSIONS_ROOT),
    root: SESSIONS_ROOT,
    detail: fs.existsSync(SESSIONS_ROOT)
      ? "本地 Codex 会话目录已找到，可执行实验性导入。"
      : "未找到本地 Codex 会话目录。",
  };
}

function dryRun(history, options = {}) {
  const plan = createPlan(history, options);
  return {
    ok: true,
    dryRun: true,
    targetApp: plan.targetApp,
    targetPath: plan.targetPath,
    projectDir: plan.projectDir,
    sessionId: plan.sessionId,
    title: plan.title,
    eventCount: plan.eventCount,
    responseItemCount: plan.responseItemCount,
    estimatedBytes: plan.estimatedBytes,
    indexWillUpdate: options.updateIndex === true,
    warnings: plan.warnings,
  };
}

function importNative(history, options = {}) {
  const plan = createPlan(history, options);

  if (options.dryRun) {
    return dryRun(history, options);
  }

  fs.mkdirSync(plan.projectDir, { recursive: true });

  if (fs.existsSync(plan.targetPath)) {
    if (!options.overwrite) {
      throw new Error(`目标会话已存在：${plan.targetPath}`);
    }
    if (options.backup !== false) {
      const backupPath = `${plan.targetPath}.bak-${Date.now()}`;
      fs.copyFileSync(plan.targetPath, backupPath);
      plan.backupPath = backupPath;
    }
  }

  const tempPath = `${plan.targetPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, plan.jsonl, { encoding: "utf8", flag: "wx" });

  try {
    fs.rmSync(plan.targetPath, { force: true });
    fs.renameSync(tempPath, plan.targetPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }

  const verification = verifyNativeSession(plan.targetPath, {
    eventCount: plan.eventCount,
    responseItemCount: plan.responseItemCount,
    sessionId: plan.sessionId,
  });

  if (!verification.ok) {
    throw new Error(`写入后校验失败：${verification.errors.join("；")}`);
  }

  let index = { updated: false, reason: "未请求更新 Codex SQLite 索引。" };
  if (options.updateIndex === true) {
    index = updateCodexIndex(plan, options);
  }

  let threadHistory = { updated: false, reason: "未请求更新 Codex 桌面历史投影。" };
  if (options.updateIndex === true) {
    threadHistory = updateThreadHistoryIndex(plan, options);
  }

  return {
    ok: true,
    imported: true,
    targetApp: plan.targetApp,
    targetPath: plan.targetPath,
    projectDir: plan.projectDir,
    sessionId: plan.sessionId,
    title: plan.title,
    eventCount: verification.eventCount,
    responseItemCount: verification.responseItemCount,
    bytes: plan.estimatedBytes,
    backupPath: plan.backupPath || null,
    verification,
    index,
    threadHistory,
    warnings: [
      ...plan.warnings,
      index?.updated && threadHistory?.updated
        ? "Codex JSONL、SQLite 索引和桌面历史投影均已写入。"
        : "Codex JSONL 已写入；SQLite 索引或桌面历史投影未完整更新，Codex UI 可能看不到会话或历史。",
    ],
  };
}

export const codexTarget = {
  name: "codex",
  displayName: "Codex",
  kind: "agent",
  root: SESSIONS_ROOT,
  stateDbPath: STATE_DB_PATH,
  contextWindowTokens: 200000,
  write: {
    native: "experimental",
    transcript: "experimental",
    summary: "planned",
  },
  detectStatus,
  dryRun,
  importNative,
};
