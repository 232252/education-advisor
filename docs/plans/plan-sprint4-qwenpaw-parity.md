
### Sprint 4 — QwenPaw-parity 统一层 + 元宝/小艺全功能(本轮)

> 更新：2026-09-15（Asia/Shanghai）

#### A — 统一层（对照 QwenPaw BaseChannel）

| 能力 | QwenPaw | EA 状态 |
|---|---|---|
| 入站 debounce / merge | `_debounce_seconds` + no-text buffer | ✅ `adapters/_shared/debounce.ts` + **weixin** `debounceMs` 接线 |
| ACL dm/group allow/deny/pending | `access_control.py` | ✅ `adapters/_shared/acl.ts` + yuanbao/xiaoyi/**weixin/qq** 接线 |
| reconnect/backoff 标准 | `RECONNECT_DELAYS` | ✅ `adapters/_shared/reconnect.ts`（元宝/小艺/可复用） |
| streaming hooks | `on_streaming_*` | ✅ 接口已有 `createReplySession`；小艺 `streamingKind: edit` |
| health/diagnostics | ChannelManager 聚合 | ✅ `adapters/_shared/health.ts` + `getHealthDiagnostics?` |

#### B — 元宝 yuanbao

| 项 | 状态 |
|---|---|
| sign-token HMAC + 缓存刷新 | ✅ |
| protobuf ConnMsg (conn.json/biz.json) | ✅ `protobufjs` + 官方描述符 |
| AuthBind / Ping / PushAck | ✅ |
| 入站 InboundMessagePush → InboundMessage | ✅ DM+群文本 |
| 出站 send_c2c / send_group | ✅ |
| 媒体上传 | ✅ `media.ts` COS genUploadInfo + TIMImage/TIMFile；入站解析 image/file/audio |

#### C — 小艺 xiaoyi

| 项 | 状态 |
|---|---|
| AK/SK 头签名 | ✅ |
| 双 WS primary+backup | ✅ |
| heartbeat / init / 断线重连 | ✅ |
| message/stream → 入站 | ✅ |
| agent_response 出站 + createReplySession | ✅ |
| ~~本地 A2A HTTP agent-server~~ | ❌ 不需要：QwenPaw 亦为**客户端连华为云** |

#### D — 稳定性

| 渠道 | 状态 | 备注 |
|---|---|---|
| weixin/qq/email/mqtt/discord/telegram/slack/matrix/mattermost | 已有重连/降级 | 共享 backoff 可供后续统一注入 |
| sip/voice/azure-bot | later | 重依赖 |
| imessage | later | **仅 macOS** |
| onebot | unsupported | 产品禁止 |

#### E — 对照数量（诚实）

| | QwenPaw | EA Connection Center |
|---|---|---|
| 内置频道实现 | ~18 + 插件 azure | 生产向：飞书/钉钉/企微/微信/QQ；薄/全：邮件/MQTT/海外5 + **元宝/小艺** |
| 骨架/later | — | sip/voice/imessage/azure-bot |
| 禁止 | — | onebot |

#### 如何试用元宝 / 小艺

1. **元宝**：连接中心 → 更多 → 腾讯元宝 → 填 AppID/AppSecret → 连接。成功时状态为 `protobuf WS OK, bot_id=…`。私聊/群文本与图片/文件会入站；回复文本或 image/file/audio/video（COS 上传后 TIM 元素）。
2. **小艺**：更多 → 华为小艺 → 填 AK/SK/Agent ID → 连接。成功时 `A2A dual-WS primary✓/backup✓`。用户经小艺发起后，本机收 `message/stream` 并回 `agent_response`。

### Sprint 4b — WeChat / QQ vs QwenPaw 补齐（2026-09-15）

| 能力 | QwenPaw | EA 状态 |
|---|---|---|
| 微信出站图片/文件 | `send_image` / `send_file` 进 reply 路径 | ✅ `outbound.ts` + `reply-session` / `sendReply` / pipeline `sendText` |
| 微信入站 debounce/merge | `_debounce_seconds` + merge | ✅ `InboundDebouncer` 接线 `connection.ts`（`debounceMs`） |
| 微信 outbound message_merge | 流式多段合并缓冲 | ✅ N/A：`streamingKind=none`，finalize 已整段一次发送 |
| 微信 typing refresh | `getconfig` + `sendtyping` 入站刷新 | ✅ `typing.ts` 入站 start / finalize·fail·stop 清理 |
| 微信 ACL allowFrom | `allow_from` + dm/group policy | ✅ `_shared/acl.ts` + manifest `allowFrom`/`aclDm`/`aclGroup` |
| QQ URL sanitize | `_sanitize_qq_text` + aggressive | ✅ `sanitize.ts` 全部出站文本 + URL 拒信重试 |
| QQ 细粒度 ACL | allow_from + access_control dm/group | ✅ ACL + `allowGroups→group:deny` |
| QQ 群 file_type=4 跳过 | group 不发 file | ✅ `sendRichMedia` 群文件静默 skip |

**总判**: WeChat/QQ 功能对等 **YES**（剩余仅平台 N/A：微信弱主动/context_token 限额、QQ 群主动配额——产品限制，非实现缺口）。
