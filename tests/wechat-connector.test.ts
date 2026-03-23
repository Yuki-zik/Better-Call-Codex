import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ClawBotWechatConnector,
  splitWechatText,
  toInboundWechatMessage,
} from "../src/channels/clawbot-wechat-connector.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createCursorFilePath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "harness-wechat-"));
  tempDirs.push(dir);
  return path.join(dir, "cursor.txt");
}

function createJsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

describe("ClawBotWechatConnector helpers", () => {
  it("maps raw wechat text messages into inbound messages", () => {
    const inbound = toInboundWechatMessage({
      message_type: 1,
      from_user_id: "alice@im.wechat",
      context_token: "ctx-1",
      conversation_id: "thread-1",
      item_list: [
        {
          type: 1,
          text_item: {
            text: "hello from wechat",
          },
        },
      ],
    });

    expect(inbound).toMatchObject({
      channel: "wechat",
      scopeKey: "sender:alice@im.wechat:conv:thread-1",
      text: "hello from wechat",
      replyContext: {
        channel: "wechat",
        contextToken: "ctx-1",
      },
    });
  });

  it("splits long messages into bounded chunks", () => {
    const chunks = splitWechatText("a".repeat(1_800), 1_000);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(1_000);
    expect(chunks[1]).toHaveLength(800);
  });
});

describe("ClawBotWechatConnector", () => {
  it("persists the polling cursor and dispatches inbound messages", async () => {
    const cursorFile = await createCursorFilePath();
    const handled: any[] = [];

    const connector = new ClawBotWechatConnector({
      botToken: "bot-token",
      baseUrl: "https://wechat.example.test",
      pollTimeoutMs: 100,
      syncCursorFile: cursorFile,
      fetchFn: async () =>
        createJsonResponse({
          ret: 0,
          get_updates_buf: "cursor-1",
          msgs: [
            {
              message_type: 1,
              from_user_id: "alice@im.wechat",
              context_token: "ctx-1",
              item_list: [
                {
                  type: 3,
                  voice_item: {
                    text: "voice transcript",
                  },
                },
              ],
            },
          ],
        }),
    });

    (connector as any).handler = async (message: unknown) => {
      handled.push(message);
    };

    await connector.pollOnce();

    expect(handled[0]).toMatchObject({
      text: "voice transcript",
    });
    await expect(readFile(cursorFile, "utf-8")).resolves.toBe("cursor-1");
  });

  it("sends long replies in multiple sendmessage requests", async () => {
    const cursorFile = await createCursorFilePath();
    const payloads: any[] = [];

    const connector = new ClawBotWechatConnector({
      botToken: "bot-token",
      baseUrl: "https://wechat.example.test",
      pollTimeoutMs: 100,
      syncCursorFile: cursorFile,
      fetchFn: async (_input, init) => {
        payloads.push(JSON.parse(String(init?.body ?? "{}")));
        return createJsonResponse({ ret: 0 });
      },
    });

    await connector.send({
      channel: "wechat",
      scopeKey: "sender:alice@im.wechat",
      text: "a".repeat(1_800),
      replyContext: {
        channel: "wechat",
        senderId: "alice@im.wechat",
        contextToken: "ctx-1",
      },
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[0]?.msg?.context_token).toBe("ctx-1");
    expect(payloads[1]?.msg?.item_list?.[0]?.text_item?.text.length).toBe(800);
  });
});
