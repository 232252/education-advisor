# 调研：国内连接器（QQ / 微信扫码优先）与「基于 PID」路径澄清

> 日期：2026-09-14 ｜ 性质：**只调研**（未改运行时代码；本期不实现 adapters）
> 上游：`docs/research/2026-09-12-channel-connector-catalog.md`、`docs/plans/2026-09-12-channel-architecture-implementation.md`、`docs/plans/2026-09-13-connection-center-ui-implementation.md`
> 范围：**国内优先**；国外 Slack/Discord/Telegram **不做**（可后续 PR）。
> 基线代码：worktree `education-advisor-connectors` @ `737e467`（分支 `docs/domestic-connectors`）。
> 实现策略（已拍板）：**纯自建薄客户端**直连腾讯官方 HTTP/WS；**不要求** OpenClaw / cc-connect sidecar。

---

## 0. 「基于 PID 的工具/连接器」在本产品语境下是什么

用户口头「基于 PID 的工具/连接器」在 2026 国内 Agent / OpenClaw 生态里通常指两类不同东西，**本仓库现状只实现了其中一类**：

| 含义 | 典型做法 | 本仓库现状 | 建议态度 |
|---|---|---|---|
| **A. 进程 PID 挂钩 / 桌面钩子** | 找到 `WeChat.exe` / `QQ.exe` 的 PID，DLL 注入、内存读写、UI 自动化、剪贴板桥 | **未实现**；无任何按进程 PID 绑定桌面客户端的适配器 | **禁止**（ToS / 封号 / 客户端版本脆弱）— 连接中心永不提供此选项 |
| **B. 官方/准官方频道连接器**（常被 OpenClaw / WorkBuddy / cc-connect 统称 connector） | 扫码或凭证 → 长连接/长轮询 → 归一化消息进 Agent | ✅ 已有 `ChannelAdapter` + 连接中心：飞书 / 钉钉 / 企微 | **主路径**：继续扩展 QQ / 微信（个人）扫码等 |

设计文档默认把「要加的连接器」定义为 **B**；把 **A** 仅记入风险与明确非目标，避免实现时混入钩子方案。

相关本地路径（B 的事实锚点）：

- UI：`src/renderer/components/connection-center/`（`ConnectionCenter.tsx` / `Panel` / `ChannelRow` / `WebUiConnectBlock` / `QrCode`）
- 注册表：`src/main/ipc/channel-handlers.ts` → `registerChannelRegistry()` 仅注册 `feishu` / `dingtalk` / `wecom`
- 契约：`src/main/services/channels/types.ts`（`ChannelAdapter`）、`src/shared/types/channel.ts`（manifest / 五态 / 能力位）
- 运行时：`src/main/services/channels/{manager,bridge,runtime,adapters/*}`

> 注：仓库另有 **pi-agent-core**（Agent 内核）与「市场 pi 工具」链路，**不是**「进程 PID 连接器」。口头「PID」勿与 pi 工具市场混淆。

另：qwenpaw 文档里的 **OneBot v11 / NapCat / go-cqhttp**（个人号完整协议）虽非严格 PID Hook，但同样绕开官方 Bot API、合规与封号风险高，**不进入本产品连接中心**；仅作对照，见 §8。

---

## 1. QQ：官方机器人 + 扫码 Onboard（2026）

### 1.1 官方能力（以腾讯文档为准）

- 开放平台 Bot：HTTPS OpenAPI + **WebSocket Gateway**（桌面可直连，无需公网）[官方] https://bot.q.qq.com/wiki/develop/api-v2/
- 认证：AppID + AppSecret；`Authorization: QQBot {ACCESS_TOKEN}`；token 端点 `https://bots.qq.com/app/getAppAccessToken`
- API 基址（常见）：`https://api.sgroup.qq.com`
- 事件：单聊 `C2C_MESSAGE_CREATE`、群 `@` `GROUP_AT_MESSAGE_CREATE`、频道等
- **扫码配置（Onboard）**：门户 bind task（`q.qq.com`）或 SDK：
  - Python：`tencent-connect/qqbot-agent-sdk` 的 `start_onboard`
  - Node：`@tencent-connect/qqbot-connector` 的 `qrConnect` / `startQrConnect`
  - 门户路径（见 qwenpaw 实现）：`POST /lite/create_bind_task` → 扫 ` /qqbot/openclaw/connect.html?task_id=…` → `POST /lite/poll_bind_result`（AES-GCM 解密 secret）

> 说明：门户前端路径名含 `openclaw`，是腾讯侧页面命名；**不表示**本产品必须安装 OpenClaw。

### 1.2 硬限制（教育场景痛点）

沿用全景调研结论并保留：

- 群/单聊**被动回复窗口短**（群约 5 分钟、每条消息回复次数有限）→ AI Agent 超时易失败
- **群主动消息配额极严**（社区实测约每月数条级）→ 主动通知几乎不可用
- `streamingKind = 'none'`（无编辑已发消息）

### 1.3 对本产品的含义（已拍板）

- **扫码直连可行**：连接中心可做「展示 QR → 轮询 onboard → 自动写入 settings/keystore → start」
- **产品定位应诚实**：适合「学生/家长在 QQ 里问一句 AI 助教答一句」；不适合「群里定时成绩播报」
- **仍上架 P0**，但对弱主动群发做 **显著 UI 提示**（卡片警告条 + 文档 + i18n）
- 实现：自研 WS Gateway + OpenAPI 薄客户端；可参考 qwenpaw `qq/channel.py` 的 op/intent 映射，但以官方 wiki 为准

---

## 2. 微信：官方 ClawBot / iLink vs 非官方 PID 钩子

### 2.1 官方 / 准官方：微信 ClawBot（iLink）— 官方协议优先

腾讯通过 **微信 ClawBot + iLink Bot HTTP API** 为**个人微信**开放合法 Bot 通道。协议面为纯 HTTP/JSON，**无需第三方 SDK**。

| 组件 | 说明 |
|---|---|
| 登录域名 | `https://ilinkai.weixin.qq.com` |
| 取 QR | `GET/POST /ilink/bot/get_bot_qrcode?bot_type=3` → `qrcode` + `qrcode_img_content` |
| 扫码轮询 | `GET /ilink/bot/get_qrcode_status?qrcode=…` → `waiting/wait` \| `scanned/scaned` \| `confirmed` \| `expired`（及 redirect / verify_code 变体，实现期跟官方） |
| 会话凭证 | 确认后得 `bot_token` + `baseurl`（及可能的 `ilink_bot_id` / `ilink_user_id`） |
| 收消息 | 长轮询 `POST /ilink/bot/getupdates`（服务端 hold ~35s） |
| 发消息 | `POST /ilink/bot/sendmessage`（**必须**带会话 `context_token`） |
| 媒体 | `getuploadurl` + CDN（`novac2c.cdn.weixin.qq.com`）+ AES |
| 能力边界 | 偏**私聊**；主动推送弱（依赖用户先发言拿 `context_token`） |

官方/模板入口参考：微信侧 iLink/chatbot 模板页（`weixin.qq.com` cgi-bin readtemplate `t=ilink/chatbot`）；社区协议整理可作交叉核对，**冲突时以腾讯线上行为与官方说明为准**。

**合规性**：相对历史 Web 协议 / iPad 协议 / PC Hook，这是当前**首选合法路径**。仍须遵守《微信 ClawBot 功能使用条款》；腾讯可限速、拦截、调整可连 AI 类型。

### 2.2 企业向微信生态（本仓库已有部分）

| 路径 | 桌面直连 | 本仓库 | 备注 |
|---|---|---|---|
| 企微智能机器人长连接 | ✅ WSS | ✅ `adapters/wecom`（beta） | 已实现 |
| 企微自建应用 HTTP 回调 | ❌ 需公网 | 未做 | `receivesVia=webhook` → 中继 |
| 微信客服 / 公众号 | ❌ 需公网 + 窗口限制 | 未做 | 全景调研 P3 |
| WorkBuddy「微信客服号」扫码 | 产品侧托管 | 外部参考 | 绑定后走客服入口，非好友列表原生 bot |

### 2.3 非官方：基于进程 PID / Hook（明确禁止）

| 方案 | 原理 | 风险 |
|---|---|---|
| WeChatFerry 等 | 注入/挂钩 Windows 微信进程（按 PID） | 违反用户协议，**高封号**；客户端升级即碎 |
| 历史 itchat / iPad 协议 | 模拟协议 | 灰色/诉讼/封禁史 |
| 纯 UI 自动化 / 剪贴板桥 | 找窗口 PID → 键鼠/剪贴板 | 脆弱、无结构化消息、隐私面大 |

**结论**：连接中心**不得**把 PID Hook 做成默认、推荐或隐藏高级选项；文档与 UI 不引导用户对主微信号做注入。实现期依赖扫描中不得出现 WeChatFerry / 注入相关包名。

### 2.4 对本产品的含义（微信，已拍板）

- **P0 首发范围**：接受「个人微信 iLink、偏私聊、弱主动推送」作为上线标准
- **实现策略**：**纯自建薄客户端**直接打 iLink HTTP（登录 + getupdates + sendmessage + 媒体最小集）；**不**把 OpenClaw / `@tencent-weixin/openclaw-weixin` / cc-connect 作为运行依赖
- **参考**：本机 qwenpaw 的 `ILinkClient` / `WeChatChannel` / `WeChatQRCodeAuthHandler`（见 §8）— 仅作协议与 UX 模式参考，不拷贝进本仓库运行时除非另行许可评审
- **不做**：WeChatFerry / 任意 DLL 注入 / 要求关闭官方客户端的互斥钩子

---

## 3. 其他国内候选（现实度排序）

| 候选 | 现实度 | 连接方式 | 建议优先级 | 说明 |
|---|---|---|---|---|
| **钉钉** | 高 | Stream WSS + 凭证 | ✅ 已落地 | 保持维护 |
| **企微智能机器人** | 高 | 长连接 WSS | ✅ 已落地（beta） | 可补扫码关联（可选） |
| **飞书** | 高 | WS 长连接 + 凭证 | ✅ 已落地 | 用户另有 dirty WIP，本分支不碰其脏文件 |
| **QQ 官方 Bot** | 中高（扫码易）/ 能力中低 | WS + 扫码 onboard | **P0** | 见 §1；弱主动须显著提示 |
| **微信个人 ClawBot/iLink** | 高（合法扫码） | QR + 长轮询 | **P0** | 见 §2.1；私聊优先已接受 |
| **微信客服 / 公众号** | 中 | 公网 webhook | P2–P3 | 需中继；48h/5 条等限制 |
| **邮件 IMAP/SMTP** | 高 | IDLE + SMTP | P1 | 全景调研已论证；分区待拍板 |
| **华为小艺** | 中（偏鸿蒙分发） | 小艺开放平台 **A2A** | 观察 | 本轮**未选型**；倾向「出站挂 Agent」，非入站 IM |
| **抖音私信** | 低–中 | 开放平台 IM | P3 / 观察 | ROI 低 |
| **短信** | 中（出站通知） | 云短信 API | P2（出站） | 非入站 Channel |
| **国外 IM** | — | — | **非目标** | Slack/Discord/Telegram 等留给外部 PR |

---

## 4. 连接方式可行性矩阵（国内）

| 方式 | QQ | 微信个人 | 企微/钉钉/飞书 | 小艺 | 风险 |
|---|---|---|---|---|---|
| **扫码绑定 / Onboard** | ✅ 官方 portal / QR connector | ✅ iLink QR | 部分（企微扫码关联；飞书/钉钉多为凭证） | ❌（平台侧配置） | 低（官方） |
| **凭证 + 长连接 WS** | ✅ Gateway | ❌（iLink 为 HTTP 长轮询） | ✅ | ❌ | 低 |
| **长轮询 HTTP** | 可选 Webhook | ✅ getupdates | — | — | 低 |
| **公网 Webhook 中继** | 可选 | 公众号/客服 | 自建应用 | A2A 需公网 | 中（运维） |
| **本机窗口 / PID Hook** | 社区方案存在 | WeChatFerry 等 | 少见 | — | **极高 — 禁止** |
| **OneBot / NapCat 个人号** | 社区完整协议 | — | — | — | 高 — **不进连接中心** |
| **剪贴板桥 / OCR** | 理论可行 | 理论可行 | — | — | 高（脆弱+隐私） |
| **本机 WebUI 扫码** | — | — | — | — | 已实现（连的是本应用，不是 IM） |

---

## 5. 与 OpenClaw / cc-connect / qwenpaw 的关系（参考不绑定）

| 生态 | 角色 | 对本产品 |
|---|---|---|
| **腾讯官方 API** | iLink HTTP、QQ OpenAPI/WS、门户 bind task | **实现真源** |
| **OpenClaw 插件**（如 `@tencent-weixin/openclaw-weixin`） | 社区/官方插件封装同一协议；扫码登录常写 `~/.openclaw` | **可选阅读参考**；**不**作为运行依赖或安装前置 |
| **cc-connect** | 多平台桥 CLI；本机可见 `~/.cc-connect` | 同上，不强制 |
| **qwenpaw（本机已装）** | 自带 wechat/qq 频道 + 统一 QR 鉴权 | **模式参考**（扫码 UX、协议调用顺序、限制文案）；实现期自写 TypeScript 薄客户端 |

本产品已有自研 `ChannelManager` + Bridge，**保持自研适配器**。用户无需先装 OpenClaw / QwenPaw / cc-connect 才能用连接中心。

本机探测到的相关目录（仅环境事实，非依赖）：

- `C:\Users\sq199\.openclaw\`（飞书技能等；未见 weixin 专用凭证树）
- `C:\Users\sq199\.cc-connect\`（主要为飞书项目会话）
- `C:\Users\sq199\.qwenpaw_venv\Lib\site-packages\qwenpaw\app\channels\`（完整频道实现，见 §8）

---

## 6. 已拍板 vs 仍开放

### 6.1 已拍板（2026-09-14）

1. **微信 P0**：接受「个人微信 iLink、偏私聊、弱主动推送」作为首发标准。
2. **QQ P0**：仍上架；弱主动群发能力须 **显著提示**（UI + 文档）。
3. **技术路径**：**纯自建薄客户端**；不要求 OpenClaw sidecar。
4. **本期范围**：只改文档；**不实现** adapters / 不改注册表。
5. **PID Hook**：继续禁止，且不作为隐藏选项。

### 6.2 仍开放（本轮用户未选）

1. **邮件 / 短信分区**：进「消息频道」还是新建「通知连接器」分区？
2. **小艺 A2A**：是否立项为出站（非频道）？本轮未选。
3. **`comingSoon` 占位卡**：实现前是否先合并 QQ/微信灰色卡片？本轮未选。

---

## 7. 来源摘要

- 本仓库：`docs/research/2026-09-12-channel-connector-catalog.md`、channel 架构/连接中心实施计划、`src/main/services/channels/**`、`src/renderer/components/connection-center/**`
- QQ 官方：https://bot.q.qq.com/wiki/develop/api-v2/ ；`bots.qq.com/app/getAppAccessToken`；`@tencent-connect/qqbot-connector`；`tencent-connect/qqbot-agent-sdk`
- 微信 iLink：`ilinkai.weixin.qq.com` 协议面；微信侧 ilink/chatbot 模板；社区协议整理作交叉核对
- qwenpaw 本机源码与文档：见 §8
- 企微：work.weixin.qq.com 智能机器人
- 小艺：华为开发者文档 A2A / message-stream（观察）
- 风险对照：WeChatFerry README；qwenpaw 文档中 OneBot/NapCat 说明（明确不采纳）

---

## 8. qwenpaw 本机调研纪要（路径可复现）

调查根：`C:\Users\sq199\.qwenpaw*`、`C:\Users\sq199\qwenpaw*`、venv `C:\Users\sq199\.qwenpaw_venv`（另有 `qwenpaw-venv`、`.qwenpaw_venv.bak` 副本）。

### 8.1 微信 iLink（最直接可对标）

| 路径 | 作用 |
|---|---|
| `…\qwenpaw\app\channels\wechat\client.py` | **`ILinkClient`**：文档写明「All iLink API endpoints live under https://ilinkai.weixin.qq.com」「no third-party SDK」。含 `get_bot_qrcode`（`bot_type=3`）、`get_qrcode_status`、`wait_for_login`、`getupdates`、`sendmessage` / `send_text`（强制 `context_token`）、`getconfig`、`sendtyping`、`getuploadurl`、媒体加解密下载 |
| `…\qwenpaw\app\channels\wechat\channel.py` | **`WeChatChannel`**：长轮询收、HTTP 发；token 可空则 start 时触发扫码；持久化 `wechat_bot_token` / `wechat_context_tokens.json`；注释写明 merge 缓冲因「WeChat iLink is single-chat only」与 context_token 条数限制 |
| `…\qwenpaw\app\channels\wechat\utils.py` | 请求头：`AuthorizationType: ilink_bot_token`、`Authorization: Bearer …`、`X-WECHAT-UIN`（随机 uint32 base64）；AES-ECB 媒体加解密 |
| `…\qwenpaw\app\channels\wechat\__init__.py` | 导出 `WeChatChannel` |

### 8.2 统一扫码鉴权（连接中心 UX 对标）

| 路径 | 作用 |
|---|---|
| `…\qwenpaw\app\channels\qrcode_auth_handler.py` | 抽象 `QRCodeAuthHandler`：`fetch_qrcode` → `{scan_url, poll_token}`；`poll_status` → `{status, credentials}`。注册表 `QRCODE_AUTH_HANDLERS` 含 `wechat` / `qq` / `wecom` / `dingtalk` / `feishu` |
| 同文件 `WeChatQRCodeAuthHandler` | 调 `ILinkClient.get_bot_qrcode`；扫码 URL 回退 `https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=…&bot_type=3`；确认后 credentials=`bot_token` + `base_url` |
| 同文件 `QQQRCodeAuthHandler` | 门户 `q.qq.com`：`/lite/create_bind_task`、`/lite/poll_bind_result`、前端 `/qqbot/openclaw/connect.html`；AES-GCM 解密 `bot_encrypt_secret` → `app_id` + `client_secret` |

与本产品设计的 `channels:beginLogin` / `pollLogin` / `cancelLogin` **同构**，实现期可对齐状态机文案（pending / scanned / confirmed / expired）。

### 8.3 QQ 官方 Bot 频道

| 路径 | 作用 |
|---|---|
| `…\qwenpaw\app\channels\qq\channel.py` | **`QQChannel`**：WS 收事件 + HTTP 回；`DEFAULT_API_BASE = https://api.sgroup.qq.com`；`TOKEN_URL = https://bots.qq.com/app/getAppAccessToken`；op/intent 常量；事件 `C2C_MESSAGE_CREATE` 等；`send_c2c_message` / `send_group_message` |
| `…\qwenpaw\app\channels\qq\cards\*` | 卡片/工具展示（非协议核心） |
| `…\qwenpaw\app\channels\qq\__init__.py` | 导出 `QQChannel` |

### 8.4 文档与对照（含明确不采纳路径）

| 路径 | 作用 |
|---|---|
| `C:\Users\sq199\.qwenpaw\skill_pool\qwenpaw-docs-zh\docs\channels.zh.md` | 中文频道文档：§QQ（开放平台凭证 + 沙箱扫码）；§微信个人（iLink）扫码推荐、token 文件、字段表；另有 §OneBot v11（NapCat）— **完整个人号协议，本产品不采纳** |
| 同内容副本 | `…\workspaces\default\skills\qwenpaw-docs-zh\docs\channels.zh.md` |

### 8.5 可借鉴的产品模式（非代码拷贝清单）

1. **扫码会话两段式 API**（取码 / 轮询）与凭证回写表单。
2. **微信**：无 token → 启动引导扫码；有 token → 直接长轮询；`context_token` 按用户缓存；UI 诚实写「偏私聊」。
3. **QQ**：凭证或门户扫码得到 app_id/secret 后走同一 WS 通道；文档强调官方 Bot 功能受限。
4. **头字段与超时**：iLink `X-WECHAT-UIN`、getupdates ~45s 客户端超时、QR status 长 timeout — 实现期按官方实测校准。

### 8.6 明确不从 qwenpaw 带入的东西

- OpenClaw / NapCat / OneBot 个人号路径
- 将其 Python 包作为 runtime 依赖
- 要求用户安装 QwenPaw 才能连微信/QQ