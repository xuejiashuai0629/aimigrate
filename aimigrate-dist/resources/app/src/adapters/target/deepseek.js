import { loadSiteConfig, withPage } from "../web/browser.js";

const config = loadSiteConfig("deepseek");

async function sendSummary(history, summary, options = {}) {
  return withPage("deepseek", { headless: options.headless !== false }, async (page) => {
    await page.goto(config.home, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(config.selectors.input, { timeout: 30000 });
    await page.waitForTimeout(2000);

    const input = page.locator(config.selectors.input).first();
    await input.click();
    // Count messages BEFORE sending (should be 0 on a fresh new chat).
    const beforeCount = await page.locator(config.selectors.messageItem).count();

    await input.fill(summary.markdown);

    // Verify the text was actually written into the input.
    const inserted = await input.inputValue();
    if (!inserted || inserted.trim().length < 10) {
      throw new Error("摘要文本未能写入 DeepSeek 输入框，未发送任何消息。");
    }

    await page.keyboard.press("Enter");

    // Wait for the user's message to actually appear in the conversation.
    try {
      await page.waitForFunction(
        ({ sel, prev }) => document.querySelectorAll(sel).length > prev,
        { sel: config.selectors.messageItem, prev: beforeCount },
        { timeout: 30000 }
      );
    } catch {
      const afterCount = await page.locator(config.selectors.messageItem).count();
      throw new Error(
        `DeepSeek 消息发送确认失败（发送前 ${beforeCount} 条，发送后 ${afterCount} 条）。消息未实际发出，请勿重复发送。`
      );
    }

    return {
      ok: true,
      sent: true,
      targetApp: "deepseek",
      summaryMode: summary.mode,
      summaryEstimatedTokens: summary.estimatedTokens || null,
      url: page.url(),
      confirmation: "DeepSeek 新会话已创建并检测到消息。",
    };
  });
}

export const deepseekTarget = {
  name: "deepseek",
  displayName: "DeepSeek",
  kind: "web",
  contextWindowTokens: 128000,
  write: {
    native: { status: "unsupported" },
    transcript: { status: "planned" },
    summary: { status: "experimental" },
  },
  detectStatus() {
    return {
      kind: "web",
      installed: true,
      requiresLogin: true,
      loggedIn: "unknown",
      detail: "需要绑定 DeepSeek 网页账号后才能发送摘要。",
    };
  },
  sendSummary,
};
