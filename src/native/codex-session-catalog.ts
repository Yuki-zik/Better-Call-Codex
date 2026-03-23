import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { NativeSessionCatalog, NativeSessionSummary } from "./types.js";

interface CodexSessionCatalogOptions {
  sessionsRoot?: string | undefined;
}

export class CodexSessionCatalog implements NativeSessionCatalog {
  readonly provider = "codex" as const;
  private readonly sessionsRoot: string;

  constructor(options: CodexSessionCatalogOptions = {}) {
    this.sessionsRoot = options.sessionsRoot ?? path.join(homedir(), ".codex", "sessions");
  }

  async listAll(): Promise<NativeSessionSummary[]> {
    const files = await collectJsonlFiles(this.sessionsRoot);
    const summaries = await Promise.all(files.map((filePath) => parseCodexSession(filePath)));
    return summaries
      .filter((item): item is NativeSessionSummary => item !== null)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async listForWorkspace(rootPath: string): Promise<NativeSessionSummary[]> {
    const resolvedRoot = path.resolve(rootPath);
    const sessions = await this.listAll();
    return sessions.filter((session) => isWithinWorkspace(session.cwd, resolvedRoot));
  }

  async findById(nativeSessionId: string): Promise<NativeSessionSummary | undefined> {
    const sessions = await this.listAll();
    return sessions.find((session) => session.nativeSessionId === nativeSessionId);
  }
}

async function collectJsonlFiles(rootPath: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsonlFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function parseCodexSession(filePath: string): Promise<NativeSessionSummary | null> {
  const firstLine = await readFirstLine(filePath);
  if (!firstLine) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.type !== "session_meta" || !isRecord(parsed.payload)) {
    return null;
  }

  const payload = parsed.payload;
  if (typeof payload.id !== "string" || typeof payload.cwd !== "string") {
    return null;
  }

  const source = summarizeSource(payload.source);
  return {
    provider: "codex",
    nativeSessionId: payload.id,
    cwd: path.resolve(payload.cwd),
    startedAt:
      typeof payload.timestamp === "string"
        ? payload.timestamp
        : typeof parsed.timestamp === "string"
          ? parsed.timestamp
          : new Date(0).toISOString(),
    ...(typeof payload.originator === "string" ? { originator: payload.originator } : {}),
    ...(source ? { source } : {}),
  };
}

async function readFirstLine(filePath: string): Promise<string | null> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(16 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === 0) {
      return null;
    }
    const raw = buffer.subarray(0, bytesRead).toString("utf-8");
    const [firstLine] = raw.split("\n");
    return firstLine?.trim() || null;
  } finally {
    await handle.close();
  }
}

function summarizeSource(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (isRecord(value) && isRecord(value.subagent)) {
    return "subagent";
  }
  return undefined;
}

function isWithinWorkspace(sessionCwd: string, workspaceRoot: string): boolean {
  if (sessionCwd === workspaceRoot) {
    return true;
  }
  const relative = path.relative(workspaceRoot, sessionCwd);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
