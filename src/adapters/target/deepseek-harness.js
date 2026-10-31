export const deepseekHarnessTarget = {
  name: "deepseek-harness",
  displayName: "DeepSeek Harness",
  kind: "agent",
  contextWindowTokens: 128000,
  write: {
    native: { status: "planned" },
    transcript: { status: "planned" },
    summary: { status: "planned" },
  },
  detectStatus() {
    return {
      kind: "agent",
      installed: true,
      requiresLogin: false,
      loggedIn: true,
      detail: "DeepSeek Harness 目标端写入尚未实现。",
    };
  },
};
