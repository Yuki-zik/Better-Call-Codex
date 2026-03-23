import type { InboundChannelMessage, OutboundChannelMessage } from "../domain/models.js";
import type { ChannelConnector, ChannelMessageHandler } from "./types.js";

export class CollectingTransport implements ChannelConnector {
  readonly sent: OutboundChannelMessage[] = [];
  private handler: ChannelMessageHandler | null = null;

  constructor(public readonly channel: "telegram" | "wechat") {}

  async start(handler: ChannelMessageHandler): Promise<void> {
    this.handler = handler;
  }

  async send(message: OutboundChannelMessage): Promise<void> {
    this.sent.push(message);
  }

  async stop(): Promise<void> {
    this.handler = null;
  }

  async receive(message: InboundChannelMessage): Promise<void> {
    if (!this.handler) {
      throw new Error(`Connector "${this.channel}" has not been started.`);
    }
    await this.handler(message);
  }
}
