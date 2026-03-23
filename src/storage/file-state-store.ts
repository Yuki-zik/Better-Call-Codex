import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { createEmptyState, type HarnessState } from "../domain/models.js";
import type { HarnessStateStore } from "./types.js";

export class FileHarnessStateStore implements HarnessStateStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<HarnessState> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return parseState(raw, this.filePath);
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return createEmptyState();
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load harness state from "${this.filePath}": ${message}`,
        { cause: error },
      );
    }
  }

  async save(state: HarnessState): Promise<void> {
    const parent = path.dirname(this.filePath);
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

    await mkdir(parent, { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    await rename(tempPath, this.filePath);
  }
}

function parseState(raw: string, filePath: string): HarnessState {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in "${filePath}": ${message}`, { cause: error });
  }

  if (!isRecord(parsed)) {
    throw new Error(`Invalid harness state in "${filePath}": expected a JSON object.`);
  }

  const { workspaces, sessions, bindings } = parsed;
  if (!Array.isArray(workspaces) || !Array.isArray(sessions) || !Array.isArray(bindings)) {
    throw new Error(
      `Invalid harness state in "${filePath}": expected workspaces, sessions, and bindings arrays.`,
    );
  }

  return {
    workspaces,
    sessions,
    bindings,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
