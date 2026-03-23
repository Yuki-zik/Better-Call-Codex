import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  TelegramBotConnector,
  splitTelegramText,
  toInboundTelegramMessage,
} from "../src/channels/telegram-bot-connector.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createOffsetFilePath(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "better-call-codex-telegram-"));
  tempDirs.push(dir);
  return path.join(dir, "offset.json");
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

describe("TelegramBotConnector helpers", () => {
  it("maps telegram updates into inbound messages", () => {
    const inbound = toInboundTelegramMessage({
      update_id: 123,
      message: {
        message_id: 99,
        text: "/status",
        message_thread_id: 12,
        from: { id: 42 },
        chat: { id: 1001 },
      },
    });

    expect(inbound).toMatchObject({
      channel: "telegram",
      scopeKey: "chat:1001:topic:12",
      text: "/status",
      userId: "42",
      replyContext: {
        channel: "telegram",
        chatId: "1001",
        topicId: "12",
        replyToMessageId: "99",
      },
    });
  });

  it("splits long telegram messages into bounded chunks", () => {
    const chunks = splitTelegramText("a".repeat(5000), 4096);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(4096);
    expect(chunks[1]).toHaveLength(904);
  });
});

describe("TelegramBotConnector", () => {
  it("persists update offset and dispatches inbound messages", async () => {
    const offsetFile = await createOffsetFilePath();
    const handled: any[] = [];

    const connector = new TelegramBotConnector({
      botToken: "telegram-token",
      pollTimeoutMs: 100,
      updateOffsetFile: offsetFile,
      fetchFn: async () =>
        createJsonResponse({
          ok: true,
          result: [
            {
              update_id: 77,
              message: {
                message_id: 99,
                text: "hello from telegram",
                from: { id: 42 },
                chat: { id: 1001 },
              },
            },
          ],
        }),
    });

    (connector as any).handler = async (message: unknown) => {
      handled.push(message);
    };

    await connector.pollOnce();

    expect(handled[0]).toMatchObject({
      text: "hello from telegram",
      userId: "42",
    });
    await expect(readFile(offsetFile, "utf-8")).resolves.toContain('"offset": 78');
  });

  it("sends long replies using sendMessage requests", async () => {
    const offsetFile = await createOffsetFilePath();
    const payloads: any[] = [];

    const connector = new TelegramBotConnector({
      botToken: "telegram-token",
      pollTimeoutMs: 100,
      updateOffsetFile: offsetFile,
      fetchFn: async (_input, init) => {
        payloads.push(JSON.parse(String(init?.body ?? "{}")));
        return createJsonResponse({ ok: true, result: { message_id: 1 } });
      },
    });

    await connector.send({
      channel: "telegram",
      scopeKey: "chat:1001:topic:12",
      text: "a".repeat(5000),
      replyContext: {
        channel: "telegram",
        chatId: "1001",
        topicId: "12",
        replyToMessageId: "99",
      },
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      chat_id: 1001,
      message_thread_id: 12,
      reply_to_message_id: 99,
    });
    expect(payloads[1].text.length).toBe(904);
  });
});
