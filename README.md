# Better Call Codex

A development hub for a remote coding system that can grow into:

- multi-provider: `codex` + `claude`
- multi-session: multiple sessions per workspace and per provider
- multi-channel: Telegram + WeChat

This repo is intentionally a message-and-agent hub first, not a finished bot. The goal is to make the hard parts testable before wiring real Telegram or WeChat APIs:

- session modeling
- channel binding
- provider routing
- workspace isolation
- live vs dry-run execution

## Why This Exists

The existing repos we studied each got an important piece right, but none matched the full target shape:

- `claude-code-telegram`
  Great product quality, but its happy path is auto-resume per user + directory.
- `chatcode`
  Strong project and session picker ideas inside Telegram.
- `remote-agentic-coding-system`
  Good provider-agnostic orchestration and conversation persistence.
- `wechat-agent-channel`
  Small, understandable channel bridge and channel-native commands.
- `ccmanager`
  Treats sessions and projects as first-class objects instead of incidental CLI state.

Better Call Codex combines the useful parts of those approaches:

- channel conversation is not the same thing as provider session
- workspace selection is explicit
- provider selection is explicit
- each binding keeps a current `codex` session and a current `claude` session separately
- multiple sessions in the same workspace stay addressable by name or index

## Core Model

The model is deliberately simple:

- `Workspace`
  An allowlisted project root with a slug and allowed providers.
- `Session`
  A hub-level session record tied to one workspace and one provider.
- `ChannelBinding`
  A Telegram or WeChat conversation scope.
  It points to one selected workspace and keeps one current session per provider.

That means a single Telegram topic or WeChat sender can do this cleanly:

1. bind to workspace `taskvision`
2. keep current `codex` session = `refactor-homepage`
3. keep current `claude` session = `review-plan`
4. switch between them without losing either

## Current Capabilities

- file-backed state store
- in-memory test store
- explicit workspace registration
- chat-driven workspace import
- Telegram and WeChat inbound payload mappers
- binding-level serialization with cross-binding parallel turns
- command routing for workspace/provider/session control
- shell-backed provider adapters for `codex` and `claude`
- channel runtime with pluggable connectors
- ClawBot-compatible WeChat polling connector
- safe default dry-run mode
- tests for multi-session behavior, runtime, and WeChat connector parsing

## Commands

These commands work through either Telegram or WeChat inbound messages:

```text
/status
/workspace list
/workspace use <slug>
/workspace import <path>
/provider list
/provider use <codex|claude>
/session list
/session new [name]
/session use <id|name|index>
/session archive <id|name|index>
/new [name]
/switch <id|name|index>
```

WeChat also supports these Chinese aliases:

```text
状态
导入项目 <path>
项目列表
切换项目 <slug>
切换模型 <codex|claude>
新建会话 [name]
会话列表
当前会话
切换会话 <id|name|index>
```

## API

Better Call Codex exposes a small HTTP API for development.

### Health

```bash
curl http://127.0.0.1:4318/health
```

### Register a workspace

```bash
curl -X POST http://127.0.0.1:4318/admin/workspaces \
  -H 'content-type: application/json' \
  -d '{
    "slug": "taskvision",
    "displayName": "Taskvision",
    "rootPath": "/Users/a-znk/code/taskvision",
    "allowedProviders": ["codex", "claude"]
  }'
```

### Simulate Telegram inbound

```bash
curl -X POST http://127.0.0.1:4318/channels/telegram/inbound \
  -H 'content-type: application/json' \
  -d '{
    "chatId": 1001,
    "topicId": 12,
    "userId": 42,
    "replyToMessageId": 99,
    "text": "/workspace use taskvision"
  }'
```

### Simulate WeChat inbound

```bash
curl -X POST http://127.0.0.1:4318/channels/wechat/inbound \
  -H 'content-type: application/json' \
  -d '{
    "senderId": "alice@im.wechat",
    "conversationId": "thread-1",
    "contextToken": "ctx-123",
    "text": "/session list"
  }'
```

### Inspect state

```bash
curl http://127.0.0.1:4318/state
```

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm dev
```

If you want the full WeChat deployment flow, including how to obtain `WECHAT_BOT_TOKEN` and `WECHAT_BASE_URL`, follow [docs/WECHAT_DEPLOYMENT.md](/Users/a-znk/code/harness/docs/WECHAT_DEPLOYMENT.md).

By default:

- providers run in dry-run mode
- no real Telegram API calls are made
- no real WeChat API calls are made unless `HARNESS_ENABLE_WECHAT=true`

This is intentional. The default loop is:

1. register workspace
2. send simulated inbound messages
3. inspect state transitions
4. replace dry-run provider/channel pieces incrementally

## Real WeChat Runtime

Enable the built-in ClawBot-compatible WeChat connector:

```bash
HARNESS_ENABLE_WECHAT=true
WECHAT_BOT_TOKEN=...
WECHAT_BASE_URL=https://your-wechat-bridge.example.com
WECHAT_SYNC_CURSOR_FILE=./data/wechat-sync-cursor.txt
```

Then start the process as usual:

```bash
pnpm dev
```

The same process will:

- expose the local HTTP debug API
- poll WeChat `getupdates`
- route messages through the Better Call Codex service
- send final text replies back with `sendmessage`

## Live Provider Mode

Set this when you want Better Call Codex to actually invoke local CLIs:

```bash
HARNESS_LIVE_PROVIDERS=true
```

Current behavior:

- `codex`
  Best-effort non-interactive `exec`/`resume` flow with JSON event parsing.
- `claude`
  Best-effort `-p` flow with persisted session identity.

This is intentionally conservative. Better Call Codex should be stable in dry-run mode first, then promoted to live mode as the provider contract hardens.

## File Layout

```text
src/app
src/channels
src/core
src/domain
src/providers
src/storage
tests
```

## Immediate Next Steps

The next useful layers to add are:

1. channel auth and allowlists
2. real Telegram adapter using the same runtime connector interface
3. richer provider result parsing and streaming
4. workspace path guardrails and admin controls
5. provider/session-level locking for shared session reuse across bindings
6. delivery retries and richer connector observability

## Verification

```bash
pnpm build
pnpm test
```
