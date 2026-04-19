# Better Call Codex Timeline

| 时间 | 动作 | 动机 | 结果 |
|---|---|---|---|
| 2026-03-24 16:31 CST | 将本地仓库目录名对齐为远端仓库名，并同步绝对路径示例 | 当前工作目录仍叫 `harness`，与远端仓库 `Better-Call-Codex` 不一致，容易让文档示例、workspace 名称示例和原生会话测试路径产生歧义 | 仓库目录已重命名为 `Better-Call-Codex`，README/部署文档/原生会话测试中的绝对路径与 workspace 示例已同步，旧目录引用已清除 |
| 2026-03-24 15:53 CST | 增加当前会话详情与本地历史查看能力 | 用户需要在接入原生会话后理解“当前会话是什么状态、有哪些本地可见历史”，而现有系统只有 `lastInput/lastOutput` 摘要，不足以支撑可靠理解 | 新增 `/session current`、`/session history [n]`、`/history [n]` 与中文别名，持久化本地 `sessionTurns`，对 attach 会话明确说明“仅显示接管后历史”，兼容旧状态文件，`pnpm check` 与 `pnpm build` 通过 |
| 2026-03-24 00:42 CST | 对最新代码执行微信侧 smoke test 并将结果写入部署文档 | 需要确认当前构建下的真实微信桥、服务进程与 live Codex provider 是否仍然可用，并给用户一个可审阅的测试记录 | 已重启到最新服务进程，验证 health/state、真实 `getupdates` 200、真实 `sendmessage` 200、slash-first 命令表返回正常、live Codex provider 返回 `SMOKE_LIVE_PROVIDER_OK_20260324`，结果已写入文档 |
| 2026-03-24 00:34 CST | 收紧命令体系并修复 native session 选择一致性 | 微信端命令需要统一以 `/` 启动，同时原生会话编号与作用域选择存在高风险误选问题，文档与帮助输出也需要同步 | 命令改为 slash-first、支持 `/`/`/help`/`/命令列表` 显示命令表，native session 按展示顺序与作用域一致解析，README/部署文档已同步，测试与构建通过 |
| 2026-03-24 00:10 CST | 按用户提供的产品页模式重写中英文 README，并强化微信凭据获取说明 | 现有 README 虽然信息完整，但没有完全对齐用户期望的展示风格，且 token/baseUrl 获取路径还可以更直白 | 中文 README 已按产品页风格重写，英文 README 同步到同一模式，微信部署说明保留更细的分步指导 |
| 2026-03-23 22:28 CST | 将 README / 部署文档改为中文优先并加入中英切换 | 需要让首屏更像产品说明页，同时把 `WECHAT_BOT_TOKEN` / `WECHAT_BASE_URL` 的获取方法讲到用户一眼能懂 | README 与微信部署文档已支持中英切换，且增加 OpenClaw 场景下的最简凭据获取说明 |
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
