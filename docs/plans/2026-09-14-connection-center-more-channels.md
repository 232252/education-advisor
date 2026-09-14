# 设计文档：连接中心「更多」— 对齐 QwenPaw 全量频道目录

> 日期：2026-09-14 ｜ 分支：`docs/qwenpaw-channels-more` ｜ 性质：**设计与分阶段计划（本文档不实现频道代码）**  
> 上游调研：[QwenPaw 频道全量目录](../research/2026-09-14-qwenpaw-channel-catalog.md)  
> 既有： [国内连接中心](./2026-09-14-domestic-connection-center.md)、[频道架构实施](./2026-09-12-channel-architecture-implementation.md)、[连接中心 UI](./2026-09-13-connection-center-ui-implementation.md)  
> 代码基线：`education-advisor-connectors` @ `feat/domestic-wechat-qq-channels` tip（已含 `weixin`/`qq` 适配器）

---

## 0. Goals / Non-goals

### Goals

1. 在 Connection Center 增加设计精良的 **「更多」** 入口，展开后展示 **对齐 QwenPaw 的全量频道目录**（含 comingSoon / later）。
2. **优先统一接口**：确认 QQ/微信是否已挂在 `ChannelAdapter`；评估缺口并给出 **接口扩展提案**（先文档，后实现）。
3. 给出 **分批实现路线**：P0 巩固已有国内五件套 → P1+ 按 QwenPaw 目录补齐；**国内优先**，国外标 later/PR-ok。
4. 每类频道给出 **接入方式摘要**（鉴权、收发、UI 模板），便于后续按批开工。

### Non-goals（本轮）

1. **不实现**「更多」UI 代码、不批量注册新适配器。  
2. **不引入** OneBot/NapCat/PID Hook（延续国内连接中心已拍板禁止项）。  
3. **不把** QwenPaw Console 当作必须映射的 IM 卡片。  
4. **不强制**本期上线 Slack/Discord/Telegram 等国外频道（目录可见 + later）。

---

## 1. 已有统一接口评估（QQ / 微信是否已统一）

### 1.1 结论（一句话）

**是：QQ 与微信均已实现同一 `ChannelAdapter` 契约，并经 `channelManager.register` 进入统一注册表与连接中心列表。**  
局部缺口在于：QQ 的 `sendReply` 故意抛错（回复走引擎流水线）、能力位/附件类型仍偏窄、尚无「更多」级目录元数据与 webhook/插件挂载点。

### 1.2 证据

| 层 | 现状 |
|---|---|
| 契约 | `src/main/services/channels/types.ts` → `ChannelAdapter`（validateConfig / connect / disconnect / getStatus / sendReply / push / createReplySession? / fetchAttachment?） |
| 数据形状 | `src/shared/types/channel.ts` → `ChannelManifest` + `ChannelCapabilities` + `InboundMessage` / `OutboundContent` |
| 注册 | `channel-handlers.ts`：`createFeishuAdapter` / `Dingtalk` / `Wecom` / **`createWeixinAdapter`** / **`createQqAdapter`** |
| 微信 | `WeixinILinkAdapter implements ChannelAdapter`；`loginKinds: ['qr','credentials']`；`receivesVia: 'polling'` |
| QQ | `QqBotAdapter implements ChannelAdapter`；同样扫码 IPC；`receivesVia: 'ws'`；`pushPolicy: 'quota'` |
| 扫码 | `channels/login/*` + IPC `beginLogin` / `pollLogin` / `cancelLogin`（已落地） |
| UI | `channels.list()` → ConnectionCenterPanel `ChannelRow[]` + Settings `ChannelCard`；已有 `comingSoon` / `limitationBannerKey` |

### 1.3 与 QwenPaw `BaseChannel` 对照

| 能力 | QwenPaw | education-advisor | 评估 |
|---|---|---|---|
| 统一适配器基类/接口 | `BaseChannel` | `ChannelAdapter` | ✅ 对等（TS interface vs Python ABC） |
| 注册表 | `registry.py` + plugin | `ChannelManager.register` + 静态工厂 | ✅ 够用；插件热加载非 P0 |
| 入站归一化 | → `AgentRequest` | → `InboundMessage` + Bridge | ✅ |
| 出站 | `send` / content_parts | `sendReply` / `push` / `ReplySession` | ✅；流式能力位更细 |
| 扫码 | `QRCodeAuthHandler` | `channelLoginSessions` | ✅ |
| 访问控制 dm/group policy | 通用配置字段 | 部分在渠道 settings（如 QQ allowGroups） | ⚠️ 未提升为统一字段 |
| Webhook 路由注册 | plugin `register_http_router` | 无通用频道 HTTP 挂载 | ❌ 语音/Azure 类需要 |
| 反向 WS 服务端 | OneBot | 无 | ❌（且产品禁止 OneBot） |
| 媒体 kind | image/video/audio/file | 入站 `file\|image`；出站 `image\|file` | ⚠️ 需扩展 |

### 1.4 QQ 统一性的已知裂缝

`QqBotAdapter.sendReply` 当前抛出「回复由引擎流水线内完成」。连接中心启停/状态/push **仍走统一接口**，但 **被动回复路径与飞书/钉钉不完全同构**。计划：P0 巩固期把 QQ 回复收敛进 `sendReply`/`createReplySession`（或明确文档化「引擎旁路」为过渡态，设 sunset）。

---

## 2. 接口是否需扩大（proposed ChannelAdapter / Manifest 扩展）

**原则**：扩大接口以覆盖 QwenPaw 目录中的**合法**频道类型；不为禁止路径（OneBot）开官方产品 API。

### 2.1 Manifest / 目录元数据（「更多」强依赖）— **建议 P0 UI 前完成**

```ts
// ChannelManifest 增量（均可选，向后兼容）
category?:
  | 'enterprise-im'   // 飞书/钉钉/企微
  | 'consumer-im'     // 微信/QQ
  | 'assistant'       // 小艺/元宝
  | 'iot'             // MQTT
  | 'voice'           // SIP/Twilio
  | 'overseas'        // Discord/Telegram/...
  | 'local'           // 本机专用
region?: 'domestic' | 'foreign' | 'neutral'
priority?: number     // 排序；P0 国内靠前
docsUrl?: string      // 外链到平台开放文档
qwenpawKey?: string   // 映射 QwenPaw 配置键（如 weixin → wechat）
unsupportedReason?: string  // 目录展示但不可启用（合规）
```

`comingSoon` / `beta` / `limitationBannerKey` **已存在**，继续复用。

### 2.2 `ChannelReceiveMode` 扩展

现有：`'ws' | 'polling' | 'imap-idle' | 'webhook' | 'relay-ws'`

建议新增：

| 值 | 用途 |
|---|---|
| `'mqtt'` | MQTT 订阅 |
| `'sip'` | SIP/RTP 或 LiveKit 音频边车（也可拆独立 VoiceAdapter，不塞 IM） |

**不新增** `'reverse-ws-server'` 作为产品能力（OneBot 禁止）；若未来合规 Bot 反向连接再议。

### 2.3 媒体类型扩展

```ts
InboundAttachment.kind: 'file' | 'image' | 'video' | 'audio'
OutboundMediaRef.kind:  'image' | 'file' | 'video' | 'audio'
```

Bridge / Agent 多模态管道按 kind 透传；不支持的渠道在 adapter 内降级为文本链接。

### 2.4 ChannelAdapter 可选方法（按需实现）

```ts
interface ChannelAdapter {
  // —— 已有核心略 ——

  /** Webhook/HTTP 入站（azure_bot / 部分 voice）：由主进程 HTTP 网关回调 */
  handleHttpWebhook?(
    req: { path: string; headers: Record<string, string>; body: Buffer | string },
  ): Promise<{ status: number; body?: string }>

  /** Token/会话刷新（长轮询渠道掉线自愈） */
  refreshCredentials?(ctx: ChannelRuntimeContext): Promise<void>

  /** 渠道级访问策略快照（可选；UI 展示 + Bridge 预检） */
  getAccessPolicy?(): {
    dm: 'open' | 'allowlist'
    group: 'open' | 'allowlist'
    allowFrom: string[]
    requireMention: boolean
  }
}
```

**不必**把 QwenPaw 的 `build_agent_request_from_native` 原样搬进 TS——EA 已用 `InboundMessage` 等价。

### 2.5 统一出站 API 形状（建议维持并写清契约）

```ts
// 被动回复
sendReply(msg: InboundMessage, content: OutboundContent): Promise<{ messageId?: string }>
createReplySession?(msg, placeholder): Promise<ReplySession>  // streamingKind !== 'none'

// 主动推送
push(target: PushTarget, content: OutboundContent): Promise<{ messageId?: string }>
// push 前 Bridge 读 capabilities.pushPolicy
```

**P0 要求**：所有已注册适配器（含 QQ）对 `sendReply` 行为可预期（实现或显式 `capabilities.replyViaEngine: true` 过渡旗标——二选一，推荐实现收敛）。

### 2.6 是否「必须」扩大才能做「更多」？

| 工作项 | 是否必须先扩接口 |
|---|---|
| 「更多」UI（目录/分组/搜索/comingSoon） | **仅需 Manifest 元数据**（§2.1） |
| 元宝 / 小艺 | 现有 Adapter + 凭证模板即可；小艺注意 A2A 语义 |
| MQTT | 建议加 `receivesVia: 'mqtt'` |
| SIP / Voice | 建议 **独立「语音」分区** + 可选 `handleHttpWebhook` / 旁路音频管线；不宜硬塞纯文本 Bridge |
| Discord/Telegram/Slack | 现有契约基本够；`streamingKind: 'edit-message'` 已预留 |
| Azure Bot | **需要** `handleHttpWebhook` + 公网 HTTPS 部署说明 |

---

## 3. 「更多」IA / UI

### 3.1 入口位置

**Connection Center 弹出面板**（`ConnectionCenterPanel`）：

```
┌─ 连接中心 ───────────── 3/5 已连接 ─┐
│ 飞书  钉钉  企微  微信  QQ          │  ← 主列表：已注册且 region=domestic 优先
│ ───────────────────────────────── │
│ 〔 更多 〕  浏览全部频道目录 →       │  ← 新入口（瓦片或行按钮）
│ 手机·浏览器接入 …                   │
│ 完整设置                            │
└─────────────────────────────────────┘
```

设置页 `ChannelsSection` 同步：主墙仍国内优先；底部或顶栏 **「浏览更多频道」** 打开同一全量目录（Drawer / 全屏 Sheet，避免双实现）。

### 3.2 展开形态（推荐）

**右侧 Drawer 或加宽 Panel（≥520px）「全部频道」**：

1. **搜索框**：按 label / id / description 过滤。  
2. **分组 Tab 或粘性分组头**：  
   - 国内企业 · 国内个人 · 国内助手 · 物联网 · 语音 · 海外 · 不可用  
3. **卡片网格**（2 列）：品牌色瓦片 + 名称 + 一行能力标签（WS / 扫码 / Webhook）+ 状态徽标：  
   - `已连接` / `可配置` / `即将推出` / `海外·稍后` / `不支持`  
4. **点击**：  
   - 已实现 → 跳设置锚点 `#channel-<id>` 或内嵌 SchemaForm  
   - comingSoon → 只读说明 + 「关注更新」  
   - unsupported → 展示 `unsupportedReason`（如 OneBot 合规）  
   - foreign later → 文案「欢迎 PR / 后续版本」  

### 3.3 视觉 polish 指南

- 与现有 `ChannelBrandIcon` / 渐变瓦片语言一致；「更多」入口用中性 `MoreHorizontal` 或 `LayoutGrid`，避免假扮某一品牌。  
- 海外组默认 **折叠** 或次要透明度，突出国内。  
- `comingSoon` 灰阶 + 虚线边；`beta` 保留现有徽标。  
- 限制条（QQ/微信）在详情仍用 `limitationBannerKey`，目录卡上仅短标签「弱主动」。  
- 深色模式：沿用 `dark:ring-white/[0.07]` 体系；网格间距 8–12px。  
- 无障碍：分组 `role="tablist"`；搜索 `aria-label`；Esc 关闭 Drawer。

### 3.4 数据源

单一来源：`channelManager.list()` / `listManifests()`。  
「更多」目录 = **已注册 adapters ∪ pendingManifests（comingSoon 占位）∪ 静态 catalog 扩展表**（仅文档化的未实现项，实现前用 `registerManifest` 注入，无 factory）。

禁止前端硬编码第二份频道列表（QwenPaw 早期 Console 坑：#371）。

---

## 4. 分批实现

### P0 — 已有巩固 + 「更多」壳（国内五件套）

| 项 | 内容 |
|---|---|
| 已有 | 飞书、钉钉、企微、微信(`weixin`)、QQ |
| UI | 「更多」入口 + 全量目录（占位卡来自 catalog） |
| 接口 | Manifest `category`/`region`/`qwenpawKey`；QQ `sendReply` 收敛或过渡旗标 |
| 文档 | 本计划 + 调研已完成 |

### P1 — 国内助手 / 物联网（对齐 QwenPaw）

| id（建议） | QwenPaw | 接入摘要 |
|---|---|---|
| `yuanbao` | yuanbao | AppID+Secret；protobuf WS；企业/个人助手场景 |
| `xiaoyi` | xiaoyi | AK/SK/agent_id；A2A WS；**产品确认是否进「消息频道」** |
| `mqtt` | mqtt | Broker 凭证 + topic；JSON/文本桥；教研物联网教具 |

### P2 — 语音（分区可选）

| id | QwenPaw | 接入摘要 |
|---|---|---|
| `sip` | sip | 本地/LiveKit；DashScope STT/TTS；建议「语音」分区 |
| `voice` | voice | Twilio + 公网 Webhook；**国外倾向**，可标 later |

### P3 — 海外（later / PR-ok）

| id | 接入摘要 | 策略 |
|---|---|---|
| `discord` | Bot Token；常需代理 | 目录可见；实现接 PR |
| `telegram` | Bot Token；`edit-message` 流式 | 同上 |
| `slack` | xoxb + xapp Socket Mode | 同上 |
| `matrix` | homeserver + token | 同上 |
| `mattermost` | URL + token（可私有化） | 国内私有部署可升 P1.5（拍板） |
| `imessage` | macOS only | 平台门控 comingSoon |
| `azure_bot` | Webhook + Entra；插件式 | 需 HTTP 挂载；later |

### 明确不支持（目录可展示）

| id | 原因 |
|---|---|
| `onebot` | 个人号完整协议；合规风险；延续 Non-goal |
| PID/WeChatFerry | 禁止 |
| `console` | 非 IM；映射桌面聊天即可 |

### 国外策略（重申）

- **产品投入**：不排期强制交付。  
- **目录**：全量映射 QwenPaw，标 `region: foreign` + 「稍后 / 欢迎 PR」。  
- **合并**：外部优质 PR 可合，需过代理/隐私/密钥审查。

---

## 5. 每类接入方式摘要

| 类别 | 代表 | Onboard | 运行时 | UI 模板 |
|---|---|---|---|---|
| 企业 IM 凭证+WS | 飞书/钉钉/企微 | SchemaForm 凭证 → 测试 → 启用 | WS 长连接 | 现有凭证型 |
| 个人 IM 扫码 | 微信 | beginLogin QR → keystore | HTTP 长轮询 | 扫码型 + 限制条 |
| 个人 IM 双模板 | QQ | QR 门户绑定 **或** AppID/Secret | Gateway WS | 扫码+凭证；配额提示 |
| AI 助手平台 | 元宝/小艺 | 开放平台凭证 | WS / A2A | 凭证型；小艺引导「挂到小艺」 |
| IoT | MQTT | Broker 表单 | pub/sub | 凭证型 + topic 高级区 |
| 海外 Bot Token | Discord/TG | Token（+代理字段） | Gateway / poll | 凭证型；代理 showIf |
| Slack | Slack | 双 Token | Socket Mode | 凭证型 |
| Webhook Bot | Azure / Twilio Voice | 凭证 + **公网 URL 指引** | HTTP 入站 | 凭证型 + 部署指南面板 |
| 语音 SIP | SIP | 模式选择 Dev/LiveKit | 音频管线 | 独立语音设置，慎进 IM 列表 |
| 禁止类 | OneBot | — | — | 「不支持」卡 |

---

## 6. 风险与开放问题

### 风险

1. **目录膨胀**：全量 19 项挤爆 400px 面板 → 必须用「更多」二级抽屉，主列表保持 ≤6。  
2. **命名漂移**：`weixin` vs QwenPaw `wechat` → 用 `qwenpawKey` 映射。  
3. **合规**：OneBot/个人号协议若出现在竞品对比文案，需同步「我们不做」说明。  
4. **Webhook 安全**：Azure/Twilio 暴露端口 = 攻击面；须鉴权与默认不开启。  
5. **QQ 回复旁路**：双路径易产生「连接中心已连但回复失败」类 bug。  
6. **小艺/元宝产品语义**：是否算班主任「消息频道」不清晰，避免用户期待班级群播报。

### 开放问题（需用户拍板）

1. 「更多」默认展开 **网格 Drawer** 还是 **独立设置子页**？  
2. **小艺 / 元宝** 是否进 P1 消息频道，或单独「助手出站」？  
3. **Mattermost** 国内私有化是否升为 P1？  
4. **SIP/Voice** 进连接中心还是新「语音」分区？  
5. QQ `sendReply`：**立即收敛** vs **过渡旗标**？  
6. 国外卡：仅 comingSoon 文案，还是允许用户填 Token 但标「实验·需代理」？

---

## 7. 建议实施顺序（实现轮，非本提交）

1. Manifest 元数据 + `registerManifest` 注入 QwenPaw 全量占位。  
2. Connection Center 「更多」Drawer（搜索/分组/状态）。  
3. QQ 回复路径收敛。  
4. P1 选 1～2 个国内增量（建议元宝或 MQTT，小艺待拍板）。  
5. 接口：`InboundAttachment` 媒体扩展；Webhook hook 待 Azure/Voice 立项再做。

---

## 8. 验收标准（文档轮）

- [x] 调研文档列出 QwenPaw 内置 18 + 插件 1  
- [x] 明确 QQ/微信已在统一 `ChannelAdapter`  
- [x] 给出接口扩展提案与「更多」IA  
- [x] 分批 P0–P3 + 国外/禁止策略  
- [ ] （实现轮）UI/适配器 — **明确不在本提交**