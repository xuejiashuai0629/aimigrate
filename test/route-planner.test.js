import test from "node:test";
import assert from "node:assert/strict";
import { planRoutes } from "../src/core/route-planner.js";

function history(kind, tokens = 1000) {
  return {
    schemaVersion: 1,
    source: { app: "x", kind, sessionId: "s", path: "p", title: "t", rawFormat: "x" },
    messages: [],
    stats: {
      messageCount: 0,
      textCharacterCount: 0,
      estimatedTokens: tokens,
      toolCallCount: 0,
      toolResultCount: 0,
    },
  };
}

test("agent to agent defaults to L3 native when context is short", () => {
  const plan = planRoutes({
    sourceApp: "codex",
    targetApp: "claude-code",
    history: history("agent", 10000),
  });

  assert.equal(plan.recommendation.level, 3);
  assert.equal(plan.recommendation.mode, "native");
  assert.equal(plan.activeWindowRecommended, false);
  assert.ok(plan.routes.some((route) => route.level === 3 && route.mode === "native"));
  assert.equal(plan.routes.find((route) => route.level === 3 && route.mode === "native").status, "experimental");
  assert.ok(plan.routes.some((route) => route.mode === "archive-active-window" && route.status === "experimental"));
  assert.ok(plan.routes.some((route) => route.level === 1 && route.mode === "summary"));
});

test("agent to agent recommends archive plus active window when context is long", () => {
  const plan = planRoutes({
    sourceApp: "codex",
    targetApp: "claude-code",
    history: history("agent", 180000),
  });

  assert.equal(plan.recommendation.level, 2);
  assert.equal(plan.recommendation.mode, "archive-active-window");
  assert.equal(plan.activeWindowRecommended, true);
});

test("web to agent defaults to L2 transcript when context is short", () => {
  const plan = planRoutes({
    sourceApp: "deepseek",
    targetApp: "claude-code",
    history: history("web", 10000),
  });

  assert.equal(plan.recommendation.level, 2);
  assert.equal(plan.recommendation.mode, "transcript");
  assert.ok(plan.routes.some((route) => route.mode === "archive-active-window" && route.status === "experimental"));
  assert.ok(plan.routes.some((route) => route.level === 1 && route.mode === "summary"));
});

test("agent to web defaults to L1 summary", () => {
  const plan = planRoutes({
    sourceApp: "claude-code",
    targetApp: "doubao",
    history: history("agent", 10000),
  });

  assert.equal(plan.recommendation.level, 1);
  assert.equal(plan.recommendation.mode, "summary");
});

test("web to web defaults to L1 summary", () => {
  const plan = planRoutes({
    sourceApp: "deepseek",
    targetApp: "doubao",
    history: history("web", 10000),
  });

  assert.equal(plan.recommendation.level, 1);
  assert.equal(plan.recommendation.mode, "summary");
});
