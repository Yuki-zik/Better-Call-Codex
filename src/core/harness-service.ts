import { stat } from "node:fs/promises";
import path from "node:path";

import {
  createBindingId,
  createSessionId,
  createWorkspaceId,
  nowIso,
  providerKinds,
  shortId,
  type ChannelBindingRecord,
  type HarnessState,
  type InboundChannelMessage,
  type OutboundChannelMessage,
  type ProviderKind,
  type SessionRecord,
  type WorkspaceRecord,
} from "../domain/models.js";
import type { InboundAuthorizer } from "../auth/types.js";
import type { NativeSessionCatalog, NativeSessionSummary } from "../native/types.js";
import { parseHarnessCommand, type HarnessCommand } from "./command-parser.js";
import type { ProviderAdapter } from "../providers/base.js";
import type { HarnessStateStore } from "../storage/types.js";

export interface RegisterWorkspaceInput {
  slug: string;
  displayName?: string;
  rootPath: string;
  allowedProviders?: ProviderKind[];
}

export interface HandleInboundResult {
  messages: OutboundChannelMessage[];
  binding: ChannelBindingRecord;
  session?: SessionRecord;
}

export interface HarnessRuntimeOptions {
  defaultProvider: ProviderKind;
}

interface PreparedTurn {
  bindingId: string;
  provider: ProviderKind;
  sessionId: string;
  workspaceId: string;
}

interface NativeSessionListResult {
  sessions: NativeSessionSummary[];
  hiddenSubagentCount: number;
}

export class HarnessService {
  private state: HarnessState | null = null;
  private stateSerial: Promise<void> = Promise.resolve();
  private readonly bindingSerials = new Map<string, Promise<void>>();

  constructor(
    private readonly store: HarnessStateStore,
    private readonly providers: Record<ProviderKind, ProviderAdapter>,
    private readonly options: HarnessRuntimeOptions,
    private readonly nativeCatalogs: Partial<Record<ProviderKind, NativeSessionCatalog>> = {},
    private readonly authorizer?: InboundAuthorizer,
  ) {}

  async registerWorkspace(input: RegisterWorkspaceInput): Promise<WorkspaceRecord> {
    return this.withState(async (state) => {
      const now = nowIso();
      const allowedProviders =
        input.allowedProviders?.filter((provider) => providerKinds.includes(provider)) ??
        [...providerKinds];

      const existing = state.workspaces.find((workspace) => workspace.slug === input.slug);
      if (existing) {
        existing.displayName = input.displayName?.trim() || existing.displayName;
        existing.rootPath = path.resolve(input.rootPath);
        existing.allowedProviders = allowedProviders;
        existing.updatedAt = now;
        await this.persist();
        return structuredClone(existing);
      }

      const created: WorkspaceRecord = {
        id: createWorkspaceId(input.slug),
        slug: input.slug,
        displayName: input.displayName?.trim() || input.slug,
        rootPath: path.resolve(input.rootPath),
        allowedProviders,
        createdAt: now,
        updatedAt: now,
      };

      state.workspaces.push(created);
      await this.persist();
      return structuredClone(created);
    });
  }

  async getStateSnapshot(): Promise<HarnessState> {
    return this.withState(async (state) => structuredClone(state));
  }

  async handleInbound(inbound: InboundChannelMessage): Promise<HandleInboundResult> {
    const authorization = this.authorizer?.authorize(inbound);
    if (authorization && !authorization.allowed) {
      const binding = this.createTransientBinding(inbound);
      return {
        binding,
        messages: [
          this.createOutbound(
            inbound,
            binding,
            `Access denied.\n${authorization.reason ?? "This chat is not allowed to use Better Call Codex."}`,
          ),
        ],
      };
    }

    const queueKey = createBindingId(inbound.channel, inbound.scopeKey);
    return this.runInQueue(this.bindingSerials, queueKey, async () => {
      const command = parseHarnessCommand(inbound.text);

      if (command) {
        return this.handleCommand(inbound, command);
      }

      const prepared = await this.withState(async (state) => {
        const binding = this.ensureBinding(state, inbound);
        const workspace = this.getSelectedWorkspace(state, binding);
        if (!workspace) {
          binding.updatedAt = nowIso();
          await this.persist();
          return {
            kind: "complete" as const,
            result: this.createResult(binding, [
              this.createOutbound(
                inbound,
                binding,
                "No workspace selected.\nUse /workspace list and /workspace use <slug> first.",
              ),
            ]),
          };
        }

        const provider = binding.preferredProvider;
        if (!workspace.allowedProviders.includes(provider)) {
          binding.updatedAt = nowIso();
          await this.persist();
          return {
            kind: "complete" as const,
            result: this.createResult(binding, [
              this.createOutbound(
                inbound,
                binding,
                `Workspace "${workspace.slug}" does not allow provider "${provider}".`,
              ),
            ]),
          };
        }

        const session =
          this.getCurrentSession(state, binding, provider) ??
          this.createSession(state, workspace, provider);

        binding.currentSessionByProvider[provider] = session.id;
        binding.updatedAt = nowIso();
        await this.persist();

        return {
          kind: "pending" as const,
          turn: {
            bindingId: binding.id,
            provider,
            sessionId: session.id,
            workspaceId: workspace.id,
          } satisfies PreparedTurn,
        };
      });

      if (prepared.kind === "complete") {
        return prepared.result;
      }

      return this.executeTurn(inbound, prepared.turn);
    });
  }

  private async handleCommand(
    inbound: InboundChannelMessage,
    command: HarnessCommand,
  ): Promise<HandleInboundResult> {
    return this.withState(async (state) => {
      const binding = this.ensureBinding(state, inbound);
      const text = await this.runCommand(state, binding, command);
      binding.updatedAt = nowIso();
      await this.persist();
      return this.createResult(binding, [this.createOutbound(inbound, binding, text)]);
    });
  }

  private async executeTurn(
    inbound: InboundChannelMessage,
    turn: PreparedTurn,
  ): Promise<HandleInboundResult> {
    const started = await this.withState(async (state) => {
      const binding = this.getBindingById(state, turn.bindingId);
      const workspace = state.workspaces.find((item) => item.id === turn.workspaceId);
      const session = state.sessions.find((item) => item.id === turn.sessionId);

      if (!binding || !workspace || !session) {
        throw new Error("Turn state could not be resumed.");
      }

      session.status = "busy";
      session.lastInput = inbound.text;
      session.updatedAt = nowIso();
      binding.currentSessionByProvider[turn.provider] = session.id;
      binding.updatedAt = nowIso();
      await this.persist();

      return {
        binding: structuredClone(binding),
        workspace: structuredClone(workspace),
        session: structuredClone(session),
      };
    });

    try {
      const result = await this.providers[turn.provider].runTurn({
        workspace: started.workspace,
      session: started.session,
      binding: started.binding,
      message: inbound.text,
      providerModel: started.binding.preferredModelByProvider[turn.provider],
    });

      return this.withState(async (state) => {
        const binding = this.getBindingById(state, turn.bindingId);
        const session = state.sessions.find((item) => item.id === turn.sessionId);

        if (!binding || !session) {
          throw new Error("Turn state could not be completed.");
        }

        session.providerSessionId = result.providerSessionId ?? session.providerSessionId;
        session.lastOutput = result.text;
        session.lastError = null;
        session.turnCount += 1;
        session.status = "idle";
        session.updatedAt = nowIso();
        binding.updatedAt = nowIso();
        await this.persist();

        const bindingSnapshot = structuredClone(binding);
        const sessionSnapshot = structuredClone(session);
        return {
          binding: bindingSnapshot,
          session: sessionSnapshot,
          messages: [
            this.createOutbound(inbound, bindingSnapshot, result.text, {
              provider: turn.provider,
              sessionId: turn.sessionId,
            }),
          ],
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.withState(async (state) => {
        const binding = this.getBindingById(state, turn.bindingId);
        const session = state.sessions.find((item) => item.id === turn.sessionId);

        if (!binding || !session) {
          throw new Error(message);
        }

        session.lastError = message;
        session.status = "error";
        session.updatedAt = nowIso();
        binding.updatedAt = nowIso();
        await this.persist();

        const bindingSnapshot = structuredClone(binding);
        const sessionSnapshot = structuredClone(session);
        return {
          binding: bindingSnapshot,
          session: sessionSnapshot,
          messages: [
            this.createOutbound(
              inbound,
              bindingSnapshot,
              `Provider "${turn.provider}" failed.\n${message}`,
              { provider: turn.provider, sessionId: turn.sessionId },
            ),
          ],
        };
      });
    }
  }

  private async withState<T>(task: (state: HarnessState) => Promise<T>): Promise<T> {
    return this.runStateSerial(async () => task(await this.loadState()));
  }

  private async runStateSerial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.stateSerial.then(task, task);
    this.stateSerial = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async runInQueue<T>(
    queue: Map<string, Promise<void>>,
    key: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = queue.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    queue.set(key, settled);
    return next.finally(() => {
      if (queue.get(key) === settled) {
        queue.delete(key);
      }
    });
  }

  private async loadState(): Promise<HarnessState> {
    if (!this.state) {
      this.state = await this.store.load();
    }
    return this.state;
  }

  private async persist(): Promise<void> {
    if (!this.state) {
      return;
    }
    await this.store.save(this.state);
  }

  private ensureBinding(
    state: HarnessState,
    inbound: InboundChannelMessage,
  ): ChannelBindingRecord {
    const existing = state.bindings.find(
      (binding) =>
        binding.channel === inbound.channel && binding.scopeKey === inbound.scopeKey,
    );

    if (existing) {
      existing.preferredModelByProvider = existing.preferredModelByProvider ?? {};
      existing.currentSessionByProvider = existing.currentSessionByProvider ?? {};
      existing.lastUserId = inbound.userId ?? existing.lastUserId;
      existing.lastReplyContext = inbound.replyContext ?? existing.lastReplyContext ?? null;
      existing.updatedAt = nowIso();
      return existing;
    }

    const created: ChannelBindingRecord = {
      id: createBindingId(inbound.channel, inbound.scopeKey),
      channel: inbound.channel,
      scopeKey: inbound.scopeKey,
      workspaceId: null,
      preferredProvider: this.options.defaultProvider,
      preferredModelByProvider: {},
      currentSessionByProvider: {},
      lastUserId: inbound.userId ?? null,
      lastReplyContext: inbound.replyContext ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    state.bindings.push(created);
    return created;
  }

  private getBindingById(
    state: HarnessState,
    bindingId: string,
  ): ChannelBindingRecord | undefined {
    return state.bindings.find((binding) => binding.id === bindingId);
  }

  private createTransientBinding(
    inbound: InboundChannelMessage,
  ): ChannelBindingRecord {
    return {
      id: createBindingId(inbound.channel, inbound.scopeKey),
      channel: inbound.channel,
      scopeKey: inbound.scopeKey,
      workspaceId: null,
      preferredProvider: this.options.defaultProvider,
      preferredModelByProvider: {},
      currentSessionByProvider: {},
      lastUserId: inbound.userId ?? null,
      lastReplyContext: inbound.replyContext ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  private async runCommand(
    state: HarnessState,
    binding: ChannelBindingRecord,
    command: HarnessCommand,
  ): Promise<string> {
    if (command.name === "help") {
      return [
        "Better Call Codex commands:",
        "/status",
        "/workspace list",
        "/workspace use <slug>",
        "/workspace import <path>",
        "/provider list",
        "/provider current",
        "/provider use <codex|claude>",
        "/provider model current",
        "/provider model use <model>",
        "/provider model clear",
        "/session list",
        "/session new [name]",
        "/session attach <codex|claude> <native-id> [name]",
        "/session native list [current|all]",
        "/session native use [current|all] <index|native-id>",
        "/session use <id|name|index>",
        "/session archive <id|name|index>",
        "/new [name]",
        "/switch <id|name|index>",
      ].join("\n");
    }

    if (command.name === "status") {
      return this.renderStatus(state, binding);
    }

    if (command.name === "workspace" && command.action === "list") {
      if (state.workspaces.length === 0) {
        return "No workspaces registered yet.\nUse POST /admin/workspaces or /workspace import <path> to add one.";
      }

      const lines = ["Workspaces:"];
      for (const workspace of state.workspaces) {
        const currentMark = binding.workspaceId === workspace.id ? " [current]" : "";
        lines.push(
          `- ${workspace.slug}${currentMark} -> ${workspace.rootPath} (${workspace.allowedProviders.join(", ")})`,
        );
      }
      return lines.join("\n");
    }

    if (command.name === "workspace" && command.action === "import") {
      return this.importWorkspace(state, binding, command.pathText);
    }

    if (command.name === "workspace" && command.action === "use") {
      const workspace = state.workspaces.find(
        (item) => item.slug === command.selector.trim(),
      );
      if (!workspace) {
        return `Unknown workspace: ${command.selector}`;
      }

      this.selectWorkspace(binding, workspace);
      workspace.updatedAt = nowIso();
      return `Workspace set to "${workspace.slug}".`;
    }

    if (command.name === "provider" && command.action === "list") {
      const workspace = this.getSelectedWorkspace(state, binding);
      const allowed = workspace?.allowedProviders ?? [...providerKinds];
      return [
        `Preferred provider: ${binding.preferredProvider}`,
        `Current model override: ${binding.preferredModelByProvider[binding.preferredProvider] ?? "<default>"}`,
        `Available here: ${allowed.join(", ")}`,
      ].join("\n");
    }

    if (command.name === "provider" && command.action === "current") {
      return this.renderProviderCurrent(binding);
    }

    if (command.name === "provider" && command.action === "use") {
      const provider = this.resolveProvider(command.selector);
      if (!provider) {
        return `Unknown provider: ${command.selector}`;
      }

      const workspace = this.getSelectedWorkspace(state, binding);
      if (workspace && !workspace.allowedProviders.includes(provider)) {
        return `Workspace "${workspace.slug}" does not allow provider "${provider}".`;
      }

      binding.preferredProvider = provider;
      binding.updatedAt = nowIso();
      return `Preferred provider set to "${provider}".`;
    }

    if (command.name === "provider" && command.action === "model") {
      if (command.subaction === "current") {
        return this.renderProviderCurrent(binding);
      }

      if (command.subaction === "clear") {
        delete binding.preferredModelByProvider[binding.preferredProvider];
        binding.updatedAt = nowIso();
        return `Cleared model override for "${binding.preferredProvider}".`;
      }

      binding.preferredModelByProvider[binding.preferredProvider] = command.modelName;
      binding.updatedAt = nowIso();
      return `Model override for "${binding.preferredProvider}" set to "${command.modelName}".`;
    }

    if (command.name === "session" && command.action === "list") {
      const workspace = this.getSelectedWorkspace(state, binding);
      if (!workspace) {
        return "No workspace selected.";
      }

      const sessions = this.listSessionsForWorkspace(state, workspace.id);
      if (sessions.length === 0) {
        return `No sessions in workspace "${workspace.slug}".\nUse /session new to create one.`;
      }

      const lines = [`Sessions in "${workspace.slug}":`];
      const ordered = sessions.map((session, index) => {
        const current =
          binding.currentSessionByProvider[session.provider] === session.id
            ? " [current]"
            : "";
        return `${index + 1}. ${session.provider}/${session.name}${current} (${shortId(session.id)})`;
      });
      return lines.concat(ordered).join("\n");
    }

    if (command.name === "session" && command.action === "new") {
      const workspace = this.getSelectedWorkspace(state, binding);
      if (!workspace) {
        return "No workspace selected.";
      }

      const session = this.createSession(
        state,
        workspace,
        binding.preferredProvider,
        command.nameText,
      );
      binding.currentSessionByProvider[binding.preferredProvider] = session.id;
      binding.updatedAt = nowIso();
      return `Created ${session.provider} session "${session.name}" (${shortId(session.id)}).`;
    }

    if (command.name === "session" && command.action === "native-list") {
      const workspace = this.getSelectedWorkspace(state, binding);
      if (command.scope === "current" && !workspace) {
        return "No workspace selected.";
      }
      return this.renderNativeSessions(
        state,
        workspace,
        command.scope,
      );
    }

    if (command.name === "session" && command.action === "native-use") {
      const workspace = this.getSelectedWorkspace(state, binding);
      if (command.scope === "current" && !workspace) {
        return "No workspace selected.";
      }

      const resolved = await this.resolveNativeSession(
        workspace,
        command.scope,
        command.selector,
      );
      if (!resolved) {
        return `Could not find native session: ${command.selector}`;
      }

      return this.attachNativeSession(
        state,
        binding,
        resolved.provider,
        resolved.nativeSessionId,
        resolved.defaultName,
      );
    }

    if (command.name === "session" && command.action === "attach") {
      const workspace = this.getSelectedWorkspace(state, binding);
      if (!workspace) {
        return "No workspace selected.";
      }

      const provider = this.resolveProvider(command.providerSelector);
      if (!provider) {
        return `Unknown provider: ${command.providerSelector}`;
      }

      if (!workspace.allowedProviders.includes(provider)) {
        return `Workspace "${workspace.slug}" does not allow provider "${provider}".`;
      }

      const nativeSessionId = command.nativeSessionId.trim();
      if (!nativeSessionId) {
        return "Native session ID is required.";
      }

      return this.attachNativeSession(
        state,
        binding,
        provider,
        nativeSessionId,
        command.nameText,
      );
    }

    if (command.name === "session" && command.action === "use") {
      const workspace = this.getSelectedWorkspace(state, binding);
      if (!workspace) {
        return "No workspace selected.";
      }

      const session = this.resolveSessionSelector(
        state,
        workspace.id,
        command.selector,
      );
      if (!session) {
        return `Could not find session: ${command.selector}`;
      }

      binding.preferredProvider = session.provider;
      binding.currentSessionByProvider[session.provider] = session.id;
      binding.updatedAt = nowIso();
      session.updatedAt = nowIso();
      return `Current session set to ${session.provider}/${session.name} (${shortId(session.id)}).`;
    }

    if (command.name === "session" && command.action === "archive") {
      const workspace = this.getSelectedWorkspace(state, binding);
      if (!workspace) {
        return "No workspace selected.";
      }

      const session = this.resolveSessionSelector(
        state,
        workspace.id,
        command.selector,
      );
      if (!session) {
        return `Could not find session: ${command.selector}`;
      }

      session.archivedAt = nowIso();
      session.updatedAt = nowIso();

      if (binding.currentSessionByProvider[session.provider] === session.id) {
        delete binding.currentSessionByProvider[session.provider];
      }

      return `Archived ${session.provider}/${session.name}.`;
    }

    return "Unsupported command.";
  }

  private async importWorkspace(
    state: HarnessState,
    binding: ChannelBindingRecord,
    pathText: string,
  ): Promise<string> {
    const resolvedPath = path.resolve(pathText.trim());
    if (!resolvedPath) {
      return "Workspace path is required.";
    }

    let stats;
    try {
      stats = await stat(resolvedPath);
    } catch {
      return `Workspace path does not exist: ${resolvedPath}`;
    }

    if (!stats.isDirectory()) {
      return `Workspace path is not a directory: ${resolvedPath}`;
    }

    const existing = state.workspaces.find(
      (workspace) => path.resolve(workspace.rootPath) === resolvedPath,
    );
    if (existing) {
      this.selectWorkspace(binding, existing);
      existing.updatedAt = nowIso();
      return `Workspace "${existing.slug}" is already registered and is now selected.`;
    }

    const slug = this.ensureUniqueWorkspaceSlug(
      state,
      this.slugifyWorkspaceName(path.basename(resolvedPath) || "workspace"),
    );
    const now = nowIso();
    const created: WorkspaceRecord = {
      id: createWorkspaceId(slug),
      slug,
      displayName: path.basename(resolvedPath) || slug,
      rootPath: resolvedPath,
      allowedProviders: [...providerKinds],
      createdAt: now,
      updatedAt: now,
    };

    state.workspaces.push(created);
    this.selectWorkspace(binding, created);
    return `Imported workspace "${created.slug}" from ${resolvedPath}.`;
  }

  private selectWorkspace(
    binding: ChannelBindingRecord,
    workspace: WorkspaceRecord,
  ): void {
    binding.workspaceId = workspace.id;
    binding.currentSessionByProvider = {};
    binding.updatedAt = nowIso();
    if (!workspace.allowedProviders.includes(binding.preferredProvider)) {
      binding.preferredProvider = workspace.allowedProviders[0] ?? this.options.defaultProvider;
    }
  }

  private renderStatus(
    state: HarnessState,
    binding: ChannelBindingRecord,
  ): string {
    const workspace = this.getSelectedWorkspace(state, binding);
    const currentCodex =
      binding.currentSessionByProvider.codex &&
      state.sessions.find((session) => session.id === binding.currentSessionByProvider.codex);
    const currentClaude =
      binding.currentSessionByProvider.claude &&
      state.sessions.find((session) => session.id === binding.currentSessionByProvider.claude);

    return [
      `Scope: ${binding.channel}/${binding.scopeKey}`,
      `Workspace: ${workspace?.slug ?? "<none>"}`,
      `Preferred provider: ${binding.preferredProvider}`,
      `Current ${binding.preferredProvider} model: ${binding.preferredModelByProvider[binding.preferredProvider] ?? "<default>"}`,
      `Current codex session: ${currentCodex ? `${currentCodex.name} (${shortId(currentCodex.id)})` : "<none>"}`,
      `Current claude session: ${currentClaude ? `${currentClaude.name} (${shortId(currentClaude.id)})` : "<none>"}`,
    ].join("\n");
  }

  private renderProviderCurrent(binding: ChannelBindingRecord): string {
    return [
      `Preferred provider: ${binding.preferredProvider}`,
      `Model override: ${binding.preferredModelByProvider[binding.preferredProvider] ?? "<default>"}`,
    ].join("\n");
  }

  private async renderNativeSessions(
    state: HarnessState,
    workspace: WorkspaceRecord | undefined,
    scope: "current" | "all",
  ): Promise<string> {
    const { sessions, hiddenSubagentCount } = await this.listNativeSessions(workspace, scope);
    if (sessions.length === 0) {
      return scope === "current"
        ? `No native sessions found for workspace "${workspace?.slug ?? "<none>"}".`
        : "No native sessions found.";
    }

    const lines = [
      scope === "current"
        ? `Native sessions for "${workspace?.slug}":`
        : "All native sessions:",
    ];

    let index = 1;
    if (scope === "current" && workspace) {
      const exactMatches = sessions.filter((session) => session.cwd === workspace.rootPath);
      const childMatches = sessions.filter((session) => session.cwd !== workspace.rootPath);

      if (exactMatches.length > 0) {
        lines.push("Exact workspace matches:");
        for (const session of this.sortNativeSessionsForDisplay(state, exactMatches)) {
          lines.push(this.renderNativeSessionLine(index++, state, session));
        }
      }

      if (childMatches.length > 0) {
        lines.push("Child paths:");
        const grouped = this.groupSessionsByCwd(childMatches);
        for (const [cwd, groupedSessions] of grouped) {
          lines.push(`- ${cwd}`);
          for (const session of this.sortNativeSessionsForDisplay(state, groupedSessions)) {
            lines.push(this.renderNativeSessionLine(index++, state, session, { hideCwd: true }));
          }
        }
      }
    } else {
      const grouped = this.groupSessionsByCwd(sessions);
      for (const [cwd, groupedSessions] of grouped) {
        lines.push(`- ${cwd}`);
        for (const session of this.sortNativeSessionsForDisplay(state, groupedSessions)) {
          lines.push(this.renderNativeSessionLine(index++, state, session, { hideCwd: true }));
        }
      }
    }

    if (hiddenSubagentCount > 0) {
      lines.push(
        `(Hidden ${hiddenSubagentCount} subagent session${hiddenSubagentCount === 1 ? "" : "s"}; attach by native id if you need one.)`,
      );
    }

    return lines.join("\n");
  }

  private async listNativeSessions(
    workspace: WorkspaceRecord | undefined,
    scope: "current" | "all",
  ): Promise<NativeSessionListResult> {
    const entries = await Promise.all(
      providerKinds.map(async (provider) => {
        const catalog = this.nativeCatalogs[provider];
        if (!catalog) {
          return [] as NativeSessionSummary[];
        }
        if (scope === "current") {
          if (!workspace) {
            return [];
          }
          return catalog.listForWorkspace(workspace.rootPath);
        }
        return catalog.listAll();
      }),
    );

    const sessions = entries
      .flat()
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    const visible = sessions.filter((session) => session.source !== "subagent");
    return {
      sessions: visible,
      hiddenSubagentCount: sessions.length - visible.length,
    };
  }

  private async resolveNativeSession(
    workspace: WorkspaceRecord | undefined,
    scope: "current" | "all" | "auto",
    selector: string,
  ): Promise<(NativeSessionSummary & { defaultName: string }) | null> {
    const normalized = selector.trim();
    if (!normalized) {
      return null;
    }

    if (!/^\d+$/.test(normalized)) {
      for (const provider of providerKinds) {
        const catalog = this.nativeCatalogs[provider];
        if (!catalog) {
          continue;
        }
        const found = await catalog.findById(normalized);
        if (found) {
          return {
            ...found,
            defaultName: `${found.provider}-${shortId(found.nativeSessionId)}`,
          };
        }
      }
      return null;
    }

    const { sessions } = await this.listNativeSessions(
      workspace,
      scope === "all" ? "all" : "current",
    );
    const resolved = sessions[Number(normalized) - 1];
    if (!resolved) {
      return null;
    }

    return {
      ...resolved,
      defaultName: `${resolved.provider}-${shortId(resolved.nativeSessionId)}`,
    };
  }

  private attachNativeSession(
    state: HarnessState,
    binding: ChannelBindingRecord,
    provider: ProviderKind,
    nativeSessionId: string,
    requestedName?: string,
  ): string {
    const workspace = this.getSelectedWorkspace(state, binding);
    if (!workspace) {
      return "No workspace selected.";
    }

    const existing = state.sessions.find(
      (session) =>
        session.workspaceId === workspace.id &&
        session.provider === provider &&
        session.providerSessionId === nativeSessionId &&
        session.archivedAt === null,
    );
    if (existing) {
      binding.preferredProvider = provider;
      binding.currentSessionByProvider[provider] = existing.id;
      binding.updatedAt = nowIso();
      existing.updatedAt = nowIso();
      return `Using existing attached ${provider} session "${existing.name}" (${shortId(existing.id)}).`;
    }

    const session = this.createSession(
      state,
      workspace,
      provider,
      requestedName,
      nativeSessionId,
    );
    binding.preferredProvider = provider;
    binding.currentSessionByProvider[provider] = session.id;
    binding.updatedAt = nowIso();
    return `Attached ${provider} session "${session.name}" (${shortId(session.id)}) to native ${nativeSessionId}.`;
  }

  private renderNativeSessionLine(
    index: number,
    state: HarnessState,
    session: NativeSessionSummary,
    options?: { hideCwd?: boolean },
  ): string {
    const attached = state.sessions.find(
      (item) =>
        item.provider === session.provider &&
        item.providerSessionId === session.nativeSessionId &&
        item.archivedAt === null,
    );
    const attachedMark = attached ? ` [attached as ${attached.name}]` : "";
    const sourceMark = session.source === "subagent" ? " [subagent]" : "";
    const cwdPart = options?.hideCwd ? "" : ` -> ${session.cwd}`;
    return `${index}. ${session.provider} ${shortId(session.nativeSessionId)} ${session.nativeSessionId}${cwdPart}${attachedMark}${sourceMark}`;
  }

  private sortNativeSessionsForDisplay(
    state: HarnessState,
    sessions: NativeSessionSummary[],
  ): NativeSessionSummary[] {
    return [...sessions].sort((left, right) => {
      const leftAttached = this.isNativeSessionAttached(state, left);
      const rightAttached = this.isNativeSessionAttached(state, right);
      if (leftAttached !== rightAttached) {
        return leftAttached ? -1 : 1;
      }
      return right.startedAt.localeCompare(left.startedAt);
    });
  }

  private isNativeSessionAttached(
    state: HarnessState,
    session: NativeSessionSummary,
  ): boolean {
    return state.sessions.some(
      (item) =>
        item.provider === session.provider &&
        item.providerSessionId === session.nativeSessionId &&
        item.archivedAt === null,
    );
  }

  private groupSessionsByCwd(
    sessions: NativeSessionSummary[],
  ): Map<string, NativeSessionSummary[]> {
    const grouped = new Map<string, NativeSessionSummary[]>();
    for (const session of sessions) {
      const bucket = grouped.get(session.cwd) ?? [];
      bucket.push(session);
      grouped.set(session.cwd, bucket);
    }
    return new Map(
      [...grouped.entries()].sort((left, right) => left[0].localeCompare(right[0])),
    );
  }

  private resolveProvider(selector: string): ProviderKind | null {
    const normalized = selector.trim().toLowerCase();
    return providerKinds.find((provider) => provider === normalized) ?? null;
  }

  private getSelectedWorkspace(
    state: HarnessState,
    binding: ChannelBindingRecord,
  ): WorkspaceRecord | undefined {
    if (!binding.workspaceId) {
      return undefined;
    }
    return state.workspaces.find((workspace) => workspace.id === binding.workspaceId);
  }

  private getCurrentSession(
    state: HarnessState,
    binding: ChannelBindingRecord,
    provider: ProviderKind,
  ): SessionRecord | undefined {
    const sessionId = binding.currentSessionByProvider[provider];
    if (!sessionId) {
      return undefined;
    }
    return state.sessions.find(
      (session) => session.id === sessionId && session.archivedAt === null,
    );
  }

  private createSession(
    state: HarnessState,
    workspace: WorkspaceRecord,
    provider: ProviderKind,
    requestedName?: string,
    attachedProviderSessionId?: string,
  ): SessionRecord {
    const now = nowIso();
    const name = this.ensureUniqueSessionName(
      state,
      workspace.id,
      provider,
      requestedName?.trim() ||
        `${provider}-${this.countSessions(state, workspace.id, provider) + 1}`,
    );

    const id = createSessionId();
    const session: SessionRecord = {
      id,
      workspaceId: workspace.id,
      provider,
      name,
      providerSessionId:
        attachedProviderSessionId ?? (provider === "claude" ? id : null),
      status: "idle",
      turnCount: 0,
      lastInput: null,
      lastOutput: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };

    state.sessions.push(session);
    return session;
  }

  private countSessions(
    state: HarnessState,
    workspaceId: string,
    provider: ProviderKind,
  ): number {
    return state.sessions.filter(
      (session) =>
        session.workspaceId === workspaceId &&
        session.provider === provider &&
        session.archivedAt === null,
    ).length;
  }

  private ensureUniqueSessionName(
    state: HarnessState,
    workspaceId: string,
    provider: ProviderKind,
    baseName: string,
  ): string {
    const existing = new Set(
      state.sessions
        .filter(
          (session) =>
            session.workspaceId === workspaceId &&
            session.provider === provider &&
            session.archivedAt === null,
        )
        .map((session) => session.name.toLowerCase()),
    );

    if (!existing.has(baseName.toLowerCase())) {
      return baseName;
    }

    let index = 2;
    while (existing.has(`${baseName} ${index}`.toLowerCase())) {
      index += 1;
    }
    return `${baseName} ${index}`;
  }

  private ensureUniqueWorkspaceSlug(
    state: HarnessState,
    baseSlug: string,
  ): string {
    const existing = new Set(state.workspaces.map((workspace) => workspace.slug.toLowerCase()));
    if (!existing.has(baseSlug.toLowerCase())) {
      return baseSlug;
    }

    let index = 2;
    while (existing.has(`${baseSlug}-${index}`.toLowerCase())) {
      index += 1;
    }
    return `${baseSlug}-${index}`;
  }

  private slugifyWorkspaceName(name: string): string {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return slug || "workspace";
  }

  private listSessionsForWorkspace(
    state: HarnessState,
    workspaceId: string,
  ): SessionRecord[] {
    return state.sessions
      .filter(
        (session) =>
          session.workspaceId === workspaceId && session.archivedAt === null,
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private resolveSessionSelector(
    state: HarnessState,
    workspaceId: string,
    selector: string,
  ): SessionRecord | undefined {
    const sessions = this.listSessionsForWorkspace(state, workspaceId);
    const normalized = selector.trim().toLowerCase();

    if (/^\d+$/.test(normalized)) {
      const index = Number(normalized) - 1;
      return sessions[index];
    }

    return sessions.find(
      (session) =>
        session.id === selector ||
        shortId(session.id) === normalized ||
        session.name.toLowerCase() === normalized,
    );
  }

  private createOutbound(
    inbound: InboundChannelMessage,
    binding: ChannelBindingRecord,
    text: string,
    metadata?: Record<string, string>,
  ): OutboundChannelMessage {
    const message: OutboundChannelMessage = {
      channel: inbound.channel,
      scopeKey: inbound.scopeKey,
      text,
      ...(binding.lastReplyContext ? { replyContext: structuredClone(binding.lastReplyContext) } : {}),
    };

    if (metadata) {
      message.metadata = metadata;
    }

    return message;
  }

  private createResult(
    binding: ChannelBindingRecord,
    messages: OutboundChannelMessage[],
    session?: SessionRecord,
  ): HandleInboundResult {
    return {
      binding: structuredClone(binding),
      ...(session ? { session: structuredClone(session) } : {}),
      messages,
    };
  }
}
