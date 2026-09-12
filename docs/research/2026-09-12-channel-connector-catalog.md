# 频道连接器全景调研——下一步扩展执行清单

> 调研日期：2026-09-12 ｜ 调研目的：为 education-advisor 桌面端（Electron）抽象 `ChannelAdapter` 接口后，评估下一个接入的对外频道。
> 现状：唯一频道为飞书机器人（WebSocket 长连接收消息 → Agent 处理 → 回复，含 CardKit 流式卡片）。
> 目标接口（阶段 2 抽象基准）：`connect/disconnect`（生命周期）+ `onMessage`（入站）+ `reply/push`（出站）+ 能力位 `canSendCard / supportsStreamingUpdate / maxTextLength / receivesVia`。
> 标注约定：**[官方]** = 平台官方文档；**[社区]** = GitHub issue / 社区实践。所有论断附来源 URL。
> 说明：本文只新增本文件，未改动仓库其他文件。本仓库现有飞书实现位于 `src/main/services/feishu-bot/`（event-handler / dedup-cache / chat-queue / streaming-card / file-receive 等），第 5 节的复用分析以此为基准。

---

## 0. 速览结论

**建议接入顺序（P0 → P3）**：

1. **P0 钉钉（Stream Mode）** — 与飞书 WS 几乎同构，桌面直连，有 AI 卡片流式（对标飞书 CardKit），学校教师群体渗透率高。
2. **P1 企业微信（智能机器人·长连接模式）** — 同样桌面直连（`wss://openws.work.weixin.qq.com`），**原生支持流式回复**，教育机构常用；但功能较新（2024+），生态坑待验证。
3. **P2 邮件（IMAP IDLE + SMTP）** — 桌面直连、教师强刚需（家长/通知邮件）、实现简单；作为「能力位全 false」的代表可同时验证 Adapter 抽象的完备性。
4. **P3 微信公众号 / 微信客服** — 用户价值最高（微信是国内教师/家长的默认 IM），但**必须公网回调中继** + 48h/5 条窗口 + 无流式，建议随云端中继方案一起做。
5. **观察名单**：QQ 官方机器人（WS 可直连，但群主动消息实测每月仅 4 条，严重限制 Agent 主动通知场景）；Telegram / Discord / Slack（可达性或用户群与国内教育场景不符，暂不投入）。

**流式能力一览**：✅ 可流式 = 钉钉（AI 卡片 streamingUpdate）、企业微信智能机器人（`stream.id`）、Telegram（editMessageText / 新 sendMessageDraft）、Slack（chat.update）、Discord（PATCH message）；❌ 不可流式 = 微信公众号、微信客服、QQ 官方机器人、邮件。

---

## 1. 总对比表

| 平台 | 接入模式 | 桌面直连 | 认证 | 收消息 | 去重要求 | 发消息/频控 | **流式更新** | 文件接收 | canSendCard | supportsStreamingUpdate | maxTextLength | receivesVia | 难度 | 优先级 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **钉钉** | Stream Mode（出站 WSS）+ HTTP 回调（outgoing，需公网） | ✅ | clientId/clientSecret（AppKey/Secret） | Stream 回调 topic `/v1.0/im/bot/messages/get` | `headers.messageId` ACK；事件超时会重推需幂等；机器人消息 fire-and-forget 不重推 | OpenAPI 群发/单聊发；服务端 API 默认约 20 QPS、自定义 webhook 机器人 20 条/分钟 | ✅ AI 卡片 + `streamingUpdate`（打字机） | `downloadCode` → `/v1.0/robot/messageFiles/download` 换临时链接 | ✅（互动/AI 卡片模板） | ✅ | 官方未明示（卡片/文本均无硬上限文档） | `ws` | 2/5 | **P0** |
| **企业微信** | ①自建应用 HTTP 回调（必须公网 URL）；②智能机器人：HTTP 回调 或 **长连接 WSS** | ✅（智能机器人长连接） | corpid+secret / BotID+长连接专用 Secret | `aibot_msg_callback` / `aibot_event_callback`（长连接）；自建应用 XML 回调 | 回调需按 MsgId 去重；长连接模式官方未强调重推，仍建议幂等 | 智能机器人单会话 30 条/分钟、1000 条/小时；全 API 每企业单接口 1 万次/分 | ✅ `aibot_respond_msg` 携带 `stream.id`，`finish=true` 结束，10 分钟窗口 | 图片/文件附 `url+aeskey`（AES-256-CBC，URL 5 分钟有效） | ✅（模板卡片；流式+模板卡片暂不支持组合） | ✅（仅智能机器人） | 官方未明示 | `ws` | 2.5/5 | **P1** |
| **微信公众号** | HTTP 回调（必须公网 URL + ICP 备案域名） | ❌ 必须中继 | AppID/AppSecret + Token/AESKey 签名 | XML 回调推送 | 立即回 200 防重试（微信超 5s 断连并重试 3 次），按 MsgId 去重 | 被动回复 5 秒内；客服消息 48h 窗口、额度 5 条/次互动 | ❌（被动一次性；客服消息只能发新消息） | 图片/语音/视频素材接口（media_id） | ❌（文本/图片/图文，无卡片） | ❌ | 文本约 2048 字节量级（历史文档值，实施时实测） | `webhook` | 3/5 | **P3**（随中继） |
| **微信客服（企微）** | HTTP 回调 + `sync_msg` 主动拉取 | ❌ 必须中继 | 企微 corpid + 微信客服 secret | 回调事件 → `sync_msg`（cursor 分页）拉取 | `sync_msg` cursor 机制天然防重，仍建议按 msgid 幂等 | 48h 窗口内最多 5 条，用户再发言重置额度 | ❌ | 图片/语音/视频/文件（media_id） | ❌（有菜单消息但非卡片） | ❌ | 官方未明示 | `webhook` | 3/5 | **P3**（随中继） |
| **QQ 官方机器人** | WebSocket（Gateway）或 Webhook | ✅（WS） | AppID + AppSecret + Bot token | `GROUP_AT_MESSAGE_CREATE` / `C2C_MESSAGE_CREATE` / 频道 `AT_MESSAGE_CREATE` | 按 event id 幂等；群/单聊回复必须带来源 `msg_id` | 群/单聊被动回复 5 分钟（群）/60 分钟（单聊）有效、每条消息限回 4~5 次；私信主动 200 条/天；**群主动消息实测每月约 4 条**；子频道 5 条/秒 | ❌（无编辑消息 API） | 富媒体 API（图片/语音/视频/文件，先取上传地址） | ❌（markdown 模板需报备） | ❌ | 官方未明示 | `ws` | 3/5 | 观察名单 |
| **Telegram** | getUpdates 长轮询（默认 50s 短路）或 Webhook | ✅（长轮询） | 单一 Bot Token | `update` 数组，`update_id` 递增 | 记录 `update_id` offset；长轮询与 webhook 互斥 | 全局约 30 msg/s；单聊天约 1 msg/s、群约 20 条/分钟；429 + retry_after | ✅ `editMessageText`（1–4096 字符）；Bot API 9.5 新增 `sendMessageDraft` 草稿流式 | `file_id` → `getFile` → `…/file/bot<token>/<path>`，**≤20MB**（本地 Bot API Server 可到 2GB） | ❌（InlineKeyboard，非卡片） | ✅ | 4096 字符 | `polling` | 1.5/5 | 观察名单（**大陆被墙**） |
| **Slack** | Socket Mode（出站 WSS，app token `xapp-`） | ✅ | bot token + app-level token | Events API over Socket Mode（envelope ack） | `event_id` 去重（至少一次投递） | 分级频控：`chat.postMessage` 每频道约 1 条/秒；`chat.update` Tier 3 ≈ 50+/分钟；429 + Retry-After | ✅ `chat.update` | `files.uploadV2` 上传（`files.upload` 已弃用）；下载 `url_private_download` + Bearer | ✅（Block Kit） | ✅ | text ≈ 40,000 字符（chat.postMessage 文档） | `ws` | 2/5 | 观察名单 |
| **Discord** | Gateway WSS（需心跳 + IDENTIFY） | ✅ | Bot Token（+特权 intent 开关） | `MESSAGE_CREATE` / `MESSAGE_UPDATE` | 需处理 resume/重放，按消息 id 幂等 | REST 每频道 5 条/5 秒；Gateway 出站 120 事件/60 秒 | ✅ `PATCH /channels/{id}/messages/{id}`（受 5/5s 限制） | 消息 attachment `url` 直接 GET | ❌（Embed，非卡片） | ✅ | 2000 字符（普通 bot 消息） | `ws` | 2.5/5 | 观察名单（**大陆被墙**） |
| **邮件 IMAP/SMTP** | IMAP IDLE 推送（RFC 2177）+ SMTP 发送 | ✅ | 账号/授权码或 OAuth2（Gmail） | IDLE `EXISTS` → FETCH | 按 `Message-ID` 去重（服务器可能重复投递） | SMTP 无平台级频控（服务商自有配额）；**已发邮件不可编辑** | ❌ | MIME 附件（mailparser 解析） | ❌ | ❌ | 无硬限制（整封邮件受服务商大小限制，常见 ~25–50MB） | `imap-idle` | 2/5 | **P2** |

---

## 2. 适配器事实卡（逐平台详情）

### 2.1 钉钉机器人（重点）

**接入模式**
- **Stream Mode**：钉钉官方推荐的集成方式，通过 **WebSocket** 长连接接收机器人回调、事件订阅与卡片回调，**无需公网 IP/域名、无需加解密密钥** [官方] https://open.dingtalk.com/document/resourcedownload/introduction-to-stream-mode
- **HTTP 回调（outgoing）**：传统模式，需要公网可访问 URL，与飞书旧版回调类似；两种模式二选一即可满足我们场景，**选 Stream Mode** [官方] https://help.dingtalk.io/open/dingstart/robot-receive-message

**Stream 协议细节（自研客户端时必需）** [官方] https://open-dingtalk.github.io/developerpedia/docs/learn/stream/protocol/
1. `POST https://api.dingtalk.com/v1.0/gateway/connections/open`（body: `clientId`/`clientSecret`/`subscriptions[]`）→ 返回 `endpoint`（如 `wss://wss-open-connection.dingtalk.com:443/connect`）+ `ticket`；**ticket 有效期 90 秒且仅可用一次**。
2. WSS 握手 `GET /connect?ticket=...`；每条连接可通过 `subscriptions` 同时订阅多个 topic（type: EVENT / CALLBACK）。
3. 机器人消息 topic：`/v1.0/im/bot/messages/get`（群聊需 @机器人，单聊无需）；卡片回调 topic：`/v1.0/card/instances/callback`。
4. 下行：`{ specVersion, type: SYSTEM|EVENT|CALLBACK, headers: { topic, contentType, messageId, time }, data }`（data 为 JSON 字符串）；上行 ACK 必须回传同一 `messageId`。
5. 心跳：服务端推送 SYSTEM `ping`（data 含 `opaque`），客户端原样回传 `opaque` 即可；服务端静默 10s 会主动断 TCP。
6. **服务端会定期主动断连做负载均衡**（先推 `disconnect`，reason 如 "connection is expired"）→ 客户端必须实现自动重连（重新取 ticket → 重连）。
7. 多连接时服务端按随机策略选一条通道推送（可做多实例负载分担）。

**认证**：clientId/clientSecret（即旧 AppKey/AppSecret），HTTP API 用其换 access_token [官方] https://open.dingtalk.com/document/direction/stream-mode-protocol-access-description

**收消息与去重**：机器人回调为 fire-and-forget，不因超时重推；但事件订阅（EVENT）在 ACK 超时时会重推，**业务需按 `headers.messageId` 幂等** [官方] 同上协议文档。这与我们飞书 `dedup-cache.ts` 的模式完全一致。

**发消息 API 与频控**
- 群聊：`POST /v1.0/robot/groupMessages/send`；单聊批量：`POST /v1.0/robot/oToMessages/batchSend`（一次最多 20 人）[官方] https://open.dingtalk.com/document/development/the-robot-sends-a-group-message 、 https://open.dingtalk.com/document/orgapp/chatbots-send-one-on-one-chat-messages-in-batches
- 频控 [官方]：
  - 服务端 API 默认 **20 QPS**（企业内部应用）https://open.dingtalk.com/document/orgapp-server/descriptions-about-adjusting-limit-and-frequency-of-api-calls
  - 自定义机器人（webhook 发送）**20 条/分钟**，超限封 10 分钟 https://open.dingtalk.com/document/isvapp/invocation-frequency-limit-1
  - IP 级总量：20 秒内 10000 次，超限封 5 分钟 https://open.dingtalk.com/document/development/call-frequency-limit
  - 限流总说明（1 秒窗口）https://open.dingtalk.com/document/development/how-to-process-api-throttling-on-the-dingtalk-server
- 教师单校场景的量级远低于以上阈值，正常使用不会触顶；Agent 批量通知需加队列限速。

**流式更新（对标飞书 CardKit）** ✅
- 流程：卡片平台创建「消息卡片 + AI 卡片场景」模板 → `createCardInstance`（得 `outTrackId`，`callbackType = STREAM`）→ 投放卡片到会话 → 循环调 **`streamingUpdate`** API 持续更新（客户端呈打字机效果）→ 结束流式 [官方] https://open.dingtalk.com/document/development/api-streamingupdate 、教程 https://open.dingtalk.com/document/development/typewriter-effect-streaming-ai-card 、 https://open.dingtalk.com/document/development/overview-card
- 实现要点：需 Stream SDK 长连接 + 创建卡片时指定 `callbackType = STREAM` [社区] https://developer.aliyun.com/ask/688210 ；官方完整示例仓库 [社区] https://github.com/open-dingtalk/dingtalk-card-examples 、Go 版打字机教程 [社区] https://open-dingtalk.github.io/developerpedia/docs/explore/tutorials/stream/bot/go/send-streaming-card
- 语义与飞书 CardKit 相同：**传累计全量文本**，客户端节流渲染——可直接套用我们 `streaming-card.ts` 的 `ReplySession`（update/finalize/fail 三态 + 全量文本节流）设计。

**文件接收**：图片/语音/视频/文件/富文本消息回调携带 `downloadCode` → `POST /v1.0/robot/messageFiles/download` 换**临时下载链接** → GET 下载 [官方] https://open.dingtalk.com/document/development/download-the-file-content-of-the-robot-receiving-message 、消息类型字段 https://open.dingtalk.com/document/development/robot-message-type 。注意：自定义 webhook 机器人不支持接收文件/语音/视频——必须用企业内部应用机器人。

**个人版 vs 组织版差异**
- **企业内部应用机器人**（组织）：完整能力——Stream 收消息、发消息 API、AI 卡片、文件下载，是唯一满足我们场景的形态 [官方] https://open.dingtalk.com/document/dingstart/robot-application-overview
- **自定义机器人**：仅出站 webhook 推送，20 条/分钟，收消息/文件能力缺失 [社区] https://developer.aliyun.com/ask/583499
- **AI 助理**：钉钉自托管 AI 封装，分「仅自己使用（个人）」与「组织成员使用」，适合零代码场景，不适合自研 Agent 接入 [官方] https://open.dingtalk.com/document/aipass/faq-2
- 对教师用户：学校若已用钉钉（国内中小学主流），组织内创建应用通常由学校管理员一次性授权。

**已知坑** [社区]
- 服务端约每 30s 推 `disconnect` 做负载均衡，客户端频繁重连属正常行为：https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/573
- Python/通用 SDK `DWClient._connect()` 心跳 timer 泄漏（每次重连累积一个 `setInterval`）：https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/185
- Node SDK 回调超时/无限回调问题：https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs/issues/16
- 8 秒 ping/pong 超时写死，NAT 空闲易断连（需保活或自研客户端）：https://www.cnblogs.com/haochuang/p/19666146
- 官方 Node SDK 仓库：https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs

**能力位映射**：`canSendCard=true`（AI/互动卡片）｜`supportsStreamingUpdate=true`（streamingUpdate）｜`maxTextLength=null`（官方未明示，实施时实测）｜`receivesVia='ws'`
**难度 2/5**（与飞书同构度约 80%）。**优先级 P0。**

---

### 2.2 企业微信

**接入模式（两条线）**
1. **自建应用（Agent）**：接收消息必须配置**公网可访问回调 URL**（不支持 IP 地址、可信域名需 ICP 备案），Token + EncodingAESKey 加解密 [官方] https://developer.work.weixin.qq.com/document/path/90930 、 https://developer.work.weixin.qq.com/document/path/90238 、 https://open.work.weixin.qq.com/help2/pc/21316 ；调 API 还需配置「企业可信 IP」[社区] https://zhuanlan.zhihu.com/p/716949615 → **桌面端无法直连，必须云端中继**。
2. **智能机器人（2024 年推出的新形态）**：支持两种 API 模式——HTTP 回调 **或长连接**；管理后台开启「API 模式」并选其一（互斥）[官方] https://developer.work.weixin.qq.com/document/path/101039

**智能机器人长连接（重点，桌面友好）** [官方] https://developer.work.weixin.qq.com/document/path/101463
- WebSocket 地址 `wss://openws.work.weixin.qq.com`；握手后发订阅命令 `aibot_subscribe`（BotID + 长连接专用 Secret）；**无需公网 URL、无需加解密**。
- **每个机器人同时只允许 1 条长连接**，新连接会踢旧连接（旧连接收 `disconnected_event`）——桌面端单实例恰好契合，但多开/调试会互踢。
- 心跳：官方建议 30 秒一次 `ping`，断线重连需自实现。
- 官方 SDK：Node.js `@wecom/aibot-node-sdk`（npm）、Python `wecom-aibot-python-sdk`（PyPI）。
- 消息回调 `aibot_msg_callback`：text / image / mixed / voice / file / video（image/voice/file/video 仅单聊）；图片与文件带 `url + aeskey`（AES-256-CBC，IV 取 aeskey 前 16 字节，**URL 5 分钟内有效**）。
- 事件回调：`enter_chat`、`template_card_event`、`feedback_event`、`disconnected_event`。

**回复与流式** [官方] 同上
- `aibot_respond_msg`：回调后 **24 小时内**回复；**原生支持流式**——刷新使用回调中相同 `req_id`、相同 `stream.id`，以 `finish=true` 结束；**首次发送起 10 分钟内必须完成**；暂不支持「流式 + 模板卡片」组合。
- `aibot_send_msg`：主动推送（前提：用户先给机器人发过消息）。
- 欢迎语 `aibot_respond_welcome_msg` 与卡片更新 `aibot_respond_update_msg`：5 秒内。

**频控**
- 智能机器人：单会话（回复+推送合并）**30 条/分钟、1000 条/小时**；临时素材上传 30 次/分钟 [官方] https://developer.work.weixin.qq.com/document/path/101463
- 全平台基础频控：每企业单接口 1 万次/分、15 万次/时；每 IP 2 万次/分；超限错误码 45009 [官方] https://developer.work.weixin.qq.com/document/path/90312

**流式语义差异**：企微流式是「**回复命令内嵌 stream 会话**」（一次 respond 多次刷新），而飞书/钉钉是「先发卡片再独立 update」。Adapter 的 `supportsStreamingUpdate` 语义需覆盖两种实现（详见 §5.2）。

**已知坑** [社区]
- 智能机器人较新，社区生态薄，实践参考少；回调服务框架可参考 https://github.com/easy-wx/wecom-bot-svr
- 自建应用线的企业可信 IP + 备案域名门槛是主要部署摩擦：https://zhuanlan.zhihu.com/p/1950206237435204538
- 微信客服线：回调 + `sync_msg` 拉取，**48h 窗口内最多 5 条**（用户新发言重置）[官方] https://developer.work.weixin.qq.com/document/path/94677 、 https://kf.weixin.qq.com/api/doc/path/94745

**能力位映射**：`canSendCard=true`（模板卡片；流式组合暂不支持）｜`supportsStreamingUpdate=true`（仅智能机器人长连接）｜`maxTextLength=null`（官方未明示）｜`receivesVia='ws'`
**难度 2.5/5**。**优先级 P1。**

---

### 2.3 微信公众号 / 微信客服

**接入模式**：HTTP 回调，**必须公网 URL**（开发者服务器地址），微信服务器主动 POST [官方] https://developers.weixin.qq.com/doc/service/guide/product/message/Receiving_standard_messages.html → 桌面端必须中继。

**5 秒限制（核心约束）** [官方] https://developers.weixin.qq.com/doc/subscription/guide/product/message/Passive_user_reply_message.html
- 微信推送用户消息后 **5 秒内收不到响应即断开**，并**重试 3 次**（导致重复消息）→ 必须「立即回 200/空串 + 异步处理 + 客服消息补发」的模式，且必须按 MsgId 去重重试消息。
- AI Agent 场景（处理常超 5 秒）只能走：立即 ack → Agent 异步 → **客服消息接口**发送结果。

**客服消息接口** [官方]
- 用户发消息/关注/菜单点击等互动后 **48 小时内**可主动发消息；「用户发消息」触发额度为 **5 条** https://developers.weixin.qq.com/doc/subscription/api/customer/message/api_sendcustommessage.html 、 https://developers.weixin.qq.com/doc/subscription/guide/product/kf/intro.html
- 48h 窗口近年多次收窄，实施时以最新文档为准 [社区] https://www.jingdigital.com/articles/13108/

**流式**：❌ 无任何编辑已发消息的接口；被动回复一次性、客服消息只能发新消息 → `supportsStreamingUpdate=false`。Agent 长回复可拆「开始处理提示 + 最终结果」两条发送。
**桌面端可行性**：需公网中继 + 备案域名；个人订阅者未认证号接口权限更受限（仅被动回复）[社区] https://help.aliyun.com/zh/model-studio/add-an-ai-assistant-to-your-wechat-in-10-minutes
**实战模式参考** [社区] https://juejin.cn/post/7289394615384555580 、 https://zhuanlan.zhihu.com/p/605333781

**微信客服（企业微信内，非公众号）**：回调事件 + `sync_msg`（cursor 分页）拉取消息 [官方] https://kf.weixin.qq.com/api/doc/path/94745 、 https://developer.work.weixin.qq.com/document/path/96426 ；发消息同样 48h + 5 条限制 [官方] https://developer.work.weixin.qq.com/document/path/94677 ；支持图片/视频/文件/菜单消息 [官方] https://kf.weixin.qq.com/api/doc/path/94744 。同样必须中继。

**能力位映射**：`canSendCard=false`｜`supportsStreamingUpdate=false`｜`maxTextLength≈2048 字节`（历史文档值，实施时实测）｜`receivesVia='webhook'`
**难度 3/5**（协议简单，但中继 + 窗口限制 + 审核成本高）。**优先级 P3**——用户价值最高（教师/家长都在微信），值得随中继方案立项。

---

### 2.4 QQ 官方机器人（QQ 开放平台）

**接入模式**：WebSocket（Gateway）与 Webhook **双模式可自由切换**（2024 年官方曾计划强制 Webhook 后回撤）[官方] https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html 、 https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/webhook.html ；[社区] https://forum.koishi.xyz/t/topic/10049 → **桌面端选 WS 可直连**。

**认证**：AppID + AppSecret / Bot token；OpenAPI 基于 HTTPS [官方] https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/api-call-guide.html

**收消息**：单聊 `C2C_MESSAGE_CREATE`、群 `GROUP_AT_MESSAGE_CREATE`（需机器人进群 + @）、频道 `AT_MESSAGE_CREATE`；按 event id 幂等。

**发消息与限制（最大痛点）** [官方 + 社区]
- 被动回复（带来源 `msg_id`）：群聊 **5 分钟有效期、每条消息最多回 5 次**；单聊 60 分钟、最多 4 次 [官方] https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html 、 https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html → **Agent 处理若超 5 分钟，回复直接失败**（对 AI 场景非常不友好）。
- 主动消息：私信每 bot **200 条/天** [官方] https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html ；**群主动消息实测每月约 4 条**，超额失败 [社区实测] https://github.com/zeroclaw-labs/zeroclaw/issues/1714
- 频道：每子频道 5 条/秒；Bot 维度（企业/个人认证）60 qpm [官方] https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html 、 https://bot.q.qq.com/wiki/develop/nodesdk/message/post_messages.html
- 同一 `msg_id` 多次回复用 `msgSeq` 区分 [官方] 同群消息 API 页。

**流式**：❌ 无编辑已发消息 API（群消息亦不支持流式参数）[官方] 同上 → `supportsStreamingUpdate=false`。富媒体（图片/语音/视频/文件）有独立 RichMedia API [社区] https://openclaw.zhcndoc.com/channels/qqbot
**已知坑** [社区]：沙箱环境限制、部分回调缺 `msg_id` 导致无法回复（https://github.com/zeroclaw-labs/zeroclaw/issues/1714 ）；机器人非群成员报 40034101 [官方错误码] https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html
**能力位映射**：`canSendCard=false`（markdown 模板需报备）｜`supportsStreamingUpdate=false`｜`maxTextLength=null`｜`receivesVia='ws'`
**难度 3/5**。**优先级：观察名单**——学生/家长在 QQ 有存量，但 5 分钟被动窗口 + 群主动 4 条/月让 Agent 主动通知几乎不可用；等平台放宽再启动。

---

### 2.5 Telegram Bot API

**接入模式**：`getUpdates` **长轮询**（无更新约 50 秒短路返回），桌面直连；设置 webhook 后长轮询不可用（互斥）[官方] https://core.telegram.org/bots/api

**认证**：单一 Bot Token（@BotFather 创建）。

**收消息与去重**：`Update[]`，`update_id` 严格递增 → 客户端记录 offset 确认；并发短轮询会丢更新 [社区] https://github.com/tdlib/telegram-bot-api/issues/43

**发消息与频控** [官方]
- 群发上限约 **30 msg/s**（付费广播可提升）：https://core.telegram.org/bots/faq
- 社区公认经验值：单聊天约 1 msg/s、同群约 20 条/分钟；超限 429 + `retry_after` [社区] https://gramio.dev/rate-limits 、官方推荐错峰 https://grammy.dev/plugins/transformer-throttler

**流式更新** ✅：`editMessageText`（文本 **1–4096 字符**，after entities parsing）反复编辑实现打字机；需节流（编辑同样计频控）[官方] https://core.telegram.org/bots/api ；社区标准节流件 `@grammyjs/transformer-throttler` 与专用流式件 `@grammyjs/stream`（LLM 输出专用）[社区] https://github.com/grammyjs/transformer-throttler 、 https://www.npmjs.com/package/@grammyjs/stream ；Bot API 9.5 起新增 **`sendMessageDraft`** 原生草稿流式（作为 typing 气泡实时更新）[社区] https://ai-muninn.com/en/blog/openclaw-telegram-sendmessagedraft-streaming （实施时以 core.telegram.org 最新 changelog 核实）。
**文件**：`file_id` → `getFile` → `https://api.telegram.org/file/bot<token>/<file_path>`，**仅 ≤20MB**；更大文件需自建 local Bot API Server（可到 2GB）[官方] https://core.telegram.org/bots/api ；[社区] https://github.com/tdlib/telegram-bot-api/issues/583 、 https://stackoverflow.com/questions/63410408/is-there-any-workaround-for-downloading-files-20-mb-that-are-sent-to-a-bot-i
**中国大陆可达性**：**自 2015 年起被持续屏蔽，大陆 ISP 直连不可达**（Wikipedia: Censorship of Telegram https://en.wikipedia.org/wiki/Censorship_of_Telegram ；本次调研环境网络无法直接复核该页，属公开广泛记载事实）。教师用户默认无代理 → **实际不可用**。
**能力位映射**：`canSendCard=false`｜`supportsStreamingUpdate=true`｜`maxTextLength=4096`｜`receivesVia='polling'`
**难度 1.5/5**（技术上最简单）。**优先级：观察名单**——实现最易但目标用户不可达；可作为「流式 Reference Adapter」的技术试验场。

---

### 2.6 Slack

**接入模式**：**Socket Mode**——出站 WebSocket，**无需公网 Request URL**，适配本地/内网运行 [官方] https://docs.slack.dev/apis/events-api/using-socket-mode ；Bolt 框架几行代码启用，需 **app-level token（`xapp-`）** + bot token [官方] https://slack.com/intl/zh-tw/blog/developers/socket-to-me 、 https://docs.slack.dev/tools/java-slack-sdk/guides/socket-mode

**认证**：bot token（`xoxb-`）+ app token（`xapp-`）；HTTP 模式另需 signing secret [社区] https://docs.openclaw.ai/zh-CN/channels/slack

**收消息与去重**：Events API 为至少一次投递，按 `event_id` 幂等去重；Socket Mode 需对每个 envelope 发 `ack` [官方] https://docs.slack.dev/apis/events-api/

**发消息与频控** [官方]
- 分级频控（per method per app per workspace）：Tier 1 ≈ 1+/分 … Tier 4 ≈ 100+/分；发消息类有特殊限制 **每频道约 1 条/秒**：https://docs.slack.dev/apis/web-api/rate-limits
- **`chat.update` 为 Tier 3（≈50+/分钟）**：https://docs.slack.dev/reference/methods/chat.update
- 超限 429 + `Retry-After` 头，须退避。

**流式更新** ✅：`chat.update` 原地编辑，频控余量足够打字机节流（建议 0.8–1s/次 < Tier 3）。
**文件**：`files.upload` 已弃用（2025-11-12 sunset）→ 用 `files.uploadV2`；机器人收到的文件只有元数据，需带 Bearer token GET `url_private_download` [官方] https://docs.slack.dev/reference/methods/files.upload 、 https://docs.slack.dev/messaging/working-with-files ；[社区] https://dev.to/seratch/further-tips-on-slacks-filesupload-deprecation-33j6 、 https://github.com/slackapi/node-slack-sdk/issues/1653
**能力位映射**：`canSendCard=true`（Block Kit）｜`supportsStreamingUpdate=true`｜`maxTextLength≈40000 字符`（chat.postMessage text 上限，官方方法页）｜`receivesVia='ws'`
**难度 2/5**。**优先级：观察名单**——国内教育场景几乎不用 Slack，仅在服务国际化客户时考虑。

---

### 2.7 Discord

**接入模式**：Gateway **WebSocket**（心跳 + IDENTIFY + 断线 resume 重放事件）[官方] https://docs.discord.com/developers/events/gateway 、事件参考 https://docs.discord.com/developers/events/gateway-events （`MESSAGE_CREATE`/`MESSAGE_UPDATE`/`MESSAGE_DELETE`）

**认证**：Bot Token；读取消息内容需开启 **`MESSAGE_CONTENT` 特权 intent**，且特权 intent 阈值已从「100 服务器」改为「**10,000 用户**」+ 年度重新授权 [官方] https://support-dev.discord.com/hc/en-us/articles/6207308062871-What-are-Privileged-Intents 、 https://support-dev.discord.com/hc/en-us/articles/40281523410967-Changes-to-Privileged-Intent-Access-for-Discord-Apps 、 https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review

**发消息与频控** [官方 + 社区]
- REST 每频道 **5 条/5 秒**（发送与编辑共用）[社区整理] https://www.reddit.com/r/discordapp/comments/9gbp01/limit_to_the_number_of_messages_a_bot_send/ ；Gateway 出站 **120 事件/60 秒** https://github.com/discord/discord-api-docs/discussions/6620 ；限频处理官方指引 https://support-dev.discord.com/hc/en-us/articles/6223003921559-My-Bot-is-Being-Rate-Limited
- 超限返回 429 与 `retry_after`，须全局与 per-route 双维度退避。

**流式更新** ✅：`PATCH /channels/{id}/messages/{id}` 编辑已发消息，但受 5/5s 限制 → 打字机节流约 1 次/2s 以上。
**文件**：消息 attachment 附带 CDN URL，可直接 GET 下载。
**中国大陆可达性**：**Discord 在大陆被持续屏蔽，直连不可达**（Wikipedia: Censorship of Discord https://en.wikipedia.org/wiki/Censorship_of_Discord ；同 Telegram，本次调研网络无法直接复核，属公开广泛记载事实）。
**能力位映射**：`canSendCard=false`（Embeds 非交互卡片）｜`supportsStreamingUpdate=true`｜`maxTextLength=2000`｜`receivesVia='ws'`
**难度 2.5/5**。**优先级：观察名单**（可达性 + 用户群不符）。

---

### 2.8 邮件（IMAP/SMTP）

**接入模式**：IMAP **IDLE**（RFC 2177）准推送收信 + SMTP 发信，桌面直连，无需公网、无需任何平台审核 [社区/RFC] https://stackoverflow.com/questions/2513194/imap-idle-timeout
- IDLE 连接最长 30 分钟，**必须约每 29 分钟重发 IDLE**（Gmail 硬性 29 分钟踢线）[社区] https://www.unipile.com/imap-server-connection-guide/
- Node.js 生态用 **ImapFlow**（`idle()` 事件驱动）+ **nodemailer**（SMTP）+ **mailparser**（MIME/附件）[官方] https://imapflow.com/docs/api/imapflow-client 、 https://www.npmjs.com/package/imapflow

**认证**：账号密码 / 服务商授权码（QQ 邮箱、163 需开启 IMAP 并生成授权码）或 OAuth2（Gmail/Microsoft）。

**收消息与去重**：IDLE 收 `EXISTS` 事件 → `FETCH` 新邮件；服务器可能重投，按 `Message-ID` 头去重。必须处理 socket `error` 事件 + 重连循环，否则空闲期瞬断会崩进程 [社区案例] https://github.com/twentyhq/twenty/issues/20509

**发消息与频控**：SMTP 无平台级频控 API，受服务商发信配额约束；**已发邮件不可编辑** → `supportsStreamingUpdate=false`（能力位全 false 的代表）。适合 Agent 的场景：定期汇总播报、家长通知抄送、附件（成绩单）收发，而非即时对话。

**能力位映射**：`canSendCard=false`｜`supportsStreamingUpdate=false`｜`maxTextLength=null`（整封受服务商大小限制）｜`receivesVia='imap-idle'`
**难度 2/5**。**优先级 P2**——中国教师对邮件的通知刚需（教育局/学校通知多走邮件），且它是检验 Adapter 抽象是否过度耦合「IM 范式」的最佳试金石。

---

## 3. 与现有架构的复用点与差异点

基准（现状）：`src/main/services/feishu-bot/` 内聚了 事件回调构造（`event-handler.ts`：不阻塞 ack + `message_id` 去重 + 排队）、会话批队列（`chat-queue.ts`）、消息解析（`message-parsing.ts`）、流式回复会话（`streaming-card.ts`：占位卡 + CardKit 全量文本节流更新 + finalize/fail 幂等 + 降级纯文本）、文件接收（`file-receive.ts`）、Agent 执行（`agent-runner.ts`）与指令路由（`command-router.ts`）。

### 3.1 钉钉适配器（P0）
- **直接复用（不动）**：`agent-runner`、`command-router`、`chat-queue`（按会话串行语义一致）、`dedup-cache`（键从 `message_id` 换成 Stream `headers.messageId` 即可）。
- **同构重写（照飞书骨架抄）**：`event-handler` → 钉钉 Stream CALLBACK handler（同步解析入队、立即 ACK 回传 messageId）；`message-parsing` → 钉钉消息 JSON 结构。
- **需新写**：
  - 连接层：对齐飞书 WS SDK 的位置放 `dingtalk-stream` 客户端（官方 Node SDK https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs ），**必须实现 disconnect 推送后的自动重连**（服务端 ~30s 会主动断连，见 §2.1 坑）。
  - `streaming-card` 的钉钉版：卡片模板（AI 卡片场景）→ createCardInstance(`outTrackId`, callbackType=STREAM) → 投放 → `streamingUpdate`（同为全量文本 + 节流 → `ReplySession` 接口可直接复用，仅换底层 API 调用）→ finalize。
  - `file-receive` 钉钉版：`downloadCode` 换临时链接下载（两跳 HTTP）。
- **差异点**：钉钉群聊必须 @ 机器人（与飞书一致）；发消息是「独立 OpenAPI」（`groupMessages/send`）而非「回复接口」，`push` 与 `reply` 实现合一；权限体系需学校管理员在开发者后台授权。

### 3.2 企业微信适配器（P1）
- **复用**：同钉钉——agent-runner / command-router / chat-queue / dedup-cache 全部复用；长连接管理骨架照飞书 WS。
- **差异点**：
  - 流式语义不同：企微是「respond 命令内嵌 stream.id 多次刷新」，没有独立 update API → Adapter 层 `ReplySession.update()` 需实现为「对同一 respond 会话发刷新帧」，且 **10 分钟硬窗口**（Agent 超时要提前 finalize）。
  - 文件下载是 `url + aeskey` 的 AES-256-CBC 解密（新增一个解密步骤）。
  - 单连接互斥：桌面端多窗口/重启时需先优雅断开旧连接，避免 `disconnected_event` 互踢循环。
  - 主动推送有「用户先发言」前提 → `push()` 能力位比飞书/钉钉弱，需在 UI 上提示。

### 3.3 邮件适配器（P2）
- **复用**：`chat-queue`（每个邮件线程作为会话）、`agent-runner`、`command-router`（邮件指令）。
- **差异点**：入站由「事件回调」变「IDLE 轮询事件」；去重键为 `Message-ID`；`reply` = SMTP 新邮件（含引用原文）；`streaming-card` 整体不适用 → 验证 Adapter 在 `supportsStreamingUpdate=false` 时优雅降级（这正是设计目标之一）。

### 3.4 webhook 型频道（公众号/微信客服/企微自建应用）的云端中继方案（P3 时启动）
共同点：平台只会把消息 POST 到**公网 URL**。桌面端无公网，需要一条「云 ↔ 桌面」的反向通道。建议方案（按优先级）：
1. **自建轻量中继（推荐）**：一台国内云主机（域名需 ICP 备案）跑极简 Node 服务：
   - 对平台：实现回调验签（echostr 校验）、Token/AESKey 解密、**立即 200 ack**（吸收 5 秒限制与重试）、按 MsgId 去重；
   - 对桌面端：维持一条出站 WSS（桌面端为 client，复用飞书 WS 的重连经验），消息下行推桌面、桌面回复经中继调用平台 API（API 调用也可全放云端，桌面只做业务）。
   - 优点：中继无状态化后可多教师共用；桌面端 ChannelAdapter 接口不变（`receivesVia='relay-ws'`）。
2. **用户自备隧道（过渡/个人版）**：文档化 frp / ngrok / Cloudflare Tunnel 配置，把桌面端本机端口映射成公网 URL——零开发量但不适合非技术教师。
3. 反模式（避免）：桌面端起 HTTP server + 打洞（NAT 环境不可靠）、轮询模拟（公众号无拉取接口，不可行；微信客服有 `sync_msg` 可拉，但事件仍走回调）。

### 3.5 观察名单平台
- **QQ**：`receivesVia='ws'` 直连可复用全套 WS 骨架；但 5 分钟被动窗口意味着 `chat-queue` 必须加「死线中断 + 超时告知」逻辑；群主动 4 条/月使 `push()` 形同虚设——待平台放宽再立项。
- **Telegram/Slack/Discord**：技术上都可直连且流式完备，可作为内部测试适配器；面向国内教师用户暂无上线价值。

---

## 4. 阶段 2 执行清单（建议）

1. **抽象 ChannelAdapter**：以 `feishu-bot` 为参照实现 `FeishuAdapter`（纯重构、行为不变），能力位：`canSendCard=true, supportsStreamingUpdate=true, maxTextLength=null, receivesVia='ws'`。
2. **P0 DingTalkAdapter**：官方 Node SDK + 自动重连 + AI 卡片流式（复用 `ReplySession` 三态接口）；验收 = 群聊 @机器人问答 + 打字机流式 + 文件问答。
3. **P1 WecomAibotAdapter**：`@wecom/aibot-node-sdk` 长连接 + `stream.id` 流式（10 分钟窗口保护）+ aeskey 文件解密。
4. **P2 MailAdapter**：ImapFlow IDLE（29 分钟重发 + 错误重连）+ nodemailer；验证能力位全 false 的降级路径。
5. **P3 中继网关项目**：公众号/微信客服回调验签 + 解密 + ack + WS 下行（与 ChannelAdapter 对接 `receivesVia='relay-ws'`）。
6. **持续跟踪**：QQ 主动消息政策、企微智能机器人生态成熟度、Telegram `sendMessageDraft` 正式文档。

## 5. 调研方法与未决问题

- 方法：WebSearch + 官方文档/开发者百科 WebFetch 交叉验证；[官方] 页面若为 JS 渲染则改用钉钉开发者百科（GitHub Pages）等静态镜像核对。
- 未决问题（阶段 2 实施前需实测）：
  - 钉钉/企微/QQ 的**文本消息硬上限**官方均未明示，需实测；
  - 企微智能机器人长连接在弱网下的重连表现（社区案例少）；
  - Telegram `sendMessageDraft`（Bot API 9.5）的正式官方文档页与限频 [社区] https://ai-muninn.com/en/blog/openclaw-telegram-sendmessagedraft-streaming ；
  - 微信公众号客服消息当前额度细则（48h 窗口历次收窄）。
- 网络限制说明：Telegram/Discord 大陆可达性结论属公开广泛记载（Wikipedia「Censorship of Telegram / Discord」），本次调研网络环境无法直接访问 Wikipedia 复核原文，已如实标注。
