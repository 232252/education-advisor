# 调研：开源 QwenPaw 频道全量目录

> 日期：2026-09-14 ｜ 性质：**只读调研（不实现）**  
> 真源优先：GitHub [`agentscope-ai/QwenPaw`](https://github.com/agentscope-ai/QwenPaw) + 官方文档 `website/public/docs/channels.zh.md`（raw）  
> 次要：DeepWiki / Release notes；**本机 `.qwenpaw*` 未作为主依据**（用户要求 prefer open-source）  
> 对照产品：`education-advisor-connectors` @ `feat/domestic-wechat-qq-channels` tip（含 weixin/qq）

---

## 1. 仓库与文档定位

| 项 | 值 |
|---|---|
| 官方仓库 | https://github.com/agentscope-ai/QwenPaw （Apache-2.0，agentscope-ai org） |
| 文档站 | https://qwenpaw.agentscope.io/docs/channels/ |
| 内置注册表 | `src/qwenpaw/app/channels/registry.py` → `_BUILTIN_SPECS` |
| 统一基类 | `src/qwenpaw/app/channels/base.py` → `BaseChannel` |
| 插件频道 | Plugin Marketplace `register_channel`；例：`azure_bot`（PR #5849） |
| 扫码公共件 | `qrcode_auth_handler.py`（微信 iLink 等） |

**统计（本调研截止 2026-09-14，对照 main 注册表 + 文档附录）**

| 类型 | 数量 | 说明 |
|---|---:|---|
| 内置频道键 | **18** | 见 §2 `_BUILTIN_SPECS` |
| 官方文档主述插件频道 | **1** | `azure_bot` |
| **目录合计（内置+已文档化插件）** | **19** | Console 算内置；不含社区任意插件 |
| 其中「国外 / 偏海外」标 later | 8+ | Discord / Telegram / Slack / Matrix / Mattermost / iMessage / Voice(Twilio) / Azure Bot |
| 其中「国内优先」 | 9 | 钉钉 / 飞书 / QQ / OneBot / 企微 / 微信 / 小艺 / 元宝 / MQTT（物联网，中性）+ SIP（可国内） |

> Console 是本机控制台对话面，通常**不映射**到教育顾问「连接中心 IM 卡片」；计划文档里单独标注。

---

## 2. 全量频道表（id / 分类 / 鉴权 / 入出站 / 备注）

图例：

- **Region**：`domestic` 国内优先｜`foreign` 国外 later/PR-ok｜`neutral` 中性/基础设施｜`local` 本机 UI
- **Auth**：主要接入方式
- **In/Out**：消息方向能力摘要（细节见官方多模态表）

### 2.1 内置（`registry.py`）

| # | id | 显示名 | Region / 分类 | Auth | Inbound | Outbound | 备注 |
|---:|---|---|---|---|---|---|---|
| 1 | `console` | Console | local / 本机 | 无外部鉴权 | Console UI → agent | Console 渲染 | 非 IM；教育顾问对应桌面/WebUI 对话，一般不进「更多」IM 网格 |
| 2 | `dingtalk` | 钉钉 | domestic / 企业 IM | Client ID + Secret（Stream） | Stream 收 | Markdown / AI Card | 推荐；可选私有化 `api_endpoint` |
| 3 | `feishu` | 飞书 / Lark | domestic（Lark=国际域名） | App ID + Secret；WS 长连接 | WS 事件 | Open API | `domain: feishu\|lark` |
| 4 | `wecom` | 企业微信 | domestic / 企业 IM | Bot ID + Secret | WS 长连接 | markdown / template_card | 智能机器人 API 模式 |
| 5 | `wechat` | 微信个人（iLink） | domestic / 个人 IM | **QR 扫码** 或 bot_token | HTTP **长轮询** getupdates | sendmessage（文/图/文件/视频；音频发送受限） | 配置键 `wechat`；cron 勿用 `weixin`（历史命名坑） |
| 6 | `qq` | QQ 官方 Bot | domestic / 个人·群 IM | AppID + ClientSecret；门户扫码绑定 | Gateway WS | OpenAPI + /files | 功能相对官方配额受限 |
| 7 | `onebot` | OneBot v11 | domestic* / QQ 完整协议 | 反向 WS + access_token | NapCat 等 → reverse WS | OneBot 段 | *合规风险高；教育顾问既有政策 **禁止** 产品化 |
| 8 | `xiaoyi` | 华为小艺 | domestic / 语音助手 A2A | AK/SK + agent_id | 双 WS A2A | A2A artifact | 偏「挂 Agent 到小艺」，非班级 IM |
| 9 | `yuanbao` | 腾讯元宝 | domestic / AI 助手平台 | AppID + AppSecret | protobuf WS | REST/COS 媒体 | Bot 开放平台 |
| 10 | `mqtt` | MQTT | neutral / IoT | host/port/user/pass/TLS | subscribe_topic | publish_topic | 文本/JSON；物联网桥 |
| 11 | `sip` | SIP 语音 | neutral / 语音 | SIP 注册或 LiveKit；DashScope STT/TTS | SIP/RTP 或 LiveKit | TTS 语音 | Dev 内置 registrar / LiveKit 生产 |
| 12 | `discord` | Discord | foreign / 海外 IM | Bot Token；（可选代理） | Gateway | REST | 国内常需代理 |
| 13 | `telegram` | Telegram | foreign / 海外 IM | BotFather Token；（可选代理） | long poll / update | Bot API | 国内常需代理 |
| 14 | `slack` | Slack | foreign / 海外 IM | bot_token + app_token（Socket Mode） | Socket Mode | chat/files | |
| 15 | `matrix` | Matrix | foreign / 联邦 IM | homeserver + user_id + access_token | Sync | Client-Server API | |
| 16 | `mattermost` | Mattermost | foreign* / 自托管 IM | URL + bot_token | WS | REST | *可国内私有部署，产品仍标 later |
| 17 | `imessage` | iMessage | foreign / 苹果 | 本地 chat.db + imsg；**仅 macOS** | DB 轮询 | imsg 发文本 | 无附件 |
| 18 | `voice` | Voice (Twilio) | foreign / 电话语音 | Twilio SID/Token + 号码；公网 Webhook | ConversationRelay | TTS | 需内网穿透 |

### 2.2 插件频道（文档+Release 确认）

| # | id | 显示名 | Region | Auth | Inbound | Outbound | 备注 |
|---:|---|---|---|---|---|---|---|
| 19 | `azure_bot` | Azure Bot | foreign / Teams 等 | app_id + app_password + tenant_id | **Webhook** `/api/messages`（默认 :3978） | Bot Framework | **非内置**；插件市场安装；JWT 校验 |

### 2.3 鉴权模式归类（onboard 视角）

| Auth 模式 | 频道 |
|---|---|
| **QR 扫码** | `wechat`（主路径）；QQ 门户扫码绑定（写入 AppID/Secret，非持久 QR session 同一语义） |
| **OAuth/应用凭证（client_id+secret / app_id+secret）** | dingtalk, feishu, qq, yuanbao, azure_bot, xiaoyi(ak/sk) |
| **Bot Token 单密钥** | discord, telegram, wecom(bot_id+secret), mattermost, slack(双 token), matrix(access_token) |
| **反向 WebSocket / 自建监听** | onebot（QwenPaw 开 WS 服务端） |
| **Webhook 入站** | voice（Twilio）, azure_bot |
| **本地轮询 / 系统集成** | imessage（DB）, wechat（HTTP long-poll）, mqtt |
| **SIP / 实时语音** | sip, voice |

### 2.4 与 education-advisor 已有实现对照

| QwenPaw id | EA 渠道 id | 状态（本 worktree） |
|---|---|---|
| `feishu` | `feishu` | ✅ `FeishuAdapter` |
| `dingtalk` | `dingtalk` | ✅ `DingtalkAdapter` |
| `wecom` | `wecom` | ✅ `WecomAdapter` |
| `wechat` | `weixin` | ✅ `WeixinILinkAdapter`（id 用 `weixin`，对齐产品命名） |
| `qq` | `qq` | ✅ `QqBotAdapter` |
| 其余 14 | — | ❌ 未实现（见计划文档分批） |

命名差异：QwenPaw 运行时键为 **`wechat`**；EA 为 **`weixin`**。文档与 cron/配置映射时需显式 alias，避免 QwenPaw 历史 `weixin` KeyError 类问题。

---

## 3. QwenPaw 统一接口（对照用）

所有内置频道继承 **`BaseChannel`**，由 **`ChannelManager`** 统一队列消费：

必须实现（文档「扩展渠道」）：

1. `build_agent_request_from_native(native_payload)`
2. `from_config` / `from_env`
3. `async start()` / `async stop()`
4. `async send(to_handle, text, meta=None)`

基类提供：`consume_one` 默认路径、`send_message_content` / `send_content_parts`、session_id 解析、展示配置、可选 `refresh_webhook_or_token`。

插件路径：`PluginApi.register_channel` + schema → Console 动态表单；可 `register_http_router` 挂 Webhook。

通用配置字段：`enabled`, `bot_prefix`, `show_tool_*`, `dm_policy` / `group_policy` / `allow_from` / `require_mention` 等访问控制。

---

## 4. 多模态能力摘要（官方附录表压缩）

多数主流 IM（钉钉/飞书/Discord/Slack/QQ/OneBot/企微/微信/Telegram/Matrix/Azure）文档宣称收发文本+多媒较全；例外：

| 频道 | 主要限制 |
|---|---|
| iMessage | 仅文本 |
| Voice | 仅语音通话 |
| 小艺 | 无视频/音频；发送媒体部分 🚧 |
| 元宝 | 平台不转发视频给 Bot |
| QQ（文档脚注） | 部分媒体曾标 🚧（实现随版本变，以仓库为准） |
| Mattermost | 视频/音频 🚧 |

---

## 5. 对「更多」目录的直接启示

1. **卡片数据应驱动自 manifest 目录**（含 `comingSoon`），勿硬编码 5～6 个国内卡。  
2. **分组建议**：国内企业 IM / 国内个人 IM / 国内助手与 IoT / 语音 / 海外（折叠或 later 徽标）/ 本机。  
3. **OneBot**：目录可展示为「不支持 / 合规原因」，避免用户以为漏做。  
4. **Console / Voice / SIP**：是否进连接中心需产品拍板（语音 vs 消息分区）。  
5. **微信键名**：对外文案「微信」，内部 id 保持 `weixin`；映射表写进计划。

---

## 6. 参考链接

- Registry: https://raw.githubusercontent.com/agentscope-ai/QwenPaw/main/src/qwenpaw/app/channels/registry.py  
- 频道文档 ZH: https://raw.githubusercontent.com/agentscope-ai/QwenPaw/main/website/public/docs/channels.zh.md  
- Azure Bot plugin PR: https://github.com/agentscope-ai/QwenPaw/pull/5849  
- CONTRIBUTING「Adding New Channels」: https://github.com/agentscope-ai/QwenPaw/blob/main/CONTRIBUTING.md  

---

## 7. 调研边界

- 未克隆完整 QwenPaw 源码到本机；以 raw GitHub + 文档为准。  
- 未枚举社区第三方 plugin channel（仅官方文档化的 `azure_bot`）。  
- 多模态「✓/🚧」以文档附录为准，实现代码可能略新/略旧于文档。