# 设计文档：国内连接中心扩展（QQ / 微信扫码优先）

> 日期：2026-09-14 ｜ 分支：`docs/domestic-connectors` ｜ 性质：**设计与分阶段计划（本文档不实现连接器代码）**
> 上游调研：[国内 QQ/微信与 PID 路径澄清](../research/2026-09-14-domestic-qq-wechat-connectors.md)
> 既有架构：[频道架构实施](./2026-09-12-channel-architecture-implementation.md)、[连接中心 UI](./2026-09-13-connection-center-ui-implementation.md)、[连接器全景](../research/2026-09-12-channel-connector-catalog.md)
> 代码基线：`education-advisor-connectors` worktree @ `737e467`（自 `main` 干净检出；**不修改** `education-advisor` 上飞书/批改 dirty WIP）

---

## 0. Goals / Non-goals

### Goals

1. 在现有**连接中心**（设置页卡片墙 + 侧栏快捷面板）上，扩展**国内高价值消息频道**，尤其是用户点名的 **QQ、微信（个人）扫码直连**。
2. 连接方式尽量多样，但**优先官方/准官方**：扫码 Onboard、凭证+长连接、长轮询；为后续邮件/短信/小艺等留扩展位。
3. 新频道以独立 `ChannelAdapter` + `ChannelManifest` 插入现有注册表，**复用** Bridge（queue / dedup / agent-runner）与五态 UI，避免分叉第二套连接体系。
4. 文档与后续实现路径**避开**用户本机飞书 dirty 工作区冲突；飞书适配器仅在干净分支上按需小改公共契约。

### Non-goals

1. **不做国外** Slack / Discord / Telegram（及同类）产品投入；外部 PR 可再合并。
2. **不做**基于进程 **PID Hook / DLL 注入**（WeChatFerry 等）的微信/QQ 自动化，不作为连接中心选项。
3. 本期**不实现** QQ/微信适配器代码、不改 `channel-handlers` 注册表（仅文档）。
4. 不在本分支解决飞书 WIP / 批改脏文件问题。
5. 不强制用户安装 OpenClaw / cc-connect 作为唯一接入方式。

---

## 1. 当前架构（连接中心 + PID 工具路径澄清）

### 1.1 连接中心（已落地）

```
侧栏 ConnectionCenter ──► ConnectionCenterPanel
                              ├─ ChannelRow[] ← channels.list + onStatusUpdate
                              └─ WebUiConnectBlock（本机 WebUI 扫码，非 IM）

设置页 ChannelsSection ──► ChannelCard + SchemaForm(manifest.configSchema)

IPC: channels:list|start|stop|test + channels:status-update
设置: settings.channels.<id>.* + keystore secrets；保存可触发 reconnect*
```

关键文件：

| 层 | 路径 |
|---|---|
| UI 入口 | `src/renderer/components/connection-center/ConnectionCenter.tsx` |
| UI 面板 | `.../ConnectionCenterPanel.tsx`, `ChannelRow.tsx`, `WebUiConnectBlock.tsx`, `QrCode.tsx` |
| 设置页 | `src/renderer/pages/Settings/channels/*` |
| IPC 注册 | `src/main/ipc/channel-handlers.ts`（当前仅 feishu/dingtalk/wecom） |
| Manager | `src/main/services/channels/manager.ts` |
| 契约 | `src/main/services/channels/types.ts`, `src/shared/types/channel.ts` |
| 适配器 | `src/main/services/channels/adapters/{feishu,dingtalk,wecom}/` |

### 1.2 「基于 PID 的工具/连接器」映射

| 用户可能指代 | 本仓库对应 | 后续动作 |
|---|---|---|
| 进程 PID 桌面钩子 | **不存在** | 设计上列为禁止路径（见调研 §2.3） |
| OpenClaw/社区所说 connector | = 本仓库 **Channel**（入站 IM） | 扩展 adapters |
| WorkBuddy「连接器」数据服务 | 出站集成（飞书 bitable 等） | 保持与频道分区分离 |
| pi-agent / 市场 pi 工具 | Agent 工具市场，非 IM | 不混进连接中心 |

### 1.3 插件点（新频道如何接入）

最小增量（与现架构一致）：

1. `adapters/<id>/`：`manifest.ts` + `index.ts`（`createXxxAdapter`）+ connection/parsing/reply
2. `channel-handlers.ts`：`channelManager.register(createXxxAdapter)` 一行
3. `settings-handlers.ts`：如需「保存即重连」，为 `channels.<id>.*` 增加 reconnect 钩子（模式照抄钉钉/企微）
4. UI：品牌色瓦片 / i18n；**扫码型**需扩展「登录会话」IPC（见 §3），因现 `configSchema` 只有 string/secret/select/boolean/number，**无 qr-login 字段类型**
5. 可选 `comingSoon: true` 先占位卡

**不冲突飞书 WIP 的策略**：新文件全部落在 `adapters/qq/`、`adapters/weixin/` 与共享类型增量；尽量避免大改 `adapters/feishu/**`。公共类型若需 `loginKind: 'credentials' | 'qr'`，做向后兼容可选字段。

---

## 2. 候选连接器排序

| 优先级 | ID（建议） | 产品名 | 主连接方式 | 流式 | 备注 |
|---|---|---|---|---|---|
| **P0** | `weixin` | 微信（ClawBot/iLink） | **扫码** + 长轮询 | none（或多气泡） | 用户点名；合法个人号路径 |
| **P0** | `qq` | QQ 机器人 | **扫码 Onboard** 或 AppID/Secret + WS | none | 用户点名；文案写清配额 |
| P1 | （已有）`dingtalk` / `wecom` | 钉钉 / 企微 | 凭证 + WS | card / respond-stream | 增强：企微扫码关联可选 |
| P1 | `mail` | 邮箱 | IMAP IDLE + SMTP | none | 教师通知刚需；验 Adapter 非 IM |
| P2 | `wecom-kf` / `mp` | 微信客服 / 公众号 | 中继 webhook | none | 依赖云端中继立项 |
| P2 | `sms` | 短信通知 | 云 API 出站 | — | 建议「通知连接器」分区，非入站 Channel |
| P2–观察 | `xiaoyi` | 华为小艺 | A2A 云端端点（出站注册） | SSE | 非 IM 频道语义 |
| P3 / 观察 | `douyin-im` | 抖音私信 | 开放平台 + 资质 | none | ROI 低 |
| 禁止 | — | PID Hook 微信/QQ | 进程注入 | — | Non-goal |
| 非目标 | — | Slack/Discord/Telegram | — | — | 国外不做 |

---

## 3. 连接方式设计（UI + 运行时）

### 3.1 双模板（延续架构文档 P3）

1. **凭证型**（现有）：SchemaForm 填 AppID/Secret → 测试连接 → 启用  
2. **扫码型**（新增）：点「扫码连接」→ 主进程开始 login session → 面板/设置卡内嵌 QR → 手机确认 → 凭证写入 keystore → 自动 `configured=true` → 可 start

### 3.2 建议新增 IPC（实现期）

```
channels:beginLogin(id) → { loginId, qrSvgOrUrl, expiresAt }
channels:pollLogin(loginId) → { status: 'pending'|'scanned'|'confirmed'|'expired'|'error', ... }
channels:cancelLogin(loginId)
```

- 渲染层复用 `QrCode.tsx`（当前用于 WebUI URL；渠道登录可传 onboard URL 或 raw content）
- `ChannelManifest` 扩展（可选，向后兼容）：

```ts
loginKinds?: Array<'credentials' | 'qr'>
// configSchema 可为空或仅含 agentId/allowGroups；secrets 由扫码写入固定 keystore 键
```

### 3.3 各 P0 协议要点

**微信 `weixin`**

- `receivesVia: 'polling'`（新增值或复用并在 UI 文案写「长轮询」；若不愿扩枚举，短期可用 `polling` 已有字面量）
- `streamingKind: 'none'`；`pushPolicy: 'require-prior-message'`
- connect：持 token 循环 getupdates；reply：sendmessage + context_token
- 凭证：`botToken`、`baseUrl`（secret/string）存 keystore/settings

**QQ `qq`**

- `receivesVia: 'ws'`
- `streamingKind: 'none'`；`replyWindowMs` 按官方群/单聊窗口填写；`pushPolicy: 'quota'`
- 扫码：`@tencent-connect/qqbot-connector` 或自研轮询官方 onboard；成功后等价填好 appId/appSecret
- 亦允许高级用户手动填凭证（双模板并存）

### 3.4 明确不做的连接方式（产品文案可写「不支持」）

- 选择本机已登录微信/QQ 窗口（按 PID 附着）
- 剪贴板桥、键鼠宏
- 要求用户关闭官方客户端才能用的互斥钩子

---

## 4. 分阶段交付

### Phase D0 — 文档与占位（本分支）

- [x] 调研 + 本设计
- [ ]（实现期）`comingSoon` manifest 占位：`qq` / `weixin`（可选，可与 D1 合并）

### Phase D1 — 契约与 UI 扫码会话

- 扩展 `ChannelReceiveMode` / manifest `loginKinds`（若需要）
- 实现 `channels:beginLogin/pollLogin/cancelLogin` 骨架 + 连接中心/设置卡扫码 UI
- 品牌瓦片：微信绿 / QQ 蓝（`ChannelBrandIcon`）
- i18n：限制说明（不可主动群发、仅私聊等）

### Phase D2 — 微信 iLink Adapter（P0）

- `adapters/weixin/**` 自研 HTTP 客户端（登录 + getupdates + sendmessage + 媒体最小集）
- 注册 + settings reconnect
- 测试：扫码、收文本、回复、断线重连、token 失效重引导扫码
- **验收**：教师用个人微信扫码后可与本机 Agent 私聊一轮

### Phase D3 — QQ Bot Adapter（P0）

- `adapters/qq/**`：WS Gateway + OpenAPI；扫码 onboard 优先
- 被动回复窗口超时降级提示
- **验收**：QQ 扫码绑定后 C2C 问答可用；群场景文档化限制

### Phase D4 — P1 增强

- 邮件 Adapter；企微「扫码关联」可选；连接中心文案/分区微调（消息频道 vs 通知）

### Phase D5 — P2+

- 中继方案（公众号/客服）；短信出站；小艺 A2A 出站评估

---

## 5. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 账号安全 / 封号 | 用户主号受损 | **禁止 PID Hook**；只走 iLink / QQ 官方；引导用工作号/小号（产品文案） |
| 合规与条款变更 | 接口突然收紧 | 适配器隔离；能力位 + 降级文案；关注 ClawBot 条款 |
| QQ 配额 | Agent「主动通知」不可用 | UI 明确非目标；通知走飞书/钉钉/邮件/短信 |
| 微信无主动推送 | cron 告警达不到微信 | `pushPolicy` 强制检查；连接中心提示 |
| 维护成本 | 协议/插件版本漂移 | 自研协议面保持最小；不跟踪微信 PC 客户端版本 |
| 与飞书 WIP 合并冲突 | 公共文件打架 | 新适配器独立目录；公共改动做小步可选字段；合并时以 channel 架构分支为底 |
| OpenClaw 依赖膨胀 | 打包体积/版本耦合 | MVP 不嵌入完整 OpenClaw；协议自研 |
| 安全（token 落地） | 本机窃取可冒充 bot | 沿用 keystore；WebUI 令牌叙事同样适用于渠道 token |

---

## 6. 建议后续改动文件清单（实现期，非本分支）

### 新增（首选，低冲突）

```
src/main/services/channels/adapters/weixin/
  index.ts manifest.ts connection.ts polling-client.ts parsing.ts
  reply-session.ts constants.ts
src/main/services/channels/adapters/qq/
  index.ts manifest.ts connection.ts gateway.ts parsing.ts
  onboard.ts constants.ts
src/renderer/components/connection-center/ChannelQrLogin.tsx  （或 Settings 下共享）
docs/research/2026-09-14-domestic-qq-wechat-connectors.md     （已有）
docs/plans/2026-09-14-domestic-connection-center.md           （本文）
```

### 小改（公共）

```
src/main/ipc/channel-handlers.ts          # register 两行 + login IPC
src/main/ipc/settings-handlers.ts         # reconnectWeixin/reconnectQq
src/shared/types/channel.ts               # 可选 loginKinds；必要时 receivesVia 文案
src/shared/ipc-channels.ts / api/channels.ts / preload
src/renderer/pages/Settings/channels/ChannelCard.tsx / ChannelBrandIcon
src/renderer/i18n/zh.json, en.json
tests/main/channels-weixin*.ts, channels-qq*.ts
```

### 尽量避免（飞书 dirty / 高冲突）

```
src/main/services/channels/adapters/feishu/**   # 除非为可选字段不得不改
src/main/services/feishu-service.ts / feishu-bot 遗留（若仍存在于其他 worktree）
用户 WIP：grading/*、Print*、RubricEditor 等（education-advisor dirty 树）
```

### 合并策略

1. 本分支只合文档 → 远程 `docs/domestic-connectors`
2. 实现开 `feat/domestic-connection-center`（或用户指定名），从最新 `main`/channel 稳定点拉出
3. 飞书 WIP 先在原 worktree 提交或 stash；实现 PR 避免与批改大改同 PR
4. GitHub 443 失败时推 **gitee** 同名分支

---

## 7. 需用户拍板的决策

1. **微信 P0 范围**：是否接受「个人微信 ClawBot/iLink、偏私聊、弱主动推送」作为首发？
2. **QQ P0 范围**：是否接受弱主动群发、仍上架并显著提示限制？
3. **实现策略**：纯自研 iLink/QQ OpenAPI vs 可选 OpenClaw sidecar？
4. **占位卡**：是否在实现前先合并 `comingSoon` 的 QQ/微信卡片？
5. **分区**：邮件/短信进「消息频道」还是新建「通知」分区？
6. **小艺**：是否立项为出站 A2A（非频道）？

---

## 8. 验收标准（实现完成后）

- 连接中心可见微信、QQ（非国外渠道）
- 微信：扫码 → 已绑定身份可视 → 私聊往返 Agent 成功
- QQ：扫码或凭证 → C2C 往返成功；群限制有 UI/文档说明
- 无 PID/注入相关依赖与设置项
- 飞书/钉钉/企微回归：启停与五态不受损
- 测试绿；密钥仅 keystore
