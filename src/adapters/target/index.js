import { claudeCodeTarget } from "./claude-code.js";
import { codexTarget } from "./codex.js";
import { deepseekTarget } from "./deepseek.js";
import { doubaoTarget } from "./doubao.js";
import { cursorTarget } from "./cursor.js";
import { doubaoWorkTarget } from "./doubao-work.js";
import { deepseekHarnessTarget } from "./deepseek-harness.js";
import { workbuddyTarget } from "./workbuddy.js";

export const targetAdapters = new Map([
  [codexTarget.name, codexTarget],
  [claudeCodeTarget.name, claudeCodeTarget],
  [deepseekTarget.name, deepseekTarget],
  [doubaoTarget.name, doubaoTarget],
  [cursorTarget.name, cursorTarget],
  [doubaoWorkTarget.name, doubaoWorkTarget],
  [deepseekHarnessTarget.name, deepseekHarnessTarget],
  [workbuddyTarget.name, workbuddyTarget],
]);

export function getTargetAdapter(name) {
  const adapter = targetAdapters.get(name);
  if (!adapter) {
    throw new Error(`目标适配器未实现或不存在：${name}`);
  }
  return adapter;
}
