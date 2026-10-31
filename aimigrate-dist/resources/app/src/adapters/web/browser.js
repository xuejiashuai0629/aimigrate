import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_PROFILE_ROOT = path.join(os.homedir(), ".aimigrate-next", "browser");
const APP_PROFILE_ROOT = process.env.AIMIGRATE_PROFILE_ROOT || DEFAULT_PROFILE_ROOT;

export function profileDir(siteName) {
  const dir = path.join(APP_PROFILE_ROOT, siteName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function loadPlaywright() {
  const override = process.env.AIMIGRATE_PLAYWRIGHT_PATH;
  if (override) {
    try {
      return await import(pathToFileURL(override).href);
    } catch (error) {
      throw new Error(`无法加载 AIMIGRATE_PLAYWRIGHT_PATH 指定的 playwright-core：${error.message}`);
    }
  }

  try {
    return await import("playwright-core");
  } catch {
    throw new Error("缺少 playwright-core。请在 aimigrate-next 目录执行：npm install playwright-core");
  }
}

export async function launchBrowser(siteName, { headless = true } = {}) {
  const { chromium } = await loadPlaywright();
  return chromium.launchPersistentContext(profileDir(siteName), {
    channel: process.env.AIMIGRATE_BROWSER_CHANNEL || "msedge",
    headless,
    viewport: { width: 1400, height: 900 },
  });
}

// Serialize browser access per site profile to avoid launchPersistentContext
// profile-lock errors when operations overlap (e.g. after a migration).
const browserLocks = new Map();

async function withLock(key, fn) {
  const prev = browserLocks.get(key) || Promise.resolve();
  let release;
  const lock = new Promise((resolve) => { release = resolve; });
  browserLocks.set(key, prev.then(() => lock));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function withPage(siteName, options, callback) {
  return withLock(siteName, async () => {
    const context = await launchBrowser(siteName, options);
    try {
      const page = context.pages()[0] || await context.newPage();
      return await callback(page);
    } finally {
      await context.close().catch(() => {});
      // Small delay to allow OS to release the profile lock.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  });
}

const LOGIN_PATH_RE = /(^|\/)(sign[-_]?in|log[-_]?in|signin|auth|passport|accounts|oauth)(\/|$|\.|\?)/i;

export function isLoginPage(url, home) {
  if (!url || !home) return false;
  let current;
  let expected;
  try {
    current = new URL(url);
    expected = new URL(home);
  } catch {
    return false;
  }
  return current.host !== expected.host || LOGIN_PATH_RE.test(current.pathname);
}

export function loadSiteConfig(siteName) {
  const filePath = new URL(`../../../config/sites/${siteName}.json`, import.meta.url);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
