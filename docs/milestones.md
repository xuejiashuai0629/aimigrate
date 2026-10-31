# Milestones

> 这里的编号恢复为最初计划。  
> 实现过程中，“Agent Target Writer”被提前做了，但它不是原计划的 M3；现在明确改回：
>
> **当前下一步：原计划 M3 —— 豆包 Source Adapter。**

## 状态总览

| 原里程碑 | 状态 | 说明 |
|---|---|---|
| M0 Canonical History Model | 完成 | 已支持 `timeRange / environment / rawEvents / rawEventsPolicy`，四个 Source Adapter 均保留原始事件。 |
| M1 Codex / Claude Code Source | 完成 | 能列出、读取、导出统一 JSON、估算 token。 |
| M2 DeepSeek Source | 完成 | DOM 版 Source Adapter 已接入，可列表和完整抓取；GUI 有绑定入口。 |
| M3 Doubao Source | 完成（experimental） | 支持列表、完整虚拟列表抓取、React fiber message_id 去重。 |
| M4 Agent Target Writer | 提前完成 | Codex / Claude Code 均已支持 experimental native writer、dry-run、备份、写入后校验。 |
| M5 Web Target Sender | 完成（experimental） | DeepSeek / 豆包 Summary Sender 已接入；离线摘要默认，API 摘要可选。 |
| M6 Route Planner + UI | 完成 | 四框 UI、路线规划、导入/发送入口、绑定入口、报告/归档中心、失败人工恢复、Active Window 均已接入。 |

## 执行顺序修正

原来的计划是：

```text
M0 Canonical History Model
M1 Codex / Claude Code Source
M2 DeepSeek Source
M3 Doubao Source
M4 Agent Target Writer
M5 Web Target Sender
M6 Route Planner + UI
```

实际执行中提前做了 M4 的一部分和 M6 的一部分。这些工作保留，但后续不再把它们算作 M3。

新的推进顺序：

```text
1. M5：Web Target Sender
2. M6：Migration Runner / Report / fallback
3. 回补 M4 的真实 resume 验证
```

## M0 — Canonical History Model

- [x] 定义 Canonical History Model。
- [x] 定义 L0-L3 迁移路线。
- [x] 实现路线规划器。
- [x] 用单元测试覆盖四种组合。
- [x] 显式增加 `timeRange`。
- [x] 明确 `rawEvents` 的存储策略：当前四个 Source Adapter 均内联保留原始事件。

## M1 — Codex / Claude Code Source

- [x] Codex source adapter。
- [x] Claude Code source adapter。
- [x] 能列出本地会话。
- [x] 能读取完整历史。
- [x] 能导出统一 JSON。
- [x] 能统计 token。
- [x] CLI list/read/plan。

## M2 — DeepSeek Source

- [x] DeepSeek source adapter 基础 DOM 版本。
- [x] 会话列表抓取。
- [x] 虚拟列表完整历史抓取。
- [x] GUI 内 DeepSeek 未绑定提示与一键绑定入口。
- [x] 本地 agent 未下载/未安装状态提示。
- [x] 隐藏命令行的一键启动器。
- [ ] 抓取会话创建/更新时间。
- [ ] 结构化处理搜索结果、引用块、图片等富内容。

## M3 — Doubao Source

- [x] 豆包站点能力探测。
- [x] 豆包登录/绑定流程。
- [x] 豆包会话列表抓取。
- [x] 豆包完整历史抓取（experimental DOM/fiber 版本）。
- [x] 豆包历史格式文档。
- [ ] 服务器协议级抓取。
- [ ] 附件二进制下载与保存。

## M4 — Agent Target Writer

这一段被提前完成，保留为 experimental。

### Claude Code

- [x] native session writer。
- [x] dry-run。
- [x] 写入前校验。
- [x] 写入后校验。
- [x] 覆盖前备份。
- [x] GUI 导入入口。

### Codex

- [x] native session writer。
- [x] dry-run。
- [x] 写入前校验。
- [x] 写入后校验。
- [x] 覆盖前备份。
- [x] SQLite 索引可选更新与备份。

### 待补强

- [ ] Claude Code 真实 resume 验证。
- [ ] Codex 真实 resume 验证。
- [x] Active Window 执行器（experimental）。
- [ ] 工具调用语义兼容性矩阵。

## M5 — Web Target Sender

- [x] Offline Extractive Summary。
- [x] Optional Abstractive Summary API。
- [x] Level 0 Handoff Archive。
- [x] Migration Report 生成与保存。
- [x] Summary → DeepSeek。
- [x] Summary → 豆包。
- [x] 发送前确认。
- [x] 发送后基础确认。
- [ ] 发送失败时的精确 UI 状态恢复。
- [ ] 长摘要分段发送。

## M6 — Route Planner + UI

- [x] 四框 UI。
- [x] 来源/目标能力显示。
- [x] 路线推荐。
- [x] DeepSeek 绑定入口。
- [x] 完整迁移执行器（transcript / native / summary / archive-active-window）。
- [x] 迁移报告自动生成与保存。
- [x] 失败后人工选择恢复路线。
- [x] Report / Archive Center。
- [ ] 归档二进制附件管理。
