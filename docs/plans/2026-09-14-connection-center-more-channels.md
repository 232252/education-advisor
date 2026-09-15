# 设计文档：连接中心「更多」— 对齐 QwenPaw 全量频道目录

> 日期：2026-09-14 ｜ 分支：`feat/connection-center-more-channels` ｜ 性质：**设计 + 实现进度**  
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

## 0.5 已拍板（本轮锁定）

| # | 议题 | 决定 | 备注 |
|---|---|---|---|
| 1 | 「更多」UX 形态 | **Drawer 网格展开** | 否决：独立设置子页。点「更多」后右侧/加宽 Drawer 展开**全量 QwenPaw 栏目**（搜索 + 合理分组网格） |
| 2 | QQ `sendReply` | **立即收敛到统一引擎** | 否决：过渡旗标 `replyViaEngine`。实现轮开工时作为 **P0 接口工作**，与「更多」壳并行或略先 |
| 3 | 本轮交付边界 | **仅调计划文档** | **不写**「更多」UI / 适配器 / QQ 收敛代码；代码留待实现轮 |

未选本轮、仍作开放问题（见 §6）：小艺/元宝分区、国外 later vs 实验 Token、Mattermost/SIP 等。

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

`QqBotAdapter.sendReply` 当前抛出「回复由引擎流水线内完成」。连接中心启停/状态/push **仍走统一接口**，但 **被动回复路径与飞书/钉钉不完全同构**。

**已拍板**：实现轮 **立即收敛** QQ 被动回复进 `sendReply` / `createReplySession`（与飞书等同构），**不**引入 `capabilities.replyViaEngine` 过渡旗标。此项列为 **P0 接口工作**（编码开工时优先于或并行于「更多」壳）。

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

**P0 要求（已拍板）**：所有已注册适配器（含 QQ）对 `sendReply` 行为可预期——**立即实现收敛**到统一 `sendReply`/`createReplySession`，**不**采用 `replyViaEngine` 过渡旗标。

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

> **已拍板**：展开形态 = **Drawer 网格**（非设置子页）。点「更多」后展开 **全量 QwenPaw 栏目**。

### 3.1 入口位置

**Connection Center 弹出面板**（`ConnectionCenterPanel`）— 主列表保持精简；「更多」为二级展开，不挤爆 400px 面板：

```
┌─ 连接中心 ───────────── 3/5 已连接 ─┐
│ 飞书  钉钉  企微  微信  QQ          │  ← 主列表：已注册 · region=domestic 优先（≤6）
│ ───────────────────────────────── │
│ 〔 ⊞ 更多 〕  浏览全部频道目录 →     │  ← 入口：LayoutGrid / MoreHorizontal
│ 手机·浏览器接入 …                   │
│ 完整设置                            │
└─────────────────────────────────────┘
         │ 点击「更多」
         ▼
┌─ 全部频道 ──────────────────── ✕ ─┐  ← 右侧 Drawer（≥520px）或加宽 Panel
│ 🔍 搜索频道…                        │
│ [国内企业] [国内个人] [助手] …      │  ← 分组 Tab；海外默认次要/可折叠
│ ┌──────┐ ┌──────┐                  │
│ │ 飞书 │ │ 钉钉 │   … 网格 2 列    │  ← 全量 QwenPaw 映射卡
│ └──────┘ └──────┘                  │
│ ┌──────┐ ┌──────┐                  │
│ │元宝  │ │ MQTT │   comingSoon 等  │
│ └──────┘ └──────┘                  │
└─────────────────────────────────────┘
```

设置页 `ChannelsSection` 同步：主墙仍国内优先；底部或顶栏 **「浏览更多频道」** 打开**同一** Drawer 目录组件（单实现，禁止双份 UI）。

### 3.2 展开形态（已拍板：Drawer 网格）

**右侧 Drawer（首选）或加宽 Panel ≥520px「全部频道」**：

1. **搜索框**：按 label / id / description / `qwenpawKey` 过滤；空态提示「未找到匹配频道」。  
2. **合理分组**（粘性分组头 **或** 顶部分组 Tab，二选一实现，推荐粘性头 + 轻量 Tab 跳转）：  

   | 分组 | 内容（对齐 QwenPaw catalog） |
   |---|---|
   | 国内企业 | 飞书 / 钉钉 / 企微 |
   | 国内个人 | 微信 / QQ |
   | 国内助手 | 元宝 / 小艺（占位，产品语义见开放问题） |
   | 物联网 | MQTT |
   | 语音 | SIP / Voice（占位） |
   | 海外 | Discord / Telegram / Slack / Matrix / Mattermost / … |
   | 不可用 | OneBot 等（`unsupportedReason`） |

3. **卡片网格**（2 列，宽屏可 3）：品牌色瓦片 + 名称 + 一行能力标签（WS / 扫码 / Webhook / MQTT）+ 状态徽标：  
   - `已连接` / `可配置` / `即将推出` / `海外·稍后` / `不支持`  
4. **点击行为**：  
   - 已实现 → 跳设置锚点 `#channel-<id>` 或 Drawer 内嵌 SchemaForm  
   - comingSoon → 只读说明 + 「关注更新」  
   - unsupported → 展示 `unsupportedReason`（如 OneBot 合规）  
   - foreign later → 「欢迎 PR / 后续版本」  

### 3.3 视觉 polish（好看、可读）

- 与现有 `ChannelBrandIcon` / 渐变瓦片语言一致；「更多」入口用中性 `LayoutGrid`（或 `MoreHorizontal`），**不**假扮某一品牌。  
- **国内组靠前、视觉权重高**；海外组默认 **折叠** 或降低不透明度，突出国内优先策略。  
- `comingSoon`：灰阶 + 虚线边；`beta` 保留现有徽标；`unsupported` 更淡 + 禁止图标。  
- 限制条（QQ/微信）在详情仍用 `limitationBannerKey`；目录卡上仅短标签「弱主动」。  
- 深色模式：沿用 `dark:ring-white/[0.07]`；网格 gap 8–12px；卡片圆角与主列表一致。  
- 动效：Drawer 滑入 200–250ms ease；网格 stagger 可选（≤6 张首屏，避免卡顿）。  
- 无障碍：分组 `role="tablist"` 或 `aria-labelledby` 分组头；搜索 `aria-label`；Esc / 遮罩点击关闭 Drawer；焦点陷阱在打开时。

### 3.4 数据源

单一来源：`channelManager.list()` / `listManifests()`。  
「更多」目录 = **已注册 adapters ∪ pendingManifests（comingSoon 占位）∪ 静态 catalog 扩展表**（仅文档化的未实现项，实现前用 `registerManifest` 注入，无 factory）— **覆盖调研文档中的全量 QwenPaw 栏目**。

禁止前端硬编码第二份频道列表（QwenPaw 早期 Console 坑：#371）。

---

## 4. 分批实现

### P0 — 已有巩固 + 「更多」壳（国内五件套）

| 项 | 内容 |
|---|---|
| 已有 | 飞书、钉钉、企微、微信(`weixin`)、QQ |
| UI | 「更多」入口 → **Drawer 网格**展开全量 QwenPaw 目录（占位卡来自 catalog） |
| 接口 | Manifest `category`/`region`/`qwenpawKey`；**QQ `sendReply` 立即收敛到统一引擎**（P0 接口优先项，无过渡旗标） |
| 文档 | 本计划 + 调研已完成（**本轮仅文档，不写代码**） |

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

已关闭（见 §0.5）：「更多」UX → Drawer 网格；QQ `sendReply` → 立即收敛；本轮只调文档。

仍开放：

1. **小艺 / 元宝** 是否进 P1 消息频道，或单独「助手出站」分区？  
2. **Mattermost** 国内私有化是否升为 P1？  
3. **SIP/Voice** 进连接中心还是新「语音」分区？  
4. 国外卡：仅 later / comingSoon 文案，还是允许用户填 Token 但标「实验·需代理」？

---

## 7. 建议实施顺序（实现轮，非本提交）

> 本提交 / 本轮：**只更新本文档**，下列步骤在编码开工后执行。

1. Manifest 元数据 + `registerManifest` 注入 QwenPaw 全量占位。  
2. **QQ `sendReply` / `createReplySession` 立即收敛到统一引擎**（P0 接口；与步骤 3 可并行，建议略先或同 PR）。  
3. Connection Center 「更多」**Drawer 网格**（搜索 / 合理分组 / 全量栏目 / 状态徽标）。  
4. P1 选 1～2 个国内增量（建议元宝或 MQTT；小艺分区待拍板）。  
5. 接口：`InboundAttachment` 媒体扩展；Webhook hook 待 Azure/Voice 立项再做。

---

## 8. 验收标准（文档轮）

- [x] 调研文档列出 QwenPaw 内置 18 + 插件 1  
- [x] 明确 QQ/微信已在统一 `ChannelAdapter`  
- [x] 给出接口扩展提案与「更多」IA（**Drawer 网格**已拍板）  
- [x] 分批 P0–P3 + 国外/禁止策略  
- [x] 「已拍板」：Drawer UX + QQ `sendReply` 立即收敛 + 本轮仅文档  
- [x] （实现轮）UI/适配器 / QQ 收敛 — 见 §9


---

## 9. 实现进度（feat/connection-center-more-channels）

> 更新：2026-09-15（Asia/Shanghai）· Sprint 3

### Sprint 1 — 已落地

| 项 | 状态 | 说明 |
|---|---|---|
| Manifest 元数据 | ✅ | `category` / `region` / `priority` / `docsUrl` / `qwenpawKey` / `unsupportedReason` / `catalogStatus` |
| Receive / 媒体扩展 | ✅ | `mqtt`/`sip`；入站/出站 `video`/`audio` |
| Adapter 可选方法 | ✅ | `handleHttpWebhook` / `refreshCredentials` / `getAccessPolicy` |
| 「更多」Drawer 网格 | ✅ | `MoreChannelsDrawer`：搜索、分组、状态徽标、Esc/遮罩关闭；连接中心 + 设置页共用 |
| QQ `sendReply` 收敛 | ✅ | 立即经 `replyOutboundFromMessage`；`createReplySession` 同构；无过渡旗标 |
| i18n zh+en | ✅ | `connectionCenter.more.*` + 助手/邮件限制文案 |
| 纯函数测试 | ✅ | `channel-catalog.test.ts` + `qq-sendreply.test.ts`；`tsc --noEmit` 绿 |

### Sprint 2 — 适配器矩阵

| id | 状态 | 备注 |
|---|---|---|
| feishu / dingtalk / wecom / weixin / qq | ✅ 生产向 | 仅补目录元数据；飞书深路径未改行为 |
| email | ✅ 薄客户端 → Sprint3 双向 | 见 Sprint 3 |
| mqtt | ✅ 薄客户端 | `mqtt.js` 订阅/发布；缺依赖时可读错误 |
| yuanbao / xiaoyi | ✅ 骨架 → Sprint3 增强 | 见 Sprint 3 |
| discord / telegram / slack / matrix / mattermost | ✅ 薄客户端(Sprint3) | region=foreign；见 Sprint 3 |
| sip / voice / imessage / azure-bot | 目录 later | 清晰 unsupportedReason；见 Sprint 3 |
| onebot | 目录 unsupported | `unsupportedReason` 合规文案 |


### Sprint 3 — 双向邮件 + 海外薄客户端 + 助手 UX(本轮)

| id | 状态 | 备注 |
|---|---|---|
| email | ✅ 薄客户端双向 | SMTP 发信 + IMAP IDLE(imapflow),失败降级轮询;再失败 SMTP-only 降级 |
| discord | ✅ 薄客户端 | Gateway WS + REST;region=foreign 徽标保留 |
| telegram | ✅ 薄客户端 | getUpdates 长轮询 + sendMessage;editMessageText 流式会话 |
| slack | ✅ 薄客户端 | Socket Mode(xoxb+xapp) + chat.postMessage |
| matrix | ✅ 薄客户端 | /sync 长轮询 + m.room.message |
| mattermost | ✅ 薄客户端 | WS + posts REST;可自托管 |
| yuanbao | ✅ 全功能(Sprint4) | sign-token + protobuf WS；文本 + 图片/文件媒体 |
| xiaoyi | ✅ 全功能(Sprint4) | 双 WS A2A 客户端(非本地 agent-server) |
| sip / voice / imessage / azure-bot | later + 清晰原因 | `unsupportedReason` 说明重依赖;状态仍为 later(非伪装 unsupported) |
| onebot | unsupported | 保持合规禁止 |

依赖:`imapflow` 入站;`nodemailer`/`mqtt`/`ws` 沿用。

### 如何试用

1. 启动应用 → 侧栏 **连接中心**（Alt+C）→ 主列表国内优先 ≤6 → 点 **「更多」** 打开 Drawer 全量目录。
2. 设置 → 连接中心 → **浏览更多频道** 打开同一 Drawer。
3. QQ：连接后被动回复走 `QqBotAdapter.sendReply` → 引擎 `replyOutbound`（与流水线共用投递缓存）。
4. **邮件双向**：设置 → 邮件 → 填 IMAP/SMTP → 连接；向该邮箱发信应入站；`push`/`sendReply` 走 SMTP。
5. **海外薄客户端**：更多 → 展开海外 → Discord/Telegram/Slack/Matrix/Mattermost → 填 Token（国内需系统代理）→ 连接。
6. **元宝**：填 AppID/Secret → 连接 → `protobuf WS OK`；私聊/群文本收发。
7. **小艺**：填 AK/SK/Agent ID → 双 WS 连华为云；`message/stream` 入站，`agent_response` 出站。

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

1. **元宝**：连接中心 → 更多 → 腾讯元宝 → 填 AppID/AppSecret → 连接。成功时状态为 `protobuf WS OK, bot_id=…`。私聊/群文本会入站；回复走 C2C/群 protobuf。
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
