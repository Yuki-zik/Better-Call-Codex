export type HarnessCommand =
  | { name: "help" }
  | { name: "status" }
  | { name: "workspace"; action: "list" }
  | { name: "workspace"; action: "use"; selector: string }
  | { name: "workspace"; action: "import"; pathText: string }
  | { name: "provider"; action: "list" }
  | { name: "provider"; action: "use"; selector: string }
  | { name: "session"; action: "list" }
  | { name: "session"; action: "new"; nameText?: string }
  | { name: "session"; action: "use"; selector: string }
  | { name: "session"; action: "archive"; selector: string };

export function parseHarnessCommand(text: string): HarnessCommand | null {
  const trimmed = normalizeCommandText(text.trim());
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { name: "help" };
  }

  const [first, ...rest] = parts;

  if (first === "help") {
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

  if (first === "workspace") {
    const [action, ...actionRest] = rest;
    if (!action || action === "list") {
      return { name: "workspace", action: "list" };
    }
    if (action === "import" && actionRest[0]) {
      return {
        name: "workspace",
        action: "import",
        pathText: actionRest.join(" ").trim(),
      };
    }
    if (action === "use" && actionRest[0]) {
      return {
        name: "workspace",
        action: "use",
        selector: actionRest.join(" ").trim(),
      };
    }
    return { name: "workspace", action: "list" };
  }

  if (first === "provider") {
    const [action, ...actionRest] = rest;
    if (!action || action === "list") {
      return { name: "provider", action: "list" };
    }
    if (action === "use" && actionRest[0]) {
      return {
        name: "provider",
        action: "use",
        selector: actionRest.join(" ").trim(),
      };
    }
    if (!rest[1] && rest[0]) {
      return { name: "provider", action: "use", selector: rest[0] };
    }
    return { name: "provider", action: "list" };
  }

  if (first === "session") {
    const [action, ...actionRest] = rest;
    if (!action || action === "list") {
      return { name: "session", action: "list" };
    }
    if (action === "new") {
      const nameText = actionRest.join(" ").trim();
      return {
        name: "session",
        action: "new",
        ...(nameText ? { nameText } : {}),
      };
    }
    if (action === "use" && actionRest[0]) {
      return {
        name: "session",
        action: "use",
        selector: actionRest.join(" ").trim(),
      };
    }
    if (action === "archive" && actionRest[0]) {
      return {
        name: "session",
        action: "archive",
        selector: actionRest.join(" ").trim(),
      };
    }
    return { name: "session", action: "list" };
  }

  return { name: "help" };
}

function normalizeCommandText(text: string): string {
  if (!text) {
    return text;
  }

  const aliases = [
    { prefix: "新建会话", normalized: "/session new" },
    { prefix: "新任务", normalized: "/session new" },
    { exact: "会话列表", normalized: "/session list" },
    { exact: "当前会话", normalized: "/status" },
    { prefix: "切换会话", normalized: "/session use" },
    { prefix: "导入项目", normalized: "/workspace import" },
    { exact: "项目列表", normalized: "/workspace list" },
    { prefix: "切换项目", normalized: "/workspace use" },
    { prefix: "切换模型", normalized: "/provider use" },
    { exact: "状态", normalized: "/status" },
  ] as const;

  for (const alias of aliases) {
    if ("exact" in alias) {
      if (text === alias.exact || text === `/${alias.exact}`) {
        return alias.normalized;
      }
      continue;
    }

    for (const candidate of [alias.prefix, `/${alias.prefix}`]) {
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
