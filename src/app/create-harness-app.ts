import type { HarnessConfig } from "../config.js";
import { HarnessService } from "../core/harness-service.js";
import type { InboundChannelMessage } from "../domain/models.js";
import { ClaudeShellProvider } from "../providers/claude-shell-provider.js";
import { CodexShellProvider } from "../providers/codex-shell-provider.js";
import type { ProviderAdapter } from "../providers/base.js";
import type { HarnessStateStore } from "../storage/types.js";

export interface HarnessApp {
  readonly service: HarnessService;
  handleMessage(message: InboundChannelMessage): ReturnType<HarnessService["handleInbound"]>;
}

export function createHarnessApp(
  config: HarnessConfig,
  store: HarnessStateStore,
  providers?: Record<"codex" | "claude", ProviderAdapter>,
): HarnessApp {
  const resolvedProviders =
    providers ??
    ({
      codex: new CodexShellProvider({
        command: config.codexCommand,
        model: config.codexModel,
        timeoutMs: config.codexTimeoutMs,
        liveMode: config.liveProviders,
        sandbox: config.codexSandbox,
        approval: config.codexApproval,
      }),
      claude: new ClaudeShellProvider({
        command: config.claudeCommand,
        model: config.claudeModel,
        timeoutMs: config.claudeTimeoutMs,
        liveMode: config.liveProviders,
        permissionMode: config.claudePermissionMode,
      }),
    } satisfies Record<"codex" | "claude", ProviderAdapter>);

  const service = new HarnessService(store, resolvedProviders, {
    defaultProvider: config.defaultProvider,
  });

  return {
    service,
    handleMessage(message) {
      return service.handleInbound(message);
    },
  };
}
