export type HarnessCommand =
  | { name: "help" }
  | { name: "invalid"; message: string }
  | { name: "status" }
  | { name: "workspace"; action: "list" }
  | { name: "workspace"; action: "use"; selector: string }
  | { name: "workspace"; action: "import"; pathText: string }
  | { name: "provider"; action: "list" }
  | { name: "provider"; action: "current" }
  | { name: "provider"; action: "use"; selector: string }
  | { name: "provider"; action: "model"; subaction: "current" }
  | { name: "provider"; action: "model"; subaction: "use"; modelName: string }
  | { name: "provider"; action: "model"; subaction: "clear" }
  | { name: "session"; action: "list" }
  | { name: "session"; action: "current" }
  | { name: "session"; action: "history"; limit: number }
  | { name: "session"; action: "new"; nameText?: string }
  | {
      name: "session";
      action: "attach";
      providerSelector: string;
      nativeSessionId: string;
      nameText?: string;
    }
  | { name: "session"; action: "native-list"; scope: "current" | "all" }
  | {
      name: "session";
      action: "native-use";
      scope: "current" | "all" | "auto";
      selector: string;
    }
  | { name: "session"; action: "use"; selector: string }
  | { name: "session"; action: "archive"; selector: string };

export function parseHarnessCommand(text: string): HarnessCommand | null {
  const raw = text.trim();
  if (!raw.startsWith("/")) {
    return null;
  }

  const trimmed = normalizeCommandText(raw);
  if (trimmed === "/") {
    return { name: "help" };
  }

  const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { name: "help" };
  }

  const [first, ...rest] = parts;

  if (first === "help" || first === "commands" || first === "?") {
    return { name: "help" };
  }

  if (first === "status") {
    return { name: "status" };
  }

  if (first === "new") {
    const nameText = rest.join(" ").trim();
    return {
      name: "session",
      action: "new",
      ...(nameText ? { nameText } : {}),
    };
  }

  if (first === "sessions") {
    return { name: "session", action: "list" };
  }

  if (first === "switch" && rest[0]) {
    return { name: "session", action: "use", selector: rest.join(" ").trim() };
  }

  if (first === "history") {
    return parseSessionHistory(rest);
  }

  if (first === "workspace") {
    const [action, ...actionRest] = rest;
    if (!action || action === "list") {
      return { name: "workspace", action: "list" };
    }
    if (action === "import") {
      if (!actionRest[0]) {
        return invalid("Usage: /workspace import <path>");
      }
      return {
        name: "workspace",
        action: "import",
        pathText: actionRest.join(" ").trim(),
      };
    }
    if (action === "use") {
      if (!actionRest[0]) {
        return invalid("Usage: /workspace use <slug>");
      }
      return {
        name: "workspace",
        action: "use",
        selector: actionRest.join(" ").trim(),
      };
    }
    return invalid([
      "Unknown workspace command.",
      "Usage:",
      "/workspace list",
      "/workspace use <slug>",
      "/workspace import <path>",
    ].join("\n"));
  }

  if (first === "provider") {
    const [action, ...actionRest] = rest;
    if (!action || action === "list") {
      return { name: "provider", action: "list" };
    }
    if (action === "current") {
      return { name: "provider", action: "current" };
    }
    if (action === "model") {
      const [modelAction, ...modelRest] = actionRest;
      if (!modelAction || modelAction === "current" || modelAction === "list") {
        return { name: "provider", action: "model", subaction: "current" };
      }
      if (modelAction === "clear") {
        return { name: "provider", action: "model", subaction: "clear" };
      }
      if (modelAction === "use") {
        if (!modelRest[0]) {
          return invalid("Usage: /provider model use <model>");
        }
        return {
          name: "provider",
          action: "model",
          subaction: "use",
          modelName: modelRest.join(" ").trim(),
        };
      }
      return invalid([
        "Unknown provider model command.",
        "Usage:",
        "/provider model current",
        "/provider model use <model>",
        "/provider model clear",
      ].join("\n"));
    }
    if (action === "use") {
      if (!actionRest[0]) {
        return invalid("Usage: /provider use <codex|claude>");
      }
      return {
        name: "provider",
        action: "use",
        selector: actionRest.join(" ").trim(),
      };
    }
    if (rest.length === 1) {
      return { name: "provider", action: "use", selector: action };
    }
    return invalid([
      "Unknown provider command.",
      "Usage:",
      "/provider list",
      "/provider current",
      "/provider use <codex|claude>",
      "/provider model current",
      "/provider model use <model>",
      "/provider model clear",
    ].join("\n"));
  }

  if (first === "session") {
    const [action, ...actionRest] = rest;
    if (!action || action === "list") {
      return { name: "session", action: "list" };
    }
    if (action === "current") {
      return { name: "session", action: "current" };
    }
    if (action === "history") {
      return parseSessionHistory(actionRest);
    }
    if (action === "native") {
      const [nativeAction, ...nativeRest] = actionRest;
      if (!nativeAction || nativeAction === "list") {
        if (nativeRest[0] && nativeRest[0] !== "current" && nativeRest[0] !== "all") {
          return invalid("Usage: /session native list [current|all]");
        }
        const scope = nativeRest[0] === "all" ? "all" : "current";
        return { name: "session", action: "native-list", scope };
      }
      if (nativeAction === "use") {
        if (!nativeRest[0]) {
          return invalid("Usage: /session native use [current|all] <index|native-id>");
        }
        const [scopeOrSelector, maybeSelector] = nativeRest;
        if ((scopeOrSelector === "current" || scopeOrSelector === "all") && maybeSelector) {
          return {
            name: "session",
            action: "native-use",
            scope: scopeOrSelector,
            selector: nativeRest.slice(1).join(" ").trim(),
          };
        }
        if ((scopeOrSelector === "current" || scopeOrSelector === "all") && !maybeSelector) {
          return invalid("Usage: /session native use [current|all] <index|native-id>");
        }
        return {
          name: "session",
          action: "native-use",
          scope: "auto",
          selector: nativeRest.join(" ").trim(),
        };
      }
      return invalid([
        "Unknown session native command.",
        "Usage:",
        "/session native list [current|all]",
        "/session native use [current|all] <index|native-id>",
      ].join("\n"));
    }
    if (action === "new") {
      const nameText = actionRest.join(" ").trim();
      return {
        name: "session",
        action: "new",
        ...(nameText ? { nameText } : {}),
      };
    }
    if (action === "attach") {
      if (!actionRest[0] || !actionRest[1]) {
        return invalid("Usage: /session attach <codex|claude> <native-id> [name]");
      }
      const [providerSelector, nativeSessionId, ...nameParts] = actionRest;
      const nameText = nameParts.join(" ").trim();
      return {
        name: "session",
        action: "attach",
        providerSelector,
        nativeSessionId,
        ...(nameText ? { nameText } : {}),
      };
    }
    if (action === "use") {
      if (!actionRest[0]) {
        return invalid("Usage: /session use <id|name|index>");
      }
      return {
        name: "session",
        action: "use",
        selector: actionRest.join(" ").trim(),
      };
    }
    if (action === "archive") {
      if (!actionRest[0]) {
        return invalid("Usage: /session archive <id|name|index>");
      }
      return {
        name: "session",
        action: "archive",
        selector: actionRest.join(" ").trim(),
      };
    }
    return invalid([
      "Unknown session command.",
      "Usage:",
      "/session current",
      "/session history [count]",
      "/session list",
      "/session new [name]",
      "/session attach <codex|claude> <native-id> [name]",
      "/session native list [current|all]",
      "/session native use [current|all] <index|native-id>",
      "/session use <id|name|index>",
      "/session archive <id|name|index>",
    ].join("\n"));
  }

  return invalid(`Unknown command: /${first}\nUse / or /help to list commands.`);
}

function normalizeCommandText(text: string): string {
  if (!text) {
    return text;
  }

  const aliases = [
    { exact: "帮助", normalized: "/help" },
    { exact: "命令", normalized: "/help" },
    { exact: "命令列表", normalized: "/help" },
    { prefix: "新建会话", normalized: "/session new" },
    { prefix: "新任务", normalized: "/session new" },
    { exact: "会话列表", normalized: "/session list" },
    { exact: "当前会话详情", normalized: "/session current" },
    { exact: "会话详情", normalized: "/session current" },
    { prefix: "会话历史", normalized: "/session history" },
    { exact: "原生会话列表", normalized: "/session native list current" },
    { exact: "所有原生会话", normalized: "/session native list all" },
    { exact: "当前目录会话", normalized: "/session native list current" },
    { prefix: "切换原生会话", normalized: "/session native use" },
    { exact: "当前会话", normalized: "/status" },
    { prefix: "切换会话", normalized: "/session use" },
    { prefix: "导入项目", normalized: "/workspace import" },
    { exact: "项目列表", normalized: "/workspace list" },
    { prefix: "切换项目", normalized: "/workspace use" },
    { exact: "当前提供方", normalized: "/provider current" },
    { prefix: "切换提供方", normalized: "/provider use" },
    { prefix: "切换模型", normalized: "/provider use" },
    { exact: "当前模型", normalized: "/provider model current" },
    { prefix: "切换具体模型", normalized: "/provider model use" },
    { exact: "状态", normalized: "/status" },
  ] as const;

  for (const alias of aliases) {
    if ("exact" in alias) {
      if (text === `/${alias.exact}`) {
        return alias.normalized;
      }
      continue;
    }

    for (const candidate of [`/${alias.prefix}`]) {
      if (text === candidate) {
        return alias.normalized;
      }

      for (const separator of [" ", ":", "："]) {
        const commandPrefix = `${candidate}${separator}`;
        if (text.startsWith(commandPrefix)) {
          const rest = text.slice(commandPrefix.length).trim();
          return rest ? `${alias.normalized} ${rest}` : alias.normalized;
        }
      }
    }
  }

  return text;
}

function invalid(message: string): HarnessCommand {
  return { name: "invalid", message };
}

function parseSessionHistory(parts: string[]): HarnessCommand {
  if (!parts[0]) {
    return { name: "session", action: "history", limit: 5 };
  }

  const rawLimit = parts[0]?.trim();
  if (!rawLimit || parts.length > 1 || !/^\d+$/.test(rawLimit)) {
    return invalid("Usage: /session history [count]");
  }

  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    return invalid("History count must be between 1 and 20.");
  }

  return { name: "session", action: "history", limit };
}
