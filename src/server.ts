import { createServer } from "node:http";
import type { IncomingMessage, RequestListener, Server, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

import {
  fromTelegramPayload,
  fromWechatPayload,
  type TelegramInboundPayload,
  type WechatInboundPayload,
} from "./channels/types.js";
import { loadConfig } from "./config.js";
import { createHarnessApp } from "./app/create-harness-app.js";
import type { HarnessApp } from "./app/create-harness-app.js";
import { providerKinds } from "./domain/models.js";
import { createHarnessRuntime } from "./runtime/create-harness-runtime.js";
import type { HarnessRuntime } from "./runtime/harness-runtime.js";
import { FileHarnessStateStore } from "./storage/file-state-store.js";

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function createHarnessRequestListener(app: HarnessApp): RequestListener {
  return async (request, response) => {
    try {
      if (!request.url) {
        sendJson(response, 404, { error: "Missing URL" });
        return;
      }

      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && url.pathname === "/state") {
        sendJson(response, 200, await app.service.getStateSnapshot());
        return;
      }

      if (request.method === "POST" && url.pathname === "/admin/workspaces") {
        const workspace = await app.service.registerWorkspace(
          parseRegisterWorkspaceInput(await readJsonObject(request)),
        );
        sendJson(response, 201, workspace);
        return;
      }

      if (request.method === "POST" && url.pathname === "/channels/telegram/inbound") {
        const result = await app.handleMessage(
          fromTelegramPayload(parseTelegramPayload(await readJsonObject(request))),
        );
        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/channels/wechat/inbound") {
        const result = await app.handleMessage(
          fromWechatPayload(parseWechatPayload(await readJsonObject(request))),
        );
        sendJson(response, 200, result);
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { error: message });
    }
  };
}

export function createHarnessServer(app: HarnessApp) {
  return createServer(createHarnessRequestListener(app));
}

export function startHarnessServer() {
  const config = loadConfig();
  const store = new FileHarnessStateStore(config.stateFile);
  const app = createHarnessApp(config, store);
  const server = createHarnessServer(app);

  server.listen(config.port, () => {
    process.stdout.write(
      `Better Call Codex server listening on http://127.0.0.1:${config.port}\n`,
    );
  });

  return server;
}

export interface HarnessApplication {
  server: Server;
  runtime: HarnessRuntime | null;
}

export async function startHarnessApplication(): Promise<HarnessApplication> {
  const config = loadConfig();
  const store = new FileHarnessStateStore(config.stateFile);
  const app = createHarnessApp(config, store);
  const server = createHarnessServer(app);
  const runtime = createHarnessRuntime(config, app);

  await runtime?.start();

  server.listen(config.port, () => {
    process.stdout.write(
      `Better Call Codex server listening on http://127.0.0.1:${config.port}\n`,
    );
  });

  return { server, runtime };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void startHarnessApplication().catch((error) => {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${detail}\n`);
    process.exitCode = 1;
  });
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function readJsonObject(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as unknown;
    if (!isRecord(parsed)) {
      throw new HttpError(400, "Request body must be a JSON object.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "Invalid JSON body.");
  }
}

function parseRegisterWorkspaceInput(body: Record<string, unknown>) {
  const slug = readRequiredString(body, "slug");
  const rootPath = readRequiredString(body, "rootPath");
  const displayName = readOptionalString(body, "displayName");
  const allowedProviders = readOptionalProviderKinds(body.allowedProviders);

  return {
    slug,
    rootPath,
    ...(displayName ? { displayName } : {}),
    ...(allowedProviders ? { allowedProviders } : {}),
  };
}

function parseTelegramPayload(
  body: Record<string, unknown>,
): TelegramInboundPayload {
  const chatId = readRequiredIdentifier(body, "chatId");
  const text = readRequiredString(body, "text");
  const userId = readOptionalIdentifier(body, "userId");
  const topicId = readOptionalIdentifier(body, "topicId");
  const replyToMessageId = readOptionalIdentifier(body, "replyToMessageId");

  return {
    chatId,
    text,
    ...(userId !== undefined ? { userId } : {}),
    ...(topicId !== undefined ? { topicId } : {}),
    ...(replyToMessageId !== undefined ? { replyToMessageId } : {}),
  };
}

function parseWechatPayload(
  body: Record<string, unknown>,
): WechatInboundPayload {
  const senderId = readRequiredString(body, "senderId");
  const text = readRequiredString(body, "text");
  const conversationId = readOptionalString(body, "conversationId");
  const contextToken = readOptionalString(body, "contextToken");

  return {
    senderId,
    text,
    ...(conversationId ? { conversationId } : {}),
    ...(contextToken ? { contextToken } : {}),
  };
}

function readRequiredString(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `Field "${field}" must be a non-empty string.`);
  }
  return value.trim();
}

function readOptionalString(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = body[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `Field "${field}" must be a non-empty string when provided.`);
  }
  return value.trim();
}

function readRequiredIdentifier(
  body: Record<string, unknown>,
  field: string,
): string | number {
  const value = body[field];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new HttpError(400, `Field "${field}" must be a string or number.`);
  }
  if (typeof value === "string" && value.trim() === "") {
    throw new HttpError(400, `Field "${field}" must be a non-empty string or number.`);
  }
  return value;
}

function readOptionalIdentifier(
  body: Record<string, unknown>,
  field: string,
): string | number | undefined {
  const value = body[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new HttpError(400, `Field "${field}" must be a string or number when provided.`);
  }
  if (typeof value === "string" && value.trim() === "") {
    throw new HttpError(400, `Field "${field}" must be a non-empty string or number when provided.`);
  }
  return value;
}

function readOptionalProviderKinds(
  value: unknown,
): ("codex" | "claude")[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'Field "allowedProviders" must be an array when provided.');
  }

  const allowedProviders = value.map((item) => {
    if (typeof item !== "string") {
      throw new HttpError(400, 'Field "allowedProviders" must contain only strings.');
    }
    const normalized = item.trim().toLowerCase();
    if (!providerKinds.includes(normalized as (typeof providerKinds)[number])) {
      throw new HttpError(
        400,
        `Field "allowedProviders" contains unknown provider "${item}".`,
      );
    }
    return normalized as "codex" | "claude";
  });

  if (allowedProviders.length === 0) {
    throw new HttpError(400, 'Field "allowedProviders" must not be empty when provided.');
  }

  return allowedProviders;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
