export const cursorTarget = {
  name: "cursor",
  displayName: "Cursor",
  kind: "agent",
  contextWindowTokens: 200000,
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
      detail: "Cursor 目标端写入尚未实现。",
    };
  },
};
