import { createEmptyState, type HarnessState } from "../domain/models.js";
import type { HarnessStateStore } from "./types.js";

export class MemoryHarnessStateStore implements HarnessStateStore {
  private state: HarnessState = createEmptyState();

  async load(): Promise<HarnessState> {
    return structuredClone(this.state);
  }

  async save(state: HarnessState): Promise<void> {
    this.state = structuredClone(state);
  }
}
