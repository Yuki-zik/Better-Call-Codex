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
cd /Users/a-znk/code/Better-Call-Codex
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
cd /Users/a-znk/code/Better-Call-Codex
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm install
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/pnpm check
```

预期：

- 类型检查通过
- 测试通过

---

## 第五步：启动服务

```bash
cd /Users/a-znk/code/Better-Call-Codex
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

注意：所有命令都必须以 `/` 开头，包括中文别名。你也可以先发 `/` 或 `/命令列表` 看完整命令表。

### 7.1 导入项目

```text
/导入项目 /Users/a-znk/code/Better-Call-Codex
```

预期：

- 收到导入成功提示
- 当前微信会话绑定到这个 workspace

### 7.2 查看状态

```text
/状态
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
/导入项目 /Users/yourname/code/project-a
/项目列表
/切换项目 project-a
/状态
```

会话：

```text
/新建会话 修复登录流程
/会话列表
/当前会话详情
/会话历史
/会话历史 10
/切换会话 1
/切换会话 修复登录流程
```

补充说明：

- `/当前会话详情` 会显示当前 provider 下当前会话的状态、最近输入输出和历史覆盖范围
- `/会话历史` 默认看最近 5 轮
- 如果这个会话是通过 `/session attach` 接进来的，你只能看到 Better Call Codex 接管后的历史，接管前历史不会在这里补造

原生会话：

```text
/当前目录会话
/原生会话列表
/切换原生会话 1
/session attach codex <native-id> [name]
```

模型：

```text
/当前提供方
/切换提供方 codex
/当前模型
/切换具体模型 gpt-5-codex
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

`/导入项目 <path>` 只能接受存在的目录，不能是文件。

正确：

```text
/导入项目 /Users/a-znk/code/Better-Call-Codex
```

错误：

```text
/导入项目 /Users/a-znk/code/Better-Call-Codex/package.json
```

### 原生会话列表很多很乱

优先用：

```text
/当前目录会话
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

---

## 实测记录（2026-03-24 00:42 CST）

这部分是我直接在当前机器上做的 smoke test 记录，对应的是当前最新代码，而不是旧进程残留状态。

### 本轮实测环境

- 当前运行方式：`/opt/homebrew/bin/node dist/src/server.js`
- `HARNESS_ENABLE_WECHAT=true`
- `HARNESS_LIVE_PROVIDERS=true`
- `WECHAT_BOT_TOKEN` 已配置
- `WECHAT_BASE_URL=https://ilinkai.weixin.qq.com`
- `CODEX_COMMAND=/Applications/Codex.app/Contents/Resources/codex`

### 已直接验证通过

1. 本地服务健康检查通过

```bash
curl http://127.0.0.1:4318/health
```

结果：

```json
{ "ok": true }
```

2. 当前服务已加载真实微信状态

```bash
curl http://127.0.0.1:4318/state
```

结果摘要：

- 已存在真实微信 binding
- 已存在 `Better-Call-Codex` workspace
- 已存在可续接的 codex session

3. 真实微信桥 `getupdates` 可达

测试方式：

- 使用本机 `.env` 中的真实 `WECHAT_BOT_TOKEN`
- 直接请求 `https://ilinkai.weixin.qq.com/ilink/bot/getupdates`
- 使用当前 cursor 发起请求

结果：

- HTTP `200`
- 返回结构合法
- `msgs=[]`
- 返回了新的同步 cursor

这说明：

- token 有效
- base URL 可用
- 轮询接口可正常响应

4. 真实微信桥 `sendmessage` 可达

测试方式：

- 读取当前真实微信 binding 的 `replyContext`
- 直接请求 `sendmessage`
- 发送一条短消息：`Better Call Codex smoke test: outbound bridge OK.`

结果：

- HTTP `200`
- 返回体：`{}`

这说明：

- 当前 reply context 可用于回包
- 机器人向微信回消息的 API 调用成功

5. 最新服务进程上的 slash-first 命令体系生效

测试方式：

```bash
POST /channels/wechat/inbound
text="/"
```

结果：

- 返回完整命令表
- 明确提示“所有命令都必须以 `/` 开头”
- `/commands`、微信 slash 别名等帮助入口已经在返回文本中出现

6. live Codex provider 执行通过

测试方式：

```bash
POST /channels/wechat/inbound
text="Reply with exactly: SMOKE_LIVE_PROVIDER_OK_20260324"
```

结果：

- 返回文本：`SMOKE_LIVE_PROVIDER_OK_20260324`
- 目标 session `turnCount` 从 `1` 增加到 `2`
- `lastError=null`

这说明：

- 当前服务进程可正常调起本机 Codex
- 会话续接正常
- 最新代码下的核心链路是通的

### 这轮还没有直接观察到的部分

本轮没有从“手机微信手动新发一条消息”来观察运行中 connector 自动消费并自动回包的全过程，因为这个动作需要你的人机侧配合。

不过基于上面的结果，我们已经直接验证了这三层都正常：

- 微信桥轮询入口正常
- 微信桥回包入口正常
- Better Call Codex 最新服务 + live Codex provider 正常

所以当前判断是：

- 微信部署链路整体健康
- 只差你在手机上再发一条真实消息，确认肉眼可见回包

### 你现在只需要补这一眼

在微信里发：

```text
/状态
```

再发：

```text
/命令列表
```

如果都能收到回复，这一轮 smoke test 就算从终端和手机两侧都闭环完成。
