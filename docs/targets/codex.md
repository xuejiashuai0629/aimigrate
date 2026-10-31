# Codex native target writer

## Safety

Codex 目标端写入是 experimental。

默认行为：

- CLI 不带 `--execute` 时只 dry-run。
- GUI 的“执行迁移”必须二次确认。
- 写入时生成新的 Codex `sessionId`，避免覆盖源会话。
- 如果目标 rollout 文件已存在，必须显式 `overwrite`；开启覆盖时默认先备份。
- 写入使用临时文件 + rename，避免半截 JSONL。
- 写入后重新读取文件校验 `session_meta`、事件数和 `response_item` 数。
- SQLite 索引更新是可选的；更新前会先 checkpoint 并备份数据库。

## Native files

Codex rollout 会写入：

```text
~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<session-id>.jsonl
```

事件映射：

| Canonical | Codex |
|---|---|
| user / developer text | `response_item.payload.type = message` |
| assistant text | `response_item.payload.type = message` |
| `reasoning` | `response_item.payload.type = reasoning` |
| `tool_call` | `response_item.payload.type = function_call` |
| `tool_result` | `response_item.payload.type = function_call_output` |
| attachment | `input_image`，无法保留时降级为文本 |

## SQLite index

Codex 桌面/CLI 会使用：

```text
~/.codex/state_5.sqlite
```

桌面端渲染历史还会使用：

```text
~/.codex/thread_history_1.sqlite
```

这个投影库有三张关键表：

- `thread_items`
- `thread_turns`
- `thread_history_projection_state`

只写 `state_5.sqlite` 和 JSONL 时，会话能出现在列表里，但打开后历史可能空白。
所以 Codex writer 会在开启 `--update-index` 时同时写这三张表。

导入时可调用：

```bash
node src/cli.js import ... --execute --update-index
```

写入的表是 `threads`。如果目标 cwd 已有 Codex project，会自动关联 `project_id`；如果没有，会创建一条 `projects` 和 `project_roots` 记录。更新流程：

1. checkpoint WAL；
2. 复制 `state_5.sqlite` 为 `.bak-<timestamp>`；
3. 在事务中 `INSERT OR REPLACE INTO threads`；
4. 重新查询该行校验 `id/title/rollout_path`。

桌面历史投影流程：

1. checkpoint `thread_history_1.sqlite`；
2. 备份数据库；
3. 写入/替换 `thread_items`；
4. 写入 `thread_turns`；
5. 更新 `thread_history_projection_state`；
6. 重新查询校验 turn、item 数量和 projection state。

## Model provider

Codex resume 时必须使用本机 `~/.codex/config.toml` 里真实存在的 `model_provider` 和 `model`。

Codex writer 会读取：

```toml
model = "..."
model_provider = "..."

[model_providers.example]
```

然后写入：

```json
{
  "type": "session_meta",
  "payload": {
    "model_provider": "...",
    "base_instructions": {
      "provenance": {
        "model": "..."
      }
    }
  }
}
```

不再使用虚构的 `aimigrate-import` provider。

## Current limitations

- 不重放原始工具执行环境。
- 工具名、参数和权限不一定在目标端等价。
- SQLite schema 如果未来大改，index updater 可能需要跟随升级。
- 当前不实现 Active Window；即使路线规划器推荐它，当前仍会完整写入。
