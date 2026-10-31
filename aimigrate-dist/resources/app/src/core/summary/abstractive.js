import https from "node:https";

function httpsPostJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      reject(new Error(`Invalid URL: "${url}" (length=${url.length}, chars=[${[...url].map(c => c.charCodeAt(0)).join(",")}])`));
      return;
    }
    const req = https.request(parsed, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: {} });
        }
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

export async function createAbstractiveSummary(history, config) {
  // Strip invisible Unicode characters (zero-width spaces, BOM, soft hyphens)
  // that can be introduced by copy-pasting from web pages.
  const stripInvisible = (s) => typeof s === "string" ? s.replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060\u180E]/g, "").trim() : s;
  const baseUrl = stripInvisible(config?.apiBaseUrl || "").replace(/\/+$/, "");
  const apiKey = stripInvisible(config?.apiKey);
  const model = stripInvisible(config?.summaryModel);
  if (!baseUrl || !apiKey || !model) {
    throw new Error("压缩引擎 API 配置不完整：需要 Base URL、API Key 和 Model。");
  }

  const transcript = (history.messages || []).map((message) => {
    const role = message.role === "assistant" ? "assistant" : message.role === "user" ? "user" : "system";
    const text = (message.blocks || [])
      .map((block) => {
        if (block.type === "text") return block.text;
        if (block.type === "tool_call") return `[tool_call ${block.name}]`;
        if (block.type === "tool_result") return `[tool_result]`;
        if (block.type === "attachment") return `[attachment ${block.name || block.mediaType || ""}]`;
        return "";
      })
      .filter(Boolean)
      .join("\n");
    return `${role}: ${text}`.slice(0, 12000);
  }).join("\n\n").slice(0, 180000);

  const response = await httpsPostJson(`${baseUrl}/chat/completions`, {
    authorization: `Bearer ${apiKey}`,
  }, {
    model,
    messages: [
      {
        role: "system",
        content: "你是 AI 对话迁移助手。请生成结构化中文交接摘要，包含：任务目标、当前状态、关键决策、关键文件、关键命令、报错、下一步。不要寒暄，不要编造。",
      },
      { role: "user", content: transcript },
    ],
    temperature: 0.2,
  });

  const data = response.body;
  if (response.status >= 400) {
    throw new Error(data?.error?.message || `压缩引擎请求失败：${response.status}`);
  }

  const markdown = data?.choices?.[0]?.message?.content;
  if (!markdown) throw new Error("压缩引擎返回为空。");

  return {
    schemaVersion: 1,
    mode: "abstractive-api",
    title: history.source.title,
    sourceApp: history.source.app,
    sourceKind: history.source.kind,
    sourceSessionId: history.source.sessionId,
    markdown,
    model,
    provider: config.apiBaseUrl,
    sourceStats: history.stats,
    createdAt: new Date().toISOString(),
  };
}
