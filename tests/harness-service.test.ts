import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createHarnessApp } from "../src/app/create-harness-app.js";
import { ConfigAuthorizer } from "../src/auth/config-authorizer.js";
import type { NativeSessionCatalog, NativeSessionSummary } from "../src/native/types.js";
import type { ProviderAdapter } from "../src/providers/base.js";
import { MockProvider } from "../src/providers/mock-provider.js";
import { MemoryHarnessStateStore } from "../src/storage/memory-state-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTestApp(
  providers?: Record<"codex" | "claude", ProviderAdapter>,
  nativeCatalogs?: Partial<Record<"codex" | "claude", NativeSessionCatalog>>,
  authorizer?: ConstructorParameters<typeof ConfigAuthorizer>[0],
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
    nativeCatalogs,
    authorizer ? new ConfigAuthorizer(authorizer) : undefined,
  );
}

class StaticCatalog implements NativeSessionCatalog {
  constructor(
    public readonly provider: "codex" | "claude",
    private readonly sessions: NativeSessionSummary[],
  ) {}

  async listAll(): Promise<NativeSessionSummary[]> {
    return this.sessions.filter((session) => session.provider === this.provider);
  }

  async listForWorkspace(rootPath: string): Promise<NativeSessionSummary[]> {
    return this.sessions.filter(
      (session) =>
        session.provider === this.provider &&
        (session.cwd === rootPath || session.cwd.startsWith(`${rootPath}/`)),
    );
  }

  async findById(nativeSessionId: string): Promise<NativeSessionSummary | undefined> {
    return this.sessions.find(
      (session) =>
        session.provider === this.provider && session.nativeSessionId === nativeSessionId,
    );
  }
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

  it("attaches an existing native provider session to the current workspace", async () => {
    const app = createTestApp();

    await app.service.registerWorkspace({
      slug: "taskvision",
      rootPath: "/Users/a-znk/code/taskvision",
    });
    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/workspace use taskvision",
    });

    const attached = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session attach codex thread_123 imported-session",
    });

    expect(attached.messages[0]?.text).toContain("Attached codex session");
    expect(attached.messages[0]?.text).toContain("imported-session");

    const snapshot = await app.service.getStateSnapshot();
    const session = snapshot.sessions.find((item) => item.name === "imported-session");

    expect(session).toMatchObject({
      provider: "codex",
      providerSessionId: "thread_123",
      workspaceId: snapshot.workspaces[0]?.id,
    });
    expect(snapshot.bindings[0]?.currentSessionByProvider.codex).toBe(session?.id);
  });

  it("lists native sessions for the current workspace and switches by index", async () => {
    const app = createTestApp(
      undefined,
      {
        codex: new StaticCatalog("codex", [
          {
            provider: "codex",
            nativeSessionId: "thread_current_1",
            cwd: "/Users/a-znk/code/taskvision",
            startedAt: "2026-03-23T11:00:00.000Z",
          },
          {
            provider: "codex",
            nativeSessionId: "thread_other",
            cwd: "/Users/a-znk/code/other",
            startedAt: "2026-03-23T10:00:00.000Z",
          },
          {
            provider: "codex",
            nativeSessionId: "thread_child",
            cwd: "/Users/a-znk/code/taskvision/scripts",
            startedAt: "2026-03-23T09:00:00.000Z",
          },
          {
            provider: "codex",
            nativeSessionId: "thread_hidden_subagent",
            cwd: "/Users/a-znk/code/taskvision",
            startedAt: "2026-03-23T08:00:00.000Z",
            source: "subagent",
          },
        ]),
      },
    );

    await app.service.registerWorkspace({
      slug: "taskvision",
      rootPath: "/Users/a-znk/code/taskvision",
    });
    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/workspace use taskvision",
    });

    const listed = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session native list current",
    });

    expect(listed.messages[0]?.text).toContain('Native sessions for "taskvision":');
    expect(listed.messages[0]?.text).toContain("Exact workspace matches:");
    expect(listed.messages[0]?.text).toContain("Child paths:");
    expect(listed.messages[0]?.text).toContain("thread_current_1");
    expect(listed.messages[0]?.text).toContain("/Users/a-znk/code/taskvision/scripts");
    expect(listed.messages[0]?.text).toContain("thread_child");
    expect(listed.messages[0]?.text).not.toContain("thread_other");
    expect(listed.messages[0]?.text).not.toContain("thread_hidden_subagent");
    expect(listed.messages[0]?.text).toContain("Hidden 1 subagent session");

    const used = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session native use 1",
    });

    expect(used.messages[0]?.text).toContain("Attached codex session");

    const snapshot = await app.service.getStateSnapshot();
    expect(snapshot.sessions.find((item) => item.providerSessionId === "thread_current_1")).toBeTruthy();
  });

  it("uses the displayed native-session ordering when switching by index", async () => {
    const app = createTestApp(
      undefined,
      {
        codex: new StaticCatalog("codex", [
          {
            provider: "codex",
            nativeSessionId: "thread_new_unattached",
            cwd: "/Users/a-znk/code/taskvision",
            startedAt: "2026-03-23T11:00:00.000Z",
          },
          {
            provider: "codex",
            nativeSessionId: "thread_old_attached",
            cwd: "/Users/a-znk/code/taskvision",
            startedAt: "2026-03-23T10:00:00.000Z",
          },
        ]),
      },
    );

    await app.service.registerWorkspace({
      slug: "taskvision",
      rootPath: "/Users/a-znk/code/taskvision",
    });
    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/workspace use taskvision",
    });
    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session attach codex thread_old_attached keep-old",
    });

    const listed = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session native list current",
    });

    expect(listed.messages[0]?.text).toContain("1. codex thread_o thread_old_attached");
    expect(listed.messages[0]?.text).toContain("[attached as keep-old]");

    const used = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session native use 1",
    });

    expect(used.messages[0]?.text).toContain("Using existing attached codex session \"keep-old\"");
  });

  it("lists all native sessions across workspaces", async () => {
    const app = createTestApp(
      undefined,
      {
        codex: new StaticCatalog("codex", [
          {
            provider: "codex",
            nativeSessionId: "thread_current_1",
            cwd: "/Users/a-znk/code/taskvision",
            startedAt: "2026-03-23T11:00:00.000Z",
          },
          {
            provider: "codex",
            nativeSessionId: "thread_other",
            cwd: "/Users/a-znk/code/other",
            startedAt: "2026-03-23T10:00:00.000Z",
          },
          {
            provider: "codex",
            nativeSessionId: "thread_hidden_subagent",
            cwd: "/Users/a-znk/code/taskvision",
            startedAt: "2026-03-23T08:00:00.000Z",
            source: "subagent",
          },
        ]),
      },
    );

    const listed = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session native list all",
    });

    expect(listed.messages[0]?.text).toContain("All native sessions:");
    expect(listed.messages[0]?.text).toContain("- /Users/a-znk/code/taskvision");
    expect(listed.messages[0]?.text).toContain("- /Users/a-znk/code/other");
    expect(listed.messages[0]?.text).toContain("thread_current_1");
    expect(listed.messages[0]?.text).toContain("thread_other");
    expect(listed.messages[0]?.text).not.toContain("thread_hidden_subagent");
    expect(listed.messages[0]?.text).toContain("Hidden 1 subagent session");
  });

  it("honors current-scope filtering when switching native sessions by explicit id", async () => {
    const app = createTestApp(
      undefined,
      {
        codex: new StaticCatalog("codex", [
          {
            provider: "codex",
            nativeSessionId: "thread_current_1",
            cwd: "/Users/a-znk/code/taskvision",
            startedAt: "2026-03-23T11:00:00.000Z",
          },
          {
            provider: "codex",
            nativeSessionId: "thread_other",
            cwd: "/Users/a-znk/code/other",
            startedAt: "2026-03-23T10:00:00.000Z",
          },
        ]),
      },
    );

    await app.service.registerWorkspace({
      slug: "taskvision",
      rootPath: "/Users/a-znk/code/taskvision",
    });
    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/workspace use taskvision",
    });

    const rejected = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session native use current thread_other",
    });

    expect(rejected.messages[0]?.text).toBe("Could not find native session: thread_other");
  });

  it("rejects attach when no workspace is selected", async () => {
    const app = createTestApp();

    const result = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session attach codex thread_123 imported-session",
    });

    expect(result.messages[0]?.text).toBe("No workspace selected.");
  });

  it("passes provider model overrides into provider turns", async () => {
    const codex = new MockProvider("codex");
    const app = createTestApp({
      codex,
      claude: new MockProvider("claude"),
    });

    await app.service.registerWorkspace({
      slug: "taskvision",
      rootPath: "/Users/a-znk/code/taskvision",
    });
    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/workspace use taskvision",
    });

    const updated = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/provider model use gpt-5-codex",
    });

    expect(updated.messages[0]?.text).toContain('Model override for "codex" set to "gpt-5-codex".');

    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "hello model override",
    });

    expect(codex.calls[0]?.providerModel).toBe("gpt-5-codex");
  });

  it("shows the current session state with recorded history summary", async () => {
    const app = createTestApp();

    await app.service.registerWorkspace({
      slug: "taskvision",
      rootPath: "/Users/a-znk/code/taskvision",
    });
    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/workspace use taskvision",
    });
    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "inspect current session state",
    });

    const current = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session current",
    });

    expect(current.messages[0]?.text).toContain("Current session:");
    expect(current.messages[0]?.text).toContain("Provider: codex");
    expect(current.messages[0]?.text).toContain("Workspace: taskvision");
    expect(current.messages[0]?.text).toContain("Successful turns: 1");
    expect(current.messages[0]?.text).toContain("Recorded turns here: 1");
    expect(current.messages[0]?.text).toContain("History coverage: full since session creation.");
    expect(current.messages[0]?.text).toContain("inspect current session state");
  });

  it("shows recent recorded history with a default limit and explicit limit override", async () => {
    const app = createTestApp();

    await app.service.registerWorkspace({
      slug: "taskvision",
      rootPath: "/Users/a-znk/code/taskvision",
    });
    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/workspace use taskvision",
    });

    for (let index = 1; index <= 6; index += 1) {
      await app.handleMessage({
        channel: "wechat",
        scopeKey: "sender:alice",
        text: `history-message-${index}`,
      });
    }

    const historyDefault = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session history",
    });

    expect(historyDefault.messages[0]?.text).toContain("Showing 5 of 6 recorded turn(s).");
    expect(historyDefault.messages[0]?.text).not.toContain("history-message-1");
    expect(historyDefault.messages[0]?.text).toContain("history-message-2");
    expect(historyDefault.messages[0]?.text).toContain("history-message-6");

    const historyTwo = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session history 2",
    });

    expect(historyTwo.messages[0]?.text).toContain("Showing 2 of 6 recorded turn(s).");
    expect(historyTwo.messages[0]?.text).not.toContain("history-message-4");
    expect(historyTwo.messages[0]?.text).toContain("history-message-5");
    expect(historyTwo.messages[0]?.text).toContain("history-message-6");
  });

  it("explains attach history boundaries and records turns after attach", async () => {
    const app = createTestApp();

    await app.service.registerWorkspace({
      slug: "taskvision",
      rootPath: "/Users/a-znk/code/taskvision",
    });
    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/workspace use taskvision",
    });
    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session attach codex thread_123 imported-session",
    });

    const currentBeforeTurn = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session current",
    });

    expect(currentBeforeTurn.messages[0]?.text).toContain("History coverage: attached session.");
    expect(currentBeforeTurn.messages[0]?.text).toContain("Pre-attach provider history is not available here.");
    expect(currentBeforeTurn.messages[0]?.text).toContain("Recorded turns here: 0");

    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "first turn after attach",
    });

    const history = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/session history",
    });

    expect(history.messages[0]?.text).toContain("Showing 1 of 1 recorded turn(s).");
    expect(history.messages[0]?.text).toContain("History coverage: attached session.");
    expect(history.messages[0]?.text).toContain("first turn after attach");
    expect(history.messages[0]?.text).toContain("Pre-attach provider history is not available here.");
  });

  it("rejects messages from users outside the allowlist", async () => {
    const app = createTestApp(
      {
        codex: new MockProvider("codex"),
        claude: new MockProvider("claude"),
      },
      undefined,
      {
        wechatAllowFrom: ["trusted@im.wechat"],
      },
    );

    const response = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:blocked@im.wechat",
      userId: "blocked@im.wechat",
      text: "hello",
      replyContext: {
        channel: "wechat",
        senderId: "blocked@im.wechat",
        contextToken: "ctx-blocked",
      },
    });

    expect(response.messages[0]?.text).toContain("Access denied.");
    expect(response.messages[0]?.text).toContain("allowlist");

    const snapshot = await app.service.getStateSnapshot();
    expect(snapshot.bindings).toHaveLength(0);
    expect(snapshot.sessions).toHaveLength(0);
  });

  it("supports slash-prefixed wechat Chinese command aliases and preserves reply context", async () => {
    const app = createTestApp();
    const workspaceDir = await createTempWorkspace("harness-cn-");

    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: `/导入项目 ${workspaceDir}`,
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
      text: "/切换模型 claude",
    });

    const created = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/新建会话 审阅计划",
    });

    expect(created.messages[0]?.text).toContain("审阅计划");
    expect(created.messages[0]?.replyContext).toMatchObject({
      channel: "wechat",
      contextToken: "ctx-1",
    });

    const sessions = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/会话列表",
    });

    expect(sessions.messages[0]?.text).toContain("claude/审阅计划");
  });

  it("treats non-slash command-like text as normal provider input", async () => {
    const codex = new MockProvider("codex");
    const app = createTestApp({
      codex,
      claude: new MockProvider("claude"),
    });

    await app.service.registerWorkspace({
      slug: "taskvision",
      rootPath: "/Users/a-znk/code/taskvision",
    });
    await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/workspace use taskvision",
    });

    const response = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "状态",
    });

    expect(response.messages[0]?.text).toContain("message=状态");
    expect(codex.calls[0]?.message).toBe("状态");
  });

  it("shows command help for slash root and rejects malformed slash commands clearly", async () => {
    const app = createTestApp();

    const help = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/",
    });

    expect(help.messages[0]?.text).toContain("Better Call Codex commands");
    expect(help.messages[0]?.text).toContain("/commands");
    expect(help.messages[0]?.text).toContain("/workspace import <path>");

    const invalid = await app.handleMessage({
      channel: "wechat",
      scopeKey: "sender:alice",
      text: "/workspace use",
    });

    expect(invalid.messages[0]?.text).toBe("Usage: /workspace use <slug>");
  });
});
