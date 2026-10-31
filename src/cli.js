#!/usr/bin/env node
import fs from "node:fs/promises";
import process from "node:process";
import { getSourceAdapter, sourceAdapters } from "./adapters/source/index.js";
import { getTargetAdapter, targetAdapters } from "./adapters/target/index.js";
import { planRoutes } from "./core/route-planner.js";
import { createOfflineSummary } from "./core/summary/extractive.js";
import { createAbstractiveSummary } from "./core/summary/abstractive.js";
import { saveHandoffArchive } from "./core/archive.js";

function usage() {
  console.log(`aimigrate-next CLI

Usage:
  node src/cli.js sources
  node src/cli.js targets
  node src/cli.js list --source <codex|claude-code>
  node src/cli.js login --source <deepseek>
  node src/cli.js read --source <source> --path <session-file> [--out <file>]
  node src/cli.js plan --source <source> --target <target> --path <session-file>
  node src/cli.js import --source <source> --target claude-code --path <session-file> [--cwd <dir>] [--execute] [--overwrite]
  node src/cli.js summary --source <source> --path <session-file> [--api] [--api-base <url>] [--api-key <key>] [--api-model <model>]
  node src/cli.js export --source <source> --path <session-file>
  node src/cli.js import --source <source> --target codex --path <session-file> [--cwd <dir>] [--execute] [--overwrite] [--update-index]
  node src/cli.js gui
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--source") args.source = argv[++i];
    else if (arg === "--target") args.target = argv[++i];
    else if (arg === "--path") args.path = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--target-root") args.targetRoot = argv[++i];
    else if (arg === "--execute") args.execute = true;
    else if (arg === "--overwrite") args.overwrite = true;
    else if (arg === "--update-index") args.updateIndex = true;
    else if (arg === "--api") args.api = true;
    else if (arg === "--api-base") args.apiBase = argv[++i];
    else if (arg === "--api-key") args.apiKey = argv[++i];
    else if (arg === "--api-model") args.apiModel = argv[++i];
    else if (arg === "--out-dir") args.outDir = argv[++i];
    else args._.push(arg);
  }
  return args;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }

  if (command === "sources") {
    console.log(JSON.stringify([...sourceAdapters.values()].map((adapter) => ({
      name: adapter.name,
      displayName: adapter.displayName,
      kind: adapter.kind,
      status: ["deepseek", "doubao"].includes(adapter.name) ? "read-only/experimental" : "read-only",
    })), null, 2));
    return;
  }

  if (command === "targets") {
    console.log(JSON.stringify([...targetAdapters.values()].map((adapter) => ({
      name: adapter.name,
      displayName: adapter.displayName,
      kind: adapter.kind,
      write: adapter.write,
      status: adapter.detectStatus?.() || null,
    })), null, 2));
    return;
  }

  if (command === "list") {
    if (!args.source) throw new Error("缺少 --source");
    const adapter = getSourceAdapter(args.source);
    console.log(JSON.stringify(await adapter.list(), null, 2));
    return;
  }

  if (command === "login") {
    if (!args.source) throw new Error("缺少 --source");
    const adapter = getSourceAdapter(args.source);
    if (typeof adapter.login !== "function") {
      throw new Error(`适配器 ${args.source} 不需要或暂不支持登录命令`);
    }
    console.log(JSON.stringify(await adapter.login(), null, 2));
    return;
  }

  if (command === "read") {
    if (!args.source || !args.path) throw new Error("缺少 --source 或 --path");
    const adapter = getSourceAdapter(args.source);
    const history = await adapter.read(args.path);
    const json = JSON.stringify(history, null, 2);
    if (args.out) await fs.writeFile(args.out, json, "utf8");
    else console.log(json);
    return;
  }

  if (command === "plan") {
    if (!args.source || !args.target || !args.path) {
      throw new Error("缺少 --source、--target 或 --path");
    }
    const adapter = getSourceAdapter(args.source);
    const history = await adapter.read(args.path);
    console.log(JSON.stringify(planRoutes({
      sourceApp: args.source,
      targetApp: args.target,
      history,
    }), null, 2));
    return;
  }

  if (command === "gui") {
    await import("../apps/gui/server.js");
    return;
  }

  if (command === "summary") {
    if (!args.source || !args.path) throw new Error("缺少 --source 或 --path");
    const history = await getSourceAdapter(args.source).read(args.path);
    const summary = args.api
      ? await createAbstractiveSummary(history, {
        apiBaseUrl: args.apiBase,
        apiKey: args.apiKey,
        summaryModel: args.apiModel,
      })
      : createOfflineSummary(history);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (command === "export") {
    if (!args.source || !args.path) throw new Error("缺少 --source 或 --path");
    const history = await getSourceAdapter(args.source).read(args.path);
    const summary = createOfflineSummary(history);
    const files = saveHandoffArchive(history, summary, args.outDir);
    console.log(JSON.stringify({ ok: true, ...files }, null, 2));
    return;
  }

  if (command === "import") {
    if (!args.source || !args.target || !args.path) {
      throw new Error("缺少 --source、--target 或 --path");
    }
    const source = getSourceAdapter(args.source);
    const target = getTargetAdapter(args.target);
    const history = await source.read(args.path);
    const options = {
      cwd: args.cwd,
      targetRoot: args.targetRoot,
      overwrite: args.overwrite,
      updateIndex: args.updateIndex,
    };
    const result = args.execute
      ? target.importNative(history, options)
      : target.dryRun(history, options);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`未知命令：${command}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
