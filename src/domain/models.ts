import { randomUUID } from "node:crypto";

export const providerKinds = ["codex", "claude"] as const;
export const channelKinds = ["telegram", "wechat"] as const;

export type ProviderKind = (typeof providerKinds)[number];
export type ChannelKind = (typeof channelKinds)[number];
export type SessionStatus = "idle" | "busy" | "error";

export interface TelegramReplyContext {
  channel: "telegram";
  chatId: string;
  topicId?: string | undefined;
  replyToMessageId?: string | undefined;
}

export interface WechatReplyContext {
  channel: "wechat";
  senderId: string;
  conversationId?: string | undefined;
  contextToken: string;
}

export type ReplyContext = TelegramReplyContext | WechatReplyContext;

export interface WorkspaceRecord {
  id: string;
  slug: string;
  displayName: string;
  rootPath: string;
  allowedProviders: ProviderKind[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  workspaceId: string;
  provider: ProviderKind;
  name: string;
  providerSessionId: string | null;
  status: SessionStatus;
  turnCount: number;
  lastInput: string | null;
  lastOutput: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ChannelBindingRecord {
  id: string;
  channel: ChannelKind;
  scopeKey: string;
  workspaceId: string | null;
  preferredProvider: ProviderKind;
  preferredModelByProvider: Partial<Record<ProviderKind, string>>;
  currentSessionByProvider: Partial<Record<ProviderKind, string>>;
  lastUserId: string | null;
  lastReplyContext: ReplyContext | null;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessState {
  workspaces: WorkspaceRecord[];
  sessions: SessionRecord[];
  bindings: ChannelBindingRecord[];
}

export interface InboundChannelMessage {
  channel: ChannelKind;
  scopeKey: string;
  text: string;
  userId?: string | undefined;
  replyContext?: ReplyContext | undefined;
  metadata?: Record<string, string> | undefined;
}

export interface OutboundChannelMessage {
  channel: ChannelKind;
  scopeKey: string;
  text: string;
  replyContext?: ReplyContext | undefined;
  metadata?: Record<string, string> | undefined;
}

export interface ProviderTurnInput {
  workspace: WorkspaceRecord;
  session: SessionRecord;
  binding: ChannelBindingRecord;
  message: string;
  providerModel?: string | undefined;
}

export interface ProviderTurnResult {
  text: string;
  providerSessionId?: string | undefined;
}

export function createEmptyState(): HarnessState {
  return {
    workspaces: [],
    sessions: [],
    bindings: [],
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createWorkspaceId(slug: string): string {
  return `ws_${slug}`;
}

export function createSessionId(): string {
  return randomUUID();
}

export function createBindingId(channel: ChannelKind, scopeKey: string): string {
  return `${channel}:${scopeKey}`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
