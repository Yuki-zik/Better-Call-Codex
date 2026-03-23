import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CodexSessionCatalog } from "../src/native/codex-session-catalog.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createSessionsRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "better-call-codex-sessions-"));
  tempDirs.push(dir);
  return dir;
}

async function writeCodexSession(
  root: string,
  relativeFile: string,
  payload: {
    id: string;
    cwd: string;
    timestamp: string;
    originator?: string;
  },
): Promise<void> {
  const filePath = path.join(root, relativeFile);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify({
      timestamp: payload.timestamp,
      type: "session_meta",
      payload,
    })}\n`,
    "utf-8",
  );
}

describe("CodexSessionCatalog", () => {
  it("lists and filters codex native sessions by workspace", async () => {
    const root = await createSessionsRoot();
    await writeCodexSession(root, "2026/03/23/session-1.jsonl", {
      id: "thread_1",
      cwd: "/Users/a-znk/code/harness",
      timestamp: "2026-03-23T11:00:00.000Z",
      originator: "Codex Desktop",
    });
    await writeCodexSession(root, "2026/03/23/session-2.jsonl", {
      id: "thread_2",
      cwd: "/Users/a-znk/code/other",
      timestamp: "2026-03-23T10:00:00.000Z",
    });

    const catalog = new CodexSessionCatalog({ sessionsRoot: root });

    const all = await catalog.listAll();
    const current = await catalog.listForWorkspace("/Users/a-znk/code/harness");
    const found = await catalog.findById("thread_1");

    expect(all.map((session) => session.nativeSessionId)).toEqual(["thread_1", "thread_2"]);
    expect(current.map((session) => session.nativeSessionId)).toEqual(["thread_1"]);
    expect(found?.cwd).toBe("/Users/a-znk/code/harness");
  });
});
