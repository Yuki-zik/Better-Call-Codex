<p align="center">
  <kbd><a href="/Users/a-znk/code/harness/docs/WECHAT_DEPLOYMENT.md">中文说明</a></kbd>&ensp;|&ensp;<kbd><a href="/Users/a-znk/code/harness/docs/WECHAT_DEPLOYMENT.en.md">English</a></kbd>
</p>

# Better Call Codex WeChat Deployment Guide

This guide is written for a single developer on a personal Mac who wants to get Better Call Codex working in WeChat with as little guesswork as possible.

Deployment target:

- WeChat as the chat front end
- `codex` as the first live provider
- a local Better Call Codex process running on your computer
- a ClawBot/iLink-compatible WeChat bridge

If you already have a working bridge and know your token and base URL, you can jump straight to configuration.

## What You Will End Up With

After finishing this guide:

- Better Call Codex will poll WeChat for new messages
- it will route them to local `codex`
- it will send final text replies back to WeChat
- you will be able to import local workspaces and manage sessions from chat

## Before You Start

You need:

- macOS
- a usable WeChat desktop client
- working `codex`
- Node.js
- `pnpm`
- a ClawBot/iLink-compatible WeChat bridge account

On Apple Silicon Macs, `node` and `pnpm` are often under `/opt/homebrew/bin`.

Example:

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm --version
```

## Step 1: Verify Local Prerequisites

```bash
codex --version
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/node --version
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm --version
```

## Step 2: Get WeChat Bridge Credentials

Better Call Codex does not generate `WECHAT_BOT_TOKEN` by itself. These values come from the WeChat bridge layer.

If you already connected your phone WeChat to OpenClaw, the fastest path is to read the account file OpenClaw already wrote:

```bash
ls ~/.openclaw/openclaw-weixin/accounts
cat ~/.openclaw/openclaw-weixin/accounts/<your-account-file>.json
```

Look for:

- `token`
- `baseUrl`

Then map them to:

- `WECHAT_BOT_TOKEN`
- `WECHAT_BASE_URL`

The simplest reference project is:

- [wechat-agent-channel](https://github.com/sitarua/wechat-agent-channel)

Typical output file:

```bash
cat ~/.wechat-agent-channel/wechat/account.json
```

Map:

- `token` -> `WECHAT_BOT_TOKEN`
- `baseUrl` -> `WECHAT_BASE_URL`

## Step 3: Configure Better Call Codex

```bash
cd /Users/a-znk/code/harness
cp .env.example .env
```

Set at least:

```env
HARNESS_PORT=4318
HARNESS_STATE_FILE=./data/harness-state.json
HARNESS_DEFAULT_PROVIDER=codex
HARNESS_LIVE_PROVIDERS=true
HARNESS_ENABLE_WECHAT=true
HARNESS_ENABLE_TELEGRAM=false

WECHAT_BOT_TOKEN=replace-with-your-token
WECHAT_BASE_URL=replace-with-your-baseUrl
WECHAT_POLL_TIMEOUT_MS=25000
WECHAT_SYNC_CURSOR_FILE=./data/wechat-sync-cursor.txt
WECHAT_ALLOW_FROM=

CODEX_COMMAND=/Applications/Codex.app/Contents/Resources/codex
CODEX_MODEL=
CODEX_TIMEOUT_MS=120000
CODEX_SANDBOX=workspace-write
CODEX_APPROVAL=never
```

## Step 4: Install and Validate

```bash
cd /Users/a-znk/code/harness
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm install
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm check
```

## Step 5: Start

```bash
cd /Users/a-znk/code/harness
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm dev
```

## Step 6: Local Health Check

```bash
curl http://127.0.0.1:4318/health
```

Expected:

```json
{
  "ok": true
}
```

## Step 7: First End-to-End WeChat Test

Send these in WeChat:

```text
导入项目 /Users/a-znk/code/harness
状态
请帮我总结这个仓库是做什么的
```

If you receive a real Codex reply, deployment is working.

## Common Problems

### `node` or `pnpm` not found

Use:

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm dev
```

### Service starts but no WeChat reply

Check:

1. `HARNESS_ENABLE_WECHAT=true`
2. `HARNESS_LIVE_PROVIDERS=true`
3. `WECHAT_BOT_TOKEN` is correct
4. `WECHAT_BASE_URL` is correct
5. `WECHAT_ALLOW_FROM` is not blocking you
6. local `codex` works directly

### `Access denied`

Your allowlist is blocking the chat.

Check:

- `WECHAT_ALLOW_FROM`

## Success Checklist

You are done when:

- `codex --version` works
- `pnpm check` works
- `.env` has valid WeChat values
- `pnpm dev` starts successfully
- `curl http://127.0.0.1:4318/health` works
- WeChat can import a workspace
- WeChat gets a real Codex reply
