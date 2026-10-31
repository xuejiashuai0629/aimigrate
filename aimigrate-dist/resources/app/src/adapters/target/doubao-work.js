export const doubaoWorkTarget = {
  name: "doubao-work",
  displayName: "豆包工作版",
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
      detail: "豆包工作版目标端写入尚未实现。",
    };
  },
};
