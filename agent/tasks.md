# Better Call Codex Tasks

Last updated: 2026-03-23

| 优先级 | 任务 | 状态 | 负责人 | 截止 |
|---|---|---|---|---|
| P0 | 稳定微信 + Codex 实机链路，确保 workspace / session / native attach 命令可持续使用 | ✅ | AI Agent | 已完成 |
| P0 | 建立 `agent/` 文档交接体系（project/tasks/timeline/agents） | ✅ | AI Agent | 已完成 |
| P0 | 深度重构 README，做到新用户可按文档完成傻瓜式部署 | ✅ | AI Agent | 已完成 |
| P0 | 将文档改为中文优先，并补中英切换与更直观的微信凭据获取说明 | ✅ | AI Agent | 已完成 |
| P1 | 实现 Telegram 真实 connector，并复用现有 runtime / binding / session 语义 | ✅ | AI Agent | 已完成（待实机 token 验证） |
| P1 | 增加渠道鉴权、allowlist 和管理员控制，避免任意聊天控制本机 workspace | ⏳ | AI Agent | 部分完成（allowlist 已完成，admin 控制待补） |
| P1 | 为 provider 模型/档位设计更清晰的 preset 体系，并映射到底层 CLI 能力 | ⏳ | AI Agent | TBD |
| P1 | 为 Claude 增加原生会话发现、列举和 attach 能力 | ⏳ | AI Agent | TBD |
| P2 | 增加 transcript import / OpenClaw 会话迁移能力 | ⏳ | AI Agent | TBD |
| P2 | 增加流式输出、typing、重试和更好的可观测性 | ⏳ | AI Agent | TBD |
| P2 | 为原生会话列表补更多过滤维度（exact/child/provider/attached-only） | ⏳ | AI Agent | TBD |
| P3 | 补充 CI 自动检查（`pnpm check` + `pnpm build`） | ⏳ | AI Agent | TBD |
