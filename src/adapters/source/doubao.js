import { createHistory } from "../../core/history.js";
import { isLoginPage, loadSiteConfig, withPage } from "../web/browser.js";

const config = loadSiteConfig("doubao");

async function isDoubaoLoggedIn(page) {
  return page.evaluate(() => {
    const layout = window._ROUTER_DATA?.loaderData?.chat_layout?.chat_layout;
    const account = layout?.accountInfo;
    const data = account?.data;
    if (!account) return { loggedIn: false, reason: "页面没有账号信息。" };
    if (data?.error_code === 13 || data?.name === "account_info_error" || data?.user_id === 0) {
      return {
        loggedIn: false,
        reason: data?.description || "账号状态无效，请重新登录。",
      };
    }
    if (data?.user_id && !data?.error_code) {
      return { loggedIn: true };
    }
    return {
      loggedIn: false,
      reason: data?.description || "账号状态未知。",
    };
  });
}

async function assertDoubaoLoggedIn(page) {
  const state = await isDoubaoLoggedIn(page);
  if (!state.loggedIn) {
    const error = new Error("豆包未绑定。请在“选择对话”里点击“去绑定”。");
    error.code = "NO_LOGIN";
    error.detail = state.reason;
    throw error;
  }
  return state;
}

function needSelectors() {
  for (const name of ["conversationItem", "input"]) {
    if (!config.selectors[name]) {
      throw new Error(`豆包站点配置缺少选择器：${name}`);
    }
  }
}

function normalizeSidebarTitle(title) {
  let text = String(title || "").trim();
  for (const length of [4, 3, 2]) {
    if (text.length > 0 && text.length % length === 0) {
      const part = text.slice(0, text.length / length);
      if (part && text === part.repeat(length)) {
        text = part;
        break;
      }
    }
  }
  return text.slice(0, 120);
}

async function login() {
  needSelectors();
  const { launchBrowser } = await import("../web/browser.js");
  const context = await launchBrowser("doubao", { headless: false });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(config.home, { waitUntil: "domcontentloaded", timeout: 60000 });
    const startedAt = Date.now();
    let loggedIn = false;

    while (Date.now() - startedAt < 300000) {
      if (!isLoginPage(page.url(), config.home)) {
        try {
          const state = await isDoubaoLoggedIn(page);
          if (state.loggedIn) {
            loggedIn = true;
            break;
          }
        } catch {
          // 新账号可能还没有历史会话，继续等待登录完成。
        }
      }
      await page.waitForTimeout(2000);
    }

    if (!loggedIn) {
      return {
        ok: false,
        code: "LOGIN_TIMEOUT",
        message: "等待豆包登录超时。请重新点击“去绑定”。",
      };
    }
  } finally {
    await context.close().catch(() => {});
  }

  return { ok: true, message: "豆包绑定完成，登录态已保存。" };
}

async function list() {
  needSelectors();
  return withPage("doubao", { headless: true }, async (page) => {
    await page.goto(config.home, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
    await assertDoubaoLoggedIn(page);

    const items = await page.$$eval(
      config.selectors.conversationItem,
      (elements) => elements.map((element) => ({
        href: element.getAttribute("href") || "",
        title: (element.textContent || "").trim(),
      }))
    );

    const seen = new Set();
    const sessions = [];
    for (const item of items) {
      if (!/^\/chat\/\d+$/.test(item.href) || seen.has(item.href)) continue;
      seen.add(item.href);
      sessions.push({
        id: `web:${item.href}`,
        path: `web:${item.href}`,
        title: normalizeSidebarTitle(item.title),
        updatedAt: null,
        sizeBytes: null,
      });
    }
    if (!sessions.length) {
      await assertDoubaoLoggedIn(page);
    }
    return sessions;
  });
}

async function read(ref) {
  needSelectors();
  const href = ref.startsWith("web:") ? ref.slice(4) : ref;
  const url = href.startsWith("http") ? href : new URL(href, config.home).href;
  const conversationId = new URL(url).pathname.split("/").pop();

  return withPage("doubao", { headless: true }, async (page) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const scroller = page.locator(config.selectors.messageScroller).first();
    await scroller.waitFor({ state: "attached", timeout: 30000 });
    await page.waitForTimeout(5000);

    await assertDoubaoLoggedIn(page);

    const sidebarTitle = await page.evaluate((wantedHref) => {
      const anchor = [...document.querySelectorAll("a[href]")]
        .find((element) => element.getAttribute("href") === wantedHref);
      return anchor?.textContent?.trim() || "";
    }, href);

    const seen = new Map();
    let lastCount = -1;
    let stableRounds = 0;

    for (let round = 0; round < 400; round++) {
      const collected = await page.evaluate(() => {
        const results = [];
        const roots = [...document.querySelectorAll("[class*='v_list_row']")];

        function findMessage(root) {
          const ownKeys = Object.keys(root);
          const fiberKey = ownKeys.find((key) => key.startsWith("__reactFiber$"));
          if (!fiberKey) return null;
          const queue = [root[fiberKey]];
          let visited = 0;
          while (queue.length && visited < 500) {
            const current = queue.shift();
            visited++;
            if (!current) continue;
            const memo = current.memoizedProps;
            if (memo && typeof memo === "object" && memo.message?.message_id) {
              return memo.message;
            }
            queue.push(current.child, current.sibling);
          }
          return null;
        }

        for (const row of roots) {
          const message = findMessage(row);
          if (message?.message_id) results.push(message);
        }
        return results;
      });

      for (const message of collected) {
        if (!seen.has(message.message_id)) seen.set(message.message_id, message);
      }

      const state = await page.evaluate(() => {
        const element = document.querySelector("[class*='v_list_scroller']");
        if (!element) return { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
        return {
          scrollTop: element.scrollTop,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        };
      });

      if (seen.size === lastCount && state.scrollTop <= 1) {
        stableRounds++;
        if (stableRounds >= 5) break;
      } else {
        stableRounds = 0;
        lastCount = seen.size;
      }

      await scroller.evaluate((element) => {
        element.scrollTop = Math.max(0, element.scrollTop - 3000);
        element.dispatchEvent(new WheelEvent("wheel", {
          deltaY: -3000,
          bubbles: true,
          cancelable: true,
        }));
      });
      await page.waitForTimeout(700);
    }

    const rawMessages = [...seen.values()];
    if (!rawMessages.length) {
      throw new Error("豆包会话页没有抓到消息；React fiber 或虚拟列表结构可能已变化。");
    }
    rawMessages.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));

    function safeJsonParse(value) {
      try {
        return value ? JSON.parse(value) : {};
      } catch {
        return {};
      }
    }

    function blockToCanonical(block) {
      const content = block.content || {};
      const result = [];
      if (content.text_block?.text) {
        result.push({ type: "text", text: content.text_block.text });
      }
      if (content.attachment_block) {
        const attachments = content.attachment_block.attachments || [];
        if (attachments.length) {
          for (const attachment of attachments) {
            const image = attachment.image || {};
            const url = image.image_ori?.url || image.image_thumb?.url || image.image_preview?.url || attachment.src;
            result.push({
              type: "attachment",
              name: image.name || `豆包附件-${attachment.identifier || result.length + 1}`,
              mediaType: attachment.type === 1 ? "image" : (attachment.mime_type || "file"),
              ref: { type: url ? "url" : "unknown", url, raw: attachment },
            });
          }
        } else {
          result.push({
            type: "attachment",
            name: content.attachment_block.file_name || content.attachment_block.display_name || "attachment",
            mediaType: content.attachment_block.mime_type || content.attachment_block.file_type || "unknown",
            ref: content.attachment_block,
          });
        }
      }
      if (content.image_block?.image_url || content.image_block?.url) {
        result.push({
          type: "attachment",
          name: "image",
          mediaType: "image",
          ref: content.image_block,
        });
      }
      if (content.search_query_result_block) {
        result.push({
          type: "text",
          text: "[豆包搜索结果块：结构化内容已保留在 rawEvents 引用中]",
        });
      }
      return result;
    }

    const messages = rawMessages.map((message) => {
      const blocks = (message.content_block || []).flatMap(blockToCanonical);
      if (!blocks.length) {
        const parsed = safeJsonParse(message.content || message.display_content);
        if (parsed.text) blocks.push({ type: "text", text: parsed.text });
      }
      if (!blocks.length && message.brief) {
        blocks.push({ type: "text", text: message.brief });
      }

      const seconds = Number(message.create_time || 0);
      const timestamp = seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined;

      return {
        id: message.message_id,
        role: message.user_type === 1 ? "user" : "assistant",
        timestamp,
        channel: "main",
        blocks,
      };
    }).filter((message) => message.blocks.length);

    const firstUser = messages.find((message) => message.role === "user");
    const title = normalizeSidebarTitle(sidebarTitle || firstUser?.blocks.find((block) => block.type === "text")?.text || "(无标题)");

    return createHistory({
      sourceApp: "doubao",
      sourceKind: "web",
      sourceSessionId: conversationId,
      sourcePath: `web:${href}`,
      title,
      rawFormat: "doubao-dom-fiber",
      sourceExtra: {
        url,
        captureMethod: "virtual-list-react-fiber",
        rawMessageCount: rawMessages.length,
      },
      environment: {
        url,
        captureMethod: "virtual-list-react-fiber",
      },
      rawEvents: rawMessages,
      messages,
    });
  });
}

export const doubaoSource = {
  name: "doubao",
  displayName: "豆包",
  kind: "web",
  root: null,
  supportsLogin: true,
  detectStatus() {
    return {
      kind: "web",
      installed: true,
      requiresLogin: true,
      loggedIn: "unknown",
      detail: "需要绑定豆包网页账号后才能读取服务器历史。",
    };
  },
  login,
  list,
  read,
};
