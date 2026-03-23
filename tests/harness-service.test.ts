import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createHarnessApp } from "../src/app/create-harness-app.js";
import type { ProviderAdapter } from "../src/providers/base.js";
import { MockProvider } from "../src/providers/mock-provider.js";
import { MemoryHarnessStateStore } from "../src/storage/memory-state-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTestApp(
  providers?: Record<"codex" | "claude", ProviderAdapter>,
) {
  const store = new MemoryHarnessStateStore();
  return createHarnessApp(
    {
      port: 0,
      stateFile: "/tmp/unused.json",
      defaultProvider: "codex",
      liveProviders: false,
      codexCommand: "codex",
      codexTimeoutMs: 1_000,
      codexSandbox: "workspace-write",
      codexApproval: "never",
      claudeCommand: "claude",
      claudeTimeoutMs: 1_000,
      claudePermissionMode: "default",
    },
    store,
    providers ?? {
      codex: new MockProvider("codex"),
      claude: new MockProvider("claude"),
    },
  );
}

class DeferredProvider implements ProviderAdapter {
  readonly calls: string[] = [];
  readonly pending: Array<() => void> = [];

  constructor(public readonly id: "codex" | "claude") {}

  async runTurn(input: { message: string }): Promise<{ text: string }> {
    this.calls.push(input.message);
    return new Promise((resolve) => {
      this.pending.push(() => resolve({ text: `[${this.id}] ${input.message}` }));
    });
  }

  resolveNext(): void {
    const next = this.pending.shift();
    if (!next) {
      throw new Error("No pending provider turn to resolve.");
    }
    next();
  }
}

async function createTempWorkspace(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition.");
}

describe("HarnessService", () => {
  it("tracks multiple sessions per workspace and allows switching", async () => {
    const app = createTestApp();

    await app.service.registerWorkspace({
      slug: "taskvision",
      rootPath: "/Users/a-znk/code/taskvision",
    });

    await app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:1",
      text: "/workspace use taskvision",
    });
    await app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:1",
      text: "/session new refactor-homepage",
    });
    await app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:1",
      text: "inspect the homepage flow",
    });
    await app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:1",
      text: "/session new bugfix-auth",
    });

    const switched = await app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:1",
      text: "/session use refactor-homepage",
    });

    expect(switched.messages[0]?.text).toContain("refactor-homepage");

    const listed = await app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:1",
      text: "/session list",
    });

    expect(listed.messages[0]?.text).toContain("refactor-homepage [current]");
    expect(listed.messages[0]?.text).toContain("bugfix-auth");
  });

  it("keeps codex and claude current sessions separate in the same binding", async () => {
    const app = createTestApp();

    await app.service.registerWorkspace({
      slug: "blog",
      rootPath: "/Users/a-znk/code/myblog",
    });

    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/workspace use blog",
    });
    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session new codex-main",
    });
    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/provider use claude",
    });
    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session new claude-review",
    });

    const status = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/status",
    });

    expect(status.messages[0]?.text).toContain("codex-main");
    expect(status.messages[0]?.text).toContain("claude-review");
  });

  it("creates scoped bindings independently for different channel contexts", async () => {
    const app = createTestApp();

    await app.service.registerWorkspace({
      slug: "agdi",
      rootPath: "/Users/a-znk/code/AGDI",
    });

    await app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:42",
      text: "/workspace use agdi",
    });
    await app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:42",
      text: "/session new main-thread",
    });

    const isolated = await app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:42:topic:9",
      text: "/status",
    });

    expect(isolated.messages[0]?.text).toContain("Workspace: <none>");
  });

  it("serializes turns within the same binding", async () => {
    const codex = new DeferredProvider("codex");
    const app = createTestApp({
      codex,
      claude: new MockProvider("claude"),
    });

    await app.service.registerWorkspace({
      slug: "taskvision",
      rootPath: "/Users/a-znk/code/taskvision",
    });
    await app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:1",
      text: "/workspace use taskvision",
    });

    const first = app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:1",
      text: "first turn",
    });
    const second = app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:1",
      text: "second turn",
    });

    await waitFor(() => codex.calls.length === 1);
    expect(codex.calls).toEqual(["first turn"]);

    codex.resolveNext();
    await first;
    await waitFor(() => codex.calls.length === 2);

    expect(codex.calls).toEqual(["first turn", "second turn"]);

    codex.resolveNext();
    await second;
  });

  it("runs different bindings in parallel", async () => {
    const codex = new DeferredProvider("codex");
    const app = createTestApp({
      codex,
      claude: new MockProvider("claude"),
    });

    await app.service.registerWorkspace({
      slug: "taskvision",
      rootPath: "/Users/a-znk/code/taskvision",
    });
    await app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:1",
      text: "/workspace use taskvision",
    });
    await app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:2",
      text: "/workspace use taskvision",
    });

    const first = app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:1",
      text: "first binding turn",
    });
    const second = app.handleMessage({
      channel: "telegram",
      scopeKey: "chat:2",
      text: "second binding turn",
    });

    await waitFor(() => codex.calls.length === 2);
    expect(codex.calls).toEqual(["first binding turn", "second binding turn"]);

    codex.resolveNext();
    codex.resolveNext();

    await Promise.all([first, second]);
  });

  it("imports workspaces from chat commands and reuses existing paths", async () => {
    const app = createTestApp();
    const workspaceDir = await createTempWorkspace("harness-import-");

    const imported = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: `/workspace import ${workspaceDir}`,
    });

    expect(imported.messages[0]?.text).toContain("Imported workspace");

    const importedAgain = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: `/workspace import ${workspaceDir}`,
    });

    expect(importedAgain.messages[0]?.text).toContain("already registered");

    const snapshot = await app.service.getStateSnapshot();
    expect(snapshot.workspaces).toHaveLength(1);
    expect(snapshot.bindings[0]?.workspaceId).toBe(snapshot.workspaces[0]?.id);
  });

  it("supports wechat-style Chinese command aliases and preserves reply context", async () => {
    const app = createTestApp();
    const workspaceDir = await createTempWorkspace("harness-cn-");

    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: `导入项目 ${workspaceDir}`,
      replyContext: {
        channel: "wechat",
        senderId: "alice@im.wechat",
        conversationId: "thread-1",
        contextToken: "ctx-1",
      },
    });

    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "切换模型 claude",
    });

    const created = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "新建会话 审阅计划",
    });

    expect(created.messages[0]?.text).toContain("审阅计划");
    expect(created.messages[0]?.replyContext).toMatchObject({
      channel: "wechat",
      contextToken: "ctx-1",
    });

    const sessions = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "会话列表",
    });

    expect(sessions.messages[0]?.text).toContain("claude/审阅计划");
  });
});
