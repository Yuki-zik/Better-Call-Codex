<p align="center">
  <kbd><a href="./WECHAT_DEPLOYMENT.md">中文说明</a></kbd>&ensp;|&ensp;<kbd><a href="./WECHAT_DEPLOYMENT.en.md">English</a></kbd>
</p>

# Better Call Codex 微信部署说明

这份说明面向“第一次接触这个项目的人”，目标是让你按步骤就能部署成功，不需要自己猜配置。

适用目标：

- 微信作为聊天入口
- `codex` 作为第一优先 provider
- Better Call Codex 跑在你自己的电脑上
- 微信侧通过 ClawBot / iLink / OpenClaw 兼容桥接接入

---

## 你最终会得到什么

部署完成后：

- Better Call Codex 会持续轮询微信消息
- 收到消息后会转给本机 `codex`
- 最终文本结果会自动发回微信
- 你可以在微信里导入本地项目、创建会话、切换原生会话

---

## 部署前准备

你需要：

- macOS
- 可正常使用的微信桌面端
- 本机可以运行 `codex`
- Node.js
- `pnpm`
- 一个可用的微信桥接账号

如果你是 Apple Silicon Mac，并且终端里提示找不到 `node` 或 `pnpm`，一般它们在：

```bash
/opt/homebrew/bin
```

示例：

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm --version
```

---

## 第一步：检查本机环境

```bash
codex --version
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/node --version
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm --version
```

预期：

- 3 个命令都能成功运行
- `codex` 输出版本号
- `node` 输出版本号
- `pnpm` 输出版本号

如果 `codex` 本身都跑不起来，先修好 Codex，再继续。

---

## 第二步：拿到 `WECHAT_BOT_TOKEN` 和 `WECHAT_BASE_URL`

Better Call Codex 不会自己生成这两个值，它们来自你的微信桥接层。

### 最简单场景：你已经通过 OpenClaw 接好微信

这是最推荐、最省脑子的拿法。

直接运行：

```bash
ls ~/.openclaw/openclaw-weixin/accounts
cat ~/.openclaw/openclaw-weixin/accounts/<你的账号文件名>.json
```

你要找的是：

- `token`
- `baseUrl`

例如：

```json
{
  "token": "4740ec87ef67@im.bot:......",
  "baseUrl": "https://ilinkai.weixin.qq.com"
}
```

然后在 `.env` 里这样映射：

- `token` → `WECHAT_BOT_TOKEN`
- `baseUrl` → `WECHAT_BASE_URL`

### 如果你是通过 `wechat-agent-channel` 初始化的

直接看：

```bash
cat ~/.wechat-agent-channel/wechat/account.json
```

同样读取：

- `token`
- `baseUrl`

### 如果你什么都没有，只有一个微信桥账号

那你需要问桥接方要两样东西：

- token
- base URL

拿到以后，直接填到 `.env` 即可。

---

## 第三步：配置 Better Call Codex

回到本项目：

```bash
cd /Users/a-znk/code/harness
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

WECHAT_BOT_TOKEN=<替换成你的 token>
WECHAT_BASE_URL=<替换成你的 baseUrl>
WECHAT_POLL_TIMEOUT_MS=25000
WECHAT_SYNC_CURSOR_FILE=./data/wechat-sync-cursor.txt
WECHAT_ALLOW_FROM=

CODEX_COMMAND=/Applications/Codex.app/Contents/Resources/codex
CODEX_MODEL=
CODEX_TIMEOUT_MS=120000
CODEX_SANDBOX=workspace-write
CODEX_APPROVAL=never
```

如果只是你自己用，强烈建议一起设置：

```env
WECHAT_ALLOW_FROM=<你的微信senderId>
```

这样别人即使能触达同一个桥，也不能控制你的本机。

---

## 第四步：安装并验证项目

```bash
cd /Users/a-znk/code/harness
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm install
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm check
```

预期：

- 类型检查通过
- 测试通过

---

## 第五步：启动服务

```bash
cd /Users/a-znk/code/harness
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm dev
```

预期：

- 本地服务启动在 `http://127.0.0.1:4318`
- 微信轮询开始工作
- 没有立刻报缺 token / 缺 baseUrl

---

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

再检查当前状态：

```bash
curl http://127.0.0.1:4318/state
```

第一次启动时，这些为空是正常的：

- `workspaces`
- `sessions`
- `bindings`

---

## 第七步：第一次微信联调

打开微信，在接好的桥接会话里依次发送：

### 7.1 导入项目

```text
导入项目 /Users/a-znk/code/harness
```

预期：

- 收到导入成功提示
- 当前微信会话绑定到这个 workspace

### 7.2 查看状态

```text
状态
```

预期：

- 当前 scope
- 当前 workspace
- 当前 provider
- 当前 codex session
- 当前 claude session

### 7.3 让 Codex 回一句话

```text
请帮我总结这个仓库是做什么的
```

如果你收到真实 Codex 回复，这条链路就打通了。

---

## 常用微信命令

工作区：

```text
导入项目 /Users/yourname/code/project-a
项目列表
切换项目 project-a
状态
```

会话：

```text
新建会话 修复登录流程
会话列表
切换会话 1
切换会话 修复登录流程
```

原生会话：

```text
当前目录会话
原生会话列表
切换原生会话 1
/session attach codex <native-id> [name]
```

模型：

```text
当前模型
切换模型 codex
切换具体模型 gpt-5-codex
```

---

## 常见问题

### `node` 或 `pnpm` 找不到

用：

```bash
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm dev
```

### 服务启动了，但微信没有回复

按顺序检查：

1. `HARNESS_ENABLE_WECHAT=true`
2. `HARNESS_LIVE_PROVIDERS=true`
3. `WECHAT_BOT_TOKEN` 正确
4. `WECHAT_BASE_URL` 正确
5. `WECHAT_ALLOW_FROM` 没把你自己挡住
6. 本机 `codex` 本身能直接运行

### 提示 `Access denied`

说明 allowlist 在工作。

检查：

- `WECHAT_ALLOW_FROM`

### 导入项目失败

`导入项目 <path>` 只能接受存在的目录，不能是文件。

正确：

```text
导入项目 /Users/a-znk/code/harness
```

错误：

```text
导入项目 /Users/a-znk/code/harness/package.json
```

### 原生会话列表很多很乱

优先用：

```text
当前目录会话
```

因为它会：

- 按当前 workspace 过滤
- 优先显示精确 cwd
- 默认隐藏 subagent 噪音

---

## 最终成功清单

满足这些，就说明你已经部署成功：

- `codex --version` 正常
- `pnpm check` 正常
- `.env` 已填好正确的微信配置
- `pnpm dev` 启动成功
- `curl http://127.0.0.1:4318/health` 返回正常
- 微信上可以导入 workspace
- 微信上可以收到真实 Codex 回复
