# Better Call Codex Agent Guide

Last updated: 2026-03-23

## 1) Working Rules

- Always read `agent/timeline.md` and `agent/tasks.md` first.
- Keep changes minimal and reversible.
- Prefer tests first when adding features or fixing bugs.
- Update `agent/tasks.md` before and after substantial work.
- Update `agent/timeline.md` with a new top entry whenever a meaningful change lands.
- Do not change unrelated files just because they are nearby.

## 2) Current Project Boundaries

### Safe assumptions

- WeChat is the primary real channel.
- Codex is the primary real provider.
- Telegram is still pending as a real connector.
- Native Codex session attach/list/use is already implemented.
- Model override commands exist, but reasoning-profile presets are not finished.

### Things not to fake

- Do not claim Telegram real integration exists.
- Do not claim Claude real session discovery exists unless implemented and tested.
- Do not invent a provider reasoning-effort command unless the underlying CLI supports it in a stable, verified way.

## 3) Preferred Commands

Project validation:

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm check
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm build
```

Start local service:

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/node dist/src/server.js
```

WeChat command smoke tests:

```bash
curl -s http://127.0.0.1:4318/health
curl -s http://127.0.0.1:4318/state
```

Simulate inbound command:

```bash
curl -s -X POST http://127.0.0.1:4318/channels/wechat/inbound \
  -H 'content-type: application/json' \
  -d '{"senderId":"alice@im.wechat","conversationId":"thread-cli","contextToken":"ctx-cli","text":"/status"}'
```

## 4) Code Style Expectations

- TypeScript strictness must remain green.
- Keep ESM imports consistent with current repo style.
- Prefer small helper functions over giant branching blocks.
- Keep channel logic thin and push business rules into `HarnessService`.
- Keep provider-specific discovery / runtime logic isolated from core session semantics.

## 5) Testing Expectations

When changing core session logic:

- update `tests/harness-service.test.ts`
- add or extend focused tests before implementing

When changing runtime / channel behavior:

- update `tests/runtime.test.ts`
- update `tests/server.test.ts` if HTTP payload shape changes
- update `tests/wechat-connector.test.ts` for WeChat parsing/sending behavior

When changing native session discovery:

- update `tests/native-session-catalog.test.ts`

## 6) High-Risk Areas

- `src/core/harness-service.ts`
  This file owns state semantics, concurrency boundaries, and user-visible command behavior.
- `src/channels/clawbot-wechat-connector.ts`
  This file must stay compatible with the actual bridge protocol on the local machine.
- `src/domain/models.ts`
  Schema changes here affect state migration and backward compatibility.
- local `.env`
  Never commit or expose secrets.

## 7) Recommended Next Implementation Order

1. Telegram connector
2. auth / allowlist
3. provider preset / reasoning abstraction
4. Claude native-session catalog
5. transcript import

## 8) Handoff Rule

Before ending any substantial session:

1. run validation
2. update `agent/tasks.md`
3. prepend a new row to `agent/timeline.md`
4. if architecture changed, update `agent/project.md`
