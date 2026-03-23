import type { ProviderAdapter } from "./base.js";
import type {
  ProviderKind,
  ProviderTurnInput,
  ProviderTurnResult,
} from "../domain/models.js";

export class MockProvider implements ProviderAdapter {
  readonly calls: ProviderTurnInput[] = [];

  constructor(public readonly id: ProviderKind) {}

  async runTurn(input: ProviderTurnInput): Promise<ProviderTurnResult> {
    this.calls.push(input);

    return {
      providerSessionId:
        input.session.providerSessionId ?? `${this.id}-${input.session.id}`,
      text: [
        `[${this.id}] workspace=${input.workspace.slug}`,
        `session=${input.session.name}`,
        `message=${input.message}`,
      ].join("\n"),
    };
  }
}
