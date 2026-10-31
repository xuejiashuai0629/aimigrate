# aimigrate-next architecture

## Pipeline

```text
Source Adapter
      ↓
Canonical History Model
      ↓
Route Planner
      ↓
Transform Layer
      ↓
Target Adapter
      ↓
Verifier
      ↓
Migration Report
```

## Canonical History Model

`CanonicalHistory` 是所有适配器之间的中间格式。

```ts
type CanonicalHistory = {
  schemaVersion: 1;
  source: {
    app: string;
    kind: "agent" | "web";
    sessionId: string;
    path: string;
    title: string;
    rawFormat: "codex-jsonl" | "claude-jsonl" | "deepseek-json" | "doubao-json";
    cwd?: string;
    model?: string;
  };
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system" | "developer" | "tool";
    timestamp?: string;
    channel?: "main" | "sidechain";
    blocks: Array<
      | { type: "text"; text: string }
      | { type: "reasoning"; text: string }
      | { type: "tool_call"; toolCallId?: string; name: string; arguments?: unknown }
      | { type: "tool_result"; toolCallId?: string; content?: unknown; isError?: boolean }
      | { type: "attachment"; name?: string; mediaType?: string; ref?: unknown }
    >;
  }>;
  stats: {
    messageCount: number;
    textCharacterCount: number;
    estimatedTokens: number;
    toolCallCount: number;
    toolResultCount: number;
  };
};
```

源适配器不需要把所有原始事件复制进中间模型。它必须记录 `source.path` 和 `source.rawFormat`，让未来的 L3 writer 可以回到原始文件读取完整事件。

## Migration levels

### L3 Native Session Migration

目标：把中间历史转换成目标端的原生 session 文件或数据库记录。

- 迁移过程：不调用模型，不烧 token。
- 后续对话：目标端读取上下文时按正常规则消耗 token。
- 风险：工具调用、权限、环境、子代理等状态可能无法完全等价转换。

### L2 Full Transcript Import

目标：保留完整正文、标题、时间和尽量多的事件，但不要求完全复刻目标端原生结构。

### L1 Summary Handoff

目标：为“继续干活”生成干净的新起点。

摘要分成两类：

1. Offline Extractive Summary：本地规则提取，不调用模型。
2. Optional Abstractive Summary：用户自带 API，程序调用用户配置的模型。

### L0 Handoff Archive

目标：导出完整历史、摘要、元数据和工作区文件。它不是主流程，只在高级选项和失败兜底中展示。

## Route policy

| Source | Target | Default | User-selectable |
|---|---|---|---|
| Agent | Agent | L3; 超长时 Archive + Active Window | L1 |
| Web | Agent | L2; 超长时 Archive + Active Window | L1 |
| Agent | Web | L1 | 短对话可选 Full Paste |
| Web | Web | L1 | 目标支持导入时 L2 |
