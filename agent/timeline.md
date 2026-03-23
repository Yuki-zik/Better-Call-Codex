# Better Call Codex Timeline

| 时间 | 动作 | 动机 | 结果 |
|---|---|---|---|
| 2026-03-23 22:15 CST | 深度重构 README 为傻瓜式部署文档 | 当前 README 对新人来说仍偏“功能说明”，缺少一条龙的上手、配置、命令、排错路径 | README 已重组为从零部署、配置、命令、架构、排错一体化文档 |
| 2026-03-23 22:05 CST | 实现 Telegram Bot connector 与配置化 allowlist | 提升高优先级可用性，让系统具备第二渠道接入能力并补齐最基础的渠道安全边界 | 新增 Telegram polling connector、WeChat/Telegram allowlist、相关测试与文档 |
| 2026-03-23 21:50 CST | 建立 `agent/` 交接文档体系并整理当前完成度 | 让后续 AI 代理和人工协作者能低摩擦接手当前项目状态 | 新增 `agent/project.md`、`agent/tasks.md`、`agent/timeline.md`、`agent/agents.md` |
| 2026-03-23 20:15 CST | 优化原生会话列表输出，按目录分组并默认隐藏 subagent 噪音 | 当前目录会话列表过长，影响微信端选择可用原生会话 | `/session native list current|all` 可读性明显提升 |
| 2026-03-23 19:35 CST | 增加原生会话发现与模型切换命令 | 让微信内可查看/切换本机可用 Codex 会话，并可切换 provider model | 新增 `/session native ...` 与 `/provider model ...` 命令 |
| 2026-03-23 19:14 CST | 增加 `/session attach` 原生命令 | 支持把已有 Codex / Claude 原生会话接入 Better Call Codex 并继续对话 | 通过测试与命令行续接验证 |
| 2026-03-23 17:30 CST | 打通 Better Call Codex 与微信桥接，修复协议兼容问题 | 需要让 WeChat 真实轮询与回包可用，而不只是 HTTP 模拟 | WeChat 连接成功，能通过微信实际收发消息 |
| 2026-03-23 17:05 CST | 暂时关闭 OpenClaw 的 `openclaw-weixin` 插件 | OpenClaw 与 Better Call Codex 同时回复同一微信消息，造成冲突 | OpenClaw 微信插件被关闭，仅 Better Call Codex 回复 |
| 2026-03-23 16:45 CST | 实现 WeChat runtime、replyContext、workspace import、中文命令别名与并发模型 | 把项目从“模拟 harness”推进到“可运行的微信 + Codex 中枢” | Phase 1 核心能力成型，测试与文档齐备 |
| 2026-03-23 01:35 CST | 加强 HTTP 边界验证与 file store 容错 | 解决输入未校验和坏状态静默回空的问题 | 新增 HTTP / file store 回归测试并通过 |
| 2026-03-23 01:18 CST | 初步梳理仓库结构与多 provider / multi-session 目标 | 建立对当前代码库形态和扩展方向的完整认知 | 明确仓库为早期但结构清晰的 TypeScript harness |
