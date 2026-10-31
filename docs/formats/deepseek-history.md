# DeepSeek history notes

## Current source route

DeepSeek 当前没有使用公开导出 API。`deepseek.js` 使用本机 Edge 持久化浏览器 profile 打开会话页，然后从 DOM 抓取完整虚拟列表。

```text
~/.aimigrate-next/browser/deepseek
```

可以通过环境变量覆盖：

```bash
AIMIGRATE_PROFILE_ROOT="C:\Users\Thinkpad\.aimigrate\browser"
```

这会复用旧 aimigrate 的登录态，但不会显示或导出 Cookie。

## DOM assumptions

当前 DeepSeek 站点配置：

```json
{
  "conversationItem": "a[href^='/a/chat/s/']",
  "messageItem": "div.ds-message",
  "assistantContent": ".ds-assistant-message-main-content",
  "input": "textarea"
}
```

会话正文不是普通长列表，而是虚拟列表。只抓当前 DOM 会漏掉开头内容，所以源适配器会：

1. 找出包含消息最多的 `.ds-virtual-list`。
2. 滚动到顶部。
3. 分块向下滚动。
4. 按 `role + text` 去重收集。

实测验证：

```text
修复前：5 条消息
修复后：1186 条消息
估算 tokens：195443
```

## Known limitations

- DeepSeek DOM class 可能随前端发布变化。
- 搜索结果、引用块、图片等可能被折叠进文本，或尚未结构化。
- 当前还没有抓取会话创建/更新时间。
- 当前属于 M2 experimental，不是最终协议级实现。
