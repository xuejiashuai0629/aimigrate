# aimigrate-next

这是 aimigrate 的重构版。它的目标不是“把摘要发给别人”，而是根据源端和目标端的能力，自动选择四种迁移路线：

| Level | 名称 | 说明 |
---|---|---|
| L3 | Native Session Migration | 生成/转换目标 AI 的原生会话记录，迁移过程不烧 token |
| L2 | Full Transcript Import | 保留完整对话文本/工具事件，迁移过程不烧 token |
| L1 | Summary Handoff | 压缩摘要后开启新对话，可选接入用户自己的模型 API |
| L0 | Handoff Archive | 导出交接包，不作为主流程展示 |

当前状态按最初里程碑编号：M0/M1/M2/M3 基本完成；M4 的 Agent Target Writer 已提前完成；下一步是 M0 收尾，然后进入 M5——Web Target Sender。

- 已实现：统一历史模型、路线规划器、Codex 源适配器、Claude Code 源适配器、DeepSeek DOM 源适配器、豆包 Source Adapter、Codex / Claude Code 目标端实验性写入、一键启动、基础 GUI 绑定流程。
- 未实现：豆包源端读取、真实 L1 摘要、Active Window 执行器、迁移报告中心。

> 里程碑编号以最初计划为准。之前的本地目标端写入被提前完成，但现在不再称作原计划的 M3；当前 M3 指豆包 Source Adapter。

## 一键启动

双击项目根目录的：

```text
启动 aimigrate-next.vbs
```

它会隐藏命令行窗口、启动本地 server，并自动打开浏览器。如果 server 已在运行，会直接打开网页。

GUI 默认地址：`http://127.0.0.1:8765`

## 账号绑定

- Codex / Claude Code 是本地 agent，不需要登录；如果未找到历史，界面会提示未下载/未找到本地会话目录。
- DeepSeek / 豆包是网页 chatbot。未绑定时，“选择对话”会显示去绑定入口，点击后弹出浏览器窗口；扫码或登录成功后自动保存登录态。
- 目标是 DeepSeek / 豆包时，可以选择 `L1 summary` 发送离线交接摘要；这会消耗目标网页模型的正常对话额度。
- 超长对话迁移到本地 agent 时，可以选择 `L2 archive-active-window`：完整历史保存为本地归档，新会话只激活摘要和最近窗口。
- 也可以用命令行登录：

```bash
node src/cli.js login --source deepseek
```

## 开发者运行

```bash
node src/cli.js sources
node src/cli.js list --source codex
node src/cli.js list --source claude-code
node src/cli.js login --source deepseek
node src/cli.js list --source deepseek

# 如果想复用旧 aimigrate 的 DeepSeek 登录态：
# PowerShell:
# $env:AIMIGRATE_PROFILE_ROOT="$env:USERPROFILE\.aimigrate\browser"
node src/cli.js plan --source codex --target claude-code --path "<session.jsonl>"
node src/cli.js read --source codex --path "<session.jsonl>" --out history.json
node src/cli.js summary --source codex --path "<session.jsonl>"
node src/cli.js export --source codex --path "<session.jsonl>"
node src/cli.js gui
```

## Claude Code 目标端导入

默认只试运行：

```bash
node src/cli.js import --source codex --target claude-code --path "<session.jsonl>"
```

真实写入：

```bash
node src/cli.js import --source codex --target claude-code --path "<session.jsonl>" --execute
```

如果来源历史没有 `cwd`，需要指定目标工作目录：

```bash
node src/cli.js import --source deepseek --target claude-code --path "web:/a/chat/s/..." --cwd "E:\Demo"
```

真实写入会生成新的 Claude Code session UUID，避免覆盖源会话。若显式覆盖已有目标会话，会先创建 `.bak-<timestamp>` 备份。

## Codex 目标端导入

默认只试运行：

```bash
node src/cli.js import --source claude-code --target codex --path "<session.jsonl>"
```

真实写入：

```bash
node src/cli.js import --source claude-code --target codex --path "<session.jsonl>" --execute
```

同时更新 Codex 会话索引：

```bash
node src/cli.js import --source claude-code --target codex --path "<session.jsonl>" --execute --update-index
```

`--update-index` 会先备份 `~/.codex/state_5.sqlite`，再写入导入会话的索引行。这样 Codex UI 更容易看到新会话。

GUI 默认地址：`http://127.0.0.1:8765`

## 设计原则

1. 源端读取、格式转换、目标端写入、执行、校验分层。
2. 迁移本身不等于激活全部历史；超长对话使用完整迁移 + Active Window。
3. L1 是一等公民，不是失败兜底。
4. L0 隐藏兜底，不放在主界面。
5. 所有路线必须明确标注保真度、token 消耗、风险和实现状态。
