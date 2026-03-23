[![中文说明](./README.md)](./README.md)
[![English Docs](./README.en.md)](./README.en.md)

# Better Call Codex

Better Call Codex is a personal-computer-first chat hub that lets you talk to local coding agents from WeChat or Telegram.

It is designed for this workflow:

- you already have `codex` or `claude` installed locally
- you want to keep working from a phone or chat app
- you want multiple named sessions per project
- you want explicit workspace, provider, and native-session switching instead of hidden CLI state

Today, the most complete path is:

- WeChat + Codex + native session attach

Telegram support is implemented and tested, but still needs real-world validation with a live bot token.

## What It Does

Better Call Codex keeps three concepts separate:

- `workspace`
  A local project directory you allow the system to use
- `provider session`
  A real native Codex or Claude session on your machine
- `channel binding`
  A single WeChat conversation or Telegram chat/topic

One WeChat conversation can therefore:

1. select workspace `harness`
2. keep one current `codex` session
3. keep one current `claude` session
4. switch between them without losing either
5. attach an existing native Codex thread and continue it from chat

## Current Status

### Working now

- real WeChat connector via ClawBot/iLink-compatible bridge
- real Codex live execution
- multiple sessions per workspace and provider
- native Codex session discovery and attach
- model override commands
- workspace import and switching from chat
- Chinese aliases for common WeChat commands
- allowlists for WeChat and Telegram
- HTTP debug API

### Implemented but not fully validated in production

- Telegram Bot API connector
- Claude provider adapter

### Not finished yet

- real Telegram smoke test with a live token
- Claude native session discovery
- provider preset / reasoning-profile commands
- transcript import from OpenClaw or other external systems
- streaming partial replies
- admin command layer for managing allowlists at runtime

## Fastest Path

If you want the simplest deployment path, use:

- WeChat
- Codex
- your current computer

Quick start:

```bash
cd /Users/a-znk/code/harness
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm install
cp .env.example .env
```

Set at least:

```env
HARNESS_ENABLE_WECHAT=true
HARNESS_LIVE_PROVIDERS=true
HARNESS_DEFAULT_PROVIDER=codex

WECHAT_BOT_TOKEN=your-wechat-token
WECHAT_BASE_URL=https://your-wechat-bridge.example.com
WECHAT_SYNC_CURSOR_FILE=./data/wechat-sync-cursor.txt

CODEX_COMMAND=/Applications/Codex.app/Contents/Resources/codex
```

Start:

```bash
cd /Users/a-znk/code/harness
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm dev
```

Health check:

```bash
curl http://127.0.0.1:4318/health
```

Then in WeChat:

```text
导入项目 /Users/a-znk/code/harness
状态
请帮我总结这个仓库是做什么的
```

If you receive a real Codex reply, deployment works.

## Deployment Paths

### WeChat + Codex

Recommended and most complete today.

- [WeChat deployment guide (Chinese)](./docs/WECHAT_DEPLOYMENT.md)
- [WeChat deployment guide (English)](./docs/WECHAT_DEPLOYMENT.en.md)

### Telegram + Codex

Implemented in code, but still pending live token validation.

Minimum config:

```env
HARNESS_ENABLE_TELEGRAM=true
HARNESS_LIVE_PROVIDERS=true
HARNESS_DEFAULT_PROVIDER=codex

TELEGRAM_BOT_TOKEN=your-telegram-token
TELEGRAM_UPDATE_OFFSET_FILE=./data/telegram-update-offset.json
```

Optional filters:

```env
TELEGRAM_ALLOW_FROM=123456789
TELEGRAM_ALLOW_CHATS=-1001234567890
```

## Core Commands

### Workspace

```text
/status
/workspace list
/workspace use <slug>
/workspace import <path>
```

### Provider and model

```text
/provider list
/provider current
/provider use <codex|claude>
/provider model current
/provider model use <model>
/provider model clear
```

### Better Call Codex sessions

```text
/session list
/session new [name]
/session use <id|name|index>
/session archive <id|name|index>
/new [name]
/switch <id|name|index>
```

### Native session workflow

```text
/session attach <codex|claude> <native-id> [name]
/session native list current
/session native list all
/session native use [current|all] <index|native-id>
```

## Validation

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm check
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm build
```
