import fs from "node:fs";
import path from "node:path";

export function createMigrationReport(input) {
  const history = input.history;
  const result = input.result;
  const warnings = result?.warnings || [];
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    migrationLevel: input.migrationLevel,
    mode: input.mode,
    sourceApp: history?.source?.app || input.sourceApp,
    targetApp: result?.targetApp || input.targetApp,
    sourceSessionId: history?.source?.sessionId,
    targetSessionId: result?.sessionId,
    title: history?.source?.title || result?.title,
    migrationTokenCost: 0,
    sourceStats: history?.stats || input.sourceStats,
    targetPath: result?.targetPath,
    verification: result?.verification,
    index: result?.index,
    threadHistory: result?.threadHistory,
    warnings,
    archiveFiles: result?.archiveFiles || null,
    activeWindow: result?.activeWindow || null,
    reportFiles: result?.reportFiles || null,
    success: Boolean(result?.ok),
  };

  report.markdown = [
    `# aimigrate 迁移报告`,
    "",
    `- 迁移等级：${report.migrationLevel}`,
    `- 模式：${report.mode}`,
    `- 来源：${report.sourceApp}`,
    `- 目标：${report.targetApp}`,
    `- 标题：${report.title}`,
    `- 消息数：${report.sourceStats?.messageCount ?? "unknown"}`,
    `- 工具调用：${report.sourceStats?.toolCallCount ?? 0}`,
    `- 工具结果：${report.sourceStats?.toolResultCount ?? 0}`,
    `- 附件：${report.sourceStats?.attachmentCount ?? 0}`,
    `- 迁移 token：0`,
    `- 状态：${report.success ? "成功" : "失败"}`,
    "",
    "## 目标文件",
    "",
    report.targetPath || "(无)",
    "",
    "## 校验",
    "",
    "```json",
    JSON.stringify(report.verification || {}, null, 2),
    "```",
    "",
    "## 风险与降级",
    "",
    warnings.length ? warnings.map((warning) => `- ${warning}`).join("\n") : "- 无额外警告",
    "",
    ...(report.activeWindow ? [
      "## Active Window",
      "",
      `- 活跃窗口消息数：${report.activeWindow.messageCount}`,
      `- 完整归档：${report.archiveFiles?.fullPath || "(未保存)"}`,
      `- 摘要文件：${report.archiveFiles?.markdownPath || "(未保存)"}`,
      "",
    ] : []),
  ].join("\n");

  return report;
}

export function saveMigrationReport(report, outputDir = path.join(process.cwd(), ".aimigrate", "reports")) {
  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${report.sourceApp}-to-${report.targetApp}-${stamp}`;
  const jsonPath = path.join(outputDir, `${base}.json`);
  const markdownPath = path.join(outputDir, `${base}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(markdownPath, report.markdown, "utf8");
  return { jsonPath, markdownPath };
}
