<p align="center">
  <kbd><a href="/Users/a-znk/code/harness/docs/WECHAT_DEPLOYMENT.md">中文说明</a></kbd>&ensp;|&ensp;<kbd><a href="/Users/a-znk/code/harness/docs/WECHAT_DEPLOYMENT.en.md">English</a></kbd>
</p>

# Better Call Codex 微信部署说明

这份说明面向“第一次接触这个项目的人”，目标是让你在尽量少猜测的情况下，把 Better Call Codex 部署成一个可在微信里使用的本地编码助手。

适用目标：

- 微信作为聊天入口
- `codex` 作为第一优先 provider
- Better Call Codex 运行在你自己的电脑上
- 微信侧通过 ClawBot / iLink 兼容桥接接入

如果你已经有可用的微信桥，并且知道自己的 `token` 和 `baseUrl`，可以直接跳到“配置 Better Call Codex”。

## 你最终会得到什么

部署完成后：

- Better Call Codex 会持续轮询微信消息
- 收到消息后会转给本机 `codex`
- 最终文本结果会自动发回微信
- 你可以直接在微信里导入本地项目、创建会话、切换原生会话

## 部署前准备

你需要在同一台机器上具备：

- macOS
- 可正常使用的微信桌面端
- 已安装并可运行的 `codex`
- Node.js
- `pnpm`
- 一个 ClawBot / iLink 兼容的微信桥接账号

如果你是 Apple Silicon Mac，并且终端里提示找不到 `node` 或 `pnpm`，大概率它们安装在：

```bash
/opt/homebrew/bin
```

可以统一这样调用：

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm --version
```

## 第一步：确认本机基础环境

运行：

```bash
codex --version
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/node --version
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm --version
```

预期：

- 3 个命令都成功
- `codex` 能输出版本号
- `node` 能输出版本号
- `pnpm` 能输出版本号

如果 `codex` 本身都无法运行，请先修好 Codex，再继续部署。

## 第二步：拿到微信桥接凭据

Better Call Codex 本身不会生成 `WECHAT_BOT_TOKEN`。  
它依赖你现有的微信桥。

最简单的方式，是使用参考项目：

- [wechat-agent-channel](https://github.com/sitarua/wechat-agent-channel)

它可以帮你完成：

- 微信扫码登录
- 本地保存桥接凭据
- 默认 provider 初始化

### 方案 A：你已经有桥接账号

如果你已经拿到了：

- `token`
- `baseUrl`

那么直接进入下一步。

如果你已经完成了 OpenClaw 微信扫码连接，并且只是想最快拿到 Better Call Codex 需要的值，那么最简单的方式是直接读 OpenClaw 已经保存好的账号文件：

```bash
ls ~/.openclaw/openclaw-weixin/accounts
cat ~/.openclaw/openclaw-weixin/accounts/<你的账号文件名>.json
```

直接找：

- `token`
- `baseUrl`

然后映射到：

- `WECHAT_BOT_TOKEN`
- `WECHAT_BASE_URL`

### 方案 B：用 `wechat-agent-channel` 生成凭据

```bash
cd ~/code
git clone https://github.com/sitarua/wechat-agent-channel.git
cd wechat-agent-channel
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm install
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm run setup
```

它会做这些事：

1. 在终端显示微信登录二维码
2. 你用手机扫码
3. 它把登录成功后的桥接凭据写到本地
4. 询问默认 provider

对 Better Call Codex 来说，第一次建议选 `Codex`。

### 查看保存下来的凭据

通常可以看这个文件：

```bash
cat ~/.wechat-agent-channel/wechat/account.json
```

你需要两个值：

- `token`
- `baseUrl`

例如：

```json
{
  "token": "your-token-here",
  "baseUrl": "https://your-wechat-bridge.example.com"
}
```

它们和 Better Call Codex 的映射关系是：

- `token` -> `WECHAT_BOT_TOKEN`
- `baseUrl` -> `WECHAT_BASE_URL`

## 第三步：配置 Better Call Codex

回到本仓库：

```bash
cd /Users/a-znk/code/harness
```

创建本地配置文件：

```bash
cp .env.example .env
```

把 `.env` 至少改成这样：

```env
HARNESS_PORT=4318
HARNESS_STATE_FILE=./data/harness-state.json
HARNESS_DEFAULT_PROVIDER=codex
HARNESS_LIVE_PROVIDERS=true
HARNESS_ENABLE_WECHAT=true
HARNESS_ENABLE_TELEGRAM=false

WECHAT_BOT_TOKEN=替换成你的token
WECHAT_BASE_URL=替换成你的baseUrl
WECHAT_POLL_TIMEOUT_MS=25000
WECHAT_SYNC_CURSOR_FILE=./data/wechat-sync-cursor.txt
WECHAT_ALLOW_FROM=

CODEX_COMMAND=/Applications/Codex.app/Contents/Resources/codex
CODEX_MODEL=
CODEX_TIMEOUT_MS=120000
CODEX_SANDBOX=workspace-write
CODEX_APPROVAL=never
```

如果只是你自己使用，强烈建议把 `WECHAT_ALLOW_FROM` 一起配上。

例如：

```env
WECHAT_ALLOW_FROM=你的微信senderId
```

## 第四步：安装并验证项目

```bash
cd /Users/a-znk/code/harness
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm install
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm check
```

预期：

- 类型检查通过
- 测试通过

## 第五步：启动服务

```bash
cd /Users/a-znk/code/harness
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm dev
```

预期现象：

- 本地服务启动在 `http://127.0.0.1:4318`
- 微信轮询开始工作
- 没有立刻报 `WECHAT_BOT_TOKEN` 缺失
- 没有立刻报 `WECHAT_BASE_URL` 缺失

## 第六步：本地自检

另开一个终端：

```bash
curl http://127.0.0.1:4318/health
```

预期：

```json
{
  "ok": true
}
```

再看状态：

```bash
curl http://127.0.0.1:4318/state
```

第一次启动时，看到这些为空是正常的：

- `workspaces`
- `sessions`
- `bindings`

## 第七步：第一次微信联调

打开微信，对接好的桥接会话里依次发送：

### 7.1 导入当前仓库

```text
导入项目 /Users/a-znk/code/harness
```

预期：

- 收到导入成功提示
- 当前微信会话被绑定到这个 workspace

### 7.2 查看状态

```text
状态
```

预期返回：

- 当前 scope
- 当前 workspace
- 当前 provider
- 当前 codex session
- 当前 claude session

### 7.3 让 Codex 回复一句

```text
请帮我总结这个仓库是做什么的
```

如果微信里收到了真实 Codex 回复，就说明这套链路已经打通。

## 常用微信命令

工作区相关：

```text
导入项目 /Users/yourname/code/project-a
项目列表
切换项目 project-a
状态
```

会话相关：

```text
新建会话 修复登录流程
会话列表
切换会话 1
切换会话 修复登录流程
```

原生会话相关：

```text
当前目录会话
原生会话列表
切换原生会话 1
/session attach codex <native-id> [name]
```

模型相关：

```text
当前模型
切换模型 codex
切换具体模型 gpt-5-codex
```

## 常见问题

### 1. `node` 或 `pnpm` 找不到

改用：

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm dev
```

### 2. 启动时报 token 或 baseUrl 缺失

检查 `.env` 里是否填写了：

- `WECHAT_BOT_TOKEN`
- `WECHAT_BASE_URL`
- `WECHAT_SYNC_CURSOR_FILE`

### 3. 服务启动了，但微信没有回复

按顺序检查：

1. `HARNESS_ENABLE_WECHAT=true`
2. `HARNESS_LIVE_PROVIDERS=true`
3. `WECHAT_BOT_TOKEN` 正确
4. `WECHAT_BASE_URL` 正确
5. `WECHAT_ALLOW_FROM` 没把你自己挡住
6. 本机 `codex` 本身可直接运行

### 4. 提示 `Access denied`

说明 allowlist 生效了。

检查：

- `WECHAT_ALLOW_FROM`

### 5. 导入项目失败

`导入项目 <path>` 只能接受存在的目录，不能是文件。

正确：

```text
导入项目 /Users/a-znk/code/harness
```

错误：

```text
导入项目 /Users/a-znk/code/harness/package.json
```

### 6. 原生会话列表很多、很乱

优先用：

```text
当前目录会话
```

它会：

- 按当前 workspace 过滤
- 优先显示精确 cwd
- 默认隐藏 subagent 噪音

## 最终成功清单

满足这些，就说明你已经部署成功：

- `codex --version` 正常
- `pnpm check` 正常
- `.env` 已填好正确的微信配置
- `pnpm dev` 启动成功
- `curl http://127.0.0.1:4318/health` 返回正常
- 微信上可以导入 workspace
- 微信上可以收到真实 Codex 回复
