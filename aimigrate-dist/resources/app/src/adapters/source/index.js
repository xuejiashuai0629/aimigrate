import { codexSource } from "./codex.js";
import { claudeCodeSource } from "./claude-code.js";
import { deepseekSource } from "./deepseek.js";
import { doubaoSource } from "./doubao.js";
import { cursorSource } from "./cursor.js";
import { doubaoWorkSource } from "./doubao-work.js";
import { deepseekHarnessSource } from "./deepseek-harness.js";
import { workbuddySource } from "./workbuddy.js";

export const sourceAdapters = new Map([
  [codexSource.name, codexSource],
  [claudeCodeSource.name, claudeCodeSource],
  [deepseekSource.name, deepseekSource],
  [doubaoSource.name, doubaoSource],
  [cursorSource.name, cursorSource],
  [doubaoWorkSource.name, doubaoWorkSource],
  [deepseekHarnessSource.name, deepseekHarnessSource],
  [workbuddySource.name, workbuddySource],
]);

export function getSourceAdapter(name) {
  const adapter = sourceAdapters.get(name);
  if (!adapter) {
    throw new Error(`源适配器未实现或不存在：${name}`);
  }
  return adapter;
}
