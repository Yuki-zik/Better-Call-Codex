import type { InboundChannelMessage } from "../domain/models.js";

export interface AuthorizationDecision {
  allowed: boolean;
  reason?: string | undefined;
}

export interface InboundAuthorizer {
  authorize(message: InboundChannelMessage): AuthorizationDecision;
}
