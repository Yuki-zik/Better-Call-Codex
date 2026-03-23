# Better Call Codex WeChat Deployment Guide

This guide is written for a single developer on a personal Mac who wants to get Better Call Codex working in WeChat with the least possible guesswork.

The deployment target is:

- WeChat as the chat front end
- `codex` as the first live provider
- a local Better Call Codex process running on your computer
- a ClawBot/iLink-compatible WeChat bridge

If you already have a working ClawBot/iLink bridge and know your token and base URL, you can skip to [Configure Better Call Codex](#configure-better-call-codex).

## What You Will End Up With

After finishing this guide:

- Better Call Codex will poll WeChat for new messages
- It will route those messages to local `codex`
- It will send final text replies back to WeChat
- You will be able to import local workspaces from chat and manage sessions in WeChat

## Before You Start

You need these things on the same machine:

- macOS
- WeChat desktop already usable on your machine
- `codex` CLI installed and runnable
- Node.js and `pnpm`
- a ClawBot/iLink-compatible WeChat bridge account

On Apple Silicon Macs, `node` and `pnpm` are often installed under `/opt/homebrew/bin`. If `node` or `pnpm` is "not found", use the command prefix below in all examples:

```bash
PATH=/opt/homebrew/bin:$PATH
```

Example:

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm --version
```

## Step 1: Verify Local Prerequisites

Run these commands:

```bash
codex --version
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/node --version
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm --version
```

Expected result:

- all three commands succeed
- `codex` prints a version
- `node` prints a version
- `pnpm` prints a version

If `codex` fails, install or fix Codex first before continuing.

## Step 2: Get WeChat Bridge Credentials

Better Call Codex does not create `WECHAT_BOT_TOKEN` by itself. These values come from the WeChat bridge layer.

The easiest way to get them is to use the reference project:

- [wechat-agent-channel](https://github.com/sitarua/wechat-agent-channel)

Its setup flow handles:

- WeChat login QR code
- bridge credential persistence
- default provider selection

### Option A: You Already Have a Bridge

If someone already gave you:

- a bot token
- a base URL

then keep those ready and skip to [Configure Better Call Codex](#configure-better-call-codex).

### Option B: Use `wechat-agent-channel` to Create Them

Clone the repo somewhere outside this project:

```bash
cd ~/code
git clone https://github.com/sitarua/wechat-agent-channel.git
cd wechat-agent-channel
```

Install its dependencies:

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm install
```

Run its setup:

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm run setup
```

What happens during setup:

1. it shows a WeChat login QR code
2. you scan it with WeChat
3. it stores bridge credentials locally
4. it asks you to choose a default provider

For Better Call Codex, choose `Codex` first unless you specifically want to debug Claude later.

### Find the Saved Credentials

After setup, inspect this file:

```bash
cat ~/.wechat-agent-channel/wechat/account.json
```

You are looking for two values:

- `token`
- `baseUrl`

Typical shape:

```json
{
  "token": "your-token-here",
  "baseUrl": "https://your-wechat-bridge.example.com"
}
```

Map them like this:

- `token` -> `WECHAT_BOT_TOKEN`
- `baseUrl` -> `WECHAT_BASE_URL`

If that file does not exist, the bridge setup did not complete successfully. Re-run the setup and finish the QR login flow first.

## Step 3: Configure Better Call Codex

Go back to this repo:

```bash
cd /Users/a-znk/code/harness
```

Create your local environment file:

```bash
cp .env.example .env
```

Open `.env` and set it like this:

```env
HARNESS_PORT=4318
HARNESS_STATE_FILE=./data/harness-state.json
HARNESS_DEFAULT_PROVIDER=codex
HARNESS_LIVE_PROVIDERS=true
HARNESS_ENABLE_WECHAT=true
HARNESS_ENABLE_TELEGRAM=false

WECHAT_BOT_TOKEN=replace-with-token-from-account-json
WECHAT_BASE_URL=replace-with-baseUrl-from-account-json
WECHAT_POLL_TIMEOUT_MS=25000
WECHAT_SYNC_CURSOR_FILE=./data/wechat-sync-cursor.txt

TELEGRAM_BOT_TOKEN=

CODEX_COMMAND=codex
CODEX_MODEL=
CODEX_TIMEOUT_MS=120000
CODEX_SANDBOX=workspace-write
CODEX_APPROVAL=never

CLAUDE_COMMAND=claude
CLAUDE_MODEL=
CLAUDE_TIMEOUT_MS=120000
CLAUDE_PERMISSION_MODE=default
```

Important notes:

- keep `HARNESS_ENABLE_WECHAT=true`
- keep `HARNESS_LIVE_PROVIDERS=true` if you want real Codex execution
- leave Telegram disabled for now
- `WECHAT_SYNC_CURSOR_FILE` can stay at the default

## Step 4: Install This Project

If you have not installed this repo yet:

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm install
```

Then verify the project still builds:

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm check
```

Expected result:

- type check passes
- tests pass

## Step 5: Start Better Call Codex

Start the local process:

```bash
cd /Users/a-znk/code/harness
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm dev
```

Expected startup behavior:

- HTTP server starts on `http://127.0.0.1:4318`
- WeChat polling starts
- no immediate configuration error is printed

Healthy startup usually looks like:

- server listening log appears
- no complaint about missing `WECHAT_BOT_TOKEN`
- no complaint about missing `WECHAT_BASE_URL`

## Step 6: Sanity Check the Local Process

From another terminal, verify the local HTTP surface:

```bash
curl http://127.0.0.1:4318/health
```

Expected response:

```json
{
  "ok": true
}
```

Then inspect current state:

```bash
curl http://127.0.0.1:4318/state
```

At first, it is normal if:

- `workspaces` is empty
- `sessions` is empty
- `bindings` is empty

## Step 7: First End-to-End WeChat Test

Open WeChat and send yourself or the bridge chat one of these commands.

### 7.1 Import a Local Project

Example:

```text
导入项目 /Users/a-znk/code/harness
```

Expected reply:

- a success message saying the workspace was imported
- the imported workspace becomes the current workspace for that WeChat conversation

### 7.2 Check Status

Send:

```text
状态
```

Expected reply includes:

- current scope
- current workspace
- preferred provider
- current codex session
- current claude session

### 7.3 Ask Codex a Real Question

Send:

```text
请帮我总结这个仓库是做什么的
```

Expected behavior:

- Better Call Codex receives the WeChat message
- it runs local `codex`
- it sends a final text reply back to WeChat

If that works, your first real deployment is successful.

## Step 8: Useful WeChat Commands

Project selection:

```text
导入项目 /Users/yourname/code/project-a
项目列表
切换项目 project-a
状态
```

Session management:

```text
新建会话 修复登录流程
会话列表
切换会话 1
切换会话 修复登录流程
```

Provider switching:

```text
切换模型 codex
切换模型 claude
```

Note:

- `claude` only works if the `claude` CLI is installed and reachable in your PATH
- if `claude` is not installed, stay on `codex`

## Common Problems

### `node: command not found` or `pnpm: command not found`

Use the Homebrew-prefixed form:

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm dev
```

### Startup says WeChat is enabled but token or base URL is missing

Your `.env` is incomplete. Check:

- `WECHAT_BOT_TOKEN`
- `WECHAT_BASE_URL`
- `WECHAT_SYNC_CURSOR_FILE`

### WeChat login bridge setup succeeded, but `account.json` is missing

The bridge setup did not finish writing credentials. Re-run:

```bash
cd ~/code/wechat-agent-channel
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm run setup
```

### The process starts, but WeChat messages get no reply

Check these in order:

1. `HARNESS_ENABLE_WECHAT=true`
2. `HARNESS_LIVE_PROVIDERS=true`
3. `WECHAT_BOT_TOKEN` is valid
4. `WECHAT_BASE_URL` is correct
5. local `codex` works by itself from terminal
6. the imported workspace path really exists

Also look at the Better Call Codex terminal logs while sending a message.

### Workspace import fails

`/workspace import <path>` and `导入项目 <path>` only accept existing directories.

Good:

```text
导入项目 /Users/a-znk/code/harness
```

Bad:

```text
导入项目 /Users/a-znk/code/harness/package.json
```

### Replies are too long or cut into chunks

This is expected. The current WeChat connector splits long output into multiple messages so that WeChat delivery succeeds.

## Safe Restart Procedure

If you need to restart:

1. stop the running Better Call Codex process
2. leave `WECHAT_SYNC_CURSOR_FILE` in place
3. start the process again with the same `.env`

The saved cursor helps avoid re-consuming old messages.

## Minimum Success Checklist

You are done when all of these are true:

- `codex --version` works
- `pnpm check` works in this repo
- `.env` contains valid `WECHAT_BOT_TOKEN` and `WECHAT_BASE_URL`
- `pnpm dev` starts without configuration errors
- `curl http://127.0.0.1:4318/health` returns `{ "ok": true }`
- WeChat can import a workspace
- WeChat can receive a real Codex reply
