import { describe, expect, it } from "vitest";

import { parseHarnessCommand } from "../src/core/command-parser.js";

describe("parseHarnessCommand", () => {
  it("requires slash-prefixed commands", () => {
    expect(parseHarnessCommand("状态")).toBeNull();
    expect(parseHarnessCommand("导入项目 /tmp/demo")).toBeNull();
    expect(parseHarnessCommand("/状态")).toEqual({ name: "status" });
    expect(parseHarnessCommand("/导入项目 /tmp/demo")).toEqual({
      name: "workspace",
      action: "import",
      pathText: "/tmp/demo",
    });
  });

  it("shows help for slash root and command aliases", () => {
    expect(parseHarnessCommand("/")).toEqual({ name: "help" });
    expect(parseHarnessCommand("/help")).toEqual({ name: "help" });
    expect(parseHarnessCommand("/commands")).toEqual({ name: "help" });
    expect(parseHarnessCommand("/帮助")).toEqual({ name: "help" });
    expect(parseHarnessCommand("/命令列表")).toEqual({ name: "help" });
    expect(parseHarnessCommand("/当前会话详情")).toEqual({
      name: "session",
      action: "current",
    });
    expect(parseHarnessCommand("/会话历史 3")).toEqual({
      name: "session",
      action: "history",
      limit: 3,
    });
  });

  it("returns explicit invalid-command feedback for malformed slash commands", () => {
    expect(parseHarnessCommand("/workspace nope")).toEqual({
      name: "invalid",
      message: [
        "Unknown workspace command.",
        "Usage:",
        "/workspace list",
        "/workspace use <slug>",
        "/workspace import <path>",
      ].join("\n"),
    });
    expect(parseHarnessCommand("/workspace use")).toEqual({
      name: "invalid",
      message: "Usage: /workspace use <slug>",
    });
    expect(parseHarnessCommand("/session attach codex")).toEqual({
      name: "invalid",
      message: "Usage: /session attach <codex|claude> <native-id> [name]",
    });
    expect(parseHarnessCommand("/session history nope")).toEqual({
      name: "invalid",
      message: "Usage: /session history [count]",
    });
    expect(parseHarnessCommand("/session history 0")).toEqual({
      name: "invalid",
      message: "History count must be between 1 and 20.",
    });
    expect(parseHarnessCommand("/wat")).toEqual({
      name: "invalid",
      message: "Unknown command: /wat\nUse / or /help to list commands.",
    });
  });
});
