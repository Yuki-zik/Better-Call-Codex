import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createHarnessApp } from "../src/app/create-harness-app.js";
import { MockProvider } from "../src/providers/mock-provider.js";
import { createHarnessRequestListener } from "../src/server.js";
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

async function invokeJson(
  listener: RequestListener,
  input: {
    method: string;
    path: string;
    body?: string;
  },
) {
  const request = Readable.from(input.body ? [input.body] : []) as IncomingMessage;
  request.method = input.method;
  request.url = input.path;
  request.headers = {
    host: "localhost",
    ...(input.body ? { "content-type": "application/json" } : {}),
  };

  let statusCode = 200;
  let rawBody = "";
  const headers = new Map<string, string>();
  const response = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        rawBody += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : chunk;
      }
    },
  } as unknown as ServerResponse;

  await listener(request, response);

  return {
    statusCode,
    headers,
    json: rawBody ? JSON.parse(rawBody) : undefined,
  };
}

describe("Harness HTTP server", () => {
  it("serves health checks", async () => {
    const response = await invokeJson(createHarnessRequestListener(createTestApp()), {
      method: "GET",
      path: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json).toEqual({ ok: true });
  });

  it("returns 400 for invalid JSON bodies", async () => {
    const response = await invokeJson(createHarnessRequestListener(createTestApp()), {
      method: "POST",
      path: "/admin/workspaces",
      body: "{",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json).toEqual({
      error: "Invalid JSON body.",
    });
  });

  it("returns 400 for invalid workspace payloads", async () => {
    const response = await invokeJson(createHarnessRequestListener(createTestApp()), {
      method: "POST",
      path: "/admin/workspaces",
      body: JSON.stringify({
        slug: "taskvision",
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json).toEqual({
      error: 'Field "rootPath" must be a non-empty string.',
    });
  });

  it("registers workspaces with validated payloads", async () => {
    const response = await invokeJson(createHarnessRequestListener(createTestApp()), {
      method: "POST",
      path: "/admin/workspaces",
      body: JSON.stringify({
        slug: "taskvision",
        displayName: "Taskvision",
        rootPath: "/Users/a-znk/code/taskvision",
        allowedProviders: ["codex"],
      }),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json).toMatchObject({
      slug: "taskvision",
      displayName: "Taskvision",
      rootPath: "/Users/a-znk/code/taskvision",
      allowedProviders: ["codex"],
    });
  });

  it("returns 400 for invalid telegram inbound payloads", async () => {
    const response = await invokeJson(createHarnessRequestListener(createTestApp()), {
      method: "POST",
      path: "/channels/telegram/inbound",
      body: JSON.stringify({
        chatId: {},
        text: "/status",
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json).toEqual({
      error: 'Field "chatId" must be a string or number.',
    });
  });

  it("returns 400 for invalid wechat inbound payloads", async () => {
    const response = await invokeJson(createHarnessRequestListener(createTestApp()), {
      method: "POST",
      path: "/channels/wechat/inbound",
      body: JSON.stringify({
        senderId: "",
        text: "/status",
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json).toEqual({
      error: 'Field "senderId" must be a non-empty string.',
    });
  });

  it("keeps successful inbound handling working", async () => {
    const app = createTestApp();
    const listener = createHarnessRequestListener(app);

    await invokeJson(listener, {
      method: "POST",
      path: "/admin/workspaces",
      body: JSON.stringify({
        slug: "blog",
        rootPath: "/Users/a-znk/code/blog",
      }),
    });

    await invokeJson(listener, {
      method: "POST",
      path: "/channels/wechat/inbound",
      body: JSON.stringify({
        senderId: "alice@im.wechat",
        conversationId: "thread-1",
        contextToken: "ctx-1",
        text: "/workspace use blog",
      }),
    });

    const response = await invokeJson(listener, {
      method: "POST",
      path: "/channels/wechat/inbound",
      body: JSON.stringify({
        senderId: "alice@im.wechat",
        conversationId: "thread-1",
        contextToken: "ctx-1",
        text: "/status",
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json).toMatchObject({
      binding: {
        scopeKey: "sender:alice@im.wechat:conv:thread-1",
      },
      messages: [
        {
          text: expect.stringContaining("Workspace: blog"),
          replyContext: {
            channel: "wechat",
            contextToken: "ctx-1",
          },
        },
      ],
    });
  });
});
