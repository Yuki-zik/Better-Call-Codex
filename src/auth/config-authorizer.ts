import type { InboundChannelMessage } from "../domain/models.js";
import type { AuthorizationDecision, InboundAuthorizer } from "./types.js";

export interface ConfigAuthorizerOptions {
  wechatAllowFrom?: string[] | undefined;
  telegramAllowFrom?: string[] | undefined;
  telegramAllowChats?: string[] | undefined;
}

export class ConfigAuthorizer implements InboundAuthorizer {
  private readonly wechatAllowFrom: Set<string>;
  private readonly telegramAllowFrom: Set<string>;
  private readonly telegramAllowChats: Set<string>;

  constructor(options: ConfigAuthorizerOptions = {}) {
    this.wechatAllowFrom = new Set(normalizeValues(options.wechatAllowFrom));
    this.telegramAllowFrom = new Set(normalizeValues(options.telegramAllowFrom));
    this.telegramAllowChats = new Set(normalizeValues(options.telegramAllowChats));
  }

  authorize(message: InboundChannelMessage): AuthorizationDecision {
    if (message.channel === "wechat") {
      if (this.wechatAllowFrom.size === 0) {
        return { allowed: true };
      }

      const senderId =
        message.replyContext?.channel === "wechat"
          ? message.replyContext.senderId
          : message.userId;
      if (senderId && this.wechatAllowFrom.has(senderId)) {
        return { allowed: true };
      }

      return {
        allowed: false,
        reason: "WeChat sender is not in the allowlist.",
      };
    }

    if (message.channel === "telegram") {
      const userAllowed =
        this.telegramAllowFrom.size === 0 ||
        (message.userId ? this.telegramAllowFrom.has(message.userId) : false);

      const chatId =
        message.replyContext?.channel === "telegram"
          ? message.replyContext.chatId
          : extractTelegramChatId(message.scopeKey);
      const chatAllowed =
        this.telegramAllowChats.size === 0 ||
        (chatId ? this.telegramAllowChats.has(chatId) : false);

      if (userAllowed && chatAllowed) {
        return { allowed: true };
      }

      return {
        allowed: false,
        reason: "Telegram sender or chat is not in the allowlist.",
      };
    }

    return { allowed: true };
  }
}

function normalizeValues(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function extractTelegramChatId(scopeKey: string): string | undefined {
  const match = /^chat:([^:]+)/.exec(scopeKey);
  return match?.[1];
}
