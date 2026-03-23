import path from "node:path";

import { providerKinds, type ProviderKind } from "./domain/models.js";

let envLoaded = false;

export interface HarnessConfig {
  port: number;
  stateFile: string;
  defaultProvider: ProviderKind;
  liveProviders: boolean;
  enableWechat?: boolean | undefined;
  wechatBotToken?: string | undefined;
  wechatBaseUrl?: string | undefined;
  wechatPollTimeoutMs?: number | undefined;
  wechatSyncCursorFile?: string | undefined;
  enableTelegram?: boolean | undefined;
  telegramBotToken?: string | undefined;
  codexCommand: string;
  codexModel?: string | undefined;
  codexTimeoutMs: number;
  codexSandbox: string;
  codexApproval: string;
  claudeCommand: string;
  claudeModel?: string | undefined;
  claudeTimeoutMs: number;
  claudePermissionMode: string;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): HarnessConfig {
  ensureEnvLoaded();

  const defaultProvider = parseProvider(
    env.HARNESS_DEFAULT_PROVIDER,
    "codex",
  );

  return {
    port: parseInteger(env.HARNESS_PORT, 4318),
    stateFile: path.resolve(
      env.HARNESS_STATE_FILE ?? "./data/harness-state.json",
    ),
    defaultProvider,
    liveProviders: parseBoolean(env.HARNESS_LIVE_PROVIDERS, false),
    enableWechat: parseBoolean(env.HARNESS_ENABLE_WECHAT, false),
    wechatBotToken: env.WECHAT_BOT_TOKEN || undefined,
    wechatBaseUrl: env.WECHAT_BASE_URL || undefined,
    wechatPollTimeoutMs: parseInteger(env.WECHAT_POLL_TIMEOUT_MS, 25_000),
    wechatSyncCursorFile: path.resolve(
      env.WECHAT_SYNC_CURSOR_FILE ?? "./data/wechat-sync-cursor.txt",
    ),
    enableTelegram: parseBoolean(env.HARNESS_ENABLE_TELEGRAM, false),
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || undefined,
    codexCommand: env.CODEX_COMMAND ?? "codex",
    codexModel: env.CODEX_MODEL || undefined,
    codexTimeoutMs: parseInteger(env.CODEX_TIMEOUT_MS, 120_000),
    codexSandbox: env.CODEX_SANDBOX ?? "workspace-write",
    codexApproval: env.CODEX_APPROVAL ?? "never",
    claudeCommand: env.CLAUDE_COMMAND ?? "claude",
    claudeModel: env.CLAUDE_MODEL || undefined,
    claudeTimeoutMs: parseInteger(env.CLAUDE_TIMEOUT_MS, 120_000),
    claudePermissionMode: env.CLAUDE_PERMISSION_MODE ?? "default",
  };
}

function parseInteger(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function parseProvider(
  raw: string | undefined,
  fallback: ProviderKind,
): ProviderKind {
  const normalized = raw?.trim().toLowerCase();
  return providerKinds.find((provider) => provider === normalized) ?? fallback;
}

function ensureEnvLoaded(): void {
  if (envLoaded) {
    return;
  }

  envLoaded = true;
  try {
    process.loadEnvFile?.(".env");
  } catch {
    // Missing .env is fine; process.env remains the source of truth.
  }
}
