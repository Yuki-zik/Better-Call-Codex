import type {
  ChannelKind,
  InboundChannelMessage,
  OutboundChannelMessage,
  ReplyContext,
} from "../domain/models.js";

export interface TelegramInboundPayload {
  chatId: string | number;
  text: string;
  userId?: string | number;
  topicId?: string | number;
  replyToMessageId?: string | number;
}

export interface WechatInboundPayload {
  senderId: string;
  text: string;
  conversationId?: string;
  contextToken?: string;
}

export type ChannelMessageHandler = (message: InboundChannelMessage) => Promise<void>;

export interface ChannelConnector {
  readonly channel: ChannelKind;
  start(handler: ChannelMessageHandler): Promise<void>;
  send(message: OutboundChannelMessage): Promise<void>;
  stop(): Promise<void>;
}

export function fromTelegramPayload(
  payload: TelegramInboundPayload,
): InboundChannelMessage {
  const topicPart =
    payload.topicId === undefined ? "" : `:topic:${String(payload.topicId)}`;

  const message: InboundChannelMessage = {
    channel: "telegram",
    scopeKey: `chat:${String(payload.chatId)}${topicPart}`,
    text: payload.text,
    replyContext: createTelegramReplyContext(payload),
  };

  if (payload.userId !== undefined) {
    message.userId = String(payload.userId);
  }

  return message;
}

export function fromWechatPayload(
  payload: WechatInboundPayload,
): InboundChannelMessage {
  const conversationPart = payload.conversationId
    ? `:conv:${payload.conversationId}`
    : "";

  return {
    channel: "wechat",
    scopeKey: `sender:${payload.senderId}${conversationPart}`,
    text: payload.text,
    userId: payload.senderId,
    ...(payload.contextToken
      ? {
          replyContext: {
            channel: "wechat",
            senderId: payload.senderId,
            ...(payload.conversationId
              ? { conversationId: payload.conversationId }
              : {}),
            contextToken: payload.contextToken,
          } satisfies ReplyContext,
        }
      : {}),
  };
}

function createTelegramReplyContext(
  payload: TelegramInboundPayload,
): ReplyContext {
  return {
    channel: "telegram",
    chatId: String(payload.chatId),
    ...(payload.topicId !== undefined ? { topicId: String(payload.topicId) } : {}),
    ...(payload.replyToMessageId !== undefined
      ? { replyToMessageId: String(payload.replyToMessageId) }
      : {}),
  };
}
