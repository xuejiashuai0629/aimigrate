# Claude Code session format notes

Claude Code 当前把项目会话保存在：

```text
~/.claude/projects/<encoded-project-path>/<session-id>.jsonl
```

当前解析器提升以下事件：

| Claude event | Canonical mapping |
|---|---|
| `ai-title` | `source.title` |
| `type = user` / `type = assistant` | canonical message |
| `message.content` string | text block |
| `message.content[].type = text` | text block |
| `message.content[].type = thinking` | reasoning block |
| `message.content[].type = tool_use` | tool_call block |
| `message.content[].type = tool_result` | tool_result block |
| `message.content[].type = image` | attachment block |

`isSidechain: true` 的消息会保留，但 `channel` 标记为 `sidechain`，方便以后过滤子代理内容。
