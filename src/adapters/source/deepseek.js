import { createHistory } from "../../core/history.js";
import { isLoginPage, loadSiteConfig, withPage } from "../web/browser.js";

const config = loadSiteConfig("deepseek");

function needSelectors() {
  for (const name of ["conversationItem", "messageItem", "assistantContent", "input"]) {
    if (!config.selectors[name]) {
      throw new Error(`DeepSeek 站点配置缺少选择器：${name}`);
    }
  }
}

async function login() {
  needSelectors();
  return loginInteractive();
}

async function loginInteractive({ timeoutMs = 300000 } = {}) {
  needSelectors();
  const { launchBrowser } = await import("../web/browser.js");
  const context = await launchBrowser("deepseek", { headless: false });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(config.home, { waitUntil: "domcontentloaded", timeout: 60000 });
    const startedAt = Date.now();
    let loggedIn = false;

    while (Date.now() - startedAt < timeoutMs) {
      if (!isLoginPage(page.url(), config.home)) {
        try {
          const hasSession = await page.locator(config.selectors.conversationItem).first().isVisible({ timeout: 1000 });
          if (hasSession) {
            loggedIn = true;
            break;
          }
        } catch {
          // 首页可能暂时还没有会话项，继续轮询。
        }
      }
      await page.waitForTimeout(2000);
    }

    if (!loggedIn) {
      return {
        ok: false,
        code: "LOGIN_TIMEOUT",
        message: "等待登录超时。登录态可能已部分保存；请重新点击“去绑定”。",
      };
    }
  } finally {
    await context.close().catch(() => {});
  }
  return { ok: true, profile: "DeepSeek 绑定完成，登录态已保存。" };
}

async function list() {
  needSelectors();
  return withPage("deepseek", { headless: true }, async (page) => {
    await page.goto(config.home, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);

    if (isLoginPage(page.url(), config.home)) {
      const error = new Error("DeepSeek 未绑定。请在“选择对话”里点击“去绑定”。");
      error.code = "NO_LOGIN";
      throw error;
    }

    const items = await page.$$eval(
      config.selectors.conversationItem,
      (elements) => elements.map((element) => ({
        href: element.getAttribute("href") || "",
        title: (element.textContent || "").trim(),
      })).filter((item) => item.href && item.title)
    );

    const seen = new Set();
    const sessions = [];
    for (const item of items) {
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      sessions.push({
        id: `web:${item.href}`,
        path: `web:${item.href}`,
        title: item.title.slice(0, 120),
        updatedAt: null,
        sizeBytes: null,
      });
    }
    return sessions;
  });
}

async function read(ref) {
  needSelectors();
  const href = ref.startsWith("web:") ? ref.slice(4) : ref;
  const url = href.startsWith("http") ? href : new URL(href, config.home).href;

  return withPage("deepseek", { headless: true }, async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);

    if (isLoginPage(page.url(), config.home)) {
      const error = new Error("DeepSeek 未绑定。请在“选择对话”里点击“去绑定”。");
      error.code = "NO_LOGIN";
      throw error;
    }

    const rawMessages = await page.evaluate(async ({ messageSelector, assistantSelector }) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const seen = new Map();

      const findConversationList = () => {
        const lists = [...document.querySelectorAll(".ds-virtual-list")];
        return lists
          .map((element) => ({
            element,
            messageCount: element.querySelectorAll(messageSelector).length,
            scrollHeight: element.scrollHeight,
          }))
          .filter((item) => item.messageCount > 0)
          .sort((a, b) => b.messageCount - a.messageCount || b.scrollHeight - a.scrollHeight)[0]?.element;
      };

      const collect = () => {
        const list = findConversationList();
        if (!list) return;
        for (const element of list.querySelectorAll(messageSelector)) {
          const assistantNode = assistantSelector ? element.querySelector(assistantSelector) : null;
          const role = assistantNode ? "assistant" : "user";
          const text = (assistantNode?.textContent || element.textContent || "").trim();
          if (!text) continue;
          const key = `${role}\u0000${text}`;
          if (!seen.has(key)) seen.set(key, { role, text });
        }
      };

      let list = findConversationList();
      if (!list) return [];

      list.scrollTop = 0;
      await sleep(1200);
      collect();

      let lastScrollTop = -1;
      let stableRounds = 0;
      const bottom = () => list.scrollHeight - list.clientHeight;

      while (list.scrollTop < bottom() - 1) {
        list = findConversationList() || list;
        const step = Math.max(2000, list.clientHeight * 2);
        list.scrollTop = Math.min(list.scrollTop + step, bottom());
        await sleep(250);
        collect();

        if (list.scrollTop === lastScrollTop) {
          stableRounds += 1;
          if (stableRounds >= 3) break;
        } else {
          stableRounds = 0;
          lastScrollTop = list.scrollTop;
        }
      }

      return [...seen.values()];
    }, {
      messageSelector: config.selectors.messageItem,
      assistantSelector: config.selectors.assistantContent,
    });

    if (!rawMessages.length) {
      throw new Error("DeepSeek 会话页没有抓到消息；DOM 可能已变化。");
    }

    const messages = rawMessages.map((message, index) => ({
      id: `${href}#${index + 1}`,
      role: message.role,
      channel: "main",
      blocks: [{ type: "text", text: message.text }],
    }));

    return createHistory({
      sourceApp: "deepseek",
      sourceKind: "web",
      sourceSessionId: href.split("/").filter(Boolean).pop(),
      sourcePath: `web:${href}`,
      title: rawMessages.find((message) => message.role === "user")?.text?.slice(0, 80) || "(无标题)",
      rawFormat: "deepseek-dom",
      sourceExtra: {
        url,
        captureMethod: "dom",
      },
      environment: {
        url,
        captureMethod: "dom",
      },
      rawEvents: rawMessages,
      messages,
    });
  });
}

export const deepseekSource = {
  name: "deepseek",
  displayName: "DeepSeek",
  kind: "web",
  root: null,
  supportsLogin: true,
  detectStatus() {
    return {
      kind: "web",
      installed: true,
      requiresLogin: true,
      loggedIn: "unknown",
      detail: "需要绑定网页账号后才能读取服务器历史。",
    };
  },
  login,
  list,
  read,
};
