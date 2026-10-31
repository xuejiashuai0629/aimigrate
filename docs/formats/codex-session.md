# Codex session format notes

Codex 当前把主会话保存在：

```text
~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<session-id>.jsonl
```

每行是一个 JSON 事件。

当前解析器只把以下事件提升成 Canonical History 的结构化消息：

| Codex event | Canonical mapping |
|---|---|
| `session_meta` | `source.sessionId`, `source.cwd`, `source.model`, `source.originator` |
| `response_item.payload.type = message` | canonical message |
| `response_item.payload.type = function_call` | `tool_call` block |
| `response_item.payload.type = function_call_output` | `tool_result` block |
| `response_item.payload.type = reasoning` | `reasoning` block |

这是有意保守的解析策略。完整 L3 迁移不能依赖当前摘要，而必须重新读取原始 JSONL。
