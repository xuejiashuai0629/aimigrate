import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHistory } from "../../core/history.js";

const APP_DIR = path.join(os.homedir(), ".workbuddy");

function isInstalled() {
  return fs.existsSync(APP_DIR);
}

async function list() {
  if (!isInstalled()) {
    throw new Error("WorkBuddy 未安装或未找到数据目录。");
  }
  // WorkBuddy stores conversations in the cloud. The local SQLite
  // (workbuddy.db) has schema but 0 sessions. The memory directory has
  // long-term memory markdown but not chat transcripts.
  // Future: integrate with WorkBuddy cloud API or IndexedDB.
  return [];
}

async function read(ref) {
  throw new Error("WorkBuddy 聊天记录暂不支持本地读取。对话历史保存在 WorkBuddy 云端。");
}

export const workbuddySource = {
  name: "workbuddy",
  displayName: "WorkBuddy",
  kind: "agent",
  detectStatus() {
    return {
      kind: "agent",
      installed: isInstalled(),
      detail: isInstalled()
        ? "WorkBuddy 已安装；当前版本聊天记录保存在云端，暂不支持本地读取。"
        : "未检测到 WorkBuddy。请先下载安装 WorkBuddy。",
    };
  },
  list,
  read,
};
