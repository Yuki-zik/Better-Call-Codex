import type { HarnessApp } from "../app/create-harness-app.js";
import type { HarnessConfig } from "../config.js";
import { ClawBotWechatConnector } from "../channels/clawbot-wechat-connector.js";
import type { ChannelConnector } from "../channels/types.js";
import { HarnessRuntime } from "./harness-runtime.js";

export function createHarnessRuntime(
  config: HarnessConfig,
  app: HarnessApp,
  connectors?: ChannelConnector[],
): HarnessRuntime | null {
  const resolvedConnectors = connectors ?? createConnectorsFromConfig(config);
  if (resolvedConnectors.length === 0) {
    return null;
  }
  return new HarnessRuntime(app, resolvedConnectors);
}

export function createConnectorsFromConfig(config: HarnessConfig): ChannelConnector[] {
  const connectors: ChannelConnector[] = [];

  if (config.enableWechat) {
    if (!config.wechatBotToken || !config.wechatBaseUrl || !config.wechatSyncCursorFile) {
      throw new Error(
        "WeChat is enabled, but WECHAT_BOT_TOKEN, WECHAT_BASE_URL, or WECHAT_SYNC_CURSOR_FILE is missing.",
      );
    }

    connectors.push(
      new ClawBotWechatConnector({
        botToken: config.wechatBotToken,
        baseUrl: config.wechatBaseUrl,
        pollTimeoutMs: config.wechatPollTimeoutMs ?? 25_000,
        syncCursorFile: config.wechatSyncCursorFile,
      }),
    );
  }

  return connectors;
}
