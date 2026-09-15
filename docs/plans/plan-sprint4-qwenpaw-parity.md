
### Sprint 4 — QwenPaw-parity 统一层 + 元宝/小艺全功能(本轮)

> 更新：2026-09-15（Asia/Shanghai）

#### A — 统一层（对照 QwenPaw BaseChannel）

| 能力 | QwenPaw | EA 状态 |
|---|---|---|
| 入站 debounce / merge | `_debounce_seconds` + no-text buffer | ✅ `adapters/_shared/debounce.ts` |
| ACL dm/group allow/deny/pending | `access_control.py` | ✅ `adapters/_shared/acl.ts` + yuanbao/xiaoyi 接线 |
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
