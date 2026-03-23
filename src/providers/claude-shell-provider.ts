import { spawn } from "node:child_process";

import type { ProviderAdapter, ShellProviderOptions } from "./base.js";
import type { ProviderTurnInput, ProviderTurnResult } from "../domain/models.js";

export class ClaudeShellProvider implements ProviderAdapter {
  readonly id = "claude" as const;

  constructor(
    private readonly options: ShellProviderOptions & {
      permissionMode: string;
    },
  ) {}

  async runTurn(input: ProviderTurnInput): Promise<ProviderTurnResult> {
    const sessionId = input.session.providerSessionId ?? input.session.id;

    if (!this.options.liveMode) {
      return {
        providerSessionId: sessionId,
        text: [
          "[claude dry-run]",
          `workspace=${input.workspace.rootPath}`,
          `session=${input.session.name}`,
          `native=${sessionId}`,
          `message=${input.message}`,
        ].join("\n"),
      };
    }

    const args = ["-p", "--permission-mode", this.options.permissionMode];

    const resolvedModel = input.providerModel ?? this.options.model;
    if (resolvedModel) {
      args.push("--model", resolvedModel);
    }

    args.push("--session-id", sessionId, "--name", input.session.name);

    args.push(input.message);

    const child = spawn(this.options.command, args, {
      cwd: input.workspace.rootPath,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");

    const stdout: string[] = [];
    const stderr: string[] = [];

    child.stdout.on("data", (chunk: string) => stdout.push(chunk));
    child.stderr.on("data", (chunk: string) => stderr.push(chunk));

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`Claude timed out after ${this.options.timeoutMs}ms`));
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

    const text = stdout.join("").trim();
    if (exitCode !== 0 && !text) {
      throw new Error(stderr.join("").trim() || `Claude exited with code ${exitCode}`);
    }

    return {
      providerSessionId: sessionId,
      text: text || stderr.join("").trim() || "Claude completed without a visible response.",
    };
  }
}
