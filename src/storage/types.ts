import type { HarnessState } from "../domain/models.js";

export interface HarnessStateStore {
  load(): Promise<HarnessState>;
  save(state: HarnessState): Promise<void>;
}
