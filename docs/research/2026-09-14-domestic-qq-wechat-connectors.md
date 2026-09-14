# 调研：国内连接器（QQ / 微信扫码优先）与「基于 PID」路径澄清

> 日期：2026-09-14 ｜ 性质：**只调研**（未改运行时代码）
> 上游：`docs/research/2026-09-12-channel-connector-catalog.md`、`docs/plans/2026-09-12-channel-architecture-implementation.md`、`docs/plans/2026-09-13-connection-center-ui-implementation.md`
> 范围：**国内优先**；国外 Slack/Discord/Telegram **不做**（可后续 PR）。
> 基线代码：worktree `education-advisor-connectors` @ `737e467`（分支 `docs/domestic-connectors`）。

---

## 0. 「基于 PID 的工具/连接器」在本产品语境下是什么

用户口头「基于 PID 的工具/连接器」在 2026 国内 Agent / OpenClaw 生态里通常指两类不同东西，**本仓库现状只实现了其中一类**：

| 含义 | 典型做法 | 本仓库现状 | 建议态度 |
|---|---|---|---|
| **A. 进程 PID 挂钩 / 桌面钩子** | 找到 `WeChat.exe` / `QQ.exe` 的 PID，DLL 注入、内存读写、UI 自动化、剪贴板桥 | **未实现**；无任何按进程 PID 绑定桌面客户端的适配器 | **非目标**（ToS / 封号 / 客户端版本脆弱） |
| **B. 官方/准官方频道连接器**（常被 OpenClaw / WorkBuddy / cc-connect 统称 connector） | 扫码或凭证 → 长连接/长轮询 → 归一化消息进 Agent | ✅ 已有 `ChannelAdapter` + 连接中心：飞书 / 钉钉 / 企微 | **主路径**：继续扩展 QQ / 微信（个人）扫码等 |

设计文档默认把「要加的连接器」定义为 **B**；把 **A** 仅记入风险与明确非目标，避免实现时混入钩子方案。

相关本地路径（B 的事实锚点）：

- UI：`src/renderer/components/connection-center/`（`ConnectionCenter.tsx` / `Panel` / `ChannelRow` / `WebUiConnectBlock` / `QrCode`）
- 注册表：`src/main/ipc/channel-handlers.ts` → `registerChannelRegistry()` 仅注册 `feishu` / `dingtalk` / `wecom`
- 契约：`src/main/services/channels/types.ts`（`ChannelAdapter`）、`src/shared/types/channel.ts`（manifest / 五态 / 能力位）
- 运行时：`src/main/services/channels/{manager,bridge,runtime,adapters/*}`

> 注：仓库另有 **pi-agent-core**（Agent 内核）与「市场 pi 工具」链路，**不是**「进程 PID 连接器」。口头「PID」勿与 pi 工具市场混淆。

---

## 1. QQ：官方机器人 + 扫码 Onboard（2026）

### 1.1 官方能力

- 开放平台 Bot：HTTPS OpenAPI + **WebSocket Gateway**（桌面可直连，无需公网）[官方] https://bot.q.qq.com/wiki/develop/api-v2/
- 认证：AppID + AppSecret；`Authorization: QQBot {ACCESS_TOKEN}`
- 事件：单聊 `C2C_MESSAGE_CREATE`、群 `@` `GROUP_AT_MESSAGE_CREATE`、频道等
- **扫码配置（Onboard）**：
  - Python：`tencent-connect/qqbot-agent-sdk` 的 `start_onboard`（展示 QR → 绑定后拿 app_id/secret）
  - Node：`@tencent-connect/qqbot-connector` 的 `qrConnect` / `startQrConnect`（控制台/回调展示二维码，扫码后返回凭据数组）
- 生态参考：CowAgent / OpenClaw 系 QQ channel 文档多为「填 AppID/Secret 或扫码后写入配置」

### 1.2 硬限制（教育场景痛点）

沿用全景调研结论并保留：

- 群/单聊**被动回复窗口短**（群约 5 分钟、每条消息回复次数有限）→ AI Agent 超时易失败
- **群主动消息配额极严**（社区实测约每月数条级）→ 主动通知几乎不可用
- `streamingKind = 'none'`（无编辑已发消息）

### 1.3 对本产品的含义

- **扫码直连可行**：连接中心可做「展示 QR → 轮询 onboard → 自动写入 settings/keystore → start」
- **产品定位应诚实**：适合「学生/家长在 QQ 里问一句 AI 助教答一句」；不适合「群里定时成绩播报」
- 优先级相对微信个人号：**同属 P0 体验目标**，但能力位弱于飞书/钉钉；可先做 comingSoon 卡 + 扫码 MVP 收消息/被动回复

---

## 2. 微信：官方 ClawBot / iLink vs 非官方 PID 钩子

### 2.1 官方 / 准官方：微信 ClawBot（iLink）

2026 腾讯通过 **微信 ClawBot 插件 + iLink Bot HTTP API** 为**个人微信**开放合法 Bot 通道（条款与专用域名），典型接入面：

| 组件 | 说明 |
|---|---|
| 登录域名 | `https://ilinkai.weixin.qq.com`（取 QR / 轮询扫码状态） |
| 会话 | 扫码成功后得 `bot_token` + `baseurl`；消息接口走 baseurl |
| 收消息 | 长轮询 `getupdates` |
| 发消息 | `sendmessage`（须带会话 `context_token`） |
| 媒体 | `getuploadurl` + AES 加解密 |
| OpenClaw 插件 | `@tencent-weixin/openclaw-weixin`：`channels login --channel openclaw-weixin` 终端扫码 |
| CLI 安装 | `npx -y @tencent-weixin/openclaw-weixin-cli install` |
| cc-connect | `cc-connect weixin setup` 扫码写 `config.toml` |
| 能力边界 | 以官方插件元数据为准：多强调**私聊**；群能力/主动推送受限（须用户先发言拿 context_token） |

**合规性**：相对历史 Web 协议 / iPad 协议 / PC Hook，这是当前**首选合法路径**。仍须遵守《微信 ClawBot 功能使用条款》；腾讯可限速、拦截、调整可连 AI 类型。

### 2.2 企业向微信生态（本仓库已有部分）

| 路径 | 桌面直连 | 本仓库 | 备注 |
|---|---|---|---|
| 企微智能机器人长连接 | ✅ WSS | ✅ `adapters/wecom`（beta） | 已实现 |
| 企微自建应用 HTTP 回调 | ❌ 需公网 | 未做 | `receivesVia=webhook` → 中继 |
| 微信客服 / 公众号 | ❌ 需公网 + 窗口限制 | 未做 | 全景调研 P3 |
| WorkBuddy「微信客服号」扫码 | 产品侧托管 | 外部参考 | 绑定后走客服入口，非好友列表原生 bot |

### 2.3 非官方：基于进程 PID / Hook（明确高风险）

| 方案 | 原理 | 风险 |
|---|---|---|
| WeChatFerry 等 | 注入/挂钩 Windows 微信进程（按 PID） | 违反用户协议，**高封号**；客户端升级即碎 |
| 历史 itchat / iPad 协议 | 模拟协议 | 灰色/诉讼/封禁史 |
| 纯 UI 自动化 / 剪贴板桥 | 找窗口 PID → 键鼠/剪贴板 | 脆弱、无结构化消息、隐私面大 |

**结论**：连接中心**不得**把 PID Hook 做成默认或推荐连接方式；文档与 UI 不引导用户对主微信号做注入。

### 2.4 对本产品的含义（微信）

- **P0 推荐实现**：`weixin`（或 `wechat`）ChannelAdapter，连接方式 = **扫码（iLink）+ 长轮询**，凭证落 keystore；UI 复用连接中心已有 QR 组件模式（当前 QR 用于 WebUI，需扩展为「渠道登录 QR」会话）
- **可选依赖策略**：
  1. **自研薄客户端**直接打 iLink HTTP（不强制安装 OpenClaw）——推荐，控制面在本应用内
  2. **可选 sidecar**：检测本机 OpenClaw / 调用 `@tencent-weixin/openclaw-weixin` ——增加运维面，仅作高级选项
- **不做**：WeChatFerry / 任意 DLL 注入路径

---

## 3. 其他国内候选（现实度排序）

| 候选 | 现实度 | 连接方式 | 建议优先级 | 说明 |
|---|---|---|---|---|
| **钉钉** | 高 | Stream WSS + 凭证 | ✅ 已落地 | 保持维护 |
| **企微智能机器人** | 高 | 长连接 WSS | ✅ 已落地（beta） | 可补扫码创建机器人（企微 OpenClaw CLI 扫码关联） |
| **飞书** | 高 | WS 长连接 + 凭证 | ✅ 已落地 | 用户另有 dirty WIP，本分支不碰其脏文件 |
| **QQ 官方 Bot** | 中高（扫码易）/ 能力中低 | WS + 扫码 onboard | **P0** | 见 §1 |
| **微信个人 ClawBot/iLink** | 高（合法扫码） | QR + 长轮询 | **P0** | 见 §2.1 |
| **微信客服 / 公众号** | 中 | 公网 webhook | P2–P3 | 需中继；48h/5 条等限制 |
| **邮件 IMAP/SMTP** | 高 | IDLE + SMTP | P1 | 全景调研已论证；非 IM 但教师刚需 |
| **华为小艺** | 中（偏鸿蒙分发） | 小艺开放平台 **A2A**（JSON-RPC `message/stream` + SSE）；开发者实现云端 Agent 端点 | P2 观察 | 方向是「把本产品 Agent **注册给小艺**」，不是「小艺当入站 IM 频道」；需华为开发者资质与公网 HTTPS |
| **抖音私信** | 低–中 | 开放平台 IM；多需经营者/小程序资质；移动网站应用私信能力曾暂停新增 | P3 / 观察 | 合规与申请门槛高，教育桌面端 ROI 低 |
| **短信** | 中（出站通知） | 运营商/云短信 API | P2（出站 connector，非频道） | 适合成绩通知；属 WorkBuddy 式「连接器」轴，不是入站 Channel |
| **国外 IM** | — | — | **非目标** | Slack/Discord/Telegram 等留给外部 PR |

---

## 4. 连接方式可行性矩阵（国内）

| 方式 | QQ | 微信个人 | 企微/钉钉/飞书 | 小艺 | 风险 |
|---|---|---|---|---|---|
| **扫码绑定 / Onboard** | ✅ 官方 QR connector | ✅ iLink QR | 部分（企微 OpenClaw 扫码关联；飞书/钉钉多为凭证） | ❌（平台侧配置） | 低（官方） |
| **凭证 + 长连接 WS** | ✅ Gateway | ❌（iLink 为 HTTP 长轮询） | ✅ | ❌ | 低 |
| **长轮询 HTTP** | 可选 Webhook | ✅ getupdates | — | — | 低 |
| **公网 Webhook 中继** | 可选 | 公众号/客服 | 自建应用 | A2A 需公网 | 中（运维） |
| **本机窗口 / PID Hook** | 社区方案存在 | WeChatFerry 等 | 少见 | — | **极高** |
| **剪贴板桥 / OCR** | 理论可行 | 理论可行 | — | — | 高（脆弱+隐私） |
| **本机 WebUI 扫码** | — | — | — | — | 已实现（连的是本应用，不是 IM） |

---

## 5. 与 OpenClaw / cc-connect 的关系（借鉴不绑定）

- **OpenClaw**：频道插件契约 + 外部 `@tencent-weixin/openclaw-weixin`；扫码登录存 `~/.openclaw`
- **cc-connect**：多平台桥（飞书/钉钉/企微/QQ/个人微信 ilink）；CLI 扫码写配置；可 ACP 桥接 OpenClaw
- **本产品**：已有自研 `ChannelManager` + Bridge，**应保持自研适配器**，协议对齐 iLink / QQ OpenAPI；**不要求**用户先装 OpenClaw 才能用连接中心
- 可选：「检测本机 OpenClaw 已登录微信 → 导入 token」作为高级迁移路径（非 MVP）

---

## 6. 开放问题（需产品决策）

1. 微信个人号：是否接受「仅私聊、需用户先发言、弱主动推送」作为 P0 上线标准？
2. QQ：是否接受「弱主动通知」仍上架连接中心（文案标明限制）？
3. 是否提供 OpenClaw sidecar 兼容，还是纯自研 iLink？
4. 小艺：做「入站频道」还是「出站把 Agent 挂到小艺」？（调研倾向后者，且非 P0）
5. 邮件 / 短信是否并进连接中心「消息频道」分区，还是另开「通知连接器」分区？

---

## 7. 来源摘要

- 本仓库：`docs/research/2026-09-12-channel-connector-catalog.md`、channel 架构/连接中心实施计划、`src/main/services/channels/**`、`src/renderer/components/connection-center/**`
- QQ：bot.q.qq.com API v2；`@tencent-connect/qqbot-connector`；`tencent-connect/qqbot-agent-sdk`
- 微信：docs.openclaw.ai/channels/wechat；`@tencent-weixin/openclaw-weixin`；社区 iLink 协议整理；WeChatFerry README（风险对照）
- 企微 OpenClaw / 扫码：work.weixin.qq.com 智能机器人更新日志
- 小艺：华为开发者文档 A2A / message-stream
- 抖音：开放平台 IM 文档（申请与限流约束）
