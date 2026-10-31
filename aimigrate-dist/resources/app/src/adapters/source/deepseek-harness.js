import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHistory } from "../../core/history.js";

const APP_DATA_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "@deepseek-ai", "dsh-desktop"
);

function isInstalled() {
  return fs.existsSync(APP_DATA_DIR);
}

async function list() {
  if (!isInstalled()) {
    throw new Error("DeepSeek Harness 桌面版未安装或未找到数据目录。");
  }
  // DeepSeek desktop (dsh-desktop) is an Electron app that primarily
  // syncs conversation history from the cloud. Local storage only has
  // session tokens and UI state. For now, list is empty.
  // Future: integrate with the dsh-desktop IPC/local API if available.
  return [];
}

async function read(ref) {
  throw new Error("DeepSeek Harness 桌面版聊天记录暂不支持本地读取。对话历史保存在 DeepSeek 云端。");
}

export const deepseekHarnessSource = {
  name: "deepseek-harness",
  displayName: "DeepSeek Harness",
  kind: "agent",
  detectStatus() {
    return {
      kind: "agent",
      installed: isInstalled(),
      detail: isInstalled()
        ? "DeepSeek Harness 已安装；当前版本聊天记录保存在云端，暂不支持本地读取。"
        : "未检测到 DeepSeek Harness 桌面版。请先下载安装。",
    };
  },
  list,
  read,
};
