import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { OutboundChannelMessage } from "../domain/models.js";
import {
  fromWechatPayload,
  type ChannelConnector,
  type ChannelMessageHandler,
  type WechatInboundPayload,
} from "./types.js";

const DEFAULT_BACKOFF_MS = 1_000;
const WECHAT_MAX_MESSAGE_LENGTH = 1_000;
const CHANNEL_VERSION = readChannelVersion();

interface WechatFetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

type WechatFetch = (
  input: string,
  init?: RequestInit,
) => Promise<WechatFetchResponseLike>;

interface ClawBotWechatConnectorOptions {
  botToken: string;
  baseUrl: string;
  pollTimeoutMs: number;
  syncCursorFile: string;
  fetchFn?: WechatFetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

interface WechatUpdateEnvelope {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  get_updates_buf?: string;
  msgs?: WechatRawMessage[];
}

interface WechatRawMessage {
  message_type?: number;
  from_user_id?: string;
  context_token?: string;
  contextToken?: string;
  conversation_id?: string;
  conversationId?: string;
  item_list?: Array<Record<string, unknown>>;
}

export class ClawBotWechatConnector implements ChannelConnector {
  readonly channel = "wechat" as const;

  private readonly fetchFn: WechatFetch;
  private readonly sleep;
  private readonly wechatUin = randomWechatUin();
  private handler: ChannelMessageHandler | null = null;
  private cursor = "";
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(private readonly options: ClawBotWechatConnectorOptions) {
    this.fetchFn = options.fetchFn ?? defaultFetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async start(handler: ChannelMessageHandler): Promise<void> {
    if (this.running) {
      return;
    }

    this.handler = handler;
    this.cursor = await this.loadCursor();
    this.running = true;
    this.loopPromise = this.pollLoop();
  }

  async send(message: OutboundChannelMessage): Promise<void> {
    if (!message.replyContext || message.replyContext.channel !== "wechat") {
      throw new Error("WeChat reply context is required to send a WeChat message.");
    }

    for (const chunk of splitWechatText(message.text)) {
      await this.requestJson("/ilink/bot/sendmessage", {
        msg: {
          from_user_id: "",
          to_user_id: message.replyContext.senderId,
          client_id: `better-call-codex:${Date.now()}:${Math.random().toString(16).slice(2)}`,
          message_type: 2,
          message_state: 2,
          context_token: message.replyContext.contextToken,
          item_list: [
            {
              type: 1,
              text_item: {
                text: chunk,
              },
            },
          ],
        },
        base_info: { channel_version: CHANNEL_VERSION },
      });
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise;
    this.loopPromise = null;
    this.handler = null;
  }

  async pollOnce(): Promise<void> {
    if (!this.handler) {
      return;
    }

    const response = await this.requestJson("/ilink/bot/getupdates", {
      get_updates_buf: this.cursor,
      base_info: { channel_version: CHANNEL_VERSION },
    });

    if (response.get_updates_buf && response.get_updates_buf !== this.cursor) {
      this.cursor = response.get_updates_buf;
      await this.persistCursor(this.cursor);
    }

    for (const message of response.msgs ?? []) {
      const inbound = toInboundWechatMessage(message);
      if (!inbound) {
        continue;
      }
      await this.handler(inbound);
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(`WeChat polling failed: ${detail}\n`);
        if (this.running) {
          await this.sleep(DEFAULT_BACKOFF_MS);
        }
      }
    }
  }

  private async loadCursor(): Promise<string> {
    try {
      return await readFile(this.options.syncCursorFile, "utf-8");
    } catch {
      return "";
    }
  }

  private async persistCursor(cursor: string): Promise<void> {
    await mkdir(path.dirname(this.options.syncCursorFile), { recursive: true });
    await writeFile(this.options.syncCursorFile, cursor, "utf-8");
  }

  private async requestJson(
    pathname: string,
    payload: Record<string, unknown>,
  ): Promise<WechatUpdateEnvelope> {
    const body = JSON.stringify(payload);
    const response = await this.fetchFn(`${trimTrailingSlash(this.options.baseUrl)}${pathname}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        AuthorizationType: "ilink_bot_token",
        Authorization: `Bearer ${this.options.botToken}`,
        "X-WECHAT-UIN": this.wechatUin,
      },
      body,
      signal: AbortSignal.timeout(this.options.pollTimeoutMs + 5_000),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${raw.slice(0, 300)}`);
    }

    let parsed: WechatUpdateEnvelope;
    try {
      parsed = JSON.parse(raw) as WechatUpdateEnvelope;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`WeChat returned invalid JSON: ${detail}`);
    }

    if ((parsed.ret ?? 0) !== 0 || (parsed.errcode ?? 0) !== 0) {
      throw new Error(
        `WeChat API returned an error: ret=${parsed.ret ?? 0} errcode=${parsed.errcode ?? 0} errmsg=${parsed.errmsg ?? ""}`.trim(),
      );
    }

    return parsed;
  }
}

export function toInboundWechatMessage(
  message: WechatRawMessage,
): ReturnType<typeof fromWechatPayload> | null {
  if ((message.message_type ?? 0) !== 1) {
    return null;
  }

  const senderId = message.from_user_id?.trim();
  if (!senderId) {
    return null;
  }

  const text = extractWechatText(message);
  if (!text) {
    return null;
  }

  const conversationId = resolveConversationId(message);
  const contextToken = resolveContextToken(message);
  const payload: WechatInboundPayload = {
    senderId,
    text,
    ...(conversationId ? { conversationId } : {}),
    ...(contextToken ? { contextToken } : {}),
  };

  return fromWechatPayload(payload);
}

export function extractWechatText(message: WechatRawMessage): string {
  const items = message.item_list ?? [];
  for (const item of items) {
    if (item.type === 1 && isRecord(item.text_item) && typeof item.text_item.text === "string") {
      return item.text_item.text.trim();
    }

    if (item.type === 3 && isRecord(item.voice_item) && typeof item.voice_item.text === "string") {
      return item.voice_item.text.trim();
    }
  }

  return "";
}

export function splitWechatText(text: string, maxLength = WECHAT_MAX_MESSAGE_LENGTH): string[] {
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

function resolveConversationId(message: WechatRawMessage): string | undefined {
  const value = message.conversation_id ?? message.conversationId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveContextToken(message: WechatRawMessage): string | undefined {
  const value = message.context_token ?? message.contextToken;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
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
): Promise<WechatFetchResponseLike> {
  return fetch(input, init);
}

function readChannelVersion(): string {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(dir, "..", "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
