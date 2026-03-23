import { describe, expect, it } from "vitest";

import { createHarnessApp } from "../src/app/create-harness-app.js";
import { CollectingTransport } from "../src/channels/collecting-transport.js";
import { MockProvider } from "../src/providers/mock-provider.js";
import { HarnessRuntime } from "../src/runtime/harness-runtime.js";
import { MemoryHarnessStateStore } from "../src/storage/memory-state-store.js";

function createTestApp() {
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
    {
      codex: new MockProvider("codex"),
      claude: new MockProvider("claude"),
    },
  );
}

describe("HarnessRuntime", () => {
  it("routes inbound messages through the app and sends outbound replies through connectors", async () => {
    const app = createTestApp();
    await app.service.registerWorkspace({
      slug: "blog",
      rootPath: "/Users/a-znk/code/blog",
    });

    const connector = new CollectingTransport("wechat");
    const runtime = new HarnessRuntime(app, [connector]);
    await runtime.start();

    await connector.receive({
      channel: "wechat",
      scopeKey: "sender:alice@im.wechat:conv:thread-1",
      text: "/workspace use blog",
      userId: "alice@im.wechat",
      replyContext: {
        channel: "wechat",
        senderId: "alice@im.wechat",
        conversationId: "thread-1",
        contextToken: "ctx-1",
      },
    });

    expect(connector.sent[0]?.text).toContain('Workspace set to "blog".');
    expect(connector.sent[0]?.replyContext).toMatchObject({
      channel: "wechat",
      contextToken: "ctx-1",
    });

    await runtime.stop();
  });
});
