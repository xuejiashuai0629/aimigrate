import { loadSiteConfig, withPage } from "../web/browser.js";

const config = loadSiteConfig("doubao");

async function sendSummary(history, summary, options = {}) {
  return withPage("doubao", { headless: options.headless !== false }, async (page) => {
    await page.goto(config.home, { waitUntil: "domcontentloaded", timeout: 60000 });
    const input = page.locator(config.selectors.input).first();
    await input.waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(2000);

    await input.click();
    // Count existing message bubbles BEFORE sending (new chat = 0).
    const beforeCount = await page.locator("[class*='message'], [class*='content_item'], [class*='chat-item']").count();

    await page.keyboard.insertText(summary.markdown);

    // Verify text was actually inserted into the contenteditable input.
    const inserted = await input.textContent();
    if (!inserted || inserted.trim().length < 10) {
      throw new Error("摘要文本未能写入豆包输入框，未发送任何消息。");
    }

    // Small delay to let the UI enable the send button.
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");

    // Wait for a NEW user message bubble to appear.
    try {
      await page.waitForFunction(
        ({ prev }) => document.querySelectorAll("[class*='message'], [class*='content_item'], [class*='chat-item']").length > prev,
        { prev: beforeCount },
        { timeout: 30000 }
      );
    } catch {
      const afterCount = await page.locator("[class*='message'], [class*='content_item'], [class*='chat-item']").count();
      throw new Error(
        `豆包消息发送确认失败（发送前 ${beforeCount} 条，发送后 ${afterCount} 条）。消息未实际发出，请勿重复发送。`
      );
    }

    return {
      ok: true,
      sent: true,
      targetApp: "doubao",
      summaryMode: summary.mode,
      summaryEstimatedTokens: summary.estimatedTokens || null,
      url: page.url(),
      confirmation: "豆包新会话已创建并检测到发送消息。",
    };
  });
}

export const doubaoTarget = {
  name: "doubao",
  displayName: "豆包",
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
      detail: "需要绑定豆包网页账号后才能发送摘要。",
    };
  },
  sendSummary,
};
