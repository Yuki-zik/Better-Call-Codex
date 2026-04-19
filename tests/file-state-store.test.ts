import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { HarnessState } from "../src/domain/models.js";
import { FileHarnessStateStore } from "../src/storage/file-state-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempFilePath(name: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "harness-store-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

describe("FileHarnessStateStore", () => {
  it("returns an empty state when the backing file does not exist", async () => {
    const filePath = await createTempFilePath("missing.json");
    const store = new FileHarnessStateStore(filePath);

    await expect(store.load()).resolves.toEqual({
      workspaces: [],
      sessions: [],
      bindings: [],
      sessionTurns: [],
    });
  });

  it("throws when the backing file contains invalid JSON", async () => {
    const filePath = await createTempFilePath("invalid.json");
    await writeFile(filePath, "{not-json", "utf-8");

    const store = new FileHarnessStateStore(filePath);

    await expect(store.load()).rejects.toThrow(
      new RegExp(`Failed to load harness state from ".+invalid\\.json"`),
    );
  });

  it("throws when the backing file contains an invalid state shape", async () => {
    const filePath = await createTempFilePath("invalid-shape.json");
    await writeFile(
      filePath,
      JSON.stringify({
        workspaces: [],
        sessions: {},
        bindings: [],
      }),
      "utf-8",
    );

    const store = new FileHarnessStateStore(filePath);

    await expect(store.load()).rejects.toThrow(
      new RegExp(`Failed to load harness state from ".+invalid-shape\\.json"`),
    );
  });

  it("round-trips persisted state through disk", async () => {
    const filePath = await createTempFilePath("state.json");
    const store = new FileHarnessStateStore(filePath);

    const state: HarnessState = {
      workspaces: [
        {
          id: "ws_blog",
          slug: "blog",
          displayName: "Blog",
          rootPath: "/Users/a-znk/code/blog",
          allowedProviders: ["codex"],
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z",
        },
      ],
      sessions: [],
      bindings: [],
      sessionTurns: [],
    };

    await store.save(state);

    await expect(store.load()).resolves.toEqual(state);
  });

  it("hydrates legacy state files with history defaults", async () => {
    const filePath = await createTempFilePath("legacy-state.json");
    await writeFile(
      filePath,
      JSON.stringify({
        workspaces: [],
        sessions: [
          {
            id: "session-1",
            workspaceId: "ws_blog",
            provider: "codex",
            name: "legacy-session",
            providerSessionId: "thread_123",
            status: "idle",
            turnCount: 2,
            lastInput: "hello",
            lastOutput: "world",
            lastError: null,
            createdAt: "2026-03-24T00:00:00.000Z",
            updatedAt: "2026-03-24T00:00:00.000Z",
            archivedAt: null,
          },
        ],
        bindings: [],
      }),
      "utf-8",
    );

    const store = new FileHarnessStateStore(filePath);
    const loaded = await store.load();

    expect(loaded.sessionTurns).toEqual([]);
    expect(loaded.sessions[0]).toMatchObject({
      name: "legacy-session",
      historyMode: "legacy",
    });
  });
});
