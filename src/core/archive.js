import fs from "node:fs";
import path from "node:path";

export function saveHandoffArchive(history, summary, outputDir = path.join(process.cwd(), ".aimigrate", "exports")) {
  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${history.source.app}-${stamp}`;
  const fullPath = path.join(outputDir, `${base}-full.json`);
  const markdownPath = path.join(outputDir, `${base}-summary.md`);
  fs.writeFileSync(fullPath, JSON.stringify({ ...history, summary }, null, 2), "utf8");
  fs.writeFileSync(markdownPath, summary.markdown, "utf8");
  return { fullPath, markdownPath };
}
