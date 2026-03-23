import { spawn } from "node:child_process";

import type { ProviderAdapter, ShellProviderOptions } from "./base.js";
import type { ProviderTurnInput, ProviderTurnResult } from "../domain/models.js";

class CodexAccumulator {
  threadId = "";
  parts: string[] = [];
  errors: string[] = [];

  push(line: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = parsed.type;
    if (type === "thread.started" && typeof parsed.thread_id === "string") {
      this.threadId = parsed.thread_id;
      return;
    }

    if (type === "item.completed" || type === "item.delta") {
      const item = (parsed.item ?? parsed) as Record<string, unknown>;
      const text =
        typeof item.text === "string"
          ? item.text
          : typeof item.delta === "string"
            ? item.delta
            : undefined;
      if (text) {
        this.parts.push(text);
      }
      return;
    }

    if (type === "error" || type === "turn.failed") {
      const message =
        typeof parsed.message === "string"
          ? parsed.message
          : typeof parsed.error === "string"
            ? parsed.error
            : JSON.stringify(parsed);
      this.errors.push(message);
    }
  }

  finalText(): string {
    return this.parts.join("").trim();
  }
}

export class CodexShellProvider implements ProviderAdapter {
  readonly id = "codex" as const;

  constructor(
    private readonly options: ShellProviderOptions & {
      sandbox: string;
      approval: string;
    },
  ) {}

  async runTurn(input: ProviderTurnInput): Promise<ProviderTurnResult> {
    if (!this.options.liveMode) {
      return {
        text: [
          "[codex dry-run]",
          `workspace=${input.workspace.rootPath}`,
          `session=${input.session.name}`,
          `native=${input.session.providerSessionId ?? "<new>"}`,
          `message=${input.message}`,
        ].join("\n"),
      };
    }

    const args = [
      "-C",
      input.workspace.rootPath,
      "-a",
      this.options.approval,
      "-s",
      this.options.sandbox,
    ];

    const resolvedModel = input.providerModel ?? this.options.model;
    if (resolvedModel) {
      args.push("-m", resolvedModel);
    }

    args.push("exec");

    if (input.session.providerSessionId) {
      args.push("resume", input.session.providerSessionId);
    }

    args.push("--skip-git-repo-check", "--json", input.message);

    const accumulator = new CodexAccumulator();
    const stderr: string[] = [];

    const child = spawn(this.options.command, args, {
      cwd: input.workspace.rootPath,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");

    child.stdout.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim()) {
          accumulator.push(line.trim());
        }
      }
    });

    child.stderr.on("data", (chunk: string) => {
      stderr.push(chunk);
    });

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`Codex timed out after ${this.options.timeoutMs}ms`));
      }, this.options.timeoutMs);

      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve(code ?? 1);
      });
    });

    if (exitCode !== 0 && !accumulator.finalText()) {
      throw new Error(stderr.join("").trim() || `Codex exited with code ${exitCode}`);
    }

    const text =
      accumulator.finalText() ||
      stderr.join("").trim() ||
      "Codex completed without a visible response.";

    return {
      providerSessionId: accumulator.threadId || input.session.providerSessionId || undefined,
      text,
    };
  }
}
