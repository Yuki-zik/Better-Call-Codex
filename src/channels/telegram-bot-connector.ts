import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { OutboundChannelMessage } from "../domain/models.js";
import {
  fromTelegramPayload,
  type ChannelConnector,
  type ChannelMessageHandler,
  type TelegramInboundPayload,
} from "./types.js";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const DEFAULT_BACKOFF_MS = 1_000;

interface TelegramFetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

type TelegramFetch = (
  input: string,
  init?: RequestInit,
) => Promise<TelegramFetchResponseLike>;

interface TelegramBotConnectorOptions {
  botToken: string;
  pollTimeoutMs: number;
  updateOffsetFile: string;
  fetchFn?: TelegramFetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

interface TelegramUpdateEnvelope {
  ok: boolean;
  result?: TelegramUpdate[];
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  text?: string;
  message_thread_id?: number;
  from?: {
    id?: number;
  };
  chat?: {
    id?: number;
  };
}

export class TelegramBotConnector implements ChannelConnector {
  readonly channel = "telegram" as const;

  private readonly fetchFn: TelegramFetch;
  private readonly sleep;
  private handler: ChannelMessageHandler | null = null;
  private offset = 0;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(private readonly options: TelegramBotConnectorOptions) {
    this.fetchFn = options.fetchFn ?? defaultFetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async start(handler: ChannelMessageHandler): Promise<void> {
    if (this.running) {
      return;
    }
    this.handler = handler;
    this.offset = await this.loadOffset();
    this.running = true;
    this.loopPromise = this.pollLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise;
    this.loopPromise = null;
    this.handler = null;
  }

  async send(message: OutboundChannelMessage): Promise<void> {
    if (!message.replyContext || message.replyContext.channel !== "telegram") {
      throw new Error("Telegram reply context is required to send a Telegram message.");
    }

    for (const chunk of splitTelegramText(message.text)) {
      await this.request("sendMessage", {
        chat_id: Number(message.replyContext.chatId),
        text: chunk,
        ...(message.replyContext.topicId
          ? { message_thread_id: Number(message.replyContext.topicId) }
          : {}),
        ...(message.replyContext.replyToMessageId
          ? { reply_to_message_id: Number(message.replyContext.replyToMessageId) }
          : {}),
      });
    }
  }

  async pollOnce(): Promise<void> {
    if (!this.handler) {
      return;
    }

    const response = await this.request("getUpdates", {
      offset: this.offset,
      timeout: Math.max(1, Math.ceil(this.options.pollTimeoutMs / 1000)),
      allowed_updates: ["message"],
    }) as TelegramUpdateEnvelope;

    const updates = response.result ?? [];
    for (const update of updates) {
      const inbound = toInboundTelegramMessage(update);
      if (inbound) {
        await this.handler(inbound);
      }
      this.offset = Math.max(this.offset, update.update_id + 1);
    }

    if (updates.length > 0) {
      await this.persistOffset(this.offset);
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Telegram polling failed: ${detail}\n`);
        if (this.running) {
          await this.sleep(DEFAULT_BACKOFF_MS);
        }
      }
    }
  }

  private async loadOffset(): Promise<number> {
    try {
      const raw = await readFile(this.options.updateOffsetFile, "utf-8");
      const parsed = JSON.parse(raw) as { offset?: unknown };
      return typeof parsed.offset === "number" ? parsed.offset : 0;
    } catch {
      return 0;
    }
  }

  private async persistOffset(offset: number): Promise<void> {
    await mkdir(path.dirname(this.options.updateOffsetFile), { recursive: true });
    await writeFile(
      this.options.updateOffsetFile,
      `${JSON.stringify({ offset }, null, 2)}\n`,
      "utf-8",
    );
  }

  private async request(method: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetchFn(
      `https://api.telegram.org/bot${this.options.botToken}/${method}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.options.pollTimeoutMs + 5_000),
      },
    );

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Telegram HTTP ${response.status}: ${raw.slice(0, 300)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Telegram returned invalid JSON: ${detail}`);
    }

    if (!isRecord(parsed) || parsed.ok !== true) {
      throw new Error(`Telegram API returned an error: ${raw.slice(0, 300)}`);
    }

    return parsed;
  }
}

export function toInboundTelegramMessage(
  update: TelegramUpdate,
): ReturnType<typeof fromTelegramPayload> | null {
  const message = update.message;
  if (!message?.text || !message.chat?.id) {
    return null;
  }

  const payload: TelegramInboundPayload = {
    chatId: message.chat.id,
    text: message.text,
    ...(message.from?.id !== undefined ? { userId: message.from.id } : {}),
    ...(message.message_thread_id !== undefined
      ? { topicId: message.message_thread_id }
      : {}),
    replyToMessageId: message.message_id,
  };

  return fromTelegramPayload(payload);
}

export function splitTelegramText(text: string, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [""];
  }

  const chunks: string[] = [];
  let remaining = trimmed;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n", maxLength);
    if (cut <= 0) {
      cut = remaining.lastIndexOf(" ", maxLength);
    }
    if (cut <= 0) {
      cut = maxLength;
    }
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function defaultFetch(
  input: string,
  init?: RequestInit,
): Promise<TelegramFetchResponseLike> {
  return fetch(input, init);
}
