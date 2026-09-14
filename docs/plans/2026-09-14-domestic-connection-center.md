# 设计文档：国内连接中心扩展（QQ / 微信扫码优先）

> 日期：2026-09-14 ｜ 分支：`docs/domestic-connectors` ｜ 性质：**设计与分阶段计划（本文档不实现连接器代码）**
> 上游调研：[国内 QQ/微信与 PID 路径澄清](../research/2026-09-14-domestic-qq-wechat-connectors.md)
> 既有架构：[频道架构实施](./2026-09-12-channel-architecture-implementation.md)、[连接中心 UI](./2026-09-13-connection-center-ui-implementation.md)、[连接器全景](../research/2026-09-12-channel-connector-catalog.md)
> 代码基线：`education-advisor-connectors` worktree @ `737e467`（自 `main` 干净检出；**不修改** `education-advisor` 上飞书/批改 dirty WIP）
> 协议真源：**腾讯/开发者官方文档**；本机 **qwenpaw** 仅作扫码 UX 与薄客户端模式参考（见调研 §8）

---

## 已拍板（2026-09-14）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 微信 P0 范围 | **接受**「个人微信 iLink、偏私聊、弱主动推送」作为首发上线标准 |
| 2 | QQ P0 范围 | **仍上架**；弱主动群发须在连接中心/设置卡做 **显著提示**（警告条 + i18n + 文档） |
| 3 | 技术路径 | **纯自建薄客户端**直连官方 HTTP/WS；**不要求**、不捆绑 OpenClaw / cc-connect sidecar |
| 4 | 本期交付 | **只改文档**；不实现 `adapters/weixin`、`adapters/qq`，不改 `channel-handlers` 注册表 |
| 5 | PID Hook | **继续禁止**（含隐藏高级选项）；不做进程注入 / WeChatFerry / 剪贴板桥 |

### 本轮未拍板（仍开放）

1. **邮件 / 短信分区**：进「消息频道」还是新建「通知连接器」分区？
2. **小艺 A2A**：是否立项为出站（把 Agent 挂到小艺）？本轮用户未选。
3. **`comingSoon` 占位卡**：实现前是否先合并 QQ/微信灰色卡片？本轮用户未选。

---

## 0. Goals / Non-goals

### Goals

1. 在现有**连接中心**（设置页卡片墙 + 侧栏快捷面板）上，扩展**国内高价值消息频道**，尤其是用户点名的 **QQ、微信（个人）扫码直连**。
2. 连接方式尽量多样，但**优先官方**：扫码 Onboard、凭证+长连接、长轮询；为后续邮件/短信/小艺等留扩展位。
3. 新频道以独立 `ChannelAdapter` + `ChannelManifest` 插入现有注册表，**复用** Bridge（queue / dedup / agent-runner）与五态 UI，避免分叉第二套连接体系。
4. 文档与后续实现路径**避开**用户本机飞书 dirty 工作区冲突；飞书适配器仅在干净分支上按需小改公共契约。
5. 实现期以**官方文档 + 线上协议行为**为准；qwenpaw / OpenClaw 插件文档仅作交叉参考。

### Non-goals

1. **不做国外** Slack / Discord / Telegram（及同类）产品投入；外部 PR 可再合并。
2. **不做**基于进程 **PID Hook / DLL 注入**（WeChatFerry 等）的微信/QQ 自动化，不作为连接中心选项。
3. **不做** OneBot / NapCat / go-cqhttp 等个人号「完整协议」路径（合规风险高；qwenpaw 虽有文档，本产品不采纳）。
4. 本期**不实现** QQ/微信适配器代码、不改 `channel-handlers` 注册表（仅文档）。
5. 不在本分支解决飞书 WIP / 批改脏文件问题。
6. **不要求**用户安装 OpenClaw / QwenPaw / cc-connect；不把 sidecar 写进 MVP 架构。

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
| 进程 PID 桌面钩子 | **不存在** | **禁止路径**（调研 §2.3）；UI/依赖均不得出现 |
| OpenClaw/社区所说 connector | = 本仓库 **Channel**（入站 IM） | 扩展自研 adapters |
| WorkBuddy「连接器」数据服务 | 出站集成（飞书 bitable 等） | 保持与频道分区分离 |
| pi-agent / 市场 pi 工具 | Agent 工具市场，非 IM | 不混进连接中心 |

### 1.3 插件点（新频道如何接入 — 实现期）

最小增量（与现架构一致）：

1. `adapters/<id>/`：`manifest.ts` + `index.ts`（`createXxxAdapter`）+ connection/parsing/reply
2. `channel-handlers.ts`：`channelManager.register(createXxxAdapter)` 一行
3. `settings-handlers.ts`：如需「保存即重连」，为 `channels.<id>.*` 增加 reconnect 钩子（模式照抄钉钉/企微）
4. UI：品牌色瓦片 / i18n；**扫码型**需扩展「登录会话」IPC（见 §3），因现 `configSchema` 只有 string/secret/select/boolean/number，**无 qr-login 字段类型**
5. QQ：**显著限制提示**组件（非可关闭 toast；卡片内固定 warning）
6. 可选 `comingSoon: true` 先占位卡（**是否先做仍开放**）

**不冲突飞书 WIP 的策略**：新文件全部落在 `adapters/qq/`、`adapters/weixin/` 与共享类型增量；尽量避免大改 `adapters/feishu/**`。公共类型若需 `loginKinds: 'credentials' | 'qr'`，做向后兼容可选字段。

---

## 2. 候选连接器排序

| 优先级 | ID（建议） | 产品名 | 主连接方式 | 流式 | 备注 |
|---|---|---|---|---|---|
| **P0** | `weixin` | 微信（ClawBot/iLink） | **扫码** + 长轮询 | none（或多气泡） | **已拍板**：私聊优先 + 弱主动可接受 |
| **P0** | `qq` | QQ 机器人 | **扫码 Onboard** 或 AppID/Secret + WS | none | **已拍板**：弱主动仍上架 + **显著提示** |
| P1 | （已有）`dingtalk` / `wecom` | 钉钉 / 企微 | 凭证 + WS | card / respond-stream | 增强：企微扫码关联可选 |
| P1 | `mail` | 邮箱 | IMAP IDLE + SMTP | none | 分区待拍板 |
| P2 | `wecom-kf` / `mp` | 微信客服 / 公众号 | 中继 webhook | none | 依赖云端中继立项 |
| P2 | `sms` | 短信通知 | 云 API 出站 | — | 建议「通知」分区，非入站 Channel |
| 观察 | `xiaoyi` | 华为小艺 | A2A 云端端点 | SSE | **本轮未选**；非 IM 频道语义 |
| P3 / 观察 | `douyin-im` | 抖音私信 | 开放平台 + 资质 | none | ROI 低 |
| **禁止** | — | PID Hook 微信/QQ | 进程注入 | — | Non-goal |
| **禁止** | — | OneBot/NapCat 个人号 | 非官方 Bot | — | Non-goal |
| 非目标 | — | Slack/Discord/Telegram | — | — | 国外不做 |

---

## 3. 连接方式设计（UI + 运行时）

### 3.1 双模板（延续架构文档 P3）

1. **凭证型**（现有）：SchemaForm 填 AppID/Secret → 测试连接 → 启用  
2. **扫码型**（新增）：点「扫码连接」→ 主进程开始 login session → 面板/设置卡内嵌 QR → 手机确认 → 凭证写入 keystore → 自动 `configured=true` → 可 start

扫码会话状态机可对齐 qwenpaw `QRCodeAuthHandler`（调研 §8.2）：`pending` → `scanned` → `confirmed` | `expired` | `error`。

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
// qq 额外：limitationBannerKey / pushPolicy 驱动显著提示
```

### 3.3 各 P0 协议要点（官方优先 + 自建薄客户端）

**微信 `weixin`**

- 协议真源：`https://ilinkai.weixin.qq.com`（iLink Bot HTTP）
- `receivesVia: 'polling'`（UI 文案写「长轮询」）
- `streamingKind: 'none'`；`pushPolicy: 'require-prior-message'`
- connect：持 token 循环 `getupdates`；reply：`sendmessage` + `context_token`
- 扫码：`get_bot_qrcode` → 轮询 `get_qrcode_status` → 落 `botToken` / `baseUrl` 到 keystore
- 参考实现模式（非依赖）：qwenpaw `wechat/client.py`（`ILinkClient`）、`WeChatQRCodeAuthHandler`
- **不**调用本机 OpenClaw CLI / 不读 `~/.openclaw` 作为 MVP 路径

**QQ `qq`**

- 协议真源：https://bot.q.qq.com/wiki/develop/api-v2/ ；WS Gateway + OpenAPI
- `receivesVia: 'ws'`
- `streamingKind: 'none'`；`replyWindowMs` 按官方群/单聊窗口填写；`pushPolicy: 'quota'`
- 扫码：门户 bind task（`q.qq.com/lite/create_bind_task` 等）或官方 SDK 等价流程；成功后写入 appId/appSecret
- 亦允许高级用户手动填凭证（双模板并存）
- **UI**：连接中心与设置卡固定展示限制说明（群主动配额极严、被动窗口短）；不可仅埋在帮助文档
- 参考：qwenpaw `qq/channel.py`、`QQQRCodeAuthHandler`（门户路径名含 `openclaw` 仅为腾讯页面命名）

### 3.4 明确不做的连接方式（产品文案可写「不支持」）

- 选择本机已登录微信/QQ 窗口（按 PID 附着）
- 剪贴板桥、键鼠宏
- 要求用户关闭官方客户端才能用的互斥钩子
- NapCat / OneBot 个人号桥
- 「请先安装 OpenClaw 再回来扫码」类引导

---

## 4. 分阶段交付

### Phase D0 — 文档与决策冻结（本分支）

- [x] 调研 + 本设计
- [x] 用户拍板：微信范围 / QQ 显著提示 / 纯自建 / 本期不写 adapters
- [ ]（仍开放）是否单独 PR 合 `comingSoon` 占位卡

### Phase D1 — 契约与 UI 扫码会话

- 扩展 `ChannelReceiveMode` / manifest `loginKinds`（若需要）
- 实现 `channels:beginLogin/pollLogin/cancelLogin` 骨架 + 连接中心/设置卡扫码 UI
- 品牌瓦片：微信绿 / QQ 蓝（`ChannelBrandIcon`）
- i18n：微信「偏私聊、需先发言」；QQ **显著**限制文案（配额 / 回复窗口）

### Phase D2 — 微信 iLink Adapter（P0）

- `adapters/weixin/**` **自研** HTTP 客户端（登录 + getupdates + sendmessage + 媒体最小集）
- 注册 + settings reconnect
- 测试：扫码、收文本、回复、断线重连、token 失效重引导扫码
- **验收**：教师用个人微信扫码后可与本机 Agent 私聊一轮
- **验收否定项**：无 OpenClaw 进程依赖；无 PID/注入依赖

### Phase D3 — QQ Bot Adapter（P0）

- `adapters/qq/**`：自研 WS Gateway + OpenAPI；扫码 onboard 优先
- 被动回复窗口超时降级提示；**显著**主动消息限制横幅
- **验收**：QQ 扫码绑定后 C2C 问答可用；群场景限制在 UI 可见

### Phase D4 — P1 增强

- 邮件 Adapter（待分区决策）；企微「扫码关联」可选；连接中心文案/分区微调

### Phase D5 — P2+ / 观察

- 中继方案（公众号/客服）；短信出站；小艺 A2A **仅在拍板后**评估

---

## 5. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 账号安全 / 封号 | 用户主号受损 | **禁止 PID Hook / OneBot 个人号**；只走 iLink / QQ 官方；引导用工作号/小号（产品文案） |
| 合规与条款变更 | 接口突然收紧 | 适配器隔离；能力位 + 降级文案；跟官方条款与线上行为 |
| QQ 配额 | Agent「主动通知」不可用 | **显著 UI 提示**；通知走飞书/钉钉/邮件/短信 |
| 微信无主动推送 | cron 告警达不到微信 | `pushPolicy` 强制检查；连接中心提示（已接受为首发） |
| 维护成本 | 协议版本漂移 | 自研协议面保持最小；不跟踪微信 PC 客户端版本；不嵌入 OpenClaw |
| 与飞书 WIP 合并冲突 | 公共文件打架 | 新适配器独立目录；公共改动做小步可选字段 |
| 「参考实现」版权/许可 | 直接拷贝 qwenpaw | 只借鉴流程与端点；本仓库自写 TS；实现前做许可核对 |
| 安全（token 落地） | 本机窃取可冒充 bot | 沿用 keystore |

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
src/renderer/components/connection-center/ChannelLimitationBanner.tsx  （QQ/微信限制条）
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

## 7. 验收标准（实现完成后）

- 连接中心可见微信、QQ（非国外渠道）
- 微信：扫码 → 已绑定身份可视 → 私聊往返 Agent 成功；无主动推送预期已在 UI 说明
- QQ：扫码或凭证 → C2C 往返成功；**群主动限制在 UI 显著可见**
- 无 PID/注入/OneBot 个人号相关依赖与设置项
- 无「必须安装 OpenClaw」安装步骤
- 飞书/钉钉/企微回归：启停与五态不受损
- 测试绿；密钥仅 keystore