import type { HarnessApp } from "../app/create-harness-app.js";
import type { ChannelConnector, ChannelMessageHandler } from "../channels/types.js";

export class HarnessRuntime {
  private readonly connectorsByChannel = new Map<string, ChannelConnector>();
  private started = false;

  constructor(
    private readonly app: HarnessApp,
    private readonly connectors: ChannelConnector[],
  ) {
    for (const connector of connectors) {
      this.connectorsByChannel.set(connector.channel, connector);
    }
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    const handler: ChannelMessageHandler = async (message) => {
      const result = await this.app.handleMessage(message);
      for (const outbound of result.messages) {
        const connector = this.connectorsByChannel.get(outbound.channel);
        if (!connector) {
          continue;
        }

        try {
          await connector.send(outbound);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          process.stderr.write(
            `Failed to send ${outbound.channel} message for ${outbound.scopeKey}: ${detail}\n`,
          );
        }
      }
    };

    await Promise.all(this.connectors.map((connector) => connector.start(handler)));
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    await Promise.all(this.connectors.map((connector) => connector.stop()));
    this.started = false;
  }
}
