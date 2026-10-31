# Doubao history notes

## Current source route

豆包当前使用本机 Edge 持久化浏览器 profile 打开会话页，然后从虚拟列表抓取完整历史。

```text
~/.aimigrate-next/browser/doubao
```

## Capture strategy

豆包未登录时 URL 不一定跳转。当前通过页面内置账号状态判断：

```json
{
  "accountInfo": {
    "data": {
      "error_code": 13,
      "name": "account_info_error",
      "description": "会话过期，请重新登录",
      "user_id": 0
    }
  }
}
```

命中 `error_code = 13`、`account_info_error` 或 `user_id = 0` 时，Source Adapter 返回 `NO_LOGIN`，GUI 会显示“去绑定”。

历史抓取策略：

豆包正文不在 `_ROUTER_DATA.message_list` 里一次性给全：

```json
{
  "has_more": true,
  "message_list": []
}
```

所以当前适配器：

1. 找到 `[class*='v_list_scroller']`。
2. 反复向上滚动。
3. 从每个虚拟列表 row 的 React fiber 中提取 `memoizedProps.message`。
4. 用真实 `message_id` 去重。
5. 按 `index` 排序。

角色映射：

```text
user_type = 1 -> user
user_type = 2 -> assistant
```

内容映射：

| Doubao content block | Canonical |
|---|---|
| `text_block.text` | `text` |
| `attachment_block` | `attachment` |
| `image_block` | `attachment` |
| `search_query_result_block` | 文本占位，结构化引用保留在抓取过程里 |

## Current limitations

- 这是 experimental DOM/fiber 抓取，不等于豆包私有 API 协议级导出。
- 前端 class/hash 可能变化。
- 附件暂不下载二进制，只保留结构化引用。
- 会话列表当前来自侧边栏可见项；超长历史列表可能需要后续做侧边栏虚拟列表滚动。
