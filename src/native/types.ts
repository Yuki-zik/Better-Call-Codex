import type { ProviderKind } from "../domain/models.js";

export interface NativeSessionSummary {
  provider: ProviderKind;
  nativeSessionId: string;
  cwd: string;
  startedAt: string;
  originator?: string | undefined;
  source?: string | undefined;
}

export interface NativeSessionCatalog {
  readonly provider: ProviderKind;
  listAll(): Promise<NativeSessionSummary[]>;
  listForWorkspace(rootPath: string): Promise<NativeSessionSummary[]>;
  findById(nativeSessionId: string): Promise<NativeSessionSummary | undefined>;
}
