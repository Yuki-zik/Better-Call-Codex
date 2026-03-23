import type {
  ProviderKind,
  ProviderTurnInput,
  ProviderTurnResult,
} from "../domain/models.js";

export interface ProviderAdapter {
  readonly id: ProviderKind;
  runTurn(input: ProviderTurnInput): Promise<ProviderTurnResult>;
}

export interface ShellProviderOptions {
  command: string;
  model?: string | undefined;
  timeoutMs: number;
  liveMode: boolean;
}
