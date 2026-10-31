# Claude Code native target writer

## Safety

Claude Code 目标端写入是 experimental。

默认行为：

- CLI 不带 `--execute` 时只 dry-run。
- GUI 的“执行迁移”必须二次确认。
- 写入时生成新的 `sessionId`，避免覆盖源会话。
- 如果目标文件已存在，必须显式 `overwrite`；开启覆盖时默认先备份。
- 写入采用临时文件 + rename，避免半截 JSONL。
- 写入后会重新读取文件校验事件数、消息数、标题和 sessionId。

## Path mapping

Claude Code 会话目录：

```text
~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
```

编码规则：

```js
cwd.replace(/[^A-Za-z0-9]/g, "-")
```

例如：

```text
E:\Desktop -> E--Desktop
```

## Mapping

| Canonical | Claude Code |
|---|---|
| `text` | `text` |
| `reasoning` | `thinking` |
| `tool_call` | `tool_use` |
| `tool_result` | `tool_result` |
| `attachment` | `image`（尽力保留） |
| `channel: sidechain` | `isSidechain: true` |

## Current limitations

- 不重放原始工具执行环境。
- 不保证目标端工具权限和执行语义完全一致。
- 不支持 Active Window；即使路线规划器推荐它，当前仍会完整写入。
- 暂不写入 Codex 原生目标。
