# aimigrate-next 工作方案

> 状态：方向已敲定，待开工  
> 日期：2026-10-25  
> 目标：打造一个新的 AI 对话迁移器，取代旧版 aimigrate 的“压缩上下文发送提要”主路线，支持本地 agent 与网页 chatbot 之间更高保真的历史迁移。

---

## 1. 核心结论

新版不从旧版 aimigrate 上继续修，而是新开一个干净项目，建议目录名为：

```text
E:\Desktop\aimigrate-next\
```

旧版 `E:\Desktop\aimigrate\` 不删除，但只作为参考资产使用。

新版的基本原则是：

> 迁移历史不等于激活全部历史。  
> aimigrate-next 应该先把历史完整读取、转换、保存，再根据目标端能力和用户选择决定如何激活上下文。

旧版的问题是把迁移本质做成了：

```text
读取文本
    ↓
压缩 / 提取
    ↓
发送消息
    ↓
目标 AI 重新理解
```

新版必须改成：

```text
Source Adapter 读取历史
        ↓
Canonical History Model 统一中间格式
        ↓
Route Planner 决定迁移路线
        ↓
Transform Layer 转换
        ↓
Target Adapter 写入 / 导入 / 发送
        ↓
Verifier 校验
        ↓
迁移报告
```

压缩摘要只是其中一种路线，不能再作为默认的底层架构。

---

## 2. 旧版项目的定位

旧版 aimigrate 不继续开发，但保留三类价值。

### 2.1 可以借鉴

#### DeepSeek 拉取服务器历史

旧版里已经实测过 DeepSeek 可以拉取完整网页聊天记录，这是最有价值的逆向经验。新版应整理成文档，然后重新实现为独立 Source Adapter。

需要整理的信息包括：

- 登录态来源；
- Cookie / localStorage / session 的使用方式；
- 历史记录接口地址；
- 请求参数；
- 返回结构；
- 分页逻辑；
- 标题获取方式；
- user / assistant 消息解析；
- 失败和登录失效的判断。

整理到：

```text
docs/formats/deepseek-history.md
```

#### 浏览器自动化经验

旧版中关于登录、Cookie、Edge 控制、网页输入框定位、粘贴发送等经验可以参考，但不要直接搬进新核心。新版应把浏览器能力抽成独立模块。

#### 离线提取式压缩

旧版的 extract 式压缩思路可以借鉴。新版 L1 默认应优先使用本地离线提取，不默认调用模型烧钱。

### 2.2 不要继承

新版不要继承以下旧设计：

1. 只读取 `{ role, text }` 的扁平消息结构；
2. 把“发送消息”当成迁移主路线；
3. driver 同时负责读取、压缩、发送、打开目标应用；
4. 默认牺牲完整历史换取简单交接；
5. 把网页 chatbot 一律当成只能压缩发送的黑盒。

---

## 3. 第一批试点

第一批只做四个 AI：

| 类型 | 应用 |
|---|---|
| 本地 agent | Codex |
| 本地 agent | Claude Code |
| 网页 chatbot | DeepSeek |
| 网页 chatbot | 豆包 |

这个组合可以覆盖四种迁移方向：

```text
agent → agent
agent → web
web → agent
web → web
```

第一版不要扩到 Cursor、Kimi、Gemini、千问、智谱等应用，先把这四个跑通。

---

## 4. 迁移等级定义

### Level 3：Native Session Migration

原生会话迁移。

- 把历史转换成目标端可识别的原生 session；
- 目标 AI 的会话列表中直接出现这段对话；
- 尽量保留标题、消息链、工具调用、工具结果、时间、模型等；
- 迁移过程本身不烧 token；
- 后续继续对话时，目标 AI 读取上下文仍会正常消耗 token。

典型场景：

```text
Codex → Claude Code
Claude Code → Codex
```

### Level 2：Full Transcript Import

完整文本历史导入。

- 保留完整 user / assistant 正文；
- 保留标题、时间、来源模型、来源应用；
- 可以保留工具调用摘要，但不追求完整还原原生 agent 状态；
- 迁移过程本身不烧 token；
- 适合目标端能接受导入，但不一定能直接还原原生 session 的情况。

典型场景：

```text
DeepSeek → Codex
豆包 → Claude Code
```

### Level 1：Summary Handoff

压缩摘要交接。

- 生成任务目标、当前状态、关键决策、文件路径、报错、下一步等摘要；
- 通过发送消息、写入交接文件、网页粘贴等方式开启新对话；
- 是一等公民的“轻量续聊模式”，不是单纯失败兜底；
- 适合用户希望干净开始，或原对话过长、目标端上下文不够的情况。

### Level 0：Handoff Archive

文件 / 链接交接。

- 不强行创建新会话；
- 导出完整历史或交接包；
- 目标 AI 需要时再读取；
- 不作为主界面选项，只作为高级选项和失败兜底。

输出可以是：

```text
conversation.jsonl
conversation.md
summary.md
handoff.zip
```

---

## 5. 关键模式：Archive + Active Window

当对话极长时，不要简单地“只迁最后几条”，而应使用：

> **完整迁移 + Active Window**

也就是：

```text
完整历史：
  conversation-full.jsonl

活跃工作区：
  summary.md
  recent-turns.jsonl
  current-task.md
```

目标 agent 继续工作时主要读取活跃工作区，需要考古时再查完整归档。

例如：

```text
DeepSeek 对话约 1.2M tokens
        ↓
完整导入到 Claude Code 本地归档
        ↓
生成任务摘要和最近 50 条活跃窗口
        ↓
Claude Code 继续任务时默认读取活跃窗口
```

这个模式比“只迁最后部分”更合理，因为它同时满足：

1. 不丢失完整历史；
2. 不让目标 agent 一开始就加载超大上下文；
3. 不需要为了压缩历史额外烧大量 token；
4. 用户之后仍可以回溯原始对话。

---

## 6. 新项目目录结构

建议结构：

```text
aimigrate-next/
  apps/
    gui/
    cli/

  core/
    schema/
    policy/
    transform/
    verify/
    report/
    browser/

  adapters/
    source/
      codex/
      claude-code/
      deepseek/
      doubao/

    target/
      codex/
      claude-code/
      deepseek/
      doubao/

  docs/
    formats/
      codex-session.md
      claude-code-session.md
      deepseek-history.md
      doubao-history.md
```

职责划分：

| 模块 | 职责 |
|---|---|
| `apps/gui` | 图形界面 |
| `apps/cli` | 命令行，便于调试和自动化 |
| `core/schema` | Canonical History Model |
| `core/policy` | 迁移路线决策 |
| `core/transform` | 源格式 → 中间格式 → 目标格式 |
| `core/verify` | 迁移后校验 |
| `core/report` | 迁移报告 |
| `core/browser` | 浏览器登录、抓取、网页自动化 |
| `adapters/source` | 从各 AI 读取历史 |
| `adapters/target` | 向各 AI 写入 / 导入 / 发送 |

---

## 7. Canonical History Model

中间格式不能只有：

```json
{
  "role": "user",
  "text": "..."
}
```

至少应表达：

```json
{
  "meta": {
    "title": "示例对话",
    "sourceApp": "deepseek",
    "sourceModel": "deepseek-chat",
    "sourceSessionId": "abc123",
    "createdAt": "2026-10-25T10:00:00Z",
    "updatedAt": "2026-10-25T12:00:00Z",
    "turnCount": 42,
    "estimatedTokens": 123456
  },
  "messages": [],
  "toolCalls": [],
  "toolResults": [],
  "attachments": [],
  "environment": {},
  "rawEvents": []
}
```

要点：

1. 保留完整原始事件；
2. 不在读取阶段丢掉工具结果；
3. 不在读取阶段丢掉父子消息链；
4. 不把 thinking、tool_result 一律当成无价值内容；
5. 不同等级迁移时可以裁剪展示，但原始中间格式不能主动丢信息。

---

## 8. Route Planner

Route Planner 根据：

- 来源应用能力；
- 目标应用能力；
- 用户选择的迁移意图；
- 历史长度；
- 目标上下文窗口；
- 目标端是否支持导入；

来决定推荐路线。

每个 adapter 应声明能力：

```json
{
  "source": {
    "read": ["local-session", "web-export", "browser-scrape"],
    "fidelity": ["summary", "transcript", "native"]
  },
  "target": {
    "write": ["local-session", "web-import", "ui-send", "file"],
    "fidelity": ["summary", "transcript", "native"]
  }
}
```

伪代码：

```ts
function planRoutes(sourceCaps, targetCaps, userIntent, contextStats) {
  const routes = [];

  if (sourceCaps.exportNative && targetCaps.importNative) {
    routes.push({ level: 3, mode: "native" });
  }

  if (sourceCaps.exportTranscript && targetCaps.importTranscript) {
    routes.push({ level: 2, mode: "transcript" });
  }

  if (sourceCaps.readable && targetCaps.canStartNewConversation) {
    routes.push({ level: 1, mode: "summary" });
  }

  if (sourceCaps.readable) {
    routes.push({ level: 0, mode: "handoff", hidden: true });
  }

  return chooseDefault(routes, userIntent, contextStats);
}
```

默认规则：

| 用户意图 | 默认路线 |
|---|---|
| 完整搬历史 | `L3 > L2` |
| 轻量继续 | `L1` |
| 上下文超过目标窗口 | 完整迁移 + Active Window，或 L1 |
| 未明确选择 | 推荐 L3 / L2，同时明确展示 L1 |

失败时不要静默降级。系统应停下来，让用户选择：

1. 重试当前等级；
2. 改用更低等级；
3. 导出 Level 0 交接包；
4. 取消迁移。

只有用户明确开启“失败时自动降级”，才允许自动降级。

---

## 9. 四种迁移组合矩阵

### 9.1 Agent → Agent

例子：

```text
Codex → Claude Code
Claude Code → Codex
```

可用方式：

```text
L3 Native
L2 Transcript
L1 Summary
L0 Handoff
```

默认推荐：

```text
正常长度：L3 Native
超长：完整迁移 + Active Window
用户想轻量：L1 Summary
```

难点：

- Codex 和 Claude Code 的工具调用结构不同；
- 工具结果、权限、环境上下文不一定等价；
- 必须先备份目标端 session，再做写入。

### 9.2 Web chatbot → Agent

例子：

```text
DeepSeek → Codex
DeepSeek → Claude Code
豆包 → Codex
豆包 → Claude Code
```

可用方式：

```text
L2 Transcript：优先
L3 Native：条件成熟后支持
L1 Summary：用户可选
L0 Handoff：兜底
```

默认推荐：

```text
能拉到完整网页历史：L2 Transcript
对话极长：L2 完整迁移 + Active Window
用户明确想轻量：L1 Summary
```

注意：

> 不应该只迁最后部分。  
> 应该完整导入，再选择激活窗口。

### 9.3 Agent → Web chatbot

例子：

```text
Codex → DeepSeek
Codex → 豆包
Claude Code → DeepSeek
Claude Code → 豆包
```

可用方式：

```text
L1 Summary：默认
完整粘贴：短对话可选
L0 Handoff：导出文件
L2 Native：一般不可用
```

默认推荐：

```text
L1 Summary
```

如果对话很短，可以提供：

```text
完整粘贴续聊
```

但必须提示：

> 这不是原生迁移，只是把完整历史作为消息发送给目标 chatbot。  
> 目标模型会读取全部内容，可能消耗大量额度。

超长对话时强制推荐：

```text
L1 Summary
```

### 9.4 Web chatbot → Web chatbot

例子：

```text
DeepSeek → 豆包
豆包 → DeepSeek
```

可用方式：

```text
L1 Summary：默认
L2 Transcript：只有目标端支持导入时可用
L0 Handoff：兜底
L3 Native：一般不可用
```

默认推荐：

```text
L1 Summary
```

重要限制：

> 不同网页 chatbot 的服务器历史通常不能直接互相照搬。  
> DeepSeek 的服务器记录不能直接写进豆包服务器，除非目标端提供导入 API 或明确支持导入。

如果目标端支持附件、长文本粘贴或文档理解，可以提供完整历史文件交接，但这不是原生迁移。

---

## 10. 总推荐矩阵

| 来源 / 目标 | Agent：Codex / Claude Code | Web：DeepSeek / 豆包 |
|---|---|---|
| **Agent** | L3 Native 优先；超长用完整迁移 + Active Window；L1 可选 | 通常 L1；短对话可完整粘贴；L2 一般不可用 |
| **Web** | L2 Transcript 优先；极长用完整迁移 + Active Window；L1 可选；未来可做 L3 | 通常 L1；L2 需目标端支持导入；L3 基本不可用 |

---

## 11. UI 设计

主界面保留四框结构：

```text
[ 来源 AI ]     [ 目标 AI ]

[ 选择对话 ]     [ 迁移方式 ]

[ 开始迁移 ]
```

但要增加：

1. 对话预览；
2. token 估算；
3. 系统推荐说明；
4. 迁移选项；
5. 迁移报告。

示例：

```text
来源 AI：DeepSeek
目标 AI：Claude Code

选择对话：
  - 帮我分析这份产品需求文档

统计：
  消息数：137
  时间范围：2026-09-01 ~ 2026-10-01
  估算 token：1,180,000
  附件：4 个

系统推荐：
  完整导入 + 工作区摘要

原因：
  DeepSeek 历史可以完整拉取。
  Claude Code 支持本地历史导入。
  但对话过长，继续时不宜一次性激活全部上下文。
```

迁移方式应展示两个主选项：

```text
● 高保真迁移
  - 等级：L2 / L3
  - 迁移过程不烧 token
  - 保留完整历史

○ 压缩摘要续聊
  - 等级：L1
  - 生成干净的新起点
  - 适合超长对话
```

Level 0 不放在主流程，只在高级选项或失败处理中出现。

---

## 12. L1 摘要设计

L1 分成两种：

### Offline Extractive Summary

默认方式。

不调用模型，纯本地规则提取：

- 任务目标；
- 最后用户请求；
- 最后助手结论；
- 关键文件路径；
- 关键命令；
- 报错信息；
- 当前状态；
- 下一步。

优点：

- 免费；
- 稳定；
- 隐私好。

### Optional Abstractive Summary

可选方式。

调用用户配置的模型生成摘要。

优点：

- 更可读；
- 更连贯。

缺点：

- 花钱；
- 有隐私风险。

因此 L1 默认必须是 offline extractive，不默认烧钱。

---

## 13. 安全与写入保护

凡是写入目标 agent 本地 session 的操作，必须遵守：

1. 写入前备份；
2. 支持 dry run；
3. 写入前校验；
4. 写入后校验；
5. 不覆盖已有 session；
6. 不静默修改目标端数据库；
7. 写入失败可回滚。

对 Codex / Claude Code 这类本地 agent，建议输出目录：

```text
.aimigrate/backups/
.aimigrate/exports/
.aimigrate/reports/
```

对网页 AI 的浏览器自动化也应限制：

1. 只操作用户明确选择的会话；
2. 不自动群发；
3. 不未经确认提交表单；
4. 不抓取用户未选择的历史；
5. 登录态只在本地使用，不上传服务器。

---

## 14. 迁移报告

每次迁移必须生成报告。

如果走 L3：

```text
迁移等级：L3 Native
是否烧迁移 token：否
标题：已迁移
消息数：123 / 123
工具调用：45 / 45
工具结果：43 / 45，2 条降级为文本
目标端识别：是
风险：目标 AI 继续该对话时仍会读取完整上下文
```

如果走 L2 + Active Window：

```text
迁移等级：L2 Transcript + Active Window
是否烧迁移 token：否
完整历史：已保存
活跃窗口：最近 50 条
摘要：已生成
目标端识别：是
```

如果走 L1：

```text
迁移等级：L1 Summary
原始消息数：123
摘要长度：4200 tokens
保留内容：任务目标、当前状态、关键文件、报错、下一步
丢弃内容：完整历史、部分工具输出
原因：用户选择轻量续聊 / 原上下文超过目标窗口
```

---

## 15. 开发里程碑

### M0：定义 Canonical History Model

目标：

```text
能表达标题、消息、工具调用、工具结果、附件、环境、原始事件。
```

验收：

- schema 定稿；
- 有示例数据；
- 有序列化 / 反序列化测试。

### M1：读取 Codex / Claude Code 历史

目标：

```text
Codex / Claude Code → Canonical History Model
```

验收：

- 能列出本地会话；
- 能读取完整历史；
- 能导出统一 JSON；
- 能统计消息数和 token 估算；
- 不修改原 session。

### M2：读取 DeepSeek 完整历史

目标：

```text
DeepSeek → Canonical History Model
```

验收：

- 能登录；
- 能拉取服务器历史；
- 能解析标题和完整对话；
- 能处理登录失效；
- 不上传用户数据。

### M3：读取豆包历史

先做能力探测。

如果能拉服务器历史，走正式 Source Adapter。  
如果不能，先支持手动导出 / 浏览器抓取。

验收：

- 明确记录当前能做什么、不能做什么；
- 不谎报支持能力。

### M4：Agent Target Writer

目标：

```text
Canonical History Model → Codex session
Canonical History Model → Claude Code session
```

验收：

- 支持 dry run；
- 支持 backup；
- 写入后目标 agent 能识别；
- 标题和消息数正确；
- 工具调用降级有报告。

### M5：Web Target Sender

目标：

```text
Summary → DeepSeek
Summary → 豆包
```

验收：

- 能打开目标网页；
- 能定位输入框；
- 能发送摘要；
- 能确认发送成功；
- 失败时不重复发送。

### M6：Route Planner + UI

目标：

```text
四框 UI + 路线推荐 + 迁移报告
```

验收：

- 四种组合能给出正确推荐；
- 用户可以强制选择 L1；
- 超长对话推荐 Archive + Active Window；
- 失败不静默降级；
- 生成完整迁移报告。

---

## 16. 第一版不做的事

第一版明确不做：

1. 不做 13 个 AI 全量互迁；
2. 不做自动同步；
3. 不做云端服务；
4. 不做账号托管；
5. 不做默认自动降级；
6. 不做“无提示写入目标 session”；
7. 不做伪造工具调用状态；
8. 不做超过能力范围的“万能迁移”。

---

## 17. 最终原则

新版 aimigrate-next 的产品原则是：

1. **能原生迁移就原生迁移；**
2. **不能原生迁移就完整导入；**
3. **不能完整导入就摘要交接；**
4. **摘要交接也不安全就导出归档；**
5. **不烧不必要的 token；**
6. **不静默丢历史；**
7. **不替用户做不可逆选择。**

一句话总结：

> aimigrate-next 不是“把聊天记录压缩后发给另一个 AI”的工具，  
> 而是一个能读取、转换、迁移、归档和按需激活 AI 对话历史的本地引擎。
